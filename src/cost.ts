import { open, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DIR } from "./discovery.js";

/**
 * Per-token USD prices by model. cacheWrite is the 5-minute rate (1.25× input);
 * cacheRead is 0.1× input. 1-hour cache writes (2× input) are priced separately
 * when the transcript breaks them out.
 */
interface Price {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

function price(perMillionIn: number, perMillionOut: number): Price {
  const input = perMillionIn / 1_000_000;
  return {
    input,
    output: perMillionOut / 1_000_000,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: input * 0.1,
  };
}

// Source: claude-api skill pricing table (per 1M tokens).
const OPUS = price(5, 25); // opus 4.6/4.7/4.8
const FABLE = price(10, 50);
const SONNET = price(3, 15);
const HAIKU = price(1, 5);

function priceFor(model?: string): Price {
  if (!model) return OPUS;
  if (model.includes("fable")) return FABLE;
  if (model.includes("opus")) return OPUS;
  if (model.includes("sonnet")) return SONNET;
  if (model.includes("haiku")) return HAIKU;
  return OPUS;
}

/** Cost of a single assistant message's usage block. */
function usageCost(usage: any, fallbackModel?: string): number {
  if (!usage) return 0;
  const p = priceFor(fallbackModel);
  const cc = usage.cache_creation ?? {};
  const w5 = cc.ephemeral_5m_input_tokens;
  const w1 = cc.ephemeral_1h_input_tokens;
  // Prefer the 5m/1h breakdown; fall back to the flat cache_creation total (treated as 5m).
  const cacheWrite =
    w5 != null || w1 != null
      ? (w5 ?? 0) * p.cacheWrite5m + (w1 ?? 0) * p.cacheWrite1h
      : (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite5m;
  return (
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    cacheWrite
  );
}

// Incremental accumulator per file: byte offset already summed, running cost,
// and the set of assistant message ids already counted. Claude Code re-logs the
// same assistant message several times (streaming partials + final), so without
// deduping by id the cache-read tokens get counted multiple times.
const state = new Map<string, { offset: number; cost: number; seen: Set<string> }>();

/**
 * Cumulative cost of one transcript file in USD. Reads only bytes appended since
 * the last call (transcripts reach many MB) — the whole file is read once, then
 * only the delta thereafter.
 */
export async function fileCost(path: string): Promise<number> {
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    return state.get(path)?.cost ?? 0;
  }

  let s = state.get(path);
  if (!s || s.offset > size) {
    // First read, or the file was truncated/rotated — start over.
    s = { offset: 0, cost: 0, seen: new Set() };
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
    // Only consume up to the last complete line (newline-terminated).
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) {
      state.set(path, s);
      return s.cost; // no complete line yet
    }
    const text = buf.toString("utf8", 0, lastNl + 1);
    for (const line of text.split("\n")) {
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === "assistant") {
        const id = obj.message?.id;
        // Skip re-logged duplicates of an already-counted message.
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

/** Sum the cost of several transcript files (main session + its subagents). */
export async function totalCost(paths: string[]): Promise<number> {
  const costs = await Promise.all(paths.map((p) => fileCost(p)));
  return costs.reduce((a, b) => a + b, 0);
}

/**
 * Exact session cost as reported by Claude Code itself, if the statusline has
 * teed it to ~/.claude/.agents-cost/<sessionId>.json (see README). This is the
 * authoritative number; our token-sum estimate is the fallback when it's absent.
 */
export function teedCost(sessionId: string): number | null {
  try {
    const raw = readFileSync(join(CLAUDE_DIR, ".agents-cost", `${sessionId}.json`), "utf8");
    const o = JSON.parse(raw);
    return typeof o.cost === "number" ? o.cost : null;
  } catch {
    return null;
  }
}
