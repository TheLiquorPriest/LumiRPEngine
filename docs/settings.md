# Settings

Every setting RPE and its harness read, with its default, where you change it, when a change to it takes effect, and what it does. This page is written from RPE's one list of settings (`bun scripts/settings/generate.ts`), and a test holds it to that list: a setting added, removed or given another default fails the test until the page is written again. A setting marked "beyond Appendix D.1" is a value the plan's Appendix D.1 does not give: it is listed for the owner's approval.

## Where settings are written

Settings are written in YAML, in config files under `files/` in RPE's data folder:

- `files/defaults/RPE-global.yml`: the shipped copy. Read-only.
- `files/RPE-global.yml`: yours, for every chat.
- `RPE.yml` in a chat's folder: for that chat alone, where a setting's row says it is read there.

They are read in that order, and the nearer file wins, key by key. A dotted key is written as nested keys: `history.window` is

```yaml
history:
  window: 40
```

A value a setting does not take is passed over, with a line in RPE's log naming the file, and the default holds. A bad value never stops a turn. Where a setting allows it, `~` means none: a limit lifted, a window that keeps every message.

Each row says when a change is in force: at the setting's next use, from the next turn, or from RPE's next start. The Settings page lists every setting with its value, its default and the file it comes from, and writes one key into a file at a level, keeping your comments.

**Per connection.** A key with `<connection>` in it is set for one model connection at a time, named by its name or its id.

## Updates

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `update.restart` | `true` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Restart onto a new build: RPE restarts by itself onto a new app file the extension brings, once no turn or job runs. |
| `update.versionWait` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Wait for a new build to say its version: Seconds a new app file is given to say its build. |
| `update.lookEvery` | `2` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Look again for running work: Seconds a waiting restart waits before it looks again whether turns or jobs still run. |
| `update.startTries` | `5` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Starts allowed in the start window: Starts of RPE's service its unit allows within the start window before the service manager stops starting it; rpe up writes it into the unit. |
| `update.startWindow` | `60` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Start window: Seconds within which the starts of RPE's service are counted. |
| `update.checkWait` | `120` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Wait for a new build's check: Seconds a new app file is given to check that it starts on this RPE's data. |

## The server

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `server.address` | `127.0.0.1` | RPE-global.yml | from RPE's next start | Appendix D.1: RPE listens on | RPE listens on: The address RPE listens on besides loopback; an address other than loopback lets other machines reach RPE. |
| `server.origins` | `[]` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Origins allowed: Origins besides RPE's own and Lumiverse's whose pages may call RPE: an address RPE or Lumiverse is published at, such as https://rpe.example. |
| `server.hosts` | `[]` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Names allowed: Names besides RPE's own address that requests may reach it by: a published address's host name, with :port to hold it to a port. |
| `server.bodyBytes` | `1048576` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest request: Bytes of the largest request body a route takes, unless the route says otherwise. |
| `server.providerBodyBytes` | `33554432` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest prompt: Bytes of the largest request Lumiverse's generations may send RPE: a whole assembled prompt, its pictures included. |
| `server.preflightSeconds` | `600` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Preflight kept: Seconds a browser may keep RPE's answer to a page's preflight before it asks again. |
| `auth.pageTokenMinutes` | `30` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A page token holds: Minutes a page token holds before the page needs a new one. |
| `auth.commandLineSeconds` | `60` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line's token holds: Seconds the token the command line makes to call the running server holds. |
| `auth.webKeyDays` | none (no end: it holds until a new one replaces it) | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The web app's key holds: Days the web app's key holds after it is made. |
| `liveSocket.queueEvents` | `512` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Events held for a slow page: Events the live socket holds for one slow page following one chat; past it the oldest are dropped, and the page is told which. |
| `liveSocket.messageBytes` | `65536` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest live message: Bytes of the largest message a page may send on the live socket. |
| `liveSocket.follows` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Chats one live socket follows: The most chats one page's live socket may follow at once. |
| `database.busyMs` | `5000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wait for another writer: Milliseconds a write waits for another program's write to RPE's database file to finish. |
| `database.sliceMs` | `10` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Writes run at a time: Milliseconds the write queue runs writes before it lets other work in. |
| `commandLine.waitMs` | `3000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for RPE: Milliseconds rpe status and rpe connection wait for the running server, and a command waits for the data folder's lock. |
| `commandLine.signInMs` | `30000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for a sign-in: Milliseconds rpe lumiverse waits for Lumiverse to answer its sign-in. |
| `commandLine.startMs` | `30000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | rpe up waits for RPE to start: Milliseconds rpe up waits for RPE to answer once it has started RPE's service, before it puts back what it did. |

## The store

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `store.snapshotEvery` | `25` | RPE-global.yml | from RPE's next start | Appendix D.1: Snapshot | Snapshot: Turns between snapshots of a chat's world, from which its state is rebuilt. |
| `store.foldsKept` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | World states held in memory: Worked-out world states held in memory, the least recently used going first. |
| `store.notable` | `3` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Names of note in a reflection: Names of note each reflection of the world lists. |
| `store.worldsKept` | `8` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | World revisions held in memory: Revisions of world documents held in memory once read, the least recently used going first. |

## The world state

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `worldState.budget` | `4000` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: everything else | World state: everything else: Tokens of the briefing's world state that everything but the horizon shares. |
| `worldState.charsPerToken` | `4` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters per token, for the world state: Characters counted as one token when the world state's budget is measured. |
| `worldState.dueAhead` | `360` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time ahead listed as due: Minutes of story time ahead that the world state's due section lists. |

## Lore

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `lore.searchLimit` | `20` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Hits a lore search gives: Entries a search of the lore gives when it asks for no number. |
| `lore.snippetChars` | `80` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Snippet of a lore hit: Characters of an entry's text a hit shows on each side of the first word the search matched. |
| `lore.titleWords` | `8` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Words that title an entry: Words of its text that title a lore entry with no title of its own. |
| `lore.index.batch` | `20` | RPE-global.yml | from RPE's next start | Appendix D.1: Lore indexing, entries per call | Lore indexing, entries per call: Entries handed to one call of a lore indexing run. |
| `lore.index.bound` | `12` | RPE-global.yml | from RPE's next start | Appendix D.1: Lore map, bound entries not in the prompt | Lore map, bound entries: Entries bound to the horizon and not in the prompt that the lore map lists. |

## The engine's tools

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `engine.nearMatches` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Near matches listed: How many near matches an answer about a name that is not there lists. |
| `engine.queryDepth` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Depth of a world query: How many levels below its point world_query shows when it names no depth. |
| `engine.searchHits` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Hits a world search gives: The most things one world_search answers with. |
| `engine.dueItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Things falling due listed: The most things falling due in a span an answer lists, soonest first; how many more fall in it is said. |

## Files and notes

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `retention.turnFolders` | `50` | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Turn folders kept whole | Turn folders kept whole: How many of a chat's newest turn folders keep everything; each older one keeps its turn.json, output and transcripts. The next turn's prompt is compared over the folders kept. |
| `files.findLimit` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Hits a find gives: The most files a listing, a glob or a grep of the agents' files gives when it asks for no number. |
| `files.grepBytes` | `1048576` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Largest file a grep reads: Bytes past which a file is passed over by a grep of the agents' files. |
| `files.grepLineChars` | `1000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Line a grep tests: Characters of a line a grep tests and shows of a hit; the rest of the line is cut. |
| `files.grepMs` | `2000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time a grep runs: Milliseconds a grep runs before it stops with the hits it has found. |
| `files.diffCells` | `4000000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lines a difference compares: Line pairs the Files page's difference compares one by one; past it, the changed middle is shown removed, then added whole. |
| `notes.listed` | `20` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Notes listed: Note files each of the Storage page's lists gives when the page asks for no number. |
| `notes.most` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most notes listed: The most note files one of the Storage page's lists gives. |

## The files in force

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `off` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files switched off: Files switched off by name, an instruction file by its own (WORLD), anything else by its folder and name (rules/perceptions-owed); a name in any level's list is off everywhere. |
| `layered` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files read at every level: Instruction files read at every level that has one, the farther first, in place of the nearest alone. |
| `added` | `{}` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files added for a kind of turn: For each kind of turn (swipe, regenerate, delete), the instruction files added to its briefing beside TURN.md; a nearer level's entry for a kind replaces the farther one's. |
| `instructions` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files added to stacks: Files added to the stack of every agent that reads instruction files, or, as a table, to each named agent's alone; every level's list applies. |
| `pins` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Pinned files: Files handed whole to an agent at the start of each of its runs, each a file and the agent it is pinned for; every level's list applies. |

## Limits

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `limits.turn.calls` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Calls in a turn across all agents | Calls in a turn: Model calls all the agents of one turn may make between them. |
| `limits.turn.tokensIn` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens sent in a turn: Tokens sent to models across all the agents of one turn. |
| `limits.turn.tokensOut` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens written in a turn: Tokens models write across all the agents of one turn. |
| `limits.turn.time` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time for a turn: Seconds one turn may take, all its agents' work included. |
| `limits.turn.depth` | `2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agent depth: How deep sub-agents may go: at 1 only the lead starts them, at 2 they may start their own, at 0 none is started. |
| `limits.turn.agents` | `24` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agents in a turn: Sub-agents one turn may start in all. |
| `limits.day.tokens` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens in a day: Tokens, sent and written, that all your agents may spend over any 24 hours, turns and jobs alike; past it no call is made. |
| `limits.answerFloor` | `256` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Least room for an answer: Tokens an answer must have left at least, across every limit on tokens written; with less, no call is made and the work ends at the limit. |
| `limits.previousRun` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Wait for the previous turn's run | Wait for the previous run: Seconds a turn waits for the run of the turn before it; then that run is stopped. |

## Usage

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `usage.keptRuns` | `1000` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Runs whose usage is kept: Finished runs whose calls and tokens can still be asked for, a restart between; past it the oldest goes. |

## Jobs

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `jobs.atOnce` | `2` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs at once: Jobs that run at the same time, across all your chats; a job started past it waits for a place. |
| `jobs.perDay` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs in a day: Jobs that may be started in a day. |
| `jobs.perRun` | `6` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs one run may start: Jobs the agents of one run, a turn's or a job's, may start; 0 starts none. |
| `jobs.tokensPerDay` | `12000000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Job tokens in a day: Tokens, sent and written, that all your jobs may spend in a day; past it no job starts, and a running job stops at its next call. |
| `jobs.cachedWeight` | `0.1` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Weight of a cached token: What a token read again from a provider's cache counts for in the day's job tokens, from 0 to 1; every other limit counts it in full. |
| `jobs.connections.<connection>.atOnce` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs at once on a connection: Jobs on this connection that run at the same time. |
| `jobs.connections.<connection>.perDay` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs in a day on a connection: Jobs on this connection that may be started in a day. |
| `jobs.run.calls` | `60` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Calls in a job's run: Model calls all the agents of one job's run may make between them. |
| `jobs.run.tokensIn` | `600000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens sent in a job's run: Tokens sent to models across all the agents of one job's run. |
| `jobs.run.tokensOut` | `60000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens written in a job's run: Tokens models write across all the agents of one job's run. |
| `jobs.run.time` | `900` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time for a job's run: Seconds one job's run may take. |
| `jobs.keepDays` | `90` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Days a job is kept: Days the record of a job is kept; the older ones are removed when the next job starts. |

## Model calls

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `calls.silentAfter` | `300` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A model's answer that goes silent | Silent answer ends after: Seconds an answer that has begun may go with nothing from its server before it is ended. |
| `calls.providerWait` | `60` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Provider wait: Seconds a provider has to answer a connection's test or list its models. |
| `calls.signInOpen` | `600` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sign-in stays open: Seconds a sign-in to a provider stays open for you to finish it. |
| `calls.testRoom` | `64` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Test call's room: Tokens a connection's test call lets its answer take. |
| `calls.listMost` | `8` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Most of a model list read: Megabytes of a server's list of its models that are read; a longer list is refused. |
| `calls.quoted` | `80` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Address quoted in a refusal: Characters of a media address that the words of a refused request quote. |
| `calls.signInWordsKept` | `600` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Failed sign-in's words kept: Seconds the words of why a sign-in did not finish are kept to be shown. |
| `calls.wordsMost` | `2000` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length of failure words: Characters of a provider's or a call's failure words that are kept; the rest is cut. |
| `calls.retryWait` | `1` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Wait before a retry: Seconds before a failed call is made again the first time; each wait after is twice the one before. |
| `calls.retries` | `2` | RPE-global.yml | from the next turn | Appendix D.1: A model call that failed before any answer arrived | Retries of a failed call: Times a call that failed before any answer came is made again, where its connection sets no number of its own. |
| `calls.cacheRetention` | `short` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Prompt cache retention: How long a provider is asked to keep a prompt in its cache: none, short or long. |
| `calls.toolRefusalMinutes` | `60` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Native tools tried again after: Minutes a connection's model that refused native tools is offered them as text; then native tools are tried again. |
| `throttles.connections.<connection>.requestsPerMinute` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Requests a minute on a connection: Calls sent on this connection over any minute, across every agent, turn and job; one past it waits for room. |
| `throttles.connections.<connection>.tokensPerMinute` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens a minute on a connection: Tokens sent and written on this connection over any minute; a call waits for room, and one bigger than the whole minute is not made. |
| `throttles.connections.<connection>.atOnce` | none (as every connection) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls at once on a connection: Calls on this connection under way at the same time; one past it waits in line, first come first served. |
| `throttles.atOnce` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls at once on any connection: Calls under way at the same time on each connection that sets no number of its own. |
| `tokens.charsPerToken` | `3.2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters per token: Characters counted as one token when a prompt is measured before its provider counts it: whether a call fits, when to compact, and the trace's figures. |
| `sampling.<definition>.temperature` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Temperature: The temperature every call of this agent is made with; unset, its provider's own. |
| `sampling.<definition>.top_p` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Top P: The top P every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `sampling.<definition>.top_k` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Top K: The top K every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `sampling.<definition>.frequency_penalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Frequency penalty: The frequency penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `sampling.<definition>.presence_penalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Presence penalty: The presence penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `sampling.<definition>.repetition_penalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Repetition penalty: The repetition penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. |

## The reply

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `reply.form` | `tags` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: How a connection marks its reply | Reply form: How a connection marks its reply: with tags, or in two steps for a connection that does not keep them. |
| `reply.forms.<connection>` | none (as reply.form says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Reply form of a connection: The reply form of this connection, in place of the one every connection takes. |
| `reply.streamAnyway` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Two-step connections that stream: Two-step connections whose replies are shown as they are written, not when their message ends. |
| `reply.heldSentences` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Reply held back when a rule that interrupts covers it | Sentences held back: Sentences the reply is held back by while a rule that interrupts covers it. |
| `reply.tailSentences` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Sentences shown again to an agent that goes on after a rule stopped it | Sentences shown again: Sentences of what was already shown that go with the line an agent goes on under after a rule stopped it. |
| `reply.leadSampling` | `own` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The Author's sampling | The lead's sampling: Whether the lead samples as its own model does, or as the chat's preset says. |
| `progress.show` | `all` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Progress lines: All the progress lines in the chat's thinking block, or the least: only the line that keeps a silent turn alive. |
| `progress.silence` | `60` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Thinking block in the chat | Silence before a progress line: Seconds of nothing shown before a progress line goes to the chat's thinking block; at most nine minutes, since a generation that shows nothing for ten is ended. |
| `reply.lastText` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: When the Author ends with no reply | Last text as the reply: A turn that ends with no reply sends the Author's last plain text in place of the error line. |

## Tools and rules

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `results.clip` | `12000` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length of a tool's answer: Characters of a tool's answer, its reports with it, that the model reads; the whole answer is kept in a file. |
| `tools.search` | `8` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tools a search gives: Tools one tool_search gives when the agent asks for no number. |
| `tools.gapCheck` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Hits a gap check takes: Hits gap_check takes from each place it searches when the agent asks for no number. |
| `tools.perCall` | `100` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | The most one tool call takes: Messages chat_read gives, entries lore_read reads, hits a search asks each place for, and messages a stretch of the chat an agent is given holds. |
| `tools.schemaShown` | `600` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Schema shown with a call that does not fit: Characters of a tool's schema shown whole in the answer to a call that does not fit it; a longer schema is left out of that answer. |
| `rules.window` | `500` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | What a pattern looks at: Characters a rule's pattern looks at at a time: the newest of what is written, and stretches of a tool's arguments or result. |
| `rules.judge` | none (the asking agent's own connection) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The model that answers a `question:` rule | Connection that judges questions: The connection that answers a rule's question, by its name or id, where the rule names none. |

## What is kept of a turn

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `trace.requests` | `first` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Requests kept: Which model calls have what they were sent kept in the turn's folder: each agent's first, all of them, or none. |
| `prompt.kept` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Turns whose prompts are kept: Turns of a chat whose prompts are kept, so the next turn's, or a swipe's, is compared with the turn it follows. |
| `prompt.signatureHead` | `64` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Start a slice is known by: Characters at the start of a slice's text that the prompt map keeps, to find the slice again in a later prompt. A map learned under another value is still found. |

## What you see while a turn runs

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `live.backlog` | `5000` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Live view backlog: Items of one run a page following it live may have yet to take; past that, the page is cut off and told so, and no run waits on a slow page. |

## Sessions

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `compaction.reserve` | `16384` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Compaction starts | Room kept for the answer: Tokens kept free for the answer: a session's earlier turns are summarized when the lead's first call of a turn would not fit its model's window less this. |
| `compaction.keepTurns` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Compaction starts | Turns kept whole: The newest of a session's earlier turns that a summary never stands for. |
| `compaction.records` | `6000` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Carried records before folding (records mode) | Records before folding: Tokens of records the records mode carries before a compaction folds them into the summary. |
| `compaction.saveCalls` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls before a compaction: Model calls the lead makes at the moment before a compaction; the tools of the last of them run, and nothing after them. |
| `carry` | `continuing` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: How context is carried in a session | Context carried in a session: What a session carries between turns: continuing, records or nothing. |

## The turn

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `lead` | `author` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Lead agent: The agent definition that leads a turn. |
| `chat.hiddenReadable` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hidden messages readable by agents | Hidden messages readable: Agents may read the messages the player hid from the prompt. |
| `since.editedBudget` | `4000` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Edited replies in the briefing: Tokens the briefing spends on replies edited after their turns, told in full, the newest first; the rest are named in one line. |
| `history.window` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: History window | History window: The latest this many of the chat's messages stay in the prompt. |
| `history.step` | none (off) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The window's step | Window step: Lets the window grow by this many messages before it is cut back to its size. |
| `history.hold.on` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold uncovered messages: Keeps a message the story record does not cover yet in the prompt. |
| `history.hold.cap` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold's most: The most messages the hold keeps past the window. |
| `passConnection` | none (the default connection) | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Connection for requests with no tag: The connection a request with no tag is passed on to. |

## Bootstrap

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `bootstrap.tokenLimit` | `200000` | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Bootstrap asks before | Bootstrap token limit: Tokens sent and written together by a bootstrap job's agents, at which the job ends with what it has. |

## Characters and their memories

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `cast.queryItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Items a cast query gives: The most items of one part one cast_query answers with; the answer says how many more there are. |
| `cast.secretConfidence` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sureness of a secret learned: How sure, from 0 to 1, a character is of a secret a perception says they now know. |
| `cast.topOfMind` | `9` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Top of mind | Top of mind: The most memories a character holds at top of mind. |
| `cast.shortTermDays` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Short-term memory | Short-term memory: Days of story time a memory stays short term, unless a dream settles it sooner. |
| `cast.fadeDays` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Days a memory takes to fade: Story days in which a memory of weight 1, never recalled, falls to half its strength; each point of weight doubles it, each recall adds as much again. |
| `cast.faintBelow` | `0.25` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Faint below: The strength, from 0 to 1, under which a memory is faint and shown as its gist. |
| `cast.memoryWeight` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weight of a memory given none: The weight a memory has when it is written with none. |
| `cast.weightMax` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Highest weight of a memory: The highest weight a memory can have; weights run from 1. |
| `cast.comesToMindTokens` | `2000` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: What comes to mind | What comes to mind: Tokens of a character's memories that come to mind for a scene. |
| `cast.charsPerToken` | `3.2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters per token, for the cast: Characters counted as one token in the cast's budgets, where the model gives no count of its own. |
| `cast.recallItems` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Memories one recall brings back: The most memories one recall brings back; the answer says how many more touch the cue. |

## The story record

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `story.queryItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Items a story query gives: The most items one story_query answers with; the answer says how many more match. |
| `story.ahead` | `2` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Messages ahead of a turn: Messages the chat is taken to grow by before the next turn's prompt (this turn's reply and the player's next message), where the story record is measured. |
| `story.soFar.share` | `0.05` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The story so far, in the briefing | The story so far: share of the window: The share of the Author's window the briefing's story so far may fill. |
| `story.soFar.floor` | `6000` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The story so far, in the briefing | The story so far: fewest tokens: The fewest tokens the briefing's story so far may fill, however small the window. |

## Lumiverse

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `lumiverse.session.check` | `43200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Session check: Seconds between RPE asking Lumiverse after its sign-in, which renews it; Lumiverse ends a session seven days after its last renewal. |
| `lumiverse.sockets.ping` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket ping: Seconds between pings on the event and relay sockets; Lumiverse closes a socket silent for 120. |
| `lumiverse.sockets.pong` | `15` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket pong wait: Seconds a ping waits for its answer before the socket is opened again. |
| `lumiverse.sockets.open` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket open wait: Seconds an opening socket waits for Lumiverse to let it in. |
| `lumiverse.sockets.retry` | `1` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket first retry: Seconds before a closed socket is opened again, doubled after each failure. |
| `lumiverse.sockets.retryMax` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket longest retry: The longest wait in seconds between tries to open a socket. |
| `lumiverse.database.tries` | `4` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Database tries: Tries of a read while Lumiverse holds its database file locked. |
| `lumiverse.database.wait` | `0.025` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Database first wait: Seconds before the second try of a locked read, doubled after each try. |
| `lumiverse.reads.rereads` | `3` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Rereads of a changing chat: Times a chat read over HTTP is read again when it changed while it was read. |
| `lumiverse.reads.breakdownReplies` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Replies asked for a breakdown: The newest replies asked when looking for the prompt breakdown Lumiverse stored. |
| `lumiverse.dryRun.wait` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Dry run wait: Seconds a dry run is waited for before the reply goes on without its blocks' names. |
| `lumiverse.stream.comment` | `5` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Stream comment: Seconds a reply's stream may send nothing before a comment line keeps its connection open. |
| `lumiverse.relay.flush` | `0.25` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay flush: Seconds between the relay's frames to a page; a frame for every event floods Lumiverse's socket. |
| `lumiverse.relay.frame` | `256` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay frame: KiB of characters in one relay frame; a longer list goes in parts. |
| `lumiverse.relay.lease` | `60` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay lease: Seconds a page's follow lasts unless the page asks again. |
| `lumiverse.relay.hold` | `1024` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay hold: KiB of characters a page may have waiting before its chats' events are held. |
| `lumiverse.relay.retry` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Registration retry: Seconds before RPE registers again with an extension that did not take its registration. |
| `lumiverse.question.body` | `8192` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Question size: KiB the extension's question before a generation may carry. |
| `lumiverse.search.hits` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search hits: Hits a chat search gives when the query names no number. |
| `lumiverse.search.snippet` | `80` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search snippet: Characters of a chat search hit's snippet. |

## The install: config.json

`config.json` in RPE's data folder holds the install's facts, not settings: which Lumiverse RPE serves and as which user, its database file, the port RPE's connection in Lumiverse points at, and that connection with its models. The command line writes them (`rpe up`, `rpe lumiverse`); the Settings page lists them and never writes them. `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER` in the environment win over `port`, `lumiverse.url` and `lumiverse.user`. A `config.json` of an earlier build that still holds limits has them moved into `RPE-global.yml` at RPE's first start, each value kept.

| Key | Default | What it is |
|---|---|---|
| `lumiverse.url` | none | Lumiverse's address |
| `lumiverse.user` | none | Your Lumiverse user |
| `lumiverse.database` | none | Lumiverse's database file |
| `port` | `7871` | RPE's port, on loopback, that its connection in Lumiverse points at |
| `lumiverse.connection` | none | RPE's connection in Lumiverse |
| `lumiverse.models` | `["rpe"]` | The models that connection offers |
