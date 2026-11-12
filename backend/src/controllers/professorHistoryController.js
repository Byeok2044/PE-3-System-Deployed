const mongoose = require('mongoose');
const Event = require('../models/ProfessorHistoryEvent');
const Batch = require('../models/AcademicImportBatch');
const Revision = require('../models/AcademicRecordRevision');
const Activity = require('../models/StudentActivity');
const Connection = require('../models/StudentProfessorConnection');
const User = require('../models/User');
const { ACADEMIC_FIELDS, institutionKey, fail } = require('../utils/academicValidation');

const CATEGORIES = ['csv_import', 'academic_correction', 'connection', 'provider_transfer', 'forecast'];
const TRANSFERS = ['transfer_requested', 'provider_transferred', 'transfer_cancelled'];
const SOURCES = ['batch', 'revision', 'history', 'forecast'];
const refId = value => value?.toHexString ? value.toHexString() : String(value?._id || value?.id || value || '');
const person = (value, name, role) => ({ id: refId(value), fullName: name || value?.fullName || 'Account unavailable', role: role || value?.role });
const and = (...parts) => ({ $and: parts.filter(part => part && Object.keys(part).length) });

function filtersFor(query = {}) {
  const type = String(query.type || 'all');
  if (type !== 'all' && !CATEGORIES.includes(type)) throw fail('Choose an available history event type.');
  const search = String(query.search || '').trim();
  if (search.length > 80) throw fail('History searches must be 80 characters or fewer.');
  const academicYear = String(query.academicYear || '').trim();
  if (academicYear && (!/^\d{4}-\d{4}$/.test(academicYear) || +academicYear.slice(5) !== +academicYear.slice(0, 4) + 1)) throw fail('Use an academic year such as 2025-2026.');
  const semester = query.semester ? Number(query.semester) : null;
  if (semester !== null && ![1, 2].includes(semester)) throw fail('Choose semester 1 or 2.');
  const day = value => {
    if (!value) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail('Use a valid YYYY-MM-DD date.');
    return new Date(value + 'T00:00:00+08:00');
  };
  const from = day(String(query.from || '')); const to = day(String(query.to || ''));
  if (from && to && from > to) throw fail('The start date must not be after the end date.');
  if (to) to.setUTCDate(to.getUTCDate() + 1);
  const pageSize = query.pageSize ? Number(query.pageSize) : 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw fail('Use a page size from 1 to 50.');
  let cursor;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      if (!SOURCES.includes(cursor.source) || typeof cursor.id !== 'string' || !mongoose.isValidObjectId(cursor.id) || typeof cursor.time !== 'string' || !Number.isFinite(Date.parse(cursor.time))) throw new Error();
    } catch { throw fail('Invalid history cursor. Refresh the history page.'); }
  }
  const regex = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  return { type, search, regex, academicYear, semester, from, to, pageSize, cursor };
}

function cursorFilter(source, field, cursor) {
  if (!cursor) return {};
  const time = new Date(cursor.time);
  const conditions = [{ [field]: { $lt: time } }];
  if (source < cursor.source) conditions.push({ [field]: time });
  else if (source === cursor.source) conditions.push({ [field]: time, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } });
  return { $or: conditions };
}
function encodeCursor(event) {
  const split = event.id.indexOf(':');
  return Buffer.from(JSON.stringify({ source: event.id.slice(0, split), id: event.id.slice(split + 1), time: new Date(event.occurredAt).toISOString() })).toString('base64url');
}
function mergePage(events, pageSize) {
  events.sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
  const page = events.slice(0, pageSize);
  return { events: page, nextCursor: events.length > pageSize && page.length ? encodeCursor(page.at(-1)) : null };
}

function batchEvent(batch) {
  const values = batch.rows?.[0]?.values || {};
  return { id: `batch:${batch._id}`, category: 'csv_import', action: 'confirmed', occurredAt: batch.committedAt,
    actor: person(batch.professor, batch.professorName, 'professor'), student: null,
    academicYear: batch.academicYear || values.academicYear, semester: batch.semester || values.semester,
    details: { batchId: String(batch._id), section: batch.section, skipped: batch.skippedCount || 0,
      counts: { created: batch.result?.created, corrected: batch.result?.corrected, unchanged: batch.result?.unchanged } } };
}
function revisionEvent(revision, names = new Map()) {
  const before = revision.before || {}; const after = revision.after || {};
  const correction = revision.action === 'corrected';
  const action = correction ? 'corrected' : revision.action === 'provider_transferred' ? 'accepted' : revision.action === 'transfer_cancelled' || revision.reason === 'cancel' ? 'cancelled' : 'offered';
  const receivingId = action === 'accepted' ? after.provider : action === 'cancelled' ? before.pendingProvider : after.pendingProvider;
  return { id: `revision:${revision._id}`, category: correction ? 'academic_correction' : 'provider_transfer', action, occurredAt: revision.createdAt,
    actor: person(revision.actor, revision.actorName, 'professor'), student: person(revision.student, revision.studentName, 'student'),
    academicYear: after.academicYear || before.academicYear, semester: after.semester || before.semester,
    details: correction ? { batchId: revision.importBatch ? String(revision.importBatch) : null, academicRecordId: String(revision.academicRecord),
      academicVersion: after.academicVersion, reason: revision.reason || '',
      changes: ACADEMIC_FIELDS.filter(field => before[field] !== after[field]).map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null })) }
      : { academicRecordId: String(revision.academicRecord), academicVersion: after.academicVersion,
        previousProfessor: person(before.provider, revision.previousProviderName || names.get(refId(before.provider)), 'professor'),
        receivingProfessor: person(receivingId, revision.receivingProviderName || names.get(refId(receivingId)), 'professor') } };
}
function storedEvent(event) {
  return { id: `history:${event._id}`, category: event.category, action: event.action, occurredAt: event.occurredAt,
    actor: event.actor, student: event.student, academicYear: event.academicYear, semester: event.semester, details: event.details };
}
function legacyForecastEvent(activity) {
  return { id: `forecast:${activity._id}`, category: 'forecast', action: 'generated', occurredAt: activity.createdAt,
    actor: person(activity.student, null, 'student'), student: person(activity.student, null, 'student'),
    academicYear: activity.record?.academicYear, semester: activity.record?.semester,
    details: { forecastId: String(activity._id), academicVersion: activity.academicVersion ?? activity.record?.academicVersion,
      predictedGrade: activity.forecast?.predictedNextSemesterGrade, gradeMaximum: activity.forecast?.gradeMaximum,
      dropoutProbability: activity.forecast?.dropoutProbability, riskLevel: activity.forecast?.riskLevel,
      legacy: !activity.inputVersion } };
}

exports.getProfessorHistory = async (req, res, next) => {
  try {
    if (req.user.role !== 'professor') throw fail('Only professors can access this history.', 403);
    const filter = filtersFor(req.query);
    const key = institutionKey(req.user.institution);
    if (!key) throw fail('Add your institution before viewing professor history.', 409);
    const connections = await Connection.find({ professor: req.user._id, status: 'accepted' }).populate('student', 'fullName institution').lean();
    const connected = connections.filter(item => item.student && institutionKey(item.student.institution) === key);
    const allowed = new Set(connected.map(item => refId(item.student)));
    const matchingUsers = filter.regex ? await User.find({ institution: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), role: 'student',
      $or: [{ fullName: filter.regex }, { email: filter.regex }] }).select('_id').lean() : [];
    const matchingIds = matchingUsers.map(user => user._id);
    if (mongoose.isValidObjectId(filter.search)) matchingIds.push(new mongoose.Types.ObjectId(filter.search));
    const date = field => filter.from || filter.to ? { [field]: { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lt: filter.to } : {}) } } : {};
    const period = (year, semester) => ({ ...(filter.academicYear ? { [year]: filter.academicYear } : {}), ...(filter.semester ? { [semester]: filter.semester } : {}) });
    const batchQuery = and({ professor: req.user._id, institutionKey: key, status: 'committed' }, date('committedAt'),
      filter.academicYear ? { $or: [{ academicYear: filter.academicYear }, { 'rows.values.academicYear': filter.academicYear }] } : {},
      filter.semester ? { $or: [{ semester: filter.semester }, { 'rows.values.semester': filter.semester }] } : {},
      filter.regex ? { $or: [{ 'rows.studentName': filter.regex }, { 'rows.values.studentEmail': filter.regex }, ...(mongoose.isValidObjectId(filter.search) ? [{ _id: new mongoose.Types.ObjectId(filter.search) }] : [])] } : {});
    const revisionQuery = and({ $or: [{ actor: req.user._id }, { 'before.provider': req.user._id }, { 'after.provider': req.user._id }, { 'before.pendingProvider': req.user._id }, { 'after.pendingProvider': req.user._id }] },
      { $or: [{ 'after.institutionKey': key }, { 'before.institutionKey': key }] }, date('createdAt'),
      period('after.academicYear', 'after.semester'), filter.regex ? { $or: [{ student: { $in: matchingIds } }, { studentName: filter.regex }, ...(mongoose.isValidObjectId(filter.search) ? [{ importBatch: new mongoose.Types.ObjectId(filter.search) }] : [])] } : {});
    const storedQuery = and({ professors: req.user._id, institutionKey: key }, date('occurredAt'), period('academicYear', 'semester'),
      filter.regex ? { $or: [{ 'student.fullName': filter.regex }, { 'student.id': { $in: matchingIds } }] } : {});
    const legacyQuery = and({ type: 'forecast_run', professorHistoryRecorded: { $ne: true } },
      { $or: connected.length ? connected.map(item => ({ student: item.student._id, createdAt: { $gte: item.createdAt || new Date(0) } })) : [{ student: { $in: [] } }] },
      date('createdAt'), period('record.academicYear', 'record.semester'), filter.regex ? { student: { $in: matchingIds } } : {});
    const correctionQuery = and(revisionQuery, { action: 'corrected' });
    const transferQuery = and(revisionQuery, { action: { $in: TRANSFERS } });
    const [imports, corrections, transfers, connectionCount, savedForecasts, legacyForecasts] = await Promise.all([
      Batch.countDocuments(batchQuery), Revision.countDocuments(correctionQuery), Revision.countDocuments(transferQuery),
      Event.countDocuments(and(storedQuery, { category: 'connection' })), Event.countDocuments(and(storedQuery, { category: 'forecast' })), Activity.countDocuments(legacyQuery),
    ]);
    const counts = { csv_import: imports, academic_correction: corrections, connection: connectionCount, provider_transfer: transfers, forecast: savedForecasts + legacyForecasts };
    const includes = category => filter.type === 'all' || filter.type === category;
    const size = filter.pageSize + 1;
    const revisionActions = [...(includes('academic_correction') ? ['corrected'] : []), ...(includes('provider_transfer') ? TRANSFERS : [])];
    const storedCategories = ['connection', 'forecast'].filter(includes);
    const [batches, revisions, events, activities] = await Promise.all([
      includes('csv_import') ? Batch.find(and(batchQuery, cursorFilter('batch', 'committedAt', filter.cursor))).select('professor professorName academicYear semester section skippedCount committedAt result rows.values.academicYear rows.values.semester').sort({ committedAt: -1, _id: -1 }).limit(size).populate('professor', 'fullName').lean() : [],
      revisionActions.length ? Revision.find(and(revisionQuery, { action: { $in: revisionActions } }, cursorFilter('revision', 'createdAt', filter.cursor))).sort({ createdAt: -1, _id: -1 }).limit(size).populate('actor student', 'fullName role').lean() : [],
      storedCategories.length ? Event.find(and(storedQuery, { category: { $in: storedCategories } }, cursorFilter('history', 'occurredAt', filter.cursor))).sort({ occurredAt: -1, _id: -1 }).limit(size).lean() : [],
      includes('forecast') ? Activity.find(and(legacyQuery, cursorFilter('forecast', 'createdAt', filter.cursor))).select('student record.academicYear record.semester record.academicVersion academicVersion forecast.predictedNextSemesterGrade forecast.gradeMaximum forecast.dropoutProbability forecast.riskLevel inputVersion createdAt').sort({ createdAt: -1, _id: -1 }).limit(size).populate('student', 'fullName role').lean() : [],
    ]);
    const providerIds = [...new Set(revisions.flatMap(item => [item.before?.provider, item.before?.pendingProvider, item.after?.provider, item.after?.pendingProvider]).map(refId).filter(value => mongoose.isValidObjectId(value)))];
    const providers = providerIds.length ? await User.find({ _id: { $in: providerIds } }).select('fullName').lean() : [];
    const names = new Map(providers.map(user => [refId(user), user.fullName]));
    const page = mergePage([...batches.map(batchEvent), ...revisions.map(item => revisionEvent(item, names)), ...events.map(storedEvent), ...activities.map(legacyForecastEvent)], filter.pageSize);
    // Keep the professor's own activity metadata after disconnection, but do not
    // reopen academic data access through the historical timeline.
    page.events = page.events.map(event => event.student && !allowed.has(refId(event.student)) && ['academic_correction', 'forecast'].includes(event.category)
      ? { ...event, detailsRestricted: true, details: {} } : event);
    res.json({ ...page, counts, total: filter.type === 'all' ? Object.values(counts).reduce((sum, value) => sum + value, 0) : counts[filter.type], pageSize: filter.pageSize });
  } catch (error) { next(error); }
};
exports.filtersFor = filtersFor;
exports.cursorFilter = cursorFilter;
exports.mergePage = mergePage;
exports.batchEvent = batchEvent;
exports.revisionEvent = revisionEvent;
exports.storedEvent = storedEvent;
exports.legacyForecastEvent = legacyForecastEvent;
