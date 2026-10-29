// The people family's GM writes (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a person's or thing's fields,
// tier, classes, life, coming and going, and relations, each proposed as the GM editor's operation
// (`EditOp`, read again for its shape by the writer). A name resolves only among what the agent's
// knowledge may name, so a hidden one reads as not found.

import { DOMAINS, LEVEL_LABEL } from "../../../../shared/ids";
import type { JsonObject } from "../../../../shared/json";
import { tiersInOrder } from "../../../../shared/tiers";
import { lifeStatesOf, type WorldDoc } from "../../../../shared/world";
import { BOOLEAN, boolArg, fieldValueArg, gmEdit, JSON_VALUE, missing, needId, NUMBER, propose, TEXT_LIST } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolDefinition } from "../registry";
import { type Resolved, resolveEntity, resolvePerson, resolvePlace } from "../resolve";
import { badValue, fieldEnum, jsonObject, kindEnum, needText, objectArg, objectSchema, schemaWorld, text, textArg } from "../schema";

/** The world's tier ids, lowest first. */
function tierIds(world: Pick<WorldDoc, "tiers">): string[] {
  return tiersInOrder(world).map(([id]) => id);
}

/** The fixed levels, lowest first. */
const LEVELS = Object.keys(LEVEL_LABEL)
  .map(Number)
  .sort((a, b) => a - b);
/** A domain's level that follows the tier: one below the lowest, so the schema is one integer type (Gemini takes no list of types, and no union). */
const FOLLOW_TIER = (LEVELS[0] ?? 0) - 1;
// A domain's level: one of the fixed levels, or FOLLOW_TIER to follow the tier.
const LEVEL: JsonObject = { type: "integer", minimum: FOLLOW_TIER, maximum: LEVELS.at(-1) ?? 0 };

/** A relation's far end: a person or thing, else a place (a relation to a place); one that is neither is told as a thing not found. */
function relationEnd(view: ToolReadView, said: string): Resolved {
  const entity = resolveEntity(view, said);
  if (!("refused" in entity)) return entity;
  const place = resolvePlace(view, said);
  return "refused" in place ? entity : place;
}

export const PEOPLE_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_set_field",
    family: "people",
    tier: "gm",
    parameters: (world) => objectSchema({ entity: text(), field: text(fieldEnum(world)), value: JSON_VALUE }, ["entity", "field", "value"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_set_field", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const field = needText(view, "gm_set_field", args, "field");
      if (typeof field !== "string") return field;
      // Null is a value: it clears a reference. A text or enum field's value is the words written.
      const value = fieldValueArg(view, args, "value", entity, field);
      if (value === undefined) return missing(view, "gm_set_field", "value");
      return propose(view, env.writer, gmEdit({ op: "set", entity, field, value }));
    },
  },
  {
    name: "gm_add_to_field",
    family: "people",
    tier: "gm",
    parameters: (world) => objectSchema({ entity: text(), field: text(fieldEnum(world)), delta: NUMBER }, ["entity", "field", "delta"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_add_to_field", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const field = needText(view, "gm_add_to_field", args, "field");
      if (typeof field !== "string") return field;
      const delta = args.delta;
      if (typeof delta !== "number" || !Number.isFinite(delta)) return missing(view, "gm_add_to_field", "delta");
      return propose(view, env.writer, gmEdit({ op: "add", entity, field, delta }));
    },
  },
  {
    name: "gm_set_entity",
    family: "people",
    tier: "gm",
    parameters: (world) => objectSchema({ entity: text(), tier: text(tierIds(world)), agent: BOOLEAN, levels: objectSchema(Object.fromEntries(DOMAINS.map((d) => [d, LEVEL]))) }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_set_entity", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const tier = textArg(args, "tier");
      const tiers = tierIds(view.world);
      if (tier !== null && !tiers.includes(tier)) return badValue(view, "gm_set_entity", "tier", tier, tiers);
      const agent = boolArg(args, "agent");
      const asked = objectArg(args, "levels");
      // Following the tier is null to the engine.
      const levels = asked === null ? null : Object.fromEntries(Object.entries(asked).map(([domain, level]) => [domain, level === FOLLOW_TIER ? null : level]));
      if (tier === null && agent === null && levels === null) return missing(view, "gm_set_entity", "tier");
      return propose(view, env.writer, gmEdit({ op: "entity", entity, ...(tier !== null ? { tier } : {}), ...(agent !== null ? { agent } : {}), ...(levels !== null ? { levels } : {}) }));
    },
  },
  {
    name: "gm_classify",
    family: "people",
    tier: "gm",
    parameters: () => objectSchema({ entity: text(), class: jsonObject(), tags: TEXT_LIST }, ["entity", "class", "tags"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_classify", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const classes = objectArg(args, "class");
      if (classes === null) return missing(view, "gm_classify", "class");
      const tags = args.tags;
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) return missing(view, "gm_classify", "tags");
      return propose(view, env.writer, gmEdit({ op: "classify", entity, class: classes, tags }));
    },
  },
  {
    name: "gm_set_life",
    family: "people",
    tier: "gm",
    parameters: (world) => objectSchema({ person: text(), state: text(lifeStatesOf(world).map(([id]) => id)), tell: TEXT_LIST }, ["person"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_set_life", args, "person", resolvePerson);
      if (typeof entity !== "string") return entity;
      const state = textArg(args, "state");
      const states = lifeStatesOf(view.world).map(([id]) => id);
      if (state !== null && !states.includes(state)) return badValue(view, "gm_set_life", "state", state, states);
      const tell: string[] = [];
      if (args.tell !== undefined) {
        if (!Array.isArray(args.tell)) return missing(view, "gm_set_life", "tell");
        for (const said of args.tell) {
          if (typeof said !== "string") return missing(view, "gm_set_life", "tell");
          const who = resolvePerson(view, said);
          if ("refused" in who) return who.refused;
          tell.push(who.id);
        }
      }
      if (state === null && tell.length === 0) return missing(view, "gm_set_life", "state");
      return propose(view, env.writer, gmEdit({ op: "life", entity, ...(state !== null ? { to: state } : {}), ...(tell.length > 0 ? { tell } : {}) }));
    },
  },
  {
    name: "gm_spawn",
    family: "people",
    tier: "gm",
    parameters: (world) => objectSchema({ kind: text(kindEnum(world)), name: text(), id: text(), tier: text(tierIds(world)), place: text(), agent: BOOLEAN }, ["kind", "name"]),
    async run(args, env) {
      const view = await env.reader.view();
      const kind = needText(view, "gm_spawn", args, "kind");
      if (typeof kind !== "string") return kind;
      // The kinds as the schema offers them: the packs' and the world's, as played.
      const kinds = kindEnum(schemaWorld(view.world, view.registry, view.knowledge));
      if (!kinds.includes(kind)) return badValue(view, "gm_spawn", "kind", kind, kinds);
      const name = needText(view, "gm_spawn", args, "name");
      if (typeof name !== "string") return name;
      const id = textArg(args, "id");
      const tier = textArg(args, "tier");
      const tiers = tierIds(view.world);
      if (tier !== null && !tiers.includes(tier)) return badValue(view, "gm_spawn", "tier", tier, tiers);
      let place: string | null = null;
      if (textArg(args, "place") !== null) {
        const at = needId(view, "gm_spawn", args, "place", resolvePlace);
        if (typeof at !== "string") return at;
        place = at;
      }
      const agent = boolArg(args, "agent");
      return propose(view, env.writer, gmEdit({ op: "spawn", kind, name, ...(id !== null ? { id } : {}), ...(tier !== null ? { tier } : {}), ...(place !== null ? { place } : {}), ...(agent !== null ? { agent } : {}) }));
    },
  },
  {
    name: "gm_despawn",
    family: "people",
    tier: "gm",
    parameters: () => objectSchema({ entity: text() }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_despawn", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      return propose(view, env.writer, gmEdit({ op: "despawn", entity }));
    },
  },
  {
    name: "gm_restore",
    family: "people",
    tier: "gm",
    parameters: () => objectSchema({ entity: text() }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_restore", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      return propose(view, env.writer, gmEdit({ op: "restore", entity }));
    },
  },
  {
    name: "gm_link",
    family: "people",
    tier: "gm",
    parameters: () => objectSchema({ relation: text(), from: text(), to: text(), fields: jsonObject(), until: NUMBER }, ["relation", "from", "to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const rel = needText(view, "gm_link", args, "relation");
      if (typeof rel !== "string") return rel;
      const from = needId(view, "gm_link", args, "from", resolveEntity);
      if (typeof from !== "string") return from;
      const to = needId(view, "gm_link", args, "to", relationEnd);
      if (typeof to !== "string") return to;
      const fields = objectArg(args, "fields");
      if (args.fields !== undefined && fields === null) return missing(view, "gm_link", "fields");
      const until = args.until;
      return propose(view, env.writer, gmEdit({ op: "link", rel, from, to, ...(fields !== null ? { fields } : {}), ...(typeof until === "number" ? { until } : {}) }));
    },
  },
  {
    name: "gm_unlink",
    family: "people",
    tier: "gm",
    parameters: () => objectSchema({ relation: text(), from: text(), to: text() }, ["relation", "from", "to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const rel = needText(view, "gm_unlink", args, "relation");
      if (typeof rel !== "string") return rel;
      const from = needId(view, "gm_unlink", args, "from", resolveEntity);
      if (typeof from !== "string") return from;
      const to = needId(view, "gm_unlink", args, "to", relationEnd);
      if (typeof to !== "string") return to;
      return propose(view, env.writer, gmEdit({ op: "unlink", rel, from, to }));
    },
  },
];
