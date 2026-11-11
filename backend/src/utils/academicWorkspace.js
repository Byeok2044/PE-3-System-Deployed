const crypto = require('crypto');
const StudentRecord = require('../models/StudentRecord');
const AcademicRecord = require('../models/AcademicRecord');
const StudentActivity = require('../models/StudentActivity');
const Connection = require('../models/StudentProfessorConnection');
const { ACADEMIC_FIELDS, PROFILE_FIELDS, institutionKey, fail } = require('./academicValidation');
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));

async function loadWorkspace(student, { includeForecast = true } = {}) {
  if (!student) throw fail('Student account is no longer available.', 401);
  const [profile, academics, connections] = await Promise.all([
    StudentRecord.findOne({ user: student._id }).lean(),
    AcademicRecord.find({ student: student._id, institutionKey: institutionKey(student.institution) })
      .sort({ academicYear: -1, semester: -1 }).populate('provider uploadedBy pendingProvider', 'fullName email institution role emailVerified').lean(),
    Connection.find({ student: student._id, status: 'accepted' }).populate('professor', 'fullName email institution role emailVerified').lean(),
  ]);
  const accepted = connections.filter(item => item.professor?.role === 'professor' && item.professor.emailVerified && institutionKey(item.professor.institution) === institutionKey(student.institution));
  const academic = academics[0] || null;
  const connection = accepted.find(item => String(item.professor._id) === String(academic?.provider?._id));
  const profileComplete = PROFILE_FIELDS.every(key => typeof profile?.[key] === 'boolean');
  const academicComplete = academic?.status === 'published' && academic.source === 'professor_csv' && ACADEMIC_FIELDS.every(key => academic[key] !== undefined && academic[key] !== null);
  const readiness = !accepted.length ? 'no_connection' : !academic ? 'choose_provider' : !connection ? 'provider_disconnected' : !academicComplete ? 'awaiting_upload' : !profileComplete ? 'profile_incomplete' : 'ready';
  const profileData = { ...pick(profile, PROFILE_FIELDS), profileVersion: profile?.profileVersion || 0 };
  const provenance = academic && {
    academicRecordId: String(academic._id), academicVersion: academic.academicVersion,
    academicYear: academic.academicYear, semester: academic.semester, source: academic.source,
    provider: academic.provider, uploadedBy: academic.uploadedBy, uploadedAt: academic.uploadedAt,
    pendingProvider: academic.pendingProvider, status: academic.status,
  };
  const record = academicComplete ? { ...profileData, ...pick(academic, ACADEMIC_FIELDS), ...provenance, updatedAt: academic.updatedAt } : null;
  const inputVersion = readiness === 'ready' ? crypto.createHash('sha256').update(JSON.stringify({
    academicRecordId: String(academic._id), academicVersion: academic.academicVersion, institutionKey: institutionKey(student.institution),
    provider: String(academic.provider._id), connection: String(connection._id), connectionCreated: connection.createdAt,
    profile: profileData,
  })).digest('hex') : null;
  const latest = includeForecast ? await StudentActivity.findOne({ student: student._id, type: 'forecast_run' }).sort({ createdAt: -1 }).lean() : null;
  const forecastCurrent = Boolean(latest?.inputVersion && inputVersion && latest.inputVersion === inputVersion);
  return {
    profile: profileData, record, academic: provenance, academicPeriods: academics.map(item => ({ id: String(item._id), academicYear: item.academicYear, semester: item.semester, status: item.status })),
    readiness, inputVersion, canForecast: readiness === 'ready',
    providers: accepted.map(item => ({ id: String(item.professor._id), fullName: item.professor.fullName })),
    legacyRecord: profile?.previousSemesterGrade !== undefined ? { ...pick(profile, ACADEMIC_FIELDS), source: 'legacy_self_reported' } : null,
    latestForecast: forecastCurrent ? { id: latest._id, forecast: latest.forecast, record: latest.record, inputVersion: latest.inputVersion, createdAt: latest.createdAt } : null,
    hasOutdatedForecast: Boolean(latest && !forecastCurrent),
  };
}
module.exports = { loadWorkspace, pick };
