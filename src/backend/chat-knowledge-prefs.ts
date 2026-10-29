// What a chat chose for knowledge (DESIGN §6.11, §24): whether it tracks who knows what, and what
// the narrator knows (`NarratorView`). Each falls back in one order: this chat's own choice, then its
// world's default, then the user's Settings. A chat's own choice lives in the host's chat metadata
// under LRE's key (`lumi_rp_engine.prefs`, beside the chat's `ChatRun`), never in its ledger: it is
// how the chat is played, not a fact of its story, so a swipe, a Re-run or an Undo never changes it,
// recorded turns replay as they were, and a Lumiverse Branch, which copies the chat's metadata,
// keeps it.

import type { ChatId, UserId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { SECRET_MARK_WORDING, type SecretMarkWording } from "../shared/secret-marks";
import { narratorViewOf, type NarratorView, type UserSettings } from "../shared/settings";
import type { WorldDoc } from "../shared/world";
import type { HostPort } from "./host";

/** A chat's own choices; a part left out follows its world's default, else the user's Settings. */
export interface ChatKnowledgePrefs {
  /** Knowledge tracking in this chat, on or off; absent, Settings → Minds → Knowledge's. */
  knowledge?: boolean;
  /** What the narrator knows in this chat; absent, the world's default, else Settings → Narrator's. */
  narrator?: NarratorView;
}

/** A change to a chat's own choices: a value sets one, null returns it to what it follows, and a part left out stays as it is. */
export interface ChatKnowledgeChange {
  knowledge?: boolean | null;
  narrator?: NarratorView | null;
}

/** Where a chat's own choices sit inside LRE's key of its metadata. */
const PREFS_KEY = "prefs";

/** Chats whose choices are kept read, as the runtime keeps their runs. */
const KEPT = 512;

/** A chat's own choices as its metadata holds them; a malformed part is left out, so it follows. */
export function chatKnowledgePrefsOf(meta: JsonObject): ChatKnowledgePrefs {
  const own = meta[LEDGER_NAMESPACE];
  const raw = isRecord(own) ? own[PREFS_KEY] : undefined;
  if (!isRecord(raw)) return {};
  const narrator = narratorViewOf(raw.narrator);
  return { ...(typeof raw.knowledge === "boolean" ? { knowledge: raw.knowledge } : {}), ...(narrator ? { narrator } : {}) };
}

/** What the narrator knows: this chat's choice, else its world's default (when it is a whole one), else the user's. */
export function narratorView(chat: ChatKnowledgePrefs | null, world: Pick<WorldDoc, "narrator"> | null, settings: Pick<UserSettings, "narrator">): NarratorView {
  const set = chat?.narrator ?? narratorViewOf(world?.narrator) ?? settings.narrator;
  return { knowledge: set.knowledge, secrets: set.secrets };
}

/**
 * Whether the chat tracks who knows what: its own switch, else the user's (Settings → Minds →
 * Knowledge). A world sets no default for it (AGENT-LOOP-PLAN §15); `world` keeps the one order and
 * signature `narratorView` has.
 */
export function knowledgeOn(chat: ChatKnowledgePrefs | null, world: Pick<WorldDoc, "narrator"> | null, settings: Pick<UserSettings, "minds">): boolean {
  return chat?.knowledge ?? settings.minds.knowledge.enabled;
}

/** The wording of a secret's mark (Settings → Narrator): the user's own, part by part, else the shipped text. */
export function secretMarkWording(settings: Pick<UserSettings, "narrator">): SecretMarkWording {
  return { ...SECRET_MARK_WORDING, ...settings.narrator.marks };
}

/** Each chat's own choices, read once from its metadata and kept per (user, chat), so one user's read never answers another's. */
export class ChatKnowledge {
  private readonly prefs = new Map<string, ChatKnowledgePrefs>();

  constructor(private readonly host: Pick<HostPort, "chats">) {}

  private keep(chatId: ChatId, userId: UserId, prefs: ChatKnowledgePrefs): void {
    const key = `${userId}\u0000${chatId}`;
    this.prefs.delete(key);
    this.prefs.set(key, prefs);
    if (this.prefs.size > KEPT) this.prefs.delete(this.prefs.keys().next().value ?? "");
  }

  /** Keeps what a read of the chat's metadata holds (the runtime reads its run from the same bag), so nothing reads it again. */
  seen(chatId: ChatId, userId: UserId, meta: JsonObject): void {
    this.keep(chatId, userId, chatKnowledgePrefsOf(meta));
  }

  async get(chatId: ChatId, userId: UserId): Promise<ChatKnowledgePrefs> {
    const known = this.prefs.get(`${userId}\u0000${chatId}`);
    if (known) return known;
    const prefs = chatKnowledgePrefsOf(await this.host.chats.chatMetadata(chatId, userId));
    this.keep(chatId, userId, prefs);
    return prefs;
  }

  /** The chat's choices as known now, as one comparable value (a prepared turn's `TurnInputs.chat`); empty before they are read. */
  key(chatId: ChatId, userId: UserId): string {
    const known = this.prefs.get(`${userId}\u0000${chatId}`);
    return known ? JSON.stringify(known) : "";
  }

  /**
   * Sets the chat's own choices, read-merge-write into its metadata: every other key of LRE's (the
   * chat's run) and of other writers stays as it is. Only a chat that plays a world has them.
   */
  async set(chatId: ChatId, userId: UserId, change: ChatKnowledgeChange): Promise<ChatKnowledgePrefs> {
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const own = meta[LEDGER_NAMESPACE];
    if (!isRecord(own)) throw new Error("this chat plays no world");
    const next: ChatKnowledgePrefs = { ...chatKnowledgePrefsOf(meta) };
    if (change.knowledge === null) delete next.knowledge;
    else if (change.knowledge !== undefined) next.knowledge = change.knowledge;
    if (change.narrator === null) delete next.narrator;
    else if (change.narrator !== undefined) next.narrator = { knowledge: change.narrator.knowledge, secrets: change.narrator.secrets };
    const stored: JsonObject = { ...own };
    delete stored[PREFS_KEY];
    const prefs: JsonObject = {};
    if (next.knowledge !== undefined) prefs.knowledge = next.knowledge;
    if (next.narrator) prefs.narrator = { knowledge: next.narrator.knowledge, secrets: next.narrator.secrets };
    // A chat that follows in both stores no `prefs` at all.
    if (Object.keys(prefs).length > 0) stored[PREFS_KEY] = prefs;
    await this.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: stored }, userId);
    this.keep(chatId, userId, next);
    return next;
  }

  /** Forgets a chat's choices (after an attach), so they are read afresh. */
  forget(chatId: ChatId): void {
    for (const key of [...this.prefs.keys()]) if (key.endsWith(`\u0000${chatId}`)) this.prefs.delete(key);
  }
}
