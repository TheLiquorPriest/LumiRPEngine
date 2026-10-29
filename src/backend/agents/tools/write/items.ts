// The items family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a thing put into another, or taken
// out to where its container is, proposed as the GM editor's Put.

import { gmEdit, needId, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity } from "../resolve";
import { objectSchema, text, textArg } from "../schema";

export const ITEMS_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_put",
    family: "items",
    tier: "gm",
    parameters: () => objectSchema({ entity: text(), into: text() }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_put", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      // No container takes it out.
      let into: string | null = null;
      if (textArg(args, "into") !== null) {
        const container = needId(view, "gm_put", args, "into", resolveEntity);
        if (typeof container !== "string") return container;
        into = container;
      }
      return propose(view, env.writer, gmEdit({ op: "put", entity, into }));
    },
  },
];
