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
| `update.keepCopies` | `1` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Known-good copies kept: Copies of RPE's own build kept beside the one that runs, the newest first, for the service's pre-start step to put back when a swapped-in build does not come up. |
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
| `auth.webSessionMinutes` | `30` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A web session holds: Minutes a session of the web app holds, which the printed token or a Lumiverse sign-in opens; it is renewed while a page is open. |
| `auth.nonceSeconds` | `60` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A page's nonce is remembered: Seconds RPE remembers a nonce a page sent for its proof that this is RPE; the same nonce is not answered twice within them. |
| `auth.signInTries` | `4` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wrong Lumiverse passwords tried: Wrong Lumiverse passwords RPE sends Lumiverse before it pauses; at most 4, below the 5 after which Lumiverse locks RPE's own address out. |
| `auth.signInPauseMinutes` | `15` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Pause after wrong Lumiverse passwords: Minutes RPE sends Lumiverse no password after the wrong ones the setting before allows. |
| `liveSocket.queueEvents` | `512` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Events held for a slow page: Events the live socket holds for one slow page following one chat; past it the oldest are dropped, and the page is told which. |
| `liveSocket.messageBytes` | `65536` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest live message: Bytes of the largest message a page may send on the live socket. |
| `liveSocket.follows` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Chats one live socket follows: The most chats one page's live socket may follow at once; the user's jobs and his own events count as one each. |
| `liveSocket.chatIdChars` | `200` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Longest chat id followed: The most characters of a chat id a page may follow on the live socket; a longer one is refused. |
| `liveSocket.sockets` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Live sockets open at once: The most live sockets RPE keeps open at once; one more is closed at once with the reason. |
| `server.idleSeconds` | `60` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Idle connection closed after: Seconds a connection may send and be sent nothing before RPE closes it; 0 for no bound. A reply's stream and the live socket stay open by what they send. |
| `server.headroomBytes` | `1048576` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Room above the largest request: Bytes above the largest body any route takes at which the server itself refuses a request, so that each route refuses a body over its own limit in its own words first. |
| `server.answerKeepSeconds` | `300` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A long request's answer kept: Seconds the answer of a request RPE answered at once with an id is kept, once ready, for the page to read; one never read is dropped then. |
| `database.busyMs` | `5000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wait for another writer: Milliseconds a write waits for another program's write to RPE's database file to finish. |
| `database.sliceMs` | `10` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Writes run at a time: Milliseconds the write queue runs writes before it lets other work in. |
| `commandLine.waitMs` | `3000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for RPE: Milliseconds rpe status and rpe connection wait for the running server, and a command waits for the data folder's lock. |
| `commandLine.signInMs` | `30000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for a sign-in: Milliseconds rpe lumiverse waits for Lumiverse to answer its sign-in. |
| `commandLine.startMs` | `30000` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | rpe up waits for RPE to start: Milliseconds rpe up waits for RPE to answer once it has started RPE's service, before it puts back what it did. |
| `commandLine.askEveryMs` | `250` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | rpe up asks whether RPE answers every: Milliseconds between rpe up's asks whether RPE answers yet, while it waits for RPE's service to start. |
| `server.workerParseBytes` | `1048576` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Parsed on a worker from: Bytes from which a request's body is parsed on a worker thread, so that a long prompt's parse never holds up another request. |
| `workers.threads` | none (the machine's cores less one, at least one) | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Worker threads: The most worker threads RPE runs its heavy work on at once: parsing very large requests, searching. |
| `index.batch` | `500` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Index rows written at once: Rows the index file's writer writes in one transaction. |
| `database.copiesKept` | `3` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Copies before migrations kept: Copies of RPE's database taken before a new version's migrations that are kept; the oldest are removed once a new version has started. rpe backup's archives and the migration's backups are never removed. |
| `backup.pieceBytes` | `1048576` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Archive piece: Bytes an archive (rpe backup's, the migration's backup) reads each file in at a time. |

## The service

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `service.portLast` | `7899` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The highest port rpe up tries: The highest port rpe up tries when RPE's port is taken, counting up from it; rpe up then keeps the first free one. |
| `service.memory` | `1G` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Memory RPE's service may hold: The most memory RPE's service may hold, as systemd reads a size (768M, 2G) or infinity for none, at least 256M: the unit's MemoryMax. rpe up --memory sets it; the service holds to it from the next rpe up --systemd. |
| `service.restartWait` | `2` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wait before the service starts RPE again: Seconds the service manager waits before it starts RPE again once it has stopped: the unit's RestartSec, written by rpe up --systemd. |
| `service.drainWait` | `300` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A later rpe up waits for turns to end: Seconds a later rpe up waits for the turns under way to end before it restarts RPE's service; it restarts it at the end of the wait all the same. |

## Switches

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `switches.nameLength` | `200` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The longest name a switch takes: Characters in the longest name of a hook, a command, an MCP server or a connection's place that RPE's registry of what is switched on takes; a longer name is refused. |

## Pages

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `pages.probeMs` | `3000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page waits for a direct address: Milliseconds a page in Lumiverse waits for each of RPE's addresses to answer it directly, before it takes the road through the extension. |
| `pages.startMs` | `35000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page waits for the extension's start-up facts: Milliseconds a page in Lumiverse waits for the extension's start-up facts. The page keeps the last value RPE gave it in the browser, and holds it from its next start. |
| `pages.renewAheadMs` | `60000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page token renewed ahead: Milliseconds before a page token runs out that the page asks for a new one (never later than half the token's life). |
| `pages.reconnectMs` | `1000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's first reconnect wait: Milliseconds a page waits before it opens the live socket again after it closed, or asks again for a page token it could not have; each failure doubles the wait. |
| `pages.reconnectMaxMs` | `30000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's longest reconnect wait: Milliseconds at most a page waits between tries at the live socket or at a new page token. |
| `pages.jobPollMs` | `1000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page asks after a long request: Milliseconds between a page's asks for the answer of a request that RPE took in hand and answered by an id, such as a connection test the relay could not wait for. |
| `pages.tickMs` | `1000` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's running clocks tick: Milliseconds between the redraws of a running timer on a page. |
| `pages.redrawMs` | `100` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Live and Turn pages redraw at most every: Milliseconds at most between redraws of a watched turn on the Live and Turn pages while it streams; what a read of it gives shows at once. |
| `pages.keepRuns` | `4` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Runs the Live page keeps: Runs of a chat the Live page holds at once; once more have ended than this, the oldest ended is let go, named with a link to its Turn page. |
| `pages.keepFailures` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Handler failures the Live page keeps: Handler failures told to a chat that the Live page holds at once; once more have come than this, the oldest is let go. A failure stays on the page until it is dismissed. |
| `pages.turnsAtATime` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns read at a time: Turns the Turns list and the World page's turn picker read from RPE at a time (RPE gives at most 500). |

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
| `lore.index.batchChars` | `48000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lore indexing, characters per call: The most characters of entry text handed to one call of a lore indexing run, so long entries never overrun a small model's window; one entry is handed at least, however long. |
| `lore.index.page` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lore index, entries per page: Entries one page of the lore index on the Lore page holds. |
| `lore.index.entry` | none (no index entry of his own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Your own lore index entry: A lore entry of yours whose text heads the readable lore index of each chat, in front of the lines RPE writes. Give its id in Lumiverse. |

## The engine's tools

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `engine.nearMatches` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Near matches listed: How many near matches an answer about a name that is not there lists. |
| `engine.nearDistance` | `0.25` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Spelling distance of a near match: How far off in spelling a name may be and still be offered as a near match, as a part of the name's length: 0.25 lets a quarter of its letters differ. |
| `engine.queryDepth` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Depth of a world query: How many levels below its point world_query shows when it names no depth. |
| `engine.searchHits` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Hits a world search gives: The most things one world_search answers with. |
| `engine.dueItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Things falling due listed: The most things falling due in a span an answer lists, soonest first; how many more fall in it is said. |
| `engine.creditScoreAssumed` | `700` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Score assumed for someone with none: The credit score the finance tables are read at for someone with no score recorded. |
| `engine.editOps` | `64` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Operations one GM edit carries: The most operations one GM edit carries; an edit with more is refused naming this setting, and one already recorded is never held to it. |

## `migration`

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `migration.rows` | `[]` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Rows you give to what the migration finds: A file the migration finds that no row of its table names fails the report by name. A row given here (its path, what becomes of it, and your line saying what it is) is counted, kept in the backup and listed in the report as yours; nothing is carried that has no reader. |

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
| `files.idChars` | `128` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Longest id that names a folder: Characters of a session's or a turn's id, which names its folder; RPE's own ids are 36, and an id is letters, digits, _ and - whatever this says. |
| `files.listPage` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Entries a Files page lists: Files and folders the Files page lists in one page of a folder, or of a search, when it asks for no number. |
| `files.listMost` | `1000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most entries a Files page lists: The most files and folders one page of the Files page's listing gives, whatever number it asks for. |
| `files.readLines` | `500` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lines of a file read at once: Lines of a file the Files page reads in one go when it names none: a long file is read a part at a time, never whole. |

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
| `limits.turn.toolRounds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool rounds in a turn: Answers that call tools, across all the agents of one turn; past it the turn's work ends at this limit. |
| `limits.turn.depth` | `2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agent depth: How deep sub-agents may go: at 1 only the lead starts them, at 2 they may start their own, at 0 none is started. |
| `limits.turn.agents` | `24` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agents in a turn: Sub-agents one turn may start in all. |
| `limits.turn.agentsAtOnce` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agents at once: Sub-agents of one run at work at the same time; one more waits for a place, first come first served. |
| `limits.toolsAtOnce` | `4` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool calls at once: An answer's tool calls that run at the same time, for an agent whose definition sets none of its own; one more waits for a place. |
| `limits.repeats` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Same call in a row: The same tool call with the same arguments this many times in a row, with nothing written by any agent between, ends that agent's work at this limit. |
| `limits.cachedWeight` | `0.1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weight of a cached token: What a token read again from a provider's cache counts for against every limit on tokens sent, from 0 to 1: an agent's, a turn's, a job's and a day's. |
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
| `jobs.connections.<connection>.atOnce` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs at once on a connection: Jobs on this connection that run at the same time. |
| `jobs.connections.<connection>.perDay` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs in a day on a connection: Jobs on this connection that may be started in a day. |
| `jobs.run.calls` | `60` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Calls in a job's run: Model calls all the agents of one job's run may make between them. |
| `jobs.run.tokensIn` | `600000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens sent in a job's run: Tokens sent to models across all the agents of one job's run. |
| `jobs.run.tokensOut` | `60000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens written in a job's run: Tokens models write across all the agents of one job's run. |
| `jobs.run.time` | `900` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time for a job's run: Seconds one job's run may take. |
| `jobs.run.agents` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Sub-agents in a job's run: Sub-agents the agents of one job's run may start in all; 0 starts none. |
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
| `calls.secretFloor` | `8` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length a secret is looked for at: Characters from which a key or a header's value is taken out of a provider's words wherever it stands; a shorter one is taken out where it stands as a word of its own. A key shorter than this is refused. |
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
| `lead` | none (no lead: no turn is played) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Lead agent: The agent definition that leads a turn; the shipped config names the Author. |
| `chat.hiddenReadable` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hidden messages readable by agents | Hidden messages readable: Agents may read the messages the player hid from the prompt. |
| `since.editedBudget` | none (every one in full) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Edited replies in the briefing: Off as shipped, every edited reply is told with both its texts whole. Set, the tokens the briefing spends on replies edited after their turns, told in full, the newest first; the rest are named by message in one line, with no text. |
| `history.window` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: History window | History window: The latest this many of the chat's messages stay in the prompt. |
| `history.step` | none (off) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The window's step | Window step: Lets the window grow by this many messages before it is cut back to its size. |
| `history.hold.on` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold uncovered messages: Keeps a message the story record does not cover yet in the prompt. |
| `history.hold.cap` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold's most: The most messages the hold keeps past the window. |
| `passConnection` | none (the default connection) | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Connection for requests with no tag: The connection a request with no tag is passed on to. |

## `turns`

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `turns.page` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns on a page: The turns a chat's list on the Turn page gives when the page names no number. |
| `turns.pageMost` | `500` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most turns on a page: The most turns one page of a chat's list may ask for. |

## `map`

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `map.laidFeet` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Width of a square laid in play: How wide, in feet, a square is on a grid laid in play that names no size. |
| `map.roundSeconds` | `6` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Seconds in a round: How long a round is on a grid whose square a round's move crosses; a fight counts time in them. |
| `map.roundFeet` | `30` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Feet moved in a round: How far someone moves in a round, where nothing says how fast they are. |
| `map.printColumns` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: the map | Map printed, columns: The most columns of a map the world state prints; a wider map is printed around the horizon. |
| `map.printRows` | `30` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: the map | Map printed, rows: The most rows of a map the world state prints; a taller map is printed around the horizon. |
| `map.diagonal` | `one` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | How a diagonal counts: one: a diagonal step is one square; alternate: every second diagonal in a row is two. A world's ruleset that says otherwise wins. |
| `map.distances` | `feet` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Distances told in: feet or metres. A world's ruleset that says otherwise wins. |

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
| `lumiverse.reads.keep` | `15` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Seconds a read over HTTP is held: Seconds what RPE read of Lumiverse's rows over HTTP is held before it is read again; an event Lumiverse sends for a change lets it go at once. Read from the database file, a read is held exactly as long as the rows are unchanged. |
| `lumiverse.reads.kept` | `32` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chats, books and presets held: How many chats, books and presets have what RPE read of them held at once; the one left alone longest goes first. |
| `lumiverse.dryRun.wait` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Dry run wait: Seconds a dry run is waited for before the reply goes on without its blocks' names. |
| `lumiverse.stream.comment` | `5` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Stream comment: Seconds a reply's stream may send nothing before a comment line keeps its connection open. |
| `lumiverse.relay.flush` | `0.25` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay flush: Seconds between the relay's frames to a page; a frame for every event floods Lumiverse's socket. |
| `lumiverse.relay.frame` | `256` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay frame: KiB of characters in one relay frame; a longer list goes in parts. |
| `lumiverse.relay.lease` | `60` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay lease: Seconds a page's follow lasts unless the page asks again. |
| `lumiverse.relay.hold` | `1024` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay hold: KiB of characters a page may have waiting before its chats' events are held. |
| `lumiverse.relay.retry` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Registration retry: Seconds before RPE registers again with an extension that did not take its registration. |
| `lumiverse.reply.hold` | `540` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Whole reply hold: Seconds after a reply asked for whole arrives at which its turn stops with what it has; Lumiverse ends a generation that has had no text for ten minutes, and nothing reaches it while a whole reply is written. |
| `lumiverse.question.body` | `8192` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Question size: KiB the extension's question before a generation may carry. |
| `lumiverse.extension.questionWait` | `3` | RPE-global.yml | at its next use | Appendix D.1: How long the extension waits for RPE's answer before a generation | Question wait: Seconds the extension waits for RPE's answer to its question before a generation, and RPE works it out in; a half not worked out in them is answered not known: the extension then keeps every marked secret out, and RPE makes the cut when the reply's request arrives. |
| `lumiverse.extension.logChars` | `200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Extension log words: Characters of RPE's words the extension writes in Lumiverse's log when RPE refuses its question. |
| `lumiverse.extension.requestWait` | `35` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page request wait: Seconds a page's request through the extension waits for its answer; Lumiverse's proxy gives up after its own 30. |
| `lumiverse.extension.followRenewal` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page follow renewal: Seconds between a page's renewals of its follow of a chat; keep it well inside the relay lease. |
| `lumiverse.search.hits` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search hits: Hits a chat search gives when the query names no number. |
| `lumiverse.search.snippet` | `80` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search snippet: Characters of a chat search hit's snippet. |
| `lumiverse.untagged.whileAwaited` | `pass` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Untagged request while a reply awaits its tag: pass: a request with no tag is passed on, as every other is. fail: while a reply RPE heard start on its connection has neither sent its tagged request nor ended, a request with no tag on its connection is answered with an error line; it may fail a title or summary asked meanwhile. |

## The install: config.json

`config.json` in RPE's data folder holds the install's facts, not settings: which Lumiverse RPE serves and as which user, its database file, the port RPE's connection in Lumiverse points at, and that connection with its models. The command line writes them (`rpe up`, `rpe lumiverse`); the Settings page lists them and never writes them. `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER` in the environment win over `port`, `lumiverse.url` and `lumiverse.user`. A `config.json` of an earlier build that still holds limits has them moved into `RPE-global.yml` at RPE's first start, each value kept.

| Key | Default | What it is |
|---|---|---|
| `lumiverse.url` | none | Lumiverse's address |
| `lumiverse.user` | none | Your Lumiverse user |
| `lumiverse.database` | none | Lumiverse's database file |
| `port` | `7871` | RPE's port, on loopback, that its connection in Lumiverse points at |
| `lumiverse.connections` | `[]` | RPE's connections in Lumiverse |
| `lumiverse.models` | `["rpe"]` | The models that connection offers |
