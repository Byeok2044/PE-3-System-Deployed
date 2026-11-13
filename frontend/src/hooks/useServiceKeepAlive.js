import { useEffect, useRef } from "react";
import useAdaptivePolling from "./useAdaptivePolling.js";
import { healthEndpoints, wakeServices } from "../utils/serviceWarmup.js";

const INTERVAL_MS = 12 * 60 * 1000;
const HEALTH_ENDPOINTS = healthEndpoints(import.meta.env);

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
    try {
      await wakeServices(HEALTH_ENDPOINTS, { signal: controller.signal });
    } finally {
      requests.current.delete(controller);
    }
  }, { intervalMs: INTERVAL_MS, hiddenIntervalMs: INTERVAL_MS });
}
