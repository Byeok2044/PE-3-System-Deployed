const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const { protect } = require('../src/middleware/authMiddleware');
const restores = [];
afterEach(() => { while (restores.length) restores.pop()(); });
async function authenticate(findUser) {
  const originalKey = process.env.JWT_SECRET; process.env.JWT_SECRET = 'authentication-test-key';
  restores.push(() => { if (originalKey === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalKey; });
  const originalFind = User.findById; User.findById = findUser; restores.push(() => { User.findById = originalFind; });
  const token = jwt.sign({ id: '000000000000000000000001' }, process.env.JWT_SECRET);
  const req = { headers: { authorization: 'Bearer ' + token } };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false; await protect(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}
test('database failure returns a retryable service error without exposing credentials', async () => {
  const { res, nextCalled } = await authenticate(async () => { throw new Error('Internal connection detail must not escape'); });
  assert.equal(res.code, 503); assert.match(res.body.message, /temporarily unavailable/);
  assert.doesNotMatch(res.body.message, /Internal connection/); assert.equal(nextCalled, false);
});
test('missing users and unsupported roles remain unauthorized', async () => {
  assert.equal((await authenticate(async () => null)).res.code, 401);
  assert.equal((await authenticate(async () => ({ role: 'administrator' }))).res.code, 403);
});
test('valid users reach the protected controller', async () => {
  const user = { role: 'student' }; const result = await authenticate(async () => user);
  assert.equal(result.req.user, user); assert.equal(result.nextCalled, true);
});
