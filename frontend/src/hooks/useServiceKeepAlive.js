import { useEffect, useRef } from "react";
import useAdaptivePolling from "./useAdaptivePolling.js";

const INTERVAL_MS = 12 * 60 * 1000;
const HEALTH_ENDPOINTS = ["/api/health", "/api/ml/health"];

export default function useServiceKeepAlive() {
  const requests = useRef(new Set());

  useEffect(() => () => {
    for (const controller of requests.current) controller.abort();
    requests.current.clear();
  }, []);

  useAdaptivePolling(async () => {
    if (navigator.onLine === false) return;
    const controller = new AbortController();
    requests.current.add(controller);
    // Allow time for both the backend and ML service to wake from a cold start.
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      await Promise.allSettled(HEALTH_ENDPOINTS.map(async (url) => {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        await response.text();
      }));
    } finally {
      window.clearTimeout(timeout);
      requests.current.delete(controller);
    }
  }, { intervalMs: INTERVAL_MS, hiddenIntervalMs: INTERVAL_MS });
}
