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
  const output = await build({ entryPoints: [path.join(root, 'src/pages/ProfessorHistoryView.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'history-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /[/\\]AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'history-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'history-test' }, () => ({ contents: 'export const useAuth = () => ({ apiFetch() { throw new Error("No API requests during rendering"); } });' }));
    } }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  page = compiled.exports;
});
const base = { id: 'event', occurredAt: '2026-11-11T04:00:00.000Z', actor: { fullName: 'Professor Chee', role: 'professor' }, student: { fullName: 'Student One' }, academicYear: '2025-2026', semester: 2 };
const renderEvent = event => renderToStaticMarkup(React.createElement(page.ProfessorHistoryEvent, { event: { ...base, ...event } }));

test('professor History renders all requested filters and read-only event categories', () => {
  const html = renderToStaticMarkup(React.createElement(page.default));
  for (const label of ['Professor History', 'CSV imports', 'Academic corrections', 'Connection activity', 'Provider transfers', 'Student forecasts', 'Search student or batch ID', 'Academic year', 'Semester', 'From date', 'To date', 'Apply filters']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /history-delete-button/);
});
test('import details show the source period, professor, batch, and exact new/corrected/unchanged counts', () => {
  const html = renderEvent({ category: 'csv_import', action: 'confirmed', student: null, details: { batchId: 'batch-123', counts: { created: 5, corrected: 2, unchanged: 0 } } });
  for (const label of ['CSV import confirmed', 'Professor Chee', '2025-2026', 'Semester 2', 'batch-123', '>5<', '>2<', '>0<', '2026-11-11T04:00:00.000Z']) assert.ok(html.includes(label), label);
});
test('correction details compare values and show reason and record version', () => {
  const html = renderEvent({ category: 'academic_correction', action: 'corrected', details: { academicVersion: 2, reason: 'Updated summary', changes: [{ field: 'previousSemesterGrade', before: 3, after: 2.25 }] } });
  for (const label of ['Student One', 'Previous value', 'New value', '>3<', '>2.25<', 'Updated summary', 'Academic version 2']) assert.ok(html.includes(label), label);
});
test('connection events identify the acting student when the student removes a connection', () => {
  const html = renderEvent({ category: 'connection', action: 'removed', actor: { fullName: 'Student One', role: 'student' }, details: { previousStatus: 'accepted', status: 'removed' } });
  assert.match(html, /Connection removed/); assert.match(html, /Student One \(student\)/); assert.match(html, /accepted/);
});
test('transfer events render offered, accepted, and cancelled states with both professors', () => {
  for (const action of ['offered', 'accepted', 'cancelled']) {
    const html = renderEvent({ category: 'provider_transfer', action, details: { previousProfessor: { fullName: 'Professor A' }, receivingProfessor: { fullName: 'Professor B' }, academicVersion: 3 } });
    assert.ok(html.includes(`Academic provider transfer ${action}`)); assert.match(html, /Professor A/); assert.match(html, /Professor B/);
  }
});
test('forecast details preserve zero probability and include grade, risk level, and source version', () => {
  const html = renderEvent({ category: 'forecast', action: 'generated', details: { predictedGrade: 2.25, gradeMaximum: 5, dropoutProbability: 0, riskLevel: 'low', academicVersion: 4 } });
  assert.match(html, /2.25 \/ 5/); assert.match(html, />0%</); assert.match(html, /Academic version used/); assert.match(html, />4</); assert.match(html, />low</);
});
test('restricted event details do not expose old academic values', () => {
  const html = renderEvent({ category: 'forecast', action: 'generated', detailsRestricted: true, details: { predictedGrade: 2.256789, dropoutProbability: 0.994321, academicVersion: 90 } });
  assert.match(html, /no longer connected/); assert.doesNotMatch(html, /2.256789|99.43|Academic version used/);
});
