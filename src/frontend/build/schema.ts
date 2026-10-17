// Form descriptors for the world document (`shared/world.ts`), driving the schema-driven Build
// editors (DESIGN §13). One descriptor per collection; packs override a collection's editor through
// `UiRegistry.editor`, and the descriptors stay the default.

import type { JsonObject } from "../../shared/json";
import { DOMAINS } from "../../shared/ids";
import type { WorldCollection, WorldPart } from "../../shared/protocol";
import { spawnTierOf } from "../../shared/tiers";
import type { WorldDoc } from "../../shared/world";

export type RefCollection = "kinds" | "relations" | "entities" | "places" | "grids" | "checks" | "tracks" | "tables";

export type FieldSpec =
  | { kind: "text"; key: string; label: string; multiline?: boolean; optional?: boolean; readonly?: boolean; hint?: string }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; optional?: boolean; hint?: string }
  | { kind: "bool"; key: string; label: string; hint?: string }
  | { kind: "enum"; key: string; label: string; values: readonly string[]; optional?: boolean }
  /** `inline`: the value may also be an inline definition, which is then edited as JSON. */
  | { kind: "ref"; key: string; label: string; collection: RefCollection; optional?: boolean; any?: boolean; inline?: boolean }
  | { kind: "refs"; key: string; label: string; collections: readonly RefCollection[] }
  | { kind: "expr"; key: string; label: string; optional?: boolean }
  /** An effect's arguments: each a value, or a `=` formula in the expression editor's effect mode (where `roll()` works). */
  | { kind: "effectArgs"; key: string; label: string }
  | { kind: "dice"; key: string; label: string; optional?: boolean }
  | { kind: "tags"; key: string; label: string }
  /** Free-form labels as chips, suggesting the tags other entities already use. */
  | { kind: "tagList"; key: string; label: string }
  /** A selector (`shared/world.ts` `Selector`): kinds, tiers, classes, tags, groups, ids. `when`: shown only while a sibling field holds one of these values. */
  | { kind: "selector"; key: string; label: string; optional?: boolean; when?: { key: string; values: readonly string[] } }
  /** An entity's classification: one picker per facet, single or multiple as the facet says. */
  | { kind: "classes"; key: string; label: string }
  /** A facet's values as a tree: label, parent value, description. */
  | { kind: "facetValues"; key: string; label: string }
  | { kind: "list"; key: string; label: string; item: FieldSpec; title?: string }
  | { kind: "record"; key: string; label: string; item: FieldSpec; keyLabel: string; keys?: readonly string[] }
  | { kind: "object"; key: string; label: string; fields: FieldSpec[]; optional?: boolean }
  | { kind: "json"; key: string; label: string; optional?: boolean; hint?: string }
  | { kind: "kindFields"; key: string; label: string }
  /** A level per domain. `floored`: the world ruleset's floors (`ruleset.minLevels`) are shown and nothing below them can be picked. */
  | { kind: "levels"; key: string; label: string; floored?: boolean }
  /** One of the world's tiers (`WorldDoc.tiers`), in their order. */
  | { kind: "tier"; key: string; label: string }
  /** The LOD1 agent flag: yes, no, or (unset) the entity's tier's default. */
  | { kind: "agent"; key: string; label: string }
  /** A cap per domain for each detail band, keyed by band id. */
  | { kind: "bandCaps"; key: string; label: string };

export const FIELD_TYPES = ["number", "text", "bool", "enum", "ref", "list", "dice", "money", "date", "duration"] as const;
const BOUND_MODES = ["auto", "confirm", "never"] as const;
const VISIBILITY = ["public", "known_by", "secret"] as const;
/** Places may also be hidden until the POV has been there or hears of them. */
const PLACE_VISIBILITY = ["public", "known_by", "discoverable", "secret"] as const;
const TRAVEL_MODES = ["walk", "road", "offroad", "water"] as const;

const BAND: FieldSpec = {
  kind: "object",
  key: "",
  label: "Band",
  fields: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "number", key: "min", label: "From (inclusive)", optional: true },
    { kind: "number", key: "max", label: "To (exclusive)", optional: true },
  ],
};

export const FIELD_DEF: FieldSpec = {
  kind: "object",
  key: "",
  label: "Field",
  fields: [
    { kind: "enum", key: "type", label: "Type", values: FIELD_TYPES },
    { kind: "text", key: "label", label: "Label", optional: true },
    { kind: "json", key: "default", label: "Default", optional: true },
    { kind: "number", key: "min", label: "Min", optional: true },
    { kind: "number", key: "max", label: "Max", optional: true },
    { kind: "tags", key: "values", label: "Enum values" },
    { kind: "ref", key: "ref", label: "Ref kind", collection: "kinds", optional: true },
    { kind: "enum", key: "of", label: "List of", values: FIELD_TYPES.filter((t) => t !== "list"), optional: true },
    { kind: "list", key: "bands", label: "Bands (shown as words)", item: BAND, title: "label" },
    { kind: "expr", key: "derived", label: "Derived formula", optional: true },
    { kind: "bool", key: "locked", label: "Locked (never offered to a model)" },
    {
      kind: "object",
      key: "bound",
      label: "Bound on model changes",
      optional: true,
      fields: [
        { kind: "enum", key: "mode", label: "Mode", values: BOUND_MODES },
        { kind: "number", key: "maxDelta", label: "Largest change per turn", optional: true },
      ],
    },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY, optional: true },
    { kind: "selector", key: "knownBy", label: "Known by (besides a knows relation)", optional: true, when: { key: "visibility", values: ["known_by"] } },
    { kind: "enum", key: "domain", label: "Realism domain", values: DOMAINS, optional: true },
    { kind: "number", key: "level", label: "Live from level", min: 0, max: 4, step: 1, optional: true },
  ],
};

/** One effect, as rules' `do` and progressions' `onLevel` list them. */
export const EFFECT: FieldSpec = {
  kind: "object",
  key: "",
  label: "Effect",
  fields: [
    { kind: "text", key: "type", label: "Effect type", hint: "e.g. set, add, economy.charge" },
    { kind: "effectArgs", key: "args", label: "Arguments (values or formulas)" },
  ],
};

export const COLLECTION_SPECS: Record<WorldCollection, FieldSpec[]> = {
  kinds: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "extends", label: "Extends", collection: "kinds", optional: true },
    { kind: "record", key: "fields", label: "Fields", item: FIELD_DEF, keyLabel: "Field id" },
    { kind: "text", key: "pack", label: "Pack", optional: true, readonly: true },
  ],
  relations: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "from", label: "From kind", collection: "kinds", any: true },
    { kind: "ref", key: "to", label: "To kind", collection: "kinds", any: true },
    { kind: "enum", key: "cardinality", label: "Cardinality", values: ["one_one", "one_many", "many_one", "many_many"] },
    { kind: "bool", key: "symmetric", label: "Symmetric", hint: "Both sides hold it (siblings); the engine keeps the other side" },
    { kind: "ref", key: "inverse", label: "Inverse (what the other side holds back)", collection: "relations", optional: true },
    { kind: "record", key: "fields", label: "Fields", item: FIELD_DEF, keyLabel: "Field id" },
  ],
  entities: [
    { kind: "text", key: "name", label: "Name" },
    { kind: "ref", key: "kind", label: "Kind", collection: "kinds" },
    { kind: "tier", key: "tier", label: "Tier" },
    { kind: "classes", key: "class", label: "Classification" },
    { kind: "tagList", key: "tags", label: "Tags" },
    { kind: "kindFields", key: "fields", label: "Fields" },
    {
      kind: "list",
      key: "relations",
      label: "Relations",
      title: "type",
      item: {
        kind: "object",
        key: "",
        label: "Relation",
        fields: [
          { kind: "ref", key: "type", label: "Type", collection: "relations" },
          { kind: "ref", key: "to", label: "To", collection: "entities" },
          { kind: "json", key: "fields", label: "Fields", optional: true },
          { kind: "number", key: "until", label: "Until (game minutes)", optional: true },
        ],
      },
    },
    { kind: "levels", key: "levels", label: "Level overrides" },
    { kind: "agent", key: "agent", label: "Lives their own day (agendas and plans)" },
    { kind: "text", key: "characterId", label: "Lumiverse character id", optional: true },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY, optional: true },
    { kind: "selector", key: "knownBy", label: "Known by (besides a knows relation)", optional: true, when: { key: "visibility", values: ["known_by"] } },
  ],
  places: [
    { kind: "text", key: "name", label: "Name" },
    { kind: "ref", key: "parent", label: "Inside", collection: "places", optional: true },
    { kind: "text", key: "timeZone", label: "Time zone (IANA)", optional: true, hint: "Inherited from the parent when empty" },
    { kind: "text", key: "sceneType", label: "Default scene type", optional: true },
    { kind: "bool", key: "adjudicate", label: "Checks roll here", hint: "Marked for a world whose checks roll only where marked: here and in the places inside it" },
    { kind: "ref", key: "grid", label: "Grid", collection: "grids", optional: true },
    {
      kind: "object",
      key: "cell",
      label: "Cell on the parent's grid",
      optional: true,
      fields: [
        { kind: "number", key: "x", label: "x", min: 0, step: 1 },
        { kind: "number", key: "y", label: "y", min: 0, step: 1 },
      ],
    },
    {
      kind: "object",
      key: "layoutPos",
      label: "Position on the parent's node map",
      optional: true,
      fields: [
        { kind: "number", key: "x", label: "x", step: 1 },
        { kind: "number", key: "y", label: "y", step: 1 },
      ],
    },
    { kind: "json", key: "fields", label: "Fields" },
    { kind: "enum", key: "visibility", label: "Visibility", values: PLACE_VISIBILITY, optional: true },
    { kind: "selector", key: "knownBy", label: "Known by (besides a knows relation)", optional: true, when: { key: "visibility", values: ["known_by", "discoverable"] } },
  ],
  routes: [
    { kind: "ref", key: "from", label: "From", collection: "places" },
    { kind: "ref", key: "to", label: "To", collection: "places" },
    {
      kind: "record",
      key: "modes",
      label: "Modes",
      keyLabel: "Mode",
      keys: TRAVEL_MODES,
      item: {
        kind: "object",
        key: "",
        label: "Leg",
        fields: [
          { kind: "number", key: "minutes", label: "Minutes", min: 0 },
          { kind: "number", key: "distanceKm", label: "Distance (km)", min: 0, optional: true },
          { kind: "text", key: "terrain", label: "Terrain", optional: true },
        ],
      },
    },
    { kind: "bool", key: "bidirectional", label: "Both directions" },
  ],
  grids: [
    { kind: "number", key: "width", label: "Width", min: 1, step: 1 },
    { kind: "number", key: "height", label: "Height", min: 1, step: 1 },
    { kind: "number", key: "cellMeters", label: "Cell size (m)", optional: true },
    { kind: "json", key: "terrain", label: "Terrain (row-major)" },
    { kind: "json", key: "blocked", label: "Blocked cells" },
    { kind: "json", key: "zones", label: "Zones" },
  ],
  maps: [
    { kind: "text", key: "title", label: "Title", optional: true },
    { kind: "ref", key: "scope", label: "Draws the inside of", collection: "places" },
    { kind: "json", key: "size", label: "Size [width, height]", optional: true },
    { kind: "json", key: "layout", label: "Layout rows", optional: true },
    { kind: "json", key: "legend", label: "Legend", optional: true },
    { kind: "json", key: "places", label: "Places", optional: true },
    { kind: "json", key: "links", label: "Links", optional: true },
  ],
  rules: [
    { kind: "json", key: "on", label: "Trigger", hint: '{"event": "…"} · {"tick": "turn|slot|day"} · {"enter": "place"} · {"at": "formula"} · with the grid system on, {"zone": "…", "in": "place"} or {"cell": [x, y], "in": "place"}, and "who": a selector (else the POV)' },
    { kind: "expr", key: "when", label: "When", optional: true },
    { kind: "list", key: "do", label: "Do", item: EFFECT, title: "type" },
    { kind: "bool", key: "once", label: "Once" },
    { kind: "number", key: "cooldownMinutes", label: "Cooldown (min)", optional: true },
    { kind: "bool", key: "interrupt", label: "Interrupts a timelapse" },
    {
      kind: "object",
      key: "beat",
      label: "Storylet beat",
      optional: true,
      fields: [
        { kind: "text", key: "hint", label: "Outline hint" },
        { kind: "number", key: "weight", label: "Weight", optional: true },
      ],
    },
  ],
  actions: [
    { kind: "text", key: "label", label: "Label" },
    {
      kind: "record",
      key: "params",
      label: "Parameters",
      keyLabel: "Parameter",
      item: {
        kind: "object",
        key: "",
        label: "Parameter",
        fields: [
          { kind: "enum", key: "type", label: "Type", values: FIELD_TYPES },
          { kind: "text", key: "label", label: "Label", optional: true },
          { kind: "ref", key: "ref", label: "Ref kind", collection: "kinds", optional: true },
          { kind: "bool", key: "optional", label: "Optional" },
          { kind: "selector", key: "of", label: "Only candidates matching", optional: true },
        ],
      },
    },
    { kind: "list", key: "requires", label: "Requires", item: { kind: "expr", key: "", label: "Requirement" } },
    { kind: "ref", key: "check", label: "Check", collection: "checks", optional: true, inline: true },
    { kind: "json", key: "outcomes", label: "Effects per outcome" },
    { kind: "expr", key: "duration", label: "Duration (minutes)" },
    {
      kind: "object",
      key: "activity",
      label: "Starts an activity",
      optional: true,
      fields: [
        { kind: "text", key: "type", label: "Activity", hint: "sleep, work_shift, travel, waiting, …" },
        { kind: "expr", key: "until", label: "Until" },
      ],
    },
    { kind: "tags", key: "lexicon", label: "Verbs and phrases" },
    { kind: "text", key: "observable", label: "Observable label", optional: true },
    { kind: "bool", key: "adjudicate", label: "Its check always rolls", hint: "Marked for a world whose checks roll only where marked" },
    {
      kind: "object",
      key: "combat",
      label: "Combat action (offered only where the ruleset has combat)",
      optional: true,
      fields: [
        { kind: "record", key: "cost", label: "Cost (budget → how many)", keyLabel: "Budget", item: { kind: "number", key: "", label: "How many", min: 0, step: 1 } },
        { kind: "bool", key: "start", label: "Starts a fight (taken only when none is under way)" },
        { kind: "enum", key: "role", label: "Everyone else's tactics use it to", values: ["attack", "defend"], optional: true },
      ],
    },
  ],
  checks: [
    { kind: "dice", key: "dice", label: "Dice" },
    { kind: "expr", key: "modifier", label: "Modifier", optional: true },
    {
      kind: "list",
      key: "bands",
      label: "Outcome bands",
      title: "outcome",
      item: {
        kind: "object",
        key: "",
        label: "Band",
        fields: [
          { kind: "text", key: "outcome", label: "Outcome" },
          { kind: "number", key: "min", label: "Min total", optional: true },
          { kind: "number", key: "max", label: "Max total", optional: true },
        ],
      },
    },
    { kind: "tags", key: "pass", label: "Outcomes that count as success (empty: success and every band after it)" },
    { kind: "text", key: "auto", label: "Outcome when not rolled", optional: true, hint: "Used when neither the action nor the check has a success outcome" },
  ],
  schedules: [
    { kind: "json", key: "owner", label: "Owner", optional: true, hint: '"entity, group or kind id" · {"kind": [...], "class": {...}, "memberOf": [...]} (a selector)' },
    { kind: "text", key: "target", label: "Sets" },
    { kind: "json", key: "recurrence", label: "Recurrence" },
    { kind: "json", key: "slots", label: "Slots" },
  ],
  tracks: [
    { kind: "enum", key: "kind", label: "Kind", values: ["quest", "secret", "puzzle", "agenda"] },
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "owner", label: "Owner", collection: "entities", optional: true },
    { kind: "text", key: "start", label: "Start stage" },
    { kind: "json", key: "stages", label: "Stages" },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY },
    { kind: "selector", key: "knownBy", label: "Known by (besides its owner and those who know the owner)", optional: true, when: { key: "visibility", values: ["known_by"] } },
    { kind: "bool", key: "adjudicate", label: "Checks roll while it's in progress", hint: "Marked for a world whose checks roll only where marked" },
  ],
  tables: [{ kind: "json", key: "rows", label: "Rows" }],
  sections: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "number", key: "rank", label: "Rank (lower is reserved first)", step: 1 },
    { kind: "text", key: "template", label: "Template", multiline: true },
    { kind: "json", key: "position", label: "Position", hint: '{"type":"native"} · {"type":"outlet","name":"…"} · {"type":"chat_depth",…}' },
  ],
  steps: [
    { kind: "enum", key: "purpose", label: "Purpose", values: ["interpret", "npc.choose", "contradiction", "puzzle.answer", "brief", "outline", "extract", "choices", "judge"] },
    { kind: "text", key: "template", label: "Template", multiline: true },
    { kind: "enum", key: "output", label: "Output", values: ["text", "effects", "decision"] },
    { kind: "tags", key: "signals", label: "Signals" },
  ],
  packs: [
    { kind: "number", key: "version", label: "Format version", step: 1 },
    { kind: "json", key: "config", label: "Config" },
  ],
  // Build's lore form (`lore-editor.tsx`) lays these out around the aliases, topics, source and audience.
  lore: [
    { kind: "text", key: "title", label: "Title" },
    { kind: "text", key: "content", label: "Content", multiline: true },
    { kind: "tags", key: "keys", label: "Keywords" },
    { kind: "refs", key: "links", label: "Links (entities and places)", collections: ["entities", "places"] },
    { kind: "text", key: "group", label: "Group", optional: true, hint: "Entries sharing a group are alternatives to each other" },
    { kind: "number", key: "priority", label: "Priority", optional: true, step: 1, hint: "Higher comes first among otherwise equal entries" },
    { kind: "enum", key: "visibility", label: "Who may read it (Known by: once the player character knows everything it links)", values: ["public", "known_by"], optional: true },
    { kind: "bool", key: "secret", label: "Secret", hint: "Only the helpers you pick read it, until the gate holds" },
    { kind: "expr", key: "gate", label: "Gate (revealed once it holds)", optional: true },
  ],
  classifications: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "bool", key: "multiple", label: "Several values per entity", hint: "Off: one value each, like a story role. On: any number, like allegiances" },
    { kind: "bool", key: "shown", label: "Players can see this classification", hint: "Off: only Build and the GM side see it; Play's Cast never groups or filters by it" },
    { kind: "number", key: "order", label: "Order (lowest first)", optional: true, step: 1 },
    { kind: "text", key: "description", label: "Description", multiline: true, optional: true },
    { kind: "facetValues", key: "values", label: "Values" },
  ],
};

/** The schema-driven singletons; Tiers, Ruleset and the lore lookup table have their own editors (`tiers-editor.tsx`, `ruleset-editor.tsx`, `lookup-editor.tsx`). */
export const PART_SPECS: Record<Exclude<WorldPart, "tiers" | "loreIndex" | "ruleset">, FieldSpec[]> = {
  calendar: [
    { kind: "enum", key: "system", label: "System", values: ["gregorian", "custom"] },
    { kind: "text", key: "epoch", label: "Epoch (local ISO, e.g. 2026-10-16T06:00)" },
    { kind: "text", key: "timeZone", label: "Time zone (IANA)" },
    {
      kind: "list",
      key: "dayParts",
      label: "Day parts",
      title: "label",
      item: {
        kind: "object",
        key: "",
        label: "Day part",
        fields: [
          { kind: "text", key: "id", label: "Id" },
          { kind: "text", key: "label", label: "Label" },
          { kind: "text", key: "start", label: "Starts (HH:MM)" },
        ],
      },
    },
    {
      kind: "list",
      key: "holidays",
      label: "Holidays",
      title: "label",
      item: {
        kind: "object",
        key: "",
        label: "Holiday",
        fields: [
          { kind: "text", key: "id", label: "Id" },
          { kind: "text", key: "label", label: "Label" },
          { kind: "json", key: "rule", label: "Date rule" },
          { kind: "bool", key: "dayOff", label: "Day off" },
        ],
      },
    },
    { kind: "json", key: "custom", label: "Custom calendar (month lengths and names)", optional: true },
  ],
  realism: [
    { kind: "enum", key: "preset", label: "Preset", values: ["story", "grounded", "simulation", "custom"] },
    { kind: "levels", key: "levels", label: "Domain levels", floored: true },
    { kind: "bandCaps", key: "tierCaps", label: "Band caps" },
  ],
  time: [
    { kind: "record", key: "sceneTicks", label: "Default tick per scene type (min)", keyLabel: "Scene type", item: { kind: "number", key: "", label: "Minutes", min: 0, step: 0.5 } },
    { kind: "json", key: "interrupts", label: "Interrupt policy" },
    { kind: "json", key: "speedThrough", label: "Speed through" },
    { kind: "enum", key: "montage", label: "Montage", values: ["key", "day", "week"] },
    {
      kind: "object",
      key: "unitCap",
      label: "Unit cap",
      fields: [
        { kind: "number", key: "agentDays", label: "Agent-days", min: 1, step: 1 },
        { kind: "number", key: "events", label: "Events", min: 1, step: 1 },
      ],
    },
  ],
  meta: [
    { kind: "text", key: "name", label: "World name" },
    { kind: "ref", key: "pov", label: "Point of view", collection: "entities" },
    {
      kind: "object",
      key: "start",
      label: "Start",
      fields: [
        { kind: "ref", key: "place", label: "Place", collection: "places" },
        { kind: "text", key: "at", label: "At (local ISO)" },
      ],
    },
    { kind: "enum", key: "seedMode", label: "Re-run rolls", values: ["fresh", "same_roll"] },
    { kind: "bool", key: "lenientPricing", label: "Lenient pricing (accept narrated prices inside the band)" },
    {
      kind: "object",
      key: "currency",
      label: "Currency",
      fields: [
        { kind: "text", key: "code", label: "Code (ISO 4217 or your own, e.g. GP)" },
        { kind: "text", key: "symbol", label: "Symbol" },
        { kind: "text", key: "minorUnit", label: "Minor unit (cent, copper…)" },
        { kind: "number", key: "decimals", label: "Decimals (2 → 100 minor units per major)", min: 0, max: 6, step: 1 },
        { kind: "text", key: "format", label: "Format", hint: "{sign}{symbol}{amount} · {sign}{major} sp {minor} cp" },
      ],
    },
    {
      kind: "object",
      key: "mapSettings",
      label: "Map",
      fields: [
        { kind: "enum", key: "display", label: "The map shows (knowledge: what the POV knows, places only heard of dashed; fog: fog over what it hasn't seen)", values: ["knowledge", "fog"] },
        {
          kind: "object",
          key: "grid",
          label: "Grid system",
          fields: [
            { kind: "bool", key: "movement", label: "Grid movement", hint: "Walls and doors steer the POV across grids, things lie in cells, and cells and zones trigger rules; Space plays at 3 or more" },
            { kind: "number", key: "sightRadius", label: "Sight radius (cells the POV sees around it)", min: 0, max: 32, step: 1 },
          ],
        },
      ],
    },
  ],
};

/** A minimal valid value for a new item (the backend lints the rest); a new entity starts in the world's spawn tier, a new map draws the start place. */
export function newItem(collection: WorldCollection, id: string, world: Pick<WorldDoc, "tiers" | "spawnTier" | "start">): JsonObject {
  switch (collection) {
    case "kinds":
      return { id, label: id, fields: {} };
    case "relations":
      return { id, label: id, from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {} };
    case "entities":
      return { id, kind: "", name: id, tier: spawnTierOf(world), fields: {}, relations: [] };
    case "places":
      return { id, name: id, fields: {} };
    case "routes":
      return { id, from: "", to: "", modes: { walk: { minutes: 10 } }, bidirectional: true };
    case "grids":
      return { id, width: 16, height: 16, terrain: Array.from({ length: 256 }, () => "grass"), blocked: [], zones: {} };
    case "maps":
      return { id, scope: world.start.place, places: [] };
    case "rules":
      return { id, on: { tick: "turn" }, do: [] };
    case "actions":
      return { id, label: id, params: {}, requires: [], outcomes: { default: [] }, duration: "1" };
    case "checks":
      return { id, dice: "2d6", bands: [{ outcome: "fail", max: 6 }, { outcome: "success", min: 7 }] };
    case "schedules":
      return { id, target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: null }] };
    case "tracks":
      return { id, kind: "quest", label: id, start: "start", stages: { start: { label: "Start", next: [] } }, visibility: "public" };
    case "tables":
      return { id, pack: "", schema: `lre-table/${id}/v1`, revision: "", label: id, columns: {}, rows: {} };
    case "sections":
      return { id, label: id, rank: 50, template: "", position: { type: "native" } };
    case "steps":
      return { id, purpose: "brief", template: "", output: "text", signals: [] };
    case "packs":
      return { version: 1, config: {} };
    case "lore":
      return { id, title: id, content: "", keys: [], links: [] };
    case "classifications":
      return { id, label: id.replace(/_/g, " "), multiple: false, values: {} };
  }
}
