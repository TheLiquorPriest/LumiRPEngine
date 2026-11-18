// Lumiverse's database, read without changing it: one user's chats, their messages and their
// metadata, and the few rows today's build made in Lumiverse itself (its books, entries, regex
// scripts and preset blocks), which the report lists and the migration leaves as they are. Every
// read goes through the adapter's door (`src/adapter/lumiverse/migration-reads.ts`): scoped to the
// one user, and checked against Lumiverse's declared schema first. Nothing here names a table.
//
// The database is in WAL mode while Lumiverse runs. It is opened read-only, through SQLite's own
// locks, so a read sees what Lumiverse has committed, the log included; SQLite keeps those locks in
// its shared-memory index beside the database (`lumiverse.db-shm`), which every reader of a WAL
// database writes, Lumiverse's own among them. The database and its log are never written. Where
// Lumiverse is stopped cleanly, neither the log nor the index is there, and nothing can be missing
// from a log that isn't there. A read-only open would then make both files at its first read (as
// SQLite itself does) or fail that read (as macOS's SQLite does), and the open alone never shows
// which: so how to open is decided before opening, and the file is read as immutable, which takes no
// lock and makes no file.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { decodeMessage } from "./today/host-message";
import type { HostMessage } from "../shared/host";
import { isRecord, type JsonObject } from "../shared/json";
import { migrationReads, type MigrationReads, type ProfileRow } from "../adapter/lumiverse/migration-reads";
import { openQuiet } from "./quiet-db";

/** The database's file in Lumiverse's data folder (`src/db/connection.ts`). */
export const DATABASE_FILE = "lumiverse.db";

/**
 * The hash RPE gives a message's text, to tie a turn to the reply as saved and to find it again
 * (STANDALONE-PLAN §6.3): the contract's text hash, the first 32 hex digits of the SHA-256 of its
 * UTF-8, as the adapter gives each message it reads from Lumiverse.
 */
export function textHash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}

/** A message's swipes as RPE knows them: each one's text hash (null for one with no text) and its date, as Lumiverse keeps them; and whether the player hid the message from the prompt. */
export interface SwipeFacts {
  hashes: (string | null)[];
  dates: (number | null)[];
  hidden: boolean;
}

export interface ChatRow {
  id: string;
  name: string;
  /** The character whose chat it is (`character_id`); null for a chat with none, as Lumiverse's temporary chat. */
  character: string | null;
  metadata: JsonObject;
  /** Unix seconds, as Lumiverse keeps it. */
  updatedAt: number;
}

/** How the extension is installed: its storage is per extension (`operator`) or per user (`user`, in its owner's folder). */
export interface Install {
  scope: "operator" | "user";
  owner: string | null;
  branch: string | null;
  version: string;
}

/** What today's build put in Lumiverse itself, counted: the report lists it, and nothing of it changes. */
export interface LumiverseMarks {
  /** Books the engine made for its worlds (metadata `lumi_rp_engine: true`). */
  engineBooks: number;
  /** Entries in those books. */
  engineEntries: number;
  /** Entries of the user's own books carrying the engine's lore fields or secret marks (`extensions.lumi_rp_engine`). */
  markedEntries: number;
  /** Chats with an engine book attached (`chat_world_book_ids`). */
  chatsWithEngineBook: number;
  /** Regex scripts in the engine's folder. */
  regexScripts: number;
  /** Preset blocks named `RPEngine · …` (and the `RPEngine` category). */
  presetBlocks: number;
  /** Preset blocks whose text names an outlet of the engine's (`{{outlet::lre_…}}`). */
  outletReferences: number;
  /** Messages the panels put in the user's chats: their own messages, each carrying the request a panel made. They are the user's chat and stay. */
  panelMessages: number;
  /** Chats pinned to the engine's connection: those today's switch marked, with a connection in their metadata; and how many of them pin a model too. */
  chatsPinned: number;
  chatsPinnedToModel: number;
  /** The scheduler's exclusions in the user's setting: how many origins it excludes, and how many of those are the runtime's address; null where Lumiverse holds no scheduler setting for the user. */
  schedulerExclusions: { listed: number; engine: number } | null;
}

export class LumiverseDb {
  private constructor(
    private readonly reads: MigrationReads,
    /** How it was opened: through SQLite's locks, or as an unchanging file where no log exists. */
    readonly opened: "locked" | "immutable",
  ) {}

  /**
   * Opens Lumiverse's database in `dataDir` for reading only, and only `userId`'s rows: under SQLite's
   * locks while its log or their index is beside it, else as an unchanging file. Every read goes
   * through the adapter's door (`migration-reads.ts`), which checks the file's tables and columns
   * against what Lumiverse declares before it reads.
   */
  static open(dataDir: string, userId: string): LumiverseDb {
    const path = join(dataDir, DATABASE_FILE);
    if (!existsSync(path)) throw new Error(`There is no Lumiverse database at ${path}.`);
    if (existsSync(`${path}-wal`) || existsSync(`${path}-shm`)) {
      const db = new Database(path, { readonly: true });
      return new LumiverseDb(migrationReads({ db, close: () => db.close() }, userId), "locked");
    }
    return new LumiverseDb(migrationReads(openQuiet(path), userId), "immutable");
  }

  close(): void {
    this.reads.close();
  }

  /** The user's name, or null when there is no such user. */
  username(): string | null {
    return this.reads.username();
  }

  /** How the extension is installed, from Lumiverse's own row of it; null when it isn't. */
  install(identifier: string): Install | null {
    return this.reads.install(identifier);
  }

  /** Every chat of the user's, the most recently updated first, as Spindle's chat list reads them (`chats.service.ts`). */
  chats(): ChatRow[] {
    return this.reads.chats();
  }

  /** A character of the user's, by its id and name; null when the user has none of that id. */
  character(characterId: string): { id: string; name: string } | null {
    return this.reads.character(characterId);
  }

  /** The user's connections in Lumiverse, newest first: id, name, provider, address and model; never a key (`migration-reads.ts`). */
  connectionProfiles(): ProfileRow[] {
    return this.reads.connectionProfiles();
  }

  /** The connection the user has selected as active in Lumiverse (`activeProfileId`), where it names a connection they still have; null where none is selected or it can't be read. A chat pinned to none follows it. */
  activeConnection(): string | null {
    try {
      const setting = this.reads.setting("activeProfileId");
      const id = setting !== null && typeof setting.value === "string" ? setting.value.trim() : "";
      return id !== "" && this.reads.connectionProfiles().some((c) => c.id === id) ? id : null;
    } catch {
      return null;
    }
  }

  /** How many messages a chat of the user's holds. */
  messageCount(chatId: string): number {
    return this.reads.messageCount(chatId);
  }

  /**
   * A chat's messages in order, as an extension is handed them (`chat.getMessages`) and today's
   * build reads them (`decodeMessage`), only when the chat is the user's; and each one's swipes as
   * RPE's adapter reads them, by message id. Both come from one read, so that a swipe's place among
   * the messages' swipes is its place among their hashes and dates. A swipe's hash is that of its text
   * in `swipes` (of `content` for the showing one when `swipes` holds no text for it, as Lumiverse
   * falls back to it), and its date is `swipe_dates` at its place, a number or none.
   */
  messages(chatId: string): { messages: HostMessage[]; swipes: Map<string, SwipeFacts> } {
    const messages: HostMessage[] = [];
    const facts = new Map<string, SwipeFacts>();
    for (const r of this.reads.messages(chatId)) {
      const message = decodeMessage(
        {
          id: r.id,
          chat_id: r.chat,
          index_in_chat: r.index,
          is_user: r.isUser,
          role: r.isUser ? "user" : "assistant",
          name: r.name,
          content: r.content,
          swipe_id: r.swipe,
          swipes: r.swipes,
          ...(r.metadata ? { metadata: r.metadata } : {}),
        },
        chatId,
      );
      if (message) messages.push(message);
      facts.set(r.id, {
        hashes: r.swipes.map((s, i) => (typeof s === "string" ? textHash(s) : i === r.swipe ? textHash(r.content) : null)),
        dates: r.swipes.map((_, i) => {
          const d = r.dates[i];
          return typeof d === "number" && Number.isFinite(d) ? d : null;
        }),
        hidden: r.hidden,
      });
    }
    return { messages, swipes: facts };
  }

  /**
   * The user's messages whose metadata names the extension (`spindle_metadata.<identifier>`, or a
   * continuation chunk `<identifier>:<i>`), with that metadata whole: where today's build keeps a
   * reply's records and a user message's panel request.
   */
  engineMessages(identifier: string): { id: string; chatId: string; isUser: boolean; metadata: JsonObject }[] {
    return this.reads
      .metadataMessages(`"${identifier}`)
      .filter((m) => Object.keys(m.metadata).some((k) => k === identifier || k.startsWith(`${identifier}:`)))
      .map((m) => ({ id: m.id, chatId: m.chat, isUser: m.isUser, metadata: m.metadata }));
  }

  /**
   * What today's build put in Lumiverse for the user, counted: besides the books, entries, scripts and
   * preset blocks, the messages the panels put in the chat, each chat's pin to the engine's connection
   * (the chats today's switch marked, and the connection and model its metadata pins them to), and the
   * engine's address (`engineOrigins`, those of the runtime the run took) among the scheduler's exclusions.
   */
  marks(chats: readonly ChatRow[], identifier: string, engineOrigins: readonly string[]): LumiverseMarks {
    const engineBookIds = new Set(this.reads.books().filter((b) => b.metadata.lumi_rp_engine === true).map((b) => b.id));
    let engineEntries = 0;
    let markedEntries = 0;
    for (const e of this.reads.entryExtensions()) {
      if (engineBookIds.has(e.book)) engineEntries++;
      else if (e.extensions.lumi_rp_engine !== undefined) markedEntries++;
    }
    const chatsWithEngineBook = chats.filter((c) => Array.isArray(c.metadata.chat_world_book_ids) && c.metadata.chat_world_book_ids.some((id) => typeof id === "string" && engineBookIds.has(id))).length;
    let presetBlocks = 0;
    let outletReferences = 0;
    // A preset's blocks, in order, are its `prompt_order` (Lumiverse's `listPromptBlocks`).
    for (const blocks of this.reads.promptOrders()) {
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!isRecord(block)) continue;
        if (typeof block.name === "string" && (block.name === "RPEngine" || block.name.startsWith("RPEngine · "))) presetBlocks++;
        if (typeof block.content === "string" && block.content.includes("{{outlet::lre_")) outletReferences++;
      }
    }
    // A panel's message is a user's own message carrying the request the panel made (`spindle_metadata.<identifier>.action`).
    const panelMessages = this.engineMessages(identifier).filter((m) => m.isUser && isRecord(m.metadata[identifier]) && typeof m.metadata[identifier].action === "string").length;
    // Lumiverse's own per-chat pin (`connection_profile_id`, `connection_model`) on the chats today's switch marked (`lumiah_chat_<identifier>`).
    const pinned = chats.filter((c) => isRecord(c.metadata[`lumiah_chat_${identifier}`]) && typeof c.metadata.connection_profile_id === "string");
    // The scheduler's exclusions are the user's own setting in Lumiverse (`inferenceSchedulerConfig.excludedOrigins`).
    let schedulerExclusions: LumiverseMarks["schedulerExclusions"] = null;
    const scheduler = this.scheduler();
    if (scheduler !== null) {
      const listed = Array.isArray(scheduler.excludedOrigins) ? scheduler.excludedOrigins.filter((o): o is string => typeof o === "string") : [];
      const ours = new Set(engineOrigins.map((o) => o.toLowerCase()));
      schedulerExclusions = { listed: listed.length, engine: listed.filter((o) => ours.has(o.toLowerCase())).length };
    }
    return { engineBooks: engineBookIds.size, engineEntries, markedEntries, chatsWithEngineBook, regexScripts: this.reads.regexScripts("LumiRPEngine"), presetBlocks, outletReferences, panelMessages, chatsPinned: pinned.length, chatsPinnedToModel: pinned.filter((c) => typeof c.metadata.connection_model === "string").length, schedulerExclusions };
  }

  /** The user's inference scheduler config in Lumiverse (`inferenceSchedulerConfig`); null where they have none, or it is not JSON. */
  private scheduler(): JsonObject | null {
    try {
      const setting = this.reads.setting("inferenceSchedulerConfig");
      return setting !== null && isRecord(setting.value) ? (setting.value as JsonObject) : null;
    } catch {
      return null;
    }
  }
}
