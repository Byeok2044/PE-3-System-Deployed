const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planMockClass, MARKER } = require('../scripts/seedMockClass');
const { HEADERS } = require('../src/utils/academicValidation');
const User = require('../src/models/User');
const Profile = require('../src/models/StudentRecord');
const Academic = require('../src/models/AcademicRecord');

const professor = { _id: '000000000000000000000001', role: 'professor', emailVerified: true, institution: 'Test College' };
const csv = fs.readFileSync(path.join(__dirname, '../../Retainify_BSIT_3-3_Class_Test.csv'), 'utf8');
const single = (email = 'student01@example.com') => HEADERS.join(',') + '\n' + `${email},2026-2027,1,1.25,5,18,18,day\n`;

test('the supplied class CSV prepares 30 distinct students with complete personal inputs', async () => {
  const plan = planMockClass(csv, professor);
  assert.equal(plan.length, 30);
  assert.equal(new Set(plan.map(item => item.values.studentEmail)).size, 30);
  for (const item of plan) {
    assert.equal(item.values.academicYear, '2026-2027');
    assert.equal(item.values.semester, 1);
    await new Profile({ user: professor._id, ...item.profile }).validate();
    const academic = new Academic({ student: professor._id, provider: professor._id, institutionKey: 'test college',
      academicYear: item.values.academicYear, semester: item.values.semester });
    await academic.validate();
    assert.equal(academic.status, 'awaiting_upload');
    assert.equal(academic.previousSemesterGrade, undefined);
  }
});

test('existing nonmock accounts cannot be adopted or overwritten', () => {
  for (const existing of [
    { email: 'student01@example.com', role: 'student', emailVerified: true, institution: 'Test College' },
    { email: 'student01@example.com', bio: MARKER, role: 'professor', emailVerified: true, institution: 'Test College' },
    { email: 'student01@example.com', bio: MARKER, role: 'student', emailVerified: true, institution: 'Other College' },
    { email: 'student01@example.com', bio: MARKER, role: 'student', emailVerified: false, institution: 'Test College' },
  ]) assert.throws(() => planMockClass(csv, professor, [existing]), /Refusing to change/);
});

test('reruns reuse seed-owned students rather than preparing replacement credentials', () => {
  const user = { email: 'student01@example.com', bio: MARKER, role: 'student', emailVerified: true, institution: ' TEST COLLEGE ' };
  const [item] = planMockClass(single(), professor, [user]);
  assert.equal(item.user, user);
  assert.equal(item.number, 1);
  assert.equal(item.user.password, undefined);
});

test('real emails, duplicate students, invalid academic values and mixed periods are rejected', () => {
  assert.throws(() => planMockClass(single('real@student.test'), professor), /only supports/);
  assert.throws(() => planMockClass(single() + single().split('\n')[1] + '\n', professor), /Duplicate/);
  assert.throws(() => planMockClass(single().replace(',18,18,day', ',18,19,day'), professor), /approved|Approved|enrolled/);
  assert.throws(() => planMockClass(csv.replace('student02@example.com,2026-2027,1', 'student02@example.com,2026-2027,2'), professor), /one academic period/);
});

test('unverified professors and missing institutions cannot own the mock class', () => {
  assert.throws(() => planMockClass(csv, { ...professor, emailVerified: false }), /verified professor/);
  assert.throws(() => planMockClass(csv, { ...professor, institution: '' }), /verified professor/);
});

test('mock accounts use the normal password hashing hook', async () => {
  const user = new User({ fullName: 'Mock Student', email: 'student01@example.com', password: 'test-only-password', role: 'student' });
  await user.validate();
  await new Promise((resolve, reject) => User.schema.s.hooks.execPre('save', user, [], error => error ? reject(error) : resolve()));
  assert.notEqual(user.password, 'test-only-password');
  assert.equal(await user.comparePassword('test-only-password'), true);
});
