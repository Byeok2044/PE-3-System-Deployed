// Explicit test-data setup. Never called by the server or an import endpoint.
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { parseCsv, validateAcademicRow, institutionKey } = require('../src/utils/academicValidation');
const { configureMongoDns, checkMongoSrv } = require('../src/config/mongoDns');
const { redact } = require('../src/utils/migrationDiagnostics');
const User = require('../src/models/User');
const Profile = require('../src/models/StudentRecord');
const Connection = require('../src/models/StudentProfessorConnection');
const Academic = require('../src/models/AcademicRecord');
const Revision = require('../src/models/AcademicRecordRevision');
const Activity = require('../src/models/StudentActivity');
const Event = require('../src/models/ProfessorHistoryEvent');

const MARKER = 'Retainify mock class for CSV testing (seedMockClass v1).';
const DEFAULT_CSV = path.join(__dirname, '../../Retainify_BSIT_3-3_Class_Test.csv');

function planMockClass(csv, professor, existing = []) {
  if (professor?.role !== 'professor' || !professor.emailVerified || !institutionKey(professor.institution)) {
    throw new Error('Choose a verified professor with an institution.');
  }
  const rows = parseCsv(csv);
  const seen = new Set();
  const periods = new Set();
  const byEmail = new Map(existing.map(user => [user.email, user]));
  return rows.map(row => {
    const { values, errors } = validateAcademicRow(row);
    if (errors.length) throw new Error(`Row ${row.rowNumber}: ${errors.join(' ')}`);
    if (!/^student(?:0[1-9]|[12]\d|30)@example\.com$/.test(values.studentEmail)) {
      throw new Error('This seed only supports student01@example.com through student30@example.com.');
    }
    if (seen.has(values.studentEmail)) throw new Error('Duplicate mock student email.');
    seen.add(values.studentEmail);
    periods.add(`${values.academicYear}:${values.semester}`);
    if (periods.size !== 1) throw new Error('Use one academic period per mock class.');
    const user = byEmail.get(values.studentEmail);
    if (user && (user.bio !== MARKER || user.role !== 'student' || !user.emailVerified ||
      institutionKey(user.institution) !== institutionKey(professor.institution))) {
      throw new Error(`Refusing to change an existing account: ${values.studentEmail}`);
    }
    const number = Number(values.studentEmail.slice(7, 9));
    return { values, user, number, profile: {
      educationalSpecialNeeds: number % 10 === 0,
      tuitionFeeStatus: number % 4 !== 0,
      scholarshipStatus: number % 3 === 0,
      profileVersion: 1,
    } };
  });
}

async function main(args = process.argv.slice(2)) {
  const allowed = new Set(['--professor', '--csv', '--apply', '--help']);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (flag === '--apply' || flag === '--help') options[flag] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[flag] = args[++i];
    }
  }
  if (options['--help']) {
    console.log('npm run academics:seed-mock -- --professor your-professor-email --apply\nOmit --apply for a read-only preview. Optional: --csv path/to/sample.csv');
    return;
  }
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  if (!process.env.MONGODB_URI?.trim()) throw new Error('MONGODB_URI is missing in backend/.env.');
  const csv = await fs.readFile(path.resolve(options['--csv'] || DEFAULT_CSV), 'utf8');
  // Fail malformed input before even connecting to the database.
  planMockClass(csv, { role: 'professor', emailVerified: true, institution: 'validation' });
  configureMongoDns();
  await checkMongoSrv(process.env.MONGODB_URI.trim());
  await mongoose.connect(process.env.MONGODB_URI.trim(), {
    dbName: process.env.MONGODB_DB_NAME || 'StudentPerformanceSystem',
    serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, autoCreate: false, autoIndex: false,
  });
  const candidates = await User.find({ role: 'professor', emailVerified: true,
    ...(options['--professor'] ? { email: options['--professor'].trim().toLowerCase() } : {}),
  }).lean();
  if (candidates.length !== 1) {
    throw new Error('Specify the professor account using --professor email. Verified professors: ' +
      candidates.map(user => user.email).join(', '));
  }
  const professor = candidates[0];
  const emails = parseCsv(csv).map(row => row.studentEmail.toLowerCase());
  const existing = await User.find({ email: { $in: emails } }).lean();
  const plan = planMockClass(csv, professor, existing);
  console.log(JSON.stringify({ mode: options['--apply'] ? 'apply' : 'preview', professor: professor.email,
    students: plan.length, newAccounts: plan.filter(row => !row.user).length,
    academicYear: plan[0].values.academicYear, semester: plan[0].values.semester }));
  if (!options['--apply']) return;

  // New mock logins get a fresh random password, never a committed default.
  const password = crypto.randomBytes(24).toString('base64url');
  const session = await mongoose.startSession();
  let counts;
  try {
    await session.withTransaction(async () => {
      counts = { accounts: 0, profiles: 0, connections: 0, providerAssignments: 0 };
      const current = await User.findOneAndUpdate({ _id: professor._id, role: 'professor', emailVerified: true,
        institution: professor.institution }, { $inc: { academicAccessRevision: 1 } }, { new: true, session });
      if (!current) throw new Error('Professor access changed. Run the setup again.');
      const fresh = await User.find({ email: { $in: emails } }).session(session).lean();
      const checked = planMockClass(csv, current, fresh);
      for (const item of checked) {
        const { values } = item;
        let student = item.user;
        if (!student) {
          [student] = await User.create([{ fullName: `Mock Student ${String(item.number).padStart(2, '0')} (CSV Test)`,
            email: values.studentEmail, institution: current.institution, bio: MARKER,
            role: 'student', emailVerified: true, password }], { session });
          counts.accounts++;
        }
        let academic = await Academic.findOne({ student: student._id, institutionKey: institutionKey(current.institution),
          academicYear: values.academicYear, semester: values.semester }).session(session);
        if (academic && (String(academic.provider) !== String(current._id) || academic.pendingProvider)) {
          throw new Error(`Mock student ${student.email} has another provider or pending transfer. No records were changed.`);
        }
        const profile = await Profile.findOne({ user: student._id }).session(session);
        if (!profile) {
          const [created] = await Profile.create([{ user: student._id, ...item.profile }], { session });
          await Activity.create([{ student: student._id, type: 'record_created', record: item.profile,
            profileVersion: created.profileVersion }], { session });
          counts.profiles++;
        } else if (['educationalSpecialNeeds', 'tuitionFeeStatus', 'scholarshipStatus'].some(key => typeof profile[key] !== 'boolean')) {
          throw new Error(`Mock student ${student.email} has an incomplete existing profile. Complete it before retrying.`);
        }
        let connection = await Connection.findOne({ student: student._id, professor: current._id }).session(session);
        if (connection && connection.status !== 'accepted') {
          throw new Error(`Mock student ${student.email} has a ${connection.status} connection. Resolve it before retrying.`);
        }
        if (!connection) {
          [connection] = await Connection.create([{ student: student._id, professor: current._id, status: 'accepted' }], { session });
          await Event.create([{ eventKey: `mock-seed:connection:${connection._id}`, professors: [current._id],
            institutionKey: institutionKey(current.institution), category: 'connection', action: 'accepted',
            actor: { id: current._id, fullName: current.fullName, role: current.role },
            student: { id: student._id, fullName: student.fullName, role: 'student' },
            details: { connectionId: String(connection._id), status: 'accepted', source: 'mock_class_seed' } }], { session });
          counts.connections++;
        }
        if (!academic) {
          [academic] = await Academic.create([{ student: student._id, institutionKey: institutionKey(current.institution),
            academicYear: values.academicYear, semester: values.semester, provider: current._id,
            status: 'awaiting_upload' }], { session });
          await Revision.create([{ academicRecord: academic._id, student: student._id, actor: student._id,
            action: 'provider_designated', reason: MARKER, after: academic.toObject() }], { session });
          counts.providerAssignments++;
        }
      }
    }, { maxCommitTimeMS: 10000 });
  } finally { await session.endSession(); }
  console.log('Mock class created successfully. ' + JSON.stringify(counts));
  if (counts.accounts) console.log('Password for NEW mock accounts only: ' + password);
  console.log('Upload the original CSV, validate, confirm, then run class forecasts. Existing records and passwords were preserved.');
}

if (require.main === module) {
  const timeout = setTimeout(() => {
    console.error('Mock setup timed out waiting for MongoDB. Database setup could not be confirmed.');
    process.exit(1);
  }, 45000);
  main().catch(error => { console.error(redact(error.message, process.env.MONGODB_URI)); process.exitCode = 1; })
    .finally(async () => { await mongoose.disconnect(); clearTimeout(timeout); });
}
module.exports = { planMockClass, MARKER };
