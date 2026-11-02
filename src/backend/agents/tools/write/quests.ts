// The quests family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a quest, secret, puzzle or agenda
// moved to a stage, proposed as the GM editor's Stage, the stage named by its id or its label.

import { own } from "../../../../engine/pack-kit";
import { gmEdit, needId, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveTrack } from "../resolve";
import { badValue, needText, objectSchema, text } from "../schema";

export const QUESTS_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_set_stage",
    family: "quests",
    tier: "gm",
    parameters: () => objectSchema({ track: text(), stage: text() }, ["track", "stage"]),
    async run(args, env) {
      const view = await env.reader.view();
      const track = needId(view, "gm_set_stage", args, "track", resolveTrack);
      if (typeof track !== "string") return track;
      const said = needText(view, "gm_set_stage", args, "stage");
      if (typeof said !== "string") return said;
      const t = own(view.world.tracks, track);
      const stages = Object.entries(t?.stages ?? {});
      const lower = said.toLowerCase();
      const to = stages.find(([id]) => id.toLowerCase() === lower) ?? stages.find(([, s]) => s.label.toLowerCase() === lower);
      if (!to) return badValue(view, "gm_set_stage", "stage", said, stages.map(([id]) => id));
      return propose(view, env.writer, gmEdit({ op: "stage", track, to: to[0] }));
    },
  },
];
