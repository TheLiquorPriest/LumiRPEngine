// What the Prompt page reads and sends: the preset's prompt map as found in a turn's prompt, the notices
// and the front report turn by turn, and the owner's five edits of the map.

import type { PromptEditAsk, PromptShown, PromptTurnShown, TurnId } from "../../../shared/api";
import { replyOf, type RpeClient } from "../../client";
import type { PageOf } from "../../reading";

/** The map as found in a turn's prompt (the chat's newest turn when none is named). */
export function readPrompt(client: Pick<RpeClient, "call">, chat: string, turn: TurnId | null): Promise<PromptShown> {
  return client.call("GET /api/v1/chats/:chat/prompt", { chat }, { query: turn === null ? {} : { turn } }).then(replyOf);
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
