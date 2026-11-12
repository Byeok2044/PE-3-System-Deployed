const mongoose = require('mongoose');
const Event = require('../models/ProfessorHistoryEvent');
const Connection = require('../models/StudentProfessorConnection');
const User = require('../models/User');
const Academic = require('../models/AcademicRecord');
const Profile = require('../models/StudentRecord');
const Activity = require('../models/StudentActivity');
const { institutionKey, fail } = require('./academicValidation');
const person = user => ({ id: user._id || user.id, fullName: user.fullName || 'Account unavailable', role: user.role });

async function withTransaction(callback) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session)); }
  finally { await session.endSession(); }
}

async function recordConnection({ connection, actor, student, professor, action }, session) {
  await Event.create([{
    eventKey: `connection:${connection._id}:${action}:${new mongoose.Types.ObjectId()}`,
    professors: [professor._id || professor.id], institutionKey: institutionKey(professor.institution),
    category: 'connection', action, actor: person(actor), student: person(student), occurredAt: new Date(),
    details: { connectionId: String(connection._id), previousStatus: connection.status, status: action === 'removed' ? 'removed' : action },
  }], { session });
}

async function saveForecastActivity(student, workspace, forecast, options = {}) {
  return withTransaction(async session => {
    // Take write guards so corrections, profile edits, removals, and school
    // changes cannot commit between input validation and the saved audit.
    const current = await User.findOneAndUpdate({ _id: student._id, role: 'student', emailVerified: true },
      { $inc: { academicAccessRevision: 1 } }, { new: true, session });
    if (!current || institutionKey(current.institution) !== institutionKey(student.institution)) throw fail('Your institution changed. Run a new forecast.', 409);
    let actor = current;
    if (options.batchEntry) {
      actor = await User.findOneAndUpdate({ _id: options.actor._id, role: 'professor', emailVerified: true },
        { $inc: { academicAccessRevision: 1 } }, { new: true, session });
      if (!actor || institutionKey(actor.institution) !== institutionKey(current.institution)) throw fail('Professor access changed. Refresh this class.', 403);
    }
    const academic = await Academic.findOneAndUpdate({ _id: workspace.record.academicRecordId, academicVersion: workspace.record.academicVersion },
      { $inc: { historyReadRevision: 1 } }, { new: true, session, timestamps: false });
    const version = workspace.profile.profileVersion || 0;
    const profile = await Profile.findOneAndUpdate({ user: student._id, ...(version ? { profileVersion: version } : { $or: [{ profileVersion: 0 }, { profileVersion: { $exists: false } }] }) },
      { $inc: { historyReadRevision: 1 } }, { new: true, session, timestamps: false });
    if (!academic || !profile) throw fail('Your inputs changed while forecasting. Run a new forecast.', 409);
    if (options.batchEntry && String(academic.provider) !== String(actor._id)) throw fail('The academic provider changed. Import and review the record again.', 409);
    const candidates = await Connection.find({ student: student._id, status: 'accepted' }).session(session)
      .populate('professor', 'fullName institution role emailVerified');
    const professors = candidates.filter(item => item.professor?.role === 'professor' && item.professor.emailVerified && institutionKey(item.professor.institution) === institutionKey(current.institution));
    const providerConnection = professors.find(item => String(item.professor._id) === String(academic.provider));
    if (!providerConnection) throw fail('Your academic provider is no longer connected.', 409);
    for (const item of professors) {
      const guard = await Connection.findOneAndUpdate({ _id: item._id, status: 'accepted' }, { $inc: { academicAccessRevision: 1 } }, { session });
      if (!guard) throw fail('A professor connection changed. Run a new forecast.', 409);
    }
    const id = new mongoose.Types.ObjectId();
    const [activity] = await Activity.create([{
      _id: id, student: student._id, type: 'forecast_run', record: workspace.record, forecast,
      inputVersion: workspace.inputVersion, academicRecord: workspace.record.academicRecordId,
      academicVersion: workspace.record.academicVersion, profileVersion: version, professorHistoryRecorded: true,
      generatedBy: actor._id, generatedByName: actor.fullName, batchId: options.batchEntry?.batch, section: options.section,
    }], { session });
    await Event.create([{
      eventKey: `forecast:${id}`, professors: [...new Set(professors.map(item => String(item.professor._id)))],
      institutionKey: institutionKey(current.institution), category: 'forecast', action: 'generated',
      actor: person(actor), student: person(current), occurredAt: activity.createdAt,
      academicYear: workspace.record.academicYear, semester: workspace.record.semester,
      details: { forecastId: String(id), academicRecordId: workspace.record.academicRecordId,
        academicVersion: workspace.record.academicVersion, profileVersion: version, inputVersion: workspace.inputVersion,
        predictedGrade: forecast.predictedNextSemesterGrade, gradeMaximum: forecast.gradeMaximum,
        dropoutProbability: forecast.dropoutProbability, riskLevel: forecast.riskLevel,
        modelVersion: forecast.modelVersion, batchId: options.batchEntry ? String(options.batchEntry.batch) : undefined,
        section: options.section },
    }], { session });
    if (options.batchEntry) {
      const Entry = require('../models/AcademicBatchForecast');
      // Saving both histories and completing the work item in one transaction
      // prevents duplicate forecasts after a timeout or simultaneous retry.
      const saved = await Entry.updateOne({ _id: options.batchEntry._id, status: 'processing', leaseToken: options.batchEntry.leaseToken },
        { $set: { status: 'succeeded', forecast, activity: id, inputVersion: workspace.inputVersion, profileVersion: version, completedAt: activity.createdAt, error: '' },
          $unset: { leaseToken: 1, leaseExpiresAt: 1 } }, { session });
      if (saved.modifiedCount !== 1) throw fail('This forecast was claimed by another request. Refresh the class results.', 409);
    }
    return activity;
  });
}
module.exports = { person, withTransaction, recordConnection, saveForecastActivity };
