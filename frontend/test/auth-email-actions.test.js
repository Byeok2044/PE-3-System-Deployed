import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestAuthEmailAction } from '../src/utils/authEmailActions.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

for (const path of ['/api/auth/forgot-password', '/api/auth/reset-password/test', '/api/auth/verify-email/test']) {
  test(`${path} rejects static-site HTML and malformed API responses instead of reporting success`, async () => {
    for (const json of [async () => { throw new Error('HTML fallback'); }, async () => ({}), async () => ({ message: '' }), async () => null]) {
      globalThis.fetch = async () => ({ ok: true, json });
      await assert.rejects(requestAuthEmailAction(path), /temporarily unavailable/);
    }
  });
}

test('password actions submit JSON, preserve expired-token errors, and explain server startup failures', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/auth/reset-password/test');
    assert.deepEqual(JSON.parse(options.body), { password: 'test-password' });
    assert.equal(options.headers['Content-Type'], 'application/json');
    return { ok: true, json: async () => ({ message: 'Password reset successfully.' }) };
  };
  assert.equal(await requestAuthEmailAction('/api/auth/reset-password/test', { password: 'test-password' }), 'Password reset successfully.');
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'Link expired.' }) });
  await assert.rejects(requestAuthEmailAction('/api/auth/reset-password/test'), /Link expired/);
  globalThis.fetch = async () => { throw Object.assign(new Error('Aborted'), { name: 'AbortError' }); };
  await assert.rejects(requestAuthEmailAction('/api/auth/forgot-password'), /server is starting/);
});
