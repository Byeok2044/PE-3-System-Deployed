const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');
const riskNotifications = require('../utils/riskAlertNotifications');
const Batch = require('../models/AcademicImportBatch');
const Entry = require('../models/AcademicBatchForecast');
const User = require('../models/User');
const Academic = require('../models/AcademicRecord');
const Profile = require('../models/StudentRecord');
const Connection = require('../models/StudentProfessorConnection');
const workspaceService = require('../utils/academicWorkspace');
const history = require('../utils/professorHistory');
const { ACADEMIC_FIELDS, PROFILE_FIELDS, institutionKey, fail } = require('../utils/academicValidation');

function professorOnly(user) {
  if (user.role !== 'professor' || !user.emailVerified) throw fail('Only verified professors can run class forecasts.', 403);
}
async function ownedBatch(req) {
  professorOnly(req.user);
  if (!mongoose.isValidObjectId(req.params.id)) throw fail('Invalid batch identifier.');
  const batch = await Batch.findOne({ _id: req.params.id, professor: req.user._id,
    institutionKey: institutionKey(req.user.institution), status: 'committed' }).lean();
  if (!batch) throw fail('Confirmed import batch not found.', 404);
  return batch;
}
function summary(rows, total = rows.length) {
  const counts = { total, succeeded: 0, failed: 0, outdated: 0, pending: total - rows.length, processing: 0, restricted: 0, low: 0, medium: 0, high: 0 };
  for (const row of rows) {
    counts[row.status]++;
    if (row.status === 'succeeded' && ['low', 'medium', 'high'].includes(row.forecast?.riskLevel)) counts[row.forecast.riskLevel]++;
  }
  counts.remaining = counts.pending + counts.processing + counts.outdated;
  return counts;
}
async function visibleResults(batch, professor) {
  const entries = await Entry.find({ batch: batch._id }).sort({ rowNumber: 1 }).populate('activity', 'profileVersion').lean();
  const [connections, academics, profiles] = await Promise.all([
    Connection.find({ professor: professor._id, status: 'accepted', student: { $in: entries.map(row => row.student) } })
      .populate('student', 'institution emailVerified role').lean(),
    Academic.find({ _id: { $in: entries.map(row => row.academicRecord) }, provider: professor._id,
      institutionKey: batch.institutionKey }).select('_id student').lean(),
    Profile.find({ user: { $in: entries.map(row => row.student) } }).select(['user', 'profileVersion', ...PROFILE_FIELDS].join(' ')).lean(),
  ]);
  const connected = new Set(connections.filter(item => item.student?.role === 'student' && item.student.emailVerified &&
    institutionKey(item.student.institution) === batch.institutionKey).map(item => String(item.student._id)));
  const provided = new Set(academics.map(item => String(item._id)));
  const personal = new Map(profiles.map(item => [String(item.user), item]));
  const rows = entries.map(row => {
    if (!connected.has(String(row.student)) || !provided.has(String(row.academicRecord))) {
      return { id: row._id, rowNumber: row.rowNumber, status: 'restricted', error: 'Connection or academic provider access is no longer available.' };
    }
    const profile = personal.get(String(row.student));
    // Older class results store the version on their immutable History activity.
    const forecastProfileVersion = row.profileVersion ?? row.activity?.profileVersion;
    const outdated = row.status === 'succeeded' && (!PROFILE_FIELDS.every(key => typeof profile?.[key] === 'boolean') ||
      forecastProfileVersion === undefined || forecastProfileVersion !== (profile?.profileVersion || 0));
    return {
      id: row._id, studentId: row.student, studentName: row.studentName, studentEmail: row.studentEmail,
      rowNumber: row.rowNumber, status: outdated ? 'outdated' : row.status,
      error: outdated ? 'Personal information changed. Rerun this forecast using the latest saved factors.' : row.error,
      forecast: row.status === 'succeeded' && !outdated ? row.forecast : null, profile: workspaceService.pick(profile, PROFILE_FIELDS),
      profileVersion: profile?.profileVersion || 0, forecastProfileVersion,
      academicVersion: row.academicVersion, inputVersion: row.inputVersion, completedAt: row.completedAt,
    };
  });
  return { batchId: batch._id, section: batch.section || '', academicYear: batch.academicYear || batch.rows[0]?.values.academicYear,
    semester: batch.semester || batch.rows[0]?.values.semester, committedAt: batch.committedAt,
    skipped: batch.skippedCount || 0, initialized: entries.length === batch.rows.length,
    rows, summary: summary(rows, batch.rows.length) };
}

exports.list = async (req, res, next) => {
  try {
    professorOnly(req.user);
    const before = req.query.before;
    if (before && !mongoose.isValidObjectId(before)) throw fail('Invalid batch cursor.');
    const batches = await Batch.find({ professor: req.user._id, institutionKey: institutionKey(req.user.institution), status: 'committed',
      ...(before ? { _id: { $lt: before } } : {}) }).select('section academicYear semester committedAt result')
      .sort({ _id: -1 }).limit(51).lean();
    res.json({ batches: batches.slice(0, 50), nextCursor: batches.length > 50 ? String(batches[49]._id) : null });
  } catch (error) { next(error); }
};
exports.results = async (req, res, next) => {
  try { const batch = await ownedBatch(req); res.json(await visibleResults(batch, req.user)); }
  catch (error) { next(error); }
};
exports.initialize = async (req, res, next) => {
  try {
    const batch = await ownedBatch(req);
    const writes = batch.rows.map(row => ({ updateOne: {
      filter: { batch: batch._id, student: row.student },
      update: { $setOnInsert: { batch: batch._id, professor: req.user._id, student: row.student,
        academicRecord: row.recordId, academicVersion: row.expectedVersion + (row.action === 'unchanged' ? 0 : 1),
        rowNumber: row.rowNumber, studentName: row.studentName, studentEmail: row.values.studentEmail, status: 'pending' } }, upsert: true,
    } }));
    if (writes.length) {
      try { await Entry.bulkWrite(writes, { ordered: false }); }
      catch (error) {
        if (!error.writeErrors?.length || error.writeErrors.some(item => item.code !== 11000)) throw error;
      }
    }
    res.json(await visibleResults(batch, req.user));
  } catch (error) { next(error); }
};

async function eligibleWorkspace(entry, batch, professor) {
  const student = await User.findById(entry.student);
  if (!student || student.role !== 'student' || !student.emailVerified || institutionKey(student.institution) !== batch.institutionKey) {
    throw fail('Student account is unavailable at your institution.', 403);
  }
  const workspace = await workspaceService.loadWorkspace(student, { includeForecast: false, academicRecordId: entry.academicRecord });
  if (!workspace.canForecast) throw fail(`Forecast unavailable: ${workspace.readiness}. Complete personal information and check the provider connection.`, 409);
  if (String(workspace.record.provider._id) !== String(professor._id)) throw fail('You are no longer the academic provider for this source semester.', 403);
  if (workspace.record.academicVersion !== entry.academicVersion) throw fail('The academic record changed after this import. Use a newly confirmed import batch.', 409);
  return { student, workspace };
}
exports.runEntry = async (req, res, next) => {
  let entry;
  try {
    const batch = await ownedBatch(req);
    if (!mongoose.isValidObjectId(req.params.entryId)) throw fail('Invalid forecast identifier.');
    if (Object.keys(req.body || {}).length) throw fail('Forecast inputs are loaded from the confirmed import and saved student profile.');
    entry = await Entry.findOneAndUpdate({ _id: req.params.entryId, batch: batch._id, professor: req.user._id,
      $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'processing', leaseExpiresAt: { $lte: new Date() } }] },
    { $set: { status: 'processing', error: '', leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 150000) } }, { new: true });
    if (!entry) {
      const existing = await Entry.findOne({ _id: req.params.entryId, batch: batch._id, professor: req.user._id }).lean();
      if (!existing) throw fail('Forecast item not found. Initialize this batch first.', 404);
      if (existing.status === 'succeeded') {
        const { workspace } = await eligibleWorkspace(existing, batch, req.user);
        // Repeated requests with the same inputs remain harmless. Only a changed
        // server-side input version can reopen a completed work item.
        if (existing.inputVersion === workspace.inputVersion) {
          // Recover version metadata for older entries even if their optional
          // student History item was deleted. The forecast itself stays intact.
          if (existing.profileVersion === undefined) await Entry.updateOne({ _id: existing._id, status: 'succeeded', inputVersion: workspace.inputVersion },
            { $set: { profileVersion: workspace.profile.profileVersion || 0 } });
          return res.json({ status: 'succeeded', message: 'Forecast already saved.' });
        }
        entry = await Entry.findOneAndUpdate({ _id: existing._id, batch: batch._id, professor: req.user._id,
          status: 'succeeded', inputVersion: existing.inputVersion ?? { $exists: false }, activity: existing.activity ?? { $exists: false } },
        { $set: { status: 'processing', error: '', leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 150000) } }, { new: true });
      }
      if (!entry) return res.status(409).json({ status: 'processing',
        message: 'This forecast is already running. Refresh results or retry after its request expires.' });
    }
    try {
      const { student, workspace } = await eligibleWorkspace(entry, batch, req.user);
      const { attendance, ...fields } = workspaceService.pick(workspace.record, [...PROFILE_FIELDS, ...ACADEMIC_FIELDS]);
      const mlUrl = (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
      const { data } = await axios.post(mlUrl + '/predict', { ...fields, studySchedule: attendance }, { timeout: 90000 });
      if (!Number.isFinite(data?.dropoutProbability) || data.dropoutProbability < 0 || data.dropoutProbability > 1 ||
        !Number.isFinite(data.predictedNextSemesterGrade) || !data.modelVersion) throw fail('The forecasting service returned an incomplete prediction.', 503);
      data.riskLevel = data.dropoutProbability < 0.2 ? 'low' : data.dropoutProbability < 0.4 ? 'medium' : 'high';
      const current = await eligibleWorkspace(entry, batch, req.user);
      if (current.workspace.inputVersion !== workspace.inputVersion) throw fail('Student inputs changed while forecasting. Retry this student.', 409);
      const activity = await history.saveForecastActivity(student, workspace, data, { actor: req.user, batchEntry: entry, section: batch.section });
      try {
        await riskNotifications.sendRiskAlerts(student, data, { inputVersion: workspace.inputVersion, forecastId: activity._id, record: workspace.record });
      } catch (error) { console.error('Unable to send class forecast risk alerts:', error.message); }
      return res.json({ status: 'succeeded' });
    } catch (error) {
      const upstreamStatus = error.response?.status;
      const unavailable = Boolean((error.isAxiosError && (!upstreamStatus || upstreamStatus >= 500 || [408, 429].includes(upstreamStatus))) ||
        ['ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code) || error.status === 503);
      const message = unavailable ? 'The forecasting service is starting or temporarily unavailable. Retry this student shortly.'
        : error.isAxiosError ? "The forecasting service could not process this student's saved inputs. Check their academic record and personal information."
        : error.status && error.status < 500 ? error.message : 'This forecast could not be saved. Refresh results and retry this student.';
      await Entry.updateOne({ _id: entry._id, status: 'processing', leaseToken: entry.leaseToken },
        { $set: { status: 'failed', error: message }, $unset: { leaseToken: 1, leaseExpiresAt: 1 } });
      return res.json({ status: 'failed', message, serviceUnavailable: unavailable });
    }
  } catch (error) { next(error); }
};

// CSV quoting and formula neutralization apply to every user-controlled cell.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
exports.exportCsv = async (req, res, next) => {
  try {
    const batch = await ownedBatch(req);
    const results = await visibleResults(batch, req.user);
    const lines = [['studentId', 'studentName', 'studentEmail', 'section', 'academicYear', 'semester', 'status', 'dropoutProbability', 'riskLevel',
      'predictedGrade', 'gradeMaximum', 'academicVersion', 'modelVersion', 'completedAt', 'batchId', 'message'],
    ...results.rows.map(row => [row.studentId, row.studentName, row.studentEmail, results.section, results.academicYear, results.semester, row.status,
      row.forecast?.dropoutProbability, row.forecast?.riskLevel, row.forecast?.predictedNextSemesterGrade, row.forecast?.gradeMaximum,
      row.academicVersion, row.forecast?.modelVersion, row.completedAt?.toISOString(), results.batchId, row.error])];
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="retainify-class-forecasts-${batch._id}.csv"`);
    res.send('\uFEFF' + lines.map(line => line.map(csvCell).join(',')).join('\r\n'));
  } catch (error) { next(error); }
};
exports.summary = summary;
exports.csvCell = csvCell;
