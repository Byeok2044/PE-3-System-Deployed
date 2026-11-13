import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestEmailVerification } from '../src/utils/emailVerification.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('verification posts the token to the backend and returns its success message', async () => {
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/auth/verify-email/test'); assert.equal(options.method, 'POST'); return { ok: true, json: async () => ({ message: 'Email verified.' }) }; };
  assert.equal(await requestEmailVerification('test'), 'Email verified.');
});
test('expired links and unavailable backend responses never show success', async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'Link expired.' }) });
  await assert.rejects(requestEmailVerification('test'), /Link expired/);
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('HTML fallback'); } });
  await assert.rejects(requestEmailVerification('test'), /temporarily unavailable/);
  globalThis.fetch = async () => { throw new TypeError('Network error'); };
  await assert.rejects(requestEmailVerification('test'), /server is starting/);
});
