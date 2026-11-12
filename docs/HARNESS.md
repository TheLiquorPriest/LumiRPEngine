# The harness engine

A world chat is played by one of three engines, chosen per chat in **GM → This chat → Engine**: the classic steps, agents, or the harness. This page is about the harness: first for someone playing on it, then for someone reading its code.

On the harness an AI **author** plays each turn. Nothing about a turn is fixed in code: the author decides what the turn needs and does it by calling tools. LumiRPEngine supplies the tools, the agents' definitions, the skills and the rules of the world, and makes no model call of its own. The agents run in [LumiAH](https://github.com/TheLiquorPriest/LumiAH), an agent harness that is built into LumiRPEngine.

## For a player

### Switching a chat to it
A chat new to its world plays on the harness from its first turn. The harness plays only in LumiRPEngine's runtime, a program you start beside Lumiverse: the drawer's **Harness** tab → **System** → **Runtime** shows the line to run, once. Attaching a world, a new world chat and the Engine switch set the chat to the runtime by themselves. A chat made before keeps the engine it had: choose **Harness** in **GM → This chat → Engine** to move it. The switch applies from the next turn, and a Branch of the chat keeps it.

While the runtime is down (or a permission it needs isn't granted), a Harness chat plays nothing: a reply you ask for is stopped before anything is written, a card under your message says why with **Retry**, and Play's first screen and **GM → This chat → Engine** say what to do. The same holds while one of the engine's agents can't use a tool it is given (you switched it off on the **Tools** page of the **Harness** tab): the card names the agent and the tool. No other engine plays it meanwhile: the classic steps play only a chat you set to them.

The drawer's **Harness** tab holds the harness's own pages for the chat: what the agents are doing now, each turn's session, jobs, the workspace, the agents, skills and tools, and its settings. Its switch for a chat and the Engine choice are one choice: off there is the classic steps here.

### What happens in a turn
1. **You send a message.** The author is shown your newest message, its own notebook and the scene as it stands, not the prompt Lumiverse assembled from your preset.
2. **The author chooses how the moment is played.**
   - A plain line to someone present goes on the **direct line**: a principal answers you in their own words, streaming as the reply, while the author watches whether the world does anything. Anyone else the author answers in their voice itself.
   - A **scene** is set and played beat by beat: each principal acts from their own mind, the game master rules on what is contested with the engine's dice, and the author writes what the world does, until it is your move again.
   - **Time that passes** is played as fully as it matters: lived as a scene, played by the author alone round a campfire, settled with the game master and told to those it concerns, or simply written. Your story budget (**Settings → Story → Budget**) bounds how many of the fuller treatments a stretch of story time gets.
3. **The reply is told from what was decided.** Each beat says who did or said what, where and when, and whom it reached. The narrator tells the beats from your character's point of view, a check holds each passage to them, and the author releases it (`reply_write`): the reply may come passage by passage while the scene goes on. Nothing is read back out of the reply afterwards.
4. **The turn is recorded** when the reply ends, on the reply, as on the other engines.

**Stop.** With nothing of the reply released yet, the turn is let go and nothing of it is recorded. Once something was released, what was released stands, the turn keeps what it had committed (what was only staged goes), and its record says the reply was stopped.

### Who plays
| Agent | What it does | What it reads |
|---|---|---|
| The **author** | Decides the story, casts it, and keeps its own notebook of where the story stands and where it points | Everything, secrets marked |
| A **character** (one for each principal) | Acts as that person, and keeps their memory, beliefs and plans in their own words | Only what reached that person, and their own mind |
| The **game master** | Rules on what the world's rules don't settle, with the engine's dice; as shipped, checks each passage against its beats | The whole world, secrets marked |
| The **narrator** | Tells the beats as the reply, in your preset's prose | Only what reached the point of view it tells |

**Casting.** Not everyone gets a mind. An extra is voiced by the author, a supporting character has a short profile the author keeps, and a principal acts as their own agent. The author promotes someone who recurs or carries stakes, demotes someone who leaves the story, and says why. A standing you pin stays as you set it. Someone new is made on the spot and starts as an extra.

Agents other than the author stage their changes; the author commits them. An agent writes the game master's kind of edit only when the author grants it.

### After the reply
The story goes on in the background, in jobs the author starts: the principals a beat reached take it in (the next turn waits for them a little), the author reflects in its notebook (lightly after a reply, more deeply when a scene ends, fully when a chapter turns), it looks at what people and plots elsewhere did meanwhile, settling that now or keeping it as a draft until the story needs it, and principals likely to act next think ahead. Each job belongs to its reply: swipe the reply away, delete it, or edit an earlier message, and its jobs stop.

The engine still does three things by itself, with no model, when a turn commits: the world's rules hear what changed, the story's quests step, and people elsewhere are caught up to the present.

### Correcting the story
Say out of character that something shouldn't have happened, or should have gone otherwise. The author strikes or rewrites those beats, puts the world right, sees that whoever they reached is told, and answers you briefly. With Sovereign Hand on, your messages are directions already.

The author's notebook is in the drawer's **Harness** tab, under Workspace (`author/notebook.md` and the pages it lists): read it to see how the author understands your story, and edit it to steer.

### The GM assistant
**GM → Assistant** is the same page on a Harness chat: you ask, it reads the world with nothing kept from it, and what it would change comes back as a proposal you apply or turn down. Its answer comes from a LumiAH agent, the **GM assistant**, in a conversation of its own beside the chat, so it runs on the connection, model and budgets LumiAH's settings give that agent, and you can watch it work in the drawer's **Harness** tab.

### Changes that ask first
On a Harness chat every change an agent makes lands with its turn, unless you set its type yourself in **Settings → Changes from the reply**: a type you set to **Confirm** still asks, and one you set to **Never** is refused, and the agent is told. The older engines' own defaults and what they learned don't apply here. A change that asks goes on the turn's review card in plain words: under your message while the turn waits, or on the reply, as **Settings → Agents → Review card** says. The card names the agent that asked for each change, by the name it has here: the author for its turn, and an agent that works after the reply says so.

### The reply's footer, and undoing a turn
Each reply a turn was played for ends with one line of what the turn did: the time that passed, how many beats it recorded, how many people and things it changed, and its changes to the world. The line opens to the turn's changes, and **Record** opens the turn's record in the drawer (Harness → Story → Record). On the latest reply, **Undo the turn** takes the reply away with everything its turn wrote: what changed in the world, its story record, and the work its agents were still doing after the reply. Your message stays, so you can send it again or change it. Undo is the whole turn or nothing: there is no Undo for one change. It is refused, and says why, while a turn is under way, and for any reply but the latest. To correct one thing, say so to the author in your next message.

### This chat's own world, and the world's document
The author may change the world itself: a new place, a way between two places, a map, how maps work. As shipped it changes this chat's own world: it plays at once, in the same turn, and it is undone with its turn. Nothing of it reaches the world's document, which other chats start from, until the author keeps it there (`world_keep`), and committing the document as the world's next revision is a separate act. When you bring this chat to a newer revision of the world, what it changed comes with it, as its people and things do: if you changed the same place, path or map in Build, this chat keeps its own. Once the document has a change as this chat made it (kept and committed), the document's version plays from then on, and your later edits of it reach this chat.

When the author commits the world's document, the reply lists what changed, marked as made, with **Open in Build**. Undoing the turn leaves the world's document as it is: to change it, edit the world in Build, or ask the author in your next message. Your own unfinished work in Build is never published or thrown away by an agent. If the draft holds edits of yours when the author commits, the commit waits on the review card, which says why, and your Apply makes it. Set "The world's document" to **Confirm** to be asked about every commit, and "The world as this chat plays it" to be asked about each change to this chat's own world.

### What you can change
- **Every text an agent is sent:** each agent's name, purpose and instructions, each skill, each tool's description, and the world's guidance, in **Settings → Prompts → Harness engine**.
- **Time when the author says none:** under the Engine switch on a Harness chat. On (the default), a turn whose author never says how much time it took takes the scene's usual time. Off, it takes none.
- **Sovereign Hand:** under the Engine switch on a Harness chat. Follow Lumiverse (the default) goes by Lumiverse's own Sovereign Hand switch; On makes your messages directions to the author, which then decides what everyone does, your character included, as you direct; Off keeps them your character's words and deeds. With it on, **Your newest message** says whether the author is given it as the direction for the reply (the default) or not, where your preset carries it.
- **Each agent's connection, model, effort and budgets,** in LumiAH's settings. Its name, what it is for, its instructions and its tools stay the engine's, whatever version of the agent you keep there: its texts are edited in **Settings → Prompts → Harness engine**, and they name its tools. A tool switched off on the **Tools** page of the **Harness** tab is off for every agent, and a turn waits until each of the engine's agents can use every tool it is given.
- **Which engine a chat plays,** at any time between turns.

### When a turn isn't played
A reply can stand with no turn played for it: the author's run failed, or the extension restarted while the reply was being written. It gets a **No turn was played** flag that says why, nothing of that turn is recorded (what its author had already committed included), and the author of the next turn is told that nothing the reply tells is in the world.

On a Harness chat the engine reads and tells no reply itself, so **Re-read edit**, **Retry read** and **Swipe as…** aren't offered. A swipe or a Regenerate plays the turn afresh.

## For someone reading the code

### The boundary
`src/backend/harness/` is LumiRPEngine's side. LumiAH is given two objects and nothing else (`extension.ts`, `HarnessEngine`):

| Given | Members | What each does |
|---|---|---|
| `extension` | `definitions` | The agents and skills, in the asking user's own texts, each with its part of the chat's preset (`story/preset.ts`) |
| | `claim` | For a world chat on the harness: the author as main agent, the world's guidance, and `place: "runtime"`, `request: "newest"`, `reply: "released"` |
| | `runBegan` | Opens the engine's side of the turn (`OpenTurn`) and readies the author's notebook |
| | `agentModel` | The connection, model and effort an agent starts on (`shared/story-models.ts`); an agent of a job's run takes the job's kind of run |
| | `releasing`, `released` | Each passage held to the turn before it goes out, and noted once it went (`story/narration.ts`) |
| | `replyWritten`, `runEnded` | The reply's text and LumiAH's own record of the turn |
| `tools` | `list`, `call` | The engine's tools for a chat; one call, run with a `ToolEnv` built for that agent |

- **Every member is told which user it is for.** A named user is used as told and never kept; only what Lumiverse's own events said of a chat is remembered.
- **No model call.** Nothing under `src/backend/harness/` calls a model, and `test/backend/harness-turn.test.ts` fails if the harness path reaches one of the engine's own.
- **The runtime is required.** A chat the engine plays runs only in LumiAH's runtime: the claim says so (`place: "runtime"`), the guard stops any generation not on its way to a runtime that can take it, and LumiAH never runs such a chat built in. While the runtime is down the chat plays nothing and says why.
- **The reply is the engine's.** No writer writes it (`reply: "released"`): the author releases it piece by piece (`reply_write`), or hands its stream to a principal on the direct line (`delegate` with `to_reply`), and LumiAH's runtime streams what was released to Lumiverse as one reply. Nothing of the world goes into the prompt (`request: "newest"`), and nothing is read out of the reply afterwards.
- **The gate.** Before each piece goes out, LumiAH asks `releasing`: only the author releases, and only a passage whose latest draft passed its check (or was checked with its drafts spent), or a few words of the author's own (`narration.ownChars`). A failed or late answer lets nothing go. `released` notes what went out on the turn's stage book.
- **Shapes.** `shapes.ts` and `definitions/lumiah.ts` re-export LumiAH's own types and names from the package; they hold no copy. Only `src/backend/harness/` and `src/frontend/harness/` import `lumi-ah` (`test/boundaries.test.ts`).
- **The agents' tools.** Each definition keeps its name, description, instructions and tools as the engine's (`owns`), and each skill is the engine's (`owned`), offered only to the agents that hold every tool it names (`agents`). `test/backend/harness-cast-held.test.ts` holds every text an agent is given (its instructions, what a chat adds to them, the world's guidance, its skills) to the tools it holds, and each agent a text tells it to start to one it can start. As a turn starts the guard asks LumiAH what each agent can use in the chat (`held`): an agent of the cast that can't use a tool it is given (switched off, or not there) keeps the turn from starting, in words that name the agent, the tools and what to do. A tool the engine's claim withdraws is no fault.
- **The author's opening.** Each run's author is given, beside its instructions, its pinned notebook index and scene (`author/notebook.md`, `author/scene.md`); the moment as it stands, read by the engine with no model call (the time, where the player's character is, a line naming the principals there, who is there with their standing and what each mind still has to take in, the last beats, each quest in play at its stage), cut to Settings → Story → **The moment, as a turn begins** with the oldest beats left out first, then the quests, then the people there; the drafts due or gone stale and what the prepared start still lacks (`story/opening.ts`, on the author's definition alone); and from LumiAH the jobs due by this turn that are still running.

### The mount
`mount.ts` builds LumiAH's own backend (`createBackend`) into the engine's worker, over the same Lumiverse (`startHarness`, called from `main.ts`). LumiAH is given a host that differs from Lumiverse's own in four places:

| Place | What the mount does | Why |
|---|---|---|
| Storage | Every file of LumiAH's is under `harness/` | Both keep a `settings.json` in the one storage an extension has |
| The record on a message | LumiAH reads its records from the chat's ledger and writes them to it (`HarnessEngine.anchors`, `anchor`); it never touches the message's own entry | A reply holds one record, the engine's, with LumiAH's inside (`Rec.harness`) |
| Lore | LumiAH is shown no World Info book | In a chat the engine plays, lore is read through the engine's tools, under its secrets rule |
| The switch for a chat | `lah.chat.set` from LumiAH's pages goes through `HarnessEngine.choose` | The switch and the chat's engine are one choice; a chat that plays no world can't be switched on |

What the engine takes back from LumiAH, each a port on `HarnessEngine` that the mount sets:

- `pin`, `runtime`, `seated`: LumiAH's switch for a chat (on, in the runtime), why the user's runtime can't answer a chat now (`Backend.runtimeState`, and the `interceptor` and `generation_parameters` permissions), and whether a reply's connection is the runtime's own for the chat. LumiAH tells the mount when a runtime links (`onRuntime`), and chats that couldn't be set to it are set then. A chat not set yet is set as its reply starts, and a reply already on the runtime's connection goes on: a Branch carries the chat's connection, so its first reply plays. The Engine page sets such a chat again once nothing keeps the user's runtime from every chat, and while it still can't be set it says LumiAH's words for that chat (another harness answers it, say), never that no runtime is linked.
- `files`: the chat's area of LumiAH's workspace, for the tools that keep a file (`ToolEnv.files`).
- `core`: LumiAH's core as its pages reach it (side sessions, the workspace), for the GM assistant; and, read from LumiAH's live view, what a run under way has spent so far (`spent`: a job's, or a chat's latest reply turn's), for the prepared start's figures.
- `recorded`: LumiAH is told when its record in the ledger changed, since Lumiverse tells nobody of that write.

A turn's start waits for the turn before it to be recorded, for no longer than **Wait for the last turn** (`agents.harness.commitWaitMs`). When the wait runs out the turn goes on, and its author is told the last turn's changes may not all be in.

### One turn

| Step | Event | What the engine does |
|---|---|---|
| 1 | `GENERATION_STARTED` | Opens the pending turn, as for any engine |
| 2 | The guard | Asks `refused`: a generation not on its way to a runtime that can take it is stopped, and the chat says why (`engine_failed` card, with Retry). Nothing is written into the world's book |
| 3 | `runBegan` | Opens `OpenTurn` on that pending turn |
| 4 | Tool calls | Each runs with the calling agent's view, writer and tier; writes are staged |
| 5 | `commit` (a tool) | Lands what is staged through `commitStaged`; a Confirm change goes to the review card |
| 6 | `reply_write`, `to_reply` | The reply streams as the author releases it |
| 7 | `GENERATION_ENDED` or `GENERATION_STOPPED` | Ended: commits what is still staged, then the core commits the turn and writes its record. Stopped with something released: the core commits the turn as stopped, with only what was committed. Stopped with nothing released: nothing stands |

- **The default tick.** A turn whose author never said its time takes the scene's tick at its last commit (`agents.harness.defaultTick`), and its record says so.

### The turn's record
A reply holds one record. The harness's part is `Rec.harness` (`RecHarness`, `shared/ledger.ts`), outside every hash but the tombstone's:

| Field | Holds |
|---|---|
| `turns` | The harness turns that wrote the record: the reply's, then each Continue's |
| `record` | LumiAH's own record of the latest turn, which its session resumes from; on a reply no turn was played for, LumiAH's record that it had no part in it |
| `defaultTick` | The minutes the default tick added, where it did |
| `unplayed` | Why no turn was played for the reply, or for what a Continue added |

LumiAH's anchor port reads and writes `record` through `HarnessEngine.anchors` and `anchor`.

Beside it, `Rec.story` holds the story's part: the beats the turn and its jobs wrote, the beats they struck, each casting and each draft (`engine/story/record.ts`, `backend/story/record.ts`). It is outside every hash too and follows swipes and branches with the record. A turn stages it and lands it as it commits (`LedgerService.stageStory`); a job writes it at once on its turn's record; the story's prepared start writes it on the chat's first reply, so the past it records stays on every path through the chat, and any other job the player starts on the newest reply. The player's pin on someone's standing, and its lift, go on the newest reply and on the reply before it, each with the mark of what the mind took in that stood there, so a regenerate or a new swipe of the newest keeps the player's word (`castOnReplies`).

A turn that doesn't stand commits nothing. `LedgerService.harnessUnplayed` closes its pending turn and marks the reply; `harnessLost` does the same for a reply whose turn the backend no longer holds, and restart recovery (`open`) for one it finds left open. A run that ends having released nothing fails in LumiAH (`ChatClaim.reply`), so its turn never stands.

### Jobs
`jobs.ts`. No turn is open after the reply, so a job stages nothing: each change is checked against the chat's head and written at once through `LedgerService.write`, as a `confirm` entry on the reply's record. Every write is tied to the record of the turn that started the job, checked before the write and again inside it. Once that record is off the chat's path, the write is refused. A job the engine can tie to no reply (one of a turn it never saw, or one it was never told of) reads the chat as it stands, and what it would change is refused, in words that say why; the log says which case it was. A job the player started belongs to no turn: its calls run on the chat as it stands and change nothing of the world (`story/prepare.ts`). A job an agent started outside the prepared start, in a conversation with an agent or in another job of the player's, only reads.

### Tests
Each file passes alone (`bun test <file>`): `test/backend/harness-runtime` (the runtime claim, what was released as the reply, Stop both ways, no runtime linked), `harness-turn`, `-jobs`, `-resume`, `-unplayed`, `-sovereign`, `-boundary`, `-gates`, `-assistant`, `-held-turn` (a tool switched off keeps the turn from starting), and `harness-cast-*` for the tools and definitions (`harness-cast-held`: each agent holds what its texts name). `harness-driver.ts` plays LumiAH's side of the boundary by hand; `support/runtime-bed.ts` runs the real runtime linked to the mounted backend, with scripted models (`harness-e2e-story`).
