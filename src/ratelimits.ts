import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DIR } from "./discovery.js";

/**
 * Claude Code computes subscription rate-limit usage in memory and only pipes it
 * to the statusline at render time — it isn't persisted anywhere. So the user's
 * statusline script tees it here (see README "Usage line"); we read that cache.
 */
export const RATELIMITS_FILE = join(CLAUDE_DIR, ".agents-ratelimits.json");

export interface RateLimits {
  fiveHourPct?: number;
  weekPct?: number;
  /** Epoch seconds when the 5-hour window resets. */
  fiveHourResetsAt?: number;
  /** Epoch seconds when the weekly window resets. */
  weekResetsAt?: number;
  /** Epoch seconds when this snapshot was written by the statusline. */
  capturedAt?: number;
}

export function readRateLimits(): RateLimits | null {
  let raw: string;
  try {
    raw = readFileSync(RATELIMITS_FILE, "utf8");
  } catch {
    return null; // statusline tee not set up, or no session has rendered yet
  }
  try {
    const o = JSON.parse(raw);
    const rl = o.rate_limits ?? {};
    return {
      fiveHourPct: rl.five_hour?.used_percentage,
      weekPct: rl.seven_day?.used_percentage,
      fiveHourResetsAt: rl.five_hour?.resets_at,
      weekResetsAt: rl.seven_day?.resets_at,
      capturedAt: o.at,
    };
  } catch {
    return null;
  }
}
