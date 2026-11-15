// What RPE writes to a chat of the stand-in Lumiverse and what it asks of it beyond reading rows (PlanAdapter-S12), each as Lumiverse's own route and service do
// it (staging at a70f4ed2; paths are Lumiverse's `src/`): a book attached to a chat as one key of its metadata, a message appended, a generation
// started and the resolution of its connection and preset that a dry run shares. Each answer is a status and a body; a body Hono cannot read as JSON
// is its 500, named by the string "Internal Server Error".

import { isRecord } from "../../src/shared/json";
import { characterBookIds } from "./books";
import type { CortexState } from "./cortex";
import type { StandInDb } from "./db";
import type { Connection, GenerateInput, Outcome, StandIn } from "./lumiverse";
import type { Profiles } from "./profiles";
import { approximateTokens, parsed, rowMetadata, rowToMessage } from "./served";

export interface Reply {
  status: number;
  body: unknown;
}

/** What Hono answers where `c.req.json()` throws and the app has no handler of its own (`app.ts`): 500, plain text. */
export const SERVER_ERROR: Reply = { status: 500, body: "Internal Server Error" };

/** The longest an error told to a page is (`utils/provider-errors.ts:147-156`). */
export const MAX_ERROR_LENGTH = 1000;

export const clamped = (message: string): string => (message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message);

/** What the writes read and write of the stand-in. */
export interface Env {
  host: StandIn;
  db: StandInDb | undefined;
  profiles: Profiles;
  cortex: CortexState;
}

const json = (body: string): unknown => parsed(body, undefined);

// ---------------------------------------------------------------- the chat's metadata

/** The chat's row as `getChatAsync` hands it on: its metadata parsed. */
function chatDto(env: Env, user: string, chatId: string): Record<string, unknown> | null {
  const row = env.db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chatId, user)[0];
  return row === undefined ? null : { ...row, metadata: rowMetadata(row.metadata) };
}

/** What Lumiverse reads of the stand-in's own chat, in memory or in rows. */
function chatOf(env: Env, user: string, chatId: string) {
  const chat = env.host.chats.get(chatId);
  return chat !== undefined && chat.user === user ? chat : undefined;
}

/**
 * `pruneOrphanedWiState` (`services/wi-state-prune.service.ts`): once the chat's book attachments change, the counts of entries of books no longer attached from any place
 * (the chat's character, the user's persona, the chat, the global books) are dropped from `wi_state`; with no book attached at all it goes whole.
 */
function pruneOrphanedWiState(env: Env, user: string, chatId: string): void {
  const chat = chatOf(env, user, chatId);
  const dto = chatDto(env, user, chatId);
  if (chat === undefined || dto === null) return;
  const metadata = dto.metadata as Record<string, unknown>;
  const wiState = metadata.wi_state;
  if (!isRecord(wiState) || Object.keys(wiState).length === 0) return;
  const library = env.host.library;
  const character = library.charactersByIds(user, [String(dto.character_id)]).get(String(dto.character_id));
  const ids = new Set<string>(characterBookIds(character?.extensions));
  const attached = library.persona(user)?.attached_world_book_id;
  if (attached) ids.add(attached);
  for (const id of Array.isArray(metadata.chat_world_book_ids) ? (metadata.chat_world_book_ids as string[]) : []) ids.add(id);
  const global = library.setting(user, "globalWorldBooks");
  for (const id of Array.isArray(global) ? (global as string[]) : []) ids.add(id);
  if (ids.size === 0) {
    env.host.mergeChatMetadata(chat, { wi_state: undefined });
    return;
  }
  const valid = new Set<string>();
  for (const entries of library.entriesForBooks(user, [...ids], new Map()).values()) for (const e of entries) if (e.uid !== undefined) valid.add(e.uid);
  const kept: Record<string, unknown> = {};
  let pruned = false;
  for (const [uid, state] of Object.entries(wiState)) {
    if (valid.has(uid)) kept[uid] = state;
    else pruned = true;
  }
  if (pruned) env.host.mergeChatMetadata(chat, { wi_state: kept });
}

/**
 * `PATCH /api/v1/chats/:id/metadata` (`routes/chats.routes.ts:480-516`): an atomic merge of the keys given into the chat's metadata, `null` taking a key out (`:495-499`);
 * the books attached (`chat_world_book_ids`) pruned of the state of entries no longer read (`:513-515`); the chat as it is then, or 404 where it is not the user's. The merge is told as
 * `CHAT_CHANGED` with the keys that changed. A `voiceOverrides` that is not an object is taken out, the stand-in having no sanitizer of voices.
 */
export function patchChatMetadata(env: Env, user: string, chatId: string, raw: string): Reply {
  const chat = chatOf(env, user, chatId);
  if (chat === undefined || chatDto(env, user, chatId) === null) return { status: 404, body: { error: "Not found" } };
  const body = json(raw);
  if (body === undefined) return SERVER_ERROR;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "Body must be an object of metadata keys" } };
  const partial: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) partial[key] = value === null || (key === "voiceOverrides" && !isRecord(value)) ? undefined : value;
  env.host.mergeChatMetadata(chat, partial);
  if ("chat_world_book_ids" in body) pruneOrphanedWiState(env, user, chatId);
  return { status: 200, body: chatDto(env, user, chatId) };
}

// ---------------------------------------------------------------- a message appended

/** `computeMessageTokenCount` (`services/message-token-count.ts:51-66`): none for no text, for the user's switch off, for no connection, or for a model with no tokenizer. */
function messageTokens(env: Env, user: string, content: string, connectionId: unknown): number | undefined {
  if (content === "" || env.host.library.setting(user, "showMessageTokenCount") === false) return undefined;
  const profile = env.profiles.resolve(user, typeof connectionId === "string" && connectionId !== "" ? connectionId : undefined);
  return profile !== null && env.cortex.tokenizedModels.has(profile.model) ? approximateTokens(content) : undefined;
}

/**
 * `POST /api/v1/chats/:chatId/messages` (`routes/chats.routes.ts:878-914`): 404 where the chat is not the user's; `name` and `content` required (400); the message's token count
 * put in its `extra` where its model has a tokenizer; saved at the end of the chat, told as `MESSAGE_SENT`; 201 with the message. (Extensions' content processors, which
 * `:889-899` runs first, the stand-in has none of; `parent_message_id` and `branch_id` are not kept.)
 */
export function appendMessage(env: Env, user: string, chatId: string, raw: string): Reply {
  const chat = chatOf(env, user, chatId);
  if (chat === undefined) return { status: 404, body: { error: "Chat not found" } };
  const body = json(raw);
  if (!isRecord(body)) return SERVER_ERROR;
  if (body.name === undefined || body.content === undefined) return { status: 400, body: { error: "name and content are required" } };
  // A name or a text that is no string is no column Lumiverse's insert accepts.
  if (typeof body.name !== "string" || typeof body.content !== "string") return SERVER_ERROR;
  let extra: Record<string, unknown> = isRecord(body.extra) ? { ...body.extra } : {};
  const count = messageTokens(env, user, body.content, body.connection_id);
  if (count !== undefined) extra = { ...extra, tokenCount: count };
  const id = env.host.createMessage(chatId, {
    role: body.is_user === true ? "user" : "assistant",
    content: body.content,
    name: body.name,
    ...(typeof extra.character_id === "string" ? { characterId: extra.character_id } : {}),
    ...(extra.hidden === true ? { hidden: true } : {}),
    ...(isRecord(extra.spindle_metadata) ? { metadata: extra.spindle_metadata } : {}),
    extra,
  });
  const row = env.db?.rows("SELECT * FROM messages WHERE id = ?", id)[0];
  return { status: 201, body: row === undefined ? { id } : rowToMessage(row) };
}

// ---------------------------------------------------------------- a generation started

/** What a generation or a dry run is for, once its connection and preset are found (`resolveChatGenerationConnection`, `assertUsablePresetAsync`). */
export type Resolved = { ok: true; connection: Connection; preset: string } | { ok: false; error: string };

/**
 * The connection and the preset of a generation, in the order Lumiverse finds them (`services/generate.service.ts:1732-1789`, `:3135`): the chat's pin, the connection asked for, the
 * active and the acting profile; then the preset asked for, the user's `activeLoomPresetId`, the connection's own; a preset that is gone and one never chosen are told as they are.
 */
export function resolveGeneration(env: Env, user: string, metadata: Record<string, unknown> | undefined, ask: { connection?: string; preset?: string }): Resolved {
  const profile = env.profiles.forChat(user, metadata, ask.connection);
  const connection = profile === null ? undefined : env.host.connections.get(profile.id);
  if (profile === null || connection === undefined) return { ok: false, error: "No connection profile found. Configure a default connection or select one for this chat." };
  const active = env.host.library.setting(user, "activeLoomPresetId");
  const preset = ask.preset ?? (typeof active === "string" && active !== "" ? active : undefined) ?? profile.preset_id ?? undefined;
  if (preset === undefined) return { ok: false, error: env.host.presets.size === 0 ? "No presets available. Create a preset before generating." : "No preset selected. Choose a preset before generating." };
  if (!env.host.presets.has(preset)) return { ok: false, error: "The selected preset was deleted. Pick a different preset before generating." };
  return { ok: true, connection: profile.model === connection.model ? connection : { ...connection, model: profile.model }, preset };
}

const asked = (body: Record<string, unknown>, key: string): string | undefined => (typeof body[key] === "string" && body[key] !== "" ? (body[key] as string) : undefined);

/** The input of a generation from a request's body (`GenerateInput`, `services/generate.service.ts`), the connection and preset found. */
export function generationInput(env: Env, user: string, body: Record<string, unknown>, type: GenerateInput["type"], found: Extract<Resolved, { ok: true }>, dryRun: boolean): GenerateInput {
  const persona = asked(body, "persona_id") ?? (typeof env.host.library.setting(user, "activePersonaId") === "string" ? (env.host.library.setting(user, "activePersonaId") as string) : undefined);
  return {
    chat: String(body.chat_id),
    connection: found.connection.id,
    preset: found.preset,
    type,
    ...(dryRun ? { dryRun: true } : {}),
    ...(persona !== undefined ? { persona } : {}),
    ...(asked(body, "message_id") !== undefined ? { message: asked(body, "message_id")! } : {}),
    ...(isRecord(body.parameters) ? { parameters: body.parameters } : {}),
    ...(asked(body, "target_character_id") !== undefined ? { targetCharacter: asked(body, "target_character_id")! } : {}),
    ...(body.impersonate_draft === true ? { impersonateDraft: true } : {}),
  };
}

/**
 * `POST /api/v1/generate`, `/regenerate` and `/continue` (`routes/generate.routes.ts:27-42`; `services/generate.service.ts:1546-3073`): `chat_id` required (400); the answer is
 * `{generationId, status: "streaming"}` as soon as the generation has begun, the work going on after it; a failure before that, a connection or preset not found among them,
 * is 400 with its message. A regenerate or a continue that names no message and finds the chat's last one the user's, or none, is a normal generation (`:1577-1587`). The
 * generation's end is kept in `generations` by its id, for a test to wait on.
 */
export async function startRoute(env: Env, user: string, mode: "normal" | "regenerate" | "continue", raw: string, generations: Map<string, Promise<Outcome>>): Promise<Reply> {
  const body = json(raw);
  if (body === undefined) return SERVER_ERROR;
  if (!isRecord(body) || !body.chat_id) return { status: 400, body: { error: "chat_id is required" } };
  const fail = (message: string): Reply => ({ status: 400, body: { error: clamped(message) } });
  let type = (mode === "normal" ? asked(body, "generation_type") ?? "normal" : mode) as GenerateInput["type"];
  if (body.background_swipe !== undefined && typeof body.background_swipe !== "boolean") return fail("background_swipe must be a boolean");
  if (body.background_swipe === true) return fail("The stand-in does not model a background swipe.");
  if ((type === "regenerate" || type === "swipe" || type === "continue") && asked(body, "message_id") === undefined) {
    const last = env.db?.rows("SELECT is_user FROM messages WHERE chat_id = ? ORDER BY index_in_chat DESC LIMIT 1", String(body.chat_id))[0];
    if (last === undefined || last.is_user === 1) type = "normal";
  }
  const chat = chatDto(env, user, String(body.chat_id));
  const found = resolveGeneration(env, user, chat === null ? undefined : (chat.metadata as Record<string, unknown>), { ...(asked(body, "connection_id") !== undefined ? { connection: asked(body, "connection_id")! } : {}), ...(asked(body, "preset_id") !== undefined ? { preset: asked(body, "preset_id")! } : {}) });
  if (!found.ok) return fail(found.error);
  if (chat === null || env.host.chats.get(String(body.chat_id))?.user !== user) return fail("Chat not found");
  try {
    const { generationId, done } = await env.host.start(generationInput(env, user, body, type, found, false));
    if (generationId !== null) generations.set(generationId, done);
    return { status: 200, body: { generationId, status: "streaming" } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
