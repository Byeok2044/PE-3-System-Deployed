const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const controller = require('../src/controllers/professorHistoryController');
const history = require('../src/utils/professorHistory');
const Event = require('../src/models/ProfessorHistoryEvent');
const Deletion = require('../src/models/ProfessorHistoryDeletion');
const Batch = require('../src/models/AcademicImportBatch');
const Revision = require('../src/models/AcademicRecordRevision');
const Activity = require('../src/models/StudentActivity');
const Connection = require('../src/models/StudentProfessorConnection');
const User = require('../src/models/User');
const Academic = require('../src/models/AcademicRecord');
const Profile = require('../src/models/StudentRecord');
const Conversation = require('../src/models/Conversation');
const connectionsController = require('../src/controllers/connectionController');
const restores = [];
const id = value => String(value).padStart(24, '0');
const professor = { _id: id(2), role: 'professor', fullName: 'Professor Chee', institution: 'School A', emailVerified: true };
const student = { _id: id(1), role: 'student', fullName: 'Student One', institution: 'School A', emailVerified: true };
const time = new Date('2026-11-11T04:00:00Z');
function stub(object, key, value) { const original = object[key]; object[key] = value; restores.push(() => { object[key] = original; }); }
afterEach(() => { while (restores.length) restores.pop()(); });
function query(value) {
  const q = { sort() { return q; }, populate() { return q; }, select() { return q; }, limit() { return q; }, session() { return q; },
    lean: async () => value, then: (ok, bad) => Promise.resolve(value).then(ok, bad) };
  return q;
}
async function invoke(handler, req) {
  const res = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler(req, res, error => { res.error = error; }); return res;
}
const batch = { _id: id(3), professor, professorName: 'Professor at import time', committedAt: time,
  rows: [{ values: { academicYear: '2025-2026', semester: 2 } }], result: { created: 2, corrected: 1, unchanged: 0 } };
const revision = { _id: id(4), action: 'corrected', student, actor: professor, createdAt: time, academicRecord: id(8), importBatch: id(3), reason: 'Corrected summary',
  before: { institutionKey: 'school a', provider: professor._id, academicYear: '2025-2026', semester: 2, previousSemesterGrade: 3, gradeMaximum: 5, previousSemesterUnitsApproved: 18 },
  after: { institutionKey: 'school a', provider: professor._id, academicYear: '2025-2026', semester: 2, previousSemesterGrade: 2.25, gradeMaximum: 5, previousSemesterUnitsApproved: 21, academicVersion: 2 } };

test('confirmed imports retain actor, source semester, batch identity, and zero unchanged counts', () => {
  const event = controller.batchEvent(batch);
  assert.equal(event.actor.fullName, 'Professor at import time'); assert.equal(event.academicYear, '2025-2026');
  assert.equal(event.semester, 2); assert.equal(event.details.batchId, id(3));
  assert.deepEqual(event.details.counts, { created: 2, corrected: 1, unchanged: 0 });
});
test('correction entries include only changed academic fields and preserve the original snapshots', () => {
  const event = controller.revisionEvent(revision);
  assert.equal(event.student.fullName, student.fullName); assert.equal(event.details.reason, 'Corrected summary');
  assert.equal(event.details.academicVersion, 2);
  assert.deepEqual(event.details.changes, [{ field: 'previousSemesterGrade', before: 3, after: 2.25 }, { field: 'previousSemesterUnitsApproved', before: 18, after: 21 }]);
  assert.equal(revision.before.previousSemesterGrade, 3);
});
test('offered, accepted and cancelled transfers identify both professors, including legacy cancellation audits', () => {
  const names = new Map([[professor._id, 'Previous Professor'], [id(9), 'Receiving Professor']]);
  for (const [action, reason, expected] of [['transfer_requested', 'request', 'offered'], ['provider_transferred', 'accept', 'accepted'], ['transfer_cancelled', 'cancel', 'cancelled'], ['transfer_requested', 'cancel', 'cancelled']]) {
    const event = controller.revisionEvent({ ...revision, action, reason,
      before: { ...revision.before, pendingProvider: id(9) }, after: { ...revision.after, provider: action === 'provider_transferred' ? id(9) : professor._id, pendingProvider: id(9) } }, names);
    assert.equal(event.action, expected); assert.equal(event.details.previousProfessor.fullName, 'Previous Professor');
    assert.equal(event.details.receivingProfessor.fullName, 'Receiving Professor'); assert.equal(event.semester, 2);
  }
});
test('older forecast events preserve recorded metrics without inventing missing periods or academic versions', () => {
  const event = controller.legacyForecastEvent({ _id: id(6), student, createdAt: time, forecast: { predictedNextSemesterGrade: 2.5, gradeMaximum: 5, dropoutProbability: 0, riskLevel: 'low' } });
  assert.equal(event.details.dropoutProbability, 0); assert.equal(event.details.academicVersion, undefined);
  assert.equal(event.academicYear, undefined); assert.equal(event.details.legacy, true);
});
test('history validates filters and uses inclusive user-facing dates at UTC+8', () => {
  const result = controller.filtersFor({ from: '2026-11-11', to: '2026-11-11', semester: '2', academicYear: '2025-2026', search: 'Chee.*' });
  assert.equal(result.from.toISOString(), '2026-11-10T16:00:00.000Z'); assert.equal(result.to.toISOString(), '2026-11-11T16:00:00.000Z');
  assert.equal(result.regex.test('Chee abc'), false); assert.equal(result.regex.test('Chee.*'), true);
  for (const invalid of [{ from: '2026-02-31' }, { from: '2026-99-99' }, { from: '2026-11-12', to: '2026-11-11' }, { type: 'private' }, { semester: 3 }, { pageSize: 100 }, { cursor: 'invalid' }]) {
    assert.throws(() => controller.filtersFor(invalid), error => error.status === 400);
  }
});
test('cursor pagination remains deterministic when different sources have identical timestamps', () => {
  const input = ['batch', 'forecast', 'history', 'revision'].map(source => ({ id: `${source}:${id(7)}`, occurredAt: time }));
  const page = controller.mergePage(input, 2);
  assert.deepEqual(page.events.map(event => event.id.split(':')[0]), ['revision', 'history']);
  const { cursor } = controller.filtersFor({ cursor: page.nextCursor });
  assert.equal(cursor.source, 'history');
  assert.equal(controller.cursorFilter('forecast', 'createdAt', cursor).$or.length, 2);
  assert.equal(controller.cursorFilter('revision', 'createdAt', cursor).$or.length, 1);
  assert.equal(String(controller.cursorFilter('history', 'occurredAt', cursor).$or[1]._id.$lt), id(7));
});

function historyFixtures({ connected = true, events = [], revisions = [revision], batches = [batch], activities = [], deletions = [] } = {}) {
  const calls = [];
  stub(Deletion, 'find', filter => { calls.push(['deletions', filter]); return query(deletions.filter(item => item.professor === filter.professor && item.institutionKey === filter.institutionKey)); });
  stub(Connection, 'find', filter => { calls.push(['connections', filter]); return query(connected ? [{ _id: id(5), student, createdAt: new Date('2026-01-01') }] : []); });
  stub(User, 'find', filter => query(filter._id ? [{ _id: professor._id, fullName: professor.fullName }] : [{ _id: student._id }]));
  for (const [name, model, rows] of [['batch', Batch, batches], ['revision', Revision, revisions], ['history', Event, events], ['forecast', Activity, activities]]) {
    const visibleRows = filter => {
      const excluded = part => [...(part._id?.$nin || []), ...(part.$and || []).flatMap(excluded)];
      const hidden = excluded(filter);
      return rows.filter(row => !hidden.includes(String(row._id)));
    };
    stub(model, 'find', filter => { calls.push([name, filter]); return query(visibleRows(filter)); });
    stub(model, 'countDocuments', async filter => { calls.push([name + '-count', filter]); return visibleRows(filter).length; });
  }
  return calls;
}
test('history scopes every source to the signed-in professor and institution, ignoring a forged professor parameter', async () => {
  const calls = historyFixtures();
  const res = await invoke(controller.getProfessorHistory, { user: professor, query: { professor: id(99) } });
  assert.ifError(res.error); assert.ok(res.body.events.length);
  for (const [name, filter] of calls.filter(([name]) => !name.startsWith('forecast'))) {
    const text = JSON.stringify(filter); assert.ok(text.includes(professor._id), name);
    assert.ok(!text.includes(id(99)), name); if (name !== 'connections') assert.match(text, /school a/);
  }
});
test('non-professors are denied before any history query', async () => {
  stub(Connection, 'find', () => { throw new Error('Do not query student history'); });
  const res = await invoke(controller.getProfessorHistory, { user: student, query: {} }); assert.equal(res.error.status, 403);
});
test('disconnection retains own event metadata but restricts academic values and forecasts', async () => {
  historyFixtures({ connected: false, events: [{ _id: id(12), category: 'forecast', action: 'generated', occurredAt: time, actor: history.person(student), student: history.person(student), details: { predictedGrade: 2.5 } }] });
  const res = await invoke(controller.getProfessorHistory, { user: professor, query: {} }); assert.ifError(res.error);
  for (const event of res.body.events.filter(event => ['forecast', 'academic_correction'].includes(event.category))) {
    assert.equal(event.detailsRestricted, true); assert.deepEqual(event.details, {}); assert.equal(event.student.fullName, student.fullName);
  }
});
test('category filtering only fetches that event source and batch-ID searches include correction references', async () => {
  const calls = historyFixtures();
  const res = await invoke(controller.getProfessorHistory, { user: professor, query: { type: 'csv_import', search: id(3) } });
  assert.ifError(res.error); assert.ok(res.body.events.every(event => event.category === 'csv_import'));
  assert.equal(calls.some(([name]) => ['revision', 'history', 'forecast'].includes(name)), false);
  assert.match(JSON.stringify(calls.find(([name]) => name === 'revision-count')[1]), /importBatch/);
});

test('professor deletion scopes all four sources and only writes a personal timeline deletion', async () => {
  historyFixtures();
  const writes = [];
  stub(Deletion, 'updateOne', async (filter, update, options) => { writes.push(filter); assert.deepEqual(update.$setOnInsert, filter); assert.equal(options.upsert, true); });
  for (const [source, model] of [['batch', Batch], ['revision', Revision], ['history', Event], ['forecast', Activity]]) {
    stub(model, 'exists', async filter => {
      const scope = JSON.stringify(filter);
      assert.match(scope, new RegExp(id(7)));
      if (source === 'forecast') { assert.match(scope, new RegExp(student._id)); assert.match(scope, /professorHistoryRecorded|forecast_run/); }
      else { assert.match(scope, new RegExp(professor._id)); assert.match(scope, /school a/); }
      if (source === 'revision') assert.match(scope, /corrected|transfer_requested/);
      if (source === 'batch') assert.match(scope, /committed/);
      return { _id: id(7) };
    });
    stub(model, 'deleteOne', () => { throw new Error('Source records must be retained'); });
    stub(model, 'findOneAndDelete', () => { throw new Error('Source records must be retained'); });
    const res = await invoke(controller.deleteProfessorHistoryEntry, { user: professor, params: { eventId: `${source}:${id(7)}` } });
    assert.ifError(res.error); assert.equal(res.body.message, 'History entry deleted.');
    assert.deepEqual(writes.at(-1), { professor: professor._id, institutionKey: 'school a', eventId: `${source}:${id(7)}` });
  }
  assert.equal(writes.length, 4);
});

test('deletion rejects students, malformed identifiers, and entries outside the professor audience', async () => {
  historyFixtures();
  stub(Deletion, 'updateOne', () => { throw new Error('Unauthorized deletion'); });
  let res = await invoke(controller.deleteProfessorHistoryEntry, { user: student, params: { eventId: `batch:${id(3)}` } });
  assert.equal(res.error.status, 403);
  for (const eventId of ['invalid', `user:${id(3)}`, 'batch:123', `batch:${id(3)}:extra`]) {
    res = await invoke(controller.deleteProfessorHistoryEntry, { user: professor, params: { eventId } });
    assert.equal(res.error.status, 400);
  }
  for (const [source, model] of [['batch', Batch], ['revision', Revision], ['history', Event], ['forecast', Activity]]) {
    stub(model, 'exists', async () => null);
    res = await invoke(controller.deleteProfessorHistoryEntry, { user: professor, params: { eventId: `${source}:${id(99)}` } });
    assert.equal(res.error.status, 404);
  }
});

test('deleted entries stay out of source queries, counts, and pagination while other professors keep them', async () => {
  const deletions = ['batch', 'revision', 'history', 'forecast'].map((source, i) => ({ professor: professor._id, institutionKey: 'school a', eventId: `${source}:${id(i + 3)}` }));
  const fixtures = { deletions, batches: [{ ...batch, _id: id(3) }], revisions: [{ ...revision, _id: id(4) }],
    events: [{ _id: id(5), category: 'connection', action: 'accepted', occurredAt: time, actor: history.person(professor), student: history.person(student), details: {} }],
    activities: [{ _id: id(6), student, createdAt: time, forecast: {} }] };
  historyFixtures(fixtures);
  for (const query of [{}, { type: 'forecast' }, { pageSize: 1 }]) {
    const res = await invoke(controller.getProfessorHistory, { user: professor, query });
    assert.ifError(res.error); assert.deepEqual(res.body.events, []); assert.equal(res.body.total, 0); assert.equal(res.body.nextCursor, null);
    assert.ok(Object.values(res.body.counts).every(count => count === 0));
  }
  const res = await invoke(controller.getProfessorHistory, { user: { ...professor, _id: id(99) }, query: {} });
  assert.ifError(res.error); assert.equal(res.body.events.length, 4);
  assert.equal(fixtures.batches.length, 1); assert.equal(fixtures.revisions.length, 1); assert.equal(fixtures.activities.length, 1);
});

function forecastFixtures({ stale = false, providerConnected = true } = {}) {
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  stub(mongoose, 'startSession', async () => session);
  stub(User, 'findOneAndUpdate', async () => student);
  stub(Academic, 'findOneAndUpdate', async () => stale ? null : { provider: professor._id });
  stub(Profile, 'findOneAndUpdate', async () => ({}));
  stub(Connection, 'find', () => query(providerConnected ? [{ _id: id(5), professor }] : []));
  stub(Connection, 'findOneAndUpdate', async () => ({}));
  const writes = [];
  stub(Activity, 'create', async (rows, options) => { assert.equal(options.session, session); writes.push(['activity', rows[0]]); return [{ ...rows[0], createdAt: time }]; });
  stub(Event, 'create', async (rows, options) => { assert.equal(options.session, session); writes.push(['event', rows[0]]); return rows; });
  return { writes, session };
}
const workspace = { profile: { profileVersion: 1 }, inputVersion: 'input-version', record: { academicRecordId: id(8), academicVersion: 2, academicYear: '2025-2026', semester: 2 } };
test('forecast and durable professor snapshot are saved together with exact source version and audience', async () => {
  const fixture = forecastFixtures();
  const metrics = { predictedNextSemesterGrade: 2.25, gradeMaximum: 5, dropoutProbability: 0.35, riskLevel: 'medium' };
  const activity = await history.saveForecastActivity(student, workspace, metrics);
  assert.equal(fixture.writes.length, 2); assert.equal(activity.professorHistoryRecorded, true);
  const event = fixture.writes[1][1]; assert.deepEqual(event.professors, [professor._id]);
  assert.equal(event.details.academicVersion, 2); assert.equal(event.details.dropoutProbability, 0.35);
  assert.equal(event.academicYear, '2025-2026'); assert.equal(event.student.fullName, student.fullName);
});
test('stale inputs and a missing provider connection stop history and forecast persistence', async () => {
  for (const options of [{ stale: true }, { providerConnected: false }]) {
    const fixture = forecastFixtures(options);
    await assert.rejects(history.saveForecastActivity(student, workspace, {}), error => error.status === 409);
    assert.equal(fixture.writes.length, 0);
  }
});
test('student activity deletion cannot delete the separate professor forecast snapshot', async () => {
  const fixture = forecastFixtures(); const activity = await history.saveForecastActivity(student, workspace, {});
  stub(Activity, 'findOneAndDelete', async filter => { assert.equal(filter.student, student._id); assert.equal(filter._id, String(activity._id)); return activity; });
  stub(Event, 'deleteOne', () => { throw new Error('Students must not delete professor history'); });
  const res = await invoke(require('../src/controllers/studentRecordController').deleteMyHistoryEntry, { user: student, params: { activityId: String(activity._id) } });
  assert.ifError(res.error); assert.equal(res.code, 200);
  assert.equal(fixture.writes[1][1].eventKey, `forecast:${activity._id}`);
});

function connectionFixtures(status = 'pending') {
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  stub(mongoose, 'startSession', async () => session);
  const connection = { _id: id(5), professor: professor._id, student: student._id, status, createdAt: time,
    async save(options) { assert.equal(options.session, session); }, toObject() { return { _id: this._id, status: this.status, createdAt: time }; } };
  stub(Connection, 'findOne', () => query(connection)); stub(Connection, 'findOneAndDelete', () => query(connection));
  stub(User, 'findOneAndUpdate', async filter => String(filter._id) === professor._id ? professor : student);
  stub(Conversation, 'updateMany', async (filter, update, options) => { assert.equal(options.session, session); });
  let event;
  stub(Event, 'create', async (rows, options) => { assert.equal(options.session, session); event = rows[0]; return rows; });
  return { connection, getEvent: () => event };
}
test('accepting and declining requests persist acting professor and student metadata', async () => {
  for (const action of ['accept', 'decline']) {
    const fixture = connectionFixtures();
    const res = await invoke(connectionsController.respondToConnection, { user: professor, params: { id: id(5) }, body: { action } });
    assert.ifError(res.error); assert.equal(fixture.getEvent().action, action === 'accept' ? 'accepted' : 'declined');
    assert.equal(fixture.getEvent().actor.id, professor._id); assert.equal(fixture.getEvent().student.id, student._id);
    assert.equal(fixture.getEvent().details.previousStatus, 'pending');
  }
});
test('student-initiated removal records the student actor and preserves a professor event', async () => {
  const fixture = connectionFixtures('accepted');
  const res = await invoke(connectionsController.removeConnection, { user: student, params: { id: id(5) } });
  assert.ifError(res.error); assert.equal(fixture.getEvent().action, 'removed');
  assert.equal(fixture.getEvent().actor.id, student._id); assert.deepEqual(fixture.getEvent().professors, [professor._id]);
});
test('already handled requests do not produce duplicate connection audit events', async () => {
  const fixture = connectionFixtures('accepted');
  const res = await invoke(connectionsController.respondToConnection, { user: professor, params: { id: id(5) }, body: { action: 'accept' } });
  assert.equal(res.error.status, 409); assert.equal(fixture.getEvent(), undefined);
});
