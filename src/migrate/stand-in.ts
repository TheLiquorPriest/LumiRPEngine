// The read-only stand-in for Lumiverse that today's own readers run over during a migration
// (STANDALONE-PLAN §15.3 step 3). Today's ledger reader and the stores around it write as they read
// in a few cases: a damaged file is moved aside, a journal from another run of the chat is replaced
// by a fresh one, records are flushed back onto messages, an earlier build's files are swept. Here
// every such write lands in memory, where the readers that follow see it as they would on the host,
// and is kept in a list the report prints. Nothing reaches the disk or Lumiverse's database.
//
// What it serves: the user's storage and the extension's own (both layouts: the two may be one
// folder), with what the runtime's working copy has not sent yet laid over the user's storage; the
// user's chats and messages from Lumiverse's database, read-only. Everything else a host does (model
// calls, pages, books, presets, processes) has no place in reading today's data: a call is listed
// with the writes and refused, so a reader that ever made one would show in the report.

import { lstat, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { HostCapabilities, HostChat, HostMessage, HostPort } from "../backend/host";
import type { ChatId, MessageId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { missing, readText } from "./files";
import type { LumiverseDb, SwipeFacts } from "./lumiverse-db";

export type Store = "user storage" | "extension storage" | "Lumiverse" | "RPE's copy";

/** A write a reader tried, kept in memory instead: where, what, and the size of what it wrote. Never its content. */
export interface AttemptedWrite {
  store: Store;
  op: "write" | "move" | "remove" | "message metadata" | "chat metadata" | "append message" | "swipes" | "delete message" | "refused call";
  path: string;
  to?: string;
  bytes?: number;
}

/** A file's text as the layers below hold it: a text, a removal (null), or nothing said (undefined). */
type Layer = ReadonlyMap<string, string | null>;

/**
 * A folder of storage as the stand-in shows it: the folder on the disk, then what the runtime hasn't
 * sent yet (`pending`), then what was written in memory since. Paths are storage paths
 * (`worlds/w_1/index.json`), resolved inside the folder as Lumiverse resolves them.
 */
export class StorageView {
  private readonly written = new Map<string, string | null>();

  constructor(
    private readonly store: Store,
    /** The folder on the disk; null where there is none. */
    private readonly root: string | null,
    private readonly log: AttemptedWrite[],
    private readonly pending: Layer = new Map(),
  ) {}

  /** The file a storage path names in the folder; a path that climbs out of it is refused, as Lumiverse refuses it. */
  private file(path: string): string {
    if (this.root === null) throw new Error(`There is no folder for the ${this.store}.`);
    const base = resolve(this.root);
    const target = resolve(base, path);
    if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error("Path traversal detected");
    return target;
  }

  private static clean(path: string): string {
    return path.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  async read(path: string): Promise<string | null> {
    const key = StorageView.clean(path);
    if (this.written.has(key)) return this.written.get(key) ?? null;
    if (this.pending.has(key)) return this.pending.get(key) ?? null;
    if (this.root === null) return null;
    return readText(this.file(key));
  }

  write(path: string, data: string): void {
    const key = StorageView.clean(path);
    this.file(key);
    this.written.set(key, data);
    this.log.push({ store: this.store, op: "write", path: key, bytes: new TextEncoder().encode(data).length });
  }

  async move(from: string, to: string): Promise<void> {
    const source = StorageView.clean(from);
    const target = StorageView.clean(to);
    this.file(target);
    const text = await this.read(source);
    // Lumiverse's move fails for a source that isn't there, and so does this one.
    if (text === null) throw new Error("File not found");
    this.written.set(target, text);
    this.written.set(source, null);
    this.log.push({ store: this.store, op: "move", path: source, to: target });
  }

  remove(path: string): void {
    const key = StorageView.clean(path);
    this.file(key);
    this.written.set(key, null);
    this.log.push({ store: this.store, op: "remove", path: key });
  }

  /** Every file under the prefix folder, recursively, as full storage paths, sorted. */
  async list(prefix: string): Promise<string[]> {
    const base = StorageView.clean(prefix);
    const found = new Set<string>();
    if (this.root !== null) {
      const visit = async (dir: string, at: string): Promise<void> => {
        let names: string[];
        try {
          names = await readdir(dir);
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        for (const name of names) {
          const path = at === "" ? name : `${at}/${name}`;
          const info = await lstat(`${dir}${sep}${name}`);
          if (info.isDirectory()) await visit(`${dir}${sep}${name}`, path);
          else if (info.isFile()) found.add(path);
        }
      };
      await visit(base === "" ? resolve(this.root) : this.file(base), base);
    }
    const under = (path: string): boolean => base === "" || path.startsWith(`${base}/`);
    for (const layer of [this.pending, this.written]) {
      for (const [path, text] of layer) {
        if (!under(path)) continue;
        if (text === null) found.delete(path);
        else found.add(path);
      }
    }
    return [...found].sort();
  }
}

/** What the stand-in serves: one user, their storage, the extension's storage, and Lumiverse's database (null: storage alone, as for RPE's copy of the worlds, which holds no chats). */
export interface StandInSources {
  userId: string;
  user: StorageView;
  /** The extension's own storage: the same view as the user's where the extension is installed for one user. */
  extension: StorageView;
  db: LumiverseDb | null;
}

export class StandIn {
  readonly writes: AttemptedWrite[];
  /** The log lines today's code wrote, by level: its own words about what it found (a damaged file, a world it couldn't read). */
  readonly logged: { level: "debug" | "info" | "warn" | "error"; message: string }[] = [];
  readonly host: HostPort;
  /**
   * Each chat as read from Lumiverse's database once: its messages, with what the readers wrote kept in
   * memory, and its swipes' hashes and dates from that same read, so that a turn is tied to the swipe
   * the readers folded even where Lumiverse has changed the chat since.
   */
  private readonly chats = new Map<ChatId, { messages: HostMessage[]; swipes: ReadonlyMap<string, SwipeFacts> }>();
  /** Each chat's metadata as the database held it at the first read, with what was merged into it since; null until read. */
  private metadata: Map<ChatId, JsonObject> | null = null;
  private appended = 0;

  constructor(
    private readonly sources: StandInSources,
    writes: AttemptedWrite[],
  ) {
    this.writes = writes;
    this.host = this.makeHost();
  }

  private userCheck(userId: UserId | string): void {
    if (userId !== this.sources.userId) throw new Error("The migration's stand-in holds one user's data, and this is another user's.");
  }

  private lumiverse(call: string): LumiverseDb {
    return this.sources.db ?? this.refuse(call);
  }

  private chatRead(chatId: ChatId): { messages: HostMessage[]; swipes: ReadonlyMap<string, SwipeFacts> } {
    let read = this.chats.get(chatId);
    if (!read) {
      read = this.lumiverse("chat.messages").messages(chatId, this.sources.userId);
      this.chats.set(chatId, read);
    }
    return read;
  }

  private chatMessages(chatId: ChatId): HostMessage[] {
    return this.chatRead(chatId).messages;
  }

  /** A chat's swipes' hashes and dates, by message id, as read with the messages the readers were handed. */
  swipes(chatId: ChatId): ReadonlyMap<string, SwipeFacts> {
    return this.chatRead(chatId).swipes;
  }

  private chatMeta(chatId: ChatId): JsonObject {
    this.metadata ??= new Map(this.lumiverse("chat.metadata").chats(this.sources.userId).map((c) => [c.id as ChatId, c.metadata]));
    return this.metadata.get(chatId) ?? {};
  }

  private refuse(call: string): never {
    this.writes.push({ store: "Lumiverse", op: "refused call", path: call });
    throw new Error(`The migration reads today's data and nothing else: ${call} isn't something it does.`);
  }

  private makeHost(): HostPort {
    const { user, extension } = this.sources;
    const capabilities: HostCapabilities = { cancel: false, required: false, sessions: false };
    return {
      chats: {
        messages: async (chatId, userId) => {
          this.userCheck(userId);
          return this.chatMessages(chatId).map((m) => ({ ...m, swipes: [...m.swipes] }));
        },
        writeMetadata: async (chatId, messageId, bag, userId) => {
          this.userCheck(userId);
          const list = this.chatMessages(chatId);
          const at = list.findIndex((m) => m.id === messageId);
          if (at < 0) throw new Error(`Message ${messageId} not found`);
          list[at] = { ...(list[at] as HostMessage), metadata: bag };
          this.writes.push({ store: "Lumiverse", op: "message metadata", path: `chats/${chatId}/messages/${messageId}`, bytes: new TextEncoder().encode(JSON.stringify(bag)).length });
        },
        chatMetadata: async (chatId, userId) => {
          this.userCheck(userId);
          return { ...this.chatMeta(chatId) };
        },
        mergeChatMetadata: async (chatId, patch, userId) => {
          this.userCheck(userId);
          const merged = { ...this.chatMeta(chatId), ...patch };
          this.metadata?.set(chatId, merged);
          this.writes.push({ store: "Lumiverse", op: "chat metadata", path: `chats/${chatId}`, bytes: new TextEncoder().encode(JSON.stringify(patch)).length });
        },
        appendUserMessage: async (chatId, content, metadata, _trigger, userId) => {
          this.userCheck(userId);
          const list = this.chatMessages(chatId);
          const id = `stand-in-${++this.appended}` as MessageId;
          list.push({ id, chatId, index: list.length, isUser: true, name: "", content, swipeId: 0, swipes: [content], metadata });
          this.writes.push({ store: "Lumiverse", op: "append message", path: `chats/${chatId}`, bytes: new TextEncoder().encode(content).length });
          return id;
        },
        active: async (userId) => {
          this.userCheck(userId);
          return null;
        },
        list: async (userId): Promise<HostChat[]> => {
          this.userCheck(userId);
          return this.lumiverse("chat.list").chats(this.sources.userId).map((c) => ({ id: c.id as ChatId, name: c.name, metadata: this.chatMeta(c.id as ChatId) }));
        },
        setSwipes: async (chatId, messageId, swipes, swipeId, userId) => {
          this.userCheck(userId);
          const list = this.chatMessages(chatId);
          const at = list.findIndex((m) => m.id === messageId);
          if (at < 0) throw new Error(`Message ${messageId} not found`);
          const message = list[at] as HostMessage;
          list[at] = { ...message, swipes: [...swipes], swipeId, content: swipes[swipeId] ?? "" };
          this.writes.push({ store: "Lumiverse", op: "swipes", path: `chats/${chatId}/messages/${messageId}` });
        },
        deleteMessage: async (chatId, messageId, userId) => {
          this.userCheck(userId);
          const read = this.chatRead(chatId);
          read.messages = read.messages.filter((m) => m.id !== messageId);
          this.writes.push({ store: "Lumiverse", op: "delete message", path: `chats/${chatId}/messages/${messageId}` });
        },
      },
      storage: {
        read: async (path, userId) => {
          this.userCheck(userId);
          return user.read(path);
        },
        write: async (path, data, userId) => {
          this.userCheck(userId);
          user.write(path, data);
        },
        move: async (from, to, userId) => {
          this.userCheck(userId);
          await user.move(from, to);
        },
        remove: async (path, userId) => {
          this.userCheck(userId);
          user.remove(path);
        },
        list: async (prefix, userId) => {
          this.userCheck(userId);
          return user.list(prefix);
        },
      },
      extensionStorage: {
        read: (path) => extension.read(path),
        write: async (path, data) => extension.write(path, data),
      },
      // The migration hears no event: nothing happens in Lumiverse on its account.
      on: () => () => undefined,
      capabilities,
      registerContextHandler: () => this.refuse("registering a context handler"),
      registerWorldInfoInterceptor: () => this.refuse("registering a World Info interceptor"),
      models: {
        quiet: async () => this.refuse("a model call"),
        decide: async () => this.refuse("a model call"),
      },
      // The port's own answer when the host can't count.
      tokens: { count: async () => null },
      frontend: {
        send: () => this.refuse("a message to a page"),
        onMessage: () => () => undefined,
        closeDrawer: async () => this.refuse("closing a page's drawer"),
      },
      toast: () => this.refuse("a toast"),
      books: {
        create: async () => this.refuse("making a book"),
        exists: async () => this.refuse("reading a book"),
        list: async () => this.refuse("reading the books"),
        entries: async () => this.refuse("reading a book"),
        entry: async () => this.refuse("reading a book entry"),
        global: async () => this.refuse("reading the global books"),
        createEntry: async () => this.refuse("making a book entry"),
        place: async () => this.refuse("moving a book entry"),
        fill: async () => this.refuse("filling a book entry"),
        update: async () => this.refuse("writing a book entry"),
        deleteEntry: async () => this.refuse("deleting a book entry"),
      },
      dryRun: async () => this.refuse("a dry run"),
      presets: {
        get: async () => this.refuse("reading a preset"),
        active: async () => this.refuse("reading the active preset"),
        blocks: async () => this.refuse("reading a preset's blocks"),
        insertBlocks: async () => this.refuse("writing a preset"),
      },
      macros: { resolve: async () => this.refuse("resolving macros") },
      connections: {
        active: async () => this.refuse("reading the connections"),
        list: async () => this.refuse("reading the connections"),
        models: async () => this.refuse("reading a connection's models"),
        decisionList: async () => this.refuse("reading the connections"),
        profile: async () => this.refuse("reading a connection"),
      },
      mcp: {
        granted: () => false,
        stdioProfiles: async () => this.refuse("reading the MCP servers"),
        status: async () => this.refuse("reading an MCP server"),
      },
      regex: {
        chatScripts: async () => this.refuse("reading regex scripts"),
        globalScripts: async () => this.refuse("reading regex scripts"),
        write: async () => this.refuse("writing a regex script"),
        remove: async () => this.refuse("removing a regex script"),
      },
      processes: {
        spawn: async () => this.refuse("starting a process"),
        onMessage: () => () => undefined,
        onLifecycle: () => () => undefined,
      },
      log: (level, message) => {
        this.logged.push({ level, message });
      },
    };
  }
}
