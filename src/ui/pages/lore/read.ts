// The Lore page's reads over RPE's routes (plan §9): the chat's lore index a page at a time, where its indexing
// stands, the overlays on its path, and starting an indexing job.

import type { LoreIndexJob, LoreIndexRow, LoreIndexStatus, LoreOverlays } from "../../../shared/api";
import { replyOf, type RpeClient } from "../../client";
import type { PageOf } from "../../reading";

export function readIndex(client: Pick<RpeClient, "call">, chat: string, cursor: string | undefined): Promise<PageOf<LoreIndexRow>> {
  return client.call("GET /api/v1/chats/:chat/lore/index", { chat }, { query: cursor === undefined ? {} : { cursor } }).then(replyOf);
}

export function readIndexStatus(client: Pick<RpeClient, "call">, chat: string): Promise<LoreIndexStatus> {
  return client.call("GET /api/v1/chats/:chat/lore/index/status", { chat }).then(replyOf);
}

export function readOverlays(client: Pick<RpeClient, "call">, chat: string): Promise<LoreOverlays> {
  return client.call("GET /api/v1/chats/:chat/lore/overlays", { chat }).then(replyOf);
}

/** Starts the indexing job; RPE refuses in its words where jobs are off or a limit of the day is reached. */
export function startIndexing(client: Pick<RpeClient, "call">, chat: string): Promise<LoreIndexJob> {
  return client.call("POST /api/v1/chats/:chat/lore/index/jobs", { chat }).then(replyOf);
}

/** What a person may set of an entry's own lines; null of one takes his own off and the run's shows again. */
export interface EntryLinesEdit {
  kind?: string | null;
  line?: string | null;
  related?: string[] | null;
}

/** Sets an entry's own kind, line or related entries; RPE refuses in its words a kind not in the list, an empty line or a related id that is no entry of the chat's lore. */
export function editEntryLines(client: Pick<RpeClient, "call">, chat: string, entry: string, body: EntryLinesEdit): Promise<LoreIndexRow> {
  return client.call("PUT /api/v1/chats/:chat/lore/index/:entry", { chat, entry }, { body }).then(replyOf);
}
