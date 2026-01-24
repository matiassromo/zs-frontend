// src/hooks/useDashboard.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getDashboardSnapshot, type DashboardSnapshot } from "@/lib/apiv2/dashboard";
import { onDashboardInvalidate } from "@/lib/events/bus";

export function useDashboard(pollMs = 10000) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      setError(null);
      const snap = await getDashboardSnapshot();
      if (mounted.current) setData(snap);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setLoading(false);
      inFlight.current = false;
    }
  }, [pollMs]); // ok

  useEffect(() => {
    mounted.current = true;

    load();
    const off = onDashboardInvalidate(load);

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    if (pollMs > 0) timer.current = window.setInterval(load, pollMs);

    return () => {
      mounted.current = false;
      off();
      window.removeEventListener("focus", onFocus);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [load, pollMs]);

  return { data, loading, error, reload: load };
}
