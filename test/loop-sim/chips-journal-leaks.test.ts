// Leak test over the whole backend view: a turn whose rule advances a secret track, moves a
// `known_by` stranger and a public stranger the POV never met, and changes someone the POV knows.
// The chips and the Journal (not just panels and renderers) must name only the last, in words:
// no secret stage, truth or label, no unmet name, no raw ids. The same for
// extraction, when the narration's unnamed figure is read as an unmet NPC.
import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import type { PackDef } from "../../src/engine/registry";
import { enginePack } from "../../src/engine/engine-pack";
import { planTurn, postTurn } from "../../src/engine/turn";
import { Dispatcher } from "../../src/backend/dispatch";
import { JobRunner } from "../../src/backend/jobs";
import { Runtime } from "../../src/backend/runtime";
import { FakeHost } from "../support/fake-host";
import { testPack, testWorld } from "../support/test-pack";

const TRUTH = "Dev skims the till every Friday";
/** The extract step's prompt carries this; other quiet calls (interpret) don't. */
const EXTRACT_MARK = "propose concrete state changes";

function leakWorld(): WorldDoc {
  const world = testWorld();
  world.packs = {};
  world.pov = "p1";
  world.kinds = { person: { id: "person", label: "Person", fields: { mood: { type: "text", label: "Mood" } } } };
  world.places = {
    home: { id: "home", name: "Home", fields: {} },
    docks: { id: "docks", name: "The Docks", fields: {} },
    market: { id: "market", name: "Fish Market", fields: {} },
  };
  world.entities = {
    p1: { id: "p1", kind: "person", name: "Sam Ortiz", tier: "pov", fields: { place: "home", mood: "fine" }, relations: [{ type: "knows", to: "dev_rao" }] },
    dev_rao: { id: "dev_rao", kind: "person", name: "Dev Rao", tier: "principal", fields: { place: "home", mood: "fine" }, relations: [] },
    mara_quell: { id: "mara_quell", kind: "person", name: "Mara Quell", tier: "supporting", fields: { place: "docks" }, relations: [], visibility: "known_by" },
    old_tobin: { id: "old_tobin", kind: "person", name: "Old Tobin", tier: "background", fields: { place: "docks" }, relations: [] },
  };
  world.tracks = {
    skim: {
      id: "skim",
      kind: "secret",
      label: "The skimming",
      start: "quiet",
      visibility: "secret",
      stages: { quiet: { label: "All quiet", next: [] }, moving: { label: "Money moving", truth: TRUTH, next: [] } },
    },
  };
  world.rules = {
    offscreen: {
      id: "offscreen",
      on: { event: "clock" },
      once: true,
      do: [
        { type: "stage", args: { track: "skim", to: "moving" } },
        { type: "move", args: { entity: "mara_quell", to: "market" } },
        { type: "set", args: { entity: "old_tobin", field: "place", value: "market" } },
        { type: "set", args: { entity: "dev_rao", field: "mood", value: "cheerful" } },
      ],
    },
  };
  world.start = { place: "home", at: "2026-10-16T07:00" };
  return world;
}

class LeakRig {
  readonly host = new FakeHost();
  readonly rt: Runtime;
  readonly jobs: JobRunner;
  readonly dispatch: Dispatcher;
  private req = 0;

  constructor(packs: PackDef[] = [enginePack], template: () => WorldDoc = leakWorld) {
    // As the main rig (test/support/rig.ts): a failed step stops the turn, so the helper answers with
    // nothing unless a test scripts it, and minds, which fail on nothing, stay off.
    this.host.quietReply = () => "{}";
    this.host.files.set(`${this.host.userId}/settings.json`, JSON.stringify({ v: 1, minds: { enabled: false } }));
    this.rt = new Runtime({ host: this.host, packs, pipeline: { plan: planTurn, post: postTurn }, templates: { leak: template } });
    this.jobs = new JobRunner(this.host, this.rt.worlds, this.rt.steps, this.rt.settings, this.rt.registry);
    this.dispatch = new Dispatcher(this.rt, this.jobs);
    this.rt.start();
    this.dispatch.start();
    this.host.processes.onMessage((event) => this.jobs.onLane(event.payload));
    this.host.idle = async () => {
      await this.jobs.idle();
      await this.rt.ledger.idle();
      await this.rt.push.settle();
    };
  }

  async send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const reqId = `r${++this.req}`;
    const before = this.host.sent.length;
    await this.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, this.host.userId);
    await this.host.settle();
    const reply: BackendToFrontend | undefined = this.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
    if (!reply || reply.type !== "lre.result" || !isRecord(reply.body)) throw new Error(`no result for ${String(request.type)}`);
    return reply.body;
  }

  async chat(): Promise<string> {
    const created = await this.send({ type: "lre.world", op: "create", name: "Leakville", template: "leak" });
    const world = created.world;
    if (!isRecord(world) || typeof world.id !== "string") throw new Error("no world");
    const chatId = this.host.createChat("Morning.");
    await this.send({ type: "lre.world", op: "attach", worldId: world.id, chatId });
    return chatId;
  }

  async turn(chatId: string, text: string, reply: string): Promise<void> {
    this.host.sendUser(chatId, text);
    await this.host.settle();
    const g = await this.host.start(chatId, { type: "normal" });
    await this.host.finish(g, reply);
  }
}

/** Chip labels and details plus Journal lines: the text the player sees after a turn. */
function playerTexts(view: { chips: { label: string; detail?: string }[]; journal: { text: string }[] }): string[] {
  return [...view.chips.flatMap((c) => [c.label, c.detail ?? ""]), ...view.journal.map((n) => n.text)].filter((t) => t !== "");
}

function leaksIn(texts: readonly string[], forbidden: readonly string[]): string[] {
  return texts.flatMap((t) => forbidden.filter((f) => new RegExp(`(^|[^\\w])${f}([^\\w]|$)`, "i").test(t)).map((f) => `${f} in "${t}"`));
}

/** No off-screen rule; Old Tobin (public, background, never met) stays at the docks while the POV is home. */
function figureWorld(): WorldDoc {
  const world = leakWorld();
  world.rules = {};
  return world;
}

describe("chips and Journal leak test", () => {
  test("an off-screen secret stage and unmet NPC moves never reach a chip or the Journal; a known NPC's change does, by name", async () => {
    const rig = new LeakRig();
    const chatId = await rig.chat();
    await rig.turn(chatId, "I look out of the window.", "The street is quiet.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    const texts = playerTexts(view);
    const forbidden = [TRUTH, "The skimming", "Money moving", "skim", "moving", "Mara Quell", "mara_quell", "Old Tobin", "old_tobin", "Fish Market", "market", "dev_rao", "p1"];
    expect(leaksIn(texts, forbidden)).toEqual([]);
    // Not vacuous: the turn's record holds the secret stage and both unmet moves, and the change the
    // POV can know about is shown by name.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    const events = head ? (core?.journal.messages[head.id]?.ledger.swipes["0"]?.events ?? []) : [];
    expect(events.some((e) => e.type === "stage" && e.track === "skim")).toBe(true);
    expect(events.some((e) => e.type === "set" && e.entity === "mara_quell" && e.field === "place")).toBe(true);
    expect(events.some((e) => e.type === "set" && e.entity === "old_tobin" && e.field === "place")).toBe(true);
    expect(texts.some((t) => t.includes("Dev Rao"))).toBe(true);
  });

  test("extraction never turns a narrated unnamed figure into a chip naming an unmet NPC", async () => {
    const rig = new LeakRig([enginePack, testPack], figureWorld);
    // The extractor reads "a figure in a grey coat" as Old Tobin: a knows (confirm) and a regard
    // (automatic) proposal name him. Dev Rao, whom the POV knows, waves: his regard is the control.
    rig.host.quietReply = (req) =>
      req.messages[0]?.content.includes(EXTRACT_MARK)
        ? JSON.stringify({
            proposals: [
              { type: "knows", fact: "old_tobin" },
              { type: "regard", from: "old_tobin", to: "p1", axis: "trust", delta: 1 },
              { type: "regard", from: "dev_rao", to: "p1", axis: "trust", delta: 1 },
            ],
          })
        : "{}";
    const chatId = await rig.chat();
    await rig.turn(chatId, "I look out of the window.", "A figure in a grey coat lingers at the gate, face turned away, and nods once before walking on. Dev waves from the kitchen.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(leaksIn(playerTexts(view), ["Old Tobin", "Tobin", "old_tobin"])).toEqual([]);
    // The model never saw him either: neither the extract nor the interpret prompt lists him.
    const prompts = rig.host.quietCalls.map((c) => c.messages.map((m) => m.content).join("\n"));
    expect(prompts.some((p) => p.includes(EXTRACT_MARK))).toBe(true);
    expect(leaksIn(prompts, ["Old Tobin", "old_tobin"])).toEqual([]);
    // Not vacuous: the read got both proposals naming him and dropped them; extraction still made
    // chips, and the known NPC's change is one, by name.
    expect(rig.host.logs.some((l) => l.includes("dropped 2 proposal(s) naming what the player hasn't seen"))).toBe(true);
    expect(view.chips.some((c) => c.label.includes("Dev Rao"))).toBe(true);
  });
});
