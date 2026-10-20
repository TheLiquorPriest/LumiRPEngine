// The whole backend on the fake host: runtime, dispatcher and job runner, driven over the protocol.

import { isRecord } from "../../src/shared/json";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { enginePack } from "../../src/engine/engine-pack";
import { planTurn, postTurn } from "../../src/engine/turn";
import { Dispatcher } from "../../src/backend/dispatch";
import { JobRunner } from "../../src/backend/jobs";
import { toChain } from "../../src/backend/ledger-io";
import { Runtime } from "../../src/backend/runtime";
import { FakeHost } from "./fake-host";
import { ALL_PACKS, STARTER_INFO, STARTER_WORLDS } from "../../src/packs/index";
import { POV, testPack, testWorld, tieStubPack } from "./test-pack";

export interface RigOptions {
  /** Every shipped pack and the starter worlds (templates by starter id), instead of the test pack. */
  shipped?: boolean;
  /** The host to run on (a restart keeps the host's chats and storage). */
  host?: FakeHost;
}

export class Rig {
  readonly host: FakeHost;
  readonly rt: Runtime;
  readonly jobs: JobRunner;
  readonly dispatch: Dispatcher;
  private req = 0;

  constructor(private readonly options: RigOptions = {}) {
    this.host = options.host ?? new FakeHost();
    this.rt = options.shipped
      ? new Runtime({ host: this.host, packs: ALL_PACKS, pipeline: { plan: planTurn, post: postTurn }, templates: STARTER_WORLDS, templateInfo: STARTER_INFO })
      : new Runtime({ host: this.host, packs: [enginePack, testPack, tieStubPack], pipeline: { plan: planTurn, post: postTurn }, templates: { test: () => testWorld() } });
    this.jobs = new JobRunner(this.host, this.rt.worlds, this.rt.steps, this.rt.settings, this.rt.registry);
    this.dispatch = new Dispatcher(this.rt, this.jobs);
    this.rt.start();
    this.dispatch.start();
    this.host.processes.onMessage((event) => this.jobs.onLane(event.payload));
    this.host.idle = async () => {
      await this.jobs.idle();
      await this.rt.ledger.idle();
      await this.rt.push.settle();
      await this.rt.deliveryChecked();
      await this.rt.inspector.settle();
      await this.rt.meter.settle();
      await this.rt.diag.settle();
    };
  }

  /**
   * A server or extension restart: the host drops this backend's handlers and in-flight
   * generations, and a new runtime, job runner and stores start over the same chats and storage.
   */
  restart(): Rig {
    this.host.restart();
    return new Rig({ ...this.options, host: this.host });
  }

  async cashOf(chatId: string): Promise<unknown> {
    const core = await this.rt.ledger.core(chatId, this.host.userId);
    return core?.fold(toChain(await this.host.chats.messages(chatId, this.host.userId))).state.entities[POV]?.fields.cash;
  }

  async moodOf(chatId: string): Promise<unknown> {
    const core = await this.rt.ledger.core(chatId, this.host.userId);
    return core?.fold(toChain(await this.host.chats.messages(chatId, this.host.userId))).state.entities[POV]?.fields.mood;
  }

  /** Sends a request as the host's user, from one frontend session when `session` names it, and waits for its reply. */
  async send(request: Record<string, unknown>, session?: string): Promise<BackendToFrontend> {
    const reqId = `r${++this.req}`;
    const before = this.host.sent.length;
    await this.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, this.host.userId, session);
    await this.host.settle();
    const reply = this.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
    if (!reply) throw new Error(`no reply to ${String(request.type)}`);
    return reply;
  }

  body(reply: BackendToFrontend): Record<string, unknown> {
    if (reply.type === "lre.error") throw new Error(`${reply.code}: ${reply.message}`);
    if (reply.type !== "lre.result" || !isRecord(reply.body)) throw new Error("not a result");
    return reply.body;
  }

  async newWorld(name = "Testville", template = "test"): Promise<string> {
    const created = this.body(await this.send({ type: "lre.world", op: "create", name, template }));
    const world = created.world;
    if (!isRecord(world) || typeof world.id !== "string") throw new Error("no world");
    return world.id;
  }

  async worldChat(): Promise<string> {
    const worldId = await this.newWorld();
    const chatId = this.host.createChat("Morning, Sam.");
    this.body(await this.send({ type: "lre.world", op: "attach", worldId, chatId }));
    return chatId;
  }

  async turn(chatId: string, text: string, reply: string): Promise<void> {
    this.host.sendUser(chatId, text);
    await this.host.settle();
    const g = await this.host.start(chatId, { type: "normal" });
    await this.host.finish(g, reply);
  }

  latestView(chatId: string): Record<string, unknown> | null {
    for (let i = this.host.sent.length - 1; i >= 0; i--) {
      const m = this.host.sent[i];
      if (m?.type === "lre.state.snapshot" && m.chatId === chatId) return JSON.parse(JSON.stringify(m.view)) as Record<string, unknown>;
    }
    return null;
  }
}
