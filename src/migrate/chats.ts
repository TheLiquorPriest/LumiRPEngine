// Each chat read by today's own readers, over the read-only stand-in: the chat's run from its
// metadata (`readRun`), its journal and ledgers through today's ledger service (which sets a damaged
// journal aside, replaces one from another run of the chat, stamps an earlier build's and flushes
// records back onto messages, each of which lands in the stand-in's memory), its staged action and
// its stored chips through today's stores. What comes back is counted, never copied.
//
// A turn under way while a chat is read leaves what it had written so far: its pending entry and its
// open window in the journal, a reply Lumiverse may already have saved without its record yet, and
// a temporary file mid-write. None of that is a turn yet. It is counted as under way, the record it
// would make isn't, and the next run of the migration reads it as it stands then.

import { agentMetaOf } from "./today/chat-agent-meta";
import { chatKnowledgePrefsOf } from "./today/chat-knowledge-prefs";
import { ChipStore } from "./today/chips";
import type { HostPort } from "../shared/host";
import { decodeJournal, journalPath, LedgerService, toChain, type EnvResolver } from "./today/ledger-io";
import { readRun } from "./today/run";
import { SettingsStore } from "./today/settings-store";
import { StagedActions } from "./today/staged";
import { startMarkersFrom } from "./today/start-markers";
import { WorldStore } from "../worlds/worlds";
import { resolveFix } from "../engine/edits";
import type { ChainMessage, FoldInput } from "../engine/ledger/chain";
import { LedgerFold } from "../engine/ledger/fold";
import { createRegistry } from "../engine/registry-impl";
import { ALL_PACKS, STARTER_TABLES } from "../packs/index";
import type { ChatId, RevisionId, UserId } from "../shared/ids";
import type { ChatRun, Journal, MessageLedger } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import type { UserSettings } from "../shared/settings";
import type { Unreadable } from "./inside";

/** The engine a chat is played with today, as its own choice holds it (absent: classic). */
export type ChatEngine = "classic" | "agents" | "harness";

/** How today's ledger reader found a chat's journal. */
export type JournalRead = "read" | "none" | "unreadable" | "malformed" | "from another run of this chat" | "not opened";

export interface ChatRead {
  chatId: string;
  /** Null for a chat that plays no world. */
  engine: ChatEngine | null;
  worldId: string | null;
  messages: number;
  replies: number;
  /** The chain's ledgers as today's reader holds them (the journal's over the messages'), one per message. */
  ledgers: (MessageLedger | null)[];
  journal: JournalRead;
  /** Why today's reader didn't open the chat, where it didn't. */
  notOpened: string | null;
  /** Records the journal keeps of turns that were deleted (tombstones). */
  deletedTurns: number;
  /** Turns started and not finished when the chat was read: their pending entries and open windows. */
  underWay: number;
  waiting: { questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean };
  unreadable: Unreadable[];
}

/** Why a chat's ledger can't be opened: the reason today's resolver gave, kept for the report. */
class NotOpened {
  constructor(readonly why: string) {}
}

/**
 * Today's readers of chats, over a stand-in host: the ledger service as the runtime builds it
 * (`Runtime.resolveEnv`, `runtime.ts:1141-1198`), without anything that plays a turn.
 */
export class ChatReader {
  private readonly registry = createRegistry(ALL_PACKS);
  private readonly worlds: WorldStore;
  private readonly settings: SettingsStore;
  private readonly ledger: LedgerService;
  private readonly staged: StagedActions;
  private readonly chips: ChipStore;
  private readonly why = new Map<ChatId, NotOpened>();

  constructor(private readonly host: HostPort) {
    this.worlds = new WorldStore(host, this.registry, STARTER_TABLES);
    this.settings = new SettingsStore(host);
    // Snapshots are a shortcut a fold may take; this fold's own fingerprint keeps today's stored ones from applying, so nothing is read from them.
    const fold = new LedgerFold(this.registry, { fingerprint: "migration" });
    this.ledger = new LedgerService(host, this.resolveEnv, () => fold);
    this.staged = new StagedActions(host);
    this.chips = new ChipStore(host);
  }

  /** The chat's ledger environment as today's runtime resolves it, or null for a chat that plays no world (or whose world can't be read: why is kept). */
  private readonly resolveEnv: EnvResolver = async (chatId, userId) => {
    const run = readRun(await this.host.chats.chatMetadata(chatId, userId));
    if (!run) return null;
    let world: WorldDoc;
    try {
      world = (await this.worlds.get(run.worldId, userId, run.revision)).world;
    } catch {
      // A fixed reason: the reader's own words can quote the file's text, and the report holds no content.
      this.why.set(chatId, new NotOpened(`its world ${run.worldId} at revision ${run.revision} can't be read by today's world store`));
      return null;
    }
    const pinned = new Map<RevisionId, WorldDoc>([[run.revision, world]]);
    const missingRevisions = new Set<RevisionId>();
    const settings = await this.settings.get(userId);
    return {
      types: this.registry,
      worlds: (revision) => pinned.get(revision) ?? this.worlds.cached(userId, run.worldId, revision),
      pin: async (revisions) => {
        const wanted = [...revisions].filter((rev) => !pinned.has(rev) && !missingRevisions.has(rev));
        if (wanted.length === 0) return;
        const found = await this.worlds.getMany(run.worldId, userId, wanted);
        for (const rev of wanted) {
          const doc = found.get(rev);
          if (doc) pinned.set(rev, doc);
          else missingRevisions.add(rev);
        }
      },
      run,
      // Reading a chat plans and reads no turn: the core asks its model only inside a turn.
      model: {
        plan: () => {
          throw new Error("The migration plays no turn.");
        },
        read: () => {
          throw new Error("The migration plays no turn.");
        },
      },
      startMarkers: () => startMarkersFrom(settings, world, run.revision),
      newSeed: () => crypto.randomUUID(),
      resolveFix: (doc, state, entry) => resolveFix(this.registry, doc, state, entry, run.runSeed),
    };
  };

  async read(chatId: ChatId, userId: UserId): Promise<ChatRead> {
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const run = readRun(meta);
    const messages = await this.host.chats.messages(chatId, userId);
    const unreadable: Unreadable[] = [];
    const observed = toChain(messages, (messageId, swipe) => unreadable.push({ path: `chats/${chatId}/messages/${messageId}`, why: `the engine record of swipe ${swipe} is damaged; today's build ignores it` }));
    let journal: Journal | null = null;
    let chain: ChainMessage[] = observed;
    let state: JournalRead = "none";
    let notOpened: string | null = null;
    if (run) {
      // How the journal stood before today's reader opened it: what the reader does with it follows.
      const stored = await this.host.storage.read(journalPath(chatId), userId);
      const before = decodeJournal(stored, chatId, run);
      state = stored === null ? "none" : ((before.reset as JournalRead | null) ?? "read");
      const failed = this.ledger.errors.length;
      await this.ledger.with(chatId, userId, async (core, seen) => {
        journal = structuredClone(core.journal);
        chain = core.chain(seen);
      });
      // The service logs what fails on a chat's queue rather than throwing it: each failure is one this read met. Its words are left out: they can quote the chat.
      for (let i = failed; i < this.ledger.errors.length; i++) unreadable.push({ path: `chats/${chatId}`, why: "today's ledger reader failed on this chat" });
      if (journal === null) {
        state = "not opened";
        notOpened = this.why.get(chatId)?.why ?? "today's reader didn't open it";
        unreadable.push({ path: `chats/${chatId}`, why: notOpened });
        journal = before.journal;
      }
    }
    const opened = journal as Journal | null;
    const prefs = chatKnowledgePrefsOf(meta);
    const chips = run ? await this.chips.list(chatId, userId) : [];
    const pending = new Set([...Object.keys(opened?.pending ?? {}), ...(opened?.windows ?? []), ...(opened?.prereply ?? [])]);
    return {
      chatId,
      engine: run ? (prefs.engine ?? "classic") : null,
      worldId: run?.worldId ?? null,
      messages: messages.length,
      replies: messages.filter((m) => !m.isUser).length,
      ledgers: chain.map((m) => m.ledger),
      journal: state,
      notOpened,
      deletedTurns: opened?.tombstones.length ?? 0,
      underWay: pending.size,
      waiting: {
        questions: opened?.pauses.length ?? 0,
        staged: run && (await this.staged.get(chatId, userId)) ? 1 : 0,
        chips: chips.length,
        reviewCards: chips.filter((c) => c.kind === "review").length,
        rollback: agentMetaOf(meta).rollback !== null,
      },
      unreadable,
    };
  }

  /**
   * The chat as today's fold reads it (`LedgerCore.foldInput`): its messages with the journal's records
   * over theirs, the journal's pauses and tombstones, its world revisions (each one its records, markers
   * and run name, pinned), and how to work a GM edit or ✎ fix out again. Null for a chat that plays no
   * world, or that today's reader can't open.
   */
  async today(chatId: ChatId, userId: UserId): Promise<{ input: FoldInput; revisions: Set<RevisionId>; run: ChatRun } | null> {
    const run = readRun(await this.host.chats.chatMetadata(chatId, userId));
    if (!run) return null;
    let found: { input: FoldInput; revisions: Set<RevisionId> } | null = null;
    await this.ledger.with(chatId, userId, async (core, seen) => {
      // A copy: the importer's folds read it after the reader is done with the chat.
      const input = core.foldInput(seen);
      found = { input: { ...input, chain: structuredClone(input.chain), pauses: structuredClone(input.pauses), tombstones: structuredClone(input.tombstones) }, revisions: core.revisionsIn(seen) };
    });
    const opened = found as { input: FoldInput; revisions: Set<RevisionId> } | null;
    return opened === null ? null : { ...opened, run };
  }

  /** Today's settings reader over the stand-in: the user's settings as today's build reads them. */
  userSettings(userId: UserId): Promise<UserSettings> {
    return this.settings.get(userId);
  }

  /** Today's world store over the stand-in. */
  get worldStore(): WorldStore {
    return this.worlds;
  }
}
