const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { IncomingMessage, ServerResponse } = require('node:http');
const { PassThrough } = require('node:stream');
const User = require('../src/models/User');
const Connection = require('../src/models/StudentProfessorConnection');
const Academic = require('../src/models/AcademicRecord');
const { HEADERS } = require('../src/utils/academicValidation');
const { errorHandler } = require('../src/middleware/errorHandler');
const restores = [];
function stub(object, key, value) { const original = object[key]; object[key] = value; restores.push(() => { object[key] = original; }); }
afterEach(() => { while (restores.length) restores.pop()(); });
function query(value) { return { select() { return this; }, lean: async () => value }; }
async function withServer(role, callback) {
  const oldKey = process.env.JWT_SECRET; process.env.JWT_SECRET = 'academic-http-test-secret';
  restores.push(() => { if (oldKey === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldKey; });
  const user = { _id: '000000000000000000000002', role, emailVerified: true, institution: 'School A' };
  stub(User, 'findById', async () => user);
  const app = express(); app.use(express.json({ limit: '10kb' }));
  app.use('/api/auth', require('../src/routes/authRoutes'));
  app.use('/api/professor', require('../src/routes/professorRoutes'));
  app.use('/api/students', require('../src/routes/studentRecordRoutes'));
  app.use(errorHandler);
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  // Exercise the real Express routing/body parsers without requiring a TCP socket.
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = new IncomingMessage(new PassThrough());
    req.url = path; req.method = options.method || 'GET';
    const body = Buffer.from(options.body || '');
    req.headers = Object.fromEntries(Object.entries({ Authorization: 'Bearer ' + token, ...options.headers }).map(([key, value]) => [key.toLowerCase(), value]));
    req.headers['content-length'] = String(body.length);
    const res = new ServerResponse(req); const chunks = [];
    res.write = chunk => { chunks.push(Buffer.from(chunk)); return true; };
    res.end = chunk => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, headers: { get: key => res.getHeader(key) }, text: async () => text, json: async () => JSON.parse(text) });
      return res;
    };
    app.handle(req, res, reject);
    req.push(body); req.push(null);
  });
  await callback(request);
}

test('authenticated CSV uploads bypass the JSON limit but enforce the separate 1 MB limit', async () => {
  stub(User, 'find', () => query([])); stub(Connection, 'find', () => query([])); stub(Academic, 'find', () => query([]));
  await withServer('professor', async request => {
    const header = HEADERS.join(',');
    const row = 'student@example.com,2025-2026,2,2.25,5,24,21,day';
    const body = header + '\n' + Array(300).fill(row).join('\n');
    assert.ok(Buffer.byteLength(body) > 10 * 1024);
    let response = await request('/api/professor/academic-imports/preview', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body });
    assert.equal(response.status, 200); assert.equal((await response.json()).valid, false);
    response = await request('/api/professor/academic-imports/preview', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'a'.repeat(1024 * 1024 + 1) });
    assert.equal(response.status, 413);
    response = await request('/api/students/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'a'.repeat(20 * 1024) }) });
    assert.equal(response.status, 413);
  });
});
test('students cannot download professor templates or submit professor imports', async () => {
  await withServer('student', async request => {
    let response = await request('/api/professor/academic-imports/template'); assert.equal(response.status, 403);
    response = await request('/api/professor/academic-imports/preview', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: HEADERS.join(',') });
    assert.equal(response.status, 403);
    response = await request('/api/students/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previousSemesterGrade: 20 }) });
    assert.equal(response.status, 403);
  });
});
test('professor template is downloadable and JSON cannot masquerade as a CSV upload', async () => {
  await withServer('professor', async request => {
    let response = await request('/api/professor/academic-imports/template');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.equal((await response.text()).trim(), HEADERS.join(','));
    response = await request('/api/professor/academic-imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'fake' }) });
    assert.equal(response.status, 415);
  });
});

test('auth profile responds normally, and database outages return retryable 503 responses', async () => {
  await withServer('student', async request => {
    let response = await request('/api/auth/me');
    assert.equal(response.status, 200); assert.equal((await response.json()).user.role, 'student');
    stub(User, 'findById', async () => { throw new Error('Database unavailable'); });
    response = await request('/api/auth/me');
    assert.equal(response.status, 503); assert.match((await response.json()).message, /database.*unavailable/);
    response = await request('/api/auth/me', { headers: { Authorization: 'Bearer invalid-token' } });
    assert.equal(response.status, 401);
  });
});
