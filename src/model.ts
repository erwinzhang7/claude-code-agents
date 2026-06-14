import { discoverSessions, type Session } from "./discovery.js";
import { enrich, type TranscriptInfo } from "./transcript.js";
import { teedCost } from "./cost.js";

export interface AgentRow extends Session, TranscriptInfo {}

function sortRows(rows: AgentRow[]): AgentRow[] {
  return rows.sort((a, b) => {
    // busy first, then most-recently active
    const ba = a.status === "busy" ? 1 : 0;
    const bb = b.status === "busy" ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

/** Discover live sessions and enrich each from its transcript. */
export async function poll(): Promise<AgentRow[]> {
  const sessions = discoverSessions();
  const rows = await Promise.all(
    sessions.map(async (s): Promise<AgentRow> => {
      try {
        const info = await enrich(s.sessionId, s.cwd);
        // Prefer Claude Code's own figure (teed via statusline) over our estimate.
        const exact = teedCost(s.sessionId);
        return { ...s, ...info, costUsd: exact ?? info.costUsd };
      } catch {
        return { ...s };
      }
    })
  );
  return sortRows(rows);
}
