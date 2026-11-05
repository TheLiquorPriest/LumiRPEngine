// The Curator's quiet-turn gate (`pipeline.curatorGate`, `agents/curator-gate.ts`) on Port Alder, and
// the calls at once a connection with no limit of its own takes (`agents.callsAtOnce`). The gate
// reads the reply and the player's message with no call of its own: a thing in the scene named by a
// head noun, or a purchase in the words, gives the Curator work; anything else is a quiet turn. In
// shadow, the default, the Curator runs as ever and Diagnostics only records what the gate would
// have decided; On, a quiet turn skips it, and the read's changes held for it land in its place. A
// connection whose throttle sets no calls at once takes the global limit.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { AgentAccounts } from "../../src/backend/agents/provider";
import { curatorGate, gateWords } from "../../src/backend/agents/curator-gate";
import type { WorldState } from "../../src/engine/state";
import { ROLE_LABEL } from "../../src/shared/agent-roles";
import type { CuratorGate } from "../../src/shared/agent-pipeline";
import { agentSettingsOf, defaultAgentSettings } from "../../src/shared/agent-settings";
import type { JsonObject } from "../../src/shared/json";
import { FakeHost } from "../support/fake-host";
import { alderChat, DANNY, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const PHONE = "pov_phone";
/** The read's answer on every turn: a handover, a change of the Curator's kinds it holds aside for it. */
const HANDOVER: JsonObject = { type: "give", item: PHONE, from: "pov", to: DANNY, basis: "hold", why: "Jordan hands Danny his phone" };

/** A quiet turn: the words name nothing the Curator keeps. */
const QUIET = { said: "I wait with Danny.", reply: "Danny nods and looks out at the rain." };
/** A thing in the scene, by its head noun. */
const THING = { said: "I wait with Danny.", reply: "Danny nods at your phone and looks out at the rain." };
/** A purchase verb, with no thing of the scene in the words. */
const PURCHASE = { said: "I wait with Danny.", reply: "Danny says he already paid for the parking." };

const SHADOW_QUIET = "in shadow, the quiet-turn gate would have skipped it: the words name nothing it keeps";
const SKIPPED = "a quiet turn: the words name nothing it keeps, so the read's own changes of its kinds land instead (Settings → Agents → Roles → Curator → When it runs)";

/** The role whose agent made a call, as its system prompt names it; null for a classic call. */
const roleOf = (req: QuietRequest): string | null => /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;

/** Each role agent's answer in its contract, with nothing in it; the read gives the handover. */
function answerOf(role: string | null, req: QuietRequest): string {
  const all = req.messages.map((m) => m.content).join("\n");
  if (role === "read") return JSON.stringify({ proposals: [HANDOVER], where: null });
  if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
  if (role === "curator") return JSON.stringify({ proposals: [] });
  if (role === "knowledge") return JSON.stringify({ facts: [], learned: [], inferred: [], doubted: [] });
  if (role === "minds") return JSON.stringify({ monologue: "Nothing yet.", depiction: "looks up", intent: "Wait.", reactions: [], mood: "calm" });
  if (role === "memory") return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [] });
  if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [], where: null });
  return "{}";
}

interface Played {
  /** The Curator's agent's calls. */
  curator: number;
  /** The Curator's Diagnostics steps on the turn: status and reason. */
  steps: { status: string; reason: string }[];
  /** The log's lines. */
  logs: readonly string[];
  state: WorldState;
}

/** Port Alder on agents with the gate at `gate`, one turn played: the player says `said`, the reply is `reply`. */
async function played(gate: CuratorGate, turn: { said: string; reply: string }): Promise<Played> {
  const rig = new Rig({ shipped: true, minds: true });
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { curatorGate: gate } } } }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  let curator = 0;
  rig.host.quietReply = (req) => {
    const role = roleOf(req);
    if (role === "curator") curator++;
    return answerOf(role, req);
  };
  rig.host.sendUser(chatId, turn.said);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  await rig.host.finish(g, turn.reply);
  expect(rig.rt.ledger.errors).toEqual([]);
  const records = await rig.rt.diag.records(chatId, rig.host.userId);
  const steps = records.filter((r) => r.kind === "step" && r.step === ROLE_LABEL.curator).map((r) => ({ status: String(r.status), reason: r.reason ?? "" }));
  return { curator, steps, logs: rig.host.logs, state: (await stateOf(rig, chatId)).state };
}

/** Who holds a thing. */
const holderOf = (state: WorldState, thing: string): string | null => state.entities[thing]?.relations.find((r) => r.type === "in")?.to ?? null;

describe("the gate's read of the words", () => {
  test("a thing in the scene by its head noun or a purchase verb gives the Curator work; a quiet turn none; a Buy always", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const { world, state } = await stateOf(rig, chatId);
    const words = gateWords(rig.rt.registry, world, state);
    expect(curatorGate({ ...words, ...THING, buy: false })).toEqual({ run: true, why: ['the words name something in the scene ("phone")'] });
    expect(curatorGate({ ...words, ...PURCHASE, buy: false })).toEqual({ run: true, why: ['the words tell of a purchase ("paid")'] });
    expect(curatorGate({ ...words, ...QUIET, buy: false })).toEqual({ run: false, why: [] });
    expect(curatorGate({ ...words, ...QUIET, buy: true })).toEqual({ run: true, why: ["the turn's own action is a Buy"] });
  });
});

describe("the quiet-turn gate in a turn", () => {
  test("shadow, the default, only records: the Curator runs on a quiet turn and a busy one alike, and Diagnostics says what the gate would have decided", async () => {
    expect(defaultAgentSettings().pipeline.curatorGate).toBe("shadow");
    const quiet = await played("shadow", QUIET);
    expect(quiet.curator).toBeGreaterThan(0);
    expect(quiet.steps).toContainEqual({ status: "ok", reason: SHADOW_QUIET });
    expect(quiet.steps.some((s) => s.status === "skipped")).toBe(false);
    expect(quiet.logs.some((l) => l.includes(`the Curator ran; ${SHADOW_QUIET}`))).toBe(true);
    // Its work whole, the read's handover held for it doesn't land: as with no gate at all.
    expect(holderOf(quiet.state, PHONE)).toBe("pov");
    expect(quiet.logs.some((l) => l.includes("the Curator's work is whole, so none of the 1 change(s) the read held for it lands"))).toBe(true);
    const busy = await played("shadow", THING);
    expect(busy.curator).toBeGreaterThan(0);
    expect(busy.steps).toContainEqual({ status: "ok", reason: 'in shadow, the quiet-turn gate would run it: the words name something in the scene ("phone")' });
    expect(busy.steps.some((s) => s.status === "skipped")).toBe(false);
  });

  test("On, a thing word or a purchase verb runs the Curator, and the log says why", async () => {
    for (const [turn, why] of [
      [THING, 'the words name something in the scene ("phone")'],
      [PURCHASE, 'the words tell of a purchase ("paid")'],
    ] as const) {
      const run = await played("on", turn);
      expect(run.curator).toBeGreaterThan(0);
      expect(run.steps.some((s) => s.status === "skipped" || s.reason.includes("quiet-turn gate"))).toBe(false);
      expect(run.logs.some((l) => l.includes(`the quiet-turn gate runs the Curator: ${why}`))).toBe(true);
    }
  });

  test("On skips a quiet turn's Curator: no call, a skipped step in Diagnostics, and the read's held handover lands in its place", async () => {
    const quiet = await played("on", QUIET);
    expect(quiet.curator).toBe(0);
    expect(quiet.steps).toContainEqual({ status: "skipped", reason: SKIPPED });
    expect(quiet.logs.some((l) => l.includes(`the Curator was skipped, ${SKIPPED}`))).toBe(true);
    expect(holderOf(quiet.state, PHONE)).toBe(DANNY);
    expect(quiet.logs.some((l) => l.startsWith("warn:") && l.includes("the Curator's work isn't whole (the quiet-turn gate skipped it): 1 of the 1 change(s) the read held for it land"))).toBe(true);
  });
});

/** Yields the event loop `turns` times: what a release wakes has run by then. */
async function flush(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
}

describe("calls at once with no limit of the connection's own", () => {
  const MAIN = "conn-main";
  const signal = new AbortController().signal;

  test("a connection whose throttle sets none takes the global calls at once; its own limit wins over it; neither, nothing waits", async () => {
    const host = new FakeHost();
    const accounts = new AgentAccounts(host);
    // No throttle of its own, the global 1: the second call waits for the first to end.
    const first = await accounts.atOnce(host.userId, MAIN, [], signal, 1);
    let second = false;
    const waiting = accounts.atOnce(host.userId, MAIN, [], signal, 1).then((release) => ((second = true), release));
    await flush();
    expect(second).toBe(false);
    first();
    (await waiting)();
    expect(second).toBe(true);
    // A throttle whose calls at once are "none" sets none: the global 1 holds there too.
    const none = [{ id: MAIN, requestsPerMinute: "none" as const, tokensPerMinute: "none" as const, atOnce: "none" as const }];
    const held = await accounts.atOnce(host.userId, MAIN, none, signal, 1);
    let next = false;
    const queued = accounts.atOnce(host.userId, MAIN, none, signal, 1).then((release) => ((next = true), release));
    await flush();
    expect(next).toBe(false);
    held();
    (await queued)();
    // Its own 2 over the global 1: two at once, neither waits.
    const own = [{ ...none[0]!, atOnce: 2 }];
    const both = await Promise.all([accounts.atOnce(host.userId, MAIN, own, signal, 1), accounts.atOnce(host.userId, MAIN, own, signal, 1)]);
    for (const release of both) release();
    // No limit anywhere (the default "none"): any number at once.
    expect(defaultAgentSettings().callsAtOnce).toBe("none");
    const free = await Promise.all([0, 1, 2].map(() => accounts.atOnce(host.userId, MAIN, [], signal)));
    for (const release of free) release();
  });

  test("an agent's call takes its place by the settings' global calls at once when its connection's throttle sets none", async () => {
    const host = new FakeHost();
    const accounts = new AgentAccounts(host);
    const settings = agentSettingsOf({ callsAtOnce: 1 });
    expect(settings.callsAtOnce).toBe(1);
    const hold = () => accounts.reserve({ userId: host.userId, connection: MAIN, model: "m", tokensIn: 10, tokensOut: 10, settings, signal });
    const first = await hold();
    let second = false;
    const waiting = hold().then((r) => ((second = true), r));
    await flush();
    expect(second).toBe(false);
    accounts.settle(first, null);
    accounts.settle(await waiting, null);
    expect(second).toBe(true);
  });
});
