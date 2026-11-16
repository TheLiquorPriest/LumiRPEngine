// Lumiverse's rows as RPE reads them, from its database file or from its HTTP routes, which give the
// same rows through Lumiverse's own mappers. Each mapper here follows Lumiverse's for the fields RPE
// reads: its fallbacks for bad JSON where it has them, and a refusal (`Unreadable`) where its own
// mapper would throw, so a row Lumiverse cannot serve over HTTP is not read from its file either.
// Paths below are Lumiverse's `src/`.

import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import { textHash } from "./wire";

/** A row Lumiverse's own mapper fails on, and why. */
export class Unreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unreadable";
  }
}

export type LvRole = "user" | "assistant" | "system";

export interface LvChat {
  id: string;
  user: string;
  /** Null for a chat with no character (a temporary chat). */
  character: string | null;
  name: string;
  metadata: JsonObject;
  /** Seconds since 1970, as Lumiverse stamps it. */
  updatedAt: number;
}

export interface LvMessage {
  id: string;
  chat: string;
  /** Lumiverse's `index_in_chat`: a delete leaves a gap (`chats.service.ts:3229-3238`), an insertion shifts the later ones up (`:2652-2655`). */
  index: number;
  role: LvRole;
  name: string;
  /** The text the prompt is built from (`content`; `prompt-assembly.service.ts` reads it). */
  text: string;
  /** The swipe it shows, and how many it has. */
  swipe: number;
  swipes: number;
  /** Hidden from the prompt (`extra.hidden`, `prompt-assembly.service.ts:3252`, `chats.service.ts:3105-3109`). */
  hidden: boolean;
  /** When it was sent, in milliseconds (Lumiverse stores seconds, `chats.service.ts:2646`). */
  sentAt: number;
  /** Lumiverse's revision: an edit raises it, a hidden mark or an assistant's swipe flip does not (`chats.service.ts:3016`, `:3095`, `:3292-3297`). */
  revision: number;
  /**
   * The showing swipe as RPE's store ties a played turn to it, and as the importer tied a migrated one:
   * the hash of its saved text (`swipes[swipe]`; `content` where the list has no text there) and its
   * date as Lumiverse stores it (`swipe_dates[swipe]`, the raw number; null where the list has none).
   */
  shown: { hash: string; date: number | null };
  /**
   * Every swipe as saved, in order: its text (`swipes[i]`; "" where that is not text) and its date as
   * Lumiverse stores it (`swipe_dates[i]`; null where the list has none). A generation writes into its
   * own swipe, which need not be the one shown. One, the message's `content`, where `swipes` is no list.
   */
  saves: { text: string; date: number | null }[];
}

export interface LvBook {
  id: string;
  name: string;
  description: string;
  metadata: JsonObject;
  /** When Lumiverse made the book, in seconds. */
  createdAt: number;
  updatedAt: number;
}

export interface LvEntry {
  id: string;
  /** Its book's id. */
  book: string;
  /** The key of its counts in the chat's `metadata.wi_state` (`world-info-activation.service.ts:16-23`), which is not its id. */
  uid: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  /** The entry's title in Lumiverse's editor. */
  comment: string;
  position: number;
  depth: number;
  role: string | null;
  order: number;
  constant: boolean;
  disabled: boolean;
  selective: boolean;
  vectorized: boolean;
  /** How many generations it stays on after its keys stop matching; 0 where it has no sticky window (`world-info-activation.service.ts:454-470`). */
  sticky: number;
  /** Its extensions without the keys Lumiverse sends as fields of their own (`world-books.service.ts:219-236`). */
  extensions: JsonObject;
  revision: number;
  updatedAt: number;
}

export interface LvCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleMessages: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  tags: JsonValue;
  alternateGreetings: JsonValue;
  extensions: JsonObject;
  /** Its books, as Lumiverse reads them (`utils/character-world-books.ts:6-14`). */
  books: string[];
  updatedAt: number;
}

export interface LvPersona {
  id: string;
  name: string;
  title: string;
  description: string;
  metadata: JsonValue;
  /** Its book (`personas.attached_world_book_id`). */
  book: string | null;
  isDefault: boolean;
  isNarrator: boolean;
  updatedAt: number;
}

export interface LvPreset {
  id: string;
  name: string;
  provider: string;
  engine: string;
  parameters: JsonValue;
  promptOrder: JsonValue;
  prompts: JsonValue;
  metadata: JsonValue;
  /** Lumiverse's `cache_revision`: moves when the preset's prompt changes. */
  revision: number;
  updatedAt: number;
}

export interface LvSetting {
  key: string;
  value: JsonValue;
  updatedAt: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const flag = (v: unknown): boolean => v === true || (typeof v === "number" && v !== 0);
const object = (v: unknown): JsonObject => (isRecord(v) ? (v as JsonObject) : {});

/** Lumiverse's `JSON.parse` on a column where its mapper has no fallback: what it cannot parse it cannot serve. */
function parsed(value: unknown, what: string): JsonValue {
  if (typeof value !== "string") return (value ?? null) as JsonValue;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new Unreadable(`its ${what} are not JSON`);
  }
}

/** `parseMetadataObject` (`db/chat-operations.ts:82-90`): an object, or an empty one. */
function metadataObject(value: unknown): JsonObject {
  if (isRecord(value)) return value as JsonObject;
  if (typeof value !== "string") return {};
  try {
    const v: unknown = JSON.parse(value);
    return isRecord(v) ? (v as JsonObject) : {};
  } catch {
    return {};
  }
}

function id(v: unknown): string {
  if (typeof v !== "string" || v === "") throw new Unreadable("its id is not text");
  return v;
}

/** A chat (`rowToChat`, `db/chat-operations.ts:92-95`); `metadata` as stored or as sent. */
export function chatFrom(row: Record<string, unknown>): LvChat {
  return { id: id(row.id), user: str(row.user_id), character: typeof row.character_id === "string" && row.character_id !== "" ? row.character_id : null, name: str(row.name), metadata: metadataObject(row.metadata), updatedAt: num(row.updated_at) };
}

/**
 * A message (`rowToMessage`, `chats.service.ts:587-605`): `swipes` and `extra` as stored (JSON text,
 * with Lumiverse's fallbacks) or as sent (parsed); the role as `getMessageRole` gives it
 * (`utils/message-role.ts:4-6`).
 */
export function messageFrom(row: Record<string, unknown>): LvMessage {
  let swipes: unknown = row.swipes;
  if (typeof swipes === "string") {
    try {
      swipes = JSON.parse(swipes);
    } catch {
      swipes = [row.content ?? ""];
    }
  }
  let extra: unknown = row.extra;
  if (typeof extra === "string") {
    try {
      extra = JSON.parse(extra);
    } catch {
      extra = {};
    }
  }
  const ex = object(extra);
  // Lumiverse's mapper reads `swipe_dates` that are not JSON as none (`chats.service.ts:589-592`).
  let dates: unknown = row.swipe_dates;
  if (typeof dates === "string") {
    try {
      dates = JSON.parse(dates);
    } catch {
      dates = [];
    }
  }
  const isUser = flag(row.is_user);
  const swipe = num(row.swipe_id);
  const saved: unknown = Array.isArray(swipes) ? (swipes as unknown[])[swipe] : undefined;
  const date: unknown = Array.isArray(dates) ? (dates as unknown[])[swipe] : undefined;
  return {
    id: id(row.id),
    chat: str(row.chat_id),
    index: num(row.index_in_chat),
    role: isUser ? "user" : ex.spindle_role === "system" ? "system" : "assistant",
    name: str(row.name),
    text: str(row.content),
    swipe,
    swipes: Array.isArray(swipes) ? swipes.length : 1,
    hidden: ex.hidden === true,
    sentAt: num(row.send_date) * 1000,
    revision: num(row.revision),
    shown: { hash: textHash(typeof saved === "string" ? saved : str(row.content)), date: typeof date === "number" ? date : null },
    saves: Array.isArray(swipes)
      ? (swipes as unknown[]).map((text, i) => {
          const at: unknown = Array.isArray(dates) ? (dates as unknown[])[i] : undefined;
          return { text: typeof text === "string" ? text : "", date: typeof at === "number" ? at : null };
        })
      : [{ text: str(row.content), date: null }],
  };
}

/** A world book (`rowToBook`, `world-books.service.ts:271-282`). */
export function bookFrom(row: Record<string, unknown>): LvBook {
  return { id: id(row.id), name: str(row.name), description: str(row.description), metadata: object(parsed(row.metadata, "metadata")), createdAt: num(row.created_at), updatedAt: num(row.updated_at) };
}

/** The keys Lumiverse moves out of an entry's extensions (`world-books.service.ts:219-236`). */
const MANAGED = ["outlet_name", "outletName", "wi_marker", "wiMarker", "wi_marker_side", "wiMarkerSide"];

/** An entry (`rowToEntry`, `world-books.service.ts:343-376`). */
export function entryFrom(row: Record<string, unknown>): LvEntry {
  const extensions = { ...object(parsed(row.extensions, "extensions")) };
  for (const key of MANAGED) delete extensions[key];
  const keys = parsed(row.key, "keys");
  const secondary = parsed(row.keysecondary, "secondary keys");
  return {
    id: id(row.id),
    uid: str(row.uid),
    book: id(row.world_book_id),
    keys: Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [],
    secondaryKeys: Array.isArray(secondary) ? secondary.filter((k): k is string => typeof k === "string") : [],
    content: str(row.content),
    comment: str(row.comment),
    position: num(row.position),
    depth: num(row.depth),
    role: typeof row.role === "string" && row.role !== "" ? row.role : null,
    order: num(row.order_value),
    constant: flag(row.constant),
    disabled: flag(row.disabled),
    selective: flag(row.selective),
    vectorized: flag(row.vectorized),
    sticky: num(row.sticky),
    extensions,
    revision: num(row.revision),
    updatedAt: num(row.updated_at),
  };
}

/** A character (`rowToCharacter`, `characters.service.ts:584-596`). */
export function characterFrom(row: Record<string, unknown>): LvCharacter {
  const extensions = object(parsed(row.extensions, "extensions"));
  const ids = extensions.world_book_ids;
  const books = Array.isArray(ids) ? ids.filter((b): b is string => typeof b === "string" && b !== "") : typeof extensions.world_book_id === "string" && extensions.world_book_id !== "" ? [extensions.world_book_id] : [];
  return {
    id: id(row.id),
    name: str(row.name),
    description: str(row.description),
    personality: str(row.personality),
    scenario: str(row.scenario),
    firstMessage: str(row.first_mes),
    exampleMessages: str(row.mes_example),
    systemPrompt: str(row.system_prompt),
    postHistoryInstructions: str(row.post_history_instructions),
    tags: parsed(row.tags, "tags"),
    alternateGreetings: parsed(row.alternate_greetings, "alternate greetings"),
    extensions,
    books,
    updatedAt: num(row.updated_at),
  };
}

/** A persona (`rowToPersona`, `db/persona-operations.ts:4-20`). */
export function personaFrom(row: Record<string, unknown>): LvPersona {
  return {
    id: id(row.id),
    name: str(row.name),
    title: str(row.title),
    description: str(row.description),
    metadata: parsed(row.metadata, "metadata"),
    book: typeof row.attached_world_book_id === "string" && row.attached_world_book_id !== "" ? row.attached_world_book_id : null,
    isDefault: flag(row.is_default),
    isNarrator: flag(row.is_narrator),
    updatedAt: num(row.updated_at),
  };
}

/** A preset (`rowToPreset`, `presets.service.ts:75-92`). */
export function presetFrom(row: Record<string, unknown>): LvPreset {
  return {
    id: id(row.id),
    name: str(row.name),
    provider: str(row.provider),
    engine: str(row.engine),
    parameters: parsed(row.parameters, "parameters"),
    promptOrder: parsed(row.prompt_order, "prompt order"),
    prompts: parsed(row.prompts, "prompts"),
    metadata: parsed(row.metadata, "metadata"),
    revision: num(row.cache_revision),
    updatedAt: num(row.updated_at),
  };
}

/** A setting (`getSetting`, `settings.service.ts:22-26`). */
export function settingFrom(row: Record<string, unknown>): LvSetting {
  return { key: str(row.key), value: parsed(row.value, "value"), updatedAt: num(row.updated_at) };
}
