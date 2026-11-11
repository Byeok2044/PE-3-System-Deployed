const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureMongoDns, checkMongoSrv } = require('../src/config/mongoDns');
const { redact, formatMigrationError } = require('../src/utils/migrationDiagnostics');

test('backend and migration use the same default DNS servers', () => {
  let servers;
  configureMongoDns({}, { setServers(value) { servers = value; } });
  assert.deepEqual(servers, ['8.8.8.8', '8.8.4.4']);
});
test('DNS can use system or explicitly configured resolvers', () => {
  configureMongoDns({ MONGODB_DNS_SERVERS: 'system' }, { setServers() { throw new Error('Do not override system DNS'); } });
  let servers;
  configureMongoDns({ MONGODB_DNS_SERVERS: '1.1.1.1, 1.0.0.1' }, { setServers(value) { servers = value; } });
  assert.deepEqual(servers, ['1.1.1.1', '1.0.0.1']);
  assert.throws(() => configureMongoDns({ MONGODB_DNS_SERVERS: '' }), /MONGODB_DNS_SERVERS/);
});
test('diagnostics retain DNS cause and identify the failed phase', () => {
  const output = formatMigrationError(Object.assign(new Error('querySrv ECONNREFUSED _mongodb._tcp.cluster.example.test'), { code: 'ECONNREFUSED' }), 'database connection');
  assert.match(output, /database connection/); assert.match(output, /querySrv ECONNREFUSED/); assert.match(output, /MONGODB_DNS_SERVERS=system/);
});
test('diagnostics distinguish missing configuration, authentication, and permissions', () => {
  for (const [error, expected] of [
    [Object.assign(new Error('Missing config'), { code: 'MISSING_MONGODB_URI' }), /backend\/\.env/],
    [Object.assign(new Error('Authentication failed'), { code: 18 }), /URL-encode/],
    [Object.assign(new Error('Not authorized'), { code: 13 }), /create indexes/],
  ]) assert.match(formatMigrationError(error, 'database connection'), expected);
});
test('failure output redacts complete URIs and both encoded and decoded credentials', () => {
  const uri = 'mongodb+srv://migrationUser:secret%40pass@cluster.example.test/';
  const output = formatMigrationError(new Error(`Failure with ${uri} migrationUser secret@pass secret%40pass`), 'database connection', uri);
  for (const secret of [uri, 'migrationUser', 'secret@pass', 'secret%40pass']) assert.equal(output.includes(secret), false);
  assert.match(output, /redacted/);
  assert.equal(redact('mongodb://name:password@host/db'), '[MongoDB URI redacted]');
});
test('backup failures explain that legacy updates have not started', () => {
  assert.match(formatMigrationError(Object.assign(new Error('Permission denied'), { code: 'EACCES' }), 'backup'), /Legacy updates have not started/);
});
test('SRV preflight checks the cluster and cancels its resolver on failure', async () => {
  let queried; let cancelled = false;
  const error = Object.assign(new Error('querySrv ETIMEOUT'), { code: 'ETIMEOUT' });
  await assert.rejects(checkMongoSrv('mongodb+srv://user:password@cluster.example.test/', {
    setServers() {}, async resolveSrv(host) { queried = host; throw error; }, cancel() { cancelled = true; },
  }), { code: 'ETIMEOUT' });
  assert.equal(queried, '_mongodb._tcp.cluster.example.test'); assert.equal(cancelled, true);
  await checkMongoSrv('mongodb://127.0.0.1:27017', { resolveSrv() { throw new Error('Local URI must not perform SRV lookup'); } });
});
