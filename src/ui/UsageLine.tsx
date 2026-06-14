import React from "react";
import { Box, Text } from "ink";
import type { RateLimits } from "../ratelimits.js";
import { until } from "../format.js";

function pctColor(p?: number): string | undefined {
  if (p == null) return undefined;
  if (p >= 90) return "red";
  if (p >= 70) return "yellow";
  return "green";
}

export function UsageLine({ rl, now }: { rl: RateLimits | null; now: number }) {
  if (!rl || (rl.fiveHourPct == null && rl.weekPct == null)) {
    return (
      <Text dimColor>
        usage: waiting for statusline data (keep a Claude session open)
      </Text>
    );
  }
  // Snapshot older than ~2 min means no session has rendered recently.
  const stale = rl.capturedAt != null && now / 1000 - rl.capturedAt > 120;
  return (
    <Box>
      <Text dimColor>5hr:</Text>
      <Text color={pctColor(rl.fiveHourPct)}>{rl.fiveHourPct ?? "—"}%</Text>
      <Text dimColor>   resets:{until(rl.fiveHourResetsAt, now)}</Text>
      <Text dimColor>      wk:</Text>
      <Text color={pctColor(rl.weekPct)}>{rl.weekPct ?? "—"}%</Text>
      <Text dimColor>   resets:{until(rl.weekResetsAt, now)}</Text>
      {stale ? <Text dimColor> (stale)</Text> : null}
    </Box>
  );
}
