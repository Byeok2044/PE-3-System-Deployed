const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const sharp = require('sharp');
const { trajectoryData, trajectoryUrl, readTrajectoryToken } = require('../src/utils/emailTrajectory');
const { sendRiskAlertEmail, isRiskAlertLevel } = require('../src/utils/riskAlertEmail');

const student = { fullName: 'Student <Test> & Family', email: 'student@example.test' };
const forecast = {
  riskLevel: 'high', dropoutProbability: 0.7264,
  predictedNextSemesterGrade: 3.4, gradeMaximum: 5, completionRate: 0.625,
};
const envKeys = ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAILJET_SENDER_EMAIL', 'PUBLIC_APP_URL', 'CLIENT_ORIGIN', 'PUBLIC_API_URL', 'JWT_SECRET'];
let originalEnv;
let originalPost;
let deliveries;

beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  originalPost = axios.post;
  deliveries = [];
  process.env.MAILJET_API_KEY = 'test-key';
  process.env.MAILJET_SECRET_KEY = 'test-secret';
  process.env.MAILJET_SENDER_EMAIL = 'support@example.test';
  process.env.PUBLIC_APP_URL = 'https://students.example.test/';
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  process.env.JWT_SECRET = 'test-email-trajectory-key';
  axios.post = async (url, payload, options) => { deliveries.push([url, payload.Messages[0], options]); return { data: { Messages: [{ Status: 'success' }] } }; };
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
  assert.equal(endpoint, 'https://api.mailjet.com/v3.1/send');
  assert.equal(payload.From.Name, 'Retainify');
  assert.deepEqual(payload.To, [{ Email: student.email, Name: student.fullName }]);
  const html = payload.HTMLPart;
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
  const html = deliveries[0][1].HTMLPart;
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
  const html = deliveries[0][1].HTMLPart;
  assert.match(html, /href="https:\/\/students\.example\.test\/portal\/dashboard\/insights"/);
  assert.doesNotMatch(html, /old=1|#home|other\.example/);
});

test('missing forecast metrics are labelled unavailable rather than shown as zero or NaN', async () => {
  await sendRiskAlertEmail({ student, forecast: { riskLevel: 'high' } });
  const html = deliveries[0][1].HTMLPart;
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
  assert.deepEqual(payload.To, [{ Email: professor.email, Name: professor.fullName }]);
  assert.match(payload.Subject, /Student support check-in: Student .*High support risk/);
  assert.match(payload.HTMLPart, /Hello Professor Professor &lt;Test&gt;/);
  assert.match(payload.HTMLPart, /Your connected student <strong>Student &lt;Test&gt; &amp; Family/);
  assert.match(payload.HTMLPart, /Student forecast summary/);
  assert.match(payload.HTMLPart, /3\.40 \/ 5/);
  assert.match(payload.HTMLPart, /lower numbers are better/);
  assert.match(payload.HTMLPart, /href="https:\/\/students\.example\.test\/dashboard"/);
  assert.match(payload.HTMLPart, /View Trajectory/);
  assert.doesNotMatch(payload.HTMLPart, /dashboard\/insights|student account|SHAP/);
});

test('student email embeds the trajectory PNG and includes a downloadable copy matching the professor chart', async () => {
  await sendRiskAlertEmail({ student, forecast, record: { previousSemesterGrade: 2.25, gradeMaximum: 5 } });
  const payload = deliveries[0][1];
  assert.match(payload.HTMLPart, /Academic trajectory/);
  assert.match(payload.HTMLPart, /Current Term: <strong>2.25/);
  assert.match(payload.HTMLPart, /Next Term \(ML\): <strong>3.40/);
  assert.match(payload.HTMLPart, /<img src="cid:academic-trajectory"/);
  assert.doesNotMatch(payload.HTMLPart, /Review my forecast|<details\b|<summary\b|<script|onclick=|display:\s*none|expand the graph/);
  assert.equal(payload.InlinedAttachments[0].ContentID, 'academic-trajectory');
  assert.equal(payload.InlinedAttachments[0].Base64Content, payload.Attachments[0].Base64Content);
  assert.equal(payload.InlinedAttachments[0].ContentType, 'image/png');
  assert.equal(payload.TrackClicks, 'disabled');
  assert.equal(payload.TrackOpens, 'disabled');
  const png = Buffer.from(payload.Attachments[0].Base64Content, 'base64');
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1120);
  assert.equal(payload.Attachments[0].Filename, 'academic-trajectory.png');
});

test('image links in previously sent emails still accept encrypted snapshots and reject tampering', () => {
  const data = trajectoryData({ previousSemesterGrade: 2.25, gradeMaximum: 5 }, forecast);
  const token = trajectoryUrl(data).match(/trajectory\/([A-Za-z0-9_-]+)\.png/)[1];
  assert.deepEqual(readTrajectoryToken(token), data);
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
