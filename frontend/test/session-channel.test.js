import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastChannel } from 'node:worker_threads';
import { createSessionChannel } from '../src/context/sessionChannel.js';

const channels = [];
const session = { token: 'test-session-token', user: { id: 'student-account' } };
function open(channelName, options = {}) {
  const channel = createSessionChannel({
    channelName, Channel: BroadcastChannel, readSession: () => null, ...options,
  });
  channels.push(channel);
  return channel;
}
afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
});

test('a fresh email tab retrieves the session from an already signed-in tab', async () => {
  const name = crypto.randomUUID();
  open(name, { readSession: () => session });
  const emailTab = open(name);
  assert.deepEqual(await emailTab.requestSession(), session);
});

test('a signed-out browser completes discovery without authenticating', async () => {
  const name = crypto.randomUUID();
  open(name);
  const emailTab = open(name, { timeoutMs: 20 });
  assert.equal(await emailTab.requestSession(), null);
});

test('unrelated channel names cannot supply a session', async () => {
  open(crypto.randomUUID(), { readSession: () => session });
  const emailTab = open(crypto.randomUUID(), { timeoutMs: 20 });
  assert.equal(await emailTab.requestSession(), null);
});

test('signing in notifies an already-open login tab to retry session discovery', async () => {
  const name = crypto.randomUUID();
  const signedInTab = open(name, { readSession: () => session });
  let loginTab;
  const discovered = new Promise((resolve) => {
    loginTab = open(name, {
      onSessionAvailable: async () => resolve(await loginTab.requestSession()),
    });
  });
  signedInTab.announceSession();
  assert.deepEqual(await discovered, session);
});

test('logout propagates to another tab and cancels its pending session lookup', async () => {
  const name = crypto.randomUUID();
  let loggedOut = false;
  const originalTab = open(name);
  const emailTab = open(name, { onLogout: () => { loggedOut = true; } });
  const pending = emailTab.requestSession();
  originalTab.announceLogout();
  assert.equal(await pending, null);
  assert.equal(loggedOut, true);
});

test('closing a tab resolves pending discovery instead of leaving it loading', async () => {
  const emailTab = open(crypto.randomUUID());
  const pending = emailTab.requestSession();
  emailTab.close();
  channels.pop();
  assert.equal(await pending, null);
});

test('browsers without BroadcastChannel retain the ordinary sign-in flow', async () => {
  const channel = open(crypto.randomUUID(), { Channel: null });
  assert.equal(await channel.requestSession(), null);
  channel.announceSession();
  channel.announceLogout();
});
