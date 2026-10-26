// Wires the fake host, the engine, test and combat packs and the real backend ledger service for tests.

import { ChatSnapshots, LedgerService, toChain } from "../../src/backend/ledger-io";
import { MessageCache } from "../../src/backend/message-cache";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import type { ChatId } from "../../src/shared/ids";
import { hasOwn, isRecord } from "../../src/shared/json";
import type { ChatRun, HeldWrite } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { UserSettings } from "../../src/shared/settings";
import type { WorldDoc } from "../../src/shared/world";
import type { ChainMessage, FoldOutput } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import type { LedgerCore, TurnModel } from "../../src/engine/ledger/journal";
import { referenceFold, type FoldTypes } from "../../src/engine/ledger/reference";
import type { EventTypeDef, PackDef } from "../../src/engine/registry";
import { enginePack } from "../../src/engine/engine-pack";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import type { QueueStop } from "../../src/engine/turn";
import combatPack from "../../src/packs/combat/core/index";
import mindsPack from "../../src/packs/minds/core/index";
import { FakeHost } from "./fake-host";
import { testModelWith, testPack, testWorlds } from "./test-pack";

/** What a test may change about the harness's chats: packs beside the engine, test and combat packs, the turn model, and the user's settings. */
export interface HarnessOptions {
  packs?: readonly PackDef[];
  model?: TurnModel;
  settings?: UserSettings;
  /** The ledger reads and writes the chats through the runtime's copy of their messages (`MessageCache`), each boot a new one, as a restarted backend has. */
  copy?: boolean;
}

/** The queued turns the harness's own model planned (Re-runs and turns planned in flight included), and how each queue that stopped early stopped. */
export type Plays = Record<"queued" | QueueStop, number>;

export interface Folds {
  reference: FoldOutput;
  optimized: FoldOutput;
  /** A cold fold (empty cache) that starts from the chat's stored snapshots (L42). */
  cold: FoldOutput;
  /** `entity:domain` of each materialization the reference fold applied over detail already recorded (L46). */
  materializedTwice: string[];
}

/** Snapshots every few messages, so short generated sequences exercise them (production: 200). */
export const HARNESS_SNAPSHOT_EVERY = 3;

export class Harness {
  readonly host = new FakeHost();
  readonly registry: Registry;
  readonly worlds: Map<string, WorldDoc>;
  readonly revisions: string[];
  service!: LedgerService;
  /** The copy the ledger reads the chats through (`HarnessOptions.copy`). */
  copy: MessageCache | null = null;
  /** Each whole read of a chat the copy made since the backend started or the chat was forgotten; a second is a read again (`Runner.check`). */
  readonly copyReads = new Map<ChatId, number>();
  private seeds = 0;
  /** Makes the next swipe or regenerate a Re-narrate (P3), as the swipe-option chip does. */
  renarrateNext = false;
  readonly plays: Plays = { queued: 0, check: 0, failure: 0, interruption: 0 };
  /** Each engine run that failed, as `step: reason` (a failed run generates nothing). */
  readonly failures: string[] = [];
  private readonly model: TurnModel;
  private readonly settings: UserSettings;
  private readonly copied: boolean;

  constructor(seedMode: WorldDoc["seedMode"] = "fresh", options: HarnessOptions = {}) {
    // Minds' events ride in the generated turns (DESIGN §24): their reducers fold in both folds.
    this.registry = createRegistry([enginePack, testPack, combatPack, mindsPack, ...(options.packs ?? [])]);
    this.model =
      options.model ??
      testModelWith((plan) => {
        if (plan.resolutions.length > 1) this.plays.queued++;
        if (plan.stopped) this.plays[plan.stopped.cause]++;
      });
    this.settings = options.settings ?? defaultSettings();
    this.copied = options.copy === true;
    this.worlds = testWorlds(seedMode, true, true);
    this.revisions = [...this.worlds.keys()];
    this.boot();
  }

  get revision(): string {
    const r = this.revisions[0];
    if (!r) throw new Error("no world revision");
    return r;
  }

  private boot(): void {
    this.copy = this.copied ? new MessageCache(this.host) : null;
    this.copyReads.clear();
    if (this.copy) this.copy.onRead = (chatId) => this.copyReads.set(chatId, (this.copyReads.get(chatId) ?? 0) + 1);
    const copy = this.copy;
    this.service = new LedgerService(
      copy ? copy.host : this.host,
      async (chatId) => {
        const meta = await this.host.chats.chatMetadata(chatId, this.host.userId);
        const raw = meta[LEDGER_NAMESPACE];
        if (!isRecord(raw) || typeof raw.revision !== "string" || typeof raw.runSeed !== "string" || typeof raw.worldId !== "string") return null;
        const run: ChatRun = { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: 0 };
        const world = this.worlds.get(run.revision);
        if (!world) return null;
        return {
          types: this.registry,
          worlds: (r) => this.worlds.get(r),
          run,
          model: this.model,
          // As a new chat starts in play: the world's own realism and time defaults, the user's
          // settings filling in, through the code production uses (half-minute ticks included).
          startMarkers: () => startMarkersFrom(this.settings, world, run.revision),
          newSeed: () => `seed-${++this.seeds}`,
        };
      },
      new LedgerFold(this.registry, { snapshotEvery: HARNESS_SNAPSHOT_EVERY }),
      (chatId) => {
        copy?.forget(chatId);
        this.copyReads.delete(chatId);
      },
    );
    const noop = async (): Promise<void> => undefined;
    this.service.hooks = {
      beforePlan: async () => undefined,
      afterPlan: async () => undefined,
      // No sections here: the engine run plans, and its reply starts again (DESIGN §5.1).
      deliver: async () => ({ bookId: "", fills: new Map(), placed: "", sources: [] }),
      fill: async () => "filled" as const,
      clear: noop,
      vacate: noop,
      adopted: noop,
      failed: async ({ step, reason }) => {
        this.failures.push(`${step}: ${reason}`);
      },
      worldOf: async (chatId) => {
        const raw = (await this.host.chats.chatMetadata(chatId, this.host.userId))[LEDGER_NAMESPACE];
        return isRecord(raw) && typeof raw.worldId === "string" ? raw.worldId : null;
      },
      inputs: () => ({ revision: "", settings: "", preset: "", presetWrites: "", notes: "" }),
      beforeCommit: noop,
      afterCommit: noop,
      changed: () => undefined,
      kindOf: async ({ kind }) => {
        const renarrate = this.renarrateNext && (kind === "swipe" || kind === "regenerate");
        if (renarrate) this.renarrateNext = false;
        return renarrate ? "renarrate" : kind;
      },
    };
    this.service.attach();
    this.host.idle = () => this.service.idle();
    this.host.claimRestart = async (restart) => this.service.claimRestart(restart.chatId, this.host.userId, restart.session, restart.turn);
  }

  async newChat(greeting = "Morning, Sam."): Promise<ChatId> {
    const chatId = this.host.createChat(greeting);
    await this.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: { v: 1, worldId: "world-test", revision: this.revision, runSeed: `run-${chatId}`, startedAt: 0 } }, this.host.userId);
    await this.service.open(chatId, this.host.userId);
    return chatId;
  }

  async send(chatId: ChatId, text: string, reply = "Okay."): Promise<void> {
    this.host.sendUser(chatId, text);
    await this.host.settle();
    const g = await this.host.start(chatId, { type: "normal" });
    await this.host.finish(g, reply);
  }

  async write(chatId: ChatId, w: HeldWrite): Promise<{ applied: boolean; pending: boolean; reason?: string }> {
    const result = await this.service.write(chatId, this.host.userId, w);
    await this.host.settle();
    return result;
  }

  async core(chatId: ChatId): Promise<LedgerCore> {
    const core = await this.service.core(chatId, this.host.userId);
    if (!core) throw new Error(`${chatId} is not a world chat`);
    return core;
  }

  /** Both folds of the chat as it stands (journal overlaid on metadata), optionally of its first `limit` messages. */
  async folds(chatId: ChatId, limit?: number): Promise<Folds> {
    const core = await this.core(chatId);
    const all = toChain(await this.host.chats.messages(chatId, this.host.userId));
    const observed = limit === undefined ? all : all.slice(0, limit);
    const input = { worlds: (r: string) => this.worlds.get(r), revision: this.revision, chain: core.chain(observed), pauses: core.journal.pauses, tombstones: core.journal.tombstones };
    const optimized = core.fold(observed);
    const snapshots = this.service.snapshotsOf(chatId);
    const cold = new LedgerFold(this.registry, { snapshotEvery: HARNESS_SNAPSHOT_EVERY }).fold({ ...input, ...(snapshots ? { snapshots: new ChatSnapshots(snapshots.toJSON()) } : {}) });
    // The reference fold re-folds from scratch, so it sees every materialization a path applies: the
    // watch notes one that lands on detail already recorded, and changes nothing.
    const materializedTwice: string[] = [];
    const materialize = this.registry.get("materialize");
    const watched: EventTypeDef | undefined = materialize && {
      ...materialize,
      apply: (e, state, ctx) => {
        if (e.type === "materialize" && hasOwn(state.materialized, `${e.entity}:${e.domain}`)) materializedTwice.push(`${e.entity}:${e.domain}`);
        materialize.apply(e, state, ctx);
      },
    };
    const types: FoldTypes = { relations: this.registry.relations, context: this.registry.context, get: (type) => (type === "materialize" ? watched : this.registry.get(type)) };
    return { reference: referenceFold(input, types), optimized, cold, materializedTwice };
  }

  /** The chain as the folds see it (journal overlaid on metadata). */
  async chain(chatId: ChatId): Promise<ChainMessage[]> {
    const core = await this.core(chatId);
    return core.chain(toChain(await this.host.chats.messages(chatId, this.host.userId)));
  }

  /** Host restart: generations vanish, the backend restarts and reopens every world chat. */
  async restart(): Promise<void> {
    this.host.restart();
    this.service.detach();
    this.boot();
    for (const chatId of this.host.chatsById.keys()) await this.service.open(chatId, this.host.userId);
    await this.host.settle();
  }
}
