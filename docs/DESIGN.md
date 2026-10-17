# LumiRPEngine: design

LumiRPEngine is an extension for [Lumiverse](https://github.com/prolix-oc/Lumiverse) that keeps a real, persistent world underneath a roleplay chat: places, people, belongings, money, vehicles, schedules, quests and the calendar. The engine settles what rules should settle (prices, travel times, dice odds, who is where at 3 a.m.), and the AI model spends its effort on writing. The model proposes; the engine decides.

This document is the design behind it: what the engine is made of, the rules it follows, why, and where it stops. I wrote it as a plan before I built the extension and revised it while I built and measured, so this version describes the product as it ships. Where the build departed from the original plan, §20 says so. For how to use the extension, read the [README](../README.md) and the [user guide](USER-GUIDE.md); for the module contract, read [ARCHITECTURE](ARCHITECTURE.md).

**Product**
- Name: **LumiRPEngine**. Repository: <https://github.com/TheLiquorPriest/LumiRPEngine>. Manifest identifier: `lumi_rp_engine`.
- Requires Lumiverse's `staging` branch from 16 October 2026 (commit `9cc9f5d`) or later.
- License: none yet; all rights reserved for now (D20).

## How to read this document

Section numbers are stable: code comments and docs cite them as `DESIGN §9.2`. Other identifiers used throughout:

| Identifier | Meaning |
|---|---|
| `D1`–`D35` | Design decisions (§2) |
| `G1`–`G9` | Gaps in the host that I plan to propose fixes for (§16) |
| `P1`–`P4` | The four principles behind the per-chat ledger (§4.3) |
| `L1`–`L42` | The named invariants the ledger property suite checks (§14) |
| `B0`–`B9` | The internal build blocks (§17); `B0` is the throwaway spike whose checks are in §18 |

A few terms, in plain words:

| Term | Meaning |
|---|---|
| **World** | An authored JSON document (`lre-world-v1`): the kinds of things that exist, the entities, places, rules and schedules. It is shared by every chat that uses it. |
| **Run** | One chat's own state in a world. |
| **Ledger** | The record of what happened in each reply, kept with the reply, plus a durable shadow copy (the journal). |
| **Record, event, marker** | A *record* holds the events of one reply. An *event* is one concrete change (an account posting, a move). A *marker* is a message-level intent such as a realism or time-control change or a world upgrade. |
| **Fold** | Replaying the world, records and markers in order to get the current state. Everything the player sees is a fold. |
| **Rebased view** | How a later record folds when an earlier swipe or message changed underneath it. The stored record is never rewritten. |
| **Pack** | A domain module (money, gear, vehicles, and so on) with a pure engine part and a UI part. |
| **Level, tier, band** | How deeply a domain is simulated (0–4); a world's own rank of importance for an entity (its **tier**); and the fixed **detail band** a tier maps to, whose caps limit its levels (`principal` Leads, `supporting` Supporting, `background` Background). |
| **Slot** | A lore entry the engine owns and fills each turn (Outcome, Scene, People…). |
| **Chip** | A small notice or action offered in the chat: what changed, an undo, a confirmation. |
| **Step** | One unit of the turn pipeline: an engine step, a decision step or a prompted step (§5.2). |
| **Helper, Decision connection** | The helper is the ordinary model connection used for small JSON-answer calls. The Decision connection is the one used through Lumiverse's Decisions API for probability questions. |

## 1. Goal and constraints

**Goal.** Persistent world simulation for Lumiverse with game-engine features, as a Spindle extension:
- **World state:** a schema builder; entities and relationships; deterministic actions; locations; inventories; ownership.
- **Rules and system:** character sheets.
- **NPCs:** full NPC simulation, on and off screen.
- **Weather state.**
- **Quest engine:** gating, puzzles, secrets and event triggers.
- **Play:** deterministic actions during play; location grids and tracking.
- **Context:** the engine controls what reaches the AI. For now that is its own sections: World Info lore handling is switched off, and a lore lookup of the engine's own comes in a later release (§6).
- **Model calls:** targeted simulation calls (regular or decision-type), and outline steps fed into regular generation.
- **A mobile-friendly UI.**
- **Realism:** granular finance, vehicles, gear and NPC lives on a **sliding scale of granularity**, with as much as possible deterministic and taken off the main model (§9).

**Constraints**
- Minimally invasive.
- As simple as possible without compromising any goal.
- Target Lumiverse's `staging` branch from 16 October 2026 (commit `9cc9f5d`) or later.
- **One complete first deliverable (D16).**

**Out of scope**
- **Agentic WORK-mode turns.** The host excludes extensions from them.
- **Background timers.** Simulation is turn-driven.

## 2. Decisions

| ID | Decision |
|---|---|
| D1 | **Warp reuse is permitted** (by japolino). Adapted modules carry a `NOTICE` crediting him (§15). |
| D2 | **World definitions live in extension storage.** Lore stays in World Books. |
| D3 | **Users can scale from lean to whatever ceiling they want** (model use, §5.3; realism, §9.1). |
| D4 | **Narration-implied changes are applied automatically after validation, with an undo chip, or ask first, per change type.** Cold-start modes: `auto` for `time_advance`, `location` and `condition`; `confirm` for `knows`, `give`, `purchase`, `transfer`, `regard` and `spawn`; `quantity` has no cold-start mode and starts at `confirm` (Settings shows "From the field's bound"). As for every type, a stricter field bound wins. These modes are only the starting point: **promotion learns on the player's own connection** (D31; §11). A type flips to `auto` at ≥ 0.90 acceptance over at least 30 confirm/undo chip outcomes on that connection, with a notification chip and undo, and flips back to `confirm` when its rolling undo rate rises past 0.10. Each mode is a setting. |
| D5 | **The engine decides inside its own namespace.** Models only propose, as probabilities or bounded structured proposals. |
| D6 | **Per-chat state is a per-swipe ledger** in message metadata, plus message-level intent markers. Both are journaled to a durable shadow in `userStorage` and re-asserted. It is the only store that follows swipe, branch, export, import and delete. |
| D7 | **Rules are data-only:** predicates, effects and a safe formula language, so imported worlds cannot run code. |
| D8 | **Turn-driven simulation.** Player-known results go in the Journal; a GM view sits behind a spoiler toggle (§7). |
| D9 | **Two hooks, both non-required:** a context handler and a World Info interceptor, plus events.<br>- No prompt interceptor.<br>- No message writes while a generation is in flight.<br>- **Turn-critical simulation runs in the backend process,** inside the context handler, bounded by deterministic units (agent-days, events), never by wall clock. I first planned a separate child process for it. Measurement showed a 600 agent-day timelapse segment takes 38 ms on a child process and 2.5 ms in process, so the unit caps already bound the work and a second process would buy nothing.<br>- CPU-heavy jobs (Playtest, Check world, imports, Build with AI validation) run in one child **background** lane. |
| D10 | **Model routing.** The helper JSON call serves `interpret` (and `extract`); the Decision connection serves `npc.choose`. On any decision error a step falls back to the helper, then to engine-only; there is no blind retry. Each step stays on the connection and model the user chose for it (D31). Basis: the Decision connection read the action alone (no params) at 0.871 top-1 with 6 of 53 calls failing; the helper read it with params at 0.889. |
| D11 | **An engine-managed lore book per world, holding slots only.**<br>- Slot entries are stored `disabled:true, key:[]` and activated only by the engine; they fail closed.<br>- Only engine-book entries ever receive a vote; every other book's entries are left to native World Info.<br>- Secret truth never lives in a World Book.<br>- Amended when lore handling was switched off: world lore is no longer synced into the book (copies an earlier build left there are removed), and adopting user entries and suppressing their sources are retired (§4.2, §6.1). |
| D12 | **UI:** a drawer tab (Play, Build, Settings), a HUD pill, chips, an input-bar palette and a fullscreen map widget. Preact plus host components. |
| D13 | **Model use defaults to Standard.** Deterministic beats are the default outline. Amended: models no longer decide lore selection in the World Info interceptor. Lore handling is off for now (§6.1), so the interceptor makes no model call. |
| D14 | A separate repository, `TheLiquorPriest/LumiRPEngine`. |
| D15 | **Acceptance** is the test suite and type checks, visible checks on a reference Lumiverse instance at phone width, and my own live audit before release (§14). |
| D16 | **One-shot delivery.** Build blocks (§17) are an internal order only; nothing is deferred. |
| D17 | **Granular realism on a sliding scale, made as deterministic as possible.** |
| D18 | **Domain packs and two dials** (depth per domain × entity tier). **The representation is uniform: levels gate processes, rendering and extraction targets, never the data shape.** |
| D19 | **Pinned constants (retired).** User entries stored `constant:true, disabled:false` were charged to the lore budget as pins, so they never displaced engine sections. With lore handling off the engine no longer touches user entries, and native World Info decides them (§6.1). |
| D20 | **No license yet.** It is decided after the extension has proved itself. |
| D21 | **Upstream proposals (G1–G9) are follow-up work** after the first release, which ships with its caveats documented (§16). |
| D22 | **Low realism by default:** new blank worlds start on the Story preset. |
| D23 | **A studio repository built on `japolino/warp-studio` comes next.** LumiRPEngine ships the seam for it now (§15). |
| D24 | **LumiRPEngine registers no extension macros.** A macro would block `decisions.evaluate` during dry runs and force main-process prompt assembly. |
| D25 | **Two named preset families:** *Model use* (Lean, Standard, Full, Custom) and *Realism* (Story, Grounded, Simulation, Custom), named apart to avoid collisions. |
| D26 | **Default data tables: Modern US.** Payroll withholding and pricing use them (§9.7). |
| D27 | **Decision steps use a Decision connection** (Lumiverse's Decisions API), separate from the chat connection. Helper JSON calls and the narrator stay on the chat connection. In my checks the chat connection was DeepSeek V4 Flash and the Decision connection an OpenRouter connection. |
| D28 | **Reference host.** Visible checks ran against a local Lumiverse staging instance with the extension enabled. |
| D29 | **Configurable time progression.** Time controls, Timelapse, Speed through and Montage, deterministic by default (§9.2). |
| D30 | **Decision model.** The Decisions API needs a model it can run: in testing it rejected a text-only model with a 400, and accepted `~typesafe/jev-latest` (currently `typesafe/jev-1.14-20261014`), which answered in about 230–300 ms. That is the model I used for Decision steps. |
| D31 | **Weak-model floor.** The small model I measured with is far weaker than the models people actually use.<br>- Its measurements are a **floor**, not the design target.<br>- No feature is cut or weakened, and no prompt or schema is dumbed down, because of weak-model results.<br>- Conservative defaults are one tap to change.<br>- Prompts and schemas stay model-agnostic and benefit from stronger models.<br>- Every model step runs on the connection and model the user chose for it. |
| D32 | **Empty narrator reply:** the turn commits `degraded` with a **Retry** chip; the engine never regenerates on its own. A preset lint warns when max tokens are below 1,500 with a reasoning model, and when the active preset holds a JSON-ledger block (§13). Basis: 3 of 34 replies from the measured model came back empty. |
| D33 | **Host chat-head bubbles** cover the drawer's right edge at 390 px; the layout keeps critical values clear of them, and nothing is proposed upstream (§12). |
| D34 | **The engine-fold replay checks** (the Keep report; rebased views, including Discard surviving re-assert and restart; Upgrade and Re-narrate fold order; the rebased-view timing) run in the ledger property suite and in one live run (§17). |
| D35 | **The host's macro re-render of user messages** is accepted only inside that turn's generation window (P4). |

## 3. Shape: few concepts, strict module boundaries

### Engine concepts
Six concepts plus one pipeline.

| Concept | Role |
|---|---|
| **Entity graph** | Kinds: typed fields, derived formulas, bands, `visibility`. Plus typed relations. |
| **Effects → Events** | The only way state changes. Effects are validated proposals. **Events are concrete:** assignment events carry final values (location, status, owner, flags, equipped), and accumulator events carry concrete deltas or postings (money, fuel, odometer, quantities, regard, needs). Balances are derived. |
| **Rules** | `on <event or tick> when <predicate> do <effects>`; `once`/`cooldown`; a cascade cap. Storylet beats are rules with an outline-hint effect. |
| **Actions** | Parameters, requirements, an optional check, effects per outcome, a duration, and optionally the activity they start with its span (§9.2). One check mechanism: a dice expression plus outcome bands, with exact odds. |
| **Tracks** | One state machine for quests, secret ladders, puzzles and NPC agendas. |
| **Schedules** | Calendar recurrence plus slot tables of fixed values or weighted distributions, optionally conditioned on the previous value. They cover shifts, timetables, routines, weather, bills, paydays and price paths. |
| **Pipeline steps** | Engine steps, decision steps, prompted steps (§5.2). |

**Cross-cutting metadata, not concepts:** realism level, which gates processes, rendering and extraction; and visibility.

### Feature mapping

| Feature | Expressed as |
|---|---|
| Schema builder | Kinds (single inheritance); fields of type number, text, bool, enum, ref, list, dice, money, date or duration; `default`, `min`/`max`, `bands`, `derived`, `locked`, bounds (§11), `visibility`. Relation types with cardinality, symmetry and fields. |
| Entities and relationships | Built-in relations: `in` (containment), `owns`, `uses` (a time-bounded **use grant**: "assigned to", loans; a loan ends at the time the player says, "until 7 tonight" or "for 3 hours", else after its days, and ends early when the thing is back with its owner or changes owner), `worn_by`/`equipped`, `knows`, `member_of`, `regard` (multi-axis), `route`. |
| Locations, grids, tracking | Places (hierarchy, per-place time zone), routes with travel modes, optional grids (terrain, blocked cells, zones), positions; A* with caps. |
| Inventories and ownership | Gear pack (§9.3). |
| Character sheets | Fields, derived formulas, bands as words, layouts; the check mechanism. |
| Deterministic actions | Built-in move, go-to, drive, take, drop, give, lend, wear, use, buy, pay, transfer, refuel, service, wait/rest, sleep, **let time pass / timelapse** (a duration or *until*; §9.2), examine; plus author actions. |
| Weather | A climate schedule per region. |
| NPC simulation | §8 plus the Cast life and Relationships packs. |
| Quests, gating, puzzles, secrets, triggers | Tracks plus rules (§10). |
| Context control | The engine's sections (§6); World Info lore handling is off for now. |
| Decision and regular model calls | Decision steps and prompted steps; prompted steps can propose effects. |
| Outline steps | Deterministic `beats`, plus any number of prompted outline steps. |
| Granular realism | §9. |
| Time progression (D29) | Time controls (ticks per scene type, time scale, clock pause) recorded as `time` markers; Timelapse with an interrupt policy and unit cap; Speed through; the Montage slot (§9.2). |

### Modules
- **Registries:** systems and packs register event types, effect handlers, services, query functions, renderers, actions, panels, editors, data tables and materializers.
- **Pack split:** each pack is a **pure `core`** (engine, services, data) plus a **`ui`**. A boundary lint enforces no cross-pack internals and no core edits. The studio API may import only pure modules.
- **Layout:**
  - `src/engine/`: the pure engine;
  - `src/packs/<pack>/{core,ui}/`: eleven packs (the engine's own plus calendar, space, gear, vehicles, economy, weather, relationships, castlife, sheets and story);
  - `src/backend/`: the host adapter (the only `spindle` importer), ledger storage, runs, pipeline, deciders, hooks, worlds, builder, push, child bridge;
  - `src/worker/`: the child lane entry, engine only;
  - `src/frontend/`: Preact;
  - `src/shared/`: types and contracts both sides use;
  - `src/studio-api.ts`: the studio seam (§15).
- `lumiverse-spindle-types` is pinned to `0.6.49`, the host's version (0.6.50 adds only `ctx.client`). One local augmentation module covers what the published types get wrong or omit: `ctx.ui.registerDomDecorator({mount, render, …}) → () => void` (the published top-level `registerDomDecorator` does not exist, and `instanceKey` filters anchors, so decorators omit it), `geometry.createResizeController(el, opts) → () => void`, and float and dock `persistGeometry`.
- The backend registers exactly **one** World Info interceptor and **one** context handler; a second registration replaces the first.
- **`userId`:** event payloads carry none. The host passes it as the handler's second argument, and the context-handler and interceptor contexts carry it. Operator-scoped (locally imported) installs must pass it on every host call. Every per-user cache is keyed by it.
- **Permissions.** The extension requests eight: `generation` (follow each reply, run the interceptor, make helper calls), `context_handler` (plan each turn before the reply), `chats` (read messages and swipes), `chat_mutation` (save the world's record, add palette, chip and map actions as messages), `world_books` (create the world's lore book and its slot entries, attach it, and read the books chosen for Import from lore), `presets` (read the active preset to check where sections land and to lint it), `decisions` (the Decisions API) and `ui_panels` (drawer tab, pill and map). It deliberately does **not** request `characters`: character cards stay out of its reach (§4.2).
- **Safe keys.** Entity, place, track, kind and field ids, marker keys, editor keys and table keys are validated. Every lookup by a data id resolves own keys only, so `__proto__`, `constructor` and `toString` name nothing.

## 4. Data and persistence

### 4.1 World document and storage (D2)
- **Format:** a world is one JSON document, **`lre-world-v1`**, with a published JSON Schema and per-pack format versions.
- **Contents:** schema, entities, places, routes, grids, rules, actions, checks, calendar, schedules, tracks, lore, enabled packs and their data tables, **pinned generator and data-table versions** (§9.2), realism defaults, the currency (code, symbol, minor unit, decimals, display format; Modern US by default), section templates, world-authored step templates, suppressed sources.
- **Storage:**
  - `userStorage/worlds/<worldId>/index.json`: name, head, lore book id.
  - `rev/<sha256>.json`: immutable revisions, named by their content hash.
  - Writes are atomic (temp file, then `storage.move`). Pinned revisions are never garbage-collected automatically.
  - Edits in Build go to a **draft**; **Commit** makes a new revision and **Discard** throws the draft away.
  - Revisions are cached per user, world and revision (an LRU of 128, never replaced in place). A read or export needs a revision the world's index lists. An open chat pins only the revisions its ledger references (its run's, the targets of its migrate markers on the chain or in held writes, and the revisions its records were planned under), loading each before a fold can need it, so evicting a cache entry never breaks a fold and a world's long commit history stays out of memory.
- **User-owned settings** (`userStorage/settings.json`): model-use preset, per-step provider, connection and model, budgets, realism and time controls (§9.1, §9.2). Realism and time **seed new chats only**, filling in what the world's own defaults leave out (or replacing them, with "Use my settings instead of a world's defaults for new chats" on); a running chat changes through markers. Imports never change them. A settings file is conformed field by field to its schema when read (types, enums, ranges; open maps keep safe keys only; a bad value falls back to its default).

### 4.2 Engine-managed lore book (D11)
- **Created per world:** "LumiRPEngine · <World>".
- **Slot entries** (Outcome, Montage, Scene, People, Money, Gear, Vehicles, Quest, Outline…):
  - stored `disabled:true, key:[]`;
  - default positions set at creation; users may move them, including to outlets (`{{outlet::lre_scene}}`);
  - **deliverability** of marker and outlet positions is computed outside the hook from the world-book and preset APIs and cached. If it cannot be resolved, the entry keeps native placement and is labelled "unverified". Outlets inside character-card fields cannot be resolved without the `characters` permission, which the manifest does not request, so those entries are "unverified" (§21). The inspector confirms delivery by a dry-run prompt assembly and a search of its result. Outcome, Montage and Outline hold only what a real turn planned, and a dry run plans nothing, so the check leaves them "unchecked" instead of reading them as not delivered.
- **World lore** (`WorldDoc.lore`: title, content, keys, links, group, priority, and an optional secret flag with a gate) is authored data, kept in the world document. It is not synced into the book and not delivered to the narrator for now; lint still rejects lore that contains a secret's truth. Lore entries an earlier build synced into the book are deleted (§6.4).
- **User entries** are never linked, adopted, voted on or edited. Linking and adopting were planned and are retired with lore handling; `WorldDoc.suppressed` stays in the format and is not read.
- **Secret truth** lives only in the world document and reaches a slot through `mutated.content` at reveal. Secret-gated entries hold cue text.
- **Attachment:** the book is appended to the chat's `chat_world_book_ids` (read-merge through `runtimeState.write`).

### 4.3 Run (per chat; D6)
- **Chat metadata:** `lumi_rp_engine = {v, worldId, runSeed, startedAt}`.
- **Ledger** in `spindle_metadata.lumi_rp_engine` on assistant messages: `{v, swipes:{[index]:Rec}, markers:[…]}`.
- **Ledger principles.** Four rules govern this section and §5; everything below applies them.
  - **P1. Path tags.** Every `post` entry and every marker records `at`, the parent path it was made under (the path hash, below, of everything before its message). An entry is **live** when `at` equals the current parent path, or when `at` equals its record's `path` (it was made with its record on-path, so it travels with the record into the record's rebased views). Only live entries fold and count toward the record and path hashes. Any other entry is **inert**: it changes nothing, and the Keep report lists it as "made on another branch". New `post` entries and markers go only to the head assistant message; that includes markers made during a regenerate of an earlier message, whose `at` therefore chains the new swipe. Switching back is therefore exact: whatever was made on the other branch is inert on this one. `keep[parentPath]` follows the same rule. Starting markers are the one untagged kind, since no branch made them (below).
  - **P2. One in-flight window per turn.** A turn is in flight from `GENERATION_STARTED` until its record commits, or until it closes as `degraded`, `stopped` or with its text accepted unread (§5.1 steps 5–6; Impersonate and Dry Run close at their end, with no record). Writes the user causes inside a window (materialization, ✎ fixes, chip confirms, markers, Keep, Discard, conversions and Re-read) are held in the journal and the UI shows "pending". Each is journaled, taking its `seq` and `at`, once every window that was open when it was made has closed. A turn's post-step events are validated against exactly its **fold prefix**: the parent fold, the message's live markers with `seq ≤ markersApplied`, `pre`, then the earlier post-step events. Nothing made after the turn started can enter that prefix, so re-folding equals what was validated.
  - **P3. Re-narrate.** A Re-narrate swipe copies the source's seed, `pre` events and `markersApplied`, plus the source's live ✎ fixes and materializations from `post`, keeping their `seq`s and taking the new swipe's parent path as `at`. Each copied entry is re-validated against the new swipe's own fold prefix (parent, live markers ≤ `markersApplied`, `pre`, then the copied entries and the message's later live markers by `seq`). An entry that depends on the source's post-step results (an entity they spawned, an event they recorded) fails and is dropped with a Journal note. The new narration renders from that same prefix, and its post-step events are stored as one `post` entry of kind `narr`, which takes its `seq` at commit, like `cont`, and the record's `path` as `at`, so it travels with the record like `events`. The source's confirmed chips and `cont` entries belong to its prose and are not copied. When the source cannot be reproduced (no planned source record, a pause, or a copied `pre` event that no longer validates), Re-narrate falls back to a Re-run, because P3 cannot hold without the source's prefix. A copy keeps its source's `seq`, so L9 reads "a `seq` never names two different entries".
  - **P4. The turn's own user messages.** The `pending` entry pins the hash of each user message the turn answers. The only change accepted to them is the host's macro re-render: a `MESSAGE_EDITED` for one of them that arrives after this generation's reply is saved and before its `GENERATION_ENDED` (normal generations only). The reply's save is its `MESSAGE_SENT` when the host creates it at the end, or its `MESSAGE_EDITED` when the host staged it empty before `GENERATION_STARTED`, which is what I observed on the reference host. I did not observe the re-render itself there, though the code path exists; the fake host generates it in both variants (§14), and a live run re-checks it. The commit's `path` uses that re-rendered hash, or the pinned hash otherwise. Any other change to them is a content edit (below).
- **`Rec`** = `{v, defHash, seq, swipeHash, path, seed, pre, events[], post[], markersApplied, keep{}, status, undone[], intents{}, accepted, diag}`:
  - **`seq`:** taken from the chat-wide counter (shared with `post` entries and markers) when the record is made. A tombstone matches the stored record, `seq` included, so a new record identical to a discarded one is never taken for it.
  - **`swipeHash`:** hash and length of the swipe content the engine last read (simulated, or re-read).
  - **`path`:** the parent path the turn was planned on (path hash below). When it differs from the current parent path, the record folds as a **rebased view** (below). A **bare record** (no turn: it holds only an `accepted` identity or player entries on a message the engine did not simulate) has `path` `""`: it folds as a plain message, and its entries are live only where they were made, never travelling with it.
  - **`events`:** the turn's events, in order. The first **`pre`** of them were planned before the reply (resolution, simulation, timelapse, in-turn materialization); the rest come from the post steps (extraction with any `time.advance` and its catch-up, off-screen agents, tracks and rules). Materialization that happens during the turn is recorded **ahead of** the action's effects. A Re-narrate swipe holds only its copied `pre` here (P3). An event may carry a `group`: contiguous events with the same group are one unit (a purchase and its payment), which plans and reads keep or skip whole.
  - **`post`:** additions to this swipe after its turn, on the head record: player-facing materialization, ✎ fixes, confirmed chips, **Continue segments (kind `cont`, §5.1 step 5)** and a Re-narrate's post-step events (kind `narr`, P3). Each carries `at` (P1) and a chat-wide sequence number (`seq`), taken when it is journaled (P2); `cont` and `narr` entries take theirs when they commit.
  - **`markersApplied`:** the highest marker `seq` that was applied when this swipe was planned.
  - **`keep`:** the user's Keep-report conversions, keyed by the parent path they apply to (`{[parentPath]: {convert:[event refs]}}`). Absent unless the user converts an event.
  - **`accepted`:** `{len, hash}` of swipe content accepted without being read: an assistant edit (below), or a Continue that was not read (non-head, on a message without a record, stopped, or with a re-rendered prefix; §5.1 steps 5–6). Verification accepts content that matches `swipeHash` or `accepted`. Neither `swipeHash` nor the record hash covers it, so accepting text never moves a path. While it is set, the message offers **Re-read edit**.
  - `status`: `ok | degraded | stopped`. `conflict` is derived from a journal pause entry (below) and never written to records.
  - `intents`: the interpretation cache, keyed by `hash(user-message content, interpret config)`.
  - `diag`: a key into the `userStorage` diagnostics.
- **Markers** are message-level, **pure intents with no values**, each with `at` (P1) and a chat-wide sequence number (`seq`, shared with `post` entries). They attach to the head assistant message:
  - `migrate{to}`: world Upgrade;
  - `resolve{domain, scope, to}`: realism change;
  - `time{control, scope, to}`: time-control change (tick per scene type, time scale, clock pause, interrupt policy, Speed through, Montage granularity, unit cap, Custom NPC calls; §9.2, D29).

  A swipe planned after a marker is planned with it already applied; a Re-narrate is not planned and copies its source's `markersApplied` (P3). State-dependent output (such as detail for an entity that newly needs it) comes only from lazy materialization (§9.2), never from the marker itself.

  **Starting markers.** The first record that holds events carries the chat's starting state as markers: `migrate{to}` naming the world revision (and so its pins, §9.2), `resolve` for every domain's level and the band caps (§9.1) and `time` for every time control (§9.2). They come from the world's own realism and time defaults, with the user's settings filling in what the world leaves out, or from the user's settings with "Use my settings" on; any Play changes made before that commit seed only these markers too, and later settings changes never reach a running chat. They are written once per chat, carry no `at` and are live on every path, so a switch, a Discard or a deletion never removes or re-seeds them. A Continue before that commit is accepted unread (§5.1 step 5).
- **Fold order per message** (its active swipe; live entries only, P1):
  1. this message's markers with `seq ≤ Rec.markersApplied`;
  2. `Rec.events`;
  3. `post` entries (including `cont` and `narr`) and this message's later markers, interleaved by `seq`.

  A message without a record, or with a bare one (§5.1 step 5), folds only its markers and a bare record's live `post` entries, by `seq`. Earlier messages fold completely before later ones. A Continue always follows its reply, so a chip confirm, ✎ fix, materialization or marker journaled before it started was already in effect when its suffix was generated; its `seq`, taken at commit, folds it after them. Writes made while it streamed are held by its window (P2) and fold after it.
- **Path hash:** chained over each earlier message's content hash (for an assistant message, its record's `swipeHash`, so `accepted` is excluded), record hash (`events`, `markersApplied` and the live `post` entries with their `seq`s, including `cont` and `narr`, plus the record's `keep` entry for the current parent path; not `accepted`) **and its live markers' hashes with `seq`**. No ids, `index_in_chat` or `defHash`. A rebased view therefore chains as itself, and a new turn on a rebased path is planned on, and chains through, the view. A record's `path` is computed at commit over the chain its turn was planned on, with the turn's user messages hashed per P4.
- **Seeds:**
  - **Action seed:** a **Re-run** draws a fresh random seed, recorded in `Rec`. A **Re-narrate** copies the source's seed (P3). Worlds in *same-roll* mode use `hash(runSeed, parent path, action)`.
  - **Interpretation** is cached per user text, so a Re-run re-samples the same probabilities with the new seed.
  - **Process seed:** `hash(runSeed, process, entity, slotIndex)`.
  - **Materialization seed:** `hash(runSeed, entity, domain)`.
- **Durability:**
  - records **and markers** are appended to the shadow journal, re-verified against the chain snapshot (below), and re-asserted through the queue. A re-assert writes a record's latest journal state, never a rebased view, and honors tombstones;
  - the journal also holds the per-chat `seq` counter, the chain snapshot, pause entries, tombstones and the writes held by open windows (P2);
  - the journal is stamped with its chat run (world id and run seed); one that belongs to another run is replaced by a fresh one. A damaged journal (unreadable, or the wrong shape down to a single entry: a pending turn, held write, pause, tombstone, chain entry, message or window; a message's ledger counts down to a record with a missing or wrong-typed field (undone and its refs, swipeHash, seq, path, keep, a post entry or an event), a marker that fails the marker check, or a swipe key that isn't a swipe index) does not make the chat unopenable: it is moved aside as `<file>.corrupt-<epoch ms>` (the next free millisecond if that name is taken, so a later set-aside never overwrites an earlier one), a warning is logged, the context inspector's warnings tell the player where the damaged file is kept, and a fresh journal opens; the records saved on messages still fold, and only what the journal alone held (edits, pauses, discards) may be gone. The settings, extraction-learning, chip and plan files are treated the same way (a damaged settings file means the defaults are used), and a chip entry with a wrong-typed field is dropped rather than shown. The extraction-learning file keeps only well-formed connection and type entries, so a wrong-typed one cannot break counting. A damaged snapshot file is ignored, since snapshots are only a shortcut. The journal is written only when it changed;
  - a record on a message that has the wrong shape (an imported or forked chat, another writer) is skipped: the message folds as if it had none, a warning is logged, and the context inspector's warnings name the message and swipe; if the journal still holds the record, it is written back;
  - on `MESSAGE_DELETED` of a message that carries markers, its live markers move from the journal onto the **nearest surviving assistant message before it**, keeping their `seq` and taking that message's current parent path as `at` (starting markers stay untagged); its inert markers are dropped with it. The move is journaled. That is the new latest message when the latest was deleted. If none exists, they go onto the earliest surviving assistant message; their `seq`s are below its `markersApplied`, so they fold ahead of its events.
- **Writes:** one queue per message, doing read-merge-write. Metadata is compared and written as it reads back, so a part the reader drops never looks clobbered; a re-assert that doesn't stick is tried at most 3 times in a row for the same ledger (a new ledger state, or a re-assert that sticks, starts the count again), so no other writer can keep the write and its edit event going round.
- **Coexistence warning:** the host replaces the whole `spindle_metadata` bag. Another writer can drop our data, and we can drop theirs. **G2 is required** for safe coexistence (§16).
- **Fold:** follows the order above, with the shadow overlay for every journaled entry not yet flushed (commits, `post` entries, markers). The cache is keyed by the path hash. A fold also uses **persisted fold snapshots**: `runs/<chat>/snapshots.json` holds the 6 newest folded states, one every 200 records, each keyed by the build id, the start revision and the chain's path hash, and none spans a pause. A cold fold starts from the furthest one on its chain. The prefix walk memoizes digests of message text, stored records and markers.
- **Swipe identity:** records keyed by index and verified by `swipeHash` or `accepted`. The engine shifts them on `MESSAGE_SWIPED` `deleted` (its `swipeId`): the host shifts `swipes` but not `spindle_metadata`. Realigned or orphaned with a chip.
- **Swipe switches, edits and Keep:**
  - **Chain snapshot.** The journal keeps the last-seen chain (message id, active swipe index, content length and hash). Every `MESSAGE_*` event, chat open and restart diff the chain against it, so classification never depends on event names (`MESSAGE_SWIPED` also reports `added` and `updated`). For an earlier message:
    - an **active-swipe change** (navigate, add, or delete of the active swipe; routine) or the **removal of a message** makes later records **rebased views**, with no pause (D4). The newly active swipe is verified on every switch: if it has a record and its content matches neither `swipeHash` nor `accepted` (for example after a swipe `PUT` made while it was inactive), the new content is accepted as an assistant edit (below);
    - a **content change** at the same swipe index (`MESSAGE_EDITED`, or a swipe `PUT`, which emits only `MESSAGE_SWIPED` `updated`) is a **content edit** on a user message and an **assistant edit** on an assistant message. Two host writes are neither: the macro re-render of the turn's own user messages (P4), and a Continue's own save, which is settled at the Continue's end (§5.1 steps 5–6);
    - metadata-only writes change nothing.
  - **Assistant edits keep the world.** Editing an assistant reply (a typo, a name, a trimmed line) is routine. An assistant edit, on the head or an earlier message, keeps the message's record and events and accepts the new content as the record's `accepted` identity; a message without a record gets a bare record holding `swipeHash` (its content before the edit, from the chain snapshot) and `accepted`. Nothing pauses, no path moves and the fold is unchanged (L38).
    - A one-tap **Re-read edit** chip re-extracts the message's post-step events from the new text with the `extract` step: they replace the events after `pre`, `swipeHash` takes the new content and `accepted` is cleared. Keeping is the default. A Re-read replaces the whole earlier read: its Continue suffix reads (the new text holds them), the proposals confirmed from its chips and its stored chips go; fixes and materialized detail stay. A change already confirmed from the old read's chip is undone with it, and the new read offers it again, once, if the new text still narrates it, so confirming the new chip charges once. The new read's chips offer whatever the new text still narrates.
    - Re-read is a user write (held in a window, P2). On an earlier message it changes the record hash, so later records become rebased views through the machinery below.
    - A read writes path-bound events, so Re-read edit and Retry read run only where the record folds as stored: on its own path, or on a bare record, which the read anchors at the current parent path (it becomes that message's turn record). While the record is a rebased view, the chip asks to switch back first. A read the ledger would refuse (the chat is paused, the record is a rebased view, or a Retry read is not on the head) is refused before its model call and leaves the chips alone.
    - A read runs once: it holds the per-(user, chat) chip lock and re-checks inside it that the read is still due, so a double tap reads once (one extraction, one confirm chip, one change).
  - **Rebased view.** A record whose `path` differs from the current parent path folds as a computed, deterministic view. Its events and live `post` entries are **re-validated** against the current parent fold with the Keep report's defaults: an entry that fails (an item never bought; a decline made under another balance) is dropped, with a derived Journal note, unless `keep` converts it for this parent path. Accumulator deltas re-apply naturally. A group of events is kept or dropped whole, and a conversion of any member converts the whole group. Packs may add `guard`s to any event type, including the core `post` event, composed after the type's own check; the economy pack guards funds and limits from Money level 2, so a rebased cash payment cannot fold below zero.
    - **Nothing is written to later records.** New `post` entries and markers go only to the head, tagged with the parent path they were made under (P1), so whatever is made while the head is a view is inert on every other path, and switching back restores the original exactly, at any time.
    - A non-blocking **Keep-report chip** lists the dropped entries. A dropped group (a purchase and its linked changes) is one row with one Convert: its payment's line leads, with "(N linked changes)", and two groups that read the same stay two rows; lines outside a group still merge when identical. In the Journal a dropped group is likewise one note, at its first member's place, led by the same line as its Keep row, with "(N linked changes)" when it has more than one member. Each row has **convert to manual adjustment**, there is a one-tap **Discard**, and the inert entries appear as "made on another branch". A conversion is the only stored choice: a small `keep[parentPath]` overlay on the affected record.
    - The change chip and the Journal list what the fold applied: an event that was undone (Not an action?, an Undo) or dropped on a rebased view no longer reads as made, a Keep conversion still does, a `post` entry made on another branch does not, and a paused record lists nothing.
    - A new turn on a rebased path chains through the view. After switching back, that turn's record is itself a rebased view.
    - **Re-convergence:** once the folded state after a view equals the original folded state after that record (cached by path hash), later records fold as stored, without re-validation.
  - **A content edit** (an edit to an earlier user message, whose action text changed) puts later records into a derived `conflict` state (one journal pause entry, not a write per record) and pauses on Keep/Discard (L39). **Keep** clears the pause; the later records then fold as rebased views over the edited chain, with the same chip. Nothing after an unresolved pause folds, so a turn sent while paused gets no plan and commits `degraded` with no events; a pause that arrives while a reply streams leaves that reply unread (`degraded`, its plan kept).
  - **Discard** drops the later records: they leave the journal and are **tombstoned** by message id, `swipeHash` and the hash of the stored record, so re-assert and restart recovery never restore them, even after swipe indexes shift; their messages become plain (no record).
  - **During a generation,** an earlier swipe change or user-message edit, including one to the turn's own user messages (P4), leaves the new record off-path at commit (§5.1 step 5). An assistant edit moves no path, so it does not.
  - **Size:** per record, `seq` and `pre` (one integer each) and `keep` (absent unless the user converts); `at` (one path hash) on every `post` entry and marker; `accepted` is one `{len, hash}`. Per chat, the journal holds the `seq` counter, the chain snapshot, pause entries, tombstones and held writes. Switches and user-message edits write nothing per record; an assistant edit writes its record's `accepted` (or a bare record).
- **Record size:**
  - compact encoding; per-turn targets of about 2 KB (Grounded) and 6 KB (Simulation); hard cap 32 KB;
  - **overflow** first coarsens into period-close events, then writes continuation chunks in the same namespace; **never truncate**;
  - materialization is capped per write;
  - **timelapse and catch-up** record derivable events as per-period aggregates and period closes, never raw. They stay concrete deltas, so the fold is unchanged (L21, L29). A dense synthetic 600-agent-day segment produced 57k events in the spike: 2.0 MB raw and 155 KB even after coarsening. Time was never the binding limit (38 ms per segment on a child process); the record size and the 5,000-event unit cap (§9.2) are.

## 5. Turn pipeline

### 5.1 Hooks and lifecycle

1. **`GENERATION_STARTED`.**
   - Note `{generationId → chatId, targetMessageId?, targetSwipeId, generationType}`. `targetSwipeId` is present for every type; for Continue, `targetMessageId` is null (G1).
   - Increment the chat's **generation counter**.
   - Clear the applied-plan slot.
   - Open the turn's in-flight window (P2, §4.3).

2. **Context handler.** Non-required; registered timeout = the user's pre-reply budget (≤120 s); internal deadline below it.
   - **Fingerprint:** a hash of the chat id and every non-empty message as `id:contentHash`. The context handler reads the chat, skipping the staged empty reply; the interceptor reads `ctx.messages`. The two matched in every generation type I tried, including Edit-and-Send in branch mode (in the branch chat).
   - **Not a world chat:** return.
   - **Impersonate:** return.
   - **Continue:** the target is unknown before the reply (G1): for Continue, `GENERATION_STARTED` carries no `targetMessageId`. Capture the **head** swipe's content (length and hash), then re-render the head's current fold (its committed record, live `post` entries and markers; render only: no resolve, simulate or model calls), stored under the Continue fingerprint. The target is checked at `GENERATION_ENDED` (step 5).
   - **Dry Run:** plan from the last committed decisions. No calls, no writes; previews are labelled. The interceptor cannot tell a dry run (G1), so the plan a dry-run context handler stores is marked dry, and when the newest plan for a fingerprint is dry, the interceptor writes no slot.
   - **Re-narrate:** render the new swipe's fold prefix (P3, §4.3), stored under the target fingerprint. No resolve, simulate or model calls; its post steps run at `GENERATION_ENDED` (step 5) and commit as a `narr` entry.
   - **Single writer:** wait for the previous post-pass up to its bound. On expiry, abort it and run its extraction inline, or close it as `degraded`. Its commit goes to the shadow first; the fold reads the overlay. Either way its window closes, and the writes only it held are journaled before this turn folds (P2).
   - **Otherwise:**
     1. Fold to the parent, with the target message's live markers applied. The target can be any assistant message: an explicit `message_id` on regenerate or swipe names an earlier one. That swipe is a turn on that message, and later records become rebased views (§4.3).
     2. **Deterministic plan:**
        - the **elapsed time** for the turn: a timelapse segment or the action's duration, otherwise the scene's default tick × the time scale; zero while the clock is paused (§9.2);
        - resolve;
        - simulate, **in process** (D9): calendar processes, the day planner, LOD0, catch-up, bounded by deterministic units (days, agents, events), with any remainder left on a deterministic **backlog** (a timelapse runs whole inside its unit cap instead);
        - render beats and slots.
     3. Check `signal.aborted`. Store the plan under the target fingerprint, stamped when the handler returns, and append a shadow `pending` entry holding the chain the plan was folded on and the pinned hashes of the turn's user messages (P4). A plan expires at its generation's `GENERATION_ENDED` or `GENERATION_STOPPED`, so a later `spindle.assemble` or dry run never matches a stale plan. Plans are kept per seed, so a Re-run's plan never replaces another swipe's.
     4. Model steps by priority, refining the stored plan:
        - `interpret`, when the typed-input classifier fires, then re-resolve. If the action, its duration or its activity changed, recompute the elapsed time and re-simulate (including a Speed-through `auto` timelapse) within the remaining deadline. If that cannot finish, the turn is handled as a simulation timeout (below), and an interpreted timelapse or Speed through becomes its offer chip;
        - `npc.choose` in the tie zone or on an invitation;
        - prose outline steps.
        - At the deadline, the remaining steps use their deterministic fallback (§5.3).
     5. No message writes.
   - **Simulation timeout or failure:** use the head render, record `degraded` with zero simulation events, and leave the interval on the backlog. A timelapse segment is not applied at all (§9.2).

3. **World Info interceptor.** Registered at a **late priority**; it makes no model call (the host fixes 10 s).
   - **Not a world chat:** return `void`.
   - Capture the chat's generation counter.
   - Match a plan by fingerprint, else use the head render. The head render carries persistent sections only, never Outcome or Outline.
   - Fill the slots within the section budget (§6.2, §6.3) and vote on the world's own book (§6.4). Entries of other books are left to native World Info.
   - The applied-plan slot is written **only if the counter still matches**.

4. **Narrator generation.**

5. **`GENERATION_ENDED`** (whenever content was saved).
   - **The saved reply** is `GENERATION_ENDED.content`, which equals `message.swipes[targetSwipeId]`. A normal turn saves with `MESSAGE_EDITED` (or `MESSAGE_SENT`, P4). Regenerate, swipe and both Edit-and-Send modes save with `MESSAGE_SWIPED` `updated`, whose `message.content` follows the *displayed* swipe when the user navigated mid-stream.
   - **An empty reply** (content `""` with no error; the measured model sometimes returned only reasoning) runs no post steps and commits the pre-reply events as `degraded`, with a **Retry** chip; the engine never regenerates on its own (D32).
   - **Post steps:**
     - extraction, including a bounded `time.advance` for narrated time beyond what this swipe has already applied, with that advance's catch-up, all or nothing (§9.2);
     - off-screen agents, in process (D9);
     - tracks and rules.
   - Validate with the bounds (§11), against the turn's fold prefix (P2, §4.3).
   - **Commit:** compute `path` over the chain stored with the `pending` entry plus the turn's user messages hashed per P4; compute `swipeHash` and `intents`; write the record through the queue; clear the shadow `pending` entry; close the window (P2). The host keeps swipe navigation enabled during a generation. If an earlier message changed meanwhile, the new record is off-path: a swipe change makes it a rebased view (re-validated, with a Keep-report chip), and a user-message edit, including one to the turn's own user messages (P4), puts it under the pause; an assistant edit leaves it on-path (§4.3).
   - **Continue** (head target): `GENERATION_ENDED.content` holds the whole swipe, re-rendered. A head without a record (a greeting before the first turn) is accepted unread, like a non-head target. Otherwise extraction reads **only the suffix after the captured content**, and only if the content still starts with it. The host re-renders the whole combined swipe, and literal-brace shielding is keyed by the full content's hash, so a prefix with literal braces can change; then the Continue is accepted unread, as for a non-head target. The suffix is validated against the head's fold, and its events become a **`post` entry of kind `cont`** whose `seq` is assigned when the Continue commits. Everything journaled before the Continue started therefore folds before it, as it was in effect when the suffix was generated; writes made while it streamed are held by its window and fold after it (P2). `swipeHash` is updated; the head's own `path` chains only earlier messages and is unchanged. Effects already in the record are never re-read.
   - **Non-head guard.** `GENERATION_ENDED.messageId` names the continued message, and an explicit `message_id` can name any assistant message. If it is not the head assistant message, extraction is skipped and **no events are appended to any record**, since a non-head append would change every later path hash. This is an assistant edit (§4.3): the new content becomes the record's `accepted` identity (a bare record for a message without one), later paths are unchanged, and the message offers Re-read edit. Re-verification of a message edited during a Continue waits for its `GENERATION_ENDED` or `GENERATION_STOPPED` (step 6), because the save emits `MESSAGE_EDITED` first.
   - **`ok` only if the applied-plan slot held this plan.** Otherwise the turn is `degraded`, and auto-apply is suppressed for this turn's action targets.
   - Unresolved confirm chips from the previous reply expire at this send, with a Journal note.
   - **Swipe index:** from the `GENERATION_STARTED` note, for every type. Both Edit-and-Send modes stage a blank swipe; in branch mode it is in the branch chat, where every event of the turn lands.

6. **`GENERATION_STOPPED`.**
   - Increment the generation counter and clear the slot. The host lets a stopped generation's interceptor run to completion, so only the counter stops its slot write (L35).
   - If content was saved (other than by a Continue), commit the pre-reply events as `stopped` (Retry read / Discard); otherwise drop the plan. Either way the window closes (P2).
   - **Retry read of a stopped reply.** The reply was saved unread, so a Retry read reads everything saved by then, a Continue after it included, and replaces what was read meanwhile (that Continue's suffix read, the proposals confirmed from its chips, and that read's chips). It then marks the reply read, so no change or charge lands twice and no Retry read is left; a Re-read edit of a stopped reply marks it read too.
   - **A stopped Continue.** The host saves `original + postfix + partial` onto the continued swipe without a macro re-render, then emits `GENERATION_STOPPED` with only the partial suffix and no `messageId`. Any message may also be edited meanwhile, and `updateMessage` emits `MESSAGE_EDITED` for every write, metadata-only ones included. The target is therefore found by content: among the messages whose `MESSAGE_EDITED` arrived during the Continue, the one whose swipe `targetSwipeId` (from `GENERATION_STARTED`) now ends with the partial suffix; if several do, the one whose content before the Continue (`swipeHash`, `accepted` or the chain snapshot) is a prefix of it. Every other edit made during the Continue is classified normally (§4.3). The new content becomes the target's `accepted` identity (a bare record if it has none), as for any assistant edit. On a head whose record holds events the chip is **Retry read**, which extracts only the partial suffix into a `cont` entry that takes its `seq` then; `swipeHash` then covers the text and `accepted` is cleared. Elsewhere it is Re-read edit.

7. **Restart recovery.** Assistant messages without a record are restored from the shadow `pending` entry as `degraded`, or flagged with **Read this turn**; that closes any window left open, and its held writes are then journaled (P2). A `pending` entry whose staged reply is gone (the host removes it at restart) is dropped: no record is made, its window closes and its held writes are journaled. Tombstoned (discarded) records are never restored; tombstones match by message id, `swipeHash` and stored-record hash (§4.3).

8. **Swipe options.**
   - **Re-run** (the default): a fresh seed, with cached probabilities re-sampled.
   - **Re-narrate:** P3 (§4.3): the same seed, `pre` events and `markersApplied`, the source's ✎ fixes and materializations re-validated against the new swipe's fold prefix, narration rendered from that prefix, and new post steps committed as a `narr` entry.

9. **Activation check** on `WORLD_INFO_ACTIVATED`. It consumes the slot, writes its result into the shadow `pending` entry, and confirms activation, not delivery.

10. **Queued writes.** UI edits, between-turn materialization (`post`), confirmations, markers, Keep and Discard are journaled at once outside a window and held inside one (P2); each takes its `seq` and `at` when it is journaled. Journaled writes, late commits and re-asserts are flushed per message through its queue once no generation is in flight.

### 5.2 Steps
- **Phases:**
  - `pre`: context handler.
  - `post`: `GENERATION_ENDED`.
- **Engine steps:** `time`, resolve, simulate, `plan.day`, `beats`.
- **Typed-input classifier** (deterministic, no model). It fires when the typed text matches the world's action lexicon (risky verbs, transfer and travel verbs), names a known entity as a target, or carries a structural cue (quantities, money, destinations).
- **Decision steps** (routing per D10: `interpret` on the helper; `npc.choose` on the Decision connection; on a decision error, the helper, then engine-only; no blind retry):
  - Built-in purposes: `interpret`, `npc.choose`, `contradiction`, and **`puzzle.answer`** (an authored opt-in per puzzle).
  - The first option is the safe default.
  - Answers are probabilities, sampled with a seeded RNG. A helper yes/no without a probability is no answer.
  - On the Decision route, `interpret` asks a choice question over the available actions (and "none"); when the chosen action takes parameters, a helper call fills them (a second call, budget permitting), because the Decisions API answers questions, not parameters.
- **Prompted steps:**
  - World step templates use the engine placeholders only: `{{world}}`, `{{pov}}`, `{{place}}`, `{{clock}}`, `{{scene}}`, `{{facts}}`, `{{present}}`, `{{outcome}}`, `{{beats}}`, `{{brief}}`, `{{user}}`, `{{reply}}`, `{{recent}}`. Host macros in a template are not evaluated, because helper calls are quiet generations that skip prompt assembly; the import lint lists any macro a template carries. Every placeholder is player-visible content.
  - Output `text` or `effects` (bounded like extraction; money amounts in an `effects` output are plain amounts in the world's currency as written, 8 for $8, and the engine converts them to minor units as it does for extraction). Built-in purposes: `brief`, `outline`, `extract`, `choices`.
- **Where each output goes:** `brief` leads the Outline slot as "Brief: …"; a prose `outline` adds Outline lines after the engine's beats; `contradiction` becomes a chip (Re-narrate / It's fine) plus a correction line in the next Outcome slot; `choices` become chips that send the suggestion as the player's message; `effects` templates produce proposals that go through the extraction modes and bounds, after the reply only. The narrator sees prose steps through the slots it already reads, and corrections and suggestions stay under the player's control.
- **Outline:** `beats` always renders the deterministic outline; prompted outline steps stack on top.
- **Signals:** `typed_input`, `classifier`, `reply`, `scene_change`, `slot_crossed`, `day_start`, `beat`, `agents_present`, `present`, `offscreen`, `tie_zone`, `invitation`, `timelapse`, `conflict`, `every_n:<k>`, `always`, `never`. A world step template for the retired `select` purpose is dropped when its world loads.
- **Secrecy batching rule:** questions that carry secrets never share a call with prose-producing steps.

### 5.3 Model-use presets and budgets (D3, D13, D25)

| Preset | Pre-reply (context handler) | Post-reply | Model steps a turn: most | Engine budget (sections) |
|---|---|---|---|---|
| **Lean** (floor) | `interpret` when the classifier fires | `extract` | narrator + up to 2 | 300 tokens |
| **Standard** (default) | `interpret` when the classifier fires; `npc.choose` on `tie_zone`/`invitation` | `extract`; off-screen `npc.choose` on `tie_zone` | narrator + up to 4 | 600 tokens |
| **Full** | `interpret`, `brief`, `npc.choose` for all present agents, prose `outline` | `extract`, off-screen `npc.choose`, `contradiction` | narrator + up to 8 | 1000 tokens |
| **Custom** | Any step, signal, provider or model | Same | Depends on the steps enabled; the call meter shows it | User budgets |

**Measured calls per turn** (the test suite's busiest case: one typed turn that fires every signal, with the classifier, an open tie for an agent with the POV and one elsewhere, and a reply; the narrator is not counted):

| Preset | Calls | Which |
|---|---|---|
| Lean | 2 | `interpret`, `extract` |
| Standard | 4 | `interpret`, `npc.choose` ×2 (with the POV before the plan, off-screen after the reply), `extract` |
| Full | 7 | Standard + `brief`, prose `outline`, `contradiction` (an eighth call judges a puzzle answer when one is typed) |
| Custom, every step on `always` | 8 | Full + `choices` (`puzzle.answer` runs only when an Answer needs judging) |

The most a turn can run is what the preset's steps and phase budgets allow: each step takes one call from its phase's budget when it starts, and a puzzle answer to judge counts (Full's 8 is the 7 of the busiest tested turn plus that). No typical count is given: the earlier figures were measured with the retired lore-selection step and haven't been measured again. The call meter shows each turn's real count. Each step is its own call; a JSON repair or a Decision-to-helper fallback adds one call that no budget is charged for.

**Budgets**
- Budgets are a **call count and a wall clock per phase for model steps**. Simulation is bounded only by deterministic units.
- Defaults, as calls and time before / after the reply: Lean 1 (20 s) / 1 (30 s); Standard 2 (30 s) / 2 (45 s); Full 8 (60 s) / 4 (60 s).
- Steps run by priority; independent steps run in parallel or batched.
- At the deadline, each remaining step uses its fallback: utility-only NPC choice, beats-only outline, or plain roleplay plus extraction. The post phase keeps the user's deadline, with no hidden floor: a budget of 0 ms means no post call.
- **Host caps:** context handler 120 s; World Info interceptor 10 s; decisions 30 s per call. Each Import or Refine model call has its own 120 s deadline besides cancel.
- **Reasoning models:** helper calls to a reasoning model need `max_tokens` of about 1,500 or more; at 160 they failed because reasoning counts toward the limit.
- The call meter shows each turn's calls, tokens and latency in the HUD, with averages and the 95th percentile in Settings. It is kept per user in `userStorage/call-meter.json` (the last 200 turns and the current one), so a restart keeps its numbers.
- **Lean** is the documented floor of D3 and does not meet "a model decides" on its own.

## 6. Context control: the engine's sections

Lore handling is switched off for now; a lore lookup of the engine's own will replace it in a later release. In a world chat the World Info interceptor puts the engine's sections into the prompt and votes only on the world's own book. Every other book's entries, and recursion, are left to native World Info.

### 6.1 Retired: lore selection
The interceptor no longer builds candidates from user books (with pins, D19), skips pass-through books, pre-ranks a hit set capped at 64, asks the `select` step with its per-candidate cache (D13), spends a lore budget, votes user entries off, suppresses adopted sources (D11), syncs world lore into the engine book, overrides recursion or warns about Council World Info. Native World Info decides user entries in world chats, Council's included. World lore stays in the world document (§4.2) and is not delivered for now.

### 6.2 The section budget
- The slots spend the **section budget** (§5.3) in rank order. **Outcome** (rank 0) is never evicted; a later slot that doesn't fit is clipped, left out for that turn and shown as clipped in the inspector.
- The inspector's budget-used figure is the section budget spent; only an Outcome that alone exceeds the budget can take it past the total.

### 6.3 Slots and rendering
- **Compact lines,** at most one per fact. A section costs the token count the host's tokenizer gives for its exact rendered text (header and bullets included), cached per user and text, since the host counts with each user's own main model. Until the host has counted that text for that user, or when it cannot within a second, an estimate stands in: 3.2 characters per token, plus 2 for the header, 3 for each line break and 1 for each number, which stays at or above the host tokenizers on the shipped worlds' sections. A count that is not a finite number from 0 to 4 times that padded estimate is ignored, so the estimate stands in and a bogus count cannot clip every section. Counts are fetched in the background, so the interceptor never waits on the host.
- **Dynamic values never form a macro.** World Info content is macro-evaluated by the host, so everything the engine inserts (names, prices, model output, proposals) is neutralized: every brace becomes its fullwidth look-alike (｛ ｝), the host's escape sentinels (the C0 control characters `\x00`–`\x02`, which its evaluator turns back into braces on a second pass) are dropped, and the `<user>`, `<char>` and `<bot>` shorthands are broken with fullwidth angle brackets. Section labels and templates are covered too, and a section template may hold only `{{lines}}`. Breaking only `{{` pairs is not enough: it leaves `{{{…}}}` and escaped braces runnable by the host's lexer, and backslash escaping keeps the text literal but delivers visible backslashes. **Authored lore keeps its macros**, as in native World Info, and a world import lists every macro, sentinel and shorthand in its lore and templates for the player to review before playing.
- **Sizing:** native context clipping sees the real size. Slots are fixed overhead and are never clipped; when the fixed prompt exceeds the context budget, the host drops all chat history, including the latest user turn. Lint and Settings check the engine budget (§5.3) against the connection's context, and each turn records `GENERATION_IN_PROGRESS.contextClipStats`, which the inspector flags.

### 6.4 The vote
For world chats:
- **`disabled`:** every engine-book entry the interceptor did not fill this turn, so an unused slot, or a lore copy an earlier build left in the book, cannot activate natively even if someone re-enabled it in the host's UI. The host keeps a `disabled` from any interceptor in the chain, so no other interceptor can revive it.
- **`enabled`** and **`forced`:** filled slots only.
- **`mutated.content`:** slot texts.
- **`mutated.placement`:** where deliverability requires it. The host accepts only `{type:'chat_depth', role, depth, direction}`; other positions cannot be overridden.
- **Nothing else:** no entry of another book is disabled, enabled or forced, and `activationOverrides.disableRecursion` is not set. Recursion follows the user's World Info settings, so a slot's text, like any constant's, can trigger a user entry. Slots carry no unrevealed truth (§6.3, §7), so this changes prompt content, not secrecy.
- **Leftover lore:** a world lore entry an earlier build synced into the book is deleted the next time the book is ensured (commit, import, Upgrade, attach), or after a generation whose interceptor sees one; the hook itself reads nothing from the host.

### 6.5 Inspector and limits
- **Inspector:** per generation, the engine sections with their token cost, clipping and delivery, the section budget used, and the activation confirmation. A section left out over the section budget shows a "clipped" badge with "left out: over the section budget" and is never shown as delivered; a delivery check leaves it unchecked, since it was not in the prompt. It keeps the last 10 interceptor runs per chat, with the last delivery check by slot, in `userStorage/runs/<chat>/inspector.json`, read when the chat is first viewed, so the history and its badges survive a restart; inspector dry runs stay out of the chat history. Its warnings cover a detached book or missing slot entries (both repaired for the next turn), the D32 preset lint and journal notices.
- **Other extensions' World Info interceptors:** they cannot switch on an engine-book entry the engine left off; what they do to user entries is theirs. The README lists this caveat.
- **If the worker stalls:** slots are absent (fail-closed), and the turn is flagged.

## 7. Knowledge and visibility
- **Values:** `public`, `known_by` (through `knows`), `secret` (GM only).
- **Player-facing views** are filtered to what the POV knows. The GM view shows everything as **unrecorded previews** (§9.2), everyone else's money included: each person at their own Money level (a band at 1; cash and one account at 2; every account and their bills from 3), with their latest history lines and payday, bill and decline notes; accounts not opened yet show the opening balances they will start from. The player never sees another person's money unless the POV holds the account. A track still on a bare start stage is dormant and stays out of the quest log until it moves on, so a quest can wait unseen for its trigger.
- **Slots** carry POV-known and public facts plus cues; truth enters only at reveal.
- **Extraction** may propose `knows` **only for public facts**. Secret stages advance only by predicates. The extraction and `interpret` prompts list only the entities and places the POV may know (itself, those it has met, its own, or visible where it stands; every visible one in a world that does not place the POV), and a proposal naming anything else is dropped before any change or chip. A proposal that carries an unrevealed secret's truth is dropped before any chip.
- **NPC decision inputs** may carry that NPC's secrets. Outputs are authored actions with observable labels; lint flags leaky labels. Secret-bearing questions never share a call with prose steps.
- **Player-facing wording.** Chips, Journal lines and prompts never name an entity the player has not met or a secret. A dropped or failed event is worded for the player (its player line when the POV may see it, otherwise "A change no longer applies"), and the raw reason stays in the GM view. Validator reasons name things by label (entity, place or track name), not by id. Enum values and code-like words read as words ("needs service", "on shift"). A turn's Journal entry lists the same lines as its change chip: at most 8, and when more exist, money, quest-stage and signal lines (a payday, a statement, an invitation) are kept ahead of ordinary ones and routine lines (activities, other people's moves, needs) go first; the kept lines stay in order.
- **Acceptance:** truth text and judged paraphrases are absent from Breakdown, choices, the Journal and panels until reveal.

## 8. NPC simulation (level of detail)
- **LOD0 (every NPC):**
  - schedules (place, zone or cell, activity), validated on the grid;
  - event overrides until a given time;
  - seeded incidents per slot (process seeds).
- **LOD1 agents (flagged NPCs; on at every realism level, including Story):**
  - Agendas (tracks) and goals feed choices. At realism ≥3 the Cast life planner schedules whole days.
  - The engine enumerates valid actions, always including "do nothing".
  - The decision model is consulted only in the tie zone or for an invitation, and its choice is recorded in the turn's events.
  - **On screen:** intents come from public labels.
  - **Off screen:** catch-up on every `slot_crossed` up to K agents per turn from a round-robin queue, in process (D9). It runs before the reply when the player's action advances time, otherwise after it.
  - **During a timelapse,** and in the catch-up for an applied `time.advance` (§9.2): every LOD1 agent steps through the interval inside the unit cap; tie-zone choices are utility-only by default (§9.2).
- **The player's character** follows its own routine (place and activity schedules) only when time runs on its own (a timelapse or catch-up). An ordinary turn leaves it where the player took it. A narrated move across a gap that no single-mode route spans is declined ("There's no way from … to …"), and a POV that is stranded, or whose routine's place cannot be reached, stays where it is.
- **Group chats:** character entities link to Lumiverse character ids.

## 9. Granularity and domain packs (D17, D18)

### 9.1 Two dials

**Depth per domain** (realism levels 0–4):

| Domain | 1 Narrative | 2 Simple | 3 Detailed | 4 Simulation |
|---|---|---|---|---|
| **Money** | Wealth band | Cash plus one account (ledger) | Accounts, cards (with autopay), recurring income and bills | Interest/APR, statements, minimum payments, loans, investments, withholding |
| **Gear** | Notable items | Items, containers, cash as currency in a wallet | Worn/equipped slots, kits (template plus overrides), condition | Wear per use, consumables |
| **Vehicles** | "Runs fine" | Fuel %, location, owner | Specs, consumption, odometer, use grants, home base | Maintenance intervals, seeded breakdowns, registration/insurance, marine and off-road specifics |
| **Cast life** | Day-part routines; agendas as tracks | Commitments set the day | Day planner | Needs/drives, invitations, NPC↔NPC encounters, knowledge spread |
| **Relationships** | One band per pair | One number per pair | Multiple axes plus appraisal rules | Decay, history, faction regard |
| **Space & travel** | Named places | Places plus routes and travel times | Grids, positions | Terrain multipliers, mode-specific routes |
| **Calendar & time** | Day parts | Clock and dates | Recurrence, time zones | Holidays, terms, exceptions |
| **Weather** | Season mood | Climate states | Regional climates | Microclimate effects on travel and rules |
| **Sheets & checks** | Bands as words | Stats plus one check | Skills, derived fields | Full sheet |

Level 0 turns a domain off. Story systems (tracks) do not depend on realism. Time controls and Timelapse (§9.2) need Calendar ≥1; at level 1, targets round to day parts.

**Tiers and bands.** A world names its own tiers (`WorldDoc.tiers`: label, band, order, an optional agent default and description), and each maps to one of three fixed **detail bands**: `principal` (shown as Leads), `supporting` (Supporting) and `background` (Background). Caps are per band and domain. A world written before tiers existed gets three tiers whose ids are the band ids, so its entities, settings, `resolve` markers and stored ledgers read unchanged.
- **Effective level** = the per-entity override if set, otherwise min(domain level, the cap of the band its tier maps to). An override can never exceed the domain level. The tier is read through the world each time, so a tier's band follows the revision in force. An entity's tier that the world doesn't define keeps its band when it is a band id (one spawned before the world renamed its tiers), else runs at the domain level; lint flags unknown tiers.
- **The POV** is `world.pov` and is never capped, whatever its tier. A legacy `pov` tier on the POV is moved to the lead tier (the lowest-order Leads tier) when the revision is read; revisions are immutable, so this happens on every read.
- **New entities:** a spawn that names no tier of the world gets the world's spawn tier (`spawnTier`, by default its lowest-order Background tier), and an entity without its own agent flag takes its tier's agent default (never the POV).
- **Realism presets** (`Custom` allows any combination):

| Preset | Money | Gear | Vehicles | Cast life | Relationships | Space | Calendar | Weather | Sheets | Band caps (Leads / Supporting / Background) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Story** (default, D22) | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 1 | Domain levels for all |
| **Grounded** | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | none / none / 1 |
| **Simulation** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 / 3 / 2 |

- **New chats start from the world.** The starting markers (§4.3) carry the world's own realism (its levels and band caps, a band it caps being its whole say for that band) and time controls; the user's settings fill in what the world doesn't set (the time scale, NPC calls, and any domain, scene type, interrupt class or activity the world leaves out). With "Use my settings instead of a world's defaults for new chats" on (off by default), the user's realism and time settings replace the world's instead, and a world cap the settings don't keep is lifted. Later changes are new markers. A level is a whole number from 0 to 4; anything else reads as 0.

### 9.2 One representation, gated by level
- **Same data at every level.** Levels gate which processes run, what panels and slots render, and what extraction may propose. They never change the data shape.
  - **Money:** one double-entry ledger whenever an entity has numeric money (≥2).
    - Level 1 renders a band from net worth.
    - Entities without a ledger keep a band field.
    - Changes made at level 1 post as balanced adjustments against the **external economy** counterparty.
  - **Kits** are a template plus sparse per-piece overrides. Taking a piece creates one override item, and completeness is derived.
  - **Fuel and odometer** are tracked as numbers from level 2.
  - **Decay and needs** are computed closed-form at read time.
- **Promote and demote.**
  - Promotion switches processes on. An entity that lacks representation gets it through lazy materialization.
  - Demotion switches processes off and narrows rendering. The data stays live (nothing goes dormant), so re-promotion never restores stale detail.
  - The demotion preview lists predicates whose inputs will freeze.
- **Level contract per pack:**
  - the fields that are live at each level;
  - **level-independent query functions** for predicates, the planner and renderers (`wealth(x)`, `can_afford(x, amount)`, `has_item(x, kind)`, `fuel_ok(v, route)`, `regard_band(a, b)`);
  - **cross-pack services** with defined behavior at every level. For example, `economy.charge` is a no-op at 0, a band check plus adjustment at 1, and a posting from 2. Similar services cover `gear.transfer`, `vehicle.consume` and `relationship.appraise`.
  - **Mixed-level parties.** Every party posts at **its own** effective level. A counterparty with no numeric money (level ≤1, or Money off) is represented in the ledger by the **external economy** account, tagged with the counterparty's id, and its band moves by its level-1 rule. Money is therefore always conserved in the ledger, whatever the mix of levels.
  - Cash is a currency stack in a wallet container when Gear is 2 or higher, otherwise a plain cash account.
- **Lazy materialization:**
  - **Materializers take the entity's current representation as input** (band, notable items, current aggregates, known facts) and sample **within** it. A level-1 NPC moved from "poor" to "rich" materializes a balance inside the "rich" band, never a value drawn from the seed alone.
  - **What counts as "show":** a **player-facing observation or an in-fiction action** (opening a trunk, emptying a wallet, auditing an account). The GM view, inspector, audits, playtests and Dry Run render **labelled previews from the seed** and record nothing. One more thing needs a person's money: the recurring money processes (Money 3+) open the authored accounts of the people they act for, posting their opening balances (the same event a view records; it draws no randomness) in the first slot holding 09:00, so their bills draw on the money the author gave them.
  - **Where it is recorded:** materialization during a turn goes in that swipe's `events`, ahead of the action's effects. Between turns it goes in the head record's `post`. **Inside a turn's in-flight window it is deferred** (P2, §4.3): the panel shows "pending" and the detail materializes on the head once the window closes, so nothing shown is ever re-sampled.
  - It is capped per write and recorded with `generatorVersion` and `tablesRevision`.
  - **Pinned versions.** Each world revision pins the generator versions and data-table revisions it uses: tables are copied into the revision (§4.1), and every pinned generator version stays in the bundle. A running chat keeps its revision's pins across extension updates. New tables or generators reach it only through **Upgrade** (a `migrate` marker), never silently. First-shown detail stays recorded in `events`/`post`.
  - Detail whose source materialization entry is missing from the current fold (a branch cut before it, a Discard, a drop or an inert entry in a rebased view, a Re-narrate drop) regenerates from the same seed and pins, but from the current representation, which may differ. The UI therefore labels it "regenerated" whenever that source entry is missing from the current fold.
- **Time (D29).** Deterministic by default; no time control or timelapse needs a model call.
  - **Every turn has an elapsed time:** a timelapse segment or the action's duration, otherwise the scene's default tick × the time scale; zero while the clock is paused. The Scene slot states it ("This turn took N min." or "No time passes this turn.").
  - **Time controls.** A new chat takes the world's scene-type ticks, interrupt policies, Speed-through policies, montage and unit cap as starting `time` markers (§4.3), with Settings → Time filling in what the world leaves out (always the time scale and NPC calls), or replacing the world's with "Use my settings" on; Play → Calendar changes the running chat. A mid-chat change to any time control is a `time` marker (§4.3): a pure intent with `seq`, journaled and folded like a realism change.
    - **Default tick per scene type**, editable: conversation 2 min, action 1 min, exploration 10 min, downtime 30 min (engine time is whole game minutes, so the smallest tick is 1 min); worlds may add types and set their defaults. The scene type is the POV's `scene` field, set by actions, rules or a ✎ fix; while it is empty, the place's (or an ancestor's) default applies.
    - **Time scale:** a global multiplier on default ticks only (0.25×–10×, default 1×). Action durations, travel times and timelapses stay exact.
    - **Clock paused** for the current scene: zero elapsed time (ticks and action durations) until resumed or the scene changes. Timelapse asks to resume first.
    - The interrupt policy, Speed through, Montage granularity, the timelapse unit cap and Custom NPC calls (below).
    - **Hard maxima** hold wherever a value is read, so a world document, an imported ledger or an intent can never ask for an unbounded run: a tick is at most one day; the time scale stays within 0.25×–10×; a timelapse reaches at most 366 days from now; Custom NPC calls are at most 50 per timelapse; a Speed-through threshold is between 1 minute and 7 days.
  - **Timelapse** (palette sheet, Calendar panel or chip; §11):
    - **Targets:** a duration (minutes, hours, days, weeks), or *until*: next morning or another day part, the POV's next shift or commitment, arrival (the active trip ends), a date and time, a track reaching a stage, or "until something happens" (the first `stop` interrupt). "The next <day part>" or "tomorrow", whether in the parameters or in the player's text, means the following occurrence when the coming one is under three hours away, so "sleep until the next morning" at 07:14 sleeps the night.
    - **It is an action:** a user message with `intent:{timelapse, target, overrides}` and `triggerGeneration`. Per-run policy overrides travel in the intent.
    - **Simulation:** the context handler steps the interval in process (D9), slot by slot with process seeds (so it equals N one-day steps), inside the unit cap. The POV follows its own commitments and routine like an LOD1 agent, so pay, bills, commutes and fuel post as they fall due.
    - **Interrupt policy,** per class `stop` | `note` | `ignore`: invitations, bills, declines, incidents, quest triggers, rule triggers (rules may be tagged `interrupt`), NPC arrivals at the POV's place, overdue use grants, needs thresholds (Cast life 4) and weather alerts. Defaults: `stop` for invitations, declines, incidents, quest triggers and arrivals; `note` for bills and paydays, rule triggers and overdue use grants; `ignore` for needs thresholds and weather alerts. After each slot step, in slot order, the first `stop` event ends the timelapse at that slot's end; `note` events go to the Montage. The same state and policy give the same stop. A turn that stopped early says so ("Timelapse stopped: <reason>") and offers to continue.
    - **Unit cap** per segment (deterministic; it can be lowered but never raised): 600 agent-days (LOD1 agents plus the POV, × days) and 5,000 events. A longer request ends its segment at the last whole slot inside the cap, **always at least one slot**, and shows a **Continue timelapse** chip with the time left. Settings and lint reject a cap smaller than one slot for the world's LOD1 agents plus the POV. Seeds do not depend on segmentation, so segments compose exactly when nothing else changes state between them (a timelapse turn proposes no `time.advance`; below).
    - **NPC choices:** tie-zone choices use utility only (no model calls). Custom may allow up to N `npc.choose` calls per timelapse (default 0), recorded like any choice.
    - **Simulation timeout or failure:** the segment is not applied, since a partial result would depend on wall clock. The turn is `degraded` and a **Retry timelapse** chip appears.
    - **Recorded** as the turn's `events` plus a summary event `{from, to, target, stoppedBy, segment}`. Derivable events go in as per-period aggregates and period closes (§4.3, record size). Re-run reproduces the interval (process seeds, utility choices) except Custom model choices; Re-narrate copies it.
    - **Not a model channel:** an explicit timelapse is user input and is not bounded by the `time.advance` cap. Model-proposed advances stay capped (§9.4).
  - **Montage slot** (engine book; filled on timelapse turns; ranked after Outcome on the section budget):
    - key events, filtered to what the POV knows (§7);
    - aggregates: money in and out per account at the POV's Money level, distance and travel, regard changes that cross a band, notable needs;
    - granularity: key events only (default), per day or per week; coarsened to fit the budget;
    - default line: "Narrate the interval from the Montage; don't add events." The Journal keeps the full list.
  - **Speed through,** per activity type (sleep, work shift, commute or travel, waiting), when the activity's remaining span exceeds its threshold (default 30 min). Actions declare the activity they start and its span (until 07:00, the shift's end, arrival).
    - `offer` (default): the turn elapses only the action's own duration, and a chip offers a Timelapse to the activity's end.
    - `auto`: the turn runs that timelapse itself, with the interrupt policy and a Montage.
    - Activities first seen by extraction always get the offer chip, since the engine never starts a generation on its own.
    - Shorter spans elapse within the turn.
  - **Typed time.** The action catalog always includes "Let time pass" (minutes, or until a day part, shift or commitment). Up to 24 hours runs as the turn's own timelapse; a longer span is offered as a Timelapse chip and never run unasked, so a misread cannot skip days. A span typed after another action ("…then wait until morning") is offered, not run.
  - **Extraction** may propose a bounded `time.advance` only for narrated time **beyond** what the swipe has already applied: it is given the clock from its fold prefix (P2, §4.3) and the time already applied for this swipe (the turn's elapsed time plus any earlier advance, `cont` or `narr` reading). It proposes none on timelapse or Speed-through turns, or on a timelapse turn whose segment was not applied (that turn shows Retry timelapse instead).
    - **Under the cap** the advance applies per its bound (§11; a confirmed one is a `post` entry) together with its **catch-up**, computed at once in the post pass (or at the confirm) and stored with it: the interval runs whole, like a timelapse segment (every LOD1 agent and the POV's routine, inside the unit cap, every interrupt class at `note`), so it equals a timelapse to that time. It is all or nothing: if the interval exceeds the unit cap or the catch-up cannot finish within the post-pass bound, the advance is not applied and becomes the Timelapse chip below.
    - **Over the cap,** or when its catch-up cannot apply whole, it becomes a **Timelapse** action chip to that time, with every interrupt class at `note` (§9.4).
  - Recurring processes step per slot with process seeds. Closed form is used only where it is exact.
  - **Property:** skipping N days equals N one-day steps and any segmentation of the same timelapse.

### 9.3 Packs
Each pack ships a pure `core` (kinds, relations, level contract, services, query functions, schedules and rules, actions, effects, materializers, data tables) and a `ui` (renderers, Play panel, editor views), plus lint, tests and loop-sim scenarios.

| Pack | Contents |
|---|---|
| **Calendar & time** | Gregorian and custom calendars, weekdays, holidays, terms, recurrence, per-place time zones, the per-turn tick; **time controls** (ticks per scene type, time scale, clock pause, `time` markers); **Timelapse** (targets, interrupt policy, unit cap, segments); **Speed through**; the **Montage** slot (§9.2). |
| **Space & travel** | Places, routes with modes (walk, road, off-road, water), distances, terrain, grids, positions, tracking. Reachability is a query: a move across a gap no single-mode route spans is declined. |
| **Gear & containers** | Own, hold, wear and store; equip slots; containers with weight and volume limits; stacks; kits as template plus overrides (a piece named in free text matches by its words in any order: "metric combination wrench" finds "combination wrench, metric"); condition, wear, consumables.<br>**Use grants** (lending): a loan ends at the time the player says ("until 7 tonight", "for 3 hours", "tomorrow morning", "Friday"), which wins over the days; words that name no time fall back to the days, and with neither there is no loan. When a loan runs out the thing stays where it is, is flagged *overdue*, and the owner's planner schedules retrieval. A thing handed back to its owner, or given to a new owner, ends its loans and clears *overdue*; passed on to someone else, it stays lent. |
| **Vehicles** | Road, marine and off-road kinds; fuel type, capacity, consumption by mode, terrain and load; range; odometer or engine hours; condition; maintenance; status; location and **home base**; owner; **assigned to** (a use grant with the same expiry semantics); passengers and cargo as containment; refuel, repair and service through `economy.charge`; seeded breakdowns. |
| **Economy** | A double-entry ledger with an external-economy counterparty.<br>**Accounts:** cash (wallet-bound at Gear ≥2), checking, savings, cards (autopay from level 3), loans, brokerage.<br>**Flows:** payroll from jobs, with flat withholding per occupation and region; rent, utilities, subscriptions. Recurring payments come from checking, a card or savings, never from wallet cash. A bill paid to someone in the world (a person, or anything holding accounts) lands in their deposit account; any other payee is an outside counterparty. Two bills due the same morning see each other, so they can't both spend what covers one. **Living costs:** every Monday at 09:00 (the calendar's weekday 1), everyone but the POV who holds accounts pays a week of everyday spending for their current wealth band: the world's own `livingCosts` (economy config, a weekly amount per band in its minor units), else, for the Modern US data, one adult's weekly grocery basket (thrifty, moderate or liberal) times 1 to 8 by band, at the region's cost of living; a world with neither has none.<br>**Everyone's records:** a history line is filed with every holder it touches: the POV's history feeds the Money panel, and each other person's record (their last 12 lines and 6 notes) feeds the GM view. Their payday, bill and decline notes are secret `economy.note` events, never signals, so they never reach the player or stop the player's timelapse. Someone whose money is a band alone keeps no lines or notes.<br>**Card rules:** interest, fees, statements, minimum payments, limits and declines.<br>**Markets:** investments on process-seeded price paths.<br>**Pricing:** catalogs plus category price bands.<br>**Reports:** budgets, net worth, cash flow. A funds guard on posting refuses any payment the account cannot cover (a Keep conversion is the player's own adjustment and may leave an account short). |
| **Cast life** | Commitments (jobs, school terms and timetables, appointments, trips and vacations, chores); needs and drives; agendas; a day planner (deterministic utility, seeded tie-breaks, recorded tie-zone decisions, re-planning on interrupts); off-screen execution; NPC↔NPC encounters. |
| **Relationships** | Per-pair multi-axis regard; appraisal rules; closed-form decay; bands that feed the planner and narrator voice; history; faction regard. |
| **Sheets & checks; Weather; Story** | §3, §8, §10. |

### 9.4 Every way a model can change state, with its bound

| Channel | Bound |
|---|---|
| `interpret` → action and parameters | Validated by the action's requirements. "Not an action?" undo. |
| `interpret` → a timelapse target | A model-read target is bounded like `time.advance`; over the cap it becomes a Timelapse chip. Activity spans are engine-defined, so Speed through `auto` may still apply. The turn re-simulates after re-resolve (§5.1). |
| `extract` → `time.advance` | Only narrated time beyond what the swipe has already applied (the folded clock plus earlier advances); none on timelapse or Speed-through turns. Capped per turn; its catch-up runs whole in the post pass. Over the cap, or when the catch-up cannot run whole, it becomes a Timelapse chip with every interrupt class at `note` (§9.2). Explicit timelapses (palette, chip) are user input, not this channel. |
| `extract` → spawns | Capped and deduplicated. |
| `extract` → `knows` | Public facts only. |
| `extract` → NPC presence or location | Validated against routes and schedules; capped. |
| `extract` → purchases and transfers | Priced from catalog or category bands; bounds per field; declines (§9.5). A transfer's two sides are people or their own cash, checking, savings or card accounts (§9.5). |
| `extract` → regard | Capped per pair per turn. |
| `extract` → condition, quantities | Capped per field. |
| `npc.choose` | Picks only from engine-enumerated valid actions; recorded. |
| Prompted `effects` | Same validation and bounds as extraction. |
| `puzzle.answer` | Authored opt-in per puzzle; a threshold on a probability. The puzzle is named by words from its label, or left out when exactly one is open. |

Everything else (balances, prices, interest, payroll, fuel, travel, time ticks, timelapse intervals and interrupts, weather, schedules, planner days) is engine-only.

**Extraction quality was measured on a deliberately weak model** (DeepSeek V4 Flash), and the numbers are a floor, not the design target (D31). The first measurement, on 38 labelled narration fixtures, gave precision 0.41 with the base prompt and 0.74 with strict rules, against a 0.90 target. Two corrections followed:
- **strict prompt rules:** `time_advance` only for an explicit jump or stated duration; `knows` only for public facts the POV newly learns; `regard` only when the prose states a change; `give` only for a handover between two characters; never a duplicate;
- **deterministic dedupe in validation:** a purchase subsumes the seller's handover and its payment transfer; a cash `give` (only when the whole item is money) is a transfer with method "cash"; a payer must be an account.

I then re-measured with the engine's own `extract` step as shipped (strict rules plus dedupe; the same 38 fixtures and scorer; 38 calls): overall precision **0.68** (30 of 44), recall 0.71, and no forbidden proposals. Per type: `time_advance` 1.0 (6/6), `condition` 1.0 (1/1), `regard` 1.0 (4/4), `transfer` 1.0 (2/2), `spawn` 1.0 (1/1), `give` 0.71 (5/7), `location` 0.67 (2/3), `purchase` 0.56 (5/9), `knows` 0.44 (4/9), `quantity` 0 (0/2). The samples are too small to move a cold-start mode, so D4's defaults stand; learning on the player's own connection (§11) is the gate.

### 9.5 Narrator contract
- **Facts are authoritative.** The default line reads: "Use the facts' numbers; don't invent prices, balances, quantities, fuel or times. Name items and actions; the engine settles costs."
- **Narrated purchases:**
  - `extract` returns the item, its category, the payer (the person who pays, never an account or a card) and, when the prose says so, how they paid, in the prose's words;
  - the engine prices it in this order: a price the player set on a chip (*Set price*, *Edit amount*), charged as set; the catalog row that names the item (by id, or `matchCatalog`: whole words with simple plurals, the item's main noun among the row's head nouns, then the row covering most of the item's words, the purchase's category, what the place sells); the stated price; the band of the purchase's category, or of a category the item names. A price the player states in a Buy is charged in full (and declines when it cannot be paid); a price the narration alone gives is capped at the economy pack's `unpricedCap` (minor units; by default the highest `price_cents.max` of the world's catalog, else 500 major units; worlds saved with the old `unpricedCapCents` are migrated once). The buy's `economy.txn` records the narrated amount and whether it was capped or clamped, and every purchase chip shows the amount charged with "(priced as …)" and "narrated X, capped at Y" or "clamped to Y";
  - one purchase per item: the extract prompt asks for two things bought as two purchases, and a narrated purchase naming several things one of which is the turn's own Buy (`splitAlongBuy`) drops the Buy's part and prices the rest on its own, without the bundle's price ("fish and chips", which holds no part of the Buy, stays whole);
  - a narrated purchase of the turn's own Buy (`boughtAlong`) is dropped only when it is the Buy told again: the same main noun, one name's words holding the other's, any stated price the Buy's (±25% of the charge or the typed price, or inside its row's band) and no "another" beside it in the prose. "Another", "a second", "one more", "for <person>", a different quantity or a qualifier that rules the Buy's out ("green" for "red", "large" for "small") make it a new purchase; anything else of the same noun is unsure and always asks with an *Also bought …?* confirm chip, whatever the purchase mode;
  - a narrated purchase nothing prices gets a decline chip, *Bought X: no price*, with *Set price* (the shared money input), *Pick item* (catalog rows close to it, then what the place sells, from `economy.item_choices`) and *Dismiss*; an automatic one keeps *Remove it* and *Accept* beside them;
  - a Buy may say how it is paid, and the extract step passes the prose's words the same way: "credit card" pays from a card, "debit card" or "checking" from checking, "cash" from the wallet, "savings" from savings. A kind of account the payer doesn't have falls back: a card to checking, anything else to the usual order. When the extractor names an account as the payer, its holder pays from that account; when it names a thing someone owns (a debit card in the wallet), its owner pays the way the name says (a debit card from checking, a credit card on the card, a wallet in cash). A method the proposal states wins over all of these;
  - for a typed Buy, when `interpret` leaves the way of paying out, the player's own words fill it ("credit card", "debit card", "cash" or "savings"), but only when said as a payment: after "with", "on", "using", "by", "from" or "in" ("pay with my credit card", "in cash", "from savings"), and not as a thing named after it ("a credit card holder"). A negated mention ("not with cash", "instead of …", "rather than …") is skipped and the last mention counts, so "not with cash, with my debit card" pays by debit card, "I buy a credit card holder for $12" doesn't charge the card, and a long sentence that says "pay with my credit card" charges the card, not checking. A method `interpret` set stands;
  - money the model states as written (8 for $8) is converted to minor units once, before the channels read it, in `extract` and in a world's own `effects` steps (their prompts ask for plain amounts in the world's currency), and a narrated transfer's chip shows the formatted amount;
  - a payment's named source pays only when it is the payer's own cash, checking, savings or card account, at every money level; a loan or a brokerage account named as the source falls back to the usual choice. A narrated transfer's sum is one rounded number in minor units (its cents when given, else the converted amount), and its chip states that sum;
  - a narrated give of money becomes a transfer of that amount with method "cash", converted once before dedupe. A give is money only when the whole item is: an optional article, an amount with the currency's symbol or code or a money word, or a cash word, then optionally "bill", "note" or "in cash" ("$20", "a twenty", "a $20 bill", "20 dollars in cash"). A priced thing ("my $300 jacket", "a $20 gift card") stays a thing. A Gear give never makes money into a thing: "cash", "$20", "a twenty" and "20 dollars" are refused as items ("2 old daggers" in pence is an item, since a letter currency symbol counts only beside the number);
  - each side of a narrated transfer is a person or a person's own cash, checking, savings or card account. An account stands for its holder, paying from it (`from`) or depositing into it (`to`), and two sides of one holder move money between two of their accounts, so money is conserved. A thing, a loan or brokerage account, or an account no person holds is refused with a *Didn't apply* chip, and nothing moves. The extract prompt states the contract: transfers are between people (entity ids) or their own cash, checking, savings or card accounts, never things, with method "cash" when bills or coins change hands in person ("hands me $20", "slips her a twenty") and no method for a bank transfer, an app payment or a card;
  - cash handed over (a transfer with method "cash") lands in the payee's carried cash, else checking, and comes from the payer's carried cash when it covers, else the usual source, so "Danny hands me $20 for gas" adds $20 to the wallet. A transfer's other stated method picks the payer's account the way a purchase's does, so *Pay another way* on a declined transfer tries each account;
  - in **lenient** worlds a narrated price inside the band is accepted, and one outside it is clamped with a chip. A capped or clamped purchase's chip has *Edit amount*: on a confirm chip it applies the purchase at the amount typed; on an automatic one's Undo chip `economy.reprice` posts the difference between the same two accounts.
  - **A decline after the prose** shows a chip: *Pay another way* (retries savings, then card, then checking, then cash), *Remove it* or *Accept*. By default the item stays unowned and the next Outcome slot says so ("the payment was declined; they don't have it"). Remove and Accept only reword that note. Notes go to the next turn and its swipes, and are dropped once a later message has committed and another follows. They are kept in `userStorage/runs/<chat>/outcome-notes.json`, so a restart before the next turn still tells it.

### 9.6 Scale and storage
- **Record targets and overflow:** §4.3.
- **Materialization** records only player-facing views and actions.
- **Previews** are never stored.
- **Turn-critical work** (simulation, catch-up and timelapse segments) runs in the backend process, inside the context handler, bounded by the deterministic unit caps (§9.2). A default-cap segment took 38 ms on a child process and 2.5 ms in process, far inside the host's 15 s watchdog, so a second process and a per-chat registry copy would have bought nothing (D9).
- **Background lane** (one child process, `dist/worker/background-lane.js`): Check world, Playtest, imports, Build with AI validation. It sends heartbeats within the host watchdog (15 s) and never blocks a turn.
- **Jobs** are kept per user in `userStorage/jobs.json`: kind, world, input, status, progress, message and result. An import keeps its checked proposals after every chunk. A job stored as running that the process isn't running (the extension stopped while it ran) reads as **interrupted**: its proposals so far can be reviewed and applied, and **Run it again** starts it with the same input. Running jobs are always kept; of the ended ones, the newest 8, and **Dismiss** removes one. Build lists a world's kept jobs when a tool opens.
- **G9** (follow-up) if chat-open payloads grow.

### 9.7 Bootstrapping from existing lore books
- **Import from lore:**
  1. Pick books.
  2. Extraction on the background lane turns them into per-pack proposals. Proposals cover every pack's kinds (the prompt lists the kinds and fields per pack), are checked against the world's kinds, field types and references, deduplicated deterministically, and grouped by pack. An import reads at most 72 entries per pass; the rest is a second pass. A helper reply that is empty, not JSON, not in the proposals shape, lists no readable proposal or (for lore with text) is an empty list is asked once more with a reminder of the shape, inside the same deadline (a call that timed out or was cancelled is not asked again); Refine keeps an empty answer. Retries spend only the calls no chunk needs, within the import's 12 calls, and Refine shares the retry. Import and Refine calls get room for a full answer (6,000 tokens), each call's outcome and time go to the user's diagnostics, and a reply cut off at its token limit is logged. When proposals are dropped, the job says why.
  3. Review: accept or reject each item. Show value names each source by its entry and book ("Lighthouse · B2 Chat Lore"). Edit accepted items afterwards in the editors.
  4. Entities are created; sources are back-linked (`EntityDef.sources` and `PlaceDef.sources` hold `bookId/entryId`), never edited. Refine changes merge onto the existing entity, and a change that leaves out the entity's kind keeps the kind it has.
  5. Gaps are filled from data tables and marked "Assumed from a table" (`EntityDef.assumed`; `FieldDef.table` marks table-backed text fields). A new entity whose kind the lore leaves out takes the world's single base kind (`thing`: the one root kind that other kinds extend), is marked "Assumed kind" and starts unticked in the review whatever its confidence; `assumed` holds `kind` until a change gives the entity another kind. With no single base kind the proposal is dropped and the job says why. A kind named in a proposal or a kind field is looked up by its own key, so a name like `constructor` is an unknown kind. An uncited proposal stays unlinked rather than guessing an entry.
- **Data tables:** 17 editable **Modern US** tables (approximate current prices, pay, taxes and rents), built from raw sources by `bun run tables` into pinned tables whose revision is `hashJson({schema, columns, rows})`. Each world revision pins the revisions it uses (§9.2). The table editor edits a table; replacing it with another region's is not built.

## 10. Tracks and rules (story systems)
- **Quest track:** stages, objectives, effects, next-stage predicates, gate, fail, rewards, visibility.
- **Secret track:** cue, reveal stages through to the truth. Stages update `knows`, and a stage's truth reaches a section only once revealed. **Advance by predicates only.**
- **Puzzle track:** a solution predicate, or an answer check (exact or normalized, then `puzzle.answer` only where the author enabled it). Attempts and a hint ladder.
- **Agenda track:** steps feed planner priorities.
- **Rules:** triggers on events, ticks, place entry or times. Cascade cap of 8. Storylet beats.
- **Gates are predicates.** A model decides one only through an authored `puzzle.answer` threshold.

## 11. Actions, checks and bounds
**Inputs**
1. **Action palette:** filtered actions, exact odds, catalog prices. A candidate is offered only if it passes the action's requirements about the candidate alone (they read only the candidate and `self`, and may call on the candidate, like `invited(host)` or `carries(self, item)`), so Pay card lists only your cards and loans, Lend and Transfer only your own things, and Accept invitation only the hosts who invited you. Requirements that read anything else (`at(to, here)`) stay availability.
2. **Map tap.**
3. **Typed text** through the classifier and `interpret`; a "Not an action?" chip. Lend takes days or a said end ("until 7 tonight", "for 3 hours"), at least one; the palette always sends days.
4. **Optional narrator tools** (`inline_available`, off by default).
5. **Timelapse and Pause/Resume clock** through the palette's Timelapse sheet and the Calendar panel. No command-palette commands are registered.

**Execution.**
- Palette, action-chip and map actions append a user message (text plus `intent`) with `triggerGeneration`.
- Resolution runs requirements, then the check, then effects, then the duration.
- The Outcome slot says the result is decided.
- An unmet requirement reads as a plain decline ("Not possible here and now: you need to have it with you"; "You're already there."), never as its expression.

**Ruleset primitives.** Generic and ruleset-agnostic; rulesets are data over them (`engine/checks`, `engine/ruleset`, `engine/ruleset-lint`).
- **One check mechanism, still exact.** Everything a check reads (modifier, advantage, DC, the opponent's side) is evaluated from the state before the roll and fixed into one notation and one set of bands, which both the palette's odds and the roll read. Bands may test the total, the **natural** die (the first dice term's single kept die: `d20`, `2d20kh1`), matched before the rest, and the **margin** over the DC; odds count the joint law of the natural die and the total, which is exact because the natural die and the other terms are independent. A DC with no bands reads `failure`/`success`. **Advantage** (−1, 0, 1) changes the dice, never the modifier: one more natural die, keeping the higher or lower, cancelling a die at a time; lint refuses it, and natural bands, on dice with no natural die. An **opposed** roll folds into one notation (`1d20-1d20`, modifier A − B, DC 0, so ties go to the roller); a passive score is the DC. Outcome effects read `roll.natural`, `roll.total`, `roll.modifier`, `roll.dc`, `roll.margin` and `roll.outcome` as variables.
- **Anyone rolls.** The core `check` effect has any actor roll, from rules and effects; the roll forks the effect's generator by `actor:<id>`, so it never moves the POV's rolls, and an `engine.check` event records its final values (hidden from the player unless the POV rolled).
- **`roll()` only in effect arguments.** A `=` formula in an effect's arguments evaluates with a generator forked from the effect's own, and the event stores the result, so folds stay deterministic. Modifiers, requirements, derived fields, rule conditions and sheet formulas have no generator: there `roll()` is a lint error and reads as null, so shown odds and reads never change on their own.
- **Pools** are number fields with `pool: {max, min?, recover?}`. `set` and `add` clamp to the evaluated max, an unset pool is full, and `recover` restores by an amount, the pool's `recover`, or to the max. Being fields, they keep undo, Keep, rebase and the reference fold.
- **Progression** (`ruleset.progression`): after each effect (and a ✎ fix), every entity whose XP field it changed rises to the level its XP has reached, one level at a time; each level sets the level field and runs `onLevel` with `level` and `from`, and the POV gets a Journal line. The level-ups are events recorded with the effect, so replays never level up twice. `award` adds XP. `table(id, key, column)` and `table_step(id, value, column)` read pinned data tables anywhere, since tables are pinned per revision.
- **The sheet** (`ruleset.sheet`) lays out Play → You for the POV; `buildEntitySheet` builds it for any entity, so a GM view can show anyone's. **Level floors** (`ruleset.minLevels`) wrap every effective level the engine reads (`rulesetFloor`), so ruleset math such as stat modifiers works under any realism preset.

**One bounds mechanism (D4)**
- Every field has `{max_delta, mode: auto | confirm | never}`, with defaults per domain and per realism preset. **The most restrictive applies.**
- **Extraction defaults per proposal type (D4):** `auto` for `time_advance`, `location` and `condition`; `confirm` for `knows`, `give`, `purchase`, `transfer`, `regard` and `spawn`; `quantity` has no cold-start mode and starts at `confirm` ("From the field's bound"). Each mode is a setting, one tap to change (D31). These modes are only the **cold start**; promotion then **learns on the player's own connection** (D31), with no new surface and no extra model calls:
  - **Counting:** per extraction type and per connection (the one the `extract` step ran on), from the confirm and undo chips only. A proposal counts once: accepted when confirmed, or applied automatically and not undone by the next turn's commit; rejected when rejected or undone. An ignored confirm chip counts nothing. A read with no pre phase (Re-read edit, Retry read, Continue) counts against the user's real default connection.
  - **Promotion:** at ≥ 0.90 acceptance over at least 30 outcomes, both read from a rolling window of the latest 30, a `confirm` type flips to `auto` on that connection, with a notification chip and undo ("Purchases now apply automatically: undo").
  - **Demotion:** an `auto` type flips back to `confirm` when the window's undo rate rises past 0.10, with the same chip. Undo on either chip restores the previous mode and holds the type there for another 30 outcomes.
  - **Precedence:** a mode the player set in Settings pins the type (it is still counted, never flipped), then the mode learned for the turn's connection, then the cold-start default, then the field bound. Counters live in `userStorage/extraction-learning.json`, under the connection's own key only; nothing is recorded for an unsafe connection id.
- Locked fields are never offered to the model.
- Spawns are capped and deduplicated.
- **Engine outcome wins** over a contradicting extraction.

**Confirm chips.** Only a proposal that would validate right now gets an Apply button; a declined purchase gets a decline chip; the rest are logged and dropped, unless they were automatic changes (next paragraph). A reply that tells the turn's own action again offers no second chip. A narrated give of what the turn lent to the same person, or of something inside it (a lent truck's glovebox), is the loan itself; a narrated purchase of what the turn's own Buy already bought is that purchase (the item names match when one holds all of the other's words, and only when the player character or something they own pays). A different thing given to that person, or bought, in the same turn still gets its chip. A confirmed chip is applied as a `post` event on the head record if confirmed before the next send. Otherwise it expires at the send, with a Journal note.

**Changes the engine refuses.** An automatic change the engine refuses for any reason gets a decline chip and an Outcome note instead of being dropped silently: a payment that can't be covered keeps *Pay another way*, and anything else that can't apply (no amount, an unknown item, a transfer to a thing) reads "Didn't apply: …" with *Remove it* or *Accept* and "Nothing changed". The Outcome note quotes the change's chip label as written, so a name keeps its case ('"Danny Okafor → 114 Harbor Street" was narrated but didn't happen', not 'danny Okafor'). A change that would not validate and was not automatic is still only logged. The people a narrated change names are materialized before it applies (a payer's accounts get their opening balances), and that detail is recorded with it, whether it applied automatically or from a confirmed or re-paid chip.

**Chip actions run once.** Stored chip actions run one at a time per (user, chat) behind a lock: inside it the chip is looked up again and acted on, and it is taken as soon as its write lands, before learning or other bookkeeping, so a double tap applies once and the second tap finds nothing. A failure in the learning that follows is logged and does not fail the tap. Adding a chip whose id already exists replaces it.

**Action chips** (Timelapse offers, Continue timelapse, Retry timelapse) start a turn like a palette action. They lapse at the next send.

**Undo.** Undo covers the latest reply; earlier changes go through Keep/Discard. An undo that later on-path events depend on is refused ("later events depend on it") rather than cascading, which keeps every on-path entry re-validatable (L7). "Not an action?" appears only on interpreted action resolutions, because a timelapse's events are clock and simulation output rather than undoable effects.

## 12. Mobile-first UI (D12)

| Surface | Contents |
|---|---|
| **Drawer tab "LumiRPEngine"** | Designed for ≥320 px.<br>- **Play:** Scene, You, Money, Garage, Gear (Owned/Worn/Carried/Stored), Cast (timelines, agendas, regard), Calendar (clock, pause, Timelapse, this chat's time controls), Quests, Journal (with Montages), Context, GM view (labelled previews).<br>- **Build:** the schema-driven editors, and a Tiers editor (add, rename, reorder, band, agent default, description, the tier new people join).<br>- **Settings:** model-use preset and budgets; "Use my settings instead of a world's defaults for new chats"; **realism** (per-domain sliders on the host range slider, band caps under the band labels, presets, migration preview); **time** (ticks per scene type, time scale, interrupt policy, Speed through per activity, Montage granularity, unit cap, Custom NPC calls); steps, connections, pins; swipe default; caveats. |
| **Map** | Fullscreen float widget (`setFullscreen`, feature-detected), falling back to the drawer. Pointer Events; pan, zoom, tap-to-move or drive. On narrow viewports the drawer stacks above float widgets, even fullscreen, so opening the map closes the drawer. Phone and desktop save its size and position under separate keys, so a size saved on a phone never shrinks the desktop map (480 × 520 at most). Place names never overlap: each sits outward beside its dot, or a little further out on a leader line, on two lines, or shortened with an ellipsis (the full name shows in the place's card on tap); as a last resort a name is left off and its dot stays tappable. The names of side places stay on their own half, the map's buttons and title bar stay clear, and a tap on a name selects its place (a 40 px tap area). |
| **HUD pill** | Time (⏸ when paused; the scale when not 1×), place, weather, cash. Docking; collapsed below 760 px; ✎ fixes. Phone and desktop save its position under separate keys, and it stays centred as its content sizes it until the player moves it. The host restores saved geometry only when it creates a widget, so a viewport that crosses the phone breakpoint rebuilds the pill under the other layout's key (`frontend/hud-float.ts`). |
| **✎ fixes** | Each writes where its value lives, as a `fix` post entry with one `set` (§4.3), so undo, Keep, swipes and Re-narrate treat them alike. **Place:** the POV's `place`. **Weather** (Weather ≥2): the `weather` field of the region over the POV, picked from its climate's states (the `weather.fix` query). The climate process still steps the region, so a fix holds until the climate next changes the sky, or, under a scripted hold, until the hold ends. **Scene type:** the POV's `scene` field, picked from the world's scene types (its ticks and its places' types), or "" to follow the place again; it wins over the place default until an action, rule or fix sets it. |
| **Chips** | What changed, elapsed time, rolls and odds, prices and transactions, confirm chips (until the next send), declines, undo, Retry read, Retry (an empty reply, D32), Not an action?, Re-narrate/Re-run, overdue use grants, Timelapse offers, Continue timelapse, Retry timelapse, Keep report (one row per dropped group, convert per row, one-tap Discard, entries "made on another branch"), Re-read edit (an edited reply, or a Continue accepted unread), mode change (a type learned `auto` or went back to `confirm` on this connection, with undo; §11). Detail opened during a turn's in-flight window shows "pending" (§9.2). |
| **Palette** | Actions with targets and odds, Buy (catalog), Pay, Transfer, Drive, Lend, **Timelapse** (a bottom sheet at 390 px: duration chips, *until* targets, interrupt-policy overrides), Pause/Resume clock. An action that needs a second target (Drive's destination, Lend's borrower: at most 12, nearest first), a piece (Take from a kit lists each kit, then the pieces still in it with how many are left) or a number (Lend's days, default 1) asks for it as a second step; only final picks are judged. Before a chat's first turn the palette, like Settings → Realism → This chat, judges at the levels that turn will use (the starting markers: the world's defaults with the user's settings filling in, §9.1), so an option it offers is not declined when the turn runs. |

Touch targets are at least 40 px (including a number stepper of our own with named − and + buttons, a typed value committed on blur or Enter); icon-only buttons carry labels; tabs use a roving focus with arrow, Home and End keys; dialogs close on Escape and manage focus; text colors follow the host theme at a contrast of at least 4.5:1. The layout is proofed at 390 px and works down to 326 px; real devices belong to my live audit; English first. Drawer layouts keep critical values clear of the host's chat-head bubbles on the right edge at 390 px (D33).

**Money input.** Every amount the player types (the palette's Amount for Pay, Buy without offers and Transfer, the cash ✎, chip amounts) goes through one input and parser driven by `world.currency` (`src/shared/money.ts`, `src/frontend/money-input.tsx`): the currency's symbol or unit beside the box, its own number of decimals ("5" is 5 bits, 5d or $5.00; "5.5" is refused where the currency has none), thousands separators and the symbol accepted either side. Build stores money as whole minor units, and its money fields and money table columns name the world's minor unit ("(bits)", "(pennies)", "(cents)"). Playtest's typed amounts scale by the currency's decimals.

**Cash ✎.** Where the POV's cash is held in cash accounts (the economy panel's cash), the cash fix posts the difference between the POV's cash (carried cash first) and the outside `economy.external:correction` account, memo "Correction" (`economy.set_cash`), so the panel and the pill show the amount and the books balance; it stays a `post` entry of kind `fix`, so undo, swipes and P3 treat it like any fix. A world without cash accounts keeps setting the `cash` field.

**An action the helper couldn't read.** `interpret` asks once more on a transient failure (a reset or refused connection, a timeout, a 5xx); still failing, the text plays as plain roleplay and the turn gets a *Couldn't read your action* chip (`read_failed`) whose *Retry* is a Re-run of the turn, which reads the text afresh.

## 13. Authoring and validation
- **Schema-driven editors** for every pack. Four special widgets: **map/grid, schedule/timeline, track graph, expression**.
- **Lint** (live, plain language):
  - refs, types, cycles, unreachable stages;
  - oversized sections;
  - leaky labels, secret truth in lore;
  - attachment, groups;
  - unbalanced postings;
  - double-booked commitments;
  - predicates on frozen fields after a demotion;
  - a timelapse unit cap smaller than one slot for the world's LOD1 agents plus the POV;
  - section templates that hold a macro (only `{{lines}}` is allowed), and, in an import review, every macro, escape sentinel and shorthand in lore and templates;
  - **presets (D32):** a dry run of the open (else last played) world chat flags max tokens below 1,500 with a reasoning model, and an enabled preset block that asks replies to carry JSON (such as the Default preset's "Caravan Ledger"). The preset is the one the host assembles with: the connection's linked preset, else the active Loom preset, learned from the host's change events or the last saved breakdown. A dry run sees exactly the blocks that assemble, because Spindle has no read API for the active preset setting.
- **Check world, Playtest, Import from lore, Build/Refine with AI:** all run on the background lane. Playtest drives typed turns without a model: it finds an action's lexicon phrase as said or with filler words inside it ("walk down to" says "walk to"), and when several actions' phrases are said, the one whose required details the line fills wins (so "I walk over to Alder Market" goes to the market, not a map step with no square), then an exact phrase, then the longest. A phrase counts only where the player does it, judged in its own clause: not after a negation ("I don't want to walk to"), not in a hypothetical ("might", "whether to", "thinking about", or an "if" earlier in the sentence), not inside an idiom ("pay attention"), and only with the player as the subject. The nearest subject before the phrase decides: first person ("I", "we", "let's") acts; another pronoun ("he'll"), or a person's name followed only by an auxiliary or "to" ("Danny will walk", "ask Danny to walk"), doesn't; with no subject word the line is a command, unless an auxiliary shows someone else's ("the clerk will walk"). It fills references from names said and reports each turn as the player would see it, rather than bookkeeping. Check world's transcript is the author's view of each day: every event, worded with names like Playtest's (no ids or bookkeeping, at most 40 lines), including people the player has not met and secrets, so off-screen routines and unmet people's events can be checked. Dropped events, failures and leaks stay in the notes.
- **Templates:** three starter worlds, each converted from a neutral template into `lre-world-v1` by `bun run templates`: **Brindlemere** (a fantasy town; Story preset, a custom 13-moon calendar), **Harrowmere Hall** (a 1934 mystery manor; Grounded preset) and **Port Alder** (a modern slice-of-life town; Simulation preset). They carry 24, 21 and 26 public lore entries. Each lints clean, runs eight days with its books balanced, and has scripted walkthrough tests: quests finish, secrets stay hidden until found, puzzles appear once found.
- **World import/export:** `lre-world-v1`, one document with the world's lore inside; World Books are not exported.

## 14. Quality gates and acceptance (D15)

**Unit tests**
- determinism and fold order (markers up to `markersApplied` → `events` → `post`, including `cont`, and later markers by `seq`), including **Upgrade or chip confirm, then Continue**: the `cont` entry folds after them, exactly as validated;
- concrete deltas versus final values; Keep re-validation and report;
- **rebased views:** re-validation with the Keep-report defaults writes nothing to later records; a `keep` conversion applies only under its parent path; **switch away, then make a materialization, ✎ fix, chip confirm, Continue, realism, time and Upgrade marker and a new turn on the switched path, then switch back: the fold equals the original exactly**, each of those entries is inert there and listed "made on another branch", and switching to that path again makes them live; a marker made during a regenerate of an earlier message is inert after navigating that message back to its old swipe; re-convergence skips re-validation once the state matches; a Discard is tombstoned, so re-assert and restart recovery never restore it, even after a lower swipe's deletion shifts indexes;
- Re-run independence (a 50% check across trials) and Re-narrate (P3), including **Upgrade, then Re-narrate**: the new swipe folds exactly as the source up to the reply, its narration renders from the same prefix, its post steps run once and its `narr` entry folds after the Upgrade; a copied entry that depends on the source's post-step results is dropped with a Journal note;
- **in-flight window (P2):** a chip confirm, ✎ fix, materialization, Keep or marker made while a turn streams or during its post pass shows "pending", takes its `seq` after the commit and folds after the turn's events (after the `cont` entry for a Continue); one made while two windows are open waits for both; post-step events validate against exactly the fold prefix, so re-folding equals validation; `seq` keeps increasing across restarts;
- skip N days equals N one-day steps and any segmentation of the same timelapse; an applied `time.advance` to T equals a timelapse to T with every interrupt class at `note`; an over-cap advance, or one whose catch-up exceeds the unit cap or the post-pass bound, applies nothing and becomes a Timelapse chip;
- timelapse interrupts: the same state and policy stop at the same slot; switching a class from `stop` to `note` leaves the events before the stop unchanged; unit-cap segments end on slot boundaries and always advance at least one slot;
- time controls as markers: a tick, scale or pause change folds by `seq`, and a swipe planned before it keeps its old tick; changing Settings → Time or the world's default ticks after the first record leaves a running chat unchanged; a Continue on the greeting before the first turn is accepted unread, the starting markers land on the first record that holds events, and a Discard of that record or a greeting-swipe switch leaves them in force;
- `time.advance` extraction: narrating the turn's own elapsed time ("after the three-hour drive", a Montage's "three days later") adds no time, a timelapse turn proposes none, and a Continue that refers back to time the reply already advanced adds none;
- `interpret` re-simulation: typed "I go to bed" re-simulates the night's duration, and with Sleep on `auto` runs the timelapse;
- Montage: no secret or POV-unknown events; aggregates equal the ledger totals for the interval;
- ledger balance invariants; promote/demote leaves aggregates and the trial balance intact; level contracts at mixed levels (a transfer between a level-4 party and a level-1 party keeps the trial balance);
- materialization determinism, including across an extension update with unchanged pins; new tables or generators arrive only through Upgrade; promotion from a band changed at level 1 lands inside that band; detail opened during a turn's in-flight window shows "pending" and materializes once, after the window closes; detail whose source materialization entry is missing from the current fold is labelled "regenerated";
- marker `seq` fold order; kit template plus overrides; planner determinism with recorded tie-zone choices; expression and A* caps;
- leak tests: no chip, Journal line or model prompt names an unmet or secret entity, even when the narration describes an unnamed figure who is such an entity.

**Fake-host tests**
- fingerprints and the generation counter (Stop, then Regenerate); slot correctness;
- the Continue path: suffix-only extraction, no double application, the `cont` entry's `seq` at commit. A non-head Continue (explicit `message_id`) appends no events, records `accepted`, offers Re-read edit and leaves later paths unchanged. A Continue whose prefix holds literal braces is accepted unread, with no conflict. A stopped Continue, head or non-head, records `accepted` on the message found by content, even when another message is edited or another writer touches metadata during the Continue, and raises no conflict; Retry read on the head extracts the partial suffix once;
- an earlier-swipe switch makes later records rebased views without a pause; switching back restores the original at any time. An earlier user-message edit pauses. Editing an assistant reply, on the head or earlier, by edit or swipe `PUT`, keeps the world and offers Re-read edit; Re-read on an earlier message rebases later records. Deleting a middle message rebases. A regenerate with an explicit `message_id` on an earlier message is a turn there, and later records become views;
- an earlier swipe switch while a reply streams: the new record commits off-path as a rebased view with a Keep-report chip; an earlier user-message edit while it streams puts it under the pause, and an assistant edit does not; the host's macro re-render of the turn's own user message does not pause either;
- timelapse: zero model calls under Standard, the Custom call cap, nothing applied on a simulation timeout, Speed through `offer` versus `auto`;
- deleting a middle message keeps its markers' effect on later turns; in a world chat the interceptor sends nothing for user entries and no recursion override while the sections go in; an engine-book entry it didn't fill is voted off, and a lore copy an earlier build left there is removed; a world with a `select` step template loads without it;
- marker durability (frontend echo, deleting the latest message, restart); Discard tombstones under re-assert, restart and swipe-index shifts; the shadow overlay; Edit-and-Send; Dry Run purity (previews only); background-lane failure and backlog; per-preset call counts;
- after a restart: an interrupted job is reported and its proposals can still be reviewed and applied; a decline note reaches the next turn's Outcome slot; the inspector's history and delivery badges and the call meter are unchanged; a damaged file of any of these is set aside and a fresh one used;
- a double-tapped chip applies once.

**Ledger property suite (the ledger gate)**

I stopped reviewing the ledger on paper once repeated review rounds kept finding problems. Since then the ledger is accepted only by this executable suite (§17).
- **Reference fold:** a small, obviously correct implementation of §4.3, kept in its own module and sharing only the pack effect handlers and validators with the optimized fold. It has no cache, overlay shortcut, snapshot or re-convergence, and re-folds every message from the world revision on every query.
- **Fake host:** replays the host event orders and payloads recorded in the spike.
  - Every generation runs `GENERATION_STARTED` → context handler → interceptor → `WORLD_INFO_ACTIVATED` (only when a book is attached) → `GENERATION_IN_PROGRESS` → tokens → save → `GENERATION_ENDED` or `GENERATION_STOPPED`.
  - A normal turn stages its reply empty with `MESSAGE_SENT` before `GENERATION_STARTED` and saves it with `MESSAGE_EDITED`, or creates it with `MESSAGE_SENT` at the save (P4). Regenerate, swipe and both Edit-and-Send modes stage with `MESSAGE_SWIPED` `added` and save with `updated`. A Continue saves with `MESSAGE_EDITED`, twice when its prefix re-renders.
  - `GENERATION_STOPPED` is `{generationId, chatId, content}`, with the suffix only for a Continue. Its save comes first.
  - Swipe navigation stays live on any message while a reply streams. Branch creation is silent. Event payloads carry no `userId`; it arrives as the handler's second argument. A reply can be saved empty. A restart removes a staged reply. A swipe delete leaves `spindle_metadata` unshifted.
  - The host's macro re-render of the turn's user messages (P4), which the spike did not observe, is generated in both variants (present and absent).
- **Randomized operation sequences** (seeded generator; failures shrink to a minimal sequence). Operations:
  - send, regenerate and swipe (Re-run and Re-narrate);
  - Continue on the head, on a non-head message and with a stop;
  - Edit-and-Send in both modes;
  - earlier swipe navigate, add, delete and `PUT`;
  - middle and latest delete;
  - branch and import;
  - chip confirm, ✎ fix and materialization;
  - realism, time and Upgrade markers;
  - Keep, Discard and convert;
  - restart, and foreign or frontend clobbering;
  - any of these interleaved inside an in-flight turn, while it streams and during its post pass.
- **Oracle:** after every operation, the optimized fold equals the reference fold (state, Journal notes and Keep report), and every invariant below holds.
- **Volume:** the gate run executes 10,000 generated sequences of up to 200 operations (the default test run uses a fixed-seed sample of 200 sequences of up to 60; `LRE_PROPERTY_RUNS`, `LRE_PROPERTY_OPS`, `LRE_PROPERTY_SEED` and `LRE_PROPERTY_BASE` control it), plus the fixed regression seed set (every seed that has ever failed, shrunk). The ledger gate passes only when both pass.
- **Named invariants.**

| Invariant | Property |
|---|---|
| **L1 Reference equality** | The optimized fold (cache, overlay, re-convergence) equals the reference fold. |
| **L2 Switch away and back** | Switch away from any earlier swipe, do anything there (materialization, ✎ fix, chip, Continue, markers, turns, conversions), switch back ⇒ the original fold, exactly. Everything made there is inert and listed "made on another branch". |
| **L3 No pause on a switch** | An upstream active-swipe change or message removal never pauses; only a user-message content edit does. |
| **L4 Classification by state** | Classification is a function of the chain-snapshot diff, never of event names: a user-message edit, an assistant edit or swipe `PUT` (on the active swipe, or on an inactive one once it becomes active), an explicit-`message_id` regenerate and a middle delete classify as content edit, assistant edit, turn and removal. |
| **L5 Off-path commit** | A turn whose chain changed while it was in flight never commits on-path: an upstream swipe change gives a rebased view, and a user-message edit, including one to its own user messages, gives the pause. An assistant edit leaves it on-path. |
| **L6 Host writes are not edits** | The host's macro re-render of the turn's own user messages and a Continue's own save never classify as content edits. |
| **L7 Re-fold equals validation** | Every committed event and `post` entry, re-folded, sees exactly the state it was validated against (its fold prefix, or the head's fold up to its `seq`). |
| **L8 One window per turn** | No write made inside a turn's window is journaled before the window closes; each then takes its `seq` and folds after the turn's events, and detail shown as "pending" is recorded once. |
| **L9 Persistent `seq`** | `seq` comes from the journal's counter, strictly increases across restarts and clobbering, and never names two different entries (a Re-narrate copy keeps its source's `seq`). |
| **L10 Fold order equals planning order** | A swipe folds as it was planned: live markers ≤ `markersApplied`, `events`, then `post` entries and later markers by `seq`. A marker made after a swipe never changes how that swipe's events fold. |
| **L11 Re-narrate** | A Re-narrate folds exactly as its source up to the reply; each copied entry passes re-validation against its own prefix or is a Journal drop; its `narr` entry folds after everything in effect when it was narrated. When the source cannot be reproduced, it is a Re-run. |
| **L12 Re-run** | A Re-run records a fresh seed and re-folds identically; across generated trials a 50% check passes within tolerance. |
| **L13 Continue reads only its suffix** | A Continue never re-reads or re-applies effects already in the record, and its `cont` entry folds after every entry journaled before it started. |
| **L14 Accepted Continue** | A non-head Continue, one on a message without a record, a stopped one and one whose prefix was re-rendered append no events to any record and move no later path; the target holds the text as `accepted`. |
| **L15 Stopped-Continue target** | A stopped Continue's text lands on the message found by content, whatever else was edited or written meanwhile; no record is orphaned and nothing pauses. |
| **L16 No silent drop** | Every stored entry the fold does not apply has a Journal note or a Keep-report line (dropped, inert, Re-narrate drop, tombstoned). |
| **L17 No resurrection** | After a Discard, no re-assert, restart, clobber recovery, swipe-index shift or later operation restores a discarded record. |
| **L18 Durability** | After foreign or frontend clobbering and a restart, records, markers and held writes are re-asserted and the fold is unchanged. |
| **L19 Deletion keeps live markers** | Deleting a middle or the latest message keeps its live markers' effect on later folds; its inert markers go with it, journaled. |
| **L20 Starting markers** | Each chat has exactly one set, on the first record that holds events, live on every path. Later Settings changes, switches, Discards and deletions never change it. |
| **L21 Concrete deltas** | Events hold deltas, never final values, and a view re-applies them. |
| **L22 The ledger balances** | The trial balance is zero after every operation, at every level mix, including external-economy postings and payroll withholding. |
| **L23 Uniform representation** | Demote, change and promote leave aggregates and the trial balance intact and restore nothing stale. |
| **L24 Materialization** | A first promotion from a band lands inside the band. With unchanged pins, detail is identical across extension updates; new tables or generators arrive only through a `migrate` marker. |
| **L25 "Regenerated" label** | Detail is labelled "regenerated" exactly when its source materialization entry is missing from the current fold. |
| **L26 Elapsed time** | Every unpaused turn advances the clock by its elapsed time; a time-control change applies by `seq`, never to a swipe planned before it. |
| **L27 No double time** | A swipe's clock advance equals its elapsed time plus advances for narrated time beyond what it had already applied; timelapse, Speed-through and failed-timelapse turns propose none. |
| **L28 Advance equals timelapse** | An applied `time.advance` to T folds like a timelapse to T with every interrupt class at `note`; an advance whose catch-up cannot run whole applies nothing. |
| **L29 Segmentation** | Skipping N days = N one-day steps = any segmentation of the same timelapse; every segment advances at least one slot. |
| **L30 Interpret re-simulates** | After `interpret` changes the action, its duration or its activity, the recorded elapsed time and simulation equal those of a turn planned with that action directly. |
| **L31 Determinism** | The same operations and seeds give the same fold, whatever the wall clock, lane scheduling or chunking. |
| **L32 Bounds** | Every applied model-proposed change is within its field bound and channel (§9.4); prices come from the catalog or the category band. |
| **L33 Overflow** | A record past its size target coarsens or chunks, and round-trips without truncation. |
| **L34 Previews record nothing** | Dry Run, the GM view, the inspector, audits and playtests leave the ledger and journal unchanged. |
| **L35 No stale slot** | The applied-plan slot is written only while the generation counter matches; a stopped generation's interceptor, which the host lets finish, never writes it. |
| **L36 Kits** | Kit completeness is derived from template plus overrides; taking a piece adds one override. |
| **L37 Context on the fake host** | The interceptor disables, enables and forces nothing outside the world's own book and sets no recursion override; inside it, only filled slots are enabled and forced, and every other entry is disabled. |
| **L38 Assistant edits keep the world** | Editing an assistant message, on the head or earlier, by edit or swipe `PUT`, active or inactive, never changes the fold unless Re-read edit is tapped; Re-read on an earlier message makes later records rebased views. |
| **L39 User edits pause** | Editing an earlier user message pauses later records until Keep or Discard. |
| **L40 No negative accounts** | No own account folds below zero on any path (a Keep conversion is the exception); a rebased view drops what it cannot cover, and its dropped notes and Keep lines agree. |
| **L41 Groups land whole** | Within a record, a group of events is dropped whole or kept whole, never in part. |
| **L42 Snapshots** | A cold fold that starts from the chat's stored snapshots equals the full fold. |

**Loop-sim** (including mixed-level and Story-default scenarios)
- the clock advances every turn unless paused; timelapses stop only on `stop`-class interrupts;
- shown odds equal real odds;
- the books balance;
- calls and tokens stay within budget;
- no secret truth reaches slots;
- no double-booking;
- no stale restore.

**Live checks** (narrator and helper JSON on the chat connection; Decision steps on the Decision connection; the measured model is a floor, D31)
- the spike's viability checks (§18);
- per-block measurements.

**Acceptance**
- A visible check per block on the reference host (D28), at phone width, with screenshots.
- Then my live audit of the complete extension.
- Decision-API and live checks use the Decision connection (D27).

## 15. Reuse from Warp and the studio seam (D1, D23)

[Warp](https://github.com/japolino/warp) is japolino's earlier roleplay engine. I reused parts of it with his permission for this non-commercial project, and the `NOTICE` file lists every file.
- **Adapted code** (carried over and changed): `engine/expr.ts` (the safe formula language, with hard limits, a typed limit error, a shareable step budget and a finite-number result), `engine/dice.ts` (the dice notation and roller, with an injected generator, exact outcome distributions and bounded input) and `engine/decide.ts` (the decision question and answer shapes, with strict validation and a canonical option order).
- **Design only, with no Warp code retained:** the per-swipe turn record in message metadata and the path hash (the ledger, §4.3), a small deterministic fingerprint (`hash.ts`), revision-counted state pushes (`push.ts`), a fake host that drives the real backend in tests, a whole-loop simulator as a quality gate, and pan and zoom kept as pure functions (`map-math.ts`).
- **Written for the adaptation:** `engine/rng.ts`, a seeded generator (sfc32 seeded from the hash of a seed string) that replaces the generator inside Warp's dice module. MurmurHash3 (Austin Appleby) and sfc32 (Chris Doty-Humphrey) are public-domain algorithms.
- **Looked at and not used:** Warp's overlay layout, world, quests, companion-life and companions test files. A comparison found no shared code or structure.
- Warp's reasons for cutting scope are inferred from its commits; its design documents are not published.

**Studio seam (fixed now, so the studio needs no breaking change later)**
- **World format:** `lre-world-v1` with a JSON Schema and per-pack versions.
- **`src/studio-api.ts`:** imports only pure pack `core` modules (lint-enforced) and is exported through the package `exports` map as `lumi-rp-engine/studio`. It provides load, validate, lint, check world, playtest, migrate, and the format and engine versions.
- **`lre-state-v1` window event payload:** `{engineVersion, worldFormat, packs:{id:version}, inbound:["file","rpc:<endpoint>"]}`.
- **Install from studio:** an explicit Settings action either imports a file or reads a studio-published `rpcPool` endpoint (no payload argument), then creates a new revision and offers Upgrade to open chats.

## 16. Host gaps and upstream follow-ups (D21)

These are the places where Lumiverse itself would make LumiRPEngine simpler or safer. I plan to propose them upstream after the first release; the extension ships with the caveats below documented.

| # | Gap and proposal | Size |
|---|---|---|
| G1 | Generation and target ids in context-handler and World Info interceptor contexts (plus `generationType`/`dryRun` for the latter); `generationId` on `WORLD_INFO_ACTIVATED` | ~20–40 LOC |
| G2 | **Namespaced, merge-safe, swipe-aligned extension message metadata** (required for coexistence) | ~10–120 LOC |
| G3 | Keep the prompt-assembly worker for unaffected chats and users (`match`-gated interceptors or an `unregister` API) | ~15–80 LOC |
| G4 | World Info interceptor abort signal and flags; opt-in fail-closed mode | ~25–40 LOC |
| G5 | Council World Info through the interceptor chain | ~40–60 LOC |
| G6 | Doc fixes; the `match.isDryRun` → `dryRun` bug; `WORLD_INFO_ACTIVATED.stats.evictedByBudget` misses budget evictions; the published types lag the host | Small |
| G7 | Entry ids on World Info-derived prompt messages | ~15–25 LOC |
| G8 | Forced entries skip inclusion-group competition | ~10–20 LOC |
| G9 | Keep `spindle_metadata` out of the light message list | Small |

**Shipped caveats** (Settings and README):
- While the extension is enabled, prompt assembly for **all users on the host** runs on the main process. On a 1,000-message chat the measured overhead was about 23 ms per prompt build (§18.5).
- Coexistence with other message-metadata writers (G2).
- In world chats, other extensions' World Info interceptors cannot switch on an engine-book entry the engine left off. The engine doesn't touch user entries.

## 17. Internal build order (D16)
Blocks are for organization only; the extension is delivered and audited as a whole.

| Block | Scope | Acceptance check (reference host) |
|---|---|---|
| **B0 Spike** (throwaway) | §18 with **synthetic** volumes. | A note of verified assumptions; misses go to the maintainer. |
| **B1 Core** | **First, the ledger property suite** (§14: reference fold, fake host with the spike's observed event order, operation generators, named invariants). Then engine concepts; ledger (events, `post` including `cont` and `narr`, markers, path tags, journal, overlay, in-flight windows, chain snapshot, rebased views, Keep report and overlays, tombstones, Upgrade); seeds; hooks; engine-managed book and slots; beats; **realism core** (levels, tiers, presets, level contracts, services, query functions, external economy); **visibility core**; **data-table core** (pinned versions); bounds; **after the ledger gate:** classifier, `interpret`, `extract` (strict rules, dedupe, D4 per-type modes), decision routing (D10) and narrator-reply handling (D32); Play basics, HUD, chips, palette; schema builder, entity and place editors; starter world. | **Ledger gate:** the ledger counts as accepted only when the §14 property suite passes at 10,000 generated sequences plus the fixed regression seed set, with every named invariant holding. Then, at 390 px: create a kind with a derived field and band. Act by palette and by typing. Re-run rerolls a 50% check and Re-narrate repeats it. Swipe, branch, delete, Edit-and-Send and import stay consistent. Switching swipes on an earlier message rebases with no pause: a Keep-report chip lists dropped events, switching back restores the original exactly, even after detail opened, a chip confirmed, a realism change and a turn on the switched path, and one tap Discards. Switching an earlier swipe while a reply streams lands that reply as a rebased view. Detail opened while a reply streams shows "pending" and lands after the reply. An earlier user-message edit pauses on Keep/Discard; editing an assistant reply keeps the world and offers Re-read edit. Stopping a Continue raises no pause. An empty reply shows Retry. Dry Run shows slots and commits nothing. Upgrade survives a Re-run, a Re-narrate and a deletion of the latest message. |
| **B2 Context and pipeline** | Slot delivery and the engine-book vote; deliverability; activation check; inspector; presets, budgets, call meter; step editor. Lore selection (candidates, pins, the selection cache, links, adoption and suppression) and the Council warning were built here and later retired (§6.1). | The inspector matches Breakdown. User lore activates natively in a world chat while the sections still go in. Call counts are measured per preset. |
| **B3 Calendar, space and travel** | Calendar, recurrence, time zones, the per-turn tick, **time controls** (ticks per scene type, time scale, clock pause, `time` markers), **Timelapse** (targets, interrupt policy, unit cap and segments, Montage), **Speed through**, backlog; routes, modes, grids, the map. | Conversation turns advance the clock by the tick. With the conversation tick at 10 min and the scale at 2×, the next turn's elapsed chip and Scene slot show 20 min, and earlier turns keep their recorded times; changing Settings → Time afterwards leaves this chat unchanged. Pausing the clock makes two turns advance 0 and the HUD shows ⏸. A palette Timelapse of 3 days stops at a seeded invitation, with a Montage and a narrated summary; with invitations set to `note`, a Re-run runs all 3 days and lists the same events before that point, and the narrated summary adds no time. "Until next shift" ends at the shift's start. With the unit cap lowered, a long timelapse ends a segment with Continue timelapse, and continuing reaches the requested date. Going to bed offers "Timelapse to 07:00"; with Sleep on `auto`, the same action, by palette or typed, runs the night. A narrated drive adds no time beyond its route time. A narrated "next morning" makes a Timelapse chip. A recurring shift lands on the right weekdays across a timelapse. A map tap and a typed walk both make validated moves. Marine and off-road routes. All at 390 px. |
| **B4 Gear, vehicles, sheets** | Gear, kits, use grants, overdue handling; Vehicles; sheets and checks. | Owned vs worn vs lent. A toolbox shows 44 of 45 tools after one wrench is taken. A truck burns fuel by route. Assigned-to expiry flags the vehicle overdue and the owner plans retrieval; the vehicle returns to its home base. Shown odds equal logged faces. |
| **B5 Economy** | The ledger at every level; accounts; flows with withholding; savings transfers; cards with statements, interest, minimum payments and autopay; investments; catalogs and category bands; purchase resolution and declines; wallet cash. | Payday posts net of withholding. A narrated off-catalog purchase is priced by category. A post-hoc decline chip appears. A statement closes with interest and a minimum payment. A savings transfer posts. Investments move. Wallet cash is lost with the wallet. The books balance after a 30-day timelapse. |
| **B6 Cast life, relationships, weather** | Commitments, school terms, trips and vacations, planner, agendas, LOD1, encounters, needs; regard; climates. | A day plan shows its utility reasons. A school term and a vacation change the plans. A tie-zone invitation consults the model, and Re-run keeps the recorded choice only on Re-narrate. Regard shifts and decays. An NPC↔NPC encounter changes regard. An off-screen effect survives swipe and branch. Weather follows the climate. |
| **B7 Story and secrets** | Tracks, rules and beats; visibility end to end; GM view previews. | A gate opens only on predicates. A puzzle solves by state, and by answer where authored. Secret truth and paraphrases are absent until reveal. The GM view records nothing. |
| **B8 Authoring at scale** | Import from lore, Build/Refine with AI, data tables UI, realism promote/demote UI, templates, world import/export, Check world, Playtest, studio seam. | Import a multi-book chat into a reviewed world. Mixed tiers (cast at 4, background at 1). Demote Money 4→2, spend, promote 2→4: totals intact, nothing stale. Author end to end at 390 px. Lazily generated detail persists after viewing and after an extension update that changes a default table; the change reaches the chat only through Upgrade. A studio-API smoke test. |
| **B9 Hardening and release** | Performance with the **real packs** (§18.5 gate), user guide, an independent adversarial review, visible checks, my live audit, publishing. | Caveats shown; `NOTICE`; license per D20. |

## 18. Spike checks, thresholds and fallbacks
**B0 was a throwaway spike** on the reference host (D28), with synthetic volumes and live model calls. It checked the assumptions the design rests on before any real code was written. Each check below has its threshold and its fallback.

| Check | Verdict |
|---|---|
| 1 Correlation | Pass. `select` p95 inside the interceptor: 1.13 s (helper), 0.32 s (decisions). `select` was later retired; the interceptor now makes no model call. |
| 2 Delivery | Partial: evictions unreported, escaping visible, placement chat-depth only, history wiped when fixed overhead exceeds the budget, card outlets unverified (§5.1, §6.3, §6.4, §4.2). |
| 3 Ledger, host side | Partial: every host-observable item passes. Engine-fold items need the engine (D34); the user-message re-render was not observed (P4, D35). |
| 4 Model viability | Partial; **extraction precision failed** (§9.4; D4 per-type defaults). Decision-path findings: D10, D30. Empty replies: D32. The numbers are a floor (D31). |
| 5 Performance | Pass, except the rebased-view timing, which needs the engine fold (D34). Timelapse record size binds (§4.3). |
| 6 Published types | Pass, with differences (§3). |
| 7 UI | Pass, with fixes (§12; D33). |

1. **Correlation.**
   - Fingerprint equality for normal, regenerate, swipe, continue and Edit-and-Send.
   - A dry run during a live generation.
   - **Stop, then Regenerate:** no stale slot write; the in-flight `select` is aborted (`select` since retired).
   - The `spindle.assemble` path.
   - `select` latency inside the interceptor, p95 ≤ 6 s (`select` since retired).
2. **Delivery.**
   - Disable all; enable and force stored-disabled engine entries.
   - **Disabled user constants and disabled keyword entries stay off.**
   - **Another extension's forced entry survives.**
   - Escaped slots; `selectionContent`; placement; deliverability resolution and "unverified".
   - Groups, including grouped pins.
   - Forced entries are never evicted; pass-through evictions are reported.
   - Clipping with large slots; recursion off; fail-closed on a forced timeout.
3. **Ledger.** The spike records the host's event order for every operation the §14 property suite generates; the fake host replays exactly that order.
   - No message writes in flight; Edit-and-Send in both modes.
   - Host macro re-render causes no conflict: the trailing user messages' re-render arrives as `MESSAGE_EDITED` between the reply's `MESSAGE_SENT` and `GENERATION_ENDED` and is accepted (P4); an edit of the turn's own user message while it streams pauses.
   - Foreign-writer and frontend-echo clobbering of records **and markers** is re-asserted.
   - Deleting the latest message moves its markers.
   - Swipe add, delete and navigate; branch; import after a deletion; deleting a message in the middle.
   - Keep report; rebased views (switch, open Money so detail materializes, confirm a chip, change realism, send a turn, switch back: the original state is intact and those entries are listed "made on another branch"; switch again and they are live; a one-tap Discard survives re-assert, restart and a lower swipe's deletion) versus a pausing user-message edit; restart recovery; stop and error partial saves.
   - An earlier swipe switch while a reply streams (the host keeps navigation enabled): the reply commits off-path as a rebased view. Detail opened, a chip confirmed or a marker made while it streams or during its post pass shows "pending" and lands after the reply's events (P2).
   - `/regenerate` with an explicit `message_id` on an earlier message (`MESSAGE_SWIPED` `added`) is a turn there and rebases later records, and a marker made during it attaches to the head; a swipe `PUT` (`MESSAGE_SWIPED` `updated`) on an assistant message is an assistant edit, also on an inactive swipe once it is navigated to.
   - Fold order with marker `seq`: a swipe created after an Upgrade folds identically to how it was planned. `post` entries interleave with later markers. **Upgrade or chip confirm, then Continue:** the `cont` entry folds after them, exactly as validated. **Upgrade, then Re-narrate:** the new swipe folds as the source did up to the reply and its `narr` entry folds after the Upgrade; detail materialized for something only the source's extraction created is dropped with a Journal note.
   - Deleting a **middle** message keeps its markers' effect on later turns.
   - Continue extracts only the suffix and never double-applies. A non-head Continue (explicit `message_id`) and a Continue on the greeting before the first turn are accepted unread, and the save's `MESSAGE_EDITED` before `GENERATION_ENDED` raises no conflict. A Continue on a message whose prefix holds literal braces is detected and accepted unread.
   - Stop during a head and a non-head Continue, with another message edited and another writer's metadata write meanwhile: `GENERATION_STOPPED` carries only the partial suffix and no `messageId`; the text is recorded as `accepted` on the message found by content and raises no conflict.
4. **Model viability** (≥30 labeled samples each):
   - **Chat connection** (narrator, helper JSON and the D10 helper path):
     - helper JSON parse ≥ 0.97 after one repair;
     - extraction precision ≥ 0.90 (measured: 0.74 with strict rules in the spike; 0.68 overall through the engine's own step, with the per-type results and the resulting `auto` set in §9.4);
     - narrator contradiction ≤ 10%;
     - helper p95 ≤ 6 s;
     - `interpret` top-1 ≥ 0.85 on the helper path, for chats without a Decision connection.
   - **Decision connection** (D30):
     - `interpret` top-1 ≥ 0.85;
     - `decisions.evaluate` p95 ≤ 6 s (a live sample took about 230–300 ms);
     - answer shape: choice or score with probabilities and confidence, as the seeded sampling needs (§5.2);
     - agreement with the helper path for D10, reported.
   - Classifier firing rate reported.
   - **Fallback:** recommend confirm-by-default for failing field types. Resolved as D4's per-type defaults.
5. **Performance** (synthetic in the spike; real packs at B9):
   - fold ≤ 50 ms at 1k turns and ≤ 250 ms at 5k with a level-4 ledger;
   - a rebased view after an earlier switch ≤ 250 ms over 1k later turns with a cold cache (re-validation plus re-convergence);
   - 30-day catch-up for 20 NPCs ≤ 2 s in process;
   - a default-cap timelapse segment (600 agent-days, interrupts and Montage on) ≤ 2 s in process; the default cap is set from this measurement;
   - interceptor apply ≤ 20 ms (excluding a model call);
   - record size per preset; overflow chunking;
   - chat-open payload growth;
   - main-process assembly cost.
   - **B9 results** (real packs at level 4):

     | Gate | Result |
     |---|---|
     | Fold, 1k turns (≤ 50 ms) | Cold, from a fold snapshot: 19.4–22 ms. Full, no snapshot: 93 ms. Warm: 11–13 ms. Pass. |
     | Fold, 5k turns (≤ 250 ms) | Cold, from a snapshot: 95.8 ms. Full: 576 ms. Warm: 100.8 ms (measured before the prefix memo). Pass. |
     | Rebased view, 1k later turns, cold cache (≤ 250 ms) | 20 ms median, 42.5 ms max. Pass. |
     | 30-day catch-up and timelapse, 20 NPCs (≤ 2 s) | Simulation: 160 ms. Level 4: 115 ms. Pass. |
     | Timelapse record (≤ 32 KB) | Simulation: 29.7 KB. Level 4: 30.1 KB. Pass. |
     | Interceptor apply (≤ 20 ms) | Final release build, offline bench: at turn 1000, 11.8 ms median and 12.3 ms p95; at turn 500, 5.6 / 6.0; with the host's token counts fetched in the background (§6.3). Pass. |
     | Record size per preset (mean / p95 / max bytes) | Story: 408 / 704 / 897. Grounded: 410 / 704 / 897. Simulation: 429 / 982 / 1874. Level 4: 429 / 982 / 1874. |
     | Chat-open payload | Turn 0: 22.0 KB. Turns 100 to 1000: 30.7–30.9 KB, flat in the earlier run; 31.7 KB (31,730 bytes) at turn 1000 on the final release build. |
     | Main-process assembly, 1,000-message chat | Live host, final release build, 17 October 2026 11:25Z: extension on 122 ms median (p95 131), off 99 ms (p95 103), re-enabled 124 ms. Overhead: +23 ms median (+22 to +23 ms in the earlier runs at 09:33Z, 10:30Z and 11:02Z). |

     The 1k-turn pipeline build (1,000 turns through the runtime) fell from 36 s to 14 s once the fold memo landed; the 5k build took 956 s.

     Release gates on the final release build: the full test suite passed three times at 892 pass / 2 skip / 0 fail, `tsc` was clean, a 2,000 × 60 property run passed (14 pass / 0 fail, 335.0 s), and the dist scan was clean.
6. **Published types** (the host pins 0.6.49; 0.6.50 adds only `ctx.client`): `registerDomDecorator`, `ctx.ui.geometry`, float-widget `setFullscreen`/`persistGeometry`, `entries.setExtension`, `inline_available`, `council.getSettings`, `backendProcesses` (spawn, messaging, heartbeat), `rpcPool`, the range slider.
7. **UI.** Preact plus host components; the drawer at 326 px; the map widget; chips; the Money and Cast panels at 390 px.

## 19. Risks

| Risk | Mitigation |
|---|---|
| Scope (Warp's larger version was cut back) | Six concepts; uniform representation; packs with level contracts; schema-driven editors; boundary lint; gates first; per-block checks. |
| Prompt bloat | Compact renderers; the section budget, with Outcome never evicted; the inspector. User lore follows native World Info and its budget (§6). |
| Latency | Deterministic plan first; no model call in the World Info interceptor; tie-zone-only NPC calls; beats by default; budgets with fallbacks; the call meter. |
| Ledger divergence | Concrete events; fold order; journaled markers and `seq`s; path tags (P1); one in-flight window per turn (P2); rebased views that never rewrite records; Keep re-validation; tombstones; chain snapshot; fingerprints; generation counter; single writer; recovery; the executable ledger property suite with a reference fold (§14). |
| Coexistence (metadata, other interceptors) | Documented caveats; G2 follow-up. |
| Host-wide worker cost | Disclosure; measured; G3 follow-up. |
| Worker or child stall | Fail-closed engine slots; deterministic-unit bounds; backlog; separate lanes; heartbeat chunking. |
| Decision-provider failures (6 of 53 `decisions.evaluate` calls failed in one test window; the host never retries) | D10: the helper, then engine-only; per-step fallbacks (§5.3). |
| Secret leakage | Visibility; public-only `knows` extraction; prompts that list only what the POV may know; predicate-only secret stages; label lint; batching rule; previews never recorded; player-worded drop lines (§7). |
| Imported or model-supplied text forming a prompt macro | Every inserted value is neutralized (§6.3); section templates hold only `{{lines}}`; authored lore keeps its macros and an import lists them for review. |
| Hostile or malformed data ids and files | Validated ids and keys, own-key lookups, settings conformed to a schema, damaged stored files moved aside and replaced by fresh ones or the defaults (§3, §4). |
| A double tap or a concurrent request | Chip actions and reads run under a per-(user, chat) lock and re-check inside it (§11). |
| Authoring burden | Import from lore; data tables; lazy materialization; templates; schema-driven editors. |
| Payload growth | Compact records; period closes; overflow chunks; view-only materialization; fold snapshots; G9. |
| Timelapse cost | Deterministic unit cap; slot-bounded segments that always advance; heartbeat chunks; utility-only NPC choices; no partial apply. |
| Worlds not portable (D2) | `lre-world-v1` plus lore-book export. |

## 20. Deviations from the original principles and plan

**Principles that had to bend.** My starting principles assumed the engine could be the authority over the chat. An extension cannot be the host, so three of them changed:
1. **Authority.** LumiRPEngine is a namespaced proposal layer with a versioned export, not the owner of the chat.
2. **Canonical plane.** The ledger rides on message metadata; the shadow journal compensates for the host's weaknesses there (§4.3).
3. **Branching.** Re-narrate versus Re-run is re-render versus re-execute. A chat branch is "branch world state".

**What the build changed from the plan.** The sections above already describe the shipped behavior; this table lists where it differs from what I first wrote.

| Planned | Built | Why |
|---|---|---|
| Turn-critical simulation in a child *turn lane* (D9) | In the backend process, inside the context handler, bounded by the same unit caps; the child lane stays for Playtest, Check world, imports and Build with AI (§9.6) | A segment took 38 ms on a child process and 2.5 ms in process |
| Re-narrate always copies its source (P3) | It falls back to a Re-run when the source cannot be reproduced (§4.3) | P3 cannot hold without the source's prefix |
| A `seq` is never reused (L9) | A Re-narrate copy keeps its source's `seq`; L9 reads "never names two different entries" | P3 and L9 conflicted as written |
| An undo cascades | An undo that later on-path events depend on is refused (§11) | Keeps L7 |
| An inspector history kept for diagnostics | The last 10 runs per chat with the delivery badges, stored with the chat (§6.5) | Bounded, and a restart keeps it |
| World document without a currency | Adds `currency`; Build drafts with Commit and Discard (§4.1) | Authoring needed them |
| Import: accept, edit or reject each proposal | Accept or reject; edit afterwards in the editors (§9.7) | Bounded like extraction |
| Data tables: worlds can replace them with another region's | The table editor edits a table; replacement is not built (§9.7) | Not on the critical path |
| World lore without a world-document field | `WorldDoc.lore` and an editor collection, kept in the world and not delivered for now (§4.2) | The starter worlds carry lore |
| Models select lore in the World Info interceptor (D13), with pins (D19), adoption and suppression (D11) | Retired: lore handling is off, user books follow native World Info, and the interceptor delivers only the engine's sections (§6) | A lore lookup of the engine's own will replace World Info selection |
| Decline after the prose: other method / remove / accept | Pay another way retries savings → card → checking → cash; Remove and Accept reword the next Outcome note (§9.5) | "Accept" reads as accepting the decline |
| "Not an action?" undoes an interpreted Speed through | Only interpreted action resolutions get the chip (§11) | A timelapse's events are clock output |
| A confirm chip for every confirm-mode proposal | Only proposals that would validate now get Apply (§11) | Apply always failed for unpriced items |
| Prompted steps may use host macros with `commit:false` | Engine placeholders only (§5.2) | Helper calls skip prompt assembly |
| Where a step's output goes was unspecified | §5.2 | Corrections and suggestions stay under the player's control |
| Dynamic values never contain `{{` or `}}` | Every brace, escape sentinel and shorthand is neutralized (§6.3) | Breaking only `{{` pairs left runnable forms |
| A rebased view drops a failed event | Events may be grouped, and a group is kept or dropped whole; packs may add guards (§4.3) | A dropped payment left its history line and the bought item |
| `interpret` maps typed text to the world's actions | The catalog always includes "Let time pass"; up to 24 hours runs as the turn's timelapse (§9.2) | A cap keeps a misread from skipping days |
| Import fills gaps from tables "marked assumed" | `sources` and `assumed` fields, `FieldDef.table` (§9.7) | The plan named no fields |
| One option per palette target | A second step for two-target and numeric actions (§12) | Two-ref actions had no way to pick their second target |
| An in-memory fold cache meets the 50 ms gate | Persisted fold snapshots (§4.3) | A cold fold at 1k turns took 158 ms |
| The D32 preset lint reads the active preset | It reads a dry run of the open chat (§13) | Spindle has no read API for the active preset setting |
| Action tick of 30 seconds | 1 minute (engine time is whole minutes) (§9.2) | |
| A command palette (D12) | Not built; the input bar's palette and the Calendar panel cover Timelapse and Pause (§11) | Not on the critical path |

**Known limits of the engine.** There is no death state and no dormant-quest field. A starter world models a death with one-day `term` blocks and `set` effects, and a quest that waits for its trigger with a bare start stage, which the quest log hides until it moves on. Rules fire at slot ticks, so a dead character reads as idle in their own room until the next slot tick.

## 21. Open items

| # | Item | Behavior until resolved |
|---|---|---|
| R4 | **The `characters` permission**, which would let the engine resolve outlets inside character-card fields (§4.2). | It is not requested; those entries stay "unverified", and the engine confirms delivery with a dry-run assembly search instead. |
| G1–G9 | The upstream proposals (§16). | The extension ships with the caveats documented. |
| — | Not built: command-palette commands, replacing a data table with another region's, a per-proposal edit step in Import from lore, agenda and secret-track objectives in the starter worlds (they carry narrative to-dos only). | Documented in the user guide where a user would look for them. |
| D20 | The license. | None yet; all rights reserved. |

## 22. Design history and accepted residual risks

The design went through several rounds of independent review: paper reviews of the plan and of the host integration, a verification pass on the fixes, and adversarial reviews of the built extension, each followed by fixes that are folded into the sections above. The paper rounds kept finding problems in the ledger, so I stopped relying on them and made the ledger gate an executable property suite (§14): a reference fold, a fake host that replays the host's recorded event orders, randomized operation sequences and named invariants. An independent adversarial review at the end of the build remains part of the release process.

### Accepted residual risks
1. If the worker stalls, the world's sections are missing from that turn (flagged).
2. Rare plan interleaving falls back to the head render.
3. The host-wide worker cost remains until G3.
4. Cross-extension metadata clobbering remains until G2.
5. Activation is confirmed, not delivery (deliverability is resolved where possible; otherwise "unverified").
6. Retired with lore handling: the engine no longer judges user entries, so a card entry forced by another interceptor no longer matters to it.
7. A non-head Continue, a Continue on a message without a record, a stopped Continue and a Continue whose prefix the host re-rendered are accepted unread, like any assistant edit: the world stays as simulated until Re-read edit (Retry read for a stopped head Continue), so the text and the state can disagree until then.
8. Detail first opened during a turn's in-flight window (while it streams or during its post pass) shows "pending" until the window closes; writes made then land after the turn.
9. Before the reply, a Continue renders the head's state, since its target is known only at `GENERATION_ENDED` (until G1).
10. Entries made on another branch stay stored but inert; the Keep report lists them, and they apply again only when that branch is active. A Continue made on another branch leaves its text in the message, unsimulated on this one. Deleting a message drops its inert markers (journaled).
11. A foreign extension's metadata write on a reply that is still streaming reads as the reply's save, opening its P4 window early; a player edit to that turn's own user message after it would then be accepted as the host's re-render.
12. Extraction quality is a floor measured on a weak model (§9.4); only time, location and condition changes start `auto`. Learning on the player's own connection and the per-type pin in Settings are the safeguard.
13. Authored lore keeps its macros, as in native World Info; the import review lists them but does not block them.
14. Keys aren't linked to the vehicles they open, so handing over keys with a lend shows its own confirm chip; a future `opens` relation would fold it in. (A narrated give of the thing lent, or of something inside it such as a lent truck's glovebox, is folded into the loan and offers no chip.)
