# Writing LumiRPEngine worlds: a guide for agents

This is the guide an agent reads before it touches a LumiRPEngine world, through the `lumirpengine` MCP server or command line ([MCP.md](MCP.md)). It covers the world model, the way to work on a user's worlds, and the mistakes that are easy to make and hard to see. The details of every kind, field, effect and formula function are in the reference (`lre_docs`), and complete worlds to learn from are the starters (`lre_template`). How outside agents reach LumiRPEngine is DESIGN §23.

## The world model

A world is one JSON document in the `lre-world-v1` format, with a published JSON Schema (`lre_schema`). Each commit makes an immutable **revision**, named by its content hash; the newest is the world's **head**, and a chat plays the revision it was started on until the player upgrades it. Changes go to a **draft** first: a working copy that a commit turns into the next revision.

- **Collections** are objects keyed by id: `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `packs`, `lore`, `classifications`, `tiers`, and `lifeStates` when the world has its own.
- **Parts** are single values: `calendar`, `realism`, `time`, `start` (`{place, at}`), `pov` (the entity the player plays), `currency`, `loreIndex`, `pins`, and the optional `ruleset`, `mapSettings`, `spawnTier` and `spawnCap`.
- **Kinds** are types with fields and single inheritance (`extends`). The packs define the common ones: `thing` (with `owner` and `place`), `person`, `item`, `container`, `kit`, `vehicle`, `account`, `business`, `group` and its `faction`, `family`, `household` and `company`. A world kind with a pack kind's id replaces it whole, so extend a pack kind rather than redefine it.
- **Entities** are the people and things: `{id, kind, name, tier, fields, relations}`, plus `life`, `lifeKnownBy`, `agent`, `cues`, `class`, `tags`, `visibility` and `knownBy` as needed. Fields hold values; relations are `{type, to, fields?}` links to other entities.
- **Formulas** are strings in a small, safe expression language (`lre_docs` with `doc: "expressions"`): `at(pov, 'archive')`, `stage.hale_debt == 'revealed'`, `hour >= 18`. Dice are notation strings (`1d20`).
- **Money** is always a whole number of the currency's minor units: 4250 is $42.50 in a dollar world. **Times** are local ISO date-times (`2026-09-14T18:30`).

## How to work on a user's world

1. **Read before you write.** `lre_worlds` lists the worlds and whether each has a draft stored. A draft that is already there when you start is the user's work in progress: ask them before you edit, commit or discard it. `lre_world` reads one at a JSON Pointer: `""` gives an outline of the whole world (collections with their ids), `/entities/mara` one item. `lre_search` finds an item by what it says.
2. **Edit the draft.** `lre_edit` takes JSON Patch (RFC 6902) operations whose paths point into the whole world: `add` creates an item or a field, `replace` changes one that exists, `remove` deletes, `test` guards a value. All the operations of one call apply, or none do. Pass `expectVersion`, the draft version your last read reported (`lre_world`, `lre_draft` and `lre_worlds` give it whether or not a draft is stored, and each `lre_edit` answers the new one): if the draft has changed since, the edit is refused and nothing is overwritten.
3. **Check.** Every `lre_edit` answers the lint the draft has now and any macro hazard the edit brought in. `lre_draft` sums up the draft against the head; `lre_diff` shows field by field what changed. `lre_playtest` plays typed turns and `lre_check_world` simulates whole days, both with the bundled engine and no model.
4. **Commit, or discard.** `lre_commit` with a short note makes the draft the head; the note goes into the world's history (`lre_history`). It is refused while the draft has lint errors, which it lists. `lre_discard` throws the draft away. Pass both the `expectVersion` you last saw, as for `lre_edit`.

**The draft is the user's Build draft.** There is one draft per world, and Build edits the same one: the user sees your changes as you make them, and you see theirs. Don't leave a draft behind: commit what you finished, discard what you didn't, and say which you did. If an edit is refused because the version moved, read the draft again: the user may be editing it.

**A commit takes the whole draft.** When the user presses Commit in Build, your unfinished changes go into that revision with theirs; when you commit, their changes go in with yours. So finish one change before you start the next, and tell the user what you are in the middle of. With `expectVersion`, `lre_commit`, `lre_discard` and `lre_restore` are refused if the draft moved on since you read it, so none of them commits or throws away a change you haven't seen. A commit is refused, too, when the head is no longer the revision the draft began from: compare with `lre_diff`, discard, and redo the change on the new head.

**Chats keep their revision.** Committing changes no running chat. `lre_chats` says which chats are behind; `lre_upgrade` with `preview` shows what an Upgrade would bring into one, and without it applies the default picks: what play never touched comes from the new revision, and what play changed stays as played. So in a world that chats play, keep every id the chats use: a renamed id is a new thing, and the old one stays behind in the chat.

**Offline work.** Without a Lumiverse, write the world as a file: start from a starter (`lumirpengine template <id> --out world.json`), check it with `lre_check` after each change, run it with `lre_playtest` and `lre_check_world`, and bring it in with `lre_world_import` (or Build's Import) once it is clean.

## JSON Patch on a world

- An item is added whole: `{"op": "add", "path": "/entities/mara", "value": {"id": "mara", "kind": "person", …}}`. Adding to a key that exists replaces it, so to change one field, point at the field: `/entities/mara/fields/place`.
- `replace` and `remove` need something there; `add` needs the parent to exist (`/entities/mara/fields` must be an object before `/entities/mara/fields/place` can be added).
- In a list, a number is the index and `-` is the end: `{"op": "add", "path": "/entities/mara/relations/-", "value": {"type": "knows", "to": "pov"}}`.
- In a key, `~1` stands for `/` and `~0` for `~`: the table `economy.catalog` is `/tables/economy.catalog`, and a key `a/b` is `/x/a~1b`.
- `test` makes an edit conditional on what you read: `{"op": "test", "path": "/entities/mara/name", "value": "Mara"}` first, and the whole patch is refused if Mara was renamed meanwhile.
- `/id`, `/format`, `/engineVersion`, `/suppressed` and `/pins` are the engine's: a patch may not change them.
- One patch carries at most 500 operations and brings in at most 4 MiB of JSON (what it adds, replaces and copies), and the world may nest at most 64 levels deep. An item the engine can't read (`/lore/x` set to `{}`) is refused before anything is written, so add items whole.

## Ids and keys

- Every item's `id` repeats its key. Lint refuses a mismatch for entities, lore entries, step templates and classifications; keep them equal everywhere.
- Ids are lower snake_case by convention (`old_bram`, `quay_to_market`) and are what everything else refers to: `fields.place`, `fields.owner`, relation targets, track ids in formulas, lore `links`. Look them up rather than guess them; every reference to an id the world doesn't have is a lint error or a dead link.
- An item's key must be 1 to 200 characters and never `__proto__`, `constructor` or `prototype`; the engine refuses any other.
- A world's own id (`w_…`) is the host's: `lre_world_create` and import assign it.

## People

- **The POV** (`pov`) is the entity the player plays, a `person` on a lead tier, never capped by realism. `start` is where and when play begins, and the POV stands there unless its `fields.place` says otherwise.
- **Tiers** say how deeply someone is simulated: by default `principal` (Leads), `supporting` and `background`. `"agent": true` makes someone pursue their own agenda off-screen.
- **Who knows the POV.** Everyone who has met the POV holds a `knows` relation toward the POV, or a `regard`. The narrator is told "Mara knows you" or "Mara doesn't know you" from exactly that, so a friend without either greets the player as a stranger.
- **Regard** is one directed relation with `warmth`, `trust` and `respect` from −100 to 100; write each direction that matters. Kinship (`parent_of` and `child_of`, `sibling_of`, `spouse_of`, `partner_of`) is kept two-sided: write both sides.
- **Life and death.** `life` is the state someone starts in: `alive` when unset, `dying`, `dead`, or one of the world's own `lifeStates`. The dead keep their place: give a body a `fields.place` where it lies, and no schedule (someone who doesn't act follows none).

### lifeKnownBy: who knows how someone starts

When someone starts dead or dying, `lifeKnownBy` lists the ids of the people who know it; everyone else, the POV included, takes them for alive until they see the body or are told. **Left out or empty, everyone knows**, which tells the player at once. So:

- a death the player hasn't learned of lists who does know, including everyone who starts in the same place as the body;
- when nobody else knows yet, list the person themself (the list is then not empty, and no one else learns it);
- on someone who starts alive it changes nothing (lint warns), and every id in it must be an entity of the world.

```json
{ "id": "old_bram", "kind": "person", "name": "Old Bram", "tier": "supporting", "life": "dead", "lifeKnownBy": ["silas"], "fields": { "place": "net_loft" }, "relations": [] }
```

## Things and who owns them

- Where a thing is: `fields.place` for something lying in a place, a relation `{"type": "in", "to": "rhea"}` for something carried or inside a container.
- **Whose it is lives in `fields.owner`**, the owner's id. That puts it on their gear, a vehicle in their garage and at their levels, and lets them drive it. The `owns` relation only changes how the Journal words a change: an item with an `owns` link and no `fields.owner` belongs to no one. Set `fields.owner` on everything someone owns.
- **Accounts** hold real money at Money 2 and up: one `account` entity per purse, wallet, bank account or card, with `fields.owner`, `fields.type` (`cash`, `checking`, `savings`, `card`, `loan` or `brokerage`) and `fields.opening`, the balance at the start in minor units (a debt is negative). At Money 1 a person's `wealth` band is all there is.

```json
{ "id": "rhea_purse", "kind": "account", "name": "Rhea's purse", "tier": "background", "fields": { "owner": "rhea", "type": "cash", "opening": 4250 }, "relations": [] }
```

## Places, routes and maps

- Places form a tree through `parent` (a town holds streets, a building its rooms). A place the player hasn't heard of yet is `"visibility": "discoverable"`.
- Routes join places with minutes per travel mode (`walk`, `road`, `offroad`, `water`), both ways unless `bidirectional` is false.
- **A map owns what it draws.** A map (`/maps/<id>`, format `lre-map-v1`) draws one place's inside, as a grid of characters or as linked places, and compiles into places, a grid and routes that carry `"map": "<map id>"`. Those are the map's: **edit the map, never them**. A write to a place, grid or route a map draws is refused ("drawn by the map …; edit it there"), and so is setting `map` on anything else. After a change to the map, the engine draws its places, grid and routes again; delete the map and they go with it. A place, grid or route you write yourself with the same id as one a map would make wins over the map's.

## Tracks: quests and secrets

A track is a small state machine: `start` names its first stage, and each stage's `next` lists `{"to": stage, "when": formula}`, taken in order when the formula holds. A stage may carry a `cue` (what the player can know now), `objectives`, `effects` on entering, `rewards` on leaving, a `gate` and a `fail`. A stage with no `next` ends the track. Secrets advance only by their formulas, never by a model.

- **Quests** start at the stage the story has reached, not at the beginning: `start` is today's stage.
- **Secrets** keep a `truth` (what is really so, kept from the player) on the stage that reveals it, and a `cue` (what the player can notice) on the stages before. A cue never states the truth.

### A revealed secret starts one stage earlier

The engine records a reveal only when a track **enters** a stage with a `truth`. A track that starts on its truth stage never enters it, so the truth is never revealed: the Journal never shows it and the narrator is kept from saying it. **Never start a secret track on a stage that has a `truth`.** For a secret the player has already learned, start one stage earlier on a stage that moves on at once, so the first turn reveals it:

```json
{ "id": "silas_debt", "kind": "secret", "label": "What Silas owes", "visibility": "secret", "owner": "silas", "start": "rumor", "stages": {
  "rumor": { "label": "Something is off", "next": [{ "to": "known", "when": "true" }] },
  "known": { "label": "Silas owes the guild", "truth": "Silas borrowed the guild's harbor dues to pay a gambling debt.", "next": [] } } }
```

### Cues never name the secret

A person's `cues` are what the narrator sees them do while a secret of theirs stays hidden: `{"text": "Changes the subject whenever the guild comes up.", "track": "silas_debt"}`.

- Each cue stands for exactly one secret: a `track` (while it keeps something hidden), a secret `lore` entry (until its gate holds) or a story `flag` (until it is set). A cue keyed to none, or to several, never shows.
- Write behaviour, never the secret: a cue that holds a track's truth or a phrase of secret lore is a lint error, because it gives the secret away.
- Name no one the player may not know: such a cue is left out while they don't (lint warns).
- Only people have cues that show; the stage cues of the tracks a person owns reach the narrator the same way.

## Lore

Lore entries (`/lore/<id>`) are what the world knows, read by the engine's own helpers: `{id, title, content, keys, links, aliases?, topics?}`, where `links` are the ids of the people and places an entry is about.

- `"visibility": "known_by"` keeps an entry back until the player knows every person and place it links.
- **A secret entry** holds a secret itself: `"secret": true`, a `gate` formula that reveals it (lint refuses a secret without one), and an `audience` of the helpers that may read it before then (`npc.choose`, `contradiction`, `puzzle.answer`, `judge`, `interpret`). The helpers that write for the narrator or the player (`brief`, `outline`, `choices`, `extract`) never read it early, even when listed.
- A public entry must never repeat a track's truth: lint refuses it (`secret_truth`).
- `loreIndex` routes the helpers' lookups: `terms` maps a lowercase term to entry ids, `topics` gathers entries under a label.

## Data tables

Prices, pay, taxes, occupations, regions, gear and the calendar's holiday rules come from data tables (`/tables/<id>`): typed `columns` and `rows` keyed by row id, read by the packs and by `table(id, key, column)` in formulas.

- A blank world has none; each starter carries a full set of seventeen. Bring in a table whole, with `id`, `pack`, `schema`, `label`, `columns` and `rows`: copy one from a starter (`lre_template` at `/world/tables/<id>`) and adapt it.
- Cells follow their column: a `band` is `{"min", "typical", "max"}`, money columns are in the currency's minor units, and a `ref` names a row of another table.
- A table's `revision` and its pin in `pins.tables` are the engine's: every write that changes a table computes both again (`hashJson` of its schema, columns and rows). Don't write either, and don't patch `/pins`.
- Each revision of the world keeps its own copy of its tables, so a running chat sees a table change only through an Upgrade.

## Host macros

Lumiverse runs macros (`{{…}}`) in the prompt it builds, and also acts on its control characters and on `<user>`, `<char>` and `<bot>`. LumiRPEngine keeps authored text as written, so in lore content and in section and step templates these are hazards, worth a look before the world is played:

- A section template may use only `{{lines}}`; anything else in one is a lint error (`section_macro`).
- Step templates use the engine's own placeholders (`{{world}}`, `{{pov}}`, `{{place}}`…); lint warns about one it doesn't know.
- Keep `{{user}}` and `{{char}}` out of lore unless the user put them there on purpose. `lre_edit` and `lre_commit` list every hazard a change brings in; say which ones you added.

## Before you commit

- `lre_draft` shows no lint errors, and you know what each warning means.
- The POV exists and stands at the start place; the start time is the story's present.
- Every id an item names (a place, an owner, a relation target, a track in a formula, a lore link) exists.
- Everyone who has met the POV holds a `knows` or a `regard` toward them.
- A death or dying the player hasn't learned of sets `lifeKnownBy`; the dead lie at a `fields.place`.
- Everything someone owns names them in `fields.owner`.
- No secret track starts on a stage with a `truth`, no cue states its secret, and no public text gives one away.
- Nothing a map draws was edited outside its map; no `revision` or pin was written by hand.
- `lre_playtest` and `lre_check_world` run without failures or leaks in their notes.
- Commit with a note that says what changed, and tell the user what you changed and what you left for them.
