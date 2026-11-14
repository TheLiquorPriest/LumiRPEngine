# Settings

Every setting RPE has, with its default and what it does. A test holds this page to the code: a setting added, removed or given another default fails it until this page says the same.

## Where settings are written

Settings are written in YAML, in config files under `files/` in RPE's data folder:

- `files/defaults/RPE-global.yml`: the shipped copy. Read-only.
- `files/RPE-global.yml`: yours, for every chat.
- `RPE.yml` in a chat's folder: for that chat alone.

They are read in that order, and the nearer file wins, key by key. A dotted key is written as nested keys: `history.window` is

```yaml
history:
  window: 40
```

A value a setting does not take is passed over, with a line in RPE's log naming the file, and the default holds. A bad value never stops a turn. Where a setting allows it, `~` means none: a limit lifted, a window that keeps every message.

The files are read again at every turn, so a change holds from the next turn on. RPE's API lists every setting with its value, its default and the file it comes from (`GET /api/v1/settings`), and writes one key into a file, keeping your comments (`PUT /api/v1/settings`).

**Per connection.** Four settings are set for one model connection at a time, named by its name or its id: `reply.forms.<connection>`, `effort.connections.<connection>`, `jobs.connections.<connection>.atOnce` and `jobs.connections.<connection>.perDay`.

## The turn

| Setting | Default | What it does |
|---|---|---|
| `lead` | `author` | The agent definition that leads a turn. |
| `carry` | `continuing` | What a session carries from turn to turn: `continuing` (the conversation itself, summarized when it no longer fits), `records`, or `nothing`. |
| `limits.previousRun` | `20` | Seconds a turn waits for the run of the turn before it to end; then that run is stopped. |
| `chat.hiddenReadable` | `false` | Whether agents may read the messages you hid from the prompt. |
| `history.window` | `40` | How many of the chat's latest messages stay in the prompt. `~` keeps them all. |
| `history.step` | none (off) | Lets the window grow by this many messages before it is cut back to its size. |
| `history.hold.on` | `false` | Keeps a message in the prompt past the window while the story record does not cover it. `hold: true` is short for this. |
| `history.hold.cap` | `40` | The most messages held past the window. |
| `passConnection` | none (the default connection) | The connection a request that is not a turn of RPE's is passed on to. Global file only. |

## Limits of a turn

| Setting | Default | What it does |
|---|---|---|
| `limits.turn.calls` | `40` | Model calls across every agent of one turn. `~` for no limit. |
| `limits.turn.tokensIn` | none (no limit) | Tokens read across every agent of one turn. |
| `limits.turn.tokensOut` | none (no limit) | Tokens written across every agent of one turn. |
| `limits.turn.time` | none (no limit) | Seconds for the whole turn. |
| `limits.turn.depth` | `2` | How deep sub-agents may go: 1, only the lead starts them; 2, they may start their own; 0, none. |
| `limits.turn.agents` | `24` | Sub-agents one turn may start in all. `~` for no limit. |

## The reply

| Setting | Default | What it does |
|---|---|---|
| `reply.form` | `tags` | How the reply is marked: `tags`, in one call, or `two-step`, for a model that does not keep to the tags. |
| `reply.forms.<connection>` | none (as reply.form says) | The same, for one connection. |
| `reply.streamAnyway` | `[]` | Connections on the two-step form whose replies still stream as they are written. |
| `reply.heldSentences` | `1` | Sentences held back while a rule that can interrupt covers the reply. |
| `reply.tailSentences` | `3` | Sentences of what was already shown that an agent is given when it goes on after a rule stopped it. |
| `reply.leadSampling` | `own` | The lead's sampling: its `own`, or the `preset`'s. |
| `reply.intentWait` | `2` | Seconds a tool or the reply waits, at most, for the intent record written before it to be taken. `0` waits for nothing. |

## What you see while a turn runs

| Setting | Default | What it does |
|---|---|---|
| `progress.show` | `all` | `all` the progress lines, or `least`: only the line that keeps a silent turn alive. |
| `progress.silence` | `60` | Seconds with nothing shown before that line. |
| `trace.requests` | `first` | Which calls have what they were sent kept in the turn's folder: each agent's `first`, `all`, or `none`. |

## Tools and rules

| Setting | Default | What it does |
|---|---|---|
| `results.clip` | `12000` | Characters of a tool's answer the model reads. The whole answer is kept in a file. |
| `tools.search` | `8` | Tools one `tool_search` gives when the agent names no number. |
| `tools.gapCheck` | `20` | Hits `gap_check` takes from each place when the agent names no number. |
| `tools.perCall` | `100` | The most one tool call takes: messages read, lore entries read, search hits. |
| `tools.schemaShown` | `600` | Characters of a tool's schema shown whole when a call does not fit it. |
| `rules.window` | `500` | Characters a rule's pattern looks at at a time. |
| `rules.judge` | none (the asking agent's own connection) | The connection a `question:` rule is judged on, where the rule names none. |
| `effort.connections.<connection>` | none (as each agent's definition says) | How hard every agent on one connection thinks, whatever its definition says: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |

## Sessions

| Setting | Default | What it does |
|---|---|---|
| `compaction.reserve` | `16384` | Tokens kept free for the answer. A session's earlier turns are summarized when the lead's first call of a turn would not fit its model's window less this. |
| `compaction.keepTurns` | `3` | The newest earlier turns a summary never stands for. |
| `compaction.records` | `6000` | Tokens of records the `records` way of carrying holds before they are folded into the summary. |
| `compaction.saveCalls` | `1` | Calls the lead makes just before a compaction, to save what matters. |
| `prompt.kept` | `50` | Turns whose prompts are kept, so that the next turn's prompt can be compared with the one before it. |

## Jobs

Jobs are runs that go on after the reply, such as indexing lore or summarizing a stretch of the chat.

| Setting | Default | What it does |
|---|---|---|
| `jobs.atOnce` | `2` | Jobs running at once, across all your chats. One started past it waits. |
| `jobs.perDay` | none (no limit) | Jobs that may start in a day. |
| `jobs.connections.<connection>.atOnce` | none (no limit of its own) | Jobs at once whose agent runs on one connection. |
| `jobs.connections.<connection>.perDay` | none (no limit of its own) | Jobs a day whose agent runs on one connection. |
| `jobs.run.calls` | `60` | Model calls in one job's run. `~` for no limit. |
| `jobs.run.tokensIn` | `600000` | Tokens read in one job's run. `~` for no limit. |
| `jobs.run.tokensOut` | `60000` | Tokens written in one job's run. `~` for no limit. |
| `jobs.run.time` | `900` | Seconds for one job's run. `~` for no limit. |

## Updates

Global file only.

| Setting | Default | What it does |
|---|---|---|
| `update.restart` | `true` | Restart onto a new build of RPE's file, once no turn or job is running. |
| `update.versionWait` | `10` | Seconds a new file has to say its build before it counts as one that does not start. |
| `update.lookEvery` | `2` | Seconds between looks for running turns and jobs while a restart waits. |

## Which files are in force

These keys say which of the files in [How behaviour lives in files](behaviour.md) are read, and how long turn folders are kept.

| Key | Default | What it does |
|---|---|---|
| `layered` | `["AGENTS"]` | Instruction files read at every level that has one, the farther first, instead of the nearest alone. |
| `added.swipe` | `["SWIPE"]` | Instruction files added for a swipe. |
| `added.regenerate` | `["SWIPE"]` | Instruction files added for a regenerate. |
| `added.delete` | `["DELETE"]` | Instruction files added when turns were deleted since the last one. |
| `off` | `[]` | Files switched off: an instruction file by its name (`WORLD`), anything else by folder and name (`rules/perceptions-owed`). |
| `retention.turnFolders` | `50` | How many of a chat's newest turn folders are kept whole. Older ones keep `turn.json`, `output/` and `transcripts/`. |

## The application: config.json

These are in `config.json` in RPE's data folder, not in the YAML files: they are the application's, not a chat's. Change them while RPE is stopped, and start it again. `RPE_ADDRESS`, `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER` in the environment win over `address`, `port`, `lumiverse.url` and `lumiverse.user`.

| Key | Default | What it does |
|---|---|---|
| `address` | `127.0.0.1` | The address RPE listens on. Set another, and RPE listens on `127.0.0.1` as well. |
| `port` | `7871` | Its port. `0` takes any free one. |
| `lumiverse.url` | none | Lumiverse's address. Pages from it may call RPE. `rpe up` sets it. |
| `lumiverse.user` | none | The id of the Lumiverse user this RPE belongs to. `rpe up` sets it. |
| `lumiverse.database` | none | Lumiverse's database file, read read-only. With none, Lumiverse is read over HTTP. |
| `lumiverse.connection` | none | The id of RPE's connection in Lumiverse. `rpe up` sets it. |
| `lumiverse.models` | `["rpe"]` | The model names RPE's connection is offered. |
| `origins` | `[]` | Other addresses whose pages may call RPE: where you published it. |
| `hosts` | `[]` | Other host names requests may reach RPE by (`name:port` to hold one to a port). |
| `server.bodyBytes` | `1048576` | The largest request body a route takes, in bytes. |
| `server.providerBodyBytes` | `33554432` | The largest request Lumiverse may send for a reply: a whole prompt, pictures included. |
| `server.preflightSeconds` | `600` | How long a browser may keep RPE's answer to a page's preflight. |
| `auth.pageTokenMinutes` | `30` | How long a page token holds. |
| `auth.commandLineSeconds` | `60` | How long the token the command line makes to call the running RPE holds. |
| `live.queueEvents` | `512` | Events held for one slow page of one chat. Past it the oldest are dropped, and the page is told which. |
| `live.messageBytes` | `65536` | The largest message a page may send on the live socket. |
| `database.busyMs` | `5000` | Milliseconds a write waits for another program's write to the database to finish. |
| `database.sliceMs` | `10` | Milliseconds the write queue runs writes before it lets other work in. |
| `commandLine.waitMs` | `3000` | Milliseconds `rpe status` and `rpe connection` wait for the running RPE. |
| `commandLine.signInMs` | `30000` | Milliseconds the command line waits for Lumiverse to answer its sign-in. |
| `commandLine.startMs` | `30000` | Milliseconds `rpe up` waits for RPE to answer once it has started RPE's service, before it puts back what it did. |
