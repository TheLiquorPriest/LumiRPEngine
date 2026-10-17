// Wires the fake host, the test pack and the real backend ledger service for tests.

import { ChatSnapshots, LedgerService, toChain } from "../../src/backend/ledger-io";
import type { ChatId } from "../../src/shared/ids";
import { isRecord } from "../../src/shared/json";
import type { ChatRun, HeldWrite } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import type { ChainMessage, FoldOutput } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import type { LedgerCore } from "../../src/engine/ledger/journal";
import { referenceFold } from "../../src/engine/ledger/reference";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { FakeHost } from "./fake-host";
import { startMarkers, testModel, testPack, testWorlds } from "./test-pack";

export interface Folds {
  reference: FoldOutput;
  optimized: FoldOutput;
  /** A cold fold (empty cache) that starts from the chat's stored snapshots (L42). */
  cold: FoldOutput;
}

/** Snapshots every few messages, so short generated sequences exercise them (production: 200). */
export const HARNESS_SNAPSHOT_EVERY = 3;

export class Harness {
  readonly host = new FakeHost();
  readonly registry: Registry = createRegistry([testPack]);
  readonly worlds: Map<string, WorldDoc>;
  readonly revisions: string[];
  service!: LedgerService;
  private seeds = 0;
  /** Makes the next swipe or regenerate a Re-narrate (P3), as the swipe-option chip does. */
  renarrateNext = false;

  constructor(seedMode: WorldDoc["seedMode"] = "fresh") {
    this.worlds = testWorlds(seedMode);
    this.revisions = [...this.worlds.keys()];
    this.boot();
  }

  get revision(): string {
    const r = this.revisions[0];
    if (!r) throw new Error("no world revision");
    return r;
  }

  private boot(): void {
    this.service = new LedgerService(
      this.host,
      async (chatId) => {
        const meta = await this.host.chats.chatMetadata(chatId, this.host.userId);
        const raw = meta[LEDGER_NAMESPACE];
        if (!isRecord(raw) || typeof raw.revision !== "string" || typeof raw.runSeed !== "string" || typeof raw.worldId !== "string") return null;
        const run: ChatRun = { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: 0 };
        return {
          types: this.registry,
          worlds: (r) => this.worlds.get(r),
          run,
          model: testModel,
          startMarkers: () => startMarkers(run.revision),
          newSeed: () => `seed-${++this.seeds}`,
        };
      },
      new LedgerFold(this.registry, { snapshotEvery: HARNESS_SNAPSHOT_EVERY }),
    );
    const noop = async (): Promise<void> => undefined;
    this.service.hooks = {
      beforePlan: noop,
      afterPlan: noop,
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
    return { reference: referenceFold(input, this.registry), optimized, cold };
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
