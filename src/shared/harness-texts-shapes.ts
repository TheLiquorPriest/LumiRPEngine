// What one item of each collection of the world's document looks like, and each of its parts, as
// `world_shape` answers it: registry texts of the page "Harness engine", gathered by
// `harness-texts-world.ts`. An agent writes these as JSON by hand (`world_put`, `world_set`,
// `world_patch`), so each says the members by their exact names, which of them are required and
// the values an enum takes.
//
// A member's name is written between backticks, and only a member's name is: a test reads every
// such name against the world's schema (`schemas/lre-world-v1.schema.json`), so a shape can't name
// a member the document doesn't have, nor leave out one it requires.

import { answerPrompt, lines } from "./harness-text-kit";
import type { PromptDef } from "./prompts";
import type { WorldCollection, WorldPart } from "./protocol";

/** The id of the shape text of a collection or a part. */
export const shapeTextId = (of: WorldCollection | WorldPart): string => `harness.shape.${of}`;

/** One item of each collection. */
export const COLLECTION_SHAPES: Readonly<Record<WorldCollection, string>> = {
  kinds: lines(
    "A kind of entity, keyed by its id. Required: `id`, `label`, `fields`. Optional: `extends` (the kind whose fields it also has).",
    "`fields` is an object, field id to field. A field needs `type` (number, text, bool, enum, ref, list, dice, money, date or duration) and may have `label`, `default`, `min`, `max`, `values` (what an enum takes), `ref` (the kind a ref names), `of` (what a list holds), `derived` (an expression that computes it), `visibility` (public, known_by or secret) and `knownBy`.",
  ),
  relations: "A type of relation between entities, keyed by its id. Required: `id`, `label`, `from` and `to` (the kinds it joins), `cardinality` (one_one, one_many, many_one or many_many), `symmetric` (true or false), `fields` (field id to field, as a kind's; {} for none). Optional: `inverse` (the relation type read from the other side).",
  entities: lines(
    "A person, a thing or anything else the world holds, keyed by its id. Required: `id`, `kind` (a kind's id), `name`, `tier` (a tier's id), `fields` (field id to value, as its kind defines them; the field named place is where it is), `relations` (a list, [] for none: each `type`, `to` and optional `fields`).",
    "Optional: `agent` (true: it acts on its own), `visibility` (public, known_by, secret or discoverable) with `knownBy` (a selector such as `ids`), `tags`, `characterId` (the host's character it is), `cues`, `levels`.",
  ),
  places: lines(
    "A place, keyed by its id. Required: `id`, `name`, `fields` ({} for none). Optional: `parent` (the place it is inside), `timeZone`, `sceneType`, `grid` with `cell` (`x`, `y`: where on that grid it is), `visibility` (public, known_by, secret or discoverable) with `knownBy`, `adjudicate`.",
    "`map` is written only by a map: a place a map draws is changed in its map, and a write to it here is refused. A place also has a tool of its own, which needs no hand-written JSON.",
  ),
  routes: lines(
    "A path between two places, keyed by its id. Required: `id`, `from` and `to` (place ids), `modes`, `bidirectional` (true: it is travelled both ways).",
    "`modes` has a leg for each way the path is travelled, any of `walk`, `road`, `offroad` and `water`: a leg needs `minutes` and may have `distanceKm` and `terrain`. `map` is written only by a map that draws the path.",
  ),
  grids: lines(
    "A grid of cells a place is drawn on, keyed by its id. Required: `id`, `width`, `height`, `terrain` (one terrain code for each cell, row by row: width times height of them), `blocked` (the indexes of the cells nothing crosses), `zones` (zone id to cell indexes; {} for none).",
    "Optional: `cellMeters`, `items` (thing id to the index of the cell it starts on). `map` is written only by a map: a grid a map draws is changed in its map.",
  ),
  maps: lines(
    "A map of one place, keyed by its id: the store compiles it into the places inside its `scope`, their paths and a grid, which the map then owns. Required: `id`, `scope` (the id of the place it draws).",
    "A grid map draws an interior: `layout` (rows of characters, top first, one character for each cell, every row the same length), `legend` (what each character stands for), `size`, `cellMeters`. A node map draws a town or a region: `places` (each `id`, `name`, `at`) and `links` (each `from`, `to`, `minutes`, optional `mode`). A map also has a tool of its own, which needs no hand-written JSON.",
  ),
  rules: lines(
    "A rule the engine runs by itself, keyed by its id. Required: `id`, `on` (what fires it, an object with one of `event` (an event type), `tick` (turn, slot or day), `enter` (a place id) or `at` (an expression)), `do` (a list of effects, each `type` and `args`).",
    "Optional: `when` (an expression that must hold), `once`, `cooldownMinutes`, `interrupt` (true: it stops a timelapse), `beat` (`hint`, `weight`: an outline hint offered when it fires).",
  ),
  actions: lines(
    'Something a character can do, keyed by its id. Required: `id`, `label`, `params` (name to `type`, with `ref` or `optional`; {} for none), `requires` (expressions that must hold; [] for none), `outcomes` (outcome name to a list of effects, each `type` and `args`; the outcome named default when there is no check), `duration` (minutes, as an expression: "5").',
    "Optional: `description`, `check` (a check's id, or a check written in place with its `dice` and `dc`), `activity`, `lexicon` (ways a player says it), `observable` (what others see of it), `adjudicate`.",
  ),
  checks: lines(
    "A roll, keyed by its id. Required: `id`, `dice` (d20, 2d6). Optional: `modifier` and `dc` (expressions), `advantage` (-1, 0 or 1), `vs` (an opposed roll: `who`, `check`), `bands` (each `outcome` with the `min` and `max` of its margin), `pass` (the outcomes that count as a success), `auto`.",
    "With `dc` and no `bands` the outcomes are failure and success.",
  ),
  schedules: lines(
    "A recurring timetable that sets a field, keyed by its id: shifts, weather, bills. Required: `id`, `target` (the field it sets: place, activity, weather), `recurrence` (`every`: day, week, month or year; `weekdays`, 0 for Sunday; `days` of the month; `except`: holiday ids), `slots` (each `start` and `end` as HH:MM, with `value` or `weighted`, a list of `value` and `weight`).",
    "Optional: `owner` (whose it is: an entity's id, a kind's id or a selector; none for the world's own, such as weather).",
  ),
  tracks: lines(
    "A quest, a secret, a puzzle or an agenda, keyed by its id. Required: `id`, `kind` (quest, secret, puzzle or agenda), `label`, `start` (the id of its first stage), `stages` (stage id to stage), `visibility` (public, known_by or secret).",
    "A stage needs `label` and `next` (a list of `to`, a stage id, and `when`, an expression; [] for a last stage), and may have `objectives`, `effects`, `rewards`, `gate`, `fail`, `cue` (what the player is told), `truth` (the game master's only) and `hints`. Optional on the track: `owner`, `knownBy`.",
  ),
  tables: lines(
    "A data table, keyed by its id. Required: `id`, `pack` (the pack that owns it), `schema` (the row layout that pack reads: lre-table/<table id>/v1), `revision` (worked out from the table, never authored: keep the one a table has), `label`, `columns` (column id to `type`: int, number, text, bool, band, enum, ref, list or json; with `unit`, `values`, `optional`, `doc`), `rows` (row id to an object, column id to value).",
    "Optional: `source` (where shipped data came from). Read a table the draft has before writing one.",
  ),
  sections: lines(
    "A section of what the reply's writer is given of the world, keyed by its id. Required: `id`, `label`, `rank` (its order, lowest first), `template` (its text), `position` (`type` native; or outlet with `name`; or chat_depth with `role`, `depth` and `direction`).",
    "Optional: `enabled`, `maxTokens`, `maxLines`, `include`, `scope` (player, scene or gm: whose knowledge it reads).",
  ),
  steps: "The world's own text for one of the engine's steps, keyed by its id. Required: `id`, `purpose` (interpret, npc.choose, puzzle.answer, brief, outline, extract, choices, judge, mind, memory, skip, consolidate or knowledge), `template`, `output` (text, effects or decision), `signals` (a list of names; [] for none).",
  packs: "A pack the world plays with, keyed by the pack's id. Required: `version` (a whole number) and `config` (the pack's own settings, an object; {} for its defaults). Read one the draft has before writing one.",
  lore: lines(
    "A lore entry of the world's own, keyed by its id. Required: `id`, `title`, `content` (its text), `keys` (words that bring it up; [] for none), `links` (the ids of the entities and places it is about; [] for none).",
    "Optional: `aliases`, `topics`, `group`, `priority`, `visibility` (public or known_by) with `holders` (who knows it), `secret`, `gate` (an expression), `audience`, `source` (`kind` authored for the world's own; never book: World Info is read live, and a copy of it is refused).",
  ),
  classifications: "A way of classifying entities (story role, disposition), keyed by its id. Required: `id`, `label`, `multiple` (true: an entity may hold several values), `values` (value id to `label`, with optional `parent` and `description`). Optional: `order`, `shown`.",
  routines: lines(
    "A routine of a person or a group, keyed by its id. Required: `id`, `blocks` (a list; each block needs an `id` of its own). Optional on the routine: `label`, `owner` (an entity's id, a kind's id or a selector), `inherit`.",
    "A block may have `label`, `activity`, `kind` (fixed, flexible or optional), `at` (HH:MM) or `window` (`from`, `to`), `minutes`, `perWeek`, `chance`, `priority`, `days` (`weekdays`, 0 for Sunday; `holidays`; `seasons`), `place` (home, work, here, with, or an object with `place` or `nearest`), `company`, `needs`, `private`.",
  ),
};

/** Each part, whole, as `world_set` takes it. */
export const PART_SHAPES: Readonly<Record<WorldPart, string>> = {
  calendar: lines(
    "The world's calendar. Required: `system` (gregorian or custom), `epoch` (when the story's clock starts, a local date and time: 2026-10-16T06:00), `timeZone`, `dayParts` (a list of `id`, `label` and `start` as HH:MM), `holidays` (a list of `id`, `label`, `rule` and `dayOff`; [] for none).",
    "A holiday's `rule` has `type` fixed with `month` and `day`; nth_weekday with `month`, `weekday` and `n`; relative with `to` (a holiday's id) and `days`; or easter with `days`. A custom calendar also needs `custom`: `monthLengths`, `monthNames`, `weekdayNames`.",
  ),
  realism: lines(
    "How closely the world is simulated. Required: `preset` (story, grounded, simulation or custom), `levels` (a whole number for each of `money`, `gear`, `vehicles`, `castlife`, `relationships`, `space`, `calendar`, `weather` and `sheets`), `tierCaps` (the most each band is simulated: `principal`, `supporting`, `background`, each an object of those same domains).",
    "Optional: `claims` (how what the player claims is taken: `mode` real, ask or hold; `capped`).",
  ),
  time: "How time passes. Required: `sceneTicks` (scene type to the minutes a turn of it takes), `interrupts` (stop, note or ignore for each of `invitation`, `bill`, `decline`, `incident`, `quest`, `rule`, `arrival`, `overdue`, `needs` and `weather`), `speedThrough` (name to `mode`, offer or auto, and `thresholdMinutes`), `montage` (key, day or week), `unitCap` (`agentDays`, `events`).",
  meta: lines(
    "The world's own settings, which sit at the root of the document; a write changes only the members it gives. `name`, `pov` (the player character's id), `start` (`place` and `at`, a local date and time), `seedMode` (fresh or same_roll), `lenientPricing`, `currency` (`code`, `symbol`, `minorUnit`, `decimals`, `format`), `narrator` (`knowledge` scene or pov, `secrets` marked or omit; null for none).",
    "Also `spawnCap`, `placeCap`, `placesPerTurn`, `lifeStates` (state id to `label`, `acts`, `reads`), `mapSettings` and `loreBooks` (the World Info books the world reads lore from).",
  ),
  tiers: lines(
    "The tiers entities sit in, and the tier a newcomer gets: an object with `tiers` (tier id to tier) and optional `spawnTier` (a tier's id).",
    "A tier needs `label`, `band` (principal, supporting or background) and `order` (its place in lists, lowest first), and may have `agentDefault` and `description`.",
  ),
  ruleset: lines(
    "The world's ruleset, optional: {} removes it. `progression` (id to `label`, `xpField`, `levelField`, `thresholds`), `sheet` (`sections`, each `id`, `label`, `rows`), `minLevels`, `adjudication` (when a check is rolled: `preset`, `checks`, `authority`, `retry` and its numbers), `inferred` (`mode` off, suggest or auto), `combat` (`stalemate`), `profile`.",
    "Read the draft's own before writing it: its adjudication is written with every member it has.",
  ),
  loreIndex: "The lore lookup table. Required: `terms` (a word to the ids of the lore entries it brings up; {} for none), `topics` (topic id to `label` and `entries`, lore entry ids; {} for none).",
  minds: "How the world's characters think, optional: only what is given is kept, and {} removes it. `secrecy` (full or brief), `thresholds` (`live`, `near`, `far`: numbers), `always` and `never` (a selector such as `ids`, or null), `weights`, `memory`, `holdings`.",
  lorePins: "Lore pinned to a character, a place or a step: pins that pin nothing remove it. `characters`, `places` and `steps` are each an object, id to a list of pins. A pin is `lore` (a lore entry's id), or `book` with `entry` (a World Info entry), or `book` alone (the whole book), each with optional `keep` (start or end).",
  routineSettings: "How routines bear on play: the defaults remove it. `awareness` (story_first, balanced or routine_first), `invitations` (off, player or everyone), `sociability` (reserved, usual or outgoing), `planBend` (must, strong, standard or ordinary), `roles` (informative, enforced or off) and `skips` (stay, routine or model), each for `live`, `near`, `far` and `background`, `narrator`, `paletteFollowsRoutine`.",
  needs: "The needs characters feel: only what differs from the defaults is kept. `hunger`, `fatigue`, `social` and `fun`, each with `on` (true or false), `rate`, `tell` and `alert` (numbers).",
};

/** The shape texts as registry texts: each collection's, then each part's. */
export const SHAPE_PROMPTS: readonly PromptDef[] = [
  ...Object.entries(COLLECTION_SHAPES).map(([name, text]) => answerPrompt(shapeTextId(name as WorldCollection), `Shape: one of ${name}`, `world_shape's answer for the collection ${name}: what one item of it looks like. Member names stay between backticks, exactly as the document has them.`, text)),
  ...Object.entries(PART_SHAPES).map(([name, text]) => answerPrompt(shapeTextId(name as WorldPart), `Shape: the ${name} part`, `world_shape's answer for the part ${name}: what world_set takes for it. Member names stay between backticks, exactly as the document has them.`, text)),
];
