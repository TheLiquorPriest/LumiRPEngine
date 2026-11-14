// Time (the skill `time`): what today's time tools and the weather's own effects do besides passing
// time and setting the clock (`world_apply` `pass_time`, `set`): how someone follows their routine,
// a block of it, one of their schedules overridden, and the weather of a region set or cleared. Each
// runs today's Cast life and weather (`packs/castlife`, `packs/weather`). Taking someone off a
// schedule they do not follow changes nothing and is reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { FixOp } from "../../shared/ledger";
import { ROUTINE_AWARENESS, ROUTINE_MODES, ROUTINE_ROLES, SKIP_LIVES } from "../../shared/routines";
import { followOf } from "../../packs/castlife/core/routines";
import { NUMBER, OBJECT, oneOf, TEXT } from "../kit";
import { find, isUnread, named, notOneOf, type OpContext, textArg, type Unread } from "../ops";
import { editChange, effectTool, notApplicable, type WriteDef, writeTool } from "./run";

const FAMILY = "time";

const ROUTINE_OPS = ["routine_follow", "routine_block", "schedule_override"] as const;

/** What `default` returns a part of how someone follows their routine to: the world's own. */
const DEFAULT = "default";

/** The parts `routine_follow` sets, each with the values it takes. */
const FOLLOW: readonly (readonly [string, readonly string[]])[] = [
  ["mode", ROUTINE_MODES],
  ["awareness", ROUTINE_AWARENESS],
  ["role", ROUTINE_ROLES],
  ["skips", SKIP_LIVES],
];

/** The routine change the call asks for, as today's GM → Routine sends it; or what could not be read. */
function routineEdit(o: OpContext, person: string): FixOp | Unread {
  const op = textArg(o.args, "op");
  if (op === "routine_follow") {
    const edit: Record<string, JsonValue> = { op, entity: person };
    for (const [part, values] of FOLLOW) {
      const said = textArg(o.args, part);
      if (said === undefined) continue;
      if (said !== DEFAULT && !values.includes(said)) return notOneOf(o, part, said, [...values, DEFAULT]);
      edit[part] = said === DEFAULT ? null : said;
    }
    if (Object.keys(edit).length === 2) return { line: "needs", fields: { n: o.n, op: o.op, fields: FOLLOW.map(([part]) => part) } };
    return edit as unknown as FixOp;
  }
  if (op !== "routine_block" && op !== "schedule_override") return notOneOf(o, "op", o.args.op ?? null, ROUTINE_OPS);
  const key = op === "routine_block" ? "block" : "schedule";
  const id = textArg(o.args, key);
  const value = o.args.value;
  const missing = [...(id === undefined ? [key] : []), ...(value === undefined ? ["value"] : [])];
  if (missing.length > 0) return { line: "needs", fields: { n: o.n, op: o.op, fields: missing } };
  if (value !== null && !isRecord(value)) return notOneOf(o, "value", value ?? null, ["an object, or null"]);
  return { op, entity: person, [key]: id, value } as unknown as FixOp;
}

const routine: WriteDef = {
  name: "gm_routine_edit",
  family: FAMILY,
  lane: "engine",
  properties: { op: oneOf(ROUTINE_OPS), person: TEXT, ...Object.fromEntries(FOLLOW.map(([part, values]) => [part, oneOf([...values, DEFAULT])])), block: TEXT, schedule: TEXT, value: OBJECT },
  required: ["op", "person"],
  example: { op: "routine_follow", person: "bram", mode: "no_invitations", source: { from: "prose", message: "m-0301" } },
  run(o) {
    const person = find(o, "person", "person");
    if (isUnread(person)) return person;
    const edit = routineEdit(o, person.id);
    if (isUnread(edit)) return edit;
    const from = o.draft.w.events.length;
    const refused = editChange(o, edit);
    if (refused !== null) {
      if (refused.code === "missing_schedule") return { line: "unknown", fields: { n: o.n, op: o.op, field: "schedule", name: String(o.args.schedule), wanted: "schedule", near: Object.keys(o.reading.doc.schedules) } };
      if (refused.code === "bad_value") return notOneOf(o, "value", o.args.value ?? null, []);
      // Taken off a schedule they do not follow: so already, and said.
      if (refused.code !== "not_owner") return notApplicable(o, refused.code);
      o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, person.id) });
    }
    // How they follow their routine is kept apart from them: the answer shows it as it now stands.
    o.after((state) => ({ routine: followOf(o.reading.registry.context(o.reading.doc, state.world), person.id) as unknown as JsonObject, asked: edit as unknown as JsonObject }));
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const weatherSet = effectTool({
  name: "weather_set",
  family: FAMILY,
  lane: "engine",
  effect: "weather.set",
  args: [{ field: "region", want: "point" }, { field: "state" }, { field: "minutes" }],
  properties: { region: TEXT, state: TEXT, minutes: NUMBER },
  required: ["region", "state"],
  example: { region: "Thornbury", state: "fog", minutes: 120, source: { from: "prose", message: "m-0302" } },
  bend: (o, code) => (code === "bad_state" ? notOneOf(o, "state", o.args.state ?? null, []) : null),
});

const weatherClear = effectTool({
  name: "weather_clear",
  family: FAMILY,
  lane: "engine",
  effect: "weather.clear",
  args: [{ field: "region", want: "point" }, { field: "state" }],
  properties: { region: TEXT, state: TEXT },
  required: ["region"],
  example: { region: "Thornbury", source: { from: "prose", message: "m-0303" } },
});

/** The family's tools, as RPH's search finds them. */
export const TIME_TOOLS = [writeTool(routine), weatherSet, weatherClear];
