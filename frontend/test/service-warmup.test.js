import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthEndpoints, wakeServices, wakeService } from '../src/utils/serviceWarmup.js';

const ready = () => ({ ok: true, json: async () => ({ status: 'ok' }) });

test('configured public URLs wake both services before either responds', async () => {
  const urls = healthEndpoints({
    VITE_BACKEND_HEALTH_URL: 'https://backend.example/api/health',
    VITE_ML_HEALTH_URL: 'https://ml.example/health',
  });
  const calls = [];
  const releases = [];
  const pending = wakeServices(urls, { fetchImpl: (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    return new Promise((resolve) => releases.push(() => resolve(ready())));
  } });
  assert.deepEqual(calls, urls);
  releases.forEach((release) => release());
  assert.deepEqual(await pending, [true, true]);
  assert.deepEqual(healthEndpoints(), ['/api/health', '/api/ml/health']);
});

test('startup errors retry only the affected service', async () => {
  const counts = { backend: 0, ml: 0 };
  const result = await wakeServices(['backend', 'ml'], {
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      counts[url] += 1;
      if (url === 'ml' && counts.ml === 1) return { ok: false };
      if (url === 'ml' && counts.ml === 2) throw new SyntaxError('HTML startup page');
      return ready();
    },
  });
  assert.deepEqual(result, [true, true]);
  assert.deepEqual(counts, { backend: 1, ml: 3 });
});

test('degraded models are not treated as ready and retries are bounded', async () => {
  let calls = 0;
  assert.equal(await wakeService('ml', { retryDelayMs: 0, fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ status: 'degraded' }) };
  } }), false);
  assert.equal(calls, 3);
});

test('unmount aborts in-flight requests without retrying', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = wakeService('ml', { signal: controller.signal, fetchImpl: (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  } });
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(calls, 1);
});
