const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { MARKER } = require('../scripts/seedMockClass');
const { parseOptions, validateAccounts, resetAccounts } = require('../scripts/resetMockPasswords');

const mockAccounts = () => Array.from({ length: 30 }, (_, index) => ({
  email: `student${String(index + 1).padStart(2, '0')}@example.com`,
  role: 'student', bio: MARKER, password: 'old-hash',
  failedLoginAttempts: 5, lockUntil: new Date(),
  passwordResetToken: 'old-token', passwordResetExpires: new Date(),
}));

function fixture(accounts = mockAccounts(), matchedCount = 30) {
  const logs = [];
  let writes = 0;
  let sessions = 0;
  let ended = false;
  const matches = (account, filter) => filter.email.$in.includes(account.email) &&
    (!filter.role || account.role === filter.role) && (!filter.bio || account.bio === filter.bio);
  const users = {
    find(filter) {
      return { select() { return this; }, session() { return this; },
        async lean() { return accounts.filter(account => matches(account, filter)); } };
    },
    async updateMany(filter, update) {
      writes++;
      for (const account of accounts.filter(account => matches(account, filter))) {
        Object.assign(account, update.$set);
        for (const field of Object.keys(update.$unset)) delete account[field];
      }
      return { matchedCount };
    },
  };
  const database = { async startSession() {
    sessions++;
    return { async withTransaction(callback) { await callback(); }, async endSession() { ended = true; } };
  } };
  return { users, database, accounts, logs, log: message => logs.push(message),
    get writes() { return writes; }, get sessions() { return sessions; }, get ended() { return ended; } };
}

test('preview is the default and never starts a write transaction', async () => {
  assert.deepEqual(parseOptions([]), { apply: false, help: false });
  assert.throws(() => parseOptions(['--password', 'anything']), /Supported options/);
  const state = fixture();
  await resetAccounts(state);
  assert.equal(state.writes, 0);
  assert.equal(state.sessions, 0);
  assert.ok(state.logs.some(message => message.includes('No changes made')));
});

test('missing, duplicate, unmarked, and professor accounts are refused', async () => {
  for (const change of [
    rows => rows.pop(),
    rows => { rows[0].email = rows[1].email; },
    rows => { rows[0].bio = ''; },
    rows => { rows[0].role = 'professor'; },
  ]) {
    const accounts = mockAccounts();
    change(accounts);
    assert.throws(() => validateAccounts(accounts), /Refusing/);
    const state = fixture(accounts);
    await assert.rejects(resetAccounts({ ...state, apply: true }), /Refusing/);
    assert.equal(state.writes, 0);
  }
});

test('apply prints a working password, clears locks and reset tokens, and preserves other users', async () => {
  const other = { email: 'professor@example.com', role: 'professor', password: 'unchanged' };
  const state = fixture([...mockAccounts(), other]);
  await resetAccounts({ ...state, apply: true });
  const password = state.logs.find(message => message.startsWith('New shared password: '))?.slice(21);
  assert.ok(password && password.length >= 20);
  assert.equal(await bcrypt.compare(password, state.accounts[0].password), true);
  for (const account of state.accounts.slice(0, 30)) {
    assert.equal(account.password, state.accounts[0].password);
    assert.notEqual(account.password, password);
    assert.equal(account.failedLoginAttempts, 0);
    assert.equal(account.lockUntil, null);
    assert.equal(account.passwordResetToken, undefined);
    assert.equal(account.passwordResetExpires, undefined);
  }
  assert.equal(other.password, 'unchanged');
  assert.equal(state.ended, true);
});

test('an account selection mismatch fails without printing a usable password', async () => {
  const state = fixture(mockAccounts(), 29);
  await assert.rejects(resetAccounts({ ...state, apply: true }), /selection changed/);
  assert.equal(state.logs.length, 0);
  assert.equal(state.ended, true);
});
