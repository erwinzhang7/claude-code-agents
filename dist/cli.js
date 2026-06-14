#!/usr/bin/env node

// src/cli.tsx
import { render } from "ink";

// src/ui/App.tsx
import { useEffect, useState } from "react";
import { Box as Box4, Text as Text4, useApp, useInput } from "ink";
import { spawn } from "child_process";
import clipboardy from "clipboardy";

// src/discovery.ts
import { readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CLAUDE_DIR = join(homedir(), ".claude");
var SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
var PROJECTS_DIR = join(CLAUDE_DIR, "projects");
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function discoverSessions() {
  let files;
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(SESSIONS_DIR, file), "utf8");
      const data = JSON.parse(raw);
      if (typeof data.pid !== "number" || !data.sessionId) continue;
      if (!isAlive(data.pid)) continue;
      out.push({ ...data, alive: true });
    } catch {
    }
  }
  return out;
}

// src/transcript.ts
import { createReadStream, existsSync, readdirSync as readdirSync2, statSync } from "fs";
import { dirname, join as join3 } from "path";
import { createInterface } from "readline";

// src/cost.ts
import { open, stat } from "fs/promises";
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
function price(perMillionIn, perMillionOut) {
  const input = perMillionIn / 1e6;
  return {
    input,
    output: perMillionOut / 1e6,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: input * 0.1
  };
}
var OPUS = price(5, 25);
var FABLE = price(10, 50);
var SONNET = price(3, 15);
var HAIKU = price(1, 5);
function priceFor(model) {
  if (!model) return OPUS;
  if (model.includes("fable")) return FABLE;
  if (model.includes("opus")) return OPUS;
  if (model.includes("sonnet")) return SONNET;
  if (model.includes("haiku")) return HAIKU;
  return OPUS;
}
function usageCost(usage, fallbackModel) {
  if (!usage) return 0;
  const p = priceFor(fallbackModel);
  const cc = usage.cache_creation ?? {};
  const w5 = cc.ephemeral_5m_input_tokens;
  const w1 = cc.ephemeral_1h_input_tokens;
  const cacheWrite = w5 != null || w1 != null ? (w5 ?? 0) * p.cacheWrite5m + (w1 ?? 0) * p.cacheWrite1h : (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite5m;
  return (usage.input_tokens ?? 0) * p.input + (usage.output_tokens ?? 0) * p.output + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + cacheWrite;
}
var state = /* @__PURE__ */ new Map();
async function fileCost(path) {
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    return state.get(path)?.cost ?? 0;
  }
  let s = state.get(path);
  if (!s || s.offset > size) {
    s = { offset: 0, cost: 0, seen: /* @__PURE__ */ new Set() };
  }
  if (size <= s.offset) {
    state.set(path, s);
    return s.cost;
  }
  const fh = await open(path, "r");
  try {
    const len = size - s.offset;
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, s.offset);
    const lastNl = buf.lastIndexOf(10);
    if (lastNl === -1) {
      state.set(path, s);
      return s.cost;
    }
    const text = buf.toString("utf8", 0, lastNl + 1);
    for (const line of text.split("\n")) {
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === "assistant") {
        const id = obj.message?.id;
        if (id && s.seen.has(id)) continue;
        if (id) s.seen.add(id);
        s.cost += usageCost(obj.message?.usage, obj.message?.model);
      }
    }
    s.offset += Buffer.byteLength(text, "utf8");
    state.set(path, s);
    return s.cost;
  } finally {
    await fh.close();
  }
}
async function totalCost(paths) {
  const costs = await Promise.all(paths.map((p) => fileCost(p)));
  return costs.reduce((a, b) => a + b, 0);
}
function teedCost(sessionId) {
  try {
    const raw = readFileSync2(join2(CLAUDE_DIR, ".agents-cost", `${sessionId}.json`), "utf8");
    const o = JSON.parse(raw);
    return typeof o.cost === "number" ? o.cost : null;
  } catch {
    return null;
  }
}

// src/transcript.ts
var SUBAGENT_LIVE_MS = 15e3;
var pathCache = /* @__PURE__ */ new Map();
var indexBuilt = false;
var sessionIndex = /* @__PURE__ */ new Map();
function deriveSlug(cwd) {
  return cwd.replace(/\//g, "-");
}
function buildIndex() {
  indexBuilt = true;
  let projects;
  try {
    projects = readdirSync2(PROJECTS_DIR);
  } catch {
    return;
  }
  for (const proj of projects) {
    const dir = join3(PROJECTS_DIR, proj);
    let entries;
    try {
      entries = readdirSync2(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith(".jsonl")) {
        sessionIndex.set(e.slice(0, -".jsonl".length), join3(dir, e));
      }
    }
  }
}
function transcriptPath(sessionId, cwd) {
  if (pathCache.has(sessionId)) return pathCache.get(sessionId);
  const direct = join3(PROJECTS_DIR, deriveSlug(cwd), `${sessionId}.jsonl`);
  let resolved = null;
  if (existsSync(direct)) {
    resolved = direct;
  } else {
    if (!indexBuilt) buildIndex();
    resolved = sessionIndex.get(sessionId) ?? null;
  }
  pathCache.set(sessionId, resolved);
  return resolved;
}
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && part.type === "text") {
        return part.text;
      }
    }
  }
  return void 0;
}
var taskCache = /* @__PURE__ */ new Map();
function firstUserPrompt(path, sessionId) {
  if (taskCache.has(sessionId)) return Promise.resolve(taskCache.get(sessionId));
  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      taskCache.set(sessionId, val);
      rl.close();
      stream.destroy();
      resolve(val);
    };
    rl.on("line", (line) => {
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.type !== "user") return;
      const text = extractText(obj.message?.content);
      if (text && !text.startsWith("<")) finish(text.trim());
    });
    rl.on("close", () => finish(void 0));
    rl.on("error", () => finish(void 0));
  });
}
function tailInfo(path, tailBytes = 96 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      resolve({});
      return;
    }
    const start = Math.max(0, size - tailBytes);
    const stream = createReadStream(path, { encoding: "utf8", start });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let contextTokens;
    let model;
    let lastText;
    rl.on("line", (line) => {
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      const text = extractText(obj.message?.content);
      if ((obj.type === "assistant" || obj.type === "user") && text) {
        lastText = text;
      }
      if (obj.type === "assistant") {
        const u = obj.message?.usage;
        if (u) {
          contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        }
        if (obj.message?.model) model = obj.message.model;
      }
    });
    rl.on("close", () => resolve({ contextTokens, model, lastText }));
    rl.on("error", () => resolve({ contextTokens, model, lastText }));
  });
}
function subagentFiles(transcriptPath2, sessionId) {
  const root = join3(dirname(transcriptPath2), sessionId, "subagents");
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join3(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) {
        try {
          out.push({ path: p, mtimeMs: statSync(p).mtimeMs });
        } catch {
        }
      }
    }
  };
  walk(root);
  return out;
}
async function enrich(sessionId, cwd) {
  const path = transcriptPath(sessionId, cwd);
  if (!path) return {};
  const subs = subagentFiles(path, sessionId);
  const now = Date.now();
  const liveSubagents = subs.filter((s) => now - s.mtimeMs < SUBAGENT_LIVE_MS).length;
  const [task, tail, costUsd] = await Promise.all([
    firstUserPrompt(path, sessionId),
    tailInfo(path),
    totalCost([path, ...subs.map((s) => s.path)])
  ]);
  return { task, costUsd, liveSubagents, subagentCount: subs.length, ...tail };
}

// src/model.ts
function sortRows(rows) {
  return rows.sort((a, b) => {
    const ba = a.status === "busy" ? 1 : 0;
    const bb = b.status === "busy" ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}
async function poll() {
  const sessions = discoverSessions();
  const rows = await Promise.all(
    sessions.map(async (s) => {
      try {
        const info = await enrich(s.sessionId, s.cwd);
        const exact = teedCost(s.sessionId);
        return { ...s, ...info, costUsd: exact ?? info.costUsd };
      } catch {
        return { ...s };
      }
    })
  );
  return sortRows(rows);
}

// src/ratelimits.ts
import { readFileSync as readFileSync3 } from "fs";
import { join as join4 } from "path";
var RATELIMITS_FILE = join4(CLAUDE_DIR, ".agents-ratelimits.json");
function readRateLimits() {
  let raw;
  try {
    raw = readFileSync3(RATELIMITS_FILE, "utf8");
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(raw);
    const rl = o.rate_limits ?? {};
    return {
      fiveHourPct: rl.five_hour?.used_percentage,
      weekPct: rl.seven_day?.used_percentage,
      fiveHourResetsAt: rl.five_hour?.resets_at,
      weekResetsAt: rl.seven_day?.resets_at,
      capturedAt: o.at
    };
  } catch {
    return null;
  }
}

// src/ui/Row.tsx
import { Box, Text } from "ink";

// src/format.ts
function relTime(ms, now = Date.now()) {
  if (!ms) return "\u2014";
  const s = Math.max(0, Math.round((now - ms) / 1e3));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function dur(fromMs, now = Date.now()) {
  if (!fromMs) return "\u2014";
  let s = Math.max(0, Math.round((now - fromMs) / 1e3));
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
function tokens(n) {
  if (!n) return "\u2014";
  if (n < 1e3) return `${n}`;
  if (n < 1e6) return `${Math.round(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function until(epochSec, nowMs = Date.now()) {
  if (!epochSec) return "\u2014";
  const s = Math.max(0, epochSec - Math.floor(nowMs / 1e3));
  if (s === 0) return "now";
  const d = Math.floor(s / 86400);
  const h = Math.floor(s % 86400 / 3600);
  const m = Math.floor(s % 3600 / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
function money(n) {
  if (n == null) return "\u2014";
  return `$${n.toFixed(2)}`;
}
function modelWindow(model) {
  if (!model) return 2e5;
  if (model.includes("[1m]") || model.includes("-1m")) return 1e6;
  if (/opus-4|sonnet-4|fable/.test(model)) return 1e6;
  return 2e5;
}
function shortModel(model) {
  if (!model) return "\u2014";
  return model.replace(/^claude-/, "").replace(/\[1m\]$/, "");
}
function truncate(s, width) {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= width) return clean;
  return clean.slice(0, Math.max(0, width - 1)) + "\u2026";
}
function basename(p) {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

// src/ui/Row.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var COLS = {
  prefix: 4,
  // cursor + status dot, e.g. "› ● "
  ctx: 12,
  up: 9,
  active: 12,
  model: 12,
  cost: 7
};
var FIXED = COLS.prefix + COLS.ctx + COLS.up + COLS.active + COLS.model + COLS.cost;
function subBadge(live) {
  return live && live > 0 ? `\u2282${live}` : "";
}
function dirLabelLen(row) {
  const badge = subBadge(row.liveSubagents);
  return basename(row.cwd).length + (badge ? badge.length + 1 : 0);
}
function layout(cols, maxDirLen) {
  const avail = Math.max(20, cols - 3 - FIXED);
  const dir = Math.min(28, Math.max(8, maxDirLen + 1), Math.max(8, avail - 8));
  const task = Math.min(40, Math.max(8, avail - dir));
  return { dir, task };
}
function HeaderRow({ lay }) {
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: " ".padEnd(COLS.prefix) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "DIR".padEnd(lay.dir) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "TASK".padEnd(lay.task) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "CONTEXT".padEnd(COLS.ctx) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "UP".padEnd(COLS.up) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "ACTIVE".padEnd(COLS.active) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "MODEL".padEnd(COLS.model) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "COST".padEnd(COLS.cost) })
  ] });
}
function Row({
  row,
  selected,
  now,
  lay
}) {
  const busy = row.status === "busy";
  const dot = busy ? "\u25CF" : "\u25CB";
  const dotColor = busy ? "green" : "gray";
  const ctx = row.contextTokens != null ? `${tokens(row.contextTokens)}/${tokens(modelWindow(row.model))}` : "\u2014";
  const cursor = selected ? "\u203A" : " ";
  const badge = subBadge(row.liveSubagents);
  const nameRoom = lay.dir - (badge ? badge.length + 1 : 0) - 1;
  const name = truncate(basename(row.cwd), nameRoom);
  const dirUsed = name.length + (badge ? badge.length + 1 : 0);
  const dirPad = " ".repeat(Math.max(0, lay.dir - dirUsed));
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsxs(Text, { color: selected ? "cyan" : void 0, children: [
      cursor,
      " "
    ] }),
    /* @__PURE__ */ jsxs(Text, { color: dotColor, children: [
      dot,
      " "
    ] }),
    /* @__PURE__ */ jsx(Text, { color: selected ? "cyan" : "white", bold: selected, children: name }),
    badge ? /* @__PURE__ */ jsx(Text, { color: "magenta", children: " " + badge }) : null,
    /* @__PURE__ */ jsx(Text, { children: dirPad }),
    /* @__PURE__ */ jsx(Text, { color: selected ? "cyan" : void 0, children: truncate(row.task ?? "(no prompt yet)", lay.task - 1).padEnd(lay.task) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: ctx.padEnd(COLS.ctx) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: dur(row.startedAt, now).padEnd(COLS.up) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: relTime(row.updatedAt, now).padEnd(COLS.active) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: shortModel(row.model).padEnd(COLS.model) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: money(row.costUsd).padEnd(COLS.cost) })
  ] });
}

// src/ui/Detail.tsx
import { Box as Box2, Text as Text2 } from "ink";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function Field({ label, value }) {
  return /* @__PURE__ */ jsxs2(Box2, { children: [
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: label.padEnd(10) }),
    /* @__PURE__ */ jsx2(Text2, { children: value })
  ] });
}
function Detail({ row, now }) {
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1, children: [
    /* @__PURE__ */ jsxs2(Text2, { bold: true, color: "cyan", children: [
      row.status === "busy" ? "\u25CF busy" : "\u25CB idle",
      "  ",
      row.cwd
    ] }),
    /* @__PURE__ */ jsx2(Box2, { height: 1 }),
    /* @__PURE__ */ jsx2(Field, { label: "Task", value: truncate(row.task ?? "(no prompt yet)", 100) }),
    /* @__PURE__ */ jsx2(
      Field,
      {
        label: "Context",
        value: row.contextTokens != null ? `${tokens(row.contextTokens)} / ${tokens(modelWindow(row.model))}` : "\u2014"
      }
    ),
    /* @__PURE__ */ jsx2(Field, { label: "Model", value: shortModel(row.model) }),
    /* @__PURE__ */ jsx2(Field, { label: "Cost", value: money(row.costUsd) }),
    row.subagentCount ? /* @__PURE__ */ jsx2(
      Field,
      {
        label: "Subagents",
        value: `${row.liveSubagents ?? 0} active / ${row.subagentCount} total`
      }
    ) : null,
    /* @__PURE__ */ jsx2(Field, { label: "Uptime", value: dur(row.startedAt, now) }),
    /* @__PURE__ */ jsx2(Field, { label: "Active", value: relTime(row.updatedAt, now) }),
    /* @__PURE__ */ jsx2(Field, { label: "Version", value: row.version ?? "\u2014" }),
    /* @__PURE__ */ jsx2(Field, { label: "PID", value: String(row.pid) }),
    /* @__PURE__ */ jsx2(Field, { label: "Session", value: row.sessionId }),
    row.lastText ? /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Box2, { height: 1 }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Last message:" }),
      /* @__PURE__ */ jsx2(Text2, { children: truncate(row.lastText, 240) })
    ] }) : null
  ] });
}

// src/ui/UsageLine.tsx
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function pctColor(p) {
  if (p == null) return void 0;
  if (p >= 90) return "red";
  if (p >= 70) return "yellow";
  return "green";
}
var pct = (p) => p == null ? "\u2014" : `${Math.round(p)}`;
function UsageLine({ rl, now }) {
  if (!rl || rl.fiveHourPct == null && rl.weekPct == null) {
    return /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "usage: waiting for statusline data (keep a Claude session open)" });
  }
  const stale = rl.capturedAt != null && now / 1e3 - rl.capturedAt > 120;
  return /* @__PURE__ */ jsxs3(Box3, { children: [
    /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "5hr:" }),
    /* @__PURE__ */ jsxs3(Text3, { color: pctColor(rl.fiveHourPct), children: [
      pct(rl.fiveHourPct),
      "%"
    ] }),
    /* @__PURE__ */ jsxs3(Text3, { dimColor: true, children: [
      "   resets:",
      until(rl.fiveHourResetsAt, now)
    ] }),
    /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "      wk:" }),
    /* @__PURE__ */ jsxs3(Text3, { color: pctColor(rl.weekPct), children: [
      pct(rl.weekPct),
      "%"
    ] }),
    /* @__PURE__ */ jsxs3(Text3, { dimColor: true, children: [
      "   resets:",
      until(rl.weekResetsAt, now)
    ] }),
    stale ? /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: " (stale)" }) : null
  ] });
}

// src/ui/App.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var REFRESH_MS = 1e3;
function App() {
  const { exit } = useApp();
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [rl, setRl] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [flash, setFlash] = useState("");
  const [confirmKill, setConfirmKill] = useState(false);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await poll();
      if (active) {
        setRows(next);
        setRl(readRateLimits());
        setNow(Date.now());
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (sel >= rows.length) setSel(Math.max(0, rows.length - 1));
  }, [rows.length, sel]);
  const flashMsg = (m) => {
    setFlash(m);
    setTimeout(() => setFlash(""), 2500);
  };
  const current = rows[sel];
  useInput((input, key) => {
    if (confirmKill) {
      if (input === "y" && current) {
        try {
          process.kill(current.pid, "SIGTERM");
          flashMsg(`Sent SIGTERM to pid ${current.pid}`);
        } catch (e) {
          flashMsg(`Kill failed: ${e.message}`);
        }
      }
      setConfirmKill(false);
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) setSel((s) => Math.min(rows.length - 1, s + 1));
    if (key.return) setShowDetail((d) => !d);
    if (key.rightArrow) setShowDetail(true);
    if (key.leftArrow) setShowDetail(false);
    if (!current) return;
    if (input === "r") {
      const cmd = `claude --resume ${current.sessionId}`;
      clipboardy.write(cmd).then(() => flashMsg(`Copied: ${cmd}`)).catch(() => flashMsg("Clipboard copy failed"));
    }
    if (input === "o") {
      spawn("open", [current.cwd], { stdio: "ignore", detached: true }).unref();
      flashMsg(`Opened ${current.cwd}`);
    }
    if (input === "k") {
      setConfirmKill(true);
    }
  });
  const busyCount = rows.filter((r) => r.status === "busy").length;
  const maxDirLen = rows.reduce((m, r) => Math.max(m, dirLabelLen(r)), 3);
  const lay = layout(process.stdout.columns || 100, maxDirLen);
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", paddingX: 1, children: [
    /* @__PURE__ */ jsxs4(Box4, { marginBottom: 1, children: [
      /* @__PURE__ */ jsx4(Text4, { bold: true, children: "Claude Code sessions " }),
      /* @__PURE__ */ jsxs4(Text4, { color: "green", children: [
        "\u25CF ",
        busyCount,
        " busy"
      ] }),
      /* @__PURE__ */ jsxs4(Text4, { dimColor: true, children: [
        "  \u25CB ",
        rows.length - busyCount,
        " idle  (",
        rows.length,
        " total)"
      ] })
    ] }),
    /* @__PURE__ */ jsx4(HeaderRow, { lay }),
    rows.length === 0 ? /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "No running Claude Code sessions found." }) : rows.map((r, i) => /* @__PURE__ */ jsx4(Row, { row: r, selected: i === sel, now, lay }, r.pid)),
    showDetail && current ? /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Detail, { row: current, now }) }) : null,
    /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: confirmKill && current ? /* @__PURE__ */ jsxs4(Text4, { color: "yellow", children: [
      "Kill pid ",
      current.pid,
      " (",
      current.cwd,
      ")?  press y to confirm, any key to cancel"
    ] }) : flash ? /* @__PURE__ */ jsx4(Text4, { color: "cyan", children: flash }) : /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "\u2191/\u2193 select   \u2192/enter detail   \u2190 collapse   r copy resume   o open dir   k kill session   ctrl-c exit" }) }),
    /* @__PURE__ */ jsx4(Box4, { children: /* @__PURE__ */ jsx4(UsageLine, { rl, now }) })
  ] });
}

// src/cli.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
async function once() {
  const rows = await poll();
  if (rows.length === 0) {
    console.log("No running Claude Code sessions found.");
    return;
  }
  const now = Date.now();
  const pad = (s, n) => s.padEnd(n);
  const maxDirLen = rows.reduce((m, r) => Math.max(m, dirLabelLen(r)), 3);
  const lay = layout((process.stdout.columns || 120) + 2, maxDirLen);
  console.log(
    pad("S", 2) + pad("DIR", lay.dir) + pad("TASK", lay.task) + pad("CONTEXT", COLS.ctx) + pad("UP", COLS.up) + pad("ACTIVE", COLS.active) + pad("MODEL", COLS.model) + "COST"
  );
  for (const r of rows) {
    const ctx = r.contextTokens != null ? `${tokens(r.contextTokens)}/${tokens(modelWindow(r.model))}` : "\u2014";
    const badge = subBadge(r.liveSubagents);
    const dirLabel = badge ? `${basename(r.cwd)} ${badge}` : basename(r.cwd);
    console.log(
      pad(r.status === "busy" ? "\u25CF" : "\u25CB", 2) + pad(truncate(dirLabel, lay.dir - 1), lay.dir) + pad(truncate(r.task ?? "(no prompt yet)", lay.task - 1), lay.task) + pad(ctx, COLS.ctx) + pad(dur(r.startedAt, now), COLS.up) + pad(relTime(r.updatedAt, now), COLS.active) + pad(shortModel(r.model), COLS.model) + money(r.costUsd)
    );
  }
  const rl = readRateLimits();
  const pct2 = (p) => p == null ? "\u2014" : Math.round(p);
  if (rl && (rl.fiveHourPct != null || rl.weekPct != null)) {
    console.log(
      `
5hr:${pct2(rl.fiveHourPct)}%   resets:${until(rl.fiveHourResetsAt)}      wk:${pct2(rl.weekPct)}%   resets:${until(rl.weekResetsAt)}`
    );
  }
}
var args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`agents \u2014 live tracker for running Claude Code sessions

Usage:
  agents            live TUI (auto-refreshes)
  agents --once     print a one-shot snapshot and exit
  agents --help     this help

In the TUI:
  \u2191/\u2193 select   enter detail   r copy resume cmd   o open dir   k kill   q quit`);
  process.exit(0);
} else if (args.includes("--once") || args.includes("-1")) {
  once().then(() => process.exit(0));
} else {
  const { waitUntilExit } = render(/* @__PURE__ */ jsx5(App, {}));
  waitUntilExit().then(() => process.exit(0));
}
