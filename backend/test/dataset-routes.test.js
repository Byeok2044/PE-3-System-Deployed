const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const router = require('../src/routes/datasetRoutes');

let originalGet;

beforeEach(() => {
  originalGet = axios.get;
});

afterEach(() => {
  axios.get = originalGet;
});

// Exercise the registered Express handlers without opening network sockets.
// This also ensures the public routes do not contain login middleware.
async function request(path, query = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  assert.ok(route?.methods.get);
  assert.equal(route.stack.length, 1);
  const response = {
    statusCode: 200, headers: {}, body: null,
    set(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  await route.stack[0].handle({ query }, response);
  return response;
}

test('historical summary is readable without a student login', async () => {
  axios.get = async (url) => {
    assert.ok(url.endsWith('/dataset/summary'));
    return { data: { counts: { original: 4424, cleaned: 4244 } } };
  };
  const response = await request('/summary');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.counts.cleaned, 4244);
});

test('rows forward only supported query fields to a fixed historical endpoint', async () => {
  axios.get = async (url, options) => {
    assert.ok(url.endsWith('/dataset/rows'));
    assert.deepEqual(options.params, { view: 'excluded', page: '2', search: 'SRC-000003' });
    return { data: { rows: [], total: 0 } };
  };
  const response = await request('/rows', { view: 'excluded', page: '2', search: 'SRC-000003', file: 'private.csv', studentId: '123' });
  assert.equal(response.statusCode, 200);
});

test('CSV download keeps attachment and CSV headers', async () => {
  axios.get = async (_url, options) => {
    assert.equal(options.responseType, 'arraybuffer');
    return { data: Buffer.from('Source row,Target\nSRC-000001,Graduate\n'), headers: { 'content-disposition': 'attachment; filename="retainify-dataset-cleaned.csv"' } };
  };
  const response = await request('/download', { view: 'cleaned' });
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.match(response.body.toString(), /SRC-000001/);
});

test('upstream validation and service failures return readable errors', async () => {
  axios.get = async () => { throw { response: { status: 422 } }; };
  assert.equal((await request('/rows', { pageSize: '1000' })).statusCode, 422);
  axios.get = async () => { throw new Error('Connection refused'); };
  const response = await request('/summary');
  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /historical dataset is unavailable/);
});
