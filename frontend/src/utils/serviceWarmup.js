export function healthEndpoints(env = {}) {
  return [
    env.VITE_BACKEND_HEALTH_URL || "/api/health",
    env.VITE_ML_HEALTH_URL || "/api/ml/health",
  ];
}

// Retry each service independently so a sleeping backend never delays ML startup.
export async function wakeService(url, {
  signal,
  fetchImpl = fetch,
  attempts = 3,
  timeoutMs = 45_000,
  retryDelayMs = 3_000,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) return false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.ok && (await response.json()).status === "ok") return true;
    } catch {
      // Render can return a temporary error or HTML page during startup.
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    if (signal?.aborted) return false;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, retryDelayMs);
        signal?.addEventListener("abort", finish, { once: true });
      });
    }
  }
  return false;
}

export function wakeServices(urls, options) {
  return Promise.all(urls.map((url) => wakeService(url, options)));
}
