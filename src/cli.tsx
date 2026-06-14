import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { layout, COLS, dirLabelLen, subBadge } from "./ui/Row.js";
import { poll } from "./model.js";
import { readRateLimits } from "./ratelimits.js";
import { until } from "./format.js";
import {
  basename,
  dur,
  modelWindow,
  money,
  relTime,
  shortModel,
  tokens,
  truncate,
} from "./format.js";

async function once() {
  const rows = await poll();
  if (rows.length === 0) {
    console.log("No running Claude Code sessions found.");
    return;
  }
  const now = Date.now();
  const pad = (s: string, n: number) => s.padEnd(n);
  // Reuse the TUI layout (status dot prefix is 2 here vs 4 in the TUI).
  const maxDirLen = rows.reduce((m, r) => Math.max(m, dirLabelLen(r)), 3);
  const lay = layout((process.stdout.columns || 120) + 2, maxDirLen);
  console.log(
    pad("S", 2) +
      pad("DIR", lay.dir) +
      pad("TASK", lay.task) +
      pad("CONTEXT", COLS.ctx) +
      pad("UP", COLS.up) +
      pad("ACTIVE", COLS.active) +
      pad("MODEL", COLS.model) +
      "COST"
  );
  for (const r of rows) {
    const ctx =
      r.contextTokens != null
        ? `${tokens(r.contextTokens)}/${tokens(modelWindow(r.model))}`
        : "—";
    const badge = subBadge(r.liveSubagents);
    const dirLabel = badge ? `${basename(r.cwd)} ${badge}` : basename(r.cwd);
    console.log(
      pad(r.status === "busy" ? "●" : "○", 2) +
        pad(truncate(dirLabel, lay.dir - 1), lay.dir) +
        pad(truncate(r.task ?? "(no prompt yet)", lay.task - 1), lay.task) +
        pad(ctx, COLS.ctx) +
        pad(dur(r.startedAt, now), COLS.up) +
        pad(relTime(r.updatedAt, now), COLS.active) +
        pad(shortModel(r.model), COLS.model) +
        money(r.costUsd)
    );
  }

  const rl = readRateLimits();
  const pct = (p?: number | null) => (p == null ? "—" : Math.round(p));
  if (rl && (rl.fiveHourPct != null || rl.weekPct != null)) {
    console.log(
      `\n5hr:${pct(rl.fiveHourPct)}%   resets:${until(rl.fiveHourResetsAt)}` +
        `      wk:${pct(rl.weekPct)}%   resets:${until(rl.weekResetsAt)}`
    );
  }
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`agents — live tracker for running Claude Code sessions

Usage:
  agents            live TUI (auto-refreshes)
  agents --once     print a one-shot snapshot and exit
  agents --help     this help

In the TUI:
  ↑/↓ select   enter detail   r copy resume cmd   o open dir   k kill   q quit`);
  process.exit(0);
} else if (args.includes("--once") || args.includes("-1")) {
  once().then(() => process.exit(0));
} else {
  // Render in the main buffer (not the alternate screen) so the terminal keeps
  // its scrollback — you can scroll up to see what was there before, and the
  // final frame stays on screen after exit. Ink redraws its block in place each
  // tick and exits on Ctrl-C. This matches how Claude Code's own UI behaves.
  const { waitUntilExit } = render(<App />);
  waitUntilExit().then(() => process.exit(0));
}
