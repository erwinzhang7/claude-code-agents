# agents

A live terminal dashboard for every running [Claude Code](https://claude.com/claude-code)
session. Built for the "I have six sessions open across different repos and lost track of
all of them" situation.

```
 Claude Code sessions ● 2 busy  ○ 1 idle  (3 total)

     DIR            TASK                                  CONTEXT     UP       ACTIVE      MODEL       COST
 › ● api-server ⊂2  add rate limiting to the auth en…     412k/1.0M   1h12m    8s ago      opus-4-8    $14.80
   ● web-app        fix the flaky checkout test, reb…     233k/1.0M   46m      2m ago      opus-4-8    $6.05
   ○ docs-site      rewrite the getting-started gui…      88k/1.0M    18m      11m ago     opus-4-8    $1.90

 ↑/↓ select   →/enter detail   ← collapse   r copy resume   o open dir   k kill session   ctrl-c exit
 5hr:42%   resets:3h08m      wk:17%   resets:4d02h
```

It reads Claude Code's own live session registry — no daemon, no config, no API keys. Just
files Claude Code already writes.

## What it shows

Per session, refreshed every second:

- **Status** — busy ● / idle ○, live from Claude Code
- **Dir** — the session's working directory
- **Task** — the first prompt of the session
- **Context** — current context size vs. the model's window (e.g. `726k/1.0M`)
- **Up / Active** — uptime and time since last activity
- **Model** — e.g. `opus-4-8`
- **Cost** — exact spend reported by Claude Code (via the statusline tee), or a token-based
  estimate including subagents and workflows as a fallback
- **⊂N badge** — number of subagents currently running under a session

Plus a bottom line with your subscription's **5-hour and weekly usage** and reset times.

## Install

Requires Node.js ≥ 18.

**From GitHub:**

```sh
npm install -g github:erwinzhang7/claude-code-agents
```

**From source:**

```sh
git clone https://github.com/erwinzhang7/claude-code-agents.git
cd claude-code-agents
npm install
npm run build
npm link
```

Either way you get an `agents` command on your PATH.

## Usage

```sh
agents          # full-screen live dashboard (exit with Ctrl-C)
agents --once   # print a one-shot snapshot and exit (pipe-friendly)
agents --help
```

### Keys

| key       | action                                     |
| --------- | ------------------------------------------ |
| ↑ / ↓     | select a session                           |
| → / enter | open the detail panel                      |
| ←         | collapse the detail panel                  |
| r         | copy `claude --resume <id>` to clipboard   |
| o         | open the session's directory               |
| k         | kill the selected session (SIGTERM, confirms) |
| Ctrl-C    | exit `agents` (your sessions keep running) |

## Statusline integration — optional but recommended

Two things live only inside Claude Code's **statusline** feed and aren't persisted anywhere:
your subscription rate-limit usage (the bottom line) and each session's *exact* cost (the
number Claude Code itself reports). Have your statusline tee them to small cache files and
`agents` will pick them up.

Add this block to `~/.claude/statusline-command.sh`, right after it reads stdin (e.g. after
`input=$(cat)`), with `jq` installed:

```sh
# rate-limits (account-wide)
echo "$input" | jq -c '{rate_limits, at: now}' \
  > ~/.claude/.agents-ratelimits.json.tmp 2>/dev/null \
  && mv -f ~/.claude/.agents-ratelimits.json.tmp ~/.claude/.agents-ratelimits.json 2>/dev/null

# exact per-session cost (keyed by session id)
sid=$(echo "$input" | jq -r '.session_id // empty')
if [ -n "$sid" ]; then
  mkdir -p ~/.claude/.agents-cost
  echo "$input" | jq -c '{cost: .cost.total_cost_usd, at: now}' \
    > "~/.claude/.agents-cost/$sid.json.tmp" 2>/dev/null \
    && mv -f "~/.claude/.agents-cost/$sid.json.tmp" "~/.claude/.agents-cost/$sid.json" 2>/dev/null
fi
```

These refresh whenever a Claude session repaints its statusline. Without them everything else
still works — the usage line shows a "waiting for statusline data" hint, and COST falls back
to a token-based estimate.

## How it works

- **Discovery** — Claude Code writes one file per running session to
  `~/.claude/sessions/<pid>.json` (pid, session id, cwd, busy/idle status, timestamps),
  created on start and removed on exit. `agents` reads these and drops any whose pid is no
  longer alive.
- **Enrichment** — for each session it streams the transcript head for the task (cached) and
  the last ~96 KB for current context, model, and last message. Multi-MB transcripts are
  never read in full.
- **Cost** — prefers Claude Code's own `total_cost_usd` when the statusline tee provides it;
  otherwise sums token usage across the transcript at published per-token rates (deduping
  re-logged messages, reading only newly-appended bytes per poll, and folding in subagent and
  workflow transcripts under `~/.claude/projects/<proj>/<session>/subagents/`).
- **UI** — [Ink](https://github.com/vadimdemedes/ink), polled once per second, sized to your
  terminal width.

Cost is an estimate against list prices and won't include surcharges your plan may apply.

## License

[Apache-2.0](./LICENSE)
