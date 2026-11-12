// Two of the game master's own moves that had no tool: a thing put back where it is kept
// (`item_away`) and someone or something taken out of what holds it (`gm_take_out`).
//
// They go through the writer as the game master's own controls send them: Put it away is the item
// op `move` to where the thing is kept (`putAwaySpot`), Take out the edit `{op: "put"}` with no
// holder. The writer checks each as it checks any: the caller's tier, the change type's mode, the
// caps.

import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { HARNESS_NOTE } from "../../../../shared/harness-texts";
import { STORY_NOTE, STORY_TOOL } from "../../../../shared/harness-texts-story";
import { putAwaySpot } from "../../../../engine/thing-gm";
import { gmEdit, needId, propose } from "../propose";
import { resolveEntity, resolveNamedThing } from "../resolve";
import { needText, objectSchema, text } from "../schema";
import { checkOrPropose } from "../write/items";
import type { HarnessToolDefinition } from "./kit";

const AWAY = STORY_TOOL.away;
const TAKE_OUT = STORY_TOOL.takeOut;

export const STORY_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: AWAY,
    family: HARNESS_FAMILY.items,
    tier: "write",
    parameters: () => objectSchema({ item: text(), why: text() }, ["item", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
      const item = needId(view, AWAY, args, "item", resolveNamedThing);
      if (typeof item !== "string") return item;
      const why = needText(view, AWAY, args, "why");
      if (typeof why !== "string") return why;
      const to = view.read(() => putAwaySpot(view.ctx, item));
      if (to === null) return view.refuse(STORY_NOTE.awayNowhere, { name: view.name(item) });
      return checkOrPropose(view, env, { do: "move", item, to, why }, false);
    },
  },
  {
    name: TAKE_OUT,
    family: HARNESS_FAMILY.places,
    tier: "write",
    parameters: () => objectSchema({ entity: text() }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
      const entity = needId(view, TAKE_OUT, args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      return propose(view, env.writer, gmEdit({ op: "put", entity, into: null }));
    },
  },
];
