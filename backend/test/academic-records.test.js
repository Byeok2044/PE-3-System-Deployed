const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../src/models/User');
const Profile = require('../src/models/StudentRecord');
const Academic = require('../src/models/AcademicRecord');
const Batch = require('../src/models/AcademicImportBatch');
const Revision = require('../src/models/AcademicRecordRevision');
const Activity = require('../src/models/StudentActivity');
const Connection = require('../src/models/StudentProfessorConnection');
const workspaceService = require('../src/utils/academicWorkspace');
const controller = require('../src/controllers/academicImportController');
const students = require('../src/controllers/studentRecordController');
const professorController = require('../src/controllers/professorController');
const history = require('../src/utils/professorHistory');
const { HEADERS } = require('../src/utils/academicValidation');
const restores = [];
function stub(object, key, value) { const original = object[key]; object[key] = value; restores.push(() => { object[key] = original; }); }
afterEach(() => { while (restores.length) restores.pop()(); });
const id = digit => String(digit).padStart(24, '0');
const student = { _id: id(1), role: 'student', emailVerified: true, email: 'student@example.com', institution: 'School A', fullName: 'Student' };
const professor = { _id: id(2), role: 'professor', emailVerified: true, institution: 'school a', fullName: 'Professor' };
const profile = { educationalSpecialNeeds: false, tuitionFeeStatus: true, scholarshipStatus: false, profileVersion: 1 };
const academic = { _id: id(3), student: student._id, provider: professor, academicVersion: 1, institutionKey: 'school a', academicYear: '2025-2026', semester: 2,
  source: 'professor_csv', status: 'published', previousSemesterGrade: 2.25, gradeMaximum: 5, previousSemesterUnitsEnrolled: 24, previousSemesterUnitsApproved: 21, attendance: 'day' };
function query(value) {
  const q = { sort: () => q, populate: () => q, select: () => q, session: () => q,
    lean: async () => value, then: (ok, bad) => Promise.resolve(value).then(ok, bad) };
  return q;
}
function fixtures({ academics = [academic], personal = profile, connections = [{ _id: id(4), professor, createdAt: new Date('2026-01-01') }], latest = null } = {}) {
  stub(Profile, 'findOne', () => query(personal)); stub(Academic, 'find', () => query(academics));
  stub(Connection, 'find', () => query(connections)); stub(Activity, 'findOne', () => query(latest));
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
async function invoke(handler, req) { const res = response(); await handler(req, res, error => { res.error = error; }); return res; }
const csv = (overrides = {}) => {
  const row = { studentEmail: student.email, academicYear: '2025-2026', semester: '2', previousSemesterGrade: '2.25', gradeMaximum: '5', previousSemesterUnitsEnrolled: '24', previousSemesterUnitsApproved: '21', attendance: 'day', ...overrides };
  return HEADERS.join(',') + '\n' + HEADERS.map(key => row[key]).join(',');
};
function previewFixtures(record = { ...academic, provider: professor._id, status: 'awaiting_upload', academicVersion: 0 }) {
  stub(User, 'find', () => query([student]));
  stub(Connection, 'find', () => query([{ student: student._id }]));
  stub(Academic, 'find', () => query([record]));
  stub(Batch, 'create', async value => ({ ...value, _id: id(5) }));
}
const previewRequest = body => ({ user: professor, body, query: {}, is: type => type === 'text/csv' });

test('profile can validate without any professor-managed fields', async () => {
  const record = new Profile({ user: student._id, ...profile }); await record.validate();
  assert.equal(record.gradeMaximum, undefined);
});
test('student academic writes are rejected before any database write', async () => {
  stub(Profile, 'findOneAndUpdate', () => { throw new Error('Must not write'); });
  for (const key of ['previousSemesterGrade', 'gradeMaximum', 'previousSemesterUnitsEnrolled', 'previousSemesterUnitsApproved', 'attendance', 'studySchedule', 'academicVersion']) {
    const res = await invoke(students.upsertMyRecord, { user: student, body: { ...profile, [key]: 20 } });
    assert.equal(res.error.status, 403, key);
  }
});
test('legacy academic values never become authoritative prediction inputs', async () => {
  fixtures({ academics: [], personal: { ...profile, previousSemesterGrade: 20, gradeMaximum: 20 } });
  const workspace = await workspaceService.loadWorkspace(student);
  assert.equal(workspace.record, null); assert.equal(workspace.canForecast, false);
  assert.equal(workspace.legacyRecord.source, 'legacy_self_reported');
});
test('published academic values are usable before personal context is complete', async () => {
  fixtures({ personal: null }); const workspace = await workspaceService.loadWorkspace(student);
  assert.equal(workspace.record.previousSemesterGrade, 2.25);
  assert.equal(workspace.readiness, 'profile_incomplete'); assert.equal(workspace.canForecast, false);
});
test('forecast versions change with academic corrections and profile changes', async () => {
  fixtures(); const original = await workspaceService.loadWorkspace(student);
  assert.equal(original.readiness, 'ready');
  fixtures({ academics: [{ ...academic, academicVersion: 2 }] });
  assert.notEqual((await workspaceService.loadWorkspace(student)).inputVersion, original.inputVersion);
  fixtures({ personal: { ...profile, tuitionFeeStatus: false, profileVersion: 2 } });
  assert.notEqual((await workspaceService.loadWorkspace(student)).inputVersion, original.inputVersion);
});

test('saving each socioeconomic factor updates the professor workspace and permits a fresh student ML forecast', async () => {
  for (const field of ['educationalSpecialNeeds', 'tuitionFeeStatus', 'scholarshipStatus']) {
    fixtures();
    const original = await workspaceService.loadWorkspace(student);
    const oldForecast = { _id: id(6), inputVersion: original.inputVersion, record: original.record,
      forecast: { dropoutProbability: 0.4, gradeMaximum: 5 }, createdAt: new Date() };
    fixtures({ latest: oldForecast });
    const updated = { ...profile, [field]: !profile[field], profileVersion: 2 };
    stub(Profile, 'findOneAndUpdate', async (_filter, update) => {
      assert.equal(update.$set[field], updated[field]); assert.equal(update.$inc.profileVersion, 1);
      stub(Profile, 'findOne', () => query(updated)); return updated;
    });
    stub(Activity, 'create', async () => ({}));
    const body = Object.fromEntries(['educationalSpecialNeeds', 'tuitionFeeStatus', 'scholarshipStatus'].map(key => [key, updated[key]]));
    const saved = await invoke(students.upsertMyRecord, { user: student, body }); assert.ifError(saved.error);
    assert.equal(saved.body.profile[field], updated[field]); assert.equal(saved.body.hasOutdatedForecast, true);
    assert.equal(saved.body.canForecast, true); assert.equal(saved.body.latestForecast, null);
    assert.notEqual(saved.body.inputVersion, original.inputVersion);
    stub(Connection, 'find', filter => query(filter.professor ? [{ _id: id(4), student }]
      : [{ _id: id(4), professor, createdAt: new Date('2026-01-01') }]));
    const shared = await invoke(professorController.listConnectedStudentWorkspace, { user: professor }); assert.ifError(shared.error);
    assert.equal(shared.body.students[0].profile[field], updated[field]);
    assert.equal(shared.body.students[0].record[field], updated[field]);
    assert.equal(shared.body.students[0].hasOutdatedForecast, true); assert.equal(shared.body.students[0].forecast, null);
    let inputs;
    stub(axios, 'post', async (_url, fields) => { inputs = fields; return { data: { dropoutProbability: 0.1, riskLevel: 'low' } }; });
    stub(User, 'findById', async () => student);
    stub(history, 'saveForecastActivity', async (_student, workspace) => {
      assert.equal(workspace.inputVersion, saved.body.inputVersion); return { _id: id(7), createdAt: new Date() };
    });
    // Low risk does not send alert emails.
    const run = await invoke(require('../src/routes/mlRoutes').predictMyRecord, { user: student, body: {} }); assert.ifError(run.error);
    assert.equal(inputs[field], updated[field]); assert.equal(run.body.activity.inputVersion, saved.body.inputVersion);
    assert.equal(oldForecast.record[field], profile[field]);
  }
});
test('latest forecast is hidden when inputs are outdated and remains a historical snapshot', async () => {
  const latest = { _id: id(6), inputVersion: 'old-version', record: { previousSemesterGrade: 1 }, forecast: { riskLevel: 'low' } };
  fixtures({ latest }); const result = await workspaceService.loadWorkspace(student);
  assert.equal(result.latestForecast, null); assert.equal(result.hasOutdatedForecast, true);
  assert.equal(latest.record.previousSemesterGrade, 1);
});
test('connection removal and institution mismatch prevent new forecasts', async () => {
  for (const connections of [[], [{ _id: id(4), professor: { ...professor, institution: 'Other School' } }]]) {
    fixtures({ connections }); assert.equal((await workspaceService.loadWorkspace(student)).canForecast, false);
  }
});
test('student and unverified professor cannot preview imports', async () => {
  for (const user of [student, { ...professor, emailVerified: false }]) {
    const res = await invoke(controller.preview, { ...previewRequest(csv()), user }); assert.equal(res.error.status, 403);
  }
});
test('valid preview stages new values without changing academic records or profiles', async () => {
  previewFixtures(); stub(Academic, 'findOneAndUpdate', () => { throw new Error('No academic writes during preview'); });
  stub(Profile, 'findOneAndUpdate', () => { throw new Error('Do not overwrite personal information'); });
  const res = await invoke(controller.preview, previewRequest(csv())); assert.ifError(res.error);
  assert.equal(res.body.valid, true); assert.equal(res.body.rows[0].action, 'new'); assert.equal(res.body.batchId, id(5));
});
test('unknown, foreign, and disconnected students are rejected without staging a batch', async () => {
  for (const [users, connections] of [[[], []], [[{ ...student, institution: 'Other' }], [{ student: student._id }]], [[student], []]]) {
    previewFixtures(); stub(User, 'find', () => query(users)); stub(Connection, 'find', () => query(connections));
    stub(Batch, 'create', () => { throw new Error('Invalid data must not be staged'); });
    const res = await invoke(controller.preview, previewRequest(csv())); assert.ifError(res.error);
    assert.equal(res.body.valid, false); assert.equal(res.body.rows[0].studentName, undefined);
  }
});
test('duplicate rows and provider conflicts block the entire preview', async () => {
  previewFixtures(); let res = await invoke(controller.preview, previewRequest(csv() + '\n' + csv().split('\n')[1]));
  assert.equal(res.body.valid, false); assert.match(res.body.rows[1].errors.join(), /Duplicate/);
  previewFixtures({ ...academic, provider: id(9) }); res = await invoke(controller.preview, previewRequest(csv()));
  assert.equal(res.body.valid, false); assert.match(res.body.rows[0].errors.join(), /designate/);
});
test('corrections require reasons and identical reuploads are unchanged', async () => {
  previewFixtures({ ...academic, provider: professor._id });
  let res = await invoke(controller.preview, previewRequest(csv())); assert.equal(res.body.rows[0].action, 'unchanged');
  res = await invoke(controller.preview, previewRequest(csv({ previousSemesterGrade: '2.5' })));
  assert.equal(res.body.valid, false); assert.match(res.body.rows[0].errors.join(), /reason/);
  res = await invoke(controller.preview, { ...previewRequest(csv({ previousSemesterGrade: '2.5' })), query: { reason: 'Corrected registrar summary' } });
  assert.equal(res.body.valid, true); assert.equal(res.body.rows[0].action, 'correction');
});
function confirmationFixtures({ status = 'preview', expired = false, changed = false, connected = true } = {}) {
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  stub(mongoose, 'startSession', async () => session);
  const batch = { _id: id(5), institutionKey: 'school a', professor: professor._id, status, correctionReason: '', expiresAt: new Date(Date.now() + (expired ? -1000 : 60000)),
    rows: [{ student: student._id, recordId: id(3), expectedVersion: 0, rowNumber: 2, action: 'new', values: { academicYear: '2025-2026', semester: 2 }, after: { previousSemesterGrade: 2.25, gradeMaximum: 5, previousSemesterUnitsEnrolled: 24, previousSemesterUnitsApproved: 21, attendance: 'day' } }],
    result: { created: 1 }, save: async options => { assert.equal(options.session, session); } };
  stub(Batch, 'findOne', () => query(batch));
  stub(User, 'findOneAndUpdate', async filter => filter.role === 'student' ? student : professor);
  stub(Connection, 'findOneAndUpdate', async () => connected ? { _id: id(4) } : null);
  const record = { ...academic, provider: professor._id, status: 'awaiting_upload', academicVersion: 0,
    toObject() { return { academicVersion: this.academicVersion, previousSemesterGrade: this.previousSemesterGrade }; },
    save: async options => { assert.equal(options.session, session); } };
  stub(Academic, 'findOne', () => query(changed ? null : record));
  let audit;
  stub(Revision, 'create', async (entries, options) => { assert.equal(options.session, session); audit = entries; });
  return { batch, record, getAudit: () => audit };
}
test('confirmation saves academic record, batch, and audit with the same transaction; preserves profiles', async () => {
  const fixture = confirmationFixtures();
  stub(Profile, 'findOneAndUpdate', () => { throw new Error('Profiles must remain unchanged'); });
  const res = await invoke(controller.confirm, { user: professor, params: { id: id(5) } });
  assert.ifError(res.error); assert.equal(res.body.created, 1); assert.equal(fixture.record.academicVersion, 1);
  assert.equal(fixture.record.source, 'professor_csv'); assert.equal(fixture.batch.status, 'committed');
  assert.equal(fixture.getAudit()[0].action, 'uploaded');
});
test('confirmed batch is idempotent without repeat academic writes', async () => {
  const fixture = confirmationFixtures({ status: 'committed' });
  stub(User, 'findOneAndUpdate', () => { throw new Error('Already committed'); });
  const res = await invoke(controller.confirm, { user: professor, params: { id: id(5) } });
  assert.ifError(res.error); assert.deepEqual(res.body, { created: 1 }); assert.equal(fixture.getAudit(), undefined);
});
test('expired preview, changed academic version, and revoked connection cannot be committed', async () => {
  for (const options of [{ expired: true }, { changed: true }, { connected: false }]) {
    const fixture = confirmationFixtures(options);
    const res = await invoke(controller.confirm, { user: professor, params: { id: id(5) } });
    assert.ok([409, 403].includes(res.error.status)); assert.equal(fixture.batch.status, 'preview'); assert.equal(fixture.getAudit(), undefined);
  }
});
test('forged prediction inputs are rejected before calling ML', async () => {
  stub(axios, 'post', () => { throw new Error('Must not call ML'); });
  const { predictMyRecord } = require('../src/routes/mlRoutes');
  const res = await invoke(predictMyRecord, { user: student, body: { previousSemesterGrade: 20 } });
  assert.equal(res.error.status, 400);
});
test('missing professor record blocks predictions without ML, history, or alerts', async () => {
  stub(workspaceService, 'loadWorkspace', async () => ({ canForecast: false, readiness: 'awaiting_upload' }));
  stub(axios, 'post', () => { throw new Error('Must not call ML'); });
  stub(Activity, 'create', () => { throw new Error('Must not create history'); });
  const res = await invoke(require('../src/routes/mlRoutes').predictMyRecord, { user: student, body: {} });
  assert.equal(res.error.status, 409);
});

test('academic model requires upload provenance and rejects impossible published records', async () => {
  const base = { student: student._id, institutionKey: 'school a', academicYear: '2025-2026', semester: 2, provider: professor._id };
  await new Academic(base).validate();
  await assert.rejects(new Academic({ ...base, status: 'published' }).validate(), { name: 'ValidationError' });
  const published = { ...base, status: 'published', source: 'professor_csv', uploadedBy: professor._id, importBatch: id(5), uploadedAt: new Date(),
    previousSemesterGrade: 2.25, gradeMaximum: 5, previousSemesterUnitsEnrolled: 24, previousSemesterUnitsApproved: 21, attendance: 'day' };
  await new Academic(published).validate();
  await assert.rejects(new Academic({ ...published, previousSemesterUnitsApproved: 25 }).validate(), /Approved units/);
  await assert.rejects(new Academic({ ...published, previousSemesterGrade: 0 }).validate(), /declared scale/);
});

test('students cannot replace the provider of an already published period', async () => {
  const fixture = confirmationFixtures(); fixture.record.status = 'published';
  const res = await invoke(controller.designateProvider, { user: student, body: { professorId: id(9), academicYear: '2025-2026', semester: 2 } });
  // The fixture grants the connection, so the denial must come from the published record.
  assert.equal(res.error.status, 409); assert.equal(fixture.record.provider, professor._id);
});

test('provider transfers require both the owner offer and designated recipient acceptance', async () => {
  const fixture = confirmationFixtures(); const record = fixture.record;
  record.status = 'published'; record.pendingProvider = null;
  stub(Academic, 'findById', () => query(record));
  let res = await invoke(controller.transferProvider, { user: { ...professor, _id: id(8) }, params: { id: id(3) }, body: { action: 'request', professorId: id(9) } });
  assert.equal(res.error.status, 403);
  res = await invoke(controller.transferProvider, { user: professor, params: { id: id(3) }, body: { action: 'request', professorId: id(9) } });
  assert.ifError(res.error); assert.equal(record.pendingProvider, id(9)); assert.equal(record.provider, professor._id);
  res = await invoke(controller.transferProvider, { user: { ...professor, _id: id(8) }, params: { id: id(3) }, body: { action: 'accept' } });
  assert.equal(res.error.status, 403);
  res = await invoke(controller.transferProvider, { user: { ...professor, _id: id(9) }, params: { id: id(3) }, body: { action: 'accept' } });
  assert.ifError(res.error); assert.equal(record.provider, id(9)); assert.equal(record.pendingProvider, null);
  assert.equal(fixture.getAudit()[0].action, 'provider_transferred');
});

test('a correction while ML is running prevents a current result, history save, and email', async () => {
  let reads = 0;
  stub(workspaceService, 'loadWorkspace', async () => ({ canForecast: true, inputVersion: ++reads === 1 ? 'before' : 'after', profile,
    record: { ...profile, ...academic, academicRecordId: id(3) } }));
  stub(axios, 'post', async () => ({ data: { riskLevel: 'high' } }));
  stub(User, 'findById', async () => student);
  stub(Activity, 'create', () => { throw new Error('Do not save a current forecast from changed inputs'); });
  const res = await invoke(require('../src/routes/mlRoutes').predictMyRecord, { user: student, body: {} });
  assert.equal(res.error.status, 409);
});

test('current forecast read includes the exact server snapshot and version', async () => {
  fixtures(); const initial = await workspaceService.loadWorkspace(student);
  const latest = { _id: id(6), inputVersion: initial.inputVersion, record: initial.record, forecast: { gradeMaximum: 5 }, createdAt: new Date() };
  fixtures({ latest }); const current = await workspaceService.loadWorkspace(student);
  assert.equal(current.latestForecast.inputVersion, initial.inputVersion);
  assert.equal(current.latestForecast.record.previousSemesterGrade, 2.25); assert.equal(current.hasOutdatedForecast, false);
});

test('class forecasts select the imported source semester instead of the newest academic record', async () => {
  fixtures({ academics: [{ ...academic, _id: id(9), academicYear: '2026-2027', previousSemesterGrade: 1.5 }, academic] });
  const selected = await workspaceService.loadWorkspace(student, { includeForecast: false, academicRecordId: academic._id });
  assert.equal(selected.record.academicRecordId, academic._id); assert.equal(selected.record.previousSemesterGrade, 2.25);
  const missing = await workspaceService.loadWorkspace(student, { includeForecast: false, academicRecordId: id(8) });
  assert.equal(missing.canForecast, false); assert.equal(missing.record, null);
});

test('partial import stages only eligible rows and records the section and skipped count', async () => {
  previewFixtures(); let saved;
  stub(Batch, 'create', async value => { saved = value; return { ...value, _id: id(5) }; });
  const request = { ...previewRequest(csv() + '\n' + csv({ studentEmail: 'unknown@example.com' }).split('\n')[1]),
    query: { section: 'BSIT 3-3', allowPartial: 'true' } };
  const res = await invoke(controller.preview, request); assert.ifError(res.error);
  assert.equal(res.body.valid, false); assert.equal(res.body.canConfirm, true); assert.equal(res.body.skippedCount, 1);
  assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].student, student._id); assert.equal(saved.section, 'BSIT 3-3');
});

test('partial import excludes all occurrences of duplicate students and does not stage an entirely invalid file', async () => {
  previewFixtures(); stub(Batch, 'create', () => { throw new Error('must not stage duplicates'); });
  const res = await invoke(controller.preview, { ...previewRequest(csv() + '\n' + csv().split('\n')[1]), query: { allowPartial: 'true' } });
  assert.ifError(res.error); assert.equal(res.body.canConfirm, false); assert.equal(res.body.skippedCount, 2);
});
