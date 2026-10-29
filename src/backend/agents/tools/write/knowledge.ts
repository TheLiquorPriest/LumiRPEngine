// The knowledge family's GM write (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): a section's settings in this
// chat over the world's, proposed as GM → Sections sets them.

import { sectionsOf } from "../../../book";
import { gmEdit, missing, nullableObject, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { badValue, jsonObject, needText, objectSchema, text } from "../schema";

export const KNOWLEDGE_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_feed",
    family: "knowledge",
    tier: "gm",
    parameters: (world) => objectSchema({ section: text(sectionsOf(world).map((s) => s.id)), settings: jsonObject() }, ["section"]),
    async run(args, env) {
      const view = await env.reader.view();
      const section = needText(view, "gm_feed", args, "section");
      if (typeof section !== "string") return section;
      const sections = sectionsOf(view.world).map((s) => s.id);
      if (!sections.includes(section)) return badValue(view, "gm_feed", "section", section, sections);
      // No settings return the section to the world's.
      const to = nullableObject(args, "settings");
      if (to === undefined) return missing(view, "gm_feed", "settings");
      return propose(view, env.writer, gmEdit({ op: "feed", section, to }));
    },
  },
];
