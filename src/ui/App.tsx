import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import clipboardy from "clipboardy";
import { poll, type AgentRow } from "../model.js";
import { readRateLimits, type RateLimits } from "../ratelimits.js";
import { HeaderRow, Row, layout, dirLabelLen } from "./Row.js";
import { Detail } from "./Detail.js";
import { UsageLine } from "./UsageLine.js";

const REFRESH_MS = 1000;

export function App() {
  const { exit } = useApp();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [rl, setRl] = useState<RateLimits | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const [confirmKill, setConfirmKill] = useState(false);

  // poll loop
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

  // keep selection in range as rows come and go
  useEffect(() => {
    if (sel >= rows.length) setSel(Math.max(0, rows.length - 1));
  }, [rows.length, sel]);

  const flashMsg = (m: string) => {
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
          flashMsg(`Kill failed: ${(e as Error).message}`);
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
      clipboardy
        .write(cmd)
        .then(() => flashMsg(`Copied: ${cmd}`))
        .catch(() => flashMsg("Clipboard copy failed"));
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

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Claude Code sessions </Text>
        <Text color="green">● {busyCount} busy</Text>
        <Text dimColor>  ○ {rows.length - busyCount} idle  ({rows.length} total)</Text>
      </Box>

      <HeaderRow lay={lay} />
      {rows.length === 0 ? (
        <Text dimColor>No running Claude Code sessions found.</Text>
      ) : (
        rows.map((r, i) => (
          <Row key={r.pid} row={r} selected={i === sel} now={now} lay={lay} />
        ))
      )}

      {showDetail && current ? (
        <Box marginTop={1}>
          <Detail row={current} now={now} />
        </Box>
      ) : null}

      <Box marginTop={1}>
        {confirmKill && current ? (
          <Text color="yellow">
            Kill pid {current.pid} ({current.cwd})?  press y to confirm, any key to cancel
          </Text>
        ) : flash ? (
          <Text color="cyan">{flash}</Text>
        ) : (
          <Text dimColor>
            ↑/↓ select   →/enter detail   ← collapse   r copy resume   o open dir   k kill session   ctrl-c exit
          </Text>
        )}
      </Box>

      <Box>
        <UsageLine rl={rl} now={now} />
      </Box>
    </Box>
  );
}
