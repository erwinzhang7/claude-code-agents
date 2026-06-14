import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_DIR = join(homedir(), ".claude");
export const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

/** Raw shape written by Claude Code to ~/.claude/sessions/<pid>.json */
export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number; // ms epoch
  procStart?: string;
  version?: string;
  peerProtocol?: number;
  kind?: string;
  entrypoint?: string;
  status?: "busy" | "idle" | string;
  updatedAt?: number; // ms epoch
}

export interface Session extends SessionFile {
  alive: boolean;
}

/** Is a pid currently running? Signal 0 performs error checking without sending. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Read the live session registry. Drops files whose pid is no longer running
 * (stale leftovers) and silently skips malformed/locked files.
 */
export function discoverSessions(): Session[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const out: Session[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(SESSIONS_DIR, file), "utf8");
      const data = JSON.parse(raw) as SessionFile;
      if (typeof data.pid !== "number" || !data.sessionId) continue;
      if (!isAlive(data.pid)) continue; // stale registry entry
      out.push({ ...data, alive: true });
    } catch {
      // malformed or mid-write — skip this one, keep the rest
    }
  }
  return out;
}
