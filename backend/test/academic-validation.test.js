const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HEADERS, parseCsv, validateAcademicRow, validatePeriod } = require('../src/utils/academicValidation');
const valid = { studentEmail: ' STUDENT@EXAMPLE.COM ', academicYear: '2025-2026', semester: '2', previousSemesterGrade: '2.25', gradeMaximum: '5', previousSemesterUnitsEnrolled: '24', previousSemesterUnitsApproved: '21', attendance: 'day' };
const csv = row => HEADERS.join(',') + '\r\n' + HEADERS.map(key => row[key]).join(',');

test('CSV handles BOM, reordered headers, quoted commas, escaped quotes, and CRLF', () => {
  const headers = [...HEADERS].reverse();
  const text = '\uFEFF' + headers.join(',') + '\r\n' + headers.map(key => key === 'studentEmail' ? '"student, ""quoted""@example.com"' : valid[key]).join(',') + '\r\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 1); assert.equal(rows[0].studentEmail, 'student, "quoted"@example.com');
});
test('CSV preserves quoted newlines for subsequent field validation', () => {
  const row = { ...valid, attendance: '"day\nnight"' };
  assert.match(validateAcademicRow(parseCsv(csv(row))[0]).errors.join(' '), /attendance/);
});
test('validation row numbers retain physical CSV lines after blank rows', () => {
  const text = HEADERS.join(',') + '\n\n' + HEADERS.map(key => valid[key]).join(',');
  assert.equal(parseCsv(text)[0].rowNumber, 3);
});
test('valid GWA is preserved on its original scale with normalized email', () => {
  const { values, errors } = validateAcademicRow(valid);
  assert.deepEqual(errors, []); assert.equal(values.studentEmail, 'student@example.com');
  assert.equal(values.previousSemesterGrade, 2.25); assert.equal(values.gradeMaximum, 5);
});
test('zero approved units is meaningful and valid', () => assert.deepEqual(validateAcademicRow({ ...valid, previousSemesterUnitsApproved: '0' }).errors, []));
test('all existing grading scales follow their valid directions and bounds', () => {
  for (const [maximum, minimum] of [[4, 0], [5, 1], [20, 0], [100, 0]]) {
    assert.deepEqual(validateAcademicRow({ ...valid, gradeMaximum: String(maximum), previousSemesterGrade: String(minimum) }).errors, []);
    assert.deepEqual(validateAcademicRow({ ...valid, gradeMaximum: String(maximum), previousSemesterGrade: String(maximum) }).errors, []);
  }
  assert.match(validateAcademicRow({ ...valid, previousSemesterGrade: '0' }).errors.join(), /outside/);
});
test('rejects empty, nonfinite, scientific, and malformed numeric values', () => {
  for (const value of ['', ' ', 'NaN', 'Infinity', '1e2', '2.5oops', '-1', null]) {
    assert.ok(validateAcademicRow({ ...valid, previousSemesterGrade: value }).errors.length, String(value));
  }
});
test('rejects impossible and fractional units', () => {
  for (const values of [{ previousSemesterUnitsEnrolled: '0' }, { previousSemesterUnitsApproved: '25' }, { previousSemesterUnitsApproved: '1.5' }, { previousSemesterUnitsEnrolled: '101' }]) {
    assert.ok(validateAcademicRow({ ...valid, ...values }).errors.length);
  }
});
test('rejects unknown scales and schedules', () => {
  assert.ok(validateAcademicRow({ ...valid, gradeMaximum: '10' }).errors.length);
  assert.ok(validateAcademicRow({ ...valid, attendance: '94%' }).errors.length);
});
test('source period requires consecutive years and semester 1 or 2', () => {
  assert.deepEqual(validatePeriod('2025-2026', '2'), { academicYear: '2025-2026', semester: 2 });
  for (const [year, semester] of [['2025-2027', 1], ['25-26', 1], ['2025-2026', 3], ['', 1]]) assert.throws(() => validatePeriod(year, semester));
});
test('rejects missing, duplicated, and unexpected CSV headers', () => {
  for (const header of [HEADERS.slice(1), [...HEADERS, 'name'], HEADERS.map(key => key === 'attendance' ? 'studentEmail' : key)]) {
    assert.throws(() => parseCsv(header.join(',') + '\n' + HEADERS.map(key => valid[key]).join(',')), /headers/);
  }
});
test('rejects empty files, mismatched columns, and malformed quoting', () => {
  for (const text of ['', HEADERS.join(','), HEADERS.join(',') + '\na,b', HEADERS.join(',') + '\n"unclosed', HEADERS.join(',') + '\n"closed"extra']) assert.throws(() => parseCsv(text));
});
test('enforces 500 rows and 1 MB before processing', () => {
  const line = HEADERS.map(key => valid[key]).join(',');
  assert.equal(parseCsv(HEADERS.join(',') + '\n' + Array(500).fill(line).join('\n')).length, 500);
  assert.throws(() => parseCsv(HEADERS.join(',') + '\n' + Array(501).fill(line).join('\n')), /500/);
  assert.throws(() => parseCsv('a'.repeat(1024 * 1024 + 1)), /1 MB/);
});
