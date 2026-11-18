// The sheet under the world's tabletop rules (RULESET-DESIGN §5.4): someone's numbers in words, each total with its parts and where
// each part comes from, so no agent need make one up. The sheet is the pack's (`sheetOf`), the one Play shows the player; this tool
// reads it with each name as the tools say one. It changes nothing; its answer is data.

import type { JsonObject } from "rp-harness/contract";
import { rulesOf } from "../../packs/d20/core/model";
import { sheetOf } from "../../packs/d20/core/sheet";
import { TEXT, type ToolSpec } from "../kit";
import { isUnread, named } from "../ops";
import { foundIn, type ReadDef, readTool } from "./run";

const sheet: ReadDef = {
  name: "sheet",
  family: "checks",
  properties: { who: TEXT },
  required: [],
  example: { who: "Mara" },
  read(r, args, reply) {
    if (rulesOf(r.world) === null) return { line: "no_d20_rules", fields: {} };
    let who = r.doc.pov;
    if (args.who !== undefined && args.who !== null && args.who !== "") {
      const found = foundIn(r, "who", args.who, "entity");
      if (isUnread(found)) return found;
      who = found.id;
    }
    reply.data({ sheet: (sheetOf(r.ctx, who, (id) => named(r, id)) ?? {}) as unknown as JsonObject });
    return undefined;
  },
};

/** The sheet under the world's tabletop rules. */
export const SHEET_TOOLS: readonly ToolSpec[] = [readTool(sheet)];
