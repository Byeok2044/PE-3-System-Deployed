const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const StudentActivity = require('../src/models/StudentActivity');
const Connection = require('../src/models/StudentProfessorConnection');
const { sendRiskAlerts } = require('../src/utils/riskAlertNotifications');

const student = {
  _id: 'student', fullName: 'Student Test', email: 'student@example.test',
  role: 'student', emailVerified: true, institution: 'School A',
};
const professor = (id, overrides = {}) => ({
  _id: id, fullName: `Professor ${id}`, email: `${id}@example.test`,
  role: 'professor', emailVerified: true, institution: ' school a ', ...overrides,
});
const forecast = {
  riskLevel: 'medium', dropoutProbability: 0.3,
  predictedNextSemesterGrade: 12, gradeMaximum: 20, completionRate: 0.8,
};
const restores = [];
function stub(object, key, value) {
  const original = object[key]; object[key] = value;
  restores.push(() => { object[key] = original; });
}
let connections;
let activities;
let deliveries;
let errors;
let queries;

beforeEach(() => {
  connections = ['professor1', 'professor2'].map((id) => ({ status: 'accepted', professor: professor(id) }));
  activities = []; deliveries = []; errors = []; queries = [];
  for (const [key, value] of Object.entries({
    MAILJET_API_KEY: 'test-key', MAILJET_SECRET_KEY: 'test-secret', MAILJET_SENDER_EMAIL: 'support@example.test',
    PUBLIC_APP_URL: 'https://students.example.test', RISK_ALERT_COOLDOWN_HOURS: '168',
    PUBLIC_API_URL: 'https://api.example.test', JWT_SECRET: 'test-risk-alert-key',
  })) {
    const original = process.env[key]; process.env[key] = value;
    restores.push(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
  stub(console, 'error', (...args) => { errors.push(args); });
  stub(axios, 'post', async (url, payload) => { deliveries.push(payload.Messages[0]); return { data: { Messages: [{ Status: 'success' }] } }; });
  stub(Connection, 'find', (filter) => {
    assert.deepEqual(filter, { student: student._id, status: 'accepted' });
    return { populate: async (path, fields) => {
      assert.equal(path, 'professor');
      assert.match(fields, /emailVerified/);
      return connections.filter((item) => item.status === filter.status);
    } };
  });
  stub(StudentActivity, 'exists', async (query) => {
    queries.push(query);
    return activities.some((activity) => activity.type === query.type
      && activity.student === query.student
      && activity.alert?.riskLevel === query['alert.riskLevel']
      && activity.createdAt >= query.createdAt.$gte
      && (query['alert.recipientRole'] === 'professor'
        ? activity.alert.recipientRole === 'professor' && activity.alert.recipientId === query['alert.recipientId']
        : activity.alert.recipientRole !== 'professor'));
  });
  stub(StudentActivity, 'create', async (activity) => {
    const saved = { ...activity, createdAt: new Date() }; activities.push(saved); return saved;
  });
});
afterEach(() => { while (restores.length) restores.pop()(); });

test('medium and high risk notify the student and each accepted professor separately', async () => {
  for (const riskLevel of ['medium', 'high']) {
    await sendRiskAlerts(student, { ...forecast, riskLevel });
  }
  assert.equal(deliveries.length, 6);
  for (const email of ['student@example.test', 'professor1@example.test', 'professor2@example.test']) {
    assert.equal(deliveries.filter((payload) => payload.To[0].Email === email).length, 2);
  }
  assert.ok(deliveries.every((payload) => payload.To.length === 1 && !payload.Cc && !payload.Bcc));
  assert.ok(deliveries.every((payload) => payload.TrackClicks === 'disabled' && payload.TrackOpens === 'disabled'));
  assert.equal(activities.filter((activity) => activity.alert.recipientRole === 'professor').length, 4);
  assert.equal(errors.length, 0);
});

test('low risk never looks up recipients or sends alerts', async () => {
  stub(Connection, 'find', () => { throw new Error('Must not look up connections'); });
  await sendRiskAlerts(student, { ...forecast, riskLevel: 'low' });
  assert.equal(deliveries.length, 0);
  assert.equal(queries.length, 0);
  assert.equal(errors.length, 0);
});

test('Mailjet message rejection never starts a cooldown and can be retried on a later forecast', async () => {
  stub(axios, 'post', async () => ({ data: { Messages: [{ Status: 'error', Errors: [{ StatusCode: 429, ErrorCode: 'rate-limit' }] }] } }));
  await sendRiskAlerts(student, forecast);
  assert.equal(activities.length, 0);
  assert.equal(errors.length, 3);
  stub(axios, 'post', async (_url, payload) => {
    deliveries.push(payload.Messages[0]);
    return { data: { Messages: [{ Status: 'success' }] } };
  });
  await sendRiskAlerts(student, forecast);
  assert.equal(deliveries.length, 3);
  assert.equal(activities.length, 3);
});

test('only verified professors with accepted same-institution connections receive alerts', async () => {
  connections.push(
    { status: 'pending', professor: professor('pending') },
    { status: 'declined', professor: professor('declined') },
    { status: 'accepted', professor: professor('other-school', { institution: 'School B' }) },
    { status: 'accepted', professor: professor('missing-school', { institution: '' }) },
    { status: 'accepted', professor: professor('unverified', { emailVerified: false }) },
    { status: 'accepted', professor: professor('no-email', { email: '' }) },
    { status: 'accepted', professor: professor('wrong-role', { role: 'student' }) },
    { status: 'accepted', professor: null },
    connections[0],
  );
  await sendRiskAlerts(student, forecast);
  assert.deepEqual(deliveries.map((payload) => payload.To[0].Email).sort(), [
    'professor1@example.test', 'professor2@example.test', 'student@example.test',
  ]);
});

test('legacy student cooldown and individual professor cooldown do not suppress a new professor', async () => {
  activities.push(
    { student: student._id, type: 'risk_alert_sent', createdAt: new Date(), alert: { riskLevel: 'medium' } },
    { student: student._id, type: 'risk_alert_sent', createdAt: new Date(), alert: {
      riskLevel: 'medium', recipientRole: 'professor', recipientId: 'professor1',
    } },
  );
  await sendRiskAlerts(student, forecast);
  assert.deepEqual(deliveries.map((payload) => payload.To[0].Email), ['professor2@example.test']);
  await sendRiskAlerts(student, forecast);
  assert.equal(deliveries.length, 1);
});

test('professor cooldown does not suppress the student and expired cooldown permits new delivery', async () => {
  activities.push({ student: student._id, type: 'risk_alert_sent', createdAt: new Date(), alert: {
    riskLevel: 'medium', recipientRole: 'professor', recipientId: 'professor1',
  } });
  await sendRiskAlerts(student, forecast);
  assert.deepEqual(deliveries.map((payload) => payload.To[0].Email).sort(), ['professor2@example.test', 'student@example.test']);
  for (const activity of activities) activity.createdAt = new Date(Date.now() - 169 * 60 * 60 * 1000);
  await sendRiskAlerts(student, forecast);
  assert.equal(deliveries.length, 5);
});

for (const failedEmail of ['student@example.test', 'professor1@example.test']) {
  test(`failure for ${failedEmail} does not block other recipients and is retried independently`, async () => {
    let fail = true;
    stub(axios, 'post', async (url, request) => {
      const payload = request.Messages[0];
      if (fail && payload.To[0].Email === failedEmail) throw new Error('Provider unavailable');
      deliveries.push(payload);
      return { data: { Messages: [{ Status: 'success' }] } };
    });
    await sendRiskAlerts(student, forecast);
    assert.equal(deliveries.length, 2);
    assert.equal(activities.length, 2);
    assert.equal(errors.length, 1);
    fail = false;
    await sendRiskAlerts(student, forecast);
    assert.equal(deliveries.length, 3);
    assert.equal(deliveries[2].To[0].Email, failedEmail);
    assert.equal(activities.length, 3);
  });
}

test('professor lookup failure preserves the student email', async () => {
  stub(Connection, 'find', () => { throw new Error('Database lookup failed'); });
  await sendRiskAlerts(student, forecast);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].To[0].Email, student.email);
  assert.equal(errors.length, 1);
});

test('an unverified student is skipped without preventing verified professor notifications', async () => {
  await sendRiskAlerts({ ...student, emailVerified: false }, forecast);
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every((payload) => payload.To[0].Email !== student.email));
});

test('historical semester alerts recheck the selected record and keep its trajectory snapshot', async () => {
  const workspaceService = require('../src/utils/academicWorkspace');
  const User = require('../src/models/User');
  const record = { academicRecordId: 'historical-semester', previousSemesterGrade: 8, gradeMaximum: 20 };
  const reads = [];
  stub(User, 'findById', async id => id === student._id ? student : professor(id));
  stub(Connection, 'exists', async () => true);
  stub(workspaceService, 'loadWorkspace', async (_student, options) => {
    reads.push(options);
    return { inputVersion: options.academicRecordId === record.academicRecordId ? 'historical-version' : 'latest-version' };
  });

  await sendRiskAlerts(student, forecast, { inputVersion: 'historical-version', forecastId: 'forecast', record });

  assert.equal(reads.length, 3);
  assert.ok(reads.every(options => options.academicRecordId === record.academicRecordId && options.includeForecast === false));
  assert.equal(deliveries.length, 3);
  assert.ok(deliveries.every(payload => /Current Term: <strong>8\.00/.test(payload.HTMLPart)));
  assert.ok(deliveries.every(payload => payload.Attachments?.[0].Filename === 'academic-trajectory.png'));
  assert.equal(errors.length, 0);
});

test('prediction route saves the forecast and notifies professors while email failures leave the response successful', async () => {
  const workspaceService = require('../src/utils/academicWorkspace');
  const User = require('../src/models/User');
  stub(User, 'findById', async id => id === student._id ? student : professor(id));
  stub(Connection, 'exists', async () => true);
  stub(workspaceService, 'loadWorkspace', async () => ({ canForecast: true, inputVersion: 'version', profile: { profileVersion: 1 }, record: { attendance: 'day', previousSemesterGrade: 10, academicRecordId: 'academic', academicVersion: 1 } }));
  stub(require('../src/utils/professorHistory'), 'saveForecastActivity', async (user, workspace, result) => StudentActivity.create({ student: user._id, type: 'forecast_run', record: workspace.record, forecast: result }));
  const router = require('../src/routes/mlRoutes');
  const predict = router.stack.find((layer) => layer.route?.path === '/predict').route.stack.at(-1).handle;
  stub(axios, 'post', async (url, request) => {
    if (url.endsWith('/predict')) return { data: forecast };
    const payload = request.Messages[0];
    if (payload.To[0].Email === student.email) throw new Error('Student delivery failed');
    deliveries.push(payload);
    return { data: { Messages: [{ Status: 'success' }] } };
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await predict({ user: student, body: {} }, res, (error) => { throw error; });
  assert.equal(res.code || 200, 200);
  assert.deepEqual(res.body.activity.forecast, forecast);
  assert.equal(activities[0].type, 'forecast_run');
  assert.equal(activities[0].record.attendance, 'day');
  assert.equal(activities[0].record.studySchedule, undefined);
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every((payload) => payload.To[0].Email.startsWith('professor')));
  assert.ok(deliveries.every((payload) => payload.Attachments?.[0].Filename === 'academic-trajectory.png'));
});
