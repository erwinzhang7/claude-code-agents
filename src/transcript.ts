import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { PROJECTS_DIR } from "./discovery.js";
import { totalCost } from "./cost.js";

/** A subagent transcript is considered "live" if touched within this window. */
const SUBAGENT_LIVE_MS = 15_000;

export interface TranscriptInfo {
  /** First real user prompt — the session's "task". */
  task?: string;
  /** Estimated cumulative session cost in USD (includes subagents). */
  costUsd?: number;
  /** Number of subagent transcripts modified very recently (active fan-out). */
  liveSubagents?: number;
  /** Total subagent transcripts ever spawned by this session. */
  subagentCount?: number;
  /** Approx current context size (input + cache_read + cache_creation) in tokens. */
  contextTokens?: number;
  /** Model id from the last assistant message, e.g. claude-opus-4-8. */
  model?: string;
  /** Last user/assistant text — for the detail view. */
  lastText?: string;
}

// ---- path resolution ---------------------------------------------------------

const pathCache = new Map<string, string | null>();
let indexBuilt = false;
const sessionIndex = new Map<string, string>(); // sessionId -> jsonl path

/** Derive the project slug Claude uses: leading "/" and inner "/" both become "-". */
function deriveSlug(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** One-time scan to map any sessionId to its transcript, for slug misses. */
function buildIndex(): void {
  indexBuilt = true;
  let projects: string[];
  try {
    projects = readdirSync(PROJECTS_DIR);
  } catch {
    return;
  }
  for (const proj of projects) {
    const dir = join(PROJECTS_DIR, proj);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith(".jsonl")) {
        sessionIndex.set(e.slice(0, -".jsonl".length), join(dir, e));
      }
    }
  }
}

export function transcriptPath(sessionId: string, cwd: string): string | null {
  if (pathCache.has(sessionId)) return pathCache.get(sessionId)!;

  const direct = join(PROJECTS_DIR, deriveSlug(cwd), `${sessionId}.jsonl`);
  let resolved: string | null = null;
  if (existsSync(direct)) {
    resolved = direct;
  } else {
    if (!indexBuilt) buildIndex();
    resolved = sessionIndex.get(sessionId) ?? null;
  }
  pathCache.set(sessionId, resolved);
  return resolved;
}

// ---- parsing helpers ---------------------------------------------------------

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && (part as any).type === "text") {
        return (part as any).text as string;
      }
    }
  }
  return undefined;
}

/** First real user message (skip system/tool-result lines that begin with "<"). Cached. */
const taskCache = new Map<string, string | undefined>();

export function firstUserPrompt(path: string, sessionId: string): Promise<string | undefined> {
  if (taskCache.has(sessionId)) return Promise.resolve(taskCache.get(sessionId));

  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let done = false;
    const finish = (val?: string) => {
      if (done) return;
      done = true;
      taskCache.set(sessionId, val);
      rl.close();
      stream.destroy();
      resolve(val);
    };
    rl.on("line", (line) => {
      if (!line) return;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.type !== "user") return;
      const text = extractText(obj.message?.content);
      if (text && !text.startsWith("<")) finish(text.trim());
    });
    rl.on("close", () => finish(undefined));
    rl.on("error", () => finish(undefined));
  });
}

/**
 * Read the tail of the transcript (cheap on multi-MB files) to get the most
 * recent assistant usage, model, and last message text.
 */
export function tailInfo(path: string, tailBytes = 96 * 1024): Promise<Partial<TranscriptInfo>> {
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

    let contextTokens: number | undefined;
    let model: string | undefined;
    let lastText: string | undefined;

    rl.on("line", (line) => {
      if (!line) return;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // first line is likely a partial record — ignore
      }
      const text = extractText(obj.message?.content);
      if ((obj.type === "assistant" || obj.type === "user") && text) {
        lastText = text;
      }
      if (obj.type === "assistant") {
        const u = obj.message?.usage;
        if (u) {
          contextTokens =
            (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0);
        }
        if (obj.message?.model) model = obj.message.model;
      }
    });
    rl.on("close", () => resolve({ contextTokens, model, lastText }));
    rl.on("error", () => resolve({ contextTokens, model, lastText }));
  });
}

/**
 * Subagents and workflows write their transcripts under
 * `<projDir>/<sessionId>/subagents/**\/agent-*.jsonl`. They run inside the
 * parent process (no PID of their own), so we attribute them to the parent.
 */
function subagentFiles(transcriptPath: string, sessionId: string): { path: string; mtimeMs: number }[] {
  const root = join(dirname(transcriptPath), sessionId, "subagents");
  const out: { path: string; mtimeMs: number }[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no subagents dir — fine
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) {
        try {
          out.push({ path: p, mtimeMs: statSync(p).mtimeMs });
        } catch {
          // file vanished mid-scan — skip
        }
      }
    }
  };
  walk(root);
  return out;
}

export async function enrich(sessionId: string, cwd: string): Promise<TranscriptInfo> {
  const path = transcriptPath(sessionId, cwd);
  if (!path) return {};
  const subs = subagentFiles(path, sessionId);
  const now = Date.now();
  const liveSubagents = subs.filter((s) => now - s.mtimeMs < SUBAGENT_LIVE_MS).length;
  const [task, tail, costUsd] = await Promise.all([
    firstUserPrompt(path, sessionId),
    tailInfo(path),
    totalCost([path, ...subs.map((s) => s.path)]),
  ]);
  return { task, costUsd, liveSubagents, subagentCount: subs.length, ...tail };
}
