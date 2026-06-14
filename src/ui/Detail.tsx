import React from "react";
import { Box, Text } from "ink";
import type { AgentRow } from "../model.js";
import { dur, modelWindow, money, relTime, shortModel, tokens, truncate } from "../format.js";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(10)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

export function Detail({ row, now }: { row: AgentRow; now: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {row.status === "busy" ? "● busy" : "○ idle"}  {row.cwd}
      </Text>
      <Box height={1} />
      <Field label="Task" value={truncate(row.task ?? "(no prompt yet)", 100)} />
      <Field
        label="Context"
        value={
          row.contextTokens != null
            ? `${tokens(row.contextTokens)} / ${tokens(modelWindow(row.model))}`
            : "—"
        }
      />
      <Field label="Model" value={shortModel(row.model)} />
      <Field label="Cost" value={money(row.costUsd)} />
      {row.subagentCount ? (
        <Field
          label="Subagents"
          value={`${row.liveSubagents ?? 0} active / ${row.subagentCount} total`}
        />
      ) : null}
      <Field label="Uptime" value={dur(row.startedAt, now)} />
      <Field label="Active" value={relTime(row.updatedAt, now)} />
      <Field label="Version" value={row.version ?? "—"} />
      <Field label="PID" value={String(row.pid)} />
      <Field label="Session" value={row.sessionId} />
      {row.lastText ? (
        <>
          <Box height={1} />
          <Text dimColor>Last message:</Text>
          <Text>{truncate(row.lastText, 240)}</Text>
        </>
      ) : null}
    </Box>
  );
}
