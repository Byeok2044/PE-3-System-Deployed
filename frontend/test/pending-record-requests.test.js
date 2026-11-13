import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

let Workspace;
before(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = await build({ entryPoints: [path.join(root, 'src/pages/StudentDataForm.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'workspace-interaction-fixture', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'workspace-test' }));
      builder.onResolve({ filter: /[/\\]AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'workspace-test' }));
      builder.onResolve({ filter: /[/\\]useAdaptivePolling(?:\.js)?$/ }, () => ({ path: 'polling', namespace: 'workspace-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'workspace-test' }, ({ path: module }) => ({ contents: module === 'hooks'
        ? 'export const useState = (...args) => globalThis.__pendingRequestTest.state(...args); export const useRef = (...args) => globalThis.__pendingRequestTest.ref(...args); export const useEffect = () => {};'
        : module === 'auth' ? 'export const useAuth = () => globalThis.__pendingRequestTest.auth;'
          : 'export default callback => { globalThis.__pendingRequestTest.poll = callback; };' }));
    } }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  Workspace = compiled.exports.default;
});
afterEach(() => { delete globalThis.__pendingRequestTest; });

const pending = { id: 'request-1', academicYear: '2025-2026', semester: 2, academicVersion: 3, provider: { _id: 'prof-1', fullName: 'Professor One' } };
const data = { profile: {}, record: null, academic: null, readiness: 'awaiting_upload', pendingRequests: [pending],
  providers: [{ id: 'prof-1', fullName: 'Professor One' }] };
const response = (body, ok = true) => ({ ok, json: async () => body });
const find = (tree, predicate) => {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
};
const button = (tree, label) => find(tree, node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children === label));
const providerForm = tree => find(tree, node => node.type === 'form');
const submit = tree => providerForm(tree).props.onSubmit({ preventDefault() {} });

async function workspaceFixture(api = async () => response(data), initial = data) {
  // A small hook host lets tests invoke the real form event handlers and render
  // their resulting state, without adding a browser or DOM dependency.
  const slots = []; let cursor = 0;
  const host = { auth: { apiFetch: async () => response(initial) }, state(initialValue) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initialValue;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }, ref(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initialValue }; return slots[index]; } };
  globalThis.__pendingRequestTest = host;
  const render = () => { cursor = 0; return Workspace({}); };
  render(); await host.poll(); host.auth.apiFetch = api; render();
  return { render, host };
}

test('pending rows show the period, professor, and cancellation confirmation before sending a request', async () => {
  let calls = 0;
  const { render } = await workspaceFixture(async () => { calls++; return response(data); });
  let tree = render(); const html = renderToStaticMarkup(tree);
  assert.match(html, /Pending Record Requests/); assert.match(html, /2025-2026/); assert.match(html, /Professor One/);
  button(tree, 'Cancel request for 2025-2026 semester 2').props.onClick(); tree = render();
  assert.ok(button(tree, 'Confirm Cancel')); assert.equal(calls, 0);
  button(tree, 'Keep Request').props.onClick(); assert.equal(button(render(), 'Confirm Cancel'), undefined); assert.equal(calls, 0);
});

test('confirming cancellation sends the exact request version and refreshes the pending list', async () => {
  let request;
  const { render } = await workspaceFixture(async (url, options) => { request = { url, ...options }; return response({ ...data, pendingRequests: [], message: 'Request cancelled.' }); });
  button(render(), 'Cancel request for 2025-2026 semester 2').props.onClick();
  await button(render(), 'Confirm Cancel').props.onClick();
  assert.equal(request.url, '/api/students/me/academic-provider/request-1'); assert.equal(request.method, 'DELETE');
  assert.deepEqual(JSON.parse(request.body), { expectedVersion: 3 });
  assert.doesNotMatch(renderToStaticMarkup(render()), /Pending Record Requests/);
});

test('replacement preloads the request and saves the updated semester with its original identifier and version', async () => {
  let request;
  const { render } = await workspaceFixture(async (url, options) => { request = { url, ...options }; return response({ ...data, message: 'Request replaced.' }); });
  button(render(), 'Replace request for 2025-2026 semester 2').props.onClick();
  let tree = render(); assert.match(renderToStaticMarkup(tree), /Replace Pending Request/);
  assert.equal(find(tree, node => node.props?.['aria-label'] === 'Source academic year digit 1').props.value, '2');
  button(tree, 'Semester 1').props.onClick(); await submit(render());
  assert.equal(request.method, 'PUT'); assert.deepEqual(JSON.parse(request.body), {
    academicYear: '2025-2026', semester: 1, professorId: 'prof-1', replaceRequestId: 'request-1', expectedVersion: 3,
  });
  assert.doesNotMatch(renderToStaticMarkup(render()), /Replace Pending Request/);
});

test('replacement failure preserves the draft and shows the server error', async () => {
  const { render } = await workspaceFixture(async () => response({ message: 'This record has already been uploaded.' }, false));
  button(render(), 'Replace request for 2025-2026 semester 2').props.onClick();
  button(render(), 'Semester 1').props.onClick(); await submit(render());
  const html = renderToStaticMarkup(render()); assert.match(html, /already been uploaded/); assert.match(html, /Replace Pending Request/);
  assert.ok(button(render(), 'Save Replacement'));
});

test('disconnected students can still cancel but cannot replace without a connected provider', async () => {
  const { render } = await workspaceFixture(undefined, { ...data, providers: [] });
  assert.equal(button(render(), 'Replace request for 2025-2026 semester 2').props.disabled, true);
  assert.equal(button(render(), 'Cancel request for 2025-2026 semester 2').props.disabled, false);
});

test('an older poll response cannot restore a request after cancellation', async () => {
  let resolvePoll;
  const { render, host } = await workspaceFixture(async (_url, options) => options?.method === 'DELETE'
    ? response({ ...data, pendingRequests: [] }) : new Promise(resolve => { resolvePoll = resolve; }));
  const stalePoll = host.poll();
  button(render(), 'Cancel request for 2025-2026 semester 2').props.onClick();
  await button(render(), 'Confirm Cancel').props.onClick(); resolvePoll(response(data)); await stalePoll;
  assert.doesNotMatch(renderToStaticMarkup(render()), /Pending Record Requests/);
});
