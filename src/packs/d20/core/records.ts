// The layer's records (RULESET-DESIGN §5.1): one for each action carried out, holding the whole of what it worked out (the rolls,
// each total's parts, what was spent and changed), and the two the layer makes of itself: a state hit points put someone in or took
// them out of, and what a fight's turn or the clock did (§4.5). A record changes nothing: the changes are the core `set`s beside it,
// in the same unit, so Undo takes those back and the record stays as what was rolled. Each says itself in words through the history
// lines (`ev_d20_*`), filled with what it holds: names for ids, lists joined.

import type { JsonValue } from "../../../shared/json";
import { say } from "../../../shared/lines";
import type { PackEvent } from "../../../shared/ledger";
import { D20_EVENTS } from "../../../shared/d20";
import type { EventTypeDef, ReadContext } from "../../../engine/registry";
import { labelOf, own } from "../../../engine/pack-kit";

/** The fields of a record that name someone or something, said by their names. */
const NAMED: Readonly<Record<string, true>> = { who: true, target: true, item: true, by: true, aided: true, vs: true };

/** A record's values as its line takes them: a name for an id, an outcome in words, a list's words joined, a number or words as they are. */
function fieldsOf(e: PackEvent, ctx: ReadContext): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const word = (key: string, v: JsonValue): string | number | boolean | null => {
    if (key === "outcome" && typeof v === "string") return say(`d20_outcome_${v}`) || v;
    if (typeof v === "string") return own(NAMED, key) && own(ctx.state.entities, v) ? labelOf(ctx, v) : v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && own(NAMED, key) && own(ctx.state.entities, x) ? labelOf(ctx, x) : typeof x === "string" || typeof x === "number" ? String(x) : "")).filter((x) => x !== "").join(", ");
    return null;
  };
  for (const [key, v] of Object.entries(e.data)) {
    const w = v === undefined ? null : word(key, v);
    if (w !== null && w !== "") out[key] = w;
  }
  return out;
}

/** The records that tell a roll: the player has seen how it fell, so an Undo leaves them as they are and takes back the rest. */
const ROLLS: Readonly<Record<string, true>> = { [D20_EVENTS.check]: true, [D20_EVENTS.save]: true, [D20_EVENTS.attack]: true, [D20_EVENTS.harm]: true, [D20_EVENTS.heal]: true, [D20_EVENTS.upkeep]: true, [D20_EVENTS.advance]: true };

function record(type: string): EventTypeDef<PackEvent> {
  return {
    type: type as PackEvent["type"],
    validate: (e, ctx) => (typeof e.data.who === "string" && own(ctx.state.entities, e.data.who) ? null : { code: "missing_entity", reason: say("why_no_entity_who", { who: String(e.data.who ?? "") }) }),
    apply: () => undefined,
    describe: (e, ctx) => say(`ev_${type.replace(".", "_")}`, fieldsOf(e, ctx)),
    ...(own(ROLLS, type) ? { irreversible: "roll" } : { reverse: () => [] }),
  };
}

export const D20_RECORDS: readonly EventTypeDef<PackEvent>[] = Object.values(D20_EVENTS).map(record);
