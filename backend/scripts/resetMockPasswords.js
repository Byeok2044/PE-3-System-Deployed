// Run explicitly from the terminal; never called by the application.
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { MARKER } = require('./seedMockClass');
const { configureMongoDns, checkMongoSrv } = require('../src/config/mongoDns');
const { redact } = require('../src/utils/migrationDiagnostics');

const EMAILS = Array.from({ length: 30 }, (_, index) =>
  `student${String(index + 1).padStart(2, '0')}@example.com`);
const FILTER = { email: { $in: EMAILS }, role: 'student', bio: MARKER };

function parseOptions(args) {
  if (args.some(arg => !['--apply', '--help'].includes(arg))) {
    throw new Error('Supported options: --apply, --help.');
  }
  return { apply: args.includes('--apply'), help: args.includes('--help') };
}

function validateAccounts(accounts) {
  const byEmail = new Map(accounts.map(account => [account.email, account]));
  if (accounts.length !== EMAILS.length || byEmail.size !== EMAILS.length ||
    EMAILS.some(email => {
      const account = byEmail.get(email);
      return !account || account.role !== 'student' || account.bio !== MARKER;
    })) {
    throw new Error('Expected all 30 seed-marked mock student accounts. Refusing to change missing, unmarked, or nonstudent accounts.');
  }
}

async function resetAccounts({ apply = false, users = User, database = mongoose, log = console.log } = {}) {
  const inspect = session => {
    const query = users.find({ email: { $in: EMAILS } }).select('email role bio');
    return (session ? query.session(session) : query).lean();
  };
  validateAccounts(await inspect());
  if (!apply) {
    log('Preview: 30 mock accounts found (student01@example.com through student30@example.com).');
    log('Run with --apply to reset their passwords. No changes made.');
    return;
  }

  const password = 'Retainify!' + crypto.randomBytes(12).toString('base64url');
  // updateMany bypasses the User save hook, so hash explicitly exactly once.
  const hash = await bcrypt.hash(password, 12);
  const session = await database.startSession();
  try {
    await session.withTransaction(async () => {
      validateAccounts(await inspect(session));
      const result = await users.updateMany(FILTER, {
        $set: { password: hash, failedLoginAttempts: 0, lockUntil: null },
        $unset: { passwordResetToken: '', passwordResetExpires: '' },
      }, { session, runValidators: true });
      if (result.matchedCount !== EMAILS.length) {
        throw new Error('Account selection changed. Password reset aborted.');
      }
      const saved = await users.find(FILTER).select('email role bio +password failedLoginAttempts lockUntil passwordResetToken passwordResetExpires')
        .session(session).lean();
      validateAccounts(saved);
      if (saved.some(account => account.password !== hash || account.failedLoginAttempts !== 0 ||
        account.lockUntil !== null || account.passwordResetToken != null || account.passwordResetExpires != null) ||
        !await bcrypt.compare(password, hash)) {
        throw new Error('Saved password verification failed. Password reset aborted.');
      }
    }, { maxCommitTimeMS: 10000 });
    log('Reset and verified all 30 mock student accounts.');
    log('Email range: student01@example.com through student30@example.com');
    log('New shared password: ' + password);
  } finally {
    await session.endSession();
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('npm --prefix backend run academics:reset-mock-passwords -- --apply');
    console.log('Omit --apply for a read-only preview. Loads backend/.env regardless of working directory.');
    return;
  }
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is missing in backend/.env.');
  configureMongoDns();
  try {
    await checkMongoSrv(uri);
  } catch (error) {
    throw new Error(`MongoDB DNS lookup failed (${error.code || error.name}). No passwords changed. Check network/DNS access; MONGODB_DNS_SERVERS=system in backend/.env uses your system resolver.`);
  }
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || 'StudentPerformanceSystem',
    serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 20000,
    autoCreate: false, autoIndex: false,
  });
  await resetAccounts(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Mock password reset failed: ' + redact(error.message, process.env.MONGODB_URI));
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { parseOptions, validateAccounts, resetAccounts };
