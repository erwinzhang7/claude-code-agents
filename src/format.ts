/** "12s ago", "3m ago", "2h ago" */
export function relTime(ms?: number, now = Date.now()): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact uptime: "5m", "2h13m", "1d4h" */
export function dur(fromMs?: number, now = Date.now()): string {
  if (!fromMs) return "—";
  let s = Math.max(0, Math.round((now - fromMs) / 1000));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** 518234 -> "518k", 1200000 -> "1.2M" */
export function tokens(n?: number): string {
  if (!n) return "—";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Time until a future epoch-seconds timestamp: "3h2m", "12m", "now". */
export function until(epochSec?: number, nowMs = Date.now()): string {
  if (!epochSec) return "—";
  const s = Math.max(0, epochSec - Math.floor(nowMs / 1000));
  if (s === 0) return "now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** 2.34 -> "$2.34", 0 -> "$0.00", 12.5 -> "$12.50" */
export function money(n?: number): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

/** Context window for a model id (best-effort). */
export function modelWindow(model?: string): number {
  if (!model) return 200_000;
  if (model.includes("[1m]") || model.includes("-1m")) return 1_000_000;
  if (/opus-4|sonnet-4|fable/.test(model)) return 1_000_000;
  return 200_000;
}

/** "claude-opus-4-8" -> "opus-4-8" */
export function shortModel(model?: string): string {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/\[1m\]$/, "");
}

/** Collapse whitespace and clip to width with an ellipsis. */
export function truncate(s: string | undefined, width: number): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= width) return clean;
  return clean.slice(0, Math.max(0, width - 1)) + "…";
}

/** Last path segment of a cwd. */
export function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
