// The Author's record of a turn as a file in the turn's folder (plan §8.1 "The Author's records",
// §11): what a later turn carries in the records mode, which RPH reads from each earlier turn's
// folder at the path the carried part's header names (`record:`). The file holds the story record's
// entry for the turn as `story_query` shows it, the Author's own words in the record's fields: no word
// of code's around them. A turn the Author wrote no record for gets no file.

import { loadGuidance } from "rp-harness";
import type { Scope } from "rp-harness/contract";
import type { Store } from "../store";
import { allSpans, itemView, storyClock } from "../story/kit";
import { storyAt } from "../story/path";
import { keyedItemId, StoryRecord } from "../story/record";
import type { TreeFiles } from "../tree";

/** The prompt part whose header names, as RPH reads it, the file in each turn's folder that holds the record. */
export const CARRIED_PART = "carried";

/** The Author's record of the scope's turn on its path, as `story_query` answers with it; null when the turn wrote none. */
export function turnRecordText(store: Store, scope: Scope & { turn: string }): string | null {
  const record = StoryRecord.read(store.db, scope.user, storyAt(store.user(scope.user), scope.chat, scope.turn));
  const id = keyedItemId("record", scope.turn);
  const item = record.of("record").find((i) => i.id === id);
  if (item === undefined) return null;
  return JSON.stringify({ record: [itemView(record, item, storyClock(store, scope.user, scope.chat, scope.turn), allSpans(record))] });
}

/** Writes the scope's turn's record to its folder; gives the path written, or null when there is nothing to write or nowhere named to write it. */
export async function writeTurnRecord(files: TreeFiles, store: Store, scope: Scope & { turn: string }): Promise<string | null> {
  const text = turnRecordText(store, scope);
  if (text === null) return null;
  const part = await loadGuidance(files, scope).part(CARRIED_PART);
  const name = part?.format === "template" ? part.header["record"] : undefined;
  if (typeof name !== "string" || name.trim() === "") return null;
  const folder = (await files.places(scope)).turn;
  if (folder === undefined) return null;
  const written = await files.write(scope, `${folder}${name.trim()}`, { op: "write", text: `${text}\n` }, "harness");
  if (written.status !== "written") throw new Error(`The turn's record could not be written (${written.status}).`);
  return written.path;
}
