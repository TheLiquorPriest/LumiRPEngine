// The LumiRPEngine Studio bridge (DESIGN §15; docs/STUDIO.md "The Studio bridge"): the endpoint
// names, payloads and window events LumiRPEngine and LumiRPEngine Studio share. A shared RPC read
// carries no request and no user, so each side publishes per-user endpoints and the other pulls:
// the engine publishes its worlds and world chats, the Studio publishes the world it offers, and
// nothing installs until the player confirms it in LumiRPEngine.

import type { ChatId, EntityId, PlaceId, RevisionId, UserId, WorldId } from "./ids";
import type { JsonValue } from "./json";
import { isRecord } from "./json";
import type { StateView } from "./state-view";
import type { WorldDoc } from "./world";
import { formatMoney } from "./world";

export const ENGINE_EXTENSION = "lumi_rp_engine";
export const STUDIO_EXTENSION = "lumi_rp_engine_studio";

/** The engine's announcement (`StudioState`), and the request that has it announced again for a frontend that loaded later. */
export const STATE_EVENT = "lre-state-v1";
export const STATE_REQUEST_EVENT = "lre-state-request-v1";
/** The Studio's frontend saying an offer is waiting (`{offerId}`); the engine's saying one was installed (`StudioInstalled`). */
export const STUDIO_OFFER_EVENT = "lre-studio-offer-v1";
export const STUDIO_INSTALLED_EVENT = "lre-studio-installed-v1";

/** The ways a world comes in (`StudioState.inbound`): an export file, and the Studio's offer endpoint. */
export const STUDIO_INBOUND: readonly string[] = ["file", `rpc:${STUDIO_EXTENSION}.offer`];

/** At most this many world chats are summarized per user; the oldest summary goes first. */
export const CHAT_SUMMARY_CAP = 24;
/** At most this many revisions are listed per world (the newest); `revisionCount` says how many there are. */
export const REVISIONS_LISTED = 32;
/** At most this many present people and open quests per chat summary. */
const PRESENT_CAP = 24;
const QUEST_CAP = 24;

const encoder = new TextEncoder();

/**
 * An id as one channel segment: its UTF-8 bytes in lowercase hex. A segment takes only
 * `[a-z0-9_-]`, and user and world ids are mixed case, so a plain lowercase would make two ids one.
 */
export function channelId(id: string): string {
  let out = "";
  for (const byte of encoder.encode(id)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The engine's world list for a user (`StudioWorldList`). */
export function worldsChannel(userId: UserId): string {
  return `studio-worlds.${channelId(userId)}`;
}

/** The engine's world chats for a user (`StudioChats`). */
export function chatsChannel(userId: UserId): string {
  return `studio-chats.${channelId(userId)}`;
}

/** One of the user's worlds (`StudioWorldRead`): its head, or one of its revisions (a revision id is 32 hex digits, a segment as it is). */
export function worldChannel(userId: UserId, worldId: WorldId, revision?: RevisionId): string {
  return `studio-world.${channelId(userId)}.${channelId(worldId)}${revision === undefined ? "" : `.${revision}`}`;
}

/** The Studio's pending offer for a user, as the engine reads it. */
export function offerEndpoint(userId: UserId): string {
  return `${STUDIO_EXTENSION}.offer.${channelId(userId)}`;
}

/** An engine endpoint as the Studio reads it. */
export function engineEndpoint(channel: string): string {
  return `${ENGINE_EXTENSION}.${channel}`;
}

/**
 * What the Studio offers: a world document to install as a new world, or as the next revision of
 * one of the user's worlds; with `attachChatId`, the chat to attach it to once installed.
 */
export interface StudioOffer {
  offerId: string;
  doc: JsonValue;
  mode: "new" | "revision";
  worldId?: WorldId;
  attachChatId?: ChatId;
  /**
   * For a revision: the revision of `worldId` the document was taken from (its head then), so Build
   * can tell when the world has moved on since. Absent when the Studio doesn't know it.
   */
  baseRevision?: RevisionId;
  createdAt: number;
}

/** An offer as read from the Studio, or null when it isn't one (the document itself is checked when it's reviewed). */
export function readOffer(value: unknown): StudioOffer | null {
  if (!isRecord(value) || typeof value.offerId !== "string" || value.offerId === "" || !isRecord(value.doc)) return null;
  if (value.mode !== "new" && value.mode !== "revision") return null;
  if (value.mode === "revision" && (typeof value.worldId !== "string" || value.worldId === "")) return null;
  if (value.attachChatId !== undefined && (typeof value.attachChatId !== "string" || value.attachChatId === "")) return null;
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  return {
    offerId: value.offerId,
    doc: value.doc as JsonValue,
    mode: value.mode,
    ...(value.mode === "revision" ? { worldId: value.worldId as WorldId } : {}),
    ...(typeof value.attachChatId === "string" ? { attachChatId: value.attachChatId } : {}),
    ...(value.mode === "revision" && typeof value.baseRevision === "string" && value.baseRevision !== "" ? { baseRevision: value.baseRevision } : {}),
    createdAt,
  };
}

/** The `lre-studio-installed-v1` detail: which offer became which world revision. */
export interface StudioInstalled {
  offerId: string;
  mode: "new" | "revision";
  worldId: WorldId;
  revision: RevisionId;
}

export interface StudioWorldEntry {
  id: WorldId;
  name: string;
  head: RevisionId;
  /** The newest `REVISIONS_LISTED` revisions, oldest first. */
  revisions: RevisionId[];
  revisionCount: number;
}

export interface StudioWorldList {
  v: 1;
  worlds: StudioWorldEntry[];
}

export interface StudioWorldRead {
  v: 1;
  worldId: WorldId;
  name: string;
  head: RevisionId;
  revision: RevisionId;
  world: WorldDoc;
}

/**
 * A world chat as its player sees it: built from the state the engine pushes to the chat's own
 * view, so it names only what the POV knows. The world document holds the rest.
 */
export interface StudioChatSummary {
  chatId: ChatId;
  worldId: WorldId;
  revision: RevisionId;
  /** The revision the chat's entity definitions still come from, when an Upgrade left them behind. */
  definitionsFrom?: RevisionId;
  status: "idle" | "in_flight" | "paused";
  place: { id: PlaceId | null; name: string } | null;
  clock: { minutes: number; label: string; dayPart: string } | null;
  /** The POV's cash as the HUD shows it: a band, or the amount in the world's currency. */
  cash: string | null;
  /** The people present the POV sees; `life`: their life state as the POV knows it, when that isn't alive. */
  present: { id: EntityId; name: string; label: string; life?: string }[];
  /** A secret goes by the quest log's own stand-in id (`~…`): its own is the author's, and may name the secret. */
  quests: { id: string; kind: string; label: string; stage: string; cue: string | null }[];
  /** Epoch ms of the state it was read from. */
  at: number;
}

export interface StudioChats {
  v: 1;
  chats: StudioChatSummary[];
}

/** A world chat's summary from the view pushed to it; null for a chat that plays no world. */
export function chatSummary(view: StateView, at: number): StudioChatSummary | null {
  if (view.status === "not_world" || view.worldId === null || view.revision === null) return null;
  const hud = view.hud;
  const cash = hud?.cash ? ("band" in hud.cash ? hud.cash.band : view.currency ? formatMoney(hud.cash.cents, view.currency) : String(hud.cash.cents)) : null;
  return {
    chatId: view.chatId,
    worldId: view.worldId,
    revision: view.revision,
    ...(view.definitionsFrom ? { definitionsFrom: view.definitionsFrom } : {}),
    status: view.status,
    place: hud?.place ? { id: hud.place.id, name: hud.place.name } : null,
    clock: hud ? { minutes: hud.clock.minutes, label: hud.clock.label, dayPart: hud.clock.dayPart } : null,
    cash,
    present: (view.scene?.present ?? []).slice(0, PRESENT_CAP).map((p) => ({ id: p.id, name: p.name, label: p.label, ...(p.life ? { life: p.life } : {}) })),
    quests: openQuests(view.panels["story.quests"]),
    at,
  };
}

/** The quest log's active tracks (`story.quests`), as its panel shows them to the player, a secret under its stand-in id. */
function openQuests(panel: JsonValue | undefined): StudioChatSummary["quests"] {
  if (!isRecord(panel) || !Array.isArray(panel.active)) return [];
  const out: StudioChatSummary["quests"] = [];
  for (const t of panel.active) {
    if (out.length >= QUEST_CAP) break;
    if (!isRecord(t) || typeof t.id !== "string" || typeof t.label !== "string") continue;
    out.push({ id: t.id, kind: typeof t.kind === "string" ? t.kind : "quest", label: t.label, stage: typeof t.stage === "string" ? t.stage : "", cue: typeof t.cue === "string" ? t.cue : null });
  }
  return out;
}
