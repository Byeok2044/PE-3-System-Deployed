// Share an active tab's session without making a non-remembered login persistent.
// BroadcastChannel is restricted by the browser to the same origin.
export function createSessionChannel({
  readSession,
  onSessionAvailable = () => {},
  onLogout = () => {},
  timeoutMs = 800,
  channelName = "eduforecaster_auth",
  Channel = globalThis.BroadcastChannel,
}) {
  if (!Channel) {
    return {
      requestSession: async () => null,
      announceSession() {},
      announceLogout() {},
      close() {},
    };
  }

  const channel = new Channel(channelName);
  const pending = new Map();
  const finish = (id, session) => {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    request.resolve(session);
  };

  channel.onmessage = ({ data }) => {
    if (data?.type === "request-session") {
      const session = readSession();
      if (session?.token) {
        channel.postMessage({ type: "session-response", id: data.id, session });
      }
    } else if (data?.type === "session-response" && data.session?.token) {
      finish(data.id, data.session);
    } else if (data?.type === "session-available") {
      onSessionAvailable();
    } else if (data?.type === "logout") {
      for (const id of pending.keys()) finish(id, null);
      onLogout();
    }
  };

  return {
    requestSession() {
      const id = globalThis.crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(id, null), timeoutMs);
        pending.set(id, { resolve, timer });
        channel.postMessage({ type: "request-session", id });
      });
    },
    announceSession() {
      channel.postMessage({ type: "session-available" });
    },
    announceLogout() {
      channel.postMessage({ type: "logout" });
    },
    close() {
      for (const id of pending.keys()) finish(id, null);
      channel.close();
    },
  };
}
