const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { publicUrl } = require('../src/utils/publicUrl');
const keys = ['NODE_ENV', 'PUBLIC_APP_URL', 'PUBLIC_API_URL', 'CLIENT_ORIGIN', 'RENDER_EXTERNAL_URL'];
let original;
beforeEach(() => {
  original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.NODE_ENV = 'production';
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('Render image links use the backend external URL when no explicit API URL is configured', () => {
  process.env.RENDER_EXTERNAL_URL = 'https://backend.onrender.com';
  assert.equal(publicUrl('/api/email-assets/trajectory/snapshot.png', { api: true }), 'https://backend.onrender.com/api/email-assets/trajectory/snapshot.png');
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  assert.equal(publicUrl('/api/health', { api: true }), 'https://api.example.test/api/health');
  assert.throws(() => publicUrl('/verify-email/token'), /application.*not configured/);
});

test('frontend links select one public origin and never fall back to localhost in production', () => {
  process.env.CLIENT_ORIGIN = ' , https://frontend.onrender.com/?old=1#old,https://other.example.test';
  assert.equal(publicUrl('/reset-password/token'), 'https://frontend.onrender.com/reset-password/token');
  process.env.PUBLIC_APP_URL = 'http://localhost:3000';
  assert.throws(() => publicUrl('/verify-email/token'), /public HTTPS/);
});
