const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const axios = require('axios');
const controller = require('../src/controllers/batchForecastController');
const Batch = require('../src/models/AcademicImportBatch');
const Entry = require('../src/models/AcademicBatchForecast');
const User = require('../src/models/User');
const Academic = require('../src/models/AcademicRecord');
const Profile = require('../src/models/StudentRecord');
const Connection = require('../src/models/StudentProfessorConnection');
const Activity = require('../src/models/StudentActivity');
const Event = require('../src/models/ProfessorHistoryEvent');
const workspaces = require('../src/utils/academicWorkspace');
const history = require('../src/utils/professorHistory');
const id = value => String(value).padStart(24, '0');
const professor = { _id: id(1), fullName: 'Professor One', institution: 'School A', role: 'professor', emailVerified: true };
const student = { _id: id(2), fullName: 'Student One', institution: 'School A', role: 'student', emailVerified: true };
const batch = { _id: id(3), professor: id(1), institutionKey: 'school a', status: 'committed', section: 'BSIT 3-3',
  academicYear: '2025-2026', semester: 1, rows: [{ student: id(2), studentName: 'Student One', recordId: id(4), expectedVersion: 0,
    action: 'new', rowNumber: 2, values: { studentEmail: 'student@example.com', academicYear: '2025-2026', semester: 1 } }] };
const entry = { _id: id(5), student: id(2), professor: id(1), batch: id(3), academicRecord: id(4), academicVersion: 1,
  studentName: 'Student One', studentEmail: 'student@example.com', rowNumber: 2, status: 'processing', leaseToken: 'lease', profileVersion: 1, inputVersion: 'version' };
const profile = { educationalSpecialNeeds: false, tuitionFeeStatus: true, scholarshipStatus: false, profileVersion: 1 };
const workspace = { canForecast: true, inputVersion: 'version', profile, record: { ...profile, academicRecordId: id(4), academicVersion: 1,
  academicYear: '2025-2026', semester: 1, provider: professor, attendance: 'night', previousSemesterGrade: 2.25, gradeMaximum: 5,
  previousSemesterUnitsEnrolled: 18, previousSemesterUnitsApproved: 15 } };
const forecast = { dropoutProbability: 0.4, predictedNextSemesterGrade: 2.1, gradeMaximum: 5, riskLevel: 'high', modelVersion: 'test-model-v1' };
const restores = [];
function stub(object, key, value) { const old = object[key]; object[key] = value; restores.push(() => { object[key] = old; }); }
afterEach(() => { while (restores.length) restores.pop()(); });
function query(value) {
  const q = { sort() { return q; }, select() { return q; }, populate() { return q; }, limit() { return q; },
    lean: async () => value, then: (ok, bad) => Promise.resolve(value).then(ok, bad) }; return q;
}
const request = overrides => ({ user: professor, params: { id: id(3), entryId: id(5) }, query: {}, body: {}, ...overrides });
async function invoke(handler, req = request()) {
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, set(key, value) { this.headers[key] = value; return this; },
    json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
  await handler(req, res, error => { res.error = error; }); return res;
}
function batchFixture() {
  stub(Batch, 'findOne', filter => {
    assert.equal(String(filter.professor), professor._id); assert.equal(filter.institutionKey, 'school a'); assert.equal(filter.status, 'committed');
    return query(batch);
  });
}
function runFixture() {
  batchFixture(); const calls = { ml: [], saves: [], updates: [] };
  stub(Entry, 'findOneAndUpdate', async filter => { calls.claim = filter; return { ...entry }; });
  stub(Entry, 'updateOne', async (...args) => { calls.updates.push(args); return { modifiedCount: 1 }; });
  stub(User, 'findById', async () => student);
  stub(workspaces, 'loadWorkspace', async (_student, options) => {
    assert.equal(options.academicRecordId, entry.academicRecord); assert.equal(options.includeForecast, false); return workspace;
  });
  stub(axios, 'post', async (...args) => { calls.ml.push(args); return { data: { ...forecast } }; });
  stub(history, 'saveForecastActivity', async (...args) => { calls.saves.push(args); return { _id: id(9) }; });
  return calls;
}
function visibleFixture(entries = [{ ...entry, status: 'succeeded', forecast }], allowed = true) {
  batchFixture(); stub(Entry, 'find', () => query(entries));
  stub(Connection, 'find', () => query(allowed ? [{ student }] : []));
  stub(Academic, 'find', () => query(allowed ? [{ _id: id(4), student: student._id }] : []));
  stub(Profile, 'find', () => query([{ user: student._id, ...profile }]));
}

test('all class endpoints deny students and unverified professors before querying batches', async () => {
  stub(Batch, 'findOne', () => { throw new Error('must not query'); });
  for (const user of [student, { ...professor, emailVerified: false }]) {
    for (const handler of [controller.list, controller.results, controller.initialize, controller.runEntry, controller.exportCsv]) {
      const res = await invoke(handler, request({ user })); assert.equal(res.error.status, 403);
    }
  }
});
test('a batch must belong to the current professor, institution, and committed imports', async () => {
  stub(Batch, 'findOne', filter => {
    assert.equal(filter.professor, professor._id); assert.equal(filter.institutionKey, 'school a'); assert.equal(filter.status, 'committed'); return query(null);
  });
  const res = await invoke(controller.results); assert.equal(res.error.status, 404);
});
test('initialization upserts only absent students and preserves successful forecasts on retries', async () => {
  visibleFixture([]); let writes;
  stub(Batch, 'findOne', () => query({ ...batch, rows: [...batch.rows, { ...batch.rows[0], student: id(8), action: 'unchanged', expectedVersion: 4 }] }));
  stub(Entry, 'bulkWrite', async value => { writes = value; });
  const res = await invoke(controller.initialize); assert.ifError(res.error);
  assert.equal(writes.length, 2); assert.equal(writes[0].updateOne.update.$setOnInsert.academicVersion, 1);
  assert.equal(writes[1].updateOne.update.$setOnInsert.academicVersion, 4);
  assert.deepEqual(Object.keys(writes[0].updateOne.update), ['$setOnInsert']); assert.equal(writes[0].updateOne.upsert, true);
});
test('prediction uses the selected imported semester and saved personal context', async () => {
  const calls = runFixture(); const res = await invoke(controller.runEntry); assert.ifError(res.error);
  assert.equal(res.body.status, 'succeeded'); assert.equal(calls.ml.length, 1);
  assert.deepEqual(calls.ml[0][1], { educationalSpecialNeeds: false, tuitionFeeStatus: true, scholarshipStatus: false,
    previousSemesterGrade: 2.25, gradeMaximum: 5, previousSemesterUnitsEnrolled: 18, previousSemesterUnitsApproved: 15, studySchedule: 'night' });
  assert.equal(calls.ml[0][2].timeout, 90000);
  assert.equal(calls.saves[0][3].actor, professor); assert.equal(calls.saves[0][3].batchEntry.batch, batch._id);
  assert.equal(calls.saves[0][3].section, 'BSIT 3-3');
  assert.ok(calls.claim.$or.some(option => option.status === 'processing' && option.leaseExpiresAt.$lte instanceof Date));
});
test('risk tiers use exact 20% and 40% boundaries, including zero risk', async () => {
  const calls = runFixture();
  for (const [probability, expected] of [[0, 'low'], [0.1999, 'low'], [0.2, 'medium'], [0.3999, 'medium'], [0.4, 'high'], [1, 'high']]) {
    stub(axios, 'post', async () => ({ data: { ...forecast, dropoutProbability: probability, riskLevel: 'wrong' } }));
    const res = await invoke(controller.runEntry); assert.equal(res.body.status, 'succeeded');
    assert.equal(calls.saves.at(-1)[2].riskLevel, expected);
  }
});
test('forged values are rejected and incomplete profiles do not reach ML or History', async () => {
  const calls = runFixture();
  let res = await invoke(controller.runEntry, request({ body: { previousSemesterGrade: 20 } })); assert.equal(res.error.status, 400);
  stub(workspaces, 'loadWorkspace', async () => ({ canForecast: false, readiness: 'profile_incomplete' }));
  res = await invoke(controller.runEntry); assert.equal(res.body.status, 'failed'); assert.match(res.body.message, /profile_incomplete/);
  assert.equal(calls.ml.length, 0); assert.equal(calls.saves.length, 0);
});
test('transferred providers and corrected source records cannot be forecast from an older batch', async () => {
  const calls = runFixture();
  for (const record of [{ ...workspace.record, provider: { _id: id(7) } }, { ...workspace.record, academicVersion: 2 }]) {
    stub(workspaces, 'loadWorkspace', async () => ({ ...workspace, record }));
    const res = await invoke(controller.runEntry); assert.equal(res.body.status, 'failed');
  }
  assert.equal(calls.ml.length, 0); assert.equal(calls.saves.length, 0);
});
test('profile edits during inference prevent saving a stale result', async () => {
  const calls = runFixture(); let reads = 0;
  stub(workspaces, 'loadWorkspace', async () => ({ ...workspace, inputVersion: ++reads === 1 ? 'old' : 'new' }));
  const res = await invoke(controller.runEntry); assert.equal(res.body.status, 'failed'); assert.match(res.body.message, /inputs changed/);
  assert.equal(calls.saves.length, 0);
});
test('a failed row does not block the next eligible student and an unavailable ML service is retryable', async () => {
  const calls = runFixture();
  stub(axios, 'post', async () => { throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }); });
  let res = await invoke(controller.runEntry); assert.equal(res.body.status, 'failed'); assert.equal(res.body.serviceUnavailable, true);
  assert.equal(calls.updates[0][0].leaseToken, 'lease'); assert.equal(calls.updates[0][1].$set.status, 'failed');
  stub(axios, 'post', async () => ({ data: { ...forecast } }));
  res = await invoke(controller.runEntry); assert.equal(res.body.status, 'succeeded'); assert.equal(calls.saves.length, 1);
});
test('incomplete ML outputs fail instead of being recorded as completed', async () => {
  const calls = runFixture();
  for (const data of [{}, { ...forecast, dropoutProbability: 1.1 }, { ...forecast, modelVersion: undefined }]) {
    stub(axios, 'post', async () => ({ data }));
    const res = await invoke(controller.runEntry); assert.equal(res.body.status, 'failed');
  }
  assert.equal(calls.saves.length, 0);
});
test('an upstream validation error fails only that student and does not pause the class for service startup', async () => {
  const calls = runFixture();
  stub(axios, 'post', async () => { throw Object.assign(new Error('invalid input'), { isAxiosError: true, response: { status: 422 } }); });
  const res = await invoke(controller.runEntry); assert.ifError(res.error);
  assert.equal(res.body.status, 'failed'); assert.equal(res.body.serviceUnavailable, false); assert.equal(calls.saves.length, 0);
});
test('duplicate and concurrent requests never call ML for a successful or currently claimed item', async () => {
  const calls = runFixture(); stub(Entry, 'findOneAndUpdate', async () => null);
  for (const status of ['succeeded', 'processing']) {
    stub(Entry, 'findOne', () => query({ ...entry, status }));
    const res = await invoke(controller.runEntry); assert.equal(res.code, status === 'succeeded' ? 200 : 409);
  }
  assert.equal(calls.ml.length, 0); assert.equal(calls.saves.length, 0);
});
test('results and exports redact student identities and risk after access is revoked', async () => {
  visibleFixture(undefined, false);
  let res = await invoke(controller.results); assert.ifError(res.error);
  assert.deepEqual(res.body.rows[0], { id: id(5), rowNumber: 2, status: 'restricted', error: 'Connection or academic provider access is no longer available.' });
  assert.equal(res.body.summary.high, 0); assert.equal(res.body.summary.succeeded, 0);
  res = await invoke(controller.exportCsv); assert.ifError(res.error);
  assert.doesNotMatch(res.body, /Student One|student@example.com|test-model-v1/); assert.match(res.body, /restricted/);
});
test('CSV exports include source version and model provenance and neutralize spreadsheet formulas', async () => {
  visibleFixture([{ ...entry, studentName: '=HYPERLINK("bad")', status: 'succeeded', forecast, completedAt: new Date('2026-11-12T08:00:00Z') }]);
  const res = await invoke(controller.exportCsv); assert.ifError(res.error);
  assert.match(res.headers['Content-Disposition'], /attachment/); assert.match(res.body, /test-model-v1/); assert.match(res.body, /BSIT 3-3/);
  assert.match(res.body, /'\=HYPERLINK/); assert.equal(controller.csvCell('a,"b"'), '"a,""b"""');
  for (const text of ['=1+1', '+cmd', '-1+1', '@SUM(A1)', '\t=1']) assert.ok(controller.csvCell(text).startsWith('"\''));
});
test('batch totals count failure and remaining students separately from risk tiers', () => {
  assert.deepEqual(controller.summary([{ status: 'succeeded', forecast }, { status: 'failed' }, { status: 'processing' }, { status: 'restricted' }], 5),
    { total: 5, succeeded: 1, failed: 1, outdated: 0, pending: 1, processing: 1, restricted: 1, low: 0, medium: 0, high: 1, remaining: 2 });
});
test('both histories and work-item completion share the same transaction and professor actor', async () => {
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  stub(mongoose, 'startSession', async () => session);
  stub(User, 'findOneAndUpdate', async filter => filter.role === 'student' ? student : professor);
  stub(Academic, 'findOneAndUpdate', async () => ({ provider: professor._id }));
  stub(Profile, 'findOneAndUpdate', async () => profile);
  stub(Connection, 'find', () => ({ session() { return this; }, populate: async () => [{ _id: id(8), professor }] }));
  stub(Connection, 'findOneAndUpdate', async () => ({}));
  const writes = [];
  stub(Activity, 'create', async (rows, options) => { assert.equal(options.session, session); writes.push(rows[0]); return [{ ...rows[0], createdAt: new Date() }]; });
  stub(Event, 'create', async (rows, options) => { assert.equal(options.session, session); writes.push(rows[0]); });
  stub(Entry, 'updateOne', async (filter, update, options) => {
    assert.equal(options.session, session); assert.equal(filter.leaseToken, entry.leaseToken);
    assert.equal(update.$set.status, 'succeeded'); assert.equal(update.$set.profileVersion, profile.profileVersion); writes.push(update); return { modifiedCount: 1 };
  });
  await history.saveForecastActivity(student, workspace, forecast, { actor: professor, batchEntry: entry, section: 'BSIT 3-3' });
  assert.equal(writes.length, 3); assert.equal(writes[0].generatedBy, professor._id); assert.equal(writes[0].batchId, batch._id);
  assert.equal(writes[1].actor.role, 'professor'); assert.equal(writes[1].details.modelVersion, 'test-model-v1');
  assert.equal(writes[1].details.batchId, batch._id); assert.equal(writes[1].student.id, student._id);
  stub(Entry, 'updateOne', async () => ({ modifiedCount: 0 }));
  await assert.rejects(history.saveForecastActivity(student, workspace, forecast, { actor: professor, batchEntry: entry }), error => error.status === 409);
});

test('changed socioeconomic profiles hide old class risks and become eligible for rerun and export', async () => {
  visibleFixture();
  stub(Profile, 'find', () => query([{ user: student._id, ...profile, scholarshipStatus: true, profileVersion: 2 }]));
  const res = await invoke(controller.results); assert.ifError(res.error);
  assert.equal(res.body.rows[0].status, 'outdated'); assert.equal(res.body.rows[0].forecast, null);
  assert.equal(res.body.rows[0].profile.scholarshipStatus, true);
  assert.equal(res.body.rows[0].forecastProfileVersion, 1); assert.equal(res.body.rows[0].profileVersion, 2);
  assert.equal(res.body.summary.outdated, 1); assert.equal(res.body.summary.remaining, 1);
  assert.equal(res.body.summary.succeeded, 0); assert.equal(res.body.summary.high, 0);
  const csv = await invoke(controller.exportCsv); assert.ifError(csv.error);
  assert.match(csv.body, /outdated/); assert.doesNotMatch(csv.body, /test-model-v1|"high"/);
});

test('existing class forecasts use the saved History profile version before the new field exists', async () => {
  visibleFixture([{ ...entry, profileVersion: undefined, activity: { profileVersion: 1 }, status: 'succeeded', forecast }]);
  let res = await invoke(controller.results); assert.ifError(res.error); assert.equal(res.body.rows[0].status, 'succeeded');
  stub(Profile, 'find', () => query([{ user: student._id, ...profile, profileVersion: 2 }]));
  res = await invoke(controller.results); assert.ifError(res.error); assert.equal(res.body.rows[0].status, 'outdated');
});

test('a completed class item can rerun with changed server inputs while guarding against concurrent claims', async () => {
  const calls = runFixture();
  const existing = { ...entry, status: 'succeeded', inputVersion: 'previous', activity: id(9) };
  stub(Entry, 'findOne', () => query(existing));
  const claims = [];
  stub(Entry, 'findOneAndUpdate', async (filter, update) => {
    claims.push(filter);
    if (filter.status !== 'succeeded') return null;
    assert.equal(filter.inputVersion, 'previous'); assert.equal(filter.activity, id(9));
    assert.equal(update.$set.status, 'processing');
    return { ...existing, ...update.$set };
  });
  stub(workspaces, 'loadWorkspace', async () => ({ ...workspace, profile: { ...profile, profileVersion: 2, tuitionFeeStatus: false },
    record: { ...workspace.record, profileVersion: 2, tuitionFeeStatus: false } }));
  let res = await invoke(controller.runEntry); assert.ifError(res.error); assert.equal(res.body.status, 'succeeded');
  assert.equal(claims.length, 2); assert.equal(calls.ml[0][1].tuitionFeeStatus, false);
  assert.equal(calls.saves.length, 1); assert.equal(calls.saves[0][1].profile.profileVersion, 2);
  // Another request already claimed the same saved input version.
  stub(Entry, 'findOneAndUpdate', async () => null);
  res = await invoke(controller.runEntry); assert.ifError(res.error); assert.equal(res.code, 409);
  assert.equal(calls.ml.length, 1); assert.equal(calls.saves.length, 1);
});

test('a changed profile cannot reopen a class forecast after the provider is transferred', async () => {
  const calls = runFixture();
  stub(Entry, 'findOneAndUpdate', async () => null);
  stub(Entry, 'findOne', () => query({ ...entry, status: 'succeeded', inputVersion: 'previous' }));
  stub(workspaces, 'loadWorkspace', async () => ({ ...workspace, record: { ...workspace.record, provider: { _id: id(7) } } }));
  const res = await invoke(controller.runEntry); assert.equal(res.error.status, 403);
  assert.equal(calls.ml.length, 0); assert.equal(calls.saves.length, 0);
});

test('unchanged legacy class results recover profile metadata without running ML or replacing History', async () => {
  const calls = runFixture();
  stub(Entry, 'findOneAndUpdate', async () => null);
  stub(Entry, 'findOne', () => query({ ...entry, status: 'succeeded', profileVersion: undefined, activity: undefined }));
  const res = await invoke(controller.runEntry); assert.ifError(res.error); assert.equal(res.body.status, 'succeeded');
  assert.equal(calls.ml.length, 0); assert.equal(calls.saves.length, 0);
  assert.equal(calls.updates.length, 1); assert.deepEqual(calls.updates[0][1], { $set: { profileVersion: 1 } });
});

test('a failed rerun does not export its previous successful risk as a new result', async () => {
  visibleFixture([{ ...entry, status: 'failed', forecast, error: 'The forecasting service is starting.' }]);
  const res = await invoke(controller.results); assert.ifError(res.error);
  assert.equal(res.body.rows[0].status, 'failed'); assert.equal(res.body.rows[0].forecast, null);
  const csv = await invoke(controller.exportCsv); assert.ifError(csv.error);
  assert.match(csv.body, /failed/); assert.doesNotMatch(csv.body, /test-model-v1|"high"/);
});
