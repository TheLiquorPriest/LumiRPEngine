// The quests family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a quest, secret, puzzle or agenda
// moved to a stage, proposed as the GM editor's Stage. Under the player character's knowledge a stage
// is named only as its quest log names one: the stage a track stands at, by the label the log shows
// (none of a secret it knows nothing of yet). Any other reads as a stage the track doesn't have, so a
// stage's id or label is never confirmed to a knowledge that can't see it.

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
      const shown = view.knowledge === "pov" ? (view.povTrack(track)?.stage ?? "") : null;
      const at = own(view.state.tracks, track)?.stage ?? t?.start;
      const stages = Object.entries(t?.stages ?? {}).filter(([id, s]) => shown === null || (shown !== "" && id === at && s.label === shown));
      const lower = said.toLowerCase();
      const to = (shown === null ? stages.find(([id]) => id.toLowerCase() === lower) : undefined) ?? stages.find(([, s]) => s.label.toLowerCase() === lower);
      if (!to) return badValue(view, "gm_set_stage", "stage", said, shown === null ? stages.map(([id]) => id) : stages.map(([, s]) => s.label));
      return propose(view, env.writer, gmEdit({ op: "stage", track, to: to[0] }));
    },
  },
];
