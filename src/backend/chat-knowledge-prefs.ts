// What a chat chose for knowledge (DESIGN §6.11, §24): whether it tracks who knows what, and what
// the narrator knows (`NarratorView`); which engine plays its turns (INC2-SPEC C12, INC3 3a:
// classic, or agents); and whether its impossible holds are tidied automatically (ITEMS-SPEC §9,
// §11: GM → This chat → Things). Knowledge and the narrator fall back in one order: this chat's own
// choice, then its world's default, then the user's Settings; the tidy switch is this chat's own,
// else its world's. The engine is the chat's own choice, stored as it was made, classic too; else, a
// chat with no LRE turn on its path takes the user's New chats start on, which its first turn
// records as the chat's (marked as the default's, `engineFrom`); else classic (`engineOf`). A
// chat's own choice lives in the host's chat metadata under LRE's key (`lumi_rp_engine.prefs`,
// beside the chat's `ChatRun`), never in its ledger: it is how the chat is played, not a fact of its
// story, so a swipe, a Re-run or an Undo never changes it, recorded turns replay as they were, and a
// Lumiverse Branch, which copies the chat's metadata, keeps it. A choice is written in the chat's
// turn among LRE's writes of its metadata (`ChatMetaQueue`).

import { CHAT_ENGINES, type ChatEngine, type EngineSource } from "../shared/agent-settings";
import { ENGINE_OFFER_CHOICES, ENGINE_OFFER_KIND, ENGINE_OFFER_TEXT } from "../shared/engine-offer";
import type { ChatId, UserId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { narratorViewOf, type NarratorView, type UserSettings } from "../shared/settings";
import { thingsConfigOf } from "../shared/things";
import type { WorldDoc } from "../shared/world";
import type { Chip } from "../shared/state-view";
import type { ChainMessage } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { activeRecord } from "../engine/ledger/path";
import { ChatMetaQueue } from "./chat-meta-queue";
import type { HostPort } from "./host";
import { turnFrame } from "./turn-frame";
import { renderPrompt } from "./prompts";

/** A chat's own choices; a part left out follows its world's default, else the user's Settings; the engine left out follows `engineOf`. */
export interface ChatKnowledgePrefs {
  /** Knowledge tracking in this chat, on or off; absent, Settings → Minds → Knowledge's. */
  knowledge?: boolean;
  /** What the narrator knows in this chat; absent, the world's default, else Settings → Narrator's. */
  narrator?: NarratorView;
  /** The engine that plays this chat's turns, classic as well as agents; absent, `engineOf` says. */
  engine?: ChatEngine;
  /** With `engine`: it is New chats start on's, recorded at the chat's first turn, not a choice the chat made; absent, the chat's own. */
  engineFrom?: "default";
  /** Tidy impossible holds automatically in this chat (the one-time Things tidied fix); absent, the world's (Build → Packs → gear → Tidy up). */
  tidy?: boolean;
}

/** A change to a chat's own choices: a value sets one, null returns it to what it follows, and a part left out stays as it is. */
export interface ChatKnowledgeChange {
  knowledge?: boolean | null;
  narrator?: NarratorView | null;
  /** A choice of the chat's own (the switch, the offer's buttons); null returns it to what `engineOf` says for a chat with no choice. */
  engine?: ChatEngine | null;
  tidy?: boolean | null;
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
  const engine = CHAT_ENGINES.find((e) => e === raw.engine);
  return { ...(typeof raw.knowledge === "boolean" ? { knowledge: raw.knowledge } : {}), ...(narrator ? { narrator } : {}), ...(engine ? { engine, ...(raw.engineFrom === "default" ? { engineFrom: "default" as const } : {}) } : {}), ...(typeof raw.tidy === "boolean" ? { tidy: raw.tidy } : {}) };
}

/**
 * Which engine a chat's next turn plays, and where that comes from (INC3 3a, D1), in order: its own
 * choice, or the default its first turn recorded; else, with no LRE turn on its path (`played`
 * false), the user's New chats start on, which that turn records; else classic, for a chat that
 * played before it chose.
 */
export function engineOf(prefs: Pick<ChatKnowledgePrefs, "engine" | "engineFrom">, played: boolean, newChats: ChatEngine): { engine: ChatEngine; from: EngineSource } {
  if (prefs.engine) return { engine: prefs.engine, from: prefs.engineFrom === "default" ? "default" : "chosen" };
  return played ? { engine: "classic", from: "played" } : { engine: newChats, from: "new" };
}

/** Whether an LRE turn is recorded on the chat's path: a reply on its chain with a record of its own. */
export function playedOn(core: LedgerCore, observed: readonly ChainMessage[]): boolean {
  return core.chain(observed).some((m) => !m.isUser && activeRecord(m, core.journal.tombstones) !== null);
}

/**
 * The offer to switch to agents (INC3 3a, D2) under the chat's last message (`messageId`), in the
 * user's words: on a classic chat that has played and has no choice of its own (none at all, or the
 * classic default its first turn recorded), while the user's new chats start on agents. Null on any
 * other chat; a chat whose own choice is either engine never shows it again. `played` (`playedOn`)
 * is asked only of a chat with no engine stored.
 */
export function engineOfferChip(prefs: Pick<ChatKnowledgePrefs, "engine" | "engineFrom">, played: () => boolean, settings: Pick<UserSettings, "agents" | "prompts">, messageId: string | null): Chip | null {
  if (messageId === null || settings.agents.newChats !== "agents") return null;
  const { engine, from } = engineOf(prefs, prefs.engine !== undefined || played(), settings.agents.newChats);
  if (engine !== "classic" || from === "chosen") return null;
  const text = (id: string): string => renderPrompt(id, settings.prompts.texts, {}).trim();
  return {
    id: `${ENGINE_OFFER_KIND}:${messageId}`,
    kind: ENGINE_OFFER_KIND,
    messageId,
    label: text(ENGINE_OFFER_TEXT.label),
    detail: text(ENGINE_OFFER_TEXT.detail),
    actions: [
      { id: ENGINE_OFFER_CHOICES.switch, label: text(ENGINE_OFFER_TEXT.switch), style: "primary" },
      { id: ENGINE_OFFER_CHOICES.keep, label: text(ENGINE_OFFER_TEXT.keep) },
    ],
    expires: "never",
  };
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

/** Whether an older chat's impossible holds are tidied automatically (ITEMS-SPEC §9): the chat's own switch (GM → This chat → Things), else its world's (`tidy.auto`). */
export function tidyOn(chat: ChatKnowledgePrefs | null, world: Pick<WorldDoc, "packs">): boolean {
  return chat?.tidy ?? thingsConfigOf(world).tidy.auto;
}

/** Each chat's own choices, read once from its metadata and kept per (user, chat), so one user's read never answers another's. */
export class ChatKnowledge {
  private readonly prefs = new Map<string, ChatKnowledgePrefs>();

  constructor(
    private readonly host: Pick<HostPort, "chats">,
    /** The chat's turn among LRE's writes of its metadata (one queue for every writer of it). */
    private readonly queue: ChatMetaQueue = new ChatMetaQueue(),
  ) {}

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

  /**
   * The chat's own choices. Inside a turn of the chat's work they are that turn's: as they stood
   * when its engine run started (`TurnFrame`), so a choice made meanwhile, its engine included,
   * applies from the chat's next turn, and a turn finishes on the engine it started on.
   */
  async get(chatId: ChatId, userId: UserId): Promise<ChatKnowledgePrefs> {
    const frame = turnFrame();
    if (frame?.chatId === chatId && frame.userId === userId) return frame.chat;
    const known = this.prefs.get(`${userId}\u0000${chatId}`);
    if (known) return known;
    const prefs = chatKnowledgePrefsOf(await this.host.chats.chatMetadata(chatId, userId));
    this.keep(chatId, userId, prefs);
    return prefs;
  }

  /** The engine that plays the chat's turns as its own choices say (a turn's frame holds the one its first turn recorded); a chat with none plays classic. */
  async engine(chatId: ChatId, userId: UserId): Promise<ChatEngine> {
    return (await this.get(chatId, userId)).engine ?? "classic";
  }

  /**
   * The chat's own choices as a turn's engine run starts (`Runtime.frame`): a chat with no engine of
   * its own and no LRE turn on its path (`played`, asked only then) records `newChats` as its engine,
   * marked as the default's, so this turn and every later one plays it whatever the default becomes.
   * Re-read in the chat's turn among the writers of its metadata, so a choice made meanwhile stands.
   */
  async forTurn(chatId: ChatId, userId: UserId, newChats: ChatEngine, played: () => boolean): Promise<ChatKnowledgePrefs> {
    const prefs = await this.get(chatId, userId);
    if (prefs.engine || played()) return prefs;
    return this.queue.run(chatId, userId, async () => {
      const meta = await this.host.chats.chatMetadata(chatId, userId);
      const own = meta[LEDGER_NAMESPACE];
      const now = chatKnowledgePrefsOf(meta);
      if (now.engine || !isRecord(own)) {
        this.keep(chatId, userId, now);
        return now;
      }
      const next: ChatKnowledgePrefs = { ...now, engine: newChats, engineFrom: "default" };
      const stored: JsonObject = { ...own, [PREFS_KEY]: { ...(isRecord(own[PREFS_KEY]) ? own[PREFS_KEY] : {}), engine: newChats, engineFrom: "default" } };
      await this.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: stored }, userId);
      this.keep(chatId, userId, next);
      return next;
    });
  }

  /**
   * Sets the chat's own choices, read-merge-write into its metadata in the chat's turn: every other
   * key of LRE's (the chat's run, its agents') and of other writers stays as it is. Only a chat that
   * plays a world has them.
   */
  set(chatId: ChatId, userId: UserId, change: ChatKnowledgeChange): Promise<ChatKnowledgePrefs> {
    return this.queue.run(chatId, userId, async () => {
      const meta = await this.host.chats.chatMetadata(chatId, userId);
      const own = meta[LEDGER_NAMESPACE];
      if (!isRecord(own)) throw new Error("this chat plays no world");
      const next: ChatKnowledgePrefs = { ...chatKnowledgePrefsOf(meta) };
      if (change.knowledge === null) delete next.knowledge;
      else if (change.knowledge !== undefined) next.knowledge = change.knowledge;
      if (change.narrator === null) delete next.narrator;
      else if (change.narrator !== undefined) next.narrator = { knowledge: change.narrator.knowledge, secrets: change.narrator.secrets };
      // Every choice is stored as made, classic too, so a chat that said no is told apart from one that never chose.
      if (change.engine === null) {
        delete next.engine;
        delete next.engineFrom;
      } else if (change.engine !== undefined) {
        next.engine = change.engine;
        delete next.engineFrom;
      }
      if (change.tidy === null) delete next.tidy;
      else if (change.tidy !== undefined) next.tidy = change.tidy;
      const stored: JsonObject = { ...own };
      delete stored[PREFS_KEY];
      const prefs: JsonObject = {};
      if (next.knowledge !== undefined) prefs.knowledge = next.knowledge;
      if (next.narrator) prefs.narrator = { knowledge: next.narrator.knowledge, secrets: next.narrator.secrets };
      if (next.engine) {
        prefs.engine = next.engine;
        if (next.engineFrom) prefs.engineFrom = next.engineFrom;
      }
      if (next.tidy !== undefined) prefs.tidy = next.tidy;
      // A chat that follows in every part stores no `prefs` at all.
      if (Object.keys(prefs).length > 0) stored[PREFS_KEY] = prefs;
      await this.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: stored }, userId);
      this.keep(chatId, userId, next);
      return next;
    });
  }

  /** Forgets a chat's choices (after an attach), so they are read afresh. */
  forget(chatId: ChatId): void {
    for (const key of [...this.prefs.keys()]) if (key.endsWith(`\u0000${chatId}`)) this.prefs.delete(key);
  }
}
