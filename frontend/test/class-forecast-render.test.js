import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
let page;
before(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = await build({ entryPoints: [path.join(root, 'src/components/ClassForecastPanel.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'class-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /[/\\]AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'class-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'class-test' }, () => ({ contents: 'export const useAuth = () => ({ apiFetch() { throw new Error("Do not forecast automatically during rendering"); } });' }));
    } }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  page = compiled.exports;
});
const data = { initialized: true, section: 'BSIT 3-3', academicYear: '2025-2026', semester: 1, rows: [
  { id: '1', studentId: 'student-1', studentName: 'Alice', studentEmail: 'alice@example.com', academicVersion: 2, status: 'succeeded',
    forecast: { dropoutProbability: 0, riskLevel: 'low', predictedNextSemesterGrade: 2.25, gradeMaximum: 5, modelVersion: 'model-v1' } },
  { id: '2', studentId: 'student-2', studentName: 'Bob', status: 'succeeded', forecast: { dropoutProbability: 0.4, riskLevel: 'high', predictedNextSemesterGrade: 3, gradeMaximum: 5 } },
  { id: '3', studentName: 'Carol', status: 'failed', error: 'Complete personal information.' },
  { id: '4', status: 'restricted', error: 'Connection unavailable.' },
] };
const results = options => renderToStaticMarkup(React.createElement(page.ClassForecastResults, { data, ...options }));
test('professor class panel presents confirmed imports without automatically running forecasts', () => {
  const html = renderToStaticMarkup(React.createElement(page.default));
  assert.match(html, /Attrition Risk by Class/); assert.match(html, /Confirmed class import/); assert.match(html, /Confirm a student records CSV/);
});
test('class results preserve zero probability, original grading scale, and source provenance', () => {
  const html = results();
  for (const label of ['BSIT 3-3', 'Semester 1', '0.00%', '40.00%', '2.25 / 5', 'Record v2', 'model-v1', 'Complete personal information.']) assert.ok(html.includes(label), label);
});
test('risk and failure filters show only matching students', () => {
  const high = results({ filter: 'high' }); assert.match(high, /Bob/); assert.doesNotMatch(high, /Alice|Carol/);
  const failed = results({ filter: 'failed' }); assert.match(failed, /Carol/); assert.doesNotMatch(failed, /Alice|Bob/);
  const restricted = results({ filter: 'restricted' }); assert.match(restricted, /Access unavailable/); assert.doesNotMatch(restricted, /Alice|Bob|Carol/);
});
test('class search matches names, account email, and student identifier, together with filters', () => {
  for (const search of ['ALICE', 'alice@example.com', 'student-1']) {
    const html = results({ search }); assert.match(html, /Alice/); assert.doesNotMatch(html, /Bob|Carol/);
  }
  assert.match(results({ search: 'Alice', filter: 'high' }), /No students match/);
});
