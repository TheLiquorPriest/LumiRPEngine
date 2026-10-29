// The places family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a move to a place, proposed as
// the GM editor's Move, the one path every move in the story takes.

import { gmEdit, needId, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity, resolvePlace } from "../resolve";
import { objectSchema, text } from "../schema";

export const PLACES_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_move",
    family: "places",
    tier: "gm",
    parameters: () => objectSchema({ entity: text(), to: text() }, ["entity", "to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_move", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const to = needId(view, "gm_move", args, "to", resolvePlace);
      if (typeof to !== "string") return to;
      return propose(view, env.writer, gmEdit({ op: "move", entity, to }));
    },
  },
];
