const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { sendRiskAlertEmail, isRiskAlertLevel } = require('../src/utils/riskAlertEmail');

const student = { fullName: 'Student <Test> & Family', email: 'student@example.test' };
const forecast = {
  riskLevel: 'high', dropoutProbability: 0.7264,
  predictedNextSemesterGrade: 3.4, gradeMaximum: 5, completionRate: 0.625,
};
const envKeys = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'PUBLIC_APP_URL', 'CLIENT_ORIGIN'];
let originalEnv;
let originalPost;
let deliveries;

beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  originalPost = axios.post;
  deliveries = [];
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_SENDER_EMAIL = 'support@example.test';
  process.env.PUBLIC_APP_URL = 'https://students.example.test/';
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
