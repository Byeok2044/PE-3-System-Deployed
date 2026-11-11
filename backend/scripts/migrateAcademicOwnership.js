// Dry run by default. Existing academic values remain historical; never promote them.
const path = require('node:path');
const fs = require('node:fs/promises');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Profile = require('../src/models/StudentRecord');
const Activity = require('../src/models/StudentActivity');
const Academic = require('../src/models/AcademicRecord');
const Batch = require('../src/models/AcademicImportBatch');
const Revision = require('../src/models/AcademicRecordRevision');
const ProfessorHistoryEvent = require('../src/models/ProfessorHistoryEvent');
const { configureMongoDns, checkMongoSrv } = require('../src/config/mongoDns');
const { formatMigrationError } = require('../src/utils/migrationDiagnostics');
let phase = 'configuration';

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI?.trim()) throw Object.assign(new Error('MONGODB_URI is missing or empty in backend/.env.'), { code: 'MISSING_MONGODB_URI' });
  configureMongoDns();
  console.log(`Checking MongoDB connection (${apply ? 'apply' : 'dry-run'} mode).`);
  // Driver selection timeouts do not bound its initial SRV DNS lookup.
  phase = 'MongoDB DNS lookup';
  await checkMongoSrv(process.env.MONGODB_URI.trim());
  phase = 'database connection';
  await mongoose.connect(process.env.MONGODB_URI.trim(), {
    dbName: process.env.MONGODB_DB_NAME || 'StudentPerformanceSystem',
    serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000,
    // A dry run must not create collections or indexes through model initialization.
    autoCreate: false, autoIndex: false,
  });
  phase = 'reading legacy records';
  const legacyFilter = { previousSemesterGrade: { $exists: true }, legacyAcademicSource: { $ne: 'legacy_self_reported' } };
  const historyFilter = { inputVersion: { $exists: false }, 'record.previousSemesterGrade': { $exists: true }, legacySource: { $ne: 'legacy_self_reported' } };
  const counts = { legacyProfiles: await Profile.countDocuments(legacyFilter), legacyActivities: await Activity.countDocuments(historyFilter) };
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...counts }));
  if (!apply) return;
  phase = 'backup';
  const destination = path.resolve(__dirname, '../../tmp/academic-migration', String(Date.now()));
  await fs.mkdir(destination, { recursive: true });
  // Back up the exact documents affected before making any updates.
  for (const [name, model, filter] of [['profiles', Profile, legacyFilter], ['activities', Activity, historyFilter]]) {
    const handle = await fs.open(path.join(destination, name + '.jsonl'), 'wx');
    try { for await (const document of model.find(filter).lean().cursor()) await handle.write(JSON.stringify(document) + '\n'); }
    finally { await handle.close(); }
  }
  phase = 'academic indexes';
  for (const model of [Academic, Batch, Revision, ProfessorHistoryEvent]) {
    await model.createCollection();
    await model.createIndexes();
  }
  phase = 'labeling legacy records';
  await Profile.updateMany(legacyFilter, { $set: { legacyAcademicSource: 'legacy_self_reported' } });
  await Activity.updateMany(historyFilter, { $set: { legacySource: 'legacy_self_reported' } });
  console.log('Migration complete. Original values preserved. Backup: ' + destination);
}
main().catch(error => { console.error(formatMigrationError(error, phase, process.env.MONGODB_URI)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
