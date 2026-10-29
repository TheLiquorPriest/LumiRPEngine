// The time family's GM writes (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a change to a character's routine
// or schedules in this chat, one of GM → Routine's controls (`RoutineEditOp`, Cast life's), and a ✎
// fix as the player corrects the HUD (the clock, or one field), each proposed for the writer to read
// again for its shape.

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import type { JsonObject } from "../../../../shared/json";
import { ROUTINE_AWARENESS, ROUTINE_MODES, ROUTINE_ROLES, type RoutineEditOp, SKIP_LIVES } from "../../../../shared/routines";
import { fieldValueArg, JSON_VALUE, missing, needId, nullableObject, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity, resolvePerson } from "../resolve";
import { badValue, fieldEnum, jsonObject, needText, objectSchema, text, textArg } from "../schema";

const OPS: readonly RoutineEditOp["op"][] = ["routine_follow", "routine_block", "schedule_override"];
const DEFAULT = "default";
// The parts routine_follow sets, each with the values it takes; "default" returns one to the world's
// (null; the role and the skip life to their level's).
const FOLLOW: readonly (readonly [string, readonly string[]])[] = [
  ["mode", [...ROUTINE_MODES, DEFAULT]],
  ["awareness", [...ROUTINE_AWARENESS, DEFAULT]],
  ["role", [...ROUTINE_ROLES, DEFAULT]],
  ["skips", [...SKIP_LIVES, DEFAULT]],
];

export const TIME_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_routine_edit",
    family: "time",
    tier: "gm",
    parameters: () =>
      objectSchema(
        { op: text(OPS), person: text(), ...Object.fromEntries(FOLLOW.map(([part, values]) => [part, text(values)])), block: text(), schedule: text(), value: jsonObject() },
        ["op", "person"],
      ),
    async run(args, env) {
      const view = await env.reader.view();
      const op = needText(view, "gm_routine_edit", args, "op");
      if (typeof op !== "string") return op;
      if (!OPS.some((o) => o === op)) return badValue(view, "gm_routine_edit", "op", op, OPS);
      const entity = needId(view, "gm_routine_edit", args, "person", resolvePerson);
      if (typeof entity !== "string") return entity;
      const edit: JsonObject = { op, entity };
      if (op === "routine_follow") {
        // A part left out is kept; at least one is given.
        let given = false;
        for (const [part, values] of FOLLOW) {
          const said = textArg(args, part);
          if (said === null) continue;
          if (!values.includes(said)) return badValue(view, "gm_routine_edit", part, said, values);
          edit[part] = said === DEFAULT ? null : said;
          given = true;
        }
        if (!given) return missing(view, "gm_routine_edit", "mode");
      } else {
        const key = op === "routine_block" ? "block" : "schedule";
        const id = needText(view, "gm_routine_edit", args, key);
        if (typeof id !== "string") return id;
        // No value drops the chat's change.
        const value = nullableObject(args, "value");
        if (value === undefined) return missing(view, "gm_routine_edit", "value");
        edit[key] = id;
        edit.value = value;
      }
      return propose(view, env.writer, { kind: "routine_edit", edit });
    },
  },
  {
    name: "gm_fix",
    family: "time",
    tier: "gm",
    parameters: (world) => objectSchema({ time: text(), entity: text(), field: text(fieldEnum(world)), value: JSON_VALUE }),
    async run(args, env) {
      const view = await env.reader.view();
      const time = textArg(args, "time");
      if (time !== null) {
        // One fix is the clock or a field, never both: the description says to give time alone. A
        // blank or null other argument (null written as JSON text too) is read as left out.
        const given = args.value;
        const value = typeof given === "string" ? given.trim() : given;
        if (textArg(args, "entity") !== null || textArg(args, "field") !== null || (value !== undefined && value !== null && value !== "" && value !== "null")) return view.refuse(WRITE_NOTE.badOp);
        return propose(view, env.writer, { kind: "fix", fix: { time } });
      }
      const entity = needId(view, "gm_fix", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const field = needText(view, "gm_fix", args, "field");
      if (typeof field !== "string") return field;
      const value = fieldValueArg(view, args, "value", entity, field);
      if (value === undefined) return missing(view, "gm_fix", "value");
      return propose(view, env.writer, { kind: "fix", fix: { entity, field, value } });
    },
  },
];
