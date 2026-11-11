const HEADERS = ['studentEmail', 'academicYear', 'semester', 'previousSemesterGrade', 'gradeMaximum', 'previousSemesterUnitsEnrolled', 'previousSemesterUnitsApproved', 'attendance'];
const ACADEMIC_FIELDS = ['previousSemesterGrade', 'gradeMaximum', 'previousSemesterUnitsEnrolled', 'previousSemesterUnitsApproved', 'attendance'];
const PROFILE_FIELDS = ['educationalSpecialNeeds', 'tuitionFeeStatus', 'scholarshipStatus'];
const institutionKey = value => String(value || '').trim().toLowerCase();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function validatePeriod(year, semester) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(year));
  if (!match || +match[2] !== +match[1] + 1 || +match[1] < 1900 || ![1, 2].includes(Number(semester))) {
    throw fail('Use an academic year such as 2025-2026 and semester 1 or 2.');
  }
  return { academicYear: String(year), semester: Number(semester) };
}

// A bounded RFC-style CSV reader: quoted commas/newlines and escaped quotes are supported.
function parseCsv(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 1024 * 1024) throw fail('Upload a UTF-8 CSV no larger than 1 MB.');
  const source = input.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false; let closed = false; let line = 1; let rowStart = 1;
  function finishCell() { row.push(cell.trim()); cell = ''; closed = false; }
  function finishRow() {
    finishCell();
    if (row.some(value => value !== '')) rows.push({ values: row, rowNumber: rowStart });
    row = [];
    rowStart = line;
    if (rows.length > 501) throw fail('A CSV can contain at most 500 student rows.');
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\r' || (char === '\n' && source[i - 1] !== '\r')) line++;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[i + 1] === '\n') i++; finishRow(); }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (closed || char === '"') throw fail('Malformed CSV quoting.');
    else cell += char;
  }
  if (quoted) throw fail('The CSV contains an unclosed quoted value.');
  if (cell || row.length || closed) finishRow();
  if (rows.length < 2) throw fail('The CSV must contain a header and at least one student row.');
  const headers = rows.shift().values;
  if (headers.length !== HEADERS.length || new Set(headers).size !== HEADERS.length || HEADERS.some(key => !headers.includes(key))) {
    throw fail(`Use exactly these headers: ${HEADERS.join(',')}`);
  }
  return rows.map(({ values, rowNumber }) => {
    if (values.length !== headers.length) throw fail(`Row ${rowNumber}: the number of columns does not match the header.`);
    return { rowNumber, ...Object.fromEntries(headers.map((key, i) => [key, values[i]])) };
  });
}

function validateAcademicRow(row) {
  const errors = [];
  const result = { studentEmail: String(row.studentEmail || '').trim().toLowerCase() };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.studentEmail)) errors.push('studentEmail: enter a valid account email.');
  try { Object.assign(result, validatePeriod(row.academicYear, row.semester)); } catch (error) { errors.push(error.message); }
  for (const key of ACADEMIC_FIELDS.filter(key => key !== 'attendance')) {
    const value = row[key];
    if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) || !Number.isFinite(Number(value))) errors.push(`${key}: a nonempty numeric value is required.`);
    else result[key] = Number(value);
  }
  const maximum = result.gradeMaximum; const grade = result.previousSemesterGrade;
  if (![4, 5, 20, 100].includes(maximum)) errors.push('gradeMaximum: use 4, 5, 20, or 100.');
  if (grade !== undefined && (grade < (maximum === 5 ? 1 : 0) || grade > maximum)) errors.push('previousSemesterGrade: grade is outside the declared scale.');
  const enrolled = result.previousSemesterUnitsEnrolled; const approved = result.previousSemesterUnitsApproved;
  if (!Number.isInteger(enrolled) || enrolled < 1 || enrolled > 100) errors.push('previousSemesterUnitsEnrolled: use whole units from 1 to 100.');
  if (!Number.isInteger(approved) || approved < 0 || approved > 100 || approved > enrolled) errors.push('previousSemesterUnitsApproved: use whole units from 0 to enrolled units.');
  if (!['day', 'night'].includes(row.attendance)) errors.push('attendance: use day or night.');
  else result.attendance = row.attendance;
  return { values: result, errors };
}
module.exports = { HEADERS, ACADEMIC_FIELDS, PROFILE_FIELDS, institutionKey, fail, validatePeriod, parseCsv, validateAcademicRow };
