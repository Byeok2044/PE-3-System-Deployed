import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSession } from '../src/context/validateSession.js';

test('temporary server and proxy failures do not invalidate the stored session', async () => {
  for (const status of [500, 502, 503, 504]) {
    const result = await validateSession('test-token', async () => ({ status, ok: false }));
    assert.equal(result.status, 'unavailable'); assert.match(result.message, /backend/);
  }
});
test('network failures and malformed responses leave the session retryable', async () => {
  assert.equal((await validateSession('token', async () => { throw new Error('Connection refused'); })).status, 'unavailable');
  assert.equal((await validateSession('token', async () => ({ ok: true, status: 200, json: async () => ({}) }))).status, 'unavailable');
});
test('unauthorized or revoked sessions still require a new login', async () => {
  for (const status of [401, 403]) assert.equal((await validateSession('token', async () => ({ status, ok: false }))).status, 'invalid');
});
test('successful profile validation uses the protected endpoint and bearer token', async () => {
  const user = { id: 'student-id', fullName: 'Student' };
  const result = await validateSession('test-token', async (url, options) => {
    assert.equal(url, '/api/auth/me'); assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { status: 200, ok: true, json: async () => ({ user }) };
  });
  assert.deepEqual(result, { status: 'valid', user });
});
