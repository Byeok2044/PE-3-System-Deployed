const mongoose = require('mongoose');
const StudentRecord = require('../models/StudentRecord');
const StudentActivity = require('../models/StudentActivity');
const { PROFILE_FIELDS, fail } = require('../utils/academicValidation');
const { loadWorkspace, pick } = require('../utils/academicWorkspace');

function requireStudent(user) {
  if (user.role !== 'student') throw fail('Only students can access this resource.', 403);
}
exports.getMyRecord = async (req, res, next) => {
  try { requireStudent(req.user); res.json(await loadWorkspace(req.user)); }
  catch (error) { next(error); }
};
exports.upsertMyRecord = async (req, res, next) => {
  try {
    requireStudent(req.user);
    const body = req.body || {};
    if (Object.keys(body).some(key => !PROFILE_FIELDS.includes(key))) throw fail('Academic information is managed by your professor. Only personal information can be submitted.', 403);
    const errors = Object.fromEntries(PROFILE_FIELDS.filter(key => typeof body[key] !== 'boolean').map(key => [key, 'Select yes or no.']));
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Complete your personal information.', errors });
    const record = await StudentRecord.findOneAndUpdate({ user: req.user._id }, {
      $set: { ...pick(body, PROFILE_FIELDS), submittedAt: new Date() },
      $inc: { profileVersion: 1 }, $setOnInsert: { user: req.user._id },
    }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
    await StudentActivity.create({ student: req.user._id, type: 'record_updated', record: pick(record, [...PROFILE_FIELDS, 'profileVersion']) });
    res.json({ message: 'Your personal information has been saved.', ...await loadWorkspace(req.user) });
  } catch (error) { next(error); }
};
exports.getMyHistory = async (req, res, next) => {
  try {
    requireStudent(req.user);
    const [activities, workspace] = await Promise.all([
      StudentActivity.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(),
      loadWorkspace(req.user, { includeForecast: false }),
    ]);
    res.json({ activities: activities.map(({ _id, type, record, forecast, insight, inputVersion, createdAt, generatedByName, batchId, section }) => ({
      id: _id, type, record, forecast, insight, inputVersion, createdAt, generatedByName, batchId, section,
      freshness: inputVersion ? (workspace.inputVersion === inputVersion ? 'current' : 'outdated') : 'legacy',
    })) });
  } catch (error) { next(error); }
};
exports.deleteMyHistoryEntry = async (req, res, next) => {
  try {
    requireStudent(req.user);
    if (!mongoose.isValidObjectId(req.params.activityId)) throw fail('Invalid history identifier.');
    // AcademicRecordRevision is deliberately not reachable through this endpoint.
    const activity = await StudentActivity.findOneAndDelete({ _id: req.params.activityId, student: req.user._id, type: { $ne: 'risk_alert_sent' } });
    if (!activity) throw fail('History entry not found or protected.', 404);
    res.json({ message: 'History entry deleted.' });
  } catch (error) { next(error); }
};
