// The reads of a reply on an agents chat (INC2-SPEC lane T1; AGENT-LOOP-PLAN §7.8, §7.10): every
// read is the roles', in a run of its own where its turn's is gone, so no turn mixes classic's steps
// with the roles. A Re-narrate's read, a Continue's and a Re-read edit's run on the roles, say in the
// record which role wrote what and keep the reply's one segment of the session; a read whose time runs
// out while a role works commits as classic's does. Memory left to the next turn is remembered once,
// by whichever engine plays it. A finished run leaves nothing holding it, and what the engine keeps
// in memory is bounded by each user's own settings.

import { describe, expect, test } from "bun:test";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { AgentOp } from "../../src/backend/agents/tools/writer";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { decodeLedger, toChain } from "../../src/backend/ledger-io";
import { sessionAt } from "../../src/backend/agents/sessions";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type Rec } from "../../src/shared/ledger";
import { MINDS_EVENTS } from "../../src/shared/minds";
import type { ReviewCardView } from "../../src/shared/protocol";
import { alderChat, DANNY, fakeModels, PRIYA, type Seen } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const READ_AGENT = /You are the read agent of LumiRPEngine/;
const ROLES_PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }]));
/** Every role prompt-only but the read, which keeps its agent-backed default (§15). */
const READ_AGENT_BACKED = Object.fromEntries(ROLE_IDS.filter((role) => role !== "read").map((role) => [role, { promptOnly: true }]));
const NEWSPAPER = { type: "purchase", payer: "pov", item: "newspaper", price: 2 };

/** A Port Alder chat on agents, `roles` as its roles' settings. */
async function agentsChat(rig: Rig, roles: JsonObject = ROLES_PROMPT_ONLY): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles } } }));
  return chatId;
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<Rec> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), reply);
  return lastRecord(rig, chatId);
}

/** Interpret reads nothing; every read proposes `proposals`; everything else answers nothing. */
function models(rig: Rig, proposals: JsonObject[] = []): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals });
  };
}

/** The fixed pipeline as classic's own calls, the read role's runs counted; while `note` is set, the read role writes it to the workspace first, which lands in the read at once. */
function watchRead(rig: Rig): { runs: number; note: AgentOp | null } {
  const watch: { runs: number; note: AgentOp | null } = { runs: 0, note: null };
  const roles = classicRoles();
  rig.rt.orchestrator.roles = {
    ...roles,
    read: {
      extract: async (task, ctx) => {
        watch.runs++;
        if (watch.note) await ctx.writer.apply([watch.note], "the read's note");
        return roles.read.extract(task, ctx);
      },
    },
  };
  return watch;
}

/** The messages of a record's segment of the session. */
async function segment(rig: Rig, rec: Rec): Promise<JsonObject[]> {
  const blob = rec.session?.segment ? await rig.rt.blobs.getJson(rig.host.userId, rec.session.segment) : null;
  return isRecord(blob) && Array.isArray(blob.messages) ? blob.messages.flatMap((m) => (isRecord(m) ? [m] : [])) : [];
}

async function cards(rig: Rig, chatId: string): Promise<ReviewCardView[]> {
  return rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
}

describe("the reads after a turn, on an agents chat", () => {
  test("a Re-narrate's read runs on the roles: its confirm change joins its review card, and its record keeps its session and says which role wrote what, after the plan's own", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    models(rig, [NEWSPAPER]);
    const watch = watchRead(rig);
    const roles = rig.rt.orchestrator.roles;
    rig.rt.orchestrator.roles = { ...roles, scene: async (task, ctx) => (await ctx.writer.apply([{ kind: "ws_write", path: "notes/scene.md", text: "The rack by the door." }], "scene"), roles.scene(task, ctx)) };
    const first = await played(rig, chatId, "I look at the rack.", "You buy a newspaper.");
    expect(first.agents?.map((a) => a.role)).toEqual(["scene"]);
    const read = watch.runs;
    watch.note = { kind: "ws_write", path: "notes/read.md", text: "Read again." };
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "renarrate" }));
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "You pick up a newspaper and pay.");
    const again = await lastRecord(rig, chatId);
    expect(watch.runs).toBe(read + 1);
    expect(again.agents?.map((a) => a.role)).toEqual(["scene", "read"]);
    expect(typeof again.session?.segment).toBe("string");
    const swipeId = rig.host.head(chatId)?.swipeId;
    expect((await cards(rig, chatId)).filter((c) => c.swipeId === swipeId)).toHaveLength(1);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" && c.swipeId === swipeId)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Continue's read runs on the roles: what its role wrote is named in the Continue's read, and the reply keeps one segment, holding the reply as continued", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    models(rig);
    const watch = watchRead(rig);
    const was = (await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.")).session?.segment;
    const runs = watch.runs;
    watch.note = { kind: "ws_write", path: "notes/gulls.md", text: "Gulls." };
    await rig.host.finish(await rig.host.start(chatId, { type: "continue" }), " A ferry sounds its horn.");
    const rec = await lastRecord(rig, chatId);
    expect(watch.runs).toBe(runs + 1);
    const cont = rec.post.find((p) => p.kind === "cont");
    expect(rec.agents?.map((a) => [a.role, a.seq])).toEqual([["read", cont?.seq]]);
    expect(rec.session?.segment).not.toBe(was);
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const chain = core?.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))) ?? [];
    expect(sessionAt(chain, []).segments).toEqual([rec.session?.segment ?? ""]);
    const answer = (await segment(rig, rec)).findLast((m) => m.role === "assistant");
    const head = rig.host.head(chatId);
    expect(answer?.content).toBe(head?.swipes[head.swipeId] ?? "");
    expect(String(answer?.content)).toContain("A ferry sounds its horn.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Re-read edit reads on the roles: its record says which role wrote what, and its segment holds the reply as edited", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    models(rig);
    const watch = watchRead(rig);
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, "Gulls wheel over the quiet water.");
    await rig.host.settle();
    const runs = watch.runs;
    watch.note = { kind: "ws_write", path: "notes/edit.md", text: "Edited." };
    const reread = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread?.id, choice: "reread" }));
    const rec = await lastRecord(rig, chatId);
    expect(watch.runs).toBe(runs + 1);
    expect(rec.agents?.map((a) => a.role)).toEqual(["read"]);
    expect((await segment(rig, rec)).findLast((m) => m.role === "assistant")?.content).toBe("Gulls wheel over the quiet water.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a read whose time runs out while an agent-backed role works commits as classic's does, and the next turn's session and record land", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, READ_AGENT_BACKED);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { postReplyMs: 1000 } } }));
    rig.host.quietReply = (req: QuietRequest) => {
      const head = req.messages[0]?.content ?? "";
      // The read agent, and classic's extract after it, take longer than the read may.
      if (READ_AGENT.test(head) || req.messages.some((m) => m.content.includes(EXTRACT_MARK))) return Promise.withResolvers<string>().promise;
      return head.includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : "{}";
    };
    const rec = await played(rig, chatId, "I look around.", "The square is quiet.");
    await rig.host.settle();
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect([rec.status, Object.keys(core?.journal.pending ?? {}).length]).toEqual(["ok", 0]);
    models(rig);
    const roles = classicRoles();
    rig.rt.orchestrator.roles = { ...roles, scene: async (task, ctx) => (await ctx.writer.apply([{ kind: "ws_write", path: "notes/wave.md", text: "A wave." }], "scene"), roles.scene(task, ctx)) };
    const next = await played(rig, chatId, "I wave.", "Someone waves back.");
    expect(typeof next.session?.segment).toBe("string");
    expect(next.agents?.map((a) => a.role)).toEqual(["scene"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with a main agent, a read whose time runs out while it works goes on without it, and the reply commits", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" } }, timeouts: { postReplyMs: 1000 } } }));
    const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
    rig.host.quietReply = (req: QuietRequest) => {
      if ((req.tools ?? []).some((t) => t.name === "run_role")) {
        const stage = req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
        // The read's stage takes longer than the read may.
        if (stage.slice(stage.lastIndexOf("Stage ")).startsWith("Stage 7")) return Promise.withResolvers<string>().promise;
        const roles = [...new Set([...stage.matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
        return { content: "", toolCalls: [...roles.map((role) => call("run_role", { role, task: `the ${role}` }, `r_${role}_${req.messages.length}`)), call("commit", {}, `c_${req.messages.length}`)] };
      }
      return (req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : JSON.stringify({ proposals: [] });
    };
    const rec = await played(rig, chatId, "I look around.", "The square is quiet.");
    await rig.host.settle();
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect([rec.status, Object.keys(core?.journal.pending ?? {}).length]).toEqual(["ok", 0]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("memory left to the next turn", () => {
  async function owing(rig: Rig): Promise<{ chatId: string; seen: Seen }> {
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents", knowledge: false }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: ROLES_PROMPT_ONLY, pipeline: { memory: "before_next" } } } }));
    expect((await played(rig, chatId, "I wave at Danny.", "Danny waves back at the harbor wall.")).memoryNext).toBe(true);
    return { chatId, seen };
  }
  const ofFirst = (seen: Seen): number => seen.memories.filter((m) => m.context.includes("Danny waves back at the harbor wall.")).length;

  test("a classic turn remembers it, once the chat is switched back to classic", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, seen } = await owing(rig);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "classic" }));
    const next = await played(rig, chatId, "I ask Priya how she is.", "Priya says she is well.");
    expect(ofFirst(seen)).toBe(2);
    expect(next.events.slice(0, next.pre).filter((e) => e.type === MINDS_EVENTS.memory)).toHaveLength(2);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a turn that waits at the intent gate and then plays asks for it once", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, seen } = await owing(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { gates: { intent: true } } }));
    rig.host.quietReply = ((reply) => (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "buy", params: { item: "latte", price: 5 }, confidence: 0.9 }) : reply(req)))(rig.host.quietReply ?? (() => "{}"));
    rig.host.sendUser(chatId, "I buy a latte for $5.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    expect(ofFirst(seen)).toBe(2);
    const gate = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "intent_gate");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "play" }));
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The barista slides it over.");
    expect(ofFirst(seen)).toBe(2);
    expect((await lastRecord(rig, chatId)).events.filter((e) => e.type === MINDS_EVENTS.memory)).toHaveLength(2);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Re-read edit of the reply that owes it remembers in its read, and the next turn doesn't again", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, seen } = await owing(rig);
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, "Danny waves back at the harbor wall. Priya nods.");
    await rig.host.settle();
    const reread = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread?.id, choice: "reread" }));
    const read = await lastRecord(rig, chatId);
    expect([read.memoryNext, read.events.filter((e) => e.type === MINDS_EVENTS.memory).length]).toEqual([undefined, 2]);
    const asked = seen.memories.length;
    const next = await played(rig, chatId, "I ask Priya how she is.", "Priya says she is well.");
    expect(seen.memories.length - asked).toBe(0);
    expect(next.events.slice(0, next.pre).filter((e) => e.type === MINDS_EVENTS.memory)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("what the engine keeps of agent turns", () => {
  test("a finished turn's run is held by nothing: not the bridge's commit, nor its prepared read", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    models(rig);
    const runs = Reflect.get(rig.rt.orchestrator, "runs") as Map<string, object>;
    const refs: WeakRef<object>[] = [];
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        const s = runs.get(ctx.generationId);
        if (s) refs.push(new WeakRef(s));
        return roles.scene(task, ctx);
      },
    };
    for (const [i, text] of ["I look out over the harbor.", "I walk to the pier.", "I sit on a bench."].entries()) await played(rig, chatId, text, `Reply ${i}.`);
    await rig.host.settle();
    Bun.gc(true);
    await rig.host.settle();
    Bun.gc(true);
    expect([refs.length, refs.filter((r) => r.deref() !== undefined).length]).toEqual([3, 0]);
  });

  test("the memory budget lets go of an idle chat's turn bridge, but not of one whose turn waits on the player", async () => {
    const rig = new Rig({ shipped: true });
    const idle = await agentsChat(rig);
    models(rig);
    await played(rig, idle, "I look around.", "The square is quiet.");
    const waiting = await agentsChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { gates: { intent: true } } }));
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "buy", params: { item: "latte", price: 5 }, confidence: 0.9 }) : JSON.stringify({ proposals: [] }));
    rig.host.sendUser(waiting, "I buy a latte for $5.");
    await rig.host.settle();
    expect((await rig.host.start(waiting, { type: "normal" })).halted).toBeDefined();
    const other = await agentsChat(rig);
    await rig.rt.host.chats.messages(other, rig.host.userId);
    expect(rig.rt.trimIdle().bridges).toBe(1);
    expect([rig.rt.bridgeOf(idle), rig.rt.bridgeOf(waiting)?.waiting]).toEqual([undefined, true]);
  });

  test("an agent turn's Diagnostics policy and a review gate's replay go once the turn is over", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    models(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "gm" } }, review: { placement: "gate" } } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: "acct_pov_cash", cents: 5000 }] }));
    const roles = classicRoles();
    let asked = false;
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        if (!asked) await ctx.writer.apply([{ kind: "gm_edit", op: { op: "adjust", account: "acct_pov_cash", cents: -100 } }], "scene");
        asked = true;
        return roles.scene(task, ctx);
      },
    };
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    const [card] = await cards(rig, chatId);
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: card?.turn }));
    expect(rig.rt.bridgeOf(chatId)?.replaying("I check my wallet.")).toBe(true);
    await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "You count your cash.");
    await played(rig, chatId, "I walk on.", "The road is long.");
    expect(rig.rt.bridgeOf(chatId)?.replaying("I check my wallet.")).toBe(false);
    expect((Reflect.get(rig.rt.diag, "agentTurns") as Set<string>).size).toBe(0);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("each user's own Budgets bound only their own runs and watched chats", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const other = "user-b";
    await rig.rt.settings.set(other, { agents: { kept: { runs: 1, watchers: 1 } } });
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    if (!core) throw new Error("no ledger");
    const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    // Both users play the chat on agents (the host keeps one user's chats, so the switch is read as theirs).
    Reflect.set(rig.rt.chatKnowledge, "engine", async () => "agents");
    const begin = (userId: string, generationId: string): Promise<boolean> => rig.rt.orchestrator.begin({ chatId, userId, generationId, core, observed, text: "I wait by the pier." });
    await begin(rig.host.userId, "gen-a");
    await begin(other, "gen-b1");
    await begin(other, "gen-b2");
    expect(["gen-a", "gen-b1", "gen-b2"].map((g) => rig.rt.orchestrator.isAgent(g))).toEqual([true, false, true]);
    await rig.rt.review.cards(chatId, rig.host.userId, "page-a");
    await rig.rt.review.cards("chat-y", other, "page-b");
    await rig.rt.review.cards("chat-z", other, "page-b");
    expect([...(Reflect.get(rig.rt.review, "watchers") as Map<string, unknown>).keys()]).toEqual([`${rig.host.userId}\u0000${chatId}`, `${other}\u0000chat-z`]);
  });
});

describe("a stored record's attribution (`Rec.agents`)", () => {
  const rec = { v: 1, defHash: "r1", seq: 1, swipeHash: { len: 0, hash: "h" }, path: "", seed: "", pre: 0, events: [], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
  const read = (agents: unknown): string[] => Object.keys(decodeLedger({ [LEDGER_NAMESPACE]: { v: 1, swipes: { "0": { ...rec, agents } }, markers: [] } } as unknown as JsonObject)?.swipes ?? {});

  test("is read as a list of ranges, in the events or a read's post entry; anything else marks the record damaged, as a malformed `diag` does", () => {
    expect(read([{ role: "read", key: "k", from: 0, to: 1 }, { role: "read", key: "k2", from: 0, to: 2, seq: 4 }])).toEqual(["0"]);
    expect(read(undefined)).toEqual(["0"]);
    for (const bad of [{}, "read", [{ role: "read", key: "k", from: -1, to: 1 }], [{ role: "read", key: "k", from: 2, to: 1 }], [{ role: "read", from: 0, to: 1 }], [{ role: "read", key: "k", from: 0, to: 1, seq: "4" }]]) expect(read(bad)).toEqual([]);
  });
});
