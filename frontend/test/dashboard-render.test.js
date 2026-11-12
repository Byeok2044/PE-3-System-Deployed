import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { build } from 'esbuild';

let dashboard;
before(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await build({
    entryPoints: [path.join(root, 'src/pages/Dashboard.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'authenticated-render-fixture', setup(builder) {
      builder.onResolve({ filter: /[/\\]AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth-context', namespace: 'dashboard-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'dashboard-test' }, () => ({ contents: 'export const useAuth = () => globalThis.__dashboardRenderAuth;' }));
    } }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  dashboard = compiled.exports;
});

for (const role of ['student', 'professor']) {
  for (const route of ['/dashboard', '/dashboard/data', '/dashboard/insights', '/dashboard/connections', '/dashboard/messages', '/dashboard/history']) {
    test(`${role} can render ${route} with real dashboard navigation`, () => {
      globalThis.__dashboardRenderAuth = {
        user: { id: 'fixture-user', role, fullName: 'Render Fixture', institution: 'Fixture School', email: 'fixture@example.test', emailVerified: true },
        logout() {}, apiFetch() { throw new Error('Rendering must not make API calls.'); },
      };
      try {
        const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(dashboard.default)));
        assert.match(html, /Dashboard navigation/);
        assert.match(html, /href="\/dashboard\/data"/);
        assert.match(html, /href="\/dashboard\/connections"/);
        assert.match(html, /href="\/dashboard\/history"/);
        if (route === '/dashboard/data' && role === 'professor') assert.match(html, /Validate and preview/i);
        if (route === '/dashboard/history' && role === 'professor') assert.match(html, /Professor History/);
      } finally { delete globalThis.__dashboardRenderAuth; }
    });
  }
}

test('grade summaries preserve inverse GWA and the supported chart scales', () => {
  for (const [scale, passing, failing, cutoff, domain, reversed] of [
    [5, 2.25, 4, 3, [1, 5], true], [4, 3, 1, 2, [1, 4], false],
    [20, 15, 8, 10, [0, 20], false], [100, 85, 70, 75, [50, 100], false],
  ]) {
    assert.equal(dashboard.evaluateGrade(passing, scale).isAtRisk, false);
    const details = dashboard.evaluateGrade(failing, scale);
    assert.equal(details.isAtRisk, true); assert.equal(details.passingCutoff, cutoff);
    assert.deepEqual(details.chartDomain, domain); assert.equal(details.isReversed, reversed);
  }
});

test('a temporary auth failure renders a retry control alongside the dashboard', () => {
  globalThis.__dashboardRenderAuth = {
    user: { id: 'fixture-user', role: 'student', fullName: 'Fixture' },
    apiFetch() {}, logout() {}, retrySession() {}, sessionError: 'Session verification is unavailable.',
  };
  try {
    const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/dashboard' }, React.createElement(dashboard.default)));
    assert.match(html, /Retry session check/); assert.match(html, /Session verification is unavailable/);
  } finally { delete globalThis.__dashboardRenderAuth; }
});
