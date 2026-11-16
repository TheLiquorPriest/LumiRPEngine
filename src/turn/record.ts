// The Author's record of a turn as a file in the turn's folder (plan §8.1 "The Author's records",
// §11): what a later turn carries in the records mode, which RPH reads from each earlier turn's
// folder at the path the carried part's header names (`record:`). The file is laid out by its own
// prompt part (`.prompts/turn-record.md`), given the story record's entry for the turn as
// `story_query` shows it, every one of its fields: the part chooses what the file says, and code
// chooses no key. A turn the Author wrote no record for gets no file, and neither does a chat whose
// layout is switched off.

import { loadGuidance } from "../app/guidance";
import type { Scope } from "rp-harness/contract";
import type { JsonObject } from "../shared/json";
import type { Store } from "../store";
import { allSpans, itemView, storyClock } from "../story/kit";
import { storyAt } from "../story/path";
import { keyedItemId, StoryRecord } from "../story/record";
import type { TreeFiles } from "../tree";

/** The prompt part whose header names, as RPH reads it, the file in each turn's folder that holds the record. */
export const CARRIED_PART = "carried";

/** The prompt part the record's file is laid out by. */
export const RECORD_PART = "turn-record";

/** The Author's record of the scope's turn on its path, every field as `story_query` answers with it; null when the turn wrote none. */
export function turnRecordFields(store: Store, scope: Scope & { turn: string }): JsonObject | null {
  const record = StoryRecord.read(store, scope.user, storyAt(store.user(scope.user), scope.chat, scope.turn));
  const id = keyedItemId("record", scope.turn);
  const item = record.of("record").find((i) => i.id === id);
  return item === undefined ? null : itemView(record, item, storyClock(store, scope.user, scope.chat, scope.turn), allSpans(record));
}

/** Writes the scope's turn's record to its folder; gives the path written, or null when there is nothing to write, no layout for it, or nowhere named to write it. */
export async function writeTurnRecord(files: TreeFiles, store: Store, scope: Scope & { turn: string }): Promise<string | null> {
  const fields = turnRecordFields(store, scope);
  if (fields === null) return null;
  const guidance = loadGuidance(files, scope);
  const [carried, layout] = await Promise.all([guidance.part(CARRIED_PART), guidance.part(RECORD_PART)]);
  const name = carried?.format === "template" ? carried.header["record"] : undefined;
  if (typeof name !== "string" || name.trim() === "" || layout?.format !== "template") return null;
  const folder = (await files.places(scope)).turn;
  if (folder === undefined) return null;
  const text = layout.render(fields).text.trim();
  const written = await files.write(scope, `${folder}${name.trim()}`, { op: "write", text: `${text}\n` }, "harness");
  if (written.status !== "written") throw new Error(`The turn's record could not be written (${written.status}).`);
  return written.path;
}
