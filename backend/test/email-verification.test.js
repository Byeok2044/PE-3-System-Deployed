const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');
const User = require('../src/models/User');
const auth = require('../src/controllers/authController');
const restores = [];
const accounts = [];
let messages;
function stub(object, key, value) { const old = object[key]; object[key] = value; restores.push(() => { object[key] = old; }); }
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const invoke = async (method, req) => { const res = response(); await auth[method](req, res, error => { throw error; }); return res; };
beforeEach(() => {
  messages = []; accounts.length = 0;
  for (const [key, value] of Object.entries({ BREVO_API_KEY: 'test', BREVO_SENDER_EMAIL: 'support@example.test', PUBLIC_APP_URL: 'https://retainify.example.test', JWT_SECRET: 'test' })) {
    const old = process.env[key]; process.env[key] = value; restores.push(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  stub(axios, 'post', async (url, payload, options) => { messages.push({ url, payload, options }); return { data: { messageId: 'accepted' } }; });
  stub(console, 'error', () => {});
  stub(User, 'create', async fields => {
    const account = { ...fields, _id: 'test-user', emailVerified: false, failedLoginAttempts: 0,
      save: async () => {}, comparePassword: async value => value === fields.password,
      deleteOne: async () => { accounts.splice(accounts.indexOf(account), 1); } };
    accounts.push(account); return account;
  });
  stub(User, 'findOne', query => {
    const account = accounts.find(user => query.email ? user.email === query.email : query.fullName ? query.fullName.test(user.fullName)
      : query.passwordResetToken ? user.passwordResetToken === query.passwordResetToken && user.passwordResetExpires > query.passwordResetExpires.$gt
      : user.emailVerificationToken === query.emailVerificationToken && user.emailVerificationExpires > query.emailVerificationExpires.$gt);
    return { then(resolve, reject) { return Promise.resolve(account).then(resolve, reject); }, select: async () => account };
  });
});
afterEach(() => { while (restores.length) restores.pop()(); });
const registration = { fullName: 'Verification Test', email: 'test@example.test', institution: 'Test School', role: 'student', password: 'test-password' };
const tokenFromEmail = () => messages.at(-1).payload.htmlContent.match(/verify-email\/([a-f0-9]{64})/)[1];

test('registration sends a public verification link, blocks login until verified, then permits login; token cannot be reused', async () => {
  assert.equal((await invoke('register', { body: registration })).code, 201);
  assert.equal(messages.length, 1);
  const token = tokenFromEmail();
  assert.equal(accounts[0].emailVerificationToken, crypto.createHash('sha256').update(token).digest('hex'));
  assert.match(messages[0].payload.htmlContent, /https:\/\/retainify.example.test\/verify-email\//);
  assert.equal(messages[0].options.timeout, 15000);
  assert.equal((await invoke('login', { body: registration })).body.code, 'EMAIL_NOT_VERIFIED');
  assert.equal((await invoke('verifyEmail', { params: { token } })).code, 200);
  assert.equal(accounts[0].emailVerified, true);
  assert.equal(accounts[0].emailVerificationToken, undefined);
  assert.equal((await invoke('login', { body: registration })).code, 200);
  assert.equal((await invoke('verifyEmail', { params: { token } })).code, 400);
});

test('expired and malformed tokens are rejected, and resend issues a fresh usable link', async () => {
  await invoke('register', { body: registration });
  const oldToken = tokenFromEmail(); accounts[0].emailVerificationExpires = new Date(Date.now() - 1000);
  assert.equal((await invoke('verifyEmail', { params: { token: oldToken } })).code, 400);
  assert.equal((await invoke('verifyEmail', { params: { token: 'bad' } })).code, 400);
  assert.equal((await invoke('resendVerification', { body: { email: registration.email } })).code, 200);
  const newToken = tokenFromEmail(); assert.notEqual(newToken, oldToken);
  assert.equal((await invoke('verifyEmail', { params: { token: newToken } })).code, 200);
});

test('provider failure does not leave a new unverified registration blocking another attempt', async () => {
  stub(axios, 'post', async () => { throw { response: { status: 401, data: { message: 'Invalid key' } } }; });
  assert.equal((await invoke('register', { body: registration })).code, 503);
  assert.equal(accounts.length, 0);
});

test('verification URL uses only the first origin and rejects unsafe configuration', async () => {
  process.env.PUBLIC_APP_URL = 'javascript:alert(1)';
  assert.equal((await invoke('register', { body: registration })).code, 503);
  assert.equal(messages.length, 0);
  delete process.env.PUBLIC_APP_URL;
  const old = process.env.CLIENT_ORIGIN; process.env.CLIENT_ORIGIN = ' https://retainify.example.test/?a=1#old,https://other.example.test';
  restores.push(() => { if (old === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = old; });
  await invoke('register', { body: registration });
  assert.match(messages[0].payload.htmlContent, /https:\/\/retainify.example.test\/verify-email\//);
  assert.doesNotMatch(messages[0].payload.htmlContent, /other.example|a=1|#old/);
});

test('password reset uses the same public frontend as verification and consumes its one-time token', async () => {
  await invoke('register', { body: registration });
  const oldOrigin = process.env.CLIENT_ORIGIN;
  process.env.CLIENT_ORIGIN = 'http://localhost:3000,https://old.example.test';
  restores.push(() => { if (oldOrigin === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = oldOrigin; });
  await invoke('forgotPassword', { body: { email: '  TEST@example.test  ' } });
  const { payload, options } = messages.at(-1);
  assert.match(payload.htmlContent, /https:\/\/retainify.example.test\/reset-password\//);
  assert.doesNotMatch(payload.htmlContent, /localhost|old.example/);
  assert.equal(options.timeout, 15000);
  const token = payload.htmlContent.match(/reset-password\/([a-f0-9]{64})/)[1];
  assert.equal(accounts[0].passwordResetToken, crypto.createHash('sha256').update(token).digest('hex'));
  accounts[0].failedLoginAttempts = 4;
  const req = { params: { token }, body: { password: 'replacement-password' } };
  assert.equal((await invoke('resetPassword', req)).code, 200);
  assert.equal(accounts[0].password, 'replacement-password');
  assert.equal(accounts[0].passwordResetToken, undefined);
  assert.equal(accounts[0].failedLoginAttempts, 0);
  assert.equal((await invoke('resetPassword', req)).code, 400);
});

test('expired reset tokens are rejected; delivery/configuration failures clear the pending token', async () => {
  await invoke('register', { body: registration });
  await invoke('forgotPassword', { body: { email: registration.email } });
  const token = messages.at(-1).payload.htmlContent.match(/reset-password\/([a-f0-9]{64})/)[1];
  accounts[0].passwordResetExpires = new Date(Date.now() - 1000);
  assert.equal((await invoke('resetPassword', { params: { token }, body: { password: 'replacement-password' } })).code, 400);
  assert.equal((await invoke('resetPassword', { params: { token: 'bad' }, body: { password: 'replacement-password' } })).code, 400);
  process.env.PUBLIC_APP_URL = 'javascript:alert(1)';
  await invoke('forgotPassword', { body: { email: registration.email } });
  assert.equal(accounts[0].passwordResetToken, undefined);
  assert.equal(messages.length, 2);
  process.env.PUBLIC_APP_URL = 'https://retainify.example.test';
  stub(axios, 'post', async () => { throw new Error('Delivery timeout'); });
  assert.equal((await invoke('forgotPassword', { body: { email: registration.email } })).code, 200);
  assert.equal(accounts[0].passwordResetToken, undefined);
});

test('new verification and reset emails use the deployed frontend in production', async () => {
  for (const key of ['NODE_ENV', 'CLIENT_ORIGIN']) {
    const old = process.env[key];
    restores.push(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  process.env.NODE_ENV = 'production';
  const frontend = 'https://pe-3-system-deployed-1.onrender.com';
  process.env.CLIENT_ORIGIN = `${frontend},https://other.example.test`;
  process.env.PUBLIC_APP_URL = frontend;
  await invoke('register', { body: registration });
  for (const explicitUrl of [frontend, undefined]) {
    if (explicitUrl) process.env.PUBLIC_APP_URL = explicitUrl; else delete process.env.PUBLIC_APP_URL;
    await invoke('resendVerification', { body: { email: registration.email } });
    const verify = messages.at(-1).payload.htmlContent.match(/href="([^"]+)"/)[1];
    assert.equal(new URL(verify).origin, frontend);
    assert.match(new URL(verify).pathname, /^\/verify-email\/[a-f0-9]{64}$/);
    assert.ok(messages.at(-1).payload.htmlContent.includes(`<span>${verify}</span>`), 'Verification includes the direct URL as copyable text, outside a tracked anchor');
    assert.ok(messages.at(-1).payload.textContent.includes(verify));
    assert.match(messages.at(-1).payload.textContent, /24 hours/);
    await invoke('forgotPassword', { body: { email: registration.email } });
    const reset = messages.at(-1).payload.htmlContent.match(/href="([^"]+)"/)[1];
    assert.equal(new URL(reset).origin, frontend);
    assert.match(new URL(reset).pathname, /^\/reset-password\/[a-f0-9]{64}$/);
    assert.ok(messages.at(-1).payload.htmlContent.includes(`<span>${reset}</span>`), 'Password reset includes the direct URL as copyable text, outside a tracked anchor');
    assert.ok(messages.at(-1).payload.textContent.includes(reset));
    assert.match(messages.at(-1).payload.textContent, /one hour/);
    assert.doesNotMatch(`${verify}${reset}`, /localhost|other.example/);
  }
});
