# LumiRPEngine architecture

This is the contract between the modules. Behavior is specified in [DESIGN.md](DESIGN.md); section numbers below that read `DESIGN §…` are its sections. This file fixes module boundaries, shared types, the protocol, the registries and the test layout. The TypeScript contract files listed in each section are normative. When this text and a contract file disagree, the file wins and this text is fixed.

## 1. Contract files

| File | Contents |
|---|---|
| `src/shared/json.ts` | `JsonValue`, `JsonObject`, the one `isRecord` guard |
| `src/shared/ids.ts` | Id aliases; domains, levels, the three detail bands, interrupt classes, bound modes |
| `src/shared/tiers.ts` | World tiers over the detail bands: band labels, default tiers, a tier's band, the spawn and lead tiers, tier agent defaults |
| `src/shared/world.ts` | The world document `lre-world-v1`, and the map document `lre-map-v1` (`MapDoc`) |
| `src/shared/lre-map-v1.schema.json` | The published JSON Schema of a map, read by Build's editor, the Describe a map prompt and outside tools |
| `schemas/lre-world-v1.schema.json` | The published JSON Schema of a whole world document, written by hand from `shared/world.ts`; its `maps` refer to the map schema by `$id`. `test/shared/world-schema.test.ts` holds it to the starters and the preview world |
| `src/shared/schema-check.ts` | A small JSON Schema reader (the keywords the published schemas use, and `$ref` to another schema by its `$id`) with plain-language problems at JSON paths |
| `src/shared/maps.ts` | Maps: the schema check, the compiler (`compileMaps`: a map's places, grid and routes, marked as its own), the map lint, the JSON layout and the templates |
| `src/shared/tables.ts` | Pinned data tables and the build-time mapping |
| `src/shared/ledger.ts` | Events, `Rec`, `post` entries, markers, `MessageLedger`, `ChatRun`, the journal, fold outputs |
| `src/shared/state-view.ts` | The state view the frontend renders |
| `src/shared/settings.ts` | User settings, the D4 cold-start extraction modes and per-connection learning (`ExtractionLearning`, `userStorage/extraction-learning.json`) |
| `src/shared/protocol.ts` | Frontend ↔ backend messages |
| `src/shared/studio-bridge.ts` | The Studio bridge ([STUDIO.md](STUDIO.md#the-studio-bridge)): endpoint names, payloads, the offer and the window events LumiRPEngine Studio shares |
| `src/engine/state.ts` | The folded `WorldState` |
| `src/engine/registry.ts` | `PackDef`, `CoreRegistry` and the pure contexts packs receive |
| `src/engine/steps.ts` | `StepPort` and the model-step shapes |
| `src/frontend/registry.ts` | `UiPackDef`, `UiRegistry`, panel, editor, chip and proposal-preview props |
| `src/backend/host.ts` | `HostPort`, the only door to Lumiverse, with the host's observed event payloads |
| `src/spindle-augment.ts` | Local types where the host differs from `lumiverse-spindle-types` 0.6.49 |
| `src/studio-api.ts` | The studio seam ([STUDIO.md](STUDIO.md)) |

Modules adapted from Warp (D1; credited in `NOTICE`):

| File | API |
|---|---|
| `src/shared/hash.ts` | `hashParts`, `hashWords`, `hash32`, `hashJson`, `hashBytes`, `encodeUtf8` |
| `src/engine/rng.ts` | `createRng(seed)` → `Rng { next, int, pick, weighted, fork }` |
| `src/engine/expr.ts` | `compile`, `runProgram`, `evaluate`, `evalNumber`, `evalBool`, `identifiers`, `createEnv`, limits |
| `src/engine/dice.ts` | `parseDice`, `rollDice`, `diceDistribution`, `probEqual`, `probAtLeast`, `probAtMost` |
| `src/engine/decide.ts` | `Question`, `Answer`, `normalize`, `sample`, `mostLikely`, `sampleNoul`, `noulConfidence`, `scoreIndex` |

## 2. Module map and boundaries

| Zone | Path | May import | Packages |
|---|---|---|---|
| shared | `src/shared/*` | shared | none |
| engine (pure) | `src/engine/*` | engine, shared | none |
| pack core (pure) | `src/packs/<pack>/core/*` | engine, shared, its own core; another pack's `core/index.ts` with `import type` only | none |
| pack ui | `src/packs/<pack>/ui/*` | shared, its own core and ui, frontend, `spindle-augment` (type) | `preact`, `preact/hooks` |
| backend | `src/backend/*` | engine, shared, pack cores, `spindle-augment` (type) | `lumiverse-spindle-types` (type) |
| worker | `src/worker/*` | engine, shared, pack cores | `lumiverse-spindle-types` (type) |
| frontend | `src/frontend/*` | shared, pack uis, frontend, `spindle-augment` (type) | `preact`, `preact/hooks`, `lumiverse-spindle-types` (type) |
| studio | `src/studio-api.ts` | engine, shared, pack cores | none |
| entries | `src/backend.ts`, `src/frontend.ts`, `src/worker/*-lane.ts` | their zone, shared | as their zone |

Rules, all enforced by `test/boundaries.test.ts`:
- **Pure zones** (shared, engine, pack cores, studio) import no packages and no `node:`/`bun:` modules. Randomness comes only from an `Rng` passed in; time only from game minutes.
- **The `spindle` global** is touched only in `src/backend.ts` and `src/backend/spindle-host.ts`. Everything else in the backend talks to `HostPort`.
- **Packs** never import another pack's internals. Cross-pack behavior goes through registered services and queries (§5).
- **Nothing** in `src/` imports `data-src/` (the raw table sources) or any local reference copy.
- The frontend never computes world state. It renders `StateView` and sends protocol requests.

Engine layout (pure):
- `engine/ledger/*`: path hashing (`path.ts`), chain types (`chain.ts`), the journal state machine (`journal.ts`), the reference fold (`reference.ts`) and the optimized fold (`fold.ts`, with cache, overlay, snapshots and re-convergence). The two folds share only `engine/events.ts` (core event validators and reducers) and pack-registered event types.
- `engine/events.ts`: validators and reducers for the core events (`set`, `add`, `post`, `link`, `unlink`, `spawn`, `stage`, `clock`, `materialize`, `timelapse`). The registry composes `engine/seen.ts` into the ones that move someone (a `place` set, an `in` link or unlink, a spawn), so their apply also keeps the POV's observations (`space.seen`, DESIGN §7) in both folds.
- `engine/registry.ts`, `engine/registry-impl.ts`: the registry contract, and the builder of a frozen registry from `PackDef`s.
- `engine/{resolve,effects,rules,tracks,schedules,simulate,time,time-limits,realism,visibility,bounds,materialize,beats,plan-day,turn,typed-intent,narration-channels,player-events,authoring,world-lint}.ts`: action resolution, effects, rules, tracks, schedules, stepping through game time, time controls and their hard maxima, realism levels, knowledge and visibility, bounds, lazy materialization, the deterministic outline, the day planner, the turn pipeline, Playtest's typed-intent matching, the narration channels, player-facing event lines, authoring tools and structural lint.
- `engine/adjudication.ts`: the adjudication policy (DESIGN §11) as `resolve` and the palette apply it: the policy in force (`policyOf`), a check's success and chance, the verdict before anything is rolled (`verdictOf`: a refused retry, too hard, a sure thing, the timing, the authority), the judged approach's shift, a hybrid close call, the story's sampled outcome and the policy's lint. `shared/adjudication.ts` holds the presets and the reader (`readAdjudication`) that worlds, settings and markers share.
- `engine/edits.ts`: ✎ fixes and GM edits (`resolveEdit`, `parseEditOps`): each operation becomes the events its effect records, with literal values, checked against field definitions (type, enum values, min and max, a pool's evaluated max), relation types and placement, all or none; despawn, restore and the reserved `gone` field.
- `engine/life.ts`: life states (DESIGN §8): an entity's state and whether it acts (`lifeOf`, `acts`), who knows it (`lifeKnownTo`, `povLife`, `lifeAwareness`), the applies of `engine.life` and `engine.told`, the composition that teaches whoever a move leaves with a subject (`knowing`), the `life` effect and the `life` narration channel.
- `engine/gm-view.ts`: the GM view's world part (`buildGmWorld`): every entity, removed and spawned ones included, with its fields, relations, placement, levels and designed sheet; places; tracks with their truths; relation types.
- `engine/lore.ts`: the lore search RPEngine's helpers read (DESIGN §5.4): `loreSearch`, `loreGet`, `loreList` and `readableLore`, ranked deterministically over the folded state and the world, with snippets cut by the caller's token counter and visibility enforced inside (a secret's audience and gate, `known_by`, the GM); `visibility.ts` adds `loreGateReader` and `unrevealedSecrets`, the leak check's list of unrevealed truths and gated secret lore.
- `engine/scope.ts`: the formula environment (bindings, `pov`, `here`, stages, levels, the clock, entities and places by id), the engine's own formula functions with their parameters (`BUILTIN_FUNCTIONS`), `formulaFunctions` (every function a formula may call, the expression editor's list) and the evaluation of effect arguments.
- `engine/checks.ts`, `engine/ruleset.ts`, `engine/ruleset-lint.ts`: the one check mechanism (a check made ready from the state before the roll, its exact odds, the roll and `roll.*`); progression and the designed sheet (`buildEntitySheet`); the lint of the ruleset primitives (`roll()` outside effect arguments, table reads, checks, pools, progressions and the sheet).
- `shared/profiles/`: the ruleset profiles as data (`modern.ts`, `classic.ts`, `fifth.ts`, `custom.ts`, built from `parts.ts`) and `planProfile` / `applyProfile`, which the backend (`lre.editor profile`) and Build's picker share, with the packs' kinds passed in as data.
- `engine/selector.ts`, `engine/relations.ts`: selectors and the taxonomy reads behind them; relation integrity (kinds, cardinality, symmetric and inverse pairs kept two-sided) and its lint.
- `engine/calendar.ts`: calendar arithmetic over game minutes: dates, day parts, holidays, time zones and the next time of day.
- `engine/working.ts`: the validated working state every step that makes events appends through, so each event is validated against the state it will see on a re-fold.
- `engine/world-state.ts`: the state a chat starts from (`initialState`): relations completed two-sided, things laid in their cells, the POV on its cell.
- `engine/upgrade.ts`, `engine/touched.ts`: the Upgrade merge, a deterministic fold step of the `migrate` marker with the owner's picks; and the touched record of what play wrote, which sets each change's default pick.
- `engine/engine-pack.ts`: the built-in `engine` pack: bookkeeping events (rule firings, signals, notes, rolled checks, adjudged attempts, observations), GM edits of tier, agent flag and levels, the `knows` and `spawn` channels and the taxonomy formulas.
- `engine/pack-kit.ts`: the small pure readers pack cores share: typed values from JSON fields and table rows, optional services, labels.

Backend layout:
- `backend/spindle-host.ts`: `HostPort` over `spindle`.
- `backend/ledger-io.ts`: wires host events and the context handler to the ledger; journal file I/O, per-message write queues (read-merge-write of the whole `spindle_metadata` bag), re-assert, restart recovery.
- `backend/runtime.ts`: the composition root; turn hooks (pre, plan and post phases), the World Info interceptor (engine slots only), chip and slot handling.
- `backend/turn-model.ts`, `backend/turn-steps.ts`: the ledger's `TurnModel` over the simulation pipeline, and the model steps around a turn.
- `backend/book.ts`: the engine-managed lore book: slot entries, and removal of lore copies an earlier build synced into it.
- `backend/steps.ts`: `StepPort` over `HostPort.models`: helper JSON calls with the step's lore and its lookup rounds, decisions with their lookup pre-pass, and the call meter (kept per user in `call-meter.json`, lookups counted apart).
- `backend/worlds.ts`, `backend/settings-store.ts`: world storage and revisions; settings, presets and extraction learning.
- `backend/dispatch.ts`, `backend/view.ts`, `backend/gm.ts`, `backend/push.ts`, `backend/chips.ts`: request dispatch, the state view, the GM view (built per `lre.gm` request, never pushed), state push, stored chips.
- `backend/jobs.ts`, `backend/proposals.ts`, `backend/map-job.ts`, `src/worker/background-lane.ts`: background jobs (kept per user in `jobs.json`; a job stored as running that the process isn't running reads as interrupted) and the child lane; Import and Refine proposals; Describe a map (the prompt, the answer's checks and the repair call).
- `shared/lore.ts`, `engine/lore-lint.ts`, `backend/lore.ts`, `backend/lore-index.ts`: world lore (DESIGN §4.2): sources, the steps that never read a secret (`PROSE_STEPS`), the leak check's phrases, the lookup table's terms, additions and suggestions; its lint; book drift and Save to lore; the indexing jobs' prompt, reader and checks.
- `backend/lore-steps.ts`: a step run's lore (DESIGN §5.4): `StepLore` (the prefetch, lookup rounds as tools or the need form, the trace), the phase's `LookupBudget` (held, spent or released per round, with a time reserve), and `ToolSupport` (connections seen refusing tools, kept in `lore-tools.json`).
- `backend/preset-lint.ts`, `backend/plan-notes.ts`: the preset lint; planned-turn lines kept by seed.
- `backend/outcome-notes.ts`, `backend/inspector-log.ts`: the next turn's Outcome notes and the inspector's history with its delivery badges and each step's lore traces, per chat.
- `backend/stored-json.ts`: reading the extension's own JSON files; a damaged one is set aside as `<path>.corrupt-<epoch ms>` with a warning, and the caller starts fresh.
- `backend/main.ts`: starts the backend on the real host: every pack, the pipeline, the spindle adapter, the runtime, the dispatcher and the background lane's route.
- `backend/start-markers.ts`: a new chat's starting markers (the revision, every domain level and band cap, every time control and the adjudication policy), written with the first record that holds events.
- `backend/upgrade-preview.ts`: the Upgrade preview (`lre.marker` with `preview`): the plan the fold would apply, entity by entity, each change with its default pick and why, and `secret` on the rows, changes and track lines that would give a secret away, for Settings' spoiler gate.
- `backend/chat-prefs.ts`: the player's choices for how a chat looks (`prefs.json`: the map display), kept beside the chat and out of its ledger.
- `backend/studio.ts`: the Studio bridge's engine side: per-user shared RPC endpoints only LumiRPEngine Studio may read (the worlds, each world's head and revisions, the world chats' summaries from what their views were pushed), the read of the Studio's offer, and the offers installed (`studio/installed.json`).

Shared helpers (pure, beside the contract files):
- `shared/grid.ts`: cells, A* with a hard cap, walking minutes, line of sight, and where someone stands on a grid.
- `shared/classes.ts`: lookups over a world's classification facets and their value trees.
- `shared/money.ts`: money as people type it in a world's currency (`parseMoneyInput`, `formatMoneyInput`), read by `frontend/money-input.tsx`, the one input every typed amount goes through.
- `shared/macros.ts`: the host's macro hazards, and neutralizing everything the engine inserts.
- `shared/steps.ts`: the step vocabulary: signals, template placeholders and the outputs each purpose may declare.

Frontend layout:
- `frontend/setup.tsx`, `frontend/app.ts`, `frontend/store.ts`: the entry (protocol client, UI registry, drawer, HUD, chips, palette, overlays, the `lre-state-v1` announcement), the app object every Preact tree shares, and the small observable store for UI state.
- `frontend/protocol-client.ts`, `frontend/delta.ts`, `frontend/requests.ts`, `frontend/decode.ts`: requests and the state view (a snapshot, then copy-on-write deltas, resync on a gap), one request per interaction, and defensive readers for panel view models.
- `frontend/ui-registry.ts`, `frontend/packs.ts`: the `UiRegistry` implementation, and every UI pack in registration order.
- `frontend/drawer.tsx` and its sections: `frontend/play/*` (the running chat: Scene, Journal with Save to lore, Context, and the GM view with its editor), `frontend/settings/*` (model use and steps, realism, checks, Pins and upgrade with the Upgrade preview) and `frontend/build/*` (worlds, the form descriptors and the schema-driven form, the draft and the forms held over its changes, Problems, jobs, and the editors for expressions, effect arguments, selectors, classifications, tiers, data tables, lore, the lookup table, and the ruleset with the Sheet Designer).
- `frontend/hud.tsx`, `frontend/hud-float.ts`, `frontend/fix-editor.tsx`, `frontend/money-input.tsx`: the HUD pill and its geometry across layouts, the ✎ fix editor, and the money input.
- `frontend/chips.tsx`, `frontend/palette.tsx`, `frontend/overlays.tsx`, `frontend/overlay-controller.ts`: chips under messages and their actions (one that needs a value asks for it first, through the money input for an amount), the palette and its Timelapse sheet, and the float overlays with how they open on a narrow viewport.
- `frontend/time-controls.tsx`, `frontend/adjudication-form.tsx`: the time controls (Settings → Time for new chats, Play → Calendar for this one) and how checks are decided (Build's ruleset and Settings → Checks), each one editor for two places.
- `frontend/components.tsx`, `frontend/styles.ts`, `frontend/format.ts`, `frontend/layout.ts`, `frontend/map-math.ts`, `frontend/host.ts`: shared UI atoms over the host's components, the one stylesheet, display formatting, responsive layout rules, pan and zoom math, and the host capabilities the UI uses.

Pack layout: every pack has `core/index.ts` (its `PackDef`), and a pack with a Play panel has `ui/index.ts` (its `UiPackDef`) and `ui/panel.tsx`. Calendar, economy, gear and vehicles build their panel's view model in `core/view.ts`; the others build it in `core/index.ts`. Beyond that: economy's `core/model.ts` (accounts, balances, wealth bands, regions and pricing), `core/items.ts` (what a purchase names) and `ui/config.tsx` (the narrated-price cap); gear's `core/model.ts` (containment, loads, kits, use grants); calendar's `ui/schedule-editor.tsx` (the schedule widget); story's `ui/track-editor.tsx` (the track graph); and `packs/starters/index.ts`, the starter worlds.

Space pack layout (`packs/space`): `core/travel.ts` (routes and A*), `core/map-scope.ts` (one map scope as drawn: a place's children at their cells or node positions, the routes between them, its grid; pure, shared by Play and Build), `core/view.ts` (the `space.map` view: every scope the POV can open, and travel options), `core/positions.ts` (where people and things stand on grids: arriving, stepping, things laid in cells and picked up, reach, stepping into a zone); `ui/view.ts` (the map view as the UI decodes it), `ui/map-draw.ts` (painting a scope), `ui/labels.ts` (where each place's name goes), `ui/map.tsx` (the map stage, breadcrumbs and the place card), `ui/map-editor.tsx` and `ui/map-preview.tsx` (Build's map editor and previews), `ui/editors.tsx` (the grid and place editors); `frontend/json-text.ts` reads JSON text with the line of each value, for the map editor.

## 3. Shared types

### 3.1 World document (`lre-world-v1`, `shared/world.ts`)

One JSON document per revision; the revision id is its `hashJson`. Collections are keyed by id: `packs` (each `{version, config}`), `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `lore`, `classifications`, `tiers`. Parts: `calendar`, `realism`, `time`, `pins`, `start`, `currency`, `loreIndex` (the lore lookup table: `terms` and `topics`), and the optional `ruleset` and `mapSettings`. Scalars: `format`, `id`, `name`, `engineVersion`, `pov`, `seedMode`, `lenientPricing`, the optional `spawnTier` and `spawnCap`, and `suppressed`. `schemas/lre-world-v1.schema.json` describes every part; the studio's `validate` checks the collections and parts before anything reads them.

- **Maps** (`lre-map-v1`) are the source of truth for the places, grids and routes they draw. `migrateWorld` compiles them whenever a document is read (`shared/maps.ts`), clearing what an earlier compile made (items marked `map`, and a scope's link to a grid a map made) and making it again, so the compiled items stored in a revision or an export always match their maps. Build's editors show them read-only and `lre.editor` refuses writes to them.
- **Formulas** are expression-language strings (`Expr`); **dice** are notation strings.
- **Kinds** have single inheritance and typed fields (`FieldDef`: type, default, min/max, enum values, ref kind, list element, bands, derived formula, locked, bound, visibility, and the level contract's domain and live level).
- **Entities** carry field values, relation instances (with `until` for use grants), a tier (one of the world's `tiers`, each mapped to a detail band whose caps apply), optional per-domain level overrides, the LOD1 `agent` flag (unset: the tier's default) and an optional Lumiverse character id.
- **Pins** fix generator versions and table revisions (DESIGN §9.2). The document holds copies of its tables, so a running chat sees new data only through a `migrate` marker.
- **The ruleset** (`ruleset`, optional) holds progressions, the sheet layout, level floors, the adjudication policy (`adjudication`: a preset and its values; DESIGN §11), combat and `profile`, the profile it last started from. Actions, places and tracks take `adjudicate` (marked for the `marked` timing), checks `pass` and `auto`, and a text param `table`, naming a row of that data table.
- Levels gate processes, rendering and extraction, never the shape (D18).

Storage (DESIGN §4.1): `userStorage/worlds/<worldId>/index.json` (`WorldIndex`) and `rev/<revision>.json`, written temp-then-move. Settings live in `userStorage/settings.json` (`UserSettings`).

Other files the backend keeps, each written temp-then-move and read through `readStoredJson`:

| File | Holds |
|---|---|
| `userStorage/jobs.json` | `{v: 1, jobs: JobSummary[]}`: running jobs and the newest 8 ended ones, oldest first, with input (only the fields the kind reads, bounded) and result (an import's proposals after every chunk) |
| `userStorage/call-meter.json` | `{v: 1, turns, current}`: the last 200 closed turn tallies and the current one |
| `userStorage/lore-tools.json` | `{v: 1, refused: {[connectionId]: {at, reason}}}`: connections seen refusing the lore tools, whose `auto` lookups use the need form |
| `userStorage/runs/<chatId>/chips.json` | Stored chips until acted on or lapsed |
| `userStorage/runs/<chatId>/plans.json` | Planned-turn lines by seed (the newest 128), for Re-narrate |
| `userStorage/runs/<chatId>/outcome-notes.json` | `OutcomeNote[]`: notes for the next turn's Outcome slot, dropped once a later message has committed and another follows |
| `userStorage/runs/<chatId>/prefs.json` | `{v: 1, mapDisplay?}`: the player's choices for the chat that aren't part of its world, such as the map's display mode (`lre.map`) |
| `userStorage/runs/<chatId>/inspector.json` | `{v: 2, records, delivery}`: the last 10 interceptor runs and the last delivery check by slot, read when the chat is first viewed; a `v: 1` history is read with its lore traces' query text dropped, a trace that lists a secret entry isn't read at all, and an `npc.choose` trace is read without its lookups' text and its entries' titles |
| `userStorage/worlds/<worldId>/draft.json` | `{base, doc, version}`: the Build editors' working copy, the revision it started from and its version. While no draft is stored, the index's `draftVersion` is the working copy's version: a discard or a commit records it before the file goes, a head moved under no draft counts one, and a new draft starts one above it, so a version never names two states of a world. A stored draft at or below that count was dropped (its file couldn't be removed) and reads as gone; one stored before versions reads as one above it. `lre.editor get` resumes it after a reload or on a second device. Every write of one world waits for the one before it (DESIGN §23) |
| `userStorage/worlds/<worldId>/history.json` | `{v: 1, notes}`: one `{revision, at, source, note?}` for each time a revision became head, oldest first, returned by `lre.world get` as `history`; a world made before it was kept has none until its next head |
| `userStorage/runs/<chatId>/snapshots.json` | The chat's fold snapshots, the newest 6, so a cold fold starts from the nearest one rather than the chat's start (L42); a snapshot made by another build never applies |

### 3.2 Ledger (`shared/ledger.ts`)

| Store | Shape |
|---|---|
| Chat metadata `lumi_rp_engine` | `ChatRun {v, worldId, revision, runSeed, startedAt}` |
| Assistant message `spindle_metadata.lumi_rp_engine` | `MessageLedger {v, swipes: {[index]: Rec}, markers}` |
| `userStorage/runs/<chatId>/journal.json` | `Journal`: `seq`, chain snapshot, latest ledger per message, pauses, tombstones, held writes, refused writes (`refused`: the latest 8 held writes that didn't validate when their windows closed, with the reason, until dismissed), open windows, pending turns, `started` |

- **Events** are concrete. Assignment events (`set`) carry final values; accumulator events (`add`, `post`) carry deltas. Pack events are `<packId>.<name>` with a JSON body.
- **`Rec`** follows DESIGN §4.3. `accepted` is the identity of content accepted without being read: an assistant edit or an unread Continue. `dropped` lists the entries a swipe didn't carry over, or a Re-read dropped, each with its reason; the folds report each as a `not_carried` Journal note. Both are outside every hash, so accepting text or dropping an entry never moves a path. `intents` is always empty: the reading of a turn's text is kept in memory by the backend's turn bridge, keyed by the text.
- **`post` entries and markers** carry `seq` (chat-wide, from the journal counter) and `at` (P1). Starting markers have `at: null`. Marker bodies are `migrate{to}`, `resolve{domain, scope, to}`, `time{control, scope, to}` and `adjudicate{to}` (a whole policy), each checked by `validMarkerBody` on every path in.
- **The journal is authoritative.** Metadata is its mirror, flushed per message once no generation is in flight, and re-asserted after clobbering.

**Fold semantics** (DESIGN §4.3; both folds implement them):
1. Walk the chain in order, starting from the world revision's initial state. The parent path starts at `ROOT_PATH`.
2. A user message chains its content hash; for the turn's own user messages that is the pinned or re-rendered hash (P4).
3. For an assistant message's active swipe:
   - A marker or `post` entry is **live** when its `at` is null (starting markers), equals the current parent path, or equals its record's `path`. Every other entry is **inert** and is reported, never applied.
   - **No record:** apply the live markers by `seq`.
   - **Bare record** (`path` `""`: only an `accepted` identity or player entries, no turn): folds as plain; its entries are live only where made, never travelling with it.
   - **With a record:** apply the live markers with `seq ≤ markersApplied`, then `events`, then the live `post` entries and later live markers interleaved by `seq`.
   - **Rebased view:** when `rec.path ≠ parent path`, each event and entry is validated against the running state. A failure is dropped with a note unless `keep[parentPath]` converts it, in which case it applies without validation. Once the state equals the original state after that record, later records fold as stored.
   - **Content-edit pause:** a record after an unresolved pause folds nothing; its message is `paused`.
   - **Tombstoned** records fold nothing (a note says so). Every record carries the `seq` it was made at, so a tombstone never matches a new identical record; Discard also removes the records from the journal.
4. Chain the message: content hash (`swipeHash` for a record, else the text's hash), record hash and live marker hashes. `accepted` is never hashed.

**Classification** (pure, from the chain-snapshot diff; DESIGN §4.3, L4):

| Change on an earlier message | Class | Effect |
|---|---|---|
| Active swipe changed (navigate, add, delete) | swipe change | Later records become rebased views; no pause |
| Message removed | removal | Live markers move to the nearest earlier assistant message; later records become views |
| Content changed on a **user** message | content edit | Pause on Keep/Discard (L39) |
| Content changed on an **assistant** message, or a mismatch found when a swipe becomes active | assistant edit | `accepted` set (a bare record if none); nothing else changes (L38) |
| A turn's own user message re-rendered inside its window | host re-render | Accepted (P4, D35) |
| A Continue's own save | Continue save | Settled at the Continue's end |

While a chat is paused, new turns get no plan and commit `degraded` with no events, and user writes are refused with `paused` until Keep or Discard. A pause that arrives while a reply streams leaves that reply unread (`degraded`, plan kept). During a Continue, messages with a record are classified at its end (their paths chain `swipeHash`, so nothing moves meanwhile); a message without one is accepted at once as a bare record.

**Residual:** a foreign metadata write on a reply that is still streaming reads as its save (DESIGN §22 risk 11).

### 3.3 World state (`engine/state.ts`)

`WorldState` is plain JSON: clock, entities (fields, relations, levels), account posting totals (the trial balance sums to 0), track stages, folded realism and time controls, the adjudication policy an `adjudicate` marker set (absent in chats started before it existed), materialization pins, and pack slices, among them `space.seen`, the POV's own observations, and `engine.tries`, each action's latest attempt at a check for the retry rules (written by `engine.adjudged`). Folds compare states with `hashJson`.

### 3.4 Model steps (`engine/steps.ts`)

The engine asks and the backend's `StepPort` answers. Every call takes an `AbortSignal` and is never retried blindly.

Routing (D10):
- `interpret` → helper;
- `npc.choose` → Decision connection; on error, the helper, then engine-only;
- `judge` → helper (a decision only: the rating, a one-line reason and, under narrative authority, outcome odds); on the Decision route a score and a choice question;
- prompted steps (`extract`, `brief`, `outline`, …) → helper or the step's chosen connection.

Prompts and schemas stay model-agnostic (D31).

### 3.5 State view (`shared/state-view.ts`)

`StateView` holds:
- the chat, its world and revision (with `definitionsFrom` when an Upgrade left the chat's entity definitions on an older revision), and its status (`not_world`, `idle`, `in_flight`, `paused`);
- HUD, scene, chips, Journal notes, the Keep report, `pending` marks and the call meter;
- the palette (`PaletteView`: its entries, a fight's Combat heading and the Timelapse sheet), the controls Settings and Calendar edit for this chat (`ControlsView`: realism, time controls and the adjudication policy in force), the pack versions in play, and the world's currency;
- `panels`: pack view models keyed `<packId>.<panel>`, each built by the pack core's `PanelViewDef` for the chat's `ViewPrefs` (the map's display, from `prefs.json`), so a display's hidden cells never leave the backend. The GM view is not among them: `lre.gm` builds it on request (`GmView`), everyone else's money included, from the economy pack's `economy.people_money` query.

Player-facing content is already filtered to the POV's knowledge; the GM view's data is fetched separately, and only once its spoiler gate is open.

## 4. Frontend ↔ backend protocol (`shared/protocol.ts`)

Transport: `ctx.sendToBackend` / `spindle.sendToFrontend(payload, userId, {frontendSessionId})`. Every message is `{lre: 1, type, …}`. Requests carry a frontend-chosen `reqId` and get exactly one `lre.result` (with `request` naming the type) or `lre.error`.

| Request | Payload | Result body |
|---|---|---|
| `lre.hello` | `chatId \| null`, `presetId?`, `client?: {name, version}` (an outside client, DESIGN §23) | `{accepted, agentApi}`, then a snapshot when `chatId` is set |
| `lre.state.resync` | `chatId` | `{accepted}`, then a snapshot |
| `lre.action` | `chatId, action, params, source, text?` | `{messageId}` of the appended user message (with `intent`, `triggerGeneration`) |
| `lre.chip` | `chatId, chip, choice, payload?` | `{applied, pending}` |
| `lre.view.open` | `chatId, panel, entity` | `{materialized, pending}` |
| `lre.fix` | `chatId, entity, field, value` | `{pending}`; checked as a `set` against the field's definition (locked fields refused), stored as one `fix` post entry |
| `lre.edit` | `chatId, ops`: 1–64 `EditOp`s (`set`, `add`, `link`, `unlink`, `move`, `put`, `adjust`, `stage`, `entity`, `classify`, `life`, `spawn`, `despawn`, `restore`) | `{pending}`; all or none, one `fix` post entry; locked fields writable |
| `lre.gm` | `chatId` | `GmView`, built from the head's state when asked; never part of a snapshot or delta |
| `lre.map` | `chatId`, then `display` (`knowledge` \| `fog`) \| `op: "walk", x, y` | `{display}`; stored in the chat's `prefs.json`, and the next snapshot's `space.map` panel is built for it. `walk`: `{walk: {minutes, disabled?}}`, Walk here to that cell of the grid the POV stands on, judged as the `step` action on the real ground |
| `lre.marker` | `chatId`, then `resolve{domain, scope, to}` \| `time{control, scope, to}` \| `adjudicate{to}` \| `migrate{to, merge?}`; `preview` writes nothing | `{pending}`; with `preview`: `{preview}`, whose `upgrade` lists a migrate's definition changes with their default picks |
| `lre.keep` | `chatId`, then `keep{messageId}` \| `discard{messageId}` \| `convert{messageId, parentPath, refs}` | `{pending}` |
| `lre.settings.get` / `.set` | `patch` (deep merge) | `{settings}` |
| `lre.editor` | `worldId, base, version?`, then `get` \| `discard` \| `put{collection, id, value}` \| `remove{collection, id}` \| `set{part, value}` \| `profile{profile, choices}` \| `patch{ops}` \| `restore{revision}` | `{draft, lint, base, stored, version}`: `base` is the revision the draft started from (sent back with the next write), `stored` whether a draft exists apart from the head, and `version` the working copy's version (the world's count while none is stored), never naming two states of the world; a write naming another `version` is refused with `conflict` and changes nothing. `get` returns the stored draft, or a fresh copy of the head, and ignores `base`; `discard` drops the draft; `set` refuses a part it doesn't know; `profile` applies a ruleset profile in one write, each conflict kept or taken by its path in `choices`; `patch` applies RFC 6902 operations to the whole draft, all or none, within the guards and budget of DESIGN §23; `put`, `set` and `patch` refuse a value nested past the depth cap, and an item the engine can't read as `validation`; `restore` makes the draft a copy of one of the world's revisions, its base still the head. A write that changes a table, a profile's included, gives it its content's revision and pins it. After every change the user's sessions get `lre.draft.changed {worldId, version, stored, base}` |
| `lre.world` | `list` \| `get` \| `create` \| `delete` \| `commit{note?, version?}` \| `import` \| `export` \| `lint` \| `attach` \| `upgrade{chatId, to, merge?}` \| `sheet{worldId, ruleset, entity?}` \| `templates` \| `chats{worldId?, chatId?}` | `{worlds?, world?, revision?, lint?, file?, history?, pending?, packKinds?, packRelations?, functions?, sheet?, templates?, chats?}`; `get` adds the world's `history` (from `history.json`), the packs' kinds and relation types and `functions`, every function a formula may call outside an effect argument (the expression editor's list); `commit` notes the new head in `history.json` (who: `build`, or `agent` for an outside client's session, and the `note`), and refuses a `version` the working copy has moved past and a draft begun on an earlier head; `upgrade` writes the `migrate` marker, with `merge` the owner's picks for the definition merge (DESIGN §4.3), and says `pending` when the chat is mid-turn; `sheet` is the Sheet Designer's preview, the draft with the unsaved ruleset read on the POV (or `entity`); `templates` lists the starters `create` takes; `chats` lists the chats of the user's worlds (or one world's, or one chat), each at the revision it plays now and whether that is behind the head, or with `revision: null` and the `reason` when its ledger can't be read |
| `lre.job` | `start{kind, worldId, input}` \| `cancel{jobId}` \| `list{worldId}` \| `dismiss{jobId}` | `{jobId}`; `list`: `{jobs}` (`JobSummary[]`, oldest first). Updates arrive as `lre.job.update {jobId, kind, status, progress, message?, result?}` |
| `lre.lore` | `drift{worldId, id?}` \| `save{chatId, text?}` | `drift`: `{drift}`, the draft's book-sourced entries whose book entry changed (with its text and hash now) or is gone; `save`: `{worldId, id}` of the lore entry saved to the draft of the chat's world |
| `lre.studio` | `offer` \| `install{offerId}` | `offer`: `{offer}`, LumiRPEngine Studio's offer as Build reviews it (counts, lint, macros, what blocks it), or `{offer: null, message}`; nothing is installed. `install`: `{installed, lint}`, the reviewed offer as a new world, or as the next revision of its world under the world's id, with its macros to review |
| `lre.ui` | `close_drawer` | `{done}`; the frontend has no API to close the drawer, so the backend asks the host (the map opening on a narrow viewport) |

**State push.** The backend keeps a push counter `rev` per (user, chat).
- On `hello`, `resync` and chat open it sends `lre.state.snapshot {chatId, rev, view}`.
- After a change it sends `lre.state.delta {chatId, base, rev, ops}`, where ops set or delete values at paths.
- A frontend whose `rev` ≠ `base` discards the delta and sends `lre.state.resync`.
- Pushes are coalesced per chat.

**Errors.** `lre.error {reqId | null, code, message, lint?}`. Codes:
- `bad_request`, `not_found`, `not_world_chat`;
- `conflict`: stale `base` revision;
- `paused`: Keep/Discard pending;
- `validation`: with `lint`;
- `forbidden`, `unavailable`, `internal`.

User writes made inside an in-flight window succeed with `pending: true` and land after the window (P2).

## 5. Registries (`engine/registry.ts`, `frontend/registry.ts`)

A pack is two modules:

```
src/packs/<pack>/core/index.ts   default export PackDef   (pure)
src/packs/<pack>/ui/index.ts     default export UiPackDef (Preact)
```

The engine calls a pack by name only through `optionalService`/`optionalQuery`, so it runs without it: the combat pack's `combat.spend` (what a combat action costs, from `engine/resolve`) and `combat.round` (a fight's turns around the POV's action, from `engine/turn`), and `combat.choices` (its `npc.choose` questions, from `backend/turn-steps`).

`PackDef {id, label, version, domain, requires, register(r: CoreRegistry)}`. Registrations:

| Method | Contributes |
|---|---|
| `kind`, `relation` | Schema |
| `event` | Event type: `validate` (null or a rejection; rebased views drop on rejection), `apply` (mutates the working state), `describe` |
| `effect` | Effect proposal → concrete events, or a rejection; it declares the arguments it reads (`args`, `?` marking an optional one), which the reference lists |
| `service(name, impl)` | Cross-pack service with defined behavior at every level (`economy.charge`, `gear.transfer`, …) |
| `query(name, impl)`, `formula(name, fn)` | Level-independent queries; formula functions for the expression language |
| `renderer` | Slot lines (no `{{`/`}}`) |
| `action`, `rule`, `schedule` | Built-in content |
| `table` | Column contract and default table (§6) |
| `materializer` | Detail sampled within the current representation |
| `process` | A per-slot stepper with process seeds |
| `proposal` | An extraction channel: validation and effects, with per-type modes from D4 |
| `lint`, `view` | Lint rules; panel view models |

Services and queries are typed by declaration merging:

```ts
declare module "../../../engine/registry" {
  interface ServiceMap { "economy.charge": (ctx: ReadContext, payer: EntityId, cents: number, memo: string) => LedgerEvent[] | Rejection }
}
```

`UiPackDef {id, register(r: UiRegistry)}`, with `panel(PanelDef)`, `editor(EditorDef)`, `config(component)` and `chip(kind, component)`. Components receive their view model and `send`, which wraps the protocol. `config` gives the registering pack dedicated fields for its `config` in Build (the economy pack's narrated-price cap): they render on the pack's entry under Packs, above the config as JSON, and edit the same object (`PackConfigProps`). Play sends `lre.view.open` with no entity whenever a pack's panel is shown, so the POV's detail in that pack's domain materializes; the panel shows the representation until it lands.

An `editor` keeps its form with `useHeld` (`frontend/build/held.tsx`), as Build's own editors do: a change made elsewhere reloads the draft but never resets the user's unsaved edits, Build's bar offers Load theirs and Keep mine, and a save through the `send` it receives asks before writing over that change (DESIGN §23).

## 6. Data tables (`shared/tables.ts`)

Raw sources in `data-src/us/*.json` are never imported. `scripts/tables/build.ts` maps each source into pinned pack tables, validates them, computes each `revision = hashJson({schema, columns, rows})`, and writes `src/packs/<pack>/core/tables/modern-us/<table>.json`. The output is generated, committed and imported by the pack's `table()` registration.

| Source | Tables (owner pack) |
|---|---|
| `prices.json` | `economy.catalog` (items: category, unit, `price_cents` band); `economy.categories` (per-category band: min of mins, median of typicals, max of maxes) |
| `occupations.json` | `economy.occupations` (pay, frequency, withholding, flags, schedule pattern ref) |
| `regions.json` | `economy.regions` (taxes, cost-of-living multiplier, rents, electricity, minimum wage, time zones, DST) |
| `finance.json` | `economy.finance` (one row per section: card, deposits, loans, investing incl. GBM recipe, payroll deductions, federal tax) |
| `vehicles.json` | `vehicles.classes`; `vehicles.factors` (consumption factor guides) |
| `gear.json` | `gear.items`, `gear.containers`, `gear.kits` (pieces; `mechanic_toolbox_45` sums to 45), `gear.slots` |
| `calendar.json` | `calendar.holidays`, `calendar.observances`, `calendar.dst`, `calendar.school`, `calendar.work`, `calendar.shifts` |

- **Conventions carried over:** money is integer cents; percentages are `pct` units; bands are `{min, typical, max}`; every source table keeps `approximate: true` and its `basis` in `source`.
- **Regional scaling** (`cost_of_living_multiplier`) is applied by the economy pack at pricing time, never baked into rows.
- **World creation:** the starter templates carry every enabled pack's default tables (`scripts/templates/build.ts` copies `defaultTables()` into each) and record `pins.tables[id] = revision`. A Blank world (`blankWorld`) and the studio's `newWorld` start with no tables: tables are read only from the world document, so a world that needs one adds it, as a recipe's fragment does, or starts from a template. Authors may edit their copies; edits produce new revisions.

## 7. Host port and fake host (`backend/host.ts`)

`HostPort` covers:
- chat messages and the whole `spindle_metadata` bag;
- chat metadata, appending user messages and the chat the user has open;
- user storage (read, write, move, remove and list);
- events;
- the context handler and interceptor;
- quiet calls (with the tools a lore lookup offers, and the tool calls the model makes) and decision calls;
- token counts from the host tokenizer;
- the world's lore book (create, check, list, add and delete entries) and a dry-run assembly of a chat's next prompt;
- the active preset and the default connection;
- the background lane's child process (spawn, messages, lifecycle);
- frontend messaging, closing the drawer, and logging;
- the shared RPC pool: serving this extension's endpoints (with the reader's id and a read policy) and reading another extension's.

`test/support/fake-rpc.ts` plays the host's pool for both extensions: endpoint names checked as the host checks them, a read of an unregistered endpoint rejected, the read policy's permissions held by both sides, and every value structured-cloned to the reader.

Event payloads are exactly those the host emits (DESIGN §14). `userId` arrives as the handler's second argument.

`test/support/fake-host.ts` implements `HostPort` in memory and replays the host's recorded orderings:
- staging and saves per generation type;
- Continue saves, including the double `MESSAGE_EDITED` on a prefix re-render;
- `GENERATION_STOPPED` with no `messageId`, carrying the suffix only for a Continue;
- live swipe navigation while a reply streams, with `updated` reporting the generation's swipe;
- silent branch creation and whole-bag metadata replacement;
- a swipe delete that leaves metadata unshifted;
- a restart that removes a staged reply;
- empty replies;
- the P4 re-render in both variants.

## 8. Test layout

| Path | What |
|---|---|
| `test/engine/*.test.ts` | Leaf modules and engine units |
| `test/ledger/reference.test.ts` | Both folds against hand-built chains, one fold rule per case |
| `test/ledger/scenarios.test.ts` | Named host scenarios on the fake host (turn, assistant edit, switch and back, user-edit pause, Continue, held writes, restart, clobber) |
| `test/ledger/properties.test.ts` | The ledger gate: generated operation sequences on the fake host, oracle = reference fold, the ledger-core invariants (list in `test/support/ops.ts`) |
| `test/ledger/regressions.json` | Every seed that has failed, shrunk; always replayed |
| `test/backend/*.test.ts` | Fake-host tests (DESIGN §14 list) |
| `test/packs/<pack>/*.test.ts` | Pack units and level contracts |
| `test/loop-sim/*.test.ts` | Whole-loop scenarios |
| `test/support/` | `fake-host.ts`, `harness.ts` (fake host + real `LedgerService` + test pack), `ops.ts` (generator, runner with invariant checks, shrinker), `test-pack.ts` |
| `test/shared/*.test.ts` | Maps, and the world schema against the starters and the preview world |
| `test/docs/*.test.ts` | The authors' reference equals a fresh build; every recipe in RECIPES.md loads, lints clean and plays as it says |
| `test/boundaries.test.ts`, `test/manifest.test.ts` | Structure |

Volume knobs:
- `LRE_PROPERTY_RUNS` (sequences per run; default 200), `LRE_PROPERTY_OPS` (longest sequence; default 60), `LRE_PROPERTY_SEED` (replay one seed), `LRE_PROPERTY_BASE` (the seed base, `lre-fixed` by default, so every default run is the same; set another to explore new seeds) and `LRE_PROPERTY_FROM` (the first seed index, to split a long run into shards).
- A failing seed is shrunk and appended to `regressions.json`. Every tenth sequence runs twice and must end byte-identical (L31).

## 9. Contributing

The module boundaries in §2 are the contract, and `test/boundaries.test.ts` enforces them: a change that crosses a zone has to say so in the type contract first. When you add a pack, write it as a pure `core` and a `ui`, add it to `ALL_PACKS` in `src/packs/index.ts` (requirements first), give it a level contract (DESIGN §9.2), lint rules and tests, and keep cross-pack behavior behind registered services and queries (§5). Contract files in `src/shared/*` change only together with every module that reads them, and with this document; a change to the world document also changes `schemas/lre-world-v1.schema.json`. After changing what a pack registers, run `bun run reference` to regenerate [REFERENCE.md](REFERENCE.md).

Commit your own changes in small, reviewable steps, and run `bun run typecheck` and `bun test` before you open a pull request. `dist/` is built output: rebuild it with `bun run build` from a clean checkout, and do not edit it by hand.

## 10. Conventions

- TypeScript strict; double quotes; semicolons; two-space indent.
- No `any`, and no member access on an inline cast. The only record guard is `isRecord` from `shared/json.ts`.
- `Promise.withResolvers` instead of `new Promise`. `Record` for static maps. No `ReturnType` contracts. No one-line helpers with fewer than three call sites.
- Money is integer cents everywhere. Time is game minutes in the engine.
