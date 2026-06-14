import React from "react";
import { Box, Text } from "ink";
import type { AgentRow } from "../model.js";
import {
  basename,
  dur,
  modelWindow,
  money,
  relTime,
  shortModel,
  tokens,
  truncate,
} from "../format.js";

// Fixed numeric columns — each width carries a roomy gutter so they breathe.
export const COLS = {
  prefix: 4, // cursor + status dot, e.g. "› ● "
  ctx: 12,
  up: 9,
  active: 12,
  model: 12,
  cost: 7,
};

const FIXED = COLS.prefix + COLS.ctx + COLS.up + COLS.active + COLS.model + COLS.cost;

export interface Layout {
  dir: number;
  task: number;
}

/** Badge shown next to a dir when it has active subagents, e.g. "⊂3". */
export function subBadge(live?: number): string {
  return live && live > 0 ? `⊂${live}` : "";
}

/** Display width of a row's DIR cell content (name + optional subagent badge). */
export function dirLabelLen(row: AgentRow): number {
  const badge = subBadge(row.liveSubagents);
  return basename(row.cwd).length + (badge ? badge.length + 1 : 0);
}

/**
 * Size DIR to the widest actual label (so TASK sits right next to it, no dead
 * gap), then give the rest to TASK, capped so it never balloons. Both shrink
 * gracefully on narrow terminals without overflowing.
 */
export function layout(cols: number, maxDirLen: number): Layout {
  const avail = Math.max(20, cols - 3 - FIXED); // -3: paddingX(2) + 1 safety margin
  const dir = Math.min(28, Math.max(8, maxDirLen + 1), Math.max(8, avail - 8));
  const task = Math.min(40, Math.max(8, avail - dir));
  return { dir, task };
}

export function HeaderRow({ lay }: { lay: Layout }) {
  return (
    <Box>
      <Text dimColor>{" ".padEnd(COLS.prefix)}</Text>
      <Text dimColor bold>{"DIR".padEnd(lay.dir)}</Text>
      <Text dimColor bold>{"TASK".padEnd(lay.task)}</Text>
      <Text dimColor bold>{"CONTEXT".padEnd(COLS.ctx)}</Text>
      <Text dimColor bold>{"UP".padEnd(COLS.up)}</Text>
      <Text dimColor bold>{"ACTIVE".padEnd(COLS.active)}</Text>
      <Text dimColor bold>{"MODEL".padEnd(COLS.model)}</Text>
      <Text dimColor bold>{"COST".padEnd(COLS.cost)}</Text>
    </Box>
  );
}

export function Row({
  row,
  selected,
  now,
  lay,
}: {
  row: AgentRow;
  selected: boolean;
  now: number;
  lay: Layout;
}) {
  const busy = row.status === "busy";
  const dot = busy ? "●" : "○";
  const dotColor = busy ? "green" : "gray";

  const ctx =
    row.contextTokens != null
      ? `${tokens(row.contextTokens)}/${tokens(modelWindow(row.model))}`
      : "—";

  const cursor = selected ? "›" : " ";

  const badge = subBadge(row.liveSubagents);
  const nameRoom = lay.dir - (badge ? badge.length + 1 : 0) - 1;
  const name = truncate(basename(row.cwd), nameRoom);
  const dirUsed = name.length + (badge ? badge.length + 1 : 0);
  const dirPad = " ".repeat(Math.max(0, lay.dir - dirUsed));

  return (
    <Box>
      <Text color={selected ? "cyan" : undefined}>{cursor} </Text>
      <Text color={dotColor}>{dot} </Text>
      <Text color={selected ? "cyan" : "white"} bold={selected}>{name}</Text>
      {badge ? <Text color="magenta">{" " + badge}</Text> : null}
      <Text>{dirPad}</Text>
      <Text color={selected ? "cyan" : undefined}>
        {truncate(row.task ?? "(no prompt yet)", lay.task - 1).padEnd(lay.task)}
      </Text>
      <Text dimColor>{ctx.padEnd(COLS.ctx)}</Text>
      <Text dimColor>{dur(row.startedAt, now).padEnd(COLS.up)}</Text>
      <Text dimColor>{relTime(row.updatedAt, now).padEnd(COLS.active)}</Text>
      <Text dimColor>{shortModel(row.model).padEnd(COLS.model)}</Text>
      <Text dimColor>{money(row.costUsd).padEnd(COLS.cost)}</Text>
    </Box>
  );
}
