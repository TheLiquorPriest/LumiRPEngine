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
| `reply.lastText` | `false` | When the Author ends a turn with no reply, even after the reminder, send its last plain text to the chat as the reply in place of the error line. The Turn page shows that the setting sent it. |
| `history.window` | `40` | How many of the chat's latest messages stay in the prompt. `~` keeps them all. |
| `history.step` | none (off) | Lets the window grow by this many messages before it is cut back to its size. |
| `history.hold.on` | `false` | Keeps a message in the prompt past the window while the story record does not cover it. `hold: true` is short for this. |
| `history.hold.cap` | `40` | The most messages held past the window. |
| `since.editedBudget` | `4000` | Tokens the briefing's "Since the last turn" may spend telling replies edited after their turns in full, each with its text before and after, the newest first. The rest are named in one line by their message numbers. `~` tells every one in full. |
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

## What you see while a turn runs

| Setting | Default | What it does |
|---|---|---|
| `progress.show` | `all` | `all` the progress lines, or `least`: only the line that keeps a silent turn alive. |
| `progress.silence` | `60` | Seconds with nothing shown before that line, at most 540: the line reaches Lumiverse inside the ten minutes it waits before ending a silent generation. |
| `trace.requests` | `first` | Which calls have what they were sent kept in the turn's folder: each agent's `first`, `all`, or `none`. |
| `live.backlog` | `5000` | Items of one run a page following it live may have yet to take; past that, the page is cut off and told so, and no run waits on a slow page. |

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

Jobs are runs that go on after the reply, such as indexing lore or summarizing a stretch of the chat. `jobs.perRun` and `jobs.tokensPerDay` are the previous build's own limits on jobs, kept with the defaults it had.

| Setting | Default | What it does |
|---|---|---|
| `jobs.atOnce` | `2` | Jobs running at once, across all your chats. One started past it waits. |
| `jobs.perDay` | none (no limit) | Jobs that may start in a day. |
| `jobs.perRun` | `6` | Jobs the agents of one run, a turn's or a job's, may start. A start past it is answered, and nothing is started. `0` starts no job; `~` for no limit. |
| `jobs.tokensPerDay` | `12000000` | Tokens, sent and written, all your jobs may spend in a day. Past it no job starts, and a running job is stopped at its next call. `~` for no limit. |
| `jobs.cachedWeight` | `0.1` | What a token read again from the provider's cache counts for against the day's job tokens: a tenth, as the previous build counts it. `1` counts it in full. |
| `jobs.connections.<connection>.atOnce` | none (no limit of its own) | Jobs at once whose agent runs on one connection. |
| `jobs.connections.<connection>.perDay` | none (no limit of its own) | Jobs a day whose agent runs on one connection. |
| `jobs.run.calls` | `60` | Model calls in one job's run. `~` for no limit. |
| `jobs.run.tokensIn` | `600000` | Tokens read in one job's run. `~` for no limit. |
| `jobs.run.tokensOut` | `60000` | Tokens written in one job's run. `~` for no limit. |
| `jobs.run.time` | `900` | Seconds for one job's run. `~` for no limit. |
| `bootstrap.tokenLimit` | `200000` | Tokens a bootstrap job (taking on a chat that has a past) may send and write together, across all its agents, a cached re-read counted at `jobs.cachedWeight`. The job ends at it with what it has recorded, and its record says this limit stopped it. A tighter `jobs.run.*` limit stops it first. |

## Updates

Global file only.

| Setting | Default | What it does |
|---|---|---|
| `update.restart` | `true` | Restart onto a new build of RPE's file, once no turn or job is running. |
| `update.versionWait` | `10` | Seconds a new file has to say its build before it counts as one that does not start. |
| `update.lookEvery` | `2` | Seconds between looks for running turns and jobs while a restart waits. |
| `update.checkWait` | `120` | Seconds a new build has to check that it starts on this RPE's data before it counts as one that does not start. |
| `update.startTries` | `5` | Starts of RPE's service within `update.startWindow` before its unit stops starting it: a build that cannot serve is left stopped. `rpe up` writes it into the unit. |
| `update.startWindow` | `60` | Seconds over which `update.startTries` counts starts. `rpe up` writes it into the unit. |

## Characters and their memories

What the cast's tools and views give agents of each character.

| Setting | Default | What it does |
|---|---|---|
| `cast.queryItems` | `50` | The most items of one part a `cast_query` answers with. The answer says how many more there are. |
| `cast.recallItems` | `10` | The most memories one recall brings back. The answer says how many more touch the cue. |
| `cast.topOfMind` | `9` | The most memories a character holds at top of mind. |
| `cast.comesToMindTokens` | `2000` | Tokens of what comes to a character's mind for a scene. |
| `cast.shortTermDays` | `3` | Story days a memory stays short term, unless a dream settles it sooner. |
| `cast.fadeDays` | `3` | Story days in which a memory of weight 1, never recalled, falls to half its strength. Each point of weight doubles that time, and each recall adds as much again. |
| `cast.faintBelow` | `0.25` | The strength, from 0 to 1, under which a memory is faint and is shown by its gist. |
| `cast.memoryWeight` | `1` | The weight of a memory written with none. |
| `cast.weightMax` | `5` | The highest weight a memory can have. Weights run from 1. |
| `cast.secretConfidence` | `1` | How sure, from 0 to 1, a character is of a secret a perception, or a `cast_update`, says they now know. |
| `cast.charsPerToken` | `3.2` | Listed, and not in force in this build: what comes to a character's mind is always measured at 3.2 characters to a token, RPH's own estimate, whatever this says. |

## The story record

| Setting | Default | What it does |
|---|---|---|
| `story.queryItems` | `50` | The most items one `story_query` answers with. The answer says how many more match. |
| `story.soFar.share` | `0.05` | The share of the Author's context window the story so far may fill in the briefing: one twentieth. |
| `story.soFar.floor` | `6000` | The fewest tokens the story so far may fill, however small the Author's window. |
| `story.ahead` | `2` | Messages the chat is taken to grow by before the next turn's prompt (this reply and your next message), for the counts rules use of what is about to leave the prompt. Global file only, read when RPE starts. |

## Lore

Global file only, read when RPE starts.

| Setting | Default | What it does |
|---|---|---|
| `lore.searchLimit` | `20` | Hits a lore search gives when it names no number. |
| `lore.snippetChars` | `80` | Characters of an entry's text a hit shows on each side of the first word it matched. |
| `lore.titleWords` | `8` | Words of its text that title a book entry that has no title of its own. |
| `lore.index.batch` | `20` | Entries handed to an indexing run at a time. |
| `lore.index.bound` | `12` | Entries the lore map lists as bound to the horizon and not in the prompt. |

## The world state

| Setting | Default | What it does |
|---|---|---|
| `worldState.budget` | `4000` | Tokens the world state's parts other than the horizon share in the briefing. The horizon is shown whole. |
| `worldState.charsPerToken` | `4` | Characters counted as one token when that budget is measured. |
| `worldState.dueAhead` | `360` | Minutes of story time ahead that the list of what falls due covers. The list shows what the budget fits and counts the rest. After a turn that moved the clock, the world state also lists what fell due in the time that passed, within the same budget. |

## The engine's tools

| Setting | Default | What it does |
|---|---|---|
| `engine.nearMatches` | `5` | How many near matches an answer lists when a name a call gave is not there. |
| `engine.queryDepth` | `1` | How many levels below its point `world_query` shows when the call names no depth. |
| `engine.searchHits` | `10` | The most things one `world_search` answers with, and how many it gives when the call names no number. |
| `engine.dueItems` | `50` | The most things falling due in a span that an answer lists, soonest first. The answer says how many more fall in the span. |

## The store

Global file only, read when RPE starts.

| Setting | Default | What it does |
|---|---|---|
| `store.snapshotEvery` | `25` | Turns between snapshots of a chat's state. |
| `store.foldsKept` | `32` | Worked-out states held in memory, the least recently used going first. |
| `store.notable` | `3` | The most names of note the world view gives for the people below a place. |
| `store.worldsKept` | `8` | World revisions held in memory once read, the least recently used going first. |

## Files and notes

| Setting | Default | What it does |
|---|---|---|
| `retention.turnFolders` | `50` | How many of a chat's newest turn folders are kept whole. Older ones keep `turn.json`, `output/` and `transcripts/`. |
| `files.findLimit` | `200` | The most entries a listing, a glob or a grep of the files gives when it names no number: an agent's, or RPH's own as it reads the files in force. A number an agent names is held to `tools.perCall` instead. A number RPE or RPH names for its own work, such as the list of a turn's folder on the Turn page, is given whole. |
| `files.grepBytes` | `1048576` | Files larger than this many bytes are passed over by a grep. |
| `files.grepLineChars` | `1000` | Characters of each line a grep tests, and of the line a hit shows. |
| `files.grepMs` | `2000` | Milliseconds a grep runs before it stops with what it found so far. |
| `files.diffCells` | `4000000` | The most line pairs the Files page compares one by one to show what changed. Past it, the changed part is shown removed, then added whole. |
| `notes.listed` | `20` | Note files each of the Storage page's lists shows when it names no number. |
| `notes.most` | `200` | The most note files each of those lists shows. |

## The files in force

These settings say which of the files in [How behaviour lives in files](behaviour.md) are read. RPH reads them as it loads a turn's files, so a change holds from the next turn. Every level's `off`, `layered`, `instructions` and `pins` apply together, each adding to the farther levels'; `added` takes the nearer level's entry for each kind of turn. The defaults below hold where no file sets them: the shipped file reads `layered: [AGENTS]` and `added: {swipe: [SWIPE], regenerate: [SWIPE], delete: [DELETE]}`. The Files page shows what they put in force; the Settings page shows and writes each level's own.

| Setting | Default | What it does |
|---|---|---|
| `off` | `[]` | Files switched off: an instruction file by its name (`WORLD`), anything else by folder and name (`rules/perceptions-owed`). A name in any level's list is off everywhere. |
| `layered` | `[]` | Instruction files read at every level that has one, the farther first, instead of the nearest alone. |
| `added` | `{}` | For each kind of turn (`swipe`, `regenerate`, `delete`), the instruction files added to its briefing beside `TURN.md`. |
| `instructions` | `[]` | Files added to the stack of every agent that reads instruction files, or, as a table, to each named agent's alone. |
| `pins` | `[]` | Files handed whole to an agent at the start of each of its runs, each a `file` and the `agent` it is pinned for. |

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
| `auth.webKeyDays` | none | Days the web UI's key works after it is made. With none it has no end: it works until a new web key replaces it. |
| `live.queueEvents` | `512` | Events held for one slow page of one chat. Past it the oldest are dropped, and the page is told which. |
| `live.follows` | `64` | The most chats one live socket may follow at once. A follow past it is refused, and the page is told so. |
| `live.messageBytes` | `65536` | The largest message a page may send on the live socket. |
| `database.busyMs` | `5000` | Milliseconds a write waits for another program's write to the database to finish. |
| `database.sliceMs` | `10` | Milliseconds the write queue runs writes before it lets other work in. |
| `commandLine.waitMs` | `3000` | Milliseconds `rpe status` and `rpe connection` wait for the running RPE. |
| `commandLine.signInMs` | `30000` | Milliseconds the command line waits for Lumiverse to answer its sign-in. |
| `commandLine.startMs` | `30000` | Milliseconds `rpe up` waits for RPE to answer once it has started RPE's service, before it puts back what it did. |
