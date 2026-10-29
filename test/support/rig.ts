// The whole backend on the fake host: runtime, dispatcher and job runner, driven over the protocol.

import type { BuildInfo } from "../../src/backend/agents";
import type { HostPort, QuietRequest } from "../../src/backend/host";
import { isRecord } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { enginePack } from "../../src/engine/engine-pack";
import { planTurn, postTurn } from "../../src/engine/turn";
import { Dispatcher } from "../../src/backend/dispatch";
import { JobRunner } from "../../src/backend/jobs";
import { toChain } from "../../src/backend/ledger-io";
import { Runtime } from "../../src/backend/runtime";
import { applyDelta } from "../../src/frontend/delta";
import { FakeHost } from "./fake-host";
import { ALL_PACKS, STARTER_INFO, STARTER_WORLDS } from "../../src/packs/index";
import { POV, testPack, testWorld, tieStubPack } from "./test-pack";

export interface RigOptions {
  /** Every shipped pack and the starter worlds (templates by starter id), instead of the test pack. */
  shipped?: boolean;
  /** The host to run on (a restart keeps the host's chats and storage). */
  host?: FakeHost;
  /** Character minds on, as Settings has them by default; the test answers their calls (`quietReply`). */
  minds?: boolean;
  /** This build and its agent kit, as the build would define them (DESIGN §23): "dev" with none unless named. */
  build?: BuildInfo;
  /** More templates by id beside the starter worlds (with `shipped`): the large world the memory measurements play. */
  templates?: Record<string, (id: string, name: string) => WorldDoc>;
  /** The port the backend talks to the host through (default: the fake host itself); the memory measurements copy what crosses it, as Spindle's IPC does. */
  port?: (host: FakeHost) => HostPort;
}

/** A helper that answers every mind plainly (no plans, no interrupt) and every other call with nothing. */
export function plainMinds(req: QuietRequest): string {
  if (!(req.messages[0]?.content ?? "").includes("You are the private mind of")) return "{}";
  return JSON.stringify({ monologue: "Nothing yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" });
}

export class Rig {
  readonly host: FakeHost;
  readonly rt: Runtime;
  readonly jobs: JobRunner;
  readonly dispatch: Dispatcher;
  private req = 0;

  constructor(private readonly options: RigOptions = {}) {
    this.host = options.host ?? new FakeHost();
    // A failed step stops the turn (DESIGN §5.1). Unless a test scripts the helper (`quietReply`),
    // it answers every call with nothing ("{}"): each step that runs falls back as when it finds
    // nothing to do. Minds stay off unless the test asks for them, since a mind that says nothing fails.
    this.host.quietReply ??= () => "{}";
    const settingsFile = `${this.host.userId}/settings.json`;
    if (!options.minds && !this.host.files.has(settingsFile)) this.host.files.set(settingsFile, JSON.stringify({ v: 1, minds: { enabled: false } }));
    const port = options.port ? options.port(this.host) : this.host;
    this.rt = options.shipped
      ? new Runtime({ host: port, packs: ALL_PACKS, pipeline: { plan: planTurn, post: postTurn }, templates: { ...STARTER_WORLDS, ...options.templates }, templateInfo: STARTER_INFO, ...(options.build ? { build: options.build } : {}) })
      : new Runtime({ host: port, packs: [enginePack, testPack, tieStubPack], pipeline: { plan: planTurn, post: postTurn }, templates: { test: () => testWorld() }, ...(options.build ? { build: options.build } : {}) });
    this.jobs = new JobRunner(port, this.rt.worlds, this.rt.steps, this.rt.settings, this.rt.registry);
    this.dispatch = new Dispatcher(this.rt, this.jobs);
    this.rt.start();
    this.dispatch.start();
    this.host.processes.onMessage((event) => this.jobs.onLane(event.payload));
    this.host.idle = async () => {
      await this.jobs.idle();
      await this.rt.ledger.idle();
      await this.rt.push.settle();
      await this.rt.presetChecked();
      await this.rt.inspector.settle();
      await this.rt.meter.settle();
      await this.rt.diag.settle();
      await this.rt.agents.settle();
      await this.rt.sweep.settle();
    };
    // The page asked to start a prepared reply claims it first, as the frontend does (DESIGN §5.1).
    this.host.claimRestart = async (restart) => {
      const reply = await this.send({ type: "lre.restart", chatId: restart.chatId, turn: restart.turn }, restart.session);
      return reply.type === "lre.result" && reply.request === "lre.restart" && reply.body.start;
    };
  }

  /**
   * A server or extension restart: the host drops this backend's handlers and in-flight
   * generations, and a new runtime, job runner and stores start over the same chats and storage.
   * `options` changes what starts, such as another build (an update).
   */
  restart(options: RigOptions = {}): Rig {
    this.host.restart();
    return new Rig({ ...this.options, ...options, host: this.host });
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
    // A Model use preset sets the minds' policy too (DESIGN §24.6): they stay off unless the rig was asked for them.
    const patch = request.type === "lre.settings.set" && isRecord(request.patch) ? request.patch : null;
    if (!this.options.minds && patch && isRecord(patch.modelUse) && typeof patch.modelUse.preset === "string" && !("minds" in patch)) {
      await this.dispatch.handle({ lre: PROTOCOL_VERSION, reqId: `r${++this.req}`, type: "lre.settings.set", patch: { minds: { enabled: false } } } as unknown as FrontendToBackend, this.host.userId, session);
    }
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

  /** The chat's view as a page holds it: the last snapshot sent, with the deltas sent after it that build on it. */
  latestView(chatId: string): Record<string, unknown> | null {
    const at = this.host.sent.findLastIndex((m) => m.type === "lre.state.snapshot" && m.chatId === chatId);
    const snapshot = this.host.sent[at];
    if (snapshot?.type !== "lre.state.snapshot") return null;
    let view: unknown = JSON.parse(JSON.stringify(snapshot.view));
    let rev = snapshot.rev;
    for (const m of this.host.sent.slice(at + 1)) {
      if (m.type !== "lre.state.delta" || m.chatId !== chatId || m.base !== rev) continue;
      view = applyDelta(view, m.ops);
      rev = m.rev;
    }
    return view as Record<string, unknown>;
  }
}
