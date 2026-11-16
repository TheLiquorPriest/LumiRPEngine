// Notes (the skill `world`): an agent's own line on a level of the tree ("uneasy since the fire"),
// through the store's note operation. It changes nothing in the world, so it takes no provenance; the
// line shows beside that level's reflection in `world_query` and in the next world state, and an
// empty text takes the level's line off.

import { STORE_OPS } from "../../store/types";
import { TEXT } from "../kit";
import { find, isUnread } from "../ops";
import { type WriteDef, writeTool } from "./run";

const note: WriteDef = {
  name: "note_set",
  family: "notes",
  lane: "story",
  properties: { at: TEXT, text: TEXT },
  required: ["at", "text"],
  provenance: false,
  example: { at: "Odile", text: "uneasy since the fire" },
  run(o) {
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const text = o.args.text;
    if (typeof text !== "string") return { line: "needs", fields: { n: o.n, op: o.op, fields: ["text"] } };
    o.draft.recordStoreOp(o.n, o.op, "story", o.prov, { op: STORE_OPS.note, value: { at: at.ref, text: text.trim() } });
    return undefined;
  },
};

/** The family's tools, as RPH's search finds them. */
export const NOTE_TOOLS = [writeTool(note)];
