// What the Prompt page reads and sends: the preset's prompt map as found in a turn's prompt, the notices
// and the front report turn by turn, and the owner's five edits of the map.

import type { TurnId } from "../../../shared/api";
import type { RpeClient } from "../../client";
import type { PageOf } from "../../reading";
import { callWanted, type PromptEditAsk, type PromptShown, type PromptTurnShown } from "../../wanted";

/** The map as found in a turn's prompt (the chat's newest turn when none is named). */
export function readPrompt(client: Pick<RpeClient, "call">, chat: string, turn: TurnId | null): Promise<PromptShown> {
  return callWanted(client, "GET /api/v1/chats/:chat/prompt", { chat }, { query: turn === null ? {} : { turn } });
}

/** One page of the prompt's notices and front report, turn by turn, newest first. */
export async function readPromptHistory(client: Pick<RpeClient, "call">, chat: string, cursor: string | undefined): Promise<PageOf<PromptTurnShown>> {
  const page = await callWanted(client, "GET /api/v1/chats/:chat/prompt/history", { chat }, { query: cursor === undefined ? {} : { cursor } });
  return { items: page.items, next: page.next };
}

/** One of the owner's edits of the map; RPH makes it, keeps it with the preset, and answers the map as it stands (or why it did not). */
export function editPrompt(client: Pick<RpeClient, "call">, chat: string, edit: PromptEditAsk): Promise<PromptShown> {
  return callWanted(client, "POST /api/v1/chats/:chat/prompt/edit", { chat }, { body: edit });
}
