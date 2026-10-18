# LumiRPEngine studio contract

This is the contract for a world-building studio that authors worlds for LumiRPEngine outside Lumiverse: the `lumi-rp-engine/studio` export, the file formats, the published JSON Schemas and the versioning rules. I fixed this seam early (DESIGN §15, D23) so a studio never needs a breaking change from the engine. Everything here is pure: no host, no storage, no clock and no model calls. The same engine code runs in the studio and in Lumiverse, so a world lints the same in both, and Playtest and Check world play it with the engine a chat uses. They make no model calls, though: nothing reads typed text, judges a player's approach or decides an NPC's close call, so a typed line is matched to an action by its words, checks roll, and close calls go by the numbers. A chat with those helper steps on can play the same world differently.

For what the parts of a world mean, read the [design](DESIGN.md) (§4.1 for the document, §10 for tracks and rules, §11 for actions, checks and the ruleset). Every kind, effect, formula function and lint code the packs register is in the [reference](REFERENCE.md), the formula language is in [EXPRESSIONS.md](EXPRESSIONS.md), and [RECIPES.md](RECIPES.md) has small worlds to start from.

## The package

The package isn't published to a registry; a studio adds the repository as a Git or path dependency. Its `exports` map has three entries:

| Import | What it is |
|---|---|
| `lumi-rp-engine/studio` | The studio API (`src/studio-api.ts`), TypeScript source for Bun or a bundler |
| `lumi-rp-engine/schemas/lre-world-v1.schema.json` | The JSON Schema of a world document |
| `lumi-rp-engine/schemas/lre-map-v1.schema.json` | The JSON Schema of a map |

The API imports only the engine and the packs' pure cores; `test/boundaries.test.ts` holds it to that.

## The API

| Function | What it does |
|---|---|
| `load(input)` | Reads a world from JSON text, a parsed document or an export file. Returns `{ok: true, world, issues}` with the world migrated to this engine and linted, or `{ok: false, issues}` when the text isn't JSON or the document fails `validate`. |
| `validate(doc)` | The shape check `load` runs on an untrusted document: the format, id, name and POV; every collection an object whose entries are objects; every part an object; the scalar parts of the right kind. Parts that later versions added may be missing, because `migrate` fills them. Returns lint issues with code `shape`. |
| `migrate(world)` | Brings a document written by an older engine up to this one (below). Returns the same object when there is nothing to do. |
| `lint(world)` | The structural lint plus every pack's lint rules, as Build's **Problems** shows them: `{severity, path, code, message}`, with `severity` one of `error`, `warning` and `info`. |
| `newWorld(id, name)` | A minimal valid world: one POV person (`you`) at one place (`home`), the default tiers, Story realism and the Modern US calendar. |
| `revisionOf(world)` | The revision id the document gets when committed: its content hash, 32 hex digits. Lumiverse stamps `engineVersion` before it hashes, so a document carrying `ENGINE_VERSION` gets the same id in both. |
| `exportFile(world)` | The export file Build's **Export** writes and **Import** reads (below). |
| `playtest(world, turns, runSeed?)` | Plays typed turns through the engine from the world's start, with no narrator and no model. Each turn is `{user, reply, notes}`: `reply` is what the player would see, and `notes` start with the minutes it took and the action it was read as (`read as Go to`, or `not an action`), followed by any dropped events. Also returns `lint`. The same world, turns and seed always give the same result. |
| `checkWorld(world, days?, runSeed?)` | Plays 1 to 14 days (3 by default) as one-day timelapses, every interrupt at `note`. Each day is `{user: "Day 1", reply, notes}`: the author's view of every event, secrets and unmet people included, then the event count, dropped events, failures and any secret that leaked into a section (`leak in scene: "…"`). |
| `sheetPreview(world, entity?)` | The designed sheet (`ruleset.sheet`) as the entity (the POV by default) has it when a chat starts, or `null` without a designed sheet: what Build's Sheet Designer previews. |
| `studioState(inbound)` | The `lre-state-v1` payload (below) for this engine and the given install paths. |

The constants: `WORLD_FORMAT` (`"lre-world-v1"`), `EXPORT_FORMAT` (`"lre-world-export-v1"`), `ENGINE_VERSION` and `PACK_VERSIONS`. The schema reader is exported too: `checkSchema(schema, value, others?)`, `pathText(path)` and `MAP_SCHEMA`. The types are `WorldDoc`, `MapDoc`, `RulesetDef`, `LintIssue`, `PlaytestTurn`, `SheetSectionView`, `StudioState`, `Schema`, `SchemaProblem` and `JsonPath`.

## File formats

### World (`lre-world-v1`)

A world is one JSON document; Lumiverse keeps one per revision and never changes a revision once written. Collections are objects keyed by id (each item's `id` repeats its key), and the parts are single objects. Formulas are strings in the expression language, dice are notation strings, money is integer minor units of the world's currency, and time is game minutes since the calendar's epoch.

| Collections | Parts |
|---|---|
| `packs`, `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `lore`, `classifications`, `tiers` | `pins`, `calendar`, `realism`, `time`, `start`, `currency`, `loreIndex`; optional `ruleset` and `mapSettings` |

The scalars are `format`, `id`, `name`, `engineVersion`, `pov`, `seedMode` (`fresh` or `same_roll`), `lenientPricing`, the optional `spawnTier`, the optional `spawnCap` (how many people replies may introduce in a chat: a whole number from 0 to 500, 24 when absent), and `suppressed`, a list kept for the format that nothing reads.

A world may add `lifeStates`, its own life states besides `alive`, `dying` and `dead` (each `{label, acts, reads}`; an id a built-in has is an error), and an entity may name the state it starts in with `life` (alive when absent).

A few rules a studio has to keep:

- **Maps own what they draw.** The places, grid and routes a map compiles into carry `map` with its id, and every read compiles the maps again, replacing what an earlier compile made. Edit the map, not the compiled items. A map's place whose id the world already has, or a grid id already taken, compiles without that part, and lint says so.
- **Tables are copies.** A world holds copies of the data tables it uses. A table's `revision` is computed from its schema, columns and rows, never authored, and `pins.tables` records the revision each copy was made from, so a running chat sees new data only through an Upgrade.
- **Packs record their versions.** `packs.<id>` is `{version, config}`: the pack's format version the world was authored against, and its config.
- **The POV is never capped.** `pov` names an entity, and its levels follow the realism settings whatever its tier.

### Export file (`lre-world-export-v1`)

```json
{ "format": "lre-world-export-v1", "world": { "format": "lre-world-v1", "id": "harbor", "name": "Harbor", "…": "…" } }
```

The world's lore travels inside it; World Books don't. Importing makes a new world from the file and lists every macro in its lore and templates for review before anyone plays it (README, "Worlds from other people can carry macros"). `load` also takes a bare document.

### Map (`lre-map-v1`)

A map is a JSON document in the world's `maps`, keyed by its `id`. A grid map draws an interior with `layout` rows and a `legend`; a node map draws a town or a region with `places` and `links`. The schema's descriptions say what each part does, and the user guide's [Maps](USER-GUIDE.md#maps) section walks through both kinds.

```json
{
  "id": "inn_ground",
  "scope": "inn",
  "cellMeters": 2,
  "layout": ["#######", "#ttt+k#", "#######"],
  "legend": { "t": { "place": "taproom" }, "k": { "place": "kitchen" } },
  "places": [{ "id": "taproom", "name": "Taproom" }, { "id": "kitchen", "name": "Kitchen" }]
}
```

## Schemas

`schemas/lre-world-v1.schema.json` describes a world as this engine writes it, every collection and part, and `src/shared/lre-map-v1.schema.json` describes a map; the world schema's `maps` refer to the map schema by its `$id`. Both are JSON Schema 2020-12 written with a small set of keywords (`type`, `enum`, `required`, `properties`, `additionalProperties`, `propertyNames`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `anyOf`, `$ref` and `$defs`), so any validator reads them, and so does the engine's own `checkSchema`, which Build's map editor runs on every keystroke. Give a general validator both files and it resolves the `$ref` by `$id`; give `checkSchema` the map schema in `others`.

The schema is stricter than `validate`: it checks every field, and it expects the current format, so check a document after `migrate` (`load` gives you a migrated one). Objects don't take keys they don't define, with three exceptions: values the world defines for itself (entity, place and relation `fields`, effect `args`, pack `config`, table rows), the currency (a template's notes travel with it), and `ruleset.combat`, whose parts the engine's lint checks instead. The schema checks shape only; references, formulas and the rest are lint's.

```ts
import { checkSchema, load, MAP_SCHEMA, pathText, type Schema } from "lumi-rp-engine/studio";
import schemaJson from "lumi-rp-engine/schemas/lre-world-v1.schema.json";

const WORLD_SCHEMA = schemaJson as unknown as Schema;
const loaded = load(text);
if (loaded.ok) {
  for (const p of checkSchema(WORLD_SCHEMA, loaded.world, [MAP_SCHEMA])) console.log(`${pathText(p.path)}: ${p.message}`);
  // e.g. "entities.you.tier: should be text", "maps.inn_ground.layout[1]: should be text"
}
```

## Versioning

- **`WORLD_FORMAT`** names the document format, `lre-world-v1`. Additions that older documents can do without stay within it, through migration; a change that can't would be a new format name.
- **`ENGINE_VERSION`** is stamped on every document the engine writes (`engineVersion`). Nothing reads it back: it says which engine last wrote the file.
- **`PACK_VERSIONS`** lists the packs this engine ships with their format versions, which `packs.<id>.version` records in a world.
- **Migrate on read.** Revisions are immutable, so the engine brings a document up to date whenever it reads one: at load, from storage, at import and here in `load`. `migrate` fills what older documents lack: Modern US currency, no lore, an empty lore lookup table (a malformed one keeps its well-formed half), no classifications, no maps and the three default tiers. It moves a POV still on the legacy `pov` tier to the lead tier, drops step templates of the retired `select` purpose, renames the economy pack's old `unpricedCapCents` to `unpricedCap`, and last compiles the maps. A world without a ruleset keeps none. A studio that reads with `load` and writes what it got always writes the current shape.

## Lumiverse discovery

While LumiRPEngine runs, its frontend dispatches a `lre-state-v1` window event (a `CustomEvent`) when it loads and again whenever the set of packs in play changes. Its `detail` is what `studioState` returns:

```json
{ "engineVersion": "0.1.0", "worldFormat": "lre-world-v1", "packs": { "engine": 1, "calendar": 1, "…": 1 }, "inbound": ["file"] }
```

`inbound` lists the ways a world can come in. Today that is `file`: the player imports an export file in Build, which makes a new world. A studio-published endpoint (`rpc:<endpoint>`) is not built yet.

## Examples

A small world, linted and played:

```ts
import { lint, newWorld, playtest } from "lumi-rp-engine/studio";

const world = newWorld("harbor", "Harbor");
world.places.pier = { id: "pier", name: "The pier", fields: {} };
world.routes.home_pier = { id: "home_pier", from: "home", to: "pier", modes: { walk: { minutes: 10 } }, bidirectional: true };

lint(world); // []
const run = playtest(world, ["I walk to the pier", "wait"]);
// run.turns[0]: { user: "I walk to the pier", reply: "You → The pier\nYou: travel", notes: ["+10 min", "read as Go to"] }
// run.turns[1]: { user: "wait", reply: "(nothing changed)", notes: ["+2 min", "not an action"] }
```

A round trip through an export file:

```ts
import { exportFile, load, revisionOf } from "lumi-rp-engine/studio";

const file = JSON.stringify(exportFile(world));
const back = load(file);
if (back.ok) revisionOf(back.world) === revisionOf(world); // true: nothing to migrate
```

A document that isn't one:

```ts
load(JSON.stringify({ ...world, places: [] }));
// { ok: false, issues: [{ severity: "error", path: "places", code: "shape", message: "places must be an object" }] }
```

Three days of the world, as the author sees them:

```ts
import { checkWorld } from "lumi-rp-engine/studio";

for (const day of checkWorld(world, 3).turns) console.log(day.user, day.notes, day.reply);
```
