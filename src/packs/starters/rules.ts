// A tabletop rule set on a starter world as it ships (RULESET-DESIGN §7). The set goes on where the starters load, by the profile
// machinery Build's picker and the World page's press use (`applyProfile`), not into the converted JSON beside this file, which
// `bun run templates` writes afresh from data-src/templates. With it: the layer's pack listed, the layer's level a chat made from
// the starter begins at (on, or off for a set there to be switched on), each person's sheet, and the things the sheets name
// that the template does not hold. Everything else of the starter, its own stats of the sheets pack and their checks among it,
// stays as the template made it, for a chat that plays with the layer off.

import type { EntityId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { applyProfile } from "../../shared/profiles/index";
import type { ProfileDef } from "../../shared/profiles/types";
import type { EntityDef, WorldDoc } from "../../shared/world";

/** The rule set a starter carries. */
export interface StarterRules {
  set: ProfileDef;
  /** Whether a chat made from the starter begins with the layer on. */
  on: boolean;
  /** Each person's sheet: the set's fields, by person. */
  sheets: Readonly<Record<EntityId, JsonObject>>;
  /** Things the sheets name that the template has none of (a townsperson's knife), by id. */
  things?: readonly EntityDef[];
}

/** The layer's pack and domain, as a world lists the one and levels the other. */
const LAYER = "d20";
/** The level a chat begins at with the layer on: the lowest that is on. */
const ON = 1;

/**
 * `doc` carrying `rules`. The starters may not read the packs' kinds (only the pack index imports them), and a world kind lies over
 * the pack kind of the same id with its fields joining the pack's (`overlayKind`), so the copy of the people's kind made here holds
 * the set's fields alone. A sheet or a thing naming what the starter lacks is a slip in this module's data, refused as it loads.
 */
export function withRules(doc: WorldDoc, rules: StarterRules): WorldDoc {
  const out = applyProfile(doc, rules.set, {});
  // The sheet layout stays the starter's own: the sheets pack shows it while the layer is off, and the layer's panel never reads it.
  const rs = out.ruleset;
  if (rs !== undefined) {
    if (doc.ruleset?.sheet === undefined) delete rs.sheet;
    else rs.sheet = structuredClone(doc.ruleset.sheet);
  }
  out.packs[LAYER] ??= { version: 1, config: {} };
  out.realism.levels[LAYER] = rules.on ? ON : 0;
  for (const thing of rules.things ?? []) {
    if (Object.hasOwn(out.entities, thing.id)) throw new Error(`starter ${doc.id}: ${thing.id} is there already`);
    out.entities[thing.id] = structuredClone(thing);
  }
  for (const [id, sheet] of Object.entries(rules.sheets)) {
    const e = Object.hasOwn(out.entities, id) ? out.entities[id] : undefined;
    if (!e) throw new Error(`starter ${doc.id}: no one is ${id}`);
    Object.assign(e.fields, structuredClone(sheet));
  }
  return out;
}
