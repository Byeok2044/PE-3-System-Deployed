const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Connection = require('../models/StudentProfessorConnection');
const AcademicRecord = require('../models/AcademicRecord');
const Batch = require('../models/AcademicImportBatch');
const Revision = require('../models/AcademicRecordRevision');
const { HEADERS, ACADEMIC_FIELDS, institutionKey, fail, parseCsv, validateAcademicRow, validatePeriod } = require('../utils/academicValidation');
const { pick, loadWorkspace } = require('../utils/academicWorkspace');

function requireProfessor(user) {
  if (user.role !== 'professor' || !user.emailVerified) throw fail('Only verified professors can import academic records.', 403);
}
function requireId(value) { if (!mongoose.isValidObjectId(value)) throw fail('Invalid record identifier.'); }
async function transaction(callback) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session)); }
  catch (error) {
    if ([20, 303].includes(error.code)) throw fail('Academic imports require a transaction-enabled MongoDB replica set or sharded deployment.', 503);
    if (error.code === 11000) throw fail('The academic record changed in another session. Refresh and preview the upload again.', 409);
    throw error;
  }
  finally { await session.endSession(); }
}
// These writes conflict with connection deletion and institution/profile changes.
// Reading permissions alone inside a transaction would leave a write-skew race.
async function guardParticipants(studentId, professorId, key, session) {
  for (const [id, role] of [[studentId, 'student'], [professorId, 'professor']]) {
    const user = await User.findOneAndUpdate({ _id: id, role, emailVerified: true }, { $inc: { academicAccessRevision: 1 } }, { new: true, session });
    if (!user || !key || institutionKey(user.institution) !== key) throw fail('The student and professor must be verified accounts at the same institution.', 403);
  }
  const connection = await Connection.findOneAndUpdate({ student: studentId, professor: professorId, status: 'accepted' }, { $inc: { academicAccessRevision: 1 } }, { new: true, session });
  if (!connection) throw fail('An accepted professor connection is required.', 403);
}

exports.template = (req, res, next) => {
  try {
    requireProfessor(req.user);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="retainify-academic-template.csv"');
    res.send(`${HEADERS.join(',')}\r\n`);
  } catch (error) { next(error); }
};

exports.preview = async (req, res, next) => {
  try {
    requireProfessor(req.user);
    if (!req.is('text/csv')) throw fail('Upload the CSV file with Content-Type text/csv.', 415);
    const parsed = parseCsv(req.body);
    const reason = String(req.query.reason || '').trim();
    if (reason.length > 500) throw fail('Correction reason must be at most 500 characters.');
    const key = institutionKey(req.user.institution);
    const users = await User.find({ email: { $in: parsed.map(row => row.studentEmail.toLowerCase()) }, role: 'student', emailVerified: true }).select('fullName email institution').lean();
    const byEmail = new Map(users.map(user => [user.email, user]));
    const [connections, records] = await Promise.all([
      Connection.find({ professor: req.user._id, status: 'accepted', student: { $in: users.map(user => user._id) } }).lean(),
      AcademicRecord.find({ institutionKey: key, student: { $in: users.map(user => user._id) } }).lean(),
    ]);
    const connected = new Set(connections.map(item => String(item.student)));
    const recordKey = (student, year, semester) => `${student}:${year}:${semester}`;
    const byRecord = new Map(records.map(item => [recordKey(item.student, item.academicYear, item.semester), item]));
    const seen = new Set(); const periods = new Set(); const rows = [];
    for (const raw of parsed) {
      const { values, errors } = validateAcademicRow(raw);
      const duplicateKey = recordKey(values.studentEmail, raw.academicYear, raw.semester);
      if (seen.has(duplicateKey)) errors.push('Duplicate student and academic period in this file.');
      seen.add(duplicateKey); periods.add(`${raw.academicYear}:${raw.semester}`);
      const student = byEmail.get(values.studentEmail);
      const authorized = student && connected.has(String(student._id)) && institutionKey(student.institution) === key;
      let record;
      if (!authorized) errors.push('No authorized, verified, connected student matches this email.');
      else {
        record = byRecord.get(recordKey(student._id, values.academicYear, values.semester));
        if (!record || String(record.provider) !== String(req.user._id)) errors.push('The student must designate you as the provider for this academic period.');
      }
      const before = record?.status === 'published' ? pick(record, ACADEMIC_FIELDS) : null;
      const after = pick(values, ACADEMIC_FIELDS);
      const unchanged = before && ACADEMIC_FIELDS.every(field => before[field] === after[field]);
      if (before && !unchanged && !reason) errors.push('A correction reason is required when replacing a published record.');
      rows.push({ rowNumber: raw.rowNumber, values, errors, student: authorized ? String(student._id) : undefined,
        studentName: authorized ? student.fullName : undefined, recordId: record ? String(record._id) : undefined,
        expectedVersion: record?.academicVersion, before, after, action: errors.length ? 'invalid' : unchanged ? 'unchanged' : before ? 'correction' : 'new' });
    }
    if (periods.size !== 1) throw fail('Use one academic year and semester per CSV batch.');
    const valid = rows.every(row => row.errors.length === 0);
    let batch;
    if (valid) batch = await Batch.create({ professor: req.user._id, institutionKey: key, rows, correctionReason: reason,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(rows.map(row => row.values))).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    res.status(200).json({ valid, batchId: batch?._id, expiresAt: batch?.expiresAt, rows,
      message: valid ? 'Review all changes before confirming. Nothing has been saved yet.' : 'No records were saved. Correct every invalid row and upload again.' });
  } catch (error) { next(error); }
};

exports.confirm = async (req, res, next) => {
  try {
    requireProfessor(req.user); requireId(req.params.id);
    const result = await transaction(async session => {
      const batch = await Batch.findOne({ _id: req.params.id, professor: req.user._id }).session(session);
      if (!batch) throw fail('Import batch not found.', 404);
      if (batch.status === 'committed') return batch.result;
      if (batch.expiresAt <= new Date()) throw fail('This preview expired. Upload again.', 409);
      if (batch.institutionKey !== institutionKey(req.user.institution)) throw fail('Your institution changed. Upload again.', 409);
      const counts = { created: 0, corrected: 0, unchanged: 0 };
      for (const row of batch.rows) {
        await guardParticipants(row.student, req.user._id, batch.institutionKey, session);
        const existing = await AcademicRecord.findOne({ _id: row.recordId, student: row.student, provider: req.user._id,
          institutionKey: batch.institutionKey, academicVersion: row.expectedVersion }).session(session);
        if (!existing) throw fail(`Row ${row.rowNumber}: record or provider changed. Upload again to review the current values.`, 409);
        if (row.action === 'unchanged') { counts.unchanged++; continue; }
        const before = existing.toObject();
        Object.assign(existing, row.after, { status: 'published', source: 'professor_csv', uploadedBy: req.user._id,
          importBatch: batch._id, uploadedAt: new Date(), academicVersion: existing.academicVersion + 1 });
        await existing.save({ session });
        await Revision.create([{ academicRecord: existing._id, student: row.student, actor: req.user._id, importBatch: batch._id,
          action: row.action === 'new' ? 'uploaded' : 'corrected', reason: batch.correctionReason, before, after: existing.toObject() }], { session });
        counts[row.action === 'new' ? 'created' : 'corrected']++;
      }
      batch.status = 'committed'; batch.committedAt = new Date(); batch.result = { ...counts, batchId: String(batch._id), message: 'Academic records imported successfully.' };
      await batch.save({ session });
      return batch.result;
    });
    res.json(result);
  } catch (error) { next(error); }
};

exports.getBatch = async (req, res, next) => {
  try {
    requireProfessor(req.user); requireId(req.params.id);
    const batch = await Batch.findOne({ _id: req.params.id, professor: req.user._id }).lean();
    if (!batch) throw fail('Import batch not found.', 404);
    res.json({ status: batch.status, expiresAt: batch.expiresAt, committedAt: batch.committedAt, result: batch.result });
  } catch (error) { next(error); }
};

exports.designateProvider = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') throw fail('Only students can designate an academic provider.', 403);
    const body = req.body || {};
    const { academicYear, semester } = validatePeriod(body.academicYear, body.semester);
    requireId(body.professorId);
    await transaction(async session => {
      const key = institutionKey(req.user.institution);
      await guardParticipants(req.user._id, body.professorId, key, session);
      let record = await AcademicRecord.findOne({ student: req.user._id, institutionKey: key, academicYear, semester }).session(session);
      if (record && String(record.provider) === body.professorId) return;
      if (record?.status === 'published') throw fail('This period already has an uploaded record. Ask the provider to arrange a transfer.', 409);
      const before = record?.toObject();
      if (!record) record = new AcademicRecord({ student: req.user._id, institutionKey: key, academicYear, semester, provider: body.professorId });
      else { record.provider = body.professorId; record.pendingProvider = null; record.academicVersion++; }
      await record.save({ session });
      await Revision.create([{ academicRecord: record._id, student: req.user._id, actor: req.user._id, action: 'provider_designated', before, after: record.toObject() }], { session });
    });
    res.json({ message: 'Academic provider designated. Ask your professor to upload this period.', ...await loadWorkspace(req.user) });
  } catch (error) { next(error); }
};

exports.transferProvider = async (req, res, next) => {
  try {
    requireProfessor(req.user); requireId(req.params.id);
    const { action, professorId } = req.body || {};
    if (!['request', 'accept', 'cancel'].includes(action)) throw fail('Choose request, accept, or cancel.');
    await transaction(async session => {
      const record = await AcademicRecord.findById(req.params.id).session(session);
      if (!record) throw fail('Academic record not found.', 404);
      const isOwner = String(record.provider) === String(req.user._id);
      const isRecipient = String(record.pendingProvider) === String(req.user._id);
      if ((action === 'accept' && !isRecipient) || (action !== 'accept' && !isOwner)) throw fail('You are not authorized to transfer this record.', 403);
      const before = record.toObject();
      await guardParticipants(record.student, record.provider, record.institutionKey, session);
      if (action === 'request') {
        requireId(professorId);
        if (String(professorId) === String(record.provider)) throw fail('Choose a different connected professor.');
        await guardParticipants(record.student, professorId, record.institutionKey, session);
        record.pendingProvider = professorId;
      } else if (action === 'accept') {
        await guardParticipants(record.student, req.user._id, record.institutionKey, session);
        record.provider = req.user._id; record.pendingProvider = null;
      } else record.pendingProvider = null;
      record.academicVersion++;
      await record.save({ session });
      await Revision.create([{ academicRecord: record._id, student: record.student, actor: req.user._id,
        action: action === 'accept' ? 'provider_transferred' : 'transfer_requested', reason: action,
        before, after: record.toObject() }], { session });
    });
    res.json({ message: action === 'accept' ? 'Academic provider transferred.' : action === 'cancel' ? 'Transfer cancelled.' : 'Transfer offered. The receiving professor must accept.' });
  } catch (error) { next(error); }
};

exports.audit = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') throw fail('Only students can view their academic audit.', 403);
    const entries = await Revision.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(100).populate('actor', 'fullName').lean();
    res.json({ entries });
  } catch (error) { next(error); }
};

exports.transaction = transaction;
exports.guardParticipants = guardParticipants;
