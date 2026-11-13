const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { sendEmail, isConfigured } = require('../src/utils/mailjet');
const envKeys = ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAILJET_SENDER_EMAIL'];
let originalEnv;
let originalPost;
let calls;
const email = { to: { email: 'student@example.test', fullName: 'Student Test' }, subject: 'Verify your email',
  html: '<a href="https://retainify.example.test/verify-email/one-time-token">Verify</a>', text: 'https://retainify.example.test/verify-email/one-time-token' };
beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { MAILJET_API_KEY: 'public-test-key', MAILJET_SECRET_KEY: 'private-test-key', MAILJET_SENDER_EMAIL: 'support@example.test' });
  calls = []; originalPost = axios.post;
  axios.post = async (...args) => { calls.push(args); return { data: { Messages: [{ Status: 'success', To: [{ MessageID: 123 }] }] } }; };
});
afterEach(() => {
  axios.post = originalPost;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('HTTPS delivery uses Basic authentication and disables tracking while preserving the direct URL', async () => {
  const result = await sendEmail(email);
  const [url, payload, options] = calls[0];
  assert.equal(url, 'https://api.mailjet.com/v3.1/send');
  assert.deepEqual(options.auth, { username: 'public-test-key', password: 'private-test-key' });
  assert.equal(options.timeout, 15000); assert.equal(options.maxRedirects, 0);
  assert.equal(payload.Messages.length, 1);
  assert.deepEqual(payload.Messages[0].From, { Email: 'support@example.test', Name: 'Retainify' });
  assert.deepEqual(payload.Messages[0].To, [{ Email: email.to.email, Name: email.to.fullName }]);
  assert.equal(payload.Messages[0].HTMLPart, email.html);
  assert.equal(payload.Messages[0].TextPart, email.text);
  assert.equal(payload.Messages[0].TrackClicks, 'disabled');
  assert.equal(payload.Messages[0].TrackOpens, 'disabled');
  assert.equal(payload.SandboxMode, undefined);
  assert.equal(result.To[0].MessageID, 123);
});

test('configuration and invalid recipient failures make no external request', async () => {
  delete process.env.MAILJET_SECRET_KEY;
  assert.equal(isConfigured(), false);
  await assert.rejects(sendEmail(email), /Missing: MAILJET_SECRET_KEY/);
  process.env.MAILJET_SECRET_KEY = 'private-test-key';
  process.env.MAILJET_SENDER_EMAIL = 'invalid';
  assert.equal(isConfigured(), false);
  await assert.rejects(sendEmail(email), /verified sender/);
  process.env.MAILJET_SENDER_EMAIL = 'support@example.test';
  await assert.rejects(sendEmail({ ...email, to: { email: '' } }), /valid email recipient/);
  assert.equal(calls.length, 0);
});

test('HTTP success with a rejected or malformed message is still a delivery failure', async () => {
  axios.post = async () => ({ data: { Messages: [{ Status: 'error', Errors: [{ StatusCode: 403, ErrorCode: 'send-0008' }] }] } });
  await assert.rejects(sendEmail(email), error => error.providerStatus === 403 && error.code === 'send-0008');
  for (const data of [{}, { Messages: [] }, { Messages: [{}] }]) {
    axios.post = async () => ({ data });
    await assert.rejects(sendEmail(email), /could not accept/);
  }
});

test('network and credential errors never expose Axios credentials or token links', async () => {
  for (const status of [401, 429, 500, undefined]) {
    axios.post = async () => { throw Object.assign(new Error('private-test-key'), {
      config: { auth: { password: 'private-test-key' }, data: email },
      response: status ? { status, data: { ErrorCode: 'mj-0015' } } : undefined,
      code: 'ECONNABORTED',
    }); };
    await assert.rejects(sendEmail(email), error => {
      assert.equal(error.providerStatus, status || 502);
      assert.doesNotMatch(`${String(error)}${JSON.stringify(error)}`, /private-test-key|one-time-token|student@example/);
      return true;
    });
  }
});

test('sandbox checks preserve the delivery payload and explicitly prevent sending', async () => {
  await sendEmail(email, { sandbox: true });
  assert.equal(calls[0][1].SandboxMode, true);
  assert.equal(calls[0][1].Messages[0].TrackClicks, 'disabled');
});
