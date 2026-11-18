// What the Prompt page reads and sends: the preset's prompt map as found in a turn's prompt, the notices
// and the front report turn by turn, and the owner's five edits of the map.

import type { PromptEditAsk, PromptShown, PromptTurnShown, TurnId } from "../../../shared/api";
import { replyOf, type RpeClient, RpeError } from "../../client";
import type { PageOf } from "../../reading";

/** The map as found in a turn's prompt (the chat's newest turn whose prompt is kept, when none is named); null where none is named and no turn of the chat has a prompt kept yet. */
export async function readPrompt(client: Pick<RpeClient, "call">, chat: string, turn: TurnId | null): Promise<PromptShown | null> {
  try {
    return replyOf(await client.call("GET /api/v1/chats/:chat/prompt", { chat }, { query: turn === null ? {} : { turn } }));
  } catch (error) {
    // A chat with no turn played on RPE yet (a migrated chat before its first turn) has no prompt kept: that is no failure.
    if (turn === null && error instanceof RpeError && error.status === 404) return null;
    throw error;
  }
}

/** One page of the prompt's notices and front report, turn by turn, newest first. */
export async function readPromptHistory(client: Pick<RpeClient, "call">, chat: string, cursor: string | undefined): Promise<PageOf<PromptTurnShown>> {
  const page = await client.call("GET /api/v1/chats/:chat/prompt/history", { chat }, { query: cursor === undefined ? {} : { cursor } });
  return { items: page.items, next: page.next };
}

/** One of the owner's edits of the map; RPH makes it, keeps it with the preset, and answers the map as it stands. A refusal is RPH's own words. */
export function editPrompt(client: Pick<RpeClient, "call">, chat: string, edit: PromptEditAsk, turn?: TurnId): Promise<PromptShown> {
  return client.call("POST /api/v1/chats/:chat/prompt/edit", { chat }, { query: turn === undefined ? {} : { turn }, body: edit }).then(replyOf);
}
