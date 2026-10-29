// The minds family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a change to a character's mind, one
// of GM → Minds' controls (`MindEditOp`, the minds pack's), proposed as a mind edit the writer reads
// again for its shape. "none" is how a model says null where an argument takes one of a few words.

import type { JsonObject } from "../../../../shared/json";
import { FIDELITIES, MIND_APPROACHES, type MindEditOp } from "../../../../shared/minds";
import { missing, needId, nullableObject, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolvePerson } from "../resolve";
import { badValue, jsonObject, needText, objectSchema, text, textArg } from "../schema";

const OPS: readonly MindEditOp["op"][] = ["mind_pin", "mind_refresh", "mind_memory", "mind_intent", "mind_knowledge"];
const PARTS: readonly Extract<MindEditOp, { op: "mind_memory" }>["part"][] = ["note", "commitment", "plan"];
const NONE = "none";
const LEVELS: readonly string[] = [...FIDELITIES, NONE];
const APPROACHES: readonly string[] = [...MIND_APPROACHES, NONE];

export const MINDS_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_mind_edit",
    family: "minds",
    tier: "gm",
    parameters: () =>
      objectSchema(
        { op: text(OPS), person: text(), level: text(LEVELS), part: text(PARTS), id: text(), value: jsonObject(), text: text(), approach: text(APPROACHES), fact: text(), holding: jsonObject() },
        ["op", "person"],
      ),
    async run(args, env) {
      const view = await env.reader.view();
      const op = needText(view, "gm_mind_edit", args, "op");
      if (typeof op !== "string") return op;
      if (!OPS.some((o) => o === op)) return badValue(view, "gm_mind_edit", "op", op, OPS);
      const entity = needId(view, "gm_mind_edit", args, "person", resolvePerson);
      if (typeof entity !== "string") return entity;
      let edit: JsonObject;
      switch (op) {
        case "mind_pin": {
          const level = needText(view, "gm_mind_edit", args, "level");
          if (typeof level !== "string") return level;
          if (!LEVELS.includes(level)) return badValue(view, "gm_mind_edit", "level", level, LEVELS);
          edit = { op, entity, level: level === NONE ? null : level };
          break;
        }
        case "mind_memory": {
          const part = needText(view, "gm_mind_edit", args, "part");
          if (typeof part !== "string") return part;
          if (!PARTS.some((p) => p === part)) return badValue(view, "gm_mind_edit", "part", part, PARTS);
          // No id adds one; no value deletes it; neither is nothing to do.
          const id = textArg(args, "id");
          const value = nullableObject(args, "value");
          if (value === undefined || (id === null && value === null)) return missing(view, "gm_mind_edit", "value");
          edit = { op, entity, part, id, value };
          break;
        }
        case "mind_intent": {
          // An empty text is one: it clears their intent.
          const said = args.text;
          const approach = textArg(args, "approach");
          if (approach !== null && !APPROACHES.includes(approach)) return badValue(view, "gm_mind_edit", "approach", approach, APPROACHES);
          if (typeof said !== "string" && approach === null) return missing(view, "gm_mind_edit", "text");
          edit = { op, entity, ...(typeof said === "string" ? { text: said } : {}), ...(approach !== null ? { approach: approach === NONE ? null : approach } : {}) };
          break;
        }
        case "mind_knowledge": {
          const fact = needText(view, "gm_mind_edit", args, "fact");
          if (typeof fact !== "string") return fact;
          // No holding takes the fact away from them.
          const holding = nullableObject(args, "holding");
          if (holding === undefined) return missing(view, "gm_mind_edit", "holding");
          edit = { op, entity, fact, holding };
          break;
        }
        default:
          // mind_refresh: the person alone.
          edit = { op, entity };
      }
      return propose(view, env.writer, { kind: "mind_edit", edit });
    },
  },
];
