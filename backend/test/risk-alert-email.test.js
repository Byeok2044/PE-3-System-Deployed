const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const sharp = require('sharp');
const { trajectoryData, readTrajectoryToken } = require('../src/utils/emailTrajectory');
const { sendRiskAlertEmail, isRiskAlertLevel } = require('../src/utils/riskAlertEmail');

const student = { fullName: 'Student <Test> & Family', email: 'student@example.test' };
const forecast = {
  riskLevel: 'high', dropoutProbability: 0.7264,
  predictedNextSemesterGrade: 3.4, gradeMaximum: 5, completionRate: 0.625,
};
const envKeys = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'PUBLIC_APP_URL', 'CLIENT_ORIGIN', 'PUBLIC_API_URL', 'JWT_SECRET'];
let originalEnv;
let originalPost;
let deliveries;

beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  originalPost = axios.post;
  deliveries = [];
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_SENDER_EMAIL = 'support@example.test';
  process.env.BREVO_SENDER_NAME = 'EduForecaster';
  process.env.PUBLIC_APP_URL = 'https://students.example.test/';
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  process.env.JWT_SECRET = 'test-email-trajectory-key';
  axios.post = async (...args) => { deliveries.push(args); };
});

afterEach(() => {
  axios.post = originalPost;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('high-risk delivery includes the forecast, correct scale guidance and a direct Insights link', async () => {
  await sendRiskAlertEmail({ student, forecast });
  assert.equal(deliveries.length, 1);
  const [endpoint, payload] = deliveries[0];
  assert.equal(endpoint, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(payload.sender.name, 'Retainify');
  assert.deepEqual(payload.to, [{ email: student.email, name: student.fullName }]);
  const html = payload.htmlContent;
  assert.match(html, /Your forecast summary/);
  assert.match(html, /<strong>High<\/strong>/);
  assert.match(html, /73%/);
  assert.match(html, /3\.40 \/ 5/);
  assert.match(html, /63%/);
  assert.match(html, /lower numbers are better/);
  assert.match(html, /forecast that triggered this email/);
  assert.match(html, /href="https:\/\/students\.example\.test\/dashboard\/insights"/);
  assert.match(html, /Student &lt;Test&gt; &amp; Family/);
  assert.doesNotMatch(html, /Student <Test>/);
});

test('medium-risk delivery supports higher-is-better scales and zero completion', async () => {
  await sendRiskAlertEmail({ student, forecast: {
    ...forecast, riskLevel: 'medium', dropoutProbability: 0.25,
    predictedNextSemesterGrade: 0, gradeMaximum: 100, completionRate: 0,
  } });
  const html = deliveries[0][1].htmlContent;
  assert.match(html, /<strong>Medium<\/strong>/);
  assert.match(html, /25%/);
  assert.match(html, /0\.00 \/ 100/);
  assert.match(html, /<td>0%<\/td>/);
  assert.match(html, /higher numbers indicate better results/);
  assert.equal(isRiskAlertLevel('medium'), true);
  assert.equal(isRiskAlertLevel('high'), true);
  assert.equal(isRiskAlertLevel('low'), false);
});

test('button falls back to the first client origin and clears query strings and fragments', async () => {
  delete process.env.PUBLIC_APP_URL;
  process.env.CLIENT_ORIGIN = ' https://students.example.test/portal/?old=1#home,https://other.example.test';
  await sendRiskAlertEmail({ student, forecast });
  const html = deliveries[0][1].htmlContent;
  assert.match(html, /href="https:\/\/students\.example\.test\/portal\/dashboard\/insights"/);
  assert.doesNotMatch(html, /old=1|#home|other\.example/);
});

test('missing forecast metrics are labelled unavailable rather than shown as zero or NaN', async () => {
  await sendRiskAlertEmail({ student, forecast: { riskLevel: 'high' } });
  const html = deliveries[0][1].htmlContent;
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /NaN|undefined|<td>0%<\/td>/);
});

test('unsafe application URL fails before contacting the email provider', async () => {
  process.env.PUBLIC_APP_URL = 'javascript:alert(1)';
  await assert.rejects(sendRiskAlertEmail({ student, forecast }), /Invalid public application URL/);
  assert.equal(deliveries.length, 0);
});

test('professor delivery identifies the student and links to the professor trajectory dashboard', async () => {
  const professor = { fullName: 'Professor <Test>', email: 'professor@example.test' };
  await sendRiskAlertEmail({ student, forecast, professor });
  const payload = deliveries[0][1];
  assert.deepEqual(payload.to, [{ email: professor.email, name: professor.fullName }]);
  assert.match(payload.subject, /Student support check-in: Student .*High support risk/);
  assert.match(payload.htmlContent, /Hello Professor Professor &lt;Test&gt;/);
  assert.match(payload.htmlContent, /Your connected student <strong>Student &lt;Test&gt; &amp; Family/);
  assert.match(payload.htmlContent, /Student forecast summary/);
  assert.match(payload.htmlContent, /3\.40 \/ 5/);
  assert.match(payload.htmlContent, /lower numbers are better/);
  assert.match(payload.htmlContent, /href="https:\/\/students\.example\.test\/dashboard"/);
  assert.match(payload.htmlContent, /View Trajectory/);
  assert.doesNotMatch(payload.htmlContent, /dashboard\/insights|student account|SHAP/);
});

test('student email contains a private snapshot image and a valid PNG attachment matching the professor chart', async () => {
  await sendRiskAlertEmail({ student, forecast, record: { previousSemesterGrade: 2.25, gradeMaximum: 5 } });
  const payload = deliveries[0][1];
  assert.match(payload.htmlContent, /Academic trajectory/);
  assert.match(payload.htmlContent, /Current Term: <strong>2.25/);
  assert.match(payload.htmlContent, /Next Term \(ML\): <strong>3.40/);
  const token = payload.htmlContent.match(/trajectory\/([A-Za-z0-9_-]+)\.png/)[1];
  const disclosure = payload.htmlContent.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(disclosure, 'The graph stays inside the email disclosure');
  assert.doesNotMatch(disclosure[1], /\bopen\b/);
  assert.match(disclosure[2], /<summary[^>]*>Review my forecast<\/summary>[\s\S]*<img src="https:\/\/api.example.test\/api\/email-assets\/trajectory\//);
  assert.doesNotMatch(payload.htmlContent, /<a[^>]*>Review my forecast<\/a>|<script|onclick=|display:\s*none|opens the trajectory graph from this email at full size/);
  assert.match(payload.htmlContent, /Some email apps show the graph directly instead/);
  const data = readTrajectoryToken(token);
  assert.equal(data.currentGrade, 2.25);
  assert.equal(data.predictedGrade, 3.4);
  assert.equal(data.cutoff, 3);
  assert.equal(data.reversed, true);
  const png = Buffer.from(payload.attachment[0].content, 'base64');
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1120);
  assert.equal(payload.attachment[0].name, 'academic-trajectory.png');
  assert.throws(() => readTrajectoryToken(`${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`));
  assert.throws(() => readTrajectoryToken('invalid'));
});

test('email trajectory preserves all supported scale cutoffs, direction, and grade colors', () => {
  for (const [maximum, current, predicted, cutoff, reversed] of [[4, 1, 3, 2, false], [5, 4, 2, 3, true], [20, 8, 12, 10, false], [100, 70, 80, 75, false]]) {
    const data = trajectoryData({ previousSemesterGrade: current, gradeMaximum: maximum }, { predictedNextSemesterGrade: predicted });
    assert.equal(data.cutoff, cutoff); assert.equal(data.reversed, reversed); assert.equal(data.color, '#d55752');
  }
  assert.equal(trajectoryData({}, forecast), null);
  assert.equal(trajectoryData({ previousSemesterGrade: 3, gradeMaximum: 5 }, { predictedNextSemesterGrade: 0 }), null);
});
