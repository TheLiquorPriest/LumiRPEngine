# The harness engine

A world chat is played by one of three engines, chosen per chat in **GM → This chat → Engine**: the classic steps, agents, or the harness. This page is about the harness: first for someone playing on it, then for someone reading its code.

On the harness an AI **author** plays each turn. Nothing about a turn is fixed in code: the author decides what the turn needs and does it by calling tools. LumiRPEngine supplies the tools, the agents' definitions, the skills and the rules of the world, and makes no model call of its own. The agents run in [LumiAH](https://github.com/TheLiquorPriest/LumiAH), an agent harness that is built into LumiRPEngine.

## For a player

### Switching a chat to it
A chat new to its world plays on the harness from its first turn, where the harness can play it. There is nothing to set up: no program to start, no key, no connection to make. The author works on the chat's own connection, and your preset still writes the reply. A chat made before keeps the engine it had: choose **Harness** in **GM → This chat → Engine** to move it. The switch applies from the next turn, and a Branch of the chat keeps it.

Where Harness can't be chosen, its option can't be pressed and the page says why and what to do (a permission that isn't granted, a Lumiverse too old for it). A chat new to its world then plays its classic steps.

The drawer's **Harness** tab holds the harness's own pages for the chat: what the agents are doing now, each turn's session, jobs, the workspace, the agents, skills and tools, and its settings. Its switch for a chat and the Engine choice are one choice: off there is the classic steps here.

### What happens in a turn
1. **You send a message.** Lumiverse assembles the prompt from your preset as it always does, and waits before sending it.
2. **The author works.** It reads what it needs of the world and the chat, has each character present think for themselves, rolls what needs a roll, moves people and things, lets time pass, and records what changed. Lumiverse gives it at most five minutes.
3. **The author briefs the writer.** The prompt goes out with the author's brief in it and the world's sections where your preset places them, and the reply is written on the chat's connection with the chat's sampling. It streams as usual.
4. **The turn is recorded** when the reply is saved, on the reply, as on the other engines.

The reply starts later than on the other engines, because the author works first.

### Who the other agents are
The author starts them when a turn needs them. Each is a separate model call with its own tools.

| Agent | What it does | What it may read |
|---|---|---|
| A **character** (one for each person who needs to think) | Decides what that person feels, wants and does | Only what that person perceives and knows |
| The **game master** | Rules on what the world's rules don't settle; rolls the dice | The whole world, secrets marked |
| The **knowledge** agent | Works out who learned what | People, and who knows what |
| The **chronicler** | Holds each reply to its turn: records what the reply adds, and notes where it says otherwise | The chat as written, and the world |

Agents other than the author stage their changes; the author commits them. An agent writes the game master's kind of edit only when the author grants it.

### What runs after the reply
Work that needs the finished reply is a **job** the author started during the turn: holding the reply to its turn, the knowledge inference, the characters' memories. Each job belongs to the reply it was started for. If you swipe that reply away, delete it, or edit an earlier message, its jobs stop and write nothing more.

Three things the engine still does by itself, with no model, when a turn commits: the world's rules hear what changed, the story's quests step, and people elsewhere are caught up to the present.

### The reply serves the turn
On the harness the reply doesn't decide what happened. The author and its agents decide that with the engine's tools, under your modes, and the reply is written to tell it. After every reply the chronicler checks it against the turn: the author's brief, what was committed, and the world as it stands.

- What the reply adds that contradicts nothing (someone walks on, a cup is put down, an hour goes by) is recorded, under your modes in **Settings → Changes from the reply**.
- What it says against what the turn decided or the world holds is never written into the world. The reply gets a **The reply doesn't match the world** flag that lists each difference, a line each. On the latest reply, **Regenerate** plays the turn again; or say in your next message how it should go. The author of the next turn is told too, and steers the story back to the world unless you ask for the reply's version.

### The GM assistant
**GM → Assistant** is the same page on a Harness chat: you ask, it reads the world with nothing kept from it, and what it would change comes back as a proposal you apply or turn down. Its answer comes from a LumiAH agent, the **GM assistant**, in a conversation of its own beside the chat, so it runs on the connection, model and budgets LumiAH's settings give that agent, and you can watch it work in the drawer's **Harness** tab.

### Changes that ask first
What you set to **Confirm** in **Settings → Changes from the reply** still asks. Such a change goes on the turn's review card in plain words: under your message while the turn waits, or on the reply, as **Settings → Agents → Review card** says. The card names the agent that asked for each change, by the name it has here: the author for its turn, and an agent that works after the reply says so. What you set to **Never** is refused, and the agent is told.

### Changes to the world's document
The author may change the world itself: a new place, a way between two places, a map, lore. It writes the world's draft, commits it as the world's next revision, and brings this chat to it. As shipped this lands when the author commits its turn, and the chat plays the new revision from the next turn. Nothing waits for you. The reply lists what changed, marked as made, with **Undo** and **Open in Build**. Undo puts the world back as it was before and brings this chat back with it. It is offered only while that revision is still the world's newest and this chat has played no later turn. After that, edit the world in Build, or ask the author in your next message.

Your own unfinished work in Build is never published or thrown away by an agent. If the draft holds edits of yours when the author commits, the commit waits on the review card, which says why, and your Apply makes it. Set "The world's document" to **Confirm** to be asked about every commit.

### What you can change
- **Every text an agent is sent:** each agent's name, purpose and instructions, each skill, each tool's description, and the world's guidance, in **Settings → Prompts → Harness engine**.
- **Time when the author says none:** under the Engine switch on a Harness chat. On (the default), a turn whose author never says how much time it took takes the scene's usual time. Off, it takes none.
- **Sovereign Hand:** under the Engine switch on a Harness chat. Follow Lumiverse (the default) goes by Lumiverse's own Sovereign Hand switch; On makes your messages directions to the author, which then decides what everyone does, your character included, as you direct; Off keeps them your character's words and deeds. With it on, **Your newest message** says whether the author is given it as the direction for the reply (the default) or not, where your preset carries it.
- **Each agent's connection, model, effort, tools and budgets,** in LumiAH's settings.
- **Which engine a chat plays,** at any time between turns.

### When a turn isn't played
A reply can be written with no turn played for it: you stopped it, the author failed or ran out of time before it briefed the writer, or the extension restarted while the reply was being written. You never lose the reply. It gets a **No turn was played** flag that says why, nothing of that turn is recorded (what its author had already committed included), and the author of the next turn is told first, so it reads the reply and records what still matters.

On a Harness chat the engine reads and tells no reply itself, so **Re-read edit**, **Retry read** and **Swipe as…** aren't offered. A swipe or a Regenerate plays the turn afresh.

## For someone reading the code

### The boundary
`src/backend/harness/` is LumiRPEngine's side. LumiAH is given two objects and nothing else (`extension.ts`, `HarnessEngine`):

| Given | Members | What each does |
|---|---|---|
| `extension` | `definitions` | The agents and skills, in the asking user's own texts |
| | `claim` | For a world chat on the harness: the author as main agent, and the world's guidance |
| | `runBegan` | Opens the engine's side of the turn (`OpenTurn`) and gives the world's book back |
| | `writerRequest` | Returns the writer's messages with the turn's sections in place |
| | `replyWritten`, `runEnded` | The reply's text and LumiAH's own record of the turn |
| `tools` | `list`, `call` | The engine's tools for a chat; one call, run with a `ToolEnv` built for that agent |

- **Every member is told which user it is for.** A named user is used as told and never kept; only what Lumiverse's own events said of a chat is remembered.
- **No model call.** Nothing under `src/backend/harness/` calls a model, and `test/backend/harness-turn.test.ts` fails if the harness path reaches one of the engine's own.
- **Who writes the reply is LumiAH's business.** `writerRequest` returns messages whoever sends them, and the engine learns the reply's text from Lumiverse when it is saved. Nothing between `runBegan` and `writerRequest` waits on a clock.
- **Shapes.** `shapes.ts` and `definitions/lumiah.ts` re-export LumiAH's own types and names from the package; they hold no copy. Only `src/backend/harness/` and `src/frontend/harness/` import `lumi-ah` (`test/boundaries.test.ts`).

### The mount
`mount.ts` builds LumiAH's own backend (`createBackend`) into the engine's worker, over the same Lumiverse (`startHarness`, called from `main.ts`). LumiAH is given a host that differs from Lumiverse's own in four places:

| Place | What the mount does | Why |
|---|---|---|
| Storage | Every file of LumiAH's is under `harness/` | Both keep a `settings.json` in the one storage an extension has |
| The record on a message | LumiAH reads its records from the chat's ledger and writes them to it (`HarnessEngine.anchors`, `anchor`); it never touches the message's own entry | A reply holds one record, the engine's, with LumiAH's inside (`Rec.harness`) |
| Lore | LumiAH is shown no World Info book | In a chat the engine plays, lore is read through the engine's tools, under its secrets rule |
| The switch for a chat | `lah.chat.set` from LumiAH's pages goes through `HarnessEngine.choose` | The switch and the chat's engine are one choice; a chat that plays no world can't be switched on |

What the engine takes back from LumiAH, each a port on `HarnessEngine` that the mount sets:

- `pin`, `ready`: LumiAH's switch for a chat, and what LumiAH lacks, asked through LumiAH's own page contract.
- `files`: the chat's area of LumiAH's workspace, for the tools that keep a file (`ToolEnv.files`).
- `core`: LumiAH's core as its pages reach it (side sessions, the workspace), for the GM assistant.
- `recorded`: LumiAH is told when its record in the ledger changed, since Lumiverse tells nobody of that write.

A turn's start waits for the turn before it to be recorded, for no longer than **Wait for the last turn** (`agents.harness.commitWaitMs`). When the wait runs out the turn goes on, and its author is told the last turn's changes may not all be in.

### One turn

| Step | Event | What the engine does |
|---|---|---|
| 1 | `GENERATION_STARTED` | Opens the pending turn, as for any engine |
| 2 | The guard | Never stops the generation. Writes each section into the world's book as the chat's head has it, between marker lines (`markers.ts`) |
| 3 | `runBegan` | Opens `OpenTurn` on that pending turn; empties the book's entries and gives the book back |
| 4 | Tool calls | Each runs with the calling agent's view, writer and tier; writes are staged |
| 5 | `commit` (a tool) | Lands what is staged through `commitStaged`; a Confirm change goes to the review card |
| 6 | `writerRequest` | Swaps each marked span for the turn's own section |
| 7 | `GENERATION_ENDED` | Commits what is still staged, then the core commits the turn and writes its record |

- **The book.** A world's book holds one generation's sections at a time. LumiAH built into Lumiverse works before `GENERATION_IN_PROGRESS`, for up to five minutes, so the book goes back at `runBegan`: by then the prompt is assembled. `GENERATION_IN_PROGRESS` still releases it where no run began.
- **The fallback.** A prompt that goes out untouched holds each section as the chat stood, never marker text: the marker lines read as comments to the preset.
- **The default tick.** A turn whose author never said its time takes the scene's tick at its last commit (`agents.harness.defaultTick`), and its record says so.

### The turn's record
A reply holds one record. The harness's part is `Rec.harness` (`RecHarness`, `shared/ledger.ts`), outside every hash but the tombstone's:

| Field | Holds |
|---|---|
| `turns` | The harness turns that wrote the record: the reply's, then each Continue's |
| `record` | LumiAH's own record of the latest turn, which its session resumes from; on a reply no turn was played for, LumiAH's record that it had no part in it |
| `defaultTick` | The minutes the default tick added, where it did |
| `unplayed` | Why no turn was played for the reply, or for what a Continue added |
| `departures` | Where the reply says something against its turn, a line each (`story_departure`): never written into the world. The reply's flag lists them and the next turn's author is told; a Continue's turn keeps them |

LumiAH's anchor port reads and writes `record` through `HarnessEngine.anchors` and `anchor`.

A turn that doesn't stand commits nothing. `LedgerService.harnessUnplayed` closes its pending turn and marks the reply; `harnessLost` does the same for a reply whose turn the backend no longer holds, and restart recovery (`open`) for one it finds left open.

A turn stands only once its author handed the reply over. LumiAH asks for the writer's request with no brief when the author stopped short of one (it failed, ran out of time, or was stopped in the harness), and then has the reply written without it: `writerRequest` notes that (`OpenTurn.briefed`), `beforeCommit` drops the turn, and the reply is marked. LumiAH's record of such a reply says why in its own words (`ran.noPart`): `anchor` keeps it beside the mark and makes those words the mark's.

### Jobs
`jobs.ts`. No turn is open after the reply, so a job stages nothing: each change is checked against the chat's head and written at once through `LedgerService.write`, as a `confirm` entry on the reply's record. Every write is tied to the record of the turn that started the job, checked before the write and again inside it. Once that record is off the chat's path, the write is refused. Lines of departure take the same tie but no entry: `keepDepartures` (`record.ts`) writes them into the record's harness part alone, in the chat's queue, so nothing of the world moves and no path changes.

### Tests
Each file passes alone (`bun test <file>`): `test/backend/harness-turn`, `-sections`, `-markers`, `-jobs`, `-resume`, `-unplayed`, `-departures`, `-sovereign`, `-boundary`, `-gates`, `-assistant`, and `harness-cast-*` for the tools and definitions. `harness-driver.ts` plays LumiAH's side of the boundary by hand. `harness-e2e`, `harness-e2e-ends`, `harness-e2e-apart` and `harness-e2e-departs` run LumiAH's real backend and core, mounted as production mounts them, on the fake Lumiverse (`test/support/lumiah-bed.ts`), with the agents' model scripted: they are the one place LumiAH's own delegation, tool lists, jobs and settings are in play, and where LumiAH itself is installed beside the engine.
