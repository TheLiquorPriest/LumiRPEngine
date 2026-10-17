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
| `src/shared/schema-check.ts` | A small JSON Schema reader (the keywords the published schemas use) with plain-language problems at JSON paths |
| `src/shared/maps.ts` | Maps: the schema check, the compiler (`compileMaps`: a map's places, grid and routes, marked as its own), the map lint, the JSON layout and the templates |
| `src/shared/tables.ts` | Pinned data tables and the build-time mapping |
| `src/shared/ledger.ts` | Events, `Rec`, `post` entries, markers, `MessageLedger`, `ChatRun`, the journal, fold outputs |
| `src/shared/state-view.ts` | The state view the frontend renders |
| `src/shared/settings.ts` | User settings, the D4 cold-start extraction modes and per-connection learning (`ExtractionLearning`, `userStorage/extraction-learning.json`) |
| `src/shared/protocol.ts` | Frontend ↔ backend messages |
| `src/engine/state.ts` | The folded `WorldState` |
| `src/engine/registry.ts` | `PackDef`, `CoreRegistry` and the pure contexts packs receive |
| `src/engine/steps.ts` | `StepPort` and the model-step shapes |
| `src/frontend/registry.ts` | `UiPackDef`, `UiRegistry`, panel, editor, chip and proposal-preview props |
| `src/backend/host.ts` | `HostPort`, the only door to Lumiverse, with the host's observed event payloads |
| `src/spindle-augment.ts` | Local types where the host differs from `lumiverse-spindle-types` 0.6.49 |
| `src/studio-api.ts` | The studio seam |

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
- `engine/gm-view.ts`: the GM view's world part (`buildGmWorld`): every entity, removed and spawned ones included, with its fields, relations, placement, levels and designed sheet; places; tracks with their truths; relation types.

Backend layout:
- `backend/spindle-host.ts`: `HostPort` over `spindle`.
- `backend/ledger-io.ts`: wires host events and the context handler to the ledger; journal file I/O, per-message write queues (read-merge-write of the whole `spindle_metadata` bag), re-assert, restart recovery.
- `backend/runtime.ts`: the composition root; turn hooks (pre, plan and post phases), the World Info interceptor (engine slots only), chip and slot handling.
- `backend/turn-model.ts`, `backend/turn-steps.ts`: the ledger's `TurnModel` over the simulation pipeline, and the model steps around a turn.
- `backend/book.ts`: the engine-managed lore book: slot entries, and removal of lore copies an earlier build synced into it.
- `backend/steps.ts`: `StepPort` over `HostPort.models`, and the call meter (kept per user in `call-meter.json`).
- `backend/worlds.ts`, `backend/settings-store.ts`: world storage and revisions; settings, presets and extraction learning.
- `backend/dispatch.ts`, `backend/view.ts`, `backend/gm.ts`, `backend/push.ts`, `backend/chips.ts`: request dispatch, the state view, the GM view (built per `lre.gm` request, never pushed), state push, stored chips.
- `backend/jobs.ts`, `backend/proposals.ts`, `backend/map-job.ts`, `src/worker/background-lane.ts`: background jobs (kept per user in `jobs.json`; a job stored as running that the process isn't running reads as interrupted) and the child lane; Import and Refine proposals; Describe a map (the prompt, the answer's checks and the repair call).
- `shared/lore.ts`, `engine/lore-lint.ts`, `backend/lore.ts`, `backend/lore-index.ts`: world lore (DESIGN §4.2): sources, the lookup table's terms, additions and suggestions; its lint; book drift and Save to lore; the indexing jobs' prompt, reader and checks.
- `backend/preset-lint.ts`, `backend/plan-notes.ts`: the preset lint; planned-turn lines kept by seed.
- `backend/outcome-notes.ts`, `backend/inspector-log.ts`: the next turn's Outcome notes and the inspector's history with its delivery badges, per chat.
- `backend/stored-json.ts`: reading the extension's own JSON files; a damaged one is set aside as `<path>.corrupt-<epoch ms>` with a warning, and the caller starts fresh.

Space pack layout (`packs/space`): `core/travel.ts` (routes and A*), `core/map-scope.ts` (one map scope as drawn: a place's children at their cells or node positions, the routes between them, its grid; pure, shared by Play and Build), `core/view.ts` (the `space.map` view: every scope the POV can open, and travel options); `ui/map-draw.ts` (painting a scope), `ui/map.tsx` (the map stage, breadcrumbs and the place card), `ui/map-editor.tsx` and `ui/map-preview.tsx` (Build's map editor and previews), `ui/editors.tsx` (the grid and place editors); `frontend/json-text.ts` reads JSON text with the line of each value, for the map editor.

## 3. Shared types

### 3.1 World document (`lre-world-v1`, `shared/world.ts`)

One JSON document per revision; the revision id is its `hashJson`. Collections are keyed by id: `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `lore`, `classifications`. Singletons: `calendar`, `realism`, `time`, `pins`, `packs`, `pov`, `start`, `seedMode`, `lenientPricing`, `suppressed`, `loreIndex` (the lore lookup table: `terms` and `topics`).

- **Maps** (`lre-map-v1`) are the source of truth for the places, grids and routes they draw. `migrateWorld` compiles them whenever a document is read (`shared/maps.ts`), clearing what an earlier compile made (items marked `map`, and a scope's link to a grid a map made) and making it again, so the compiled items stored in a revision or an export always match their maps. Build's editors show them read-only and `lre.editor` refuses writes to them.
- **Formulas** are expression-language strings (`Expr`); **dice** are notation strings.
- **Kinds** have single inheritance and typed fields (`FieldDef`: type, default, min/max, enum values, ref kind, list element, bands, derived formula, locked, bound, visibility, and the level contract's domain and live level).
- **Entities** carry field values, relation instances (with `until` for use grants), a tier (one of the world's `tiers`, each mapped to a detail band whose caps apply), optional per-domain level overrides, the LOD1 `agent` flag (unset: the tier's default) and an optional Lumiverse character id.
- **Pins** fix generator versions and table revisions (DESIGN §9.2). The document holds copies of its tables, so a running chat sees new data only through a `migrate` marker.
- **The ruleset** (`ruleset`, optional) holds progressions, the sheet layout, level floors and the adjudication policy (`adjudication`: a preset and its values; DESIGN §11). Actions, places and tracks take `adjudicate` (marked for the `marked` timing) and checks `pass` and `auto`.
- Levels gate processes, rendering and extraction, never the shape (D18).

Storage (DESIGN §4.1): `userStorage/worlds/<worldId>/index.json` (`WorldIndex`) and `rev/<revision>.json`, written temp-then-move. Settings live in `userStorage/settings.json` (`UserSettings`).

Other files the backend keeps, each written temp-then-move and read through `readStoredJson`:

| File | Holds |
|---|---|
| `userStorage/jobs.json` | `{v: 1, jobs: JobSummary[]}`: running jobs and the newest 8 ended ones, oldest first, with input and result (an import's proposals after every chunk) |
| `userStorage/call-meter.json` | `{v: 1, turns, current}`: the last 200 closed turn tallies and the current one |
| `userStorage/runs/<chatId>/chips.json` | Stored chips until acted on or lapsed |
| `userStorage/runs/<chatId>/plans.json` | Planned-turn lines by seed (the newest 128), for Re-narrate |
| `userStorage/runs/<chatId>/outcome-notes.json` | `OutcomeNote[]`: notes for the next turn's Outcome slot, dropped once a later message has committed and another follows |
| `userStorage/runs/<chatId>/prefs.json` | `{v: 1, mapDisplay?}`: the player's choices for the chat that aren't part of its world, such as the map's display mode (`lre.map`) |
| `userStorage/runs/<chatId>/inspector.json` | `{v: 1, records, delivery}`: the last 10 interceptor runs and the last delivery check by slot, read when the chat is first viewed |

### 3.2 Ledger (`shared/ledger.ts`)

| Store | Shape |
|---|---|
| Chat metadata `lumi_rp_engine` | `ChatRun {v, worldId, runSeed, startedAt}` |
| Assistant message `spindle_metadata.lumi_rp_engine` | `MessageLedger {v, swipes: {[index]: Rec}, markers}` |
| `userStorage/runs/<chatId>/journal.json` | `Journal`: `seq`, chain snapshot, latest ledger per message, pauses, tombstones, held writes, refused writes (`refused`: the latest 8 held writes that didn't validate when their windows closed, with the reason, until dismissed), open windows, pending turns, `started` |

- **Events** are concrete. Assignment events (`set`) carry final values; accumulator events (`add`, `post`) carry deltas. Pack events are `<packId>.<name>` with a JSON body.
- **`Rec`** follows DESIGN §4.3. `accepted` is the identity of content accepted without being read: an assistant edit or an unread Continue. It is outside every hash, so accepting text never moves a path.
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
- status (`not_world`, `idle`, `in_flight`, `paused`);
- HUD, scene, chips, Journal notes, the Keep report, `pending` marks and the call meter;
- `panels`: pack view models keyed `<packId>.<panel>`, each built by the pack core's `PanelViewDef`. The GM view is not among them: `lre.gm` builds it on request (`GmView`), everyone else's money included, from the economy pack's `economy.people_money` query.

Player-facing content is already filtered to the POV's knowledge; the GM view's data is fetched separately, and only once its spoiler gate is open.

## 4. Frontend ↔ backend protocol (`shared/protocol.ts`)

Transport: `ctx.sendToBackend` / `spindle.sendToFrontend(payload, userId, {frontendSessionId})`. Every message is `{lre: 1, type, …}`. Requests carry a frontend-chosen `reqId` and get exactly one `lre.result` (with `request` naming the type) or `lre.error`.

| Request | Payload | Result body |
|---|---|---|
| `lre.hello` | `chatId \| null` | `{accepted}`, then a snapshot |
| `lre.state.resync` | `chatId` | `{accepted}`, then a snapshot |
| `lre.action` | `chatId, action, params, source, text?` | `{messageId}` of the appended user message (with `intent`, `triggerGeneration`) |
| `lre.chip` | `chatId, chip, choice, payload?` | `{applied, pending}` |
| `lre.view.open` | `chatId, panel, entity` | `{materialized, pending}` |
| `lre.fix` | `chatId, entity, field, value` | `{pending}`; checked as a `set` against the field's definition (locked fields refused), stored as one `fix` post entry |
| `lre.edit` | `chatId, ops`: 1–64 `EditOp`s (`set`, `add`, `link`, `unlink`, `move`, `put`, `adjust`, `stage`, `entity`, `spawn`, `despawn`, `restore`) | `{pending}`; all or none, one `fix` post entry; locked fields writable |
| `lre.gm` | `chatId` | `GmView`, built from the head's state when asked; never part of a snapshot or delta |
| `lre.map` | `chatId, display` (`knowledge` \| `fog`) | `{display}`; stored in the chat's `prefs.json` and sent with the next snapshot as `mapDisplay` |
| `lre.marker` | `chatId`, then `resolve{domain, scope, to}` \| `time{control, scope, to}` \| `adjudicate{to}` \| `migrate{to, merge?}`; `preview` writes nothing | `{pending}`; with `preview`: `{preview}`, whose `upgrade` lists a migrate's definition changes with their default picks |
| `lre.keep` | `chatId`, then `keep{messageId}` \| `discard{messageId}` \| `convert{messageId, parentPath, refs}` | `{pending}` |
| `lre.settings.get` / `.set` | `patch` (deep merge) | `{settings}` |
| `lre.editor` | `worldId, base`, then `put{collection, id, value}` \| `remove{collection, id}` \| `set{part, value}` | `{draft, lint}` |
| `lre.world` | `list` \| `get` \| `create` \| `delete` \| `commit` \| `import` \| `export` \| `lint` \| `attach` \| `upgrade{chatId, to, merge?}` \| `sheet{worldId, ruleset, entity?}` | `{worlds?, world?, revision?, lint?, file?, packKinds?, packRelations?, functions?, sheet?}`; `get` adds the packs' kinds and relation types and `functions`, every function a formula may call outside an effect argument (the expression editor's list); `upgrade` writes the `migrate` marker, with `merge` the owner's picks for the definition merge (DESIGN §4.3); `sheet` is the Sheet Designer's preview, the draft with the unsaved ruleset read on the POV (or `entity`) |
| `lre.job` | `start{kind, worldId, input}` \| `cancel{jobId}` \| `list{worldId}` \| `dismiss{jobId}` | `{jobId}`; `list`: `{jobs}` (`JobSummary[]`, oldest first). Updates arrive as `lre.job.update {jobId, kind, status, progress, message?, result?}` |
| `lre.lore` | `drift{worldId, id?}` \| `save{chatId, text?}` | `drift`: `{drift}`, the draft's book-sourced entries whose book entry changed (with its text and hash now) or is gone; `save`: `{worldId, id}` of the lore entry saved to the draft of the chat's world |

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

`PackDef {id, label, version, domain, requires, register(r: CoreRegistry)}`. Registrations:

| Method | Contributes |
|---|---|
| `kind`, `relation` | Schema |
| `event` | Event type: `validate` (null or a rejection; rebased views drop on rejection), `apply` (mutates the working state), `describe` |
| `effect` | Effect proposal → concrete events, or a rejection |
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
- **World creation** copies the enabled packs' default tables into the document and records `pins.tables[id] = revision`. Authors may edit their copies; edits produce new revisions.

## 7. Host port and fake host (`backend/host.ts`)

`HostPort` covers:
- chat messages and the whole `spindle_metadata` bag;
- chat metadata and appending user messages;
- user storage;
- events;
- the context handler and interceptor;
- quiet and decision calls;
- token counts from the host tokenizer;
- frontend messaging and logging.

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
| `test/boundaries.test.ts`, `test/manifest.test.ts` | Structure |

Volume knobs:
- `LRE_PROPERTY_RUNS` (default 200 locally; CI 10,000), `LRE_PROPERTY_OPS` (longest sequence; default 60, CI 200) and `LRE_PROPERTY_SEED` (replay one seed).
- A failing seed is shrunk and appended to `regressions.json`. Every tenth sequence runs twice and must end byte-identical (L31).

## 9. Contributing

The module boundaries in §2 are the contract, and `test/boundaries.test.ts` enforces them: a change that crosses a zone has to say so in the type contract first. When you add a pack, write it as a pure `core` and a `ui`, add it to `ALL_PACKS` in `src/packs/index.ts` (requirements first), give it a level contract (DESIGN §9.2), lint rules and tests, and keep cross-pack behavior behind registered services and queries (§5). Contract files in `src/shared/*` change only together with every module that reads them, and with this document.

Commit your own changes in small, reviewable steps, and run `bun run typecheck` and `bun test` before you open a pull request. `dist/` is built output: rebuild it with `bun run build` from a clean checkout, and do not edit it by hand.

## 10. Conventions

- TypeScript strict; double quotes; semicolons; two-space indent.
- No `any`, and no member access on an inline cast. The only record guard is `isRecord` from `shared/json.ts`.
- `Promise.withResolvers` instead of `new Promise`. `Record` for static maps. No `ReturnType` contracts. No one-line helpers with fewer than three call sites.
- Money is integer cents everywhere. Time is game minutes in the engine.
