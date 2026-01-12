// src/lib/events/bus.ts
type Handler = () => void;

const listeners = new Set<Handler>();
const channel =
  typeof window !== "undefined" ? new BroadcastChannel("zs-events") : null;

export function onDashboardInvalidate(h: Handler) {
  listeners.add(h);
  return () => listeners.delete(h);
}

export function emitDashboardInvalidate() {
  // mismo tab
  listeners.forEach((h) => h());
  // otros tabs
  channel?.postMessage({ type: "dashboard.invalidate" });
}

if (channel) {
  channel.onmessage = (ev) => {
    if (ev?.data?.type === "dashboard.invalidate") {
      listeners.forEach((h) => h());
    }
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key) return;
    if (
      e.key.startsWith("zs.cashbox.") ||
      e.key.startsWith("ZS_POS_STORE_") ||
      e.key.startsWith("zs:keys:") ||
      e.key.startsWith("zs.mock.")
    ) {
      listeners.forEach((h) => h());
    }
  });
}
