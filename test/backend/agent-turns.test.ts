// The agent turn loop (INC2-SPEC lane T1): a chat whose Engine switch is on agents plays each turn
// through the fixed pipeline's roles. In prompt-only mode they make exactly classic's calls, so the
// turn records exactly classic's events (on the same seed: a Branch keeps the chat's run seed, and
// the world rolls the same for the same parent path), and its narrator is told exactly classic's
// lines, which the turn records as output events (C11). What its roles stage lands in the fixed
// order, each operation re-validated; one that asks first goes to the turn's review card (C13), on
// the chips or at a gate. Classic chats are untouched.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { TurnRoles } from "../../src/backend/agents/turn-ctx";
import type { AgentOp, ApplyResult as Applied } from "../../src/backend/agents/tools/writer";
import { toChain } from "../../src/backend/ledger-io";
import { outputsOf } from "../../src/engine/outputs";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { ReviewCardView } from "../../src/shared/protocol";
import { alderChat, DANNY, fakeModels, MARCUS, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const MEMORY_MARK = "You keep the memory of";
const KNOWLEDGE_MARK = "You keep track of who knows what";
/** Every role prompt-only: the fixed pipeline as classic's own calls (the roles are agent-backed by default, §15). */
const PROMPT_ONLY = { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } };
/** Port Alder's player character's cash on hand. */
const CASH = "acct_pov_cash";

/** The head reply's active record. */
async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/**
 * A record's events as two chats can compare them: without the agent turn's output events, and each
 * message id by its place in its chat, since a Branch's messages have ids of their own.
 */
async function comparable(rig: Rig, chatId: string, rec: Rec): Promise<unknown> {
  const at = new Map((await rig.host.chats.messages(chatId, rig.host.userId)).map((m, i) => [m.id, `#${i}`]));
  const events = rec.events.filter((e: LedgerEvent) => !e.type.startsWith("engine.out."));
  return JSON.parse(JSON.stringify(events, (_key, value: unknown) => (typeof value === "string" && at.has(value) ? at.get(value) : value)));
}

/** The world's meta part, then the draft committed: every turn rolls the same for the same parent path, so two chats on one run seed plan the same turn. */
async function sameRoll(rig: Rig, worldId: string, meta: JsonObject = {}): Promise<void> {
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { seedMode: "same_roll", ...meta } }));
}

/**
 * A chat on Port Alder (or `chatId`), and a Branch of it at its greeting switched to agents: the same
 * world, state and run seed. `meta` joins the world's meta part.
 */
async function pair(rig: Rig, opts: { chatId?: string; meta?: JsonObject } = {}): Promise<{ classic: string; agents: string }> {
  let classic = opts.chatId;
  if (!classic) {
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    await sameRoll(rig, worldId, opts.meta);
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    classic = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: classic }));
  }
  const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
  if (!greeting) throw new Error("no greeting");
  const agents = rig.host.branch(classic, greeting.id);
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, engine: "agents" })).engine).toBe("agents");
  rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
  return { classic, agents };
}

/** Plays `text` as the next turn with `reply`; the narrator's Outcome and Outline as delivered, and the turn's record. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<{ outcome: string; outline: string; rec: Rec }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.section("Outcome");
  const outline = rig.host.section("Outline");
  await rig.host.finish(g, reply);
  return { outcome, outline, rec: await lastRecord(rig, chatId) };
}

/** The player character's cash on hand, in cents. */
async function cash(rig: Rig, chatId: string): Promise<number> {
  return (await stateOf(rig, chatId)).state.accounts[CASH] ?? 0;
}

/** Cash for the player character, as the GM's money edit puts it there. */
async function fund(rig: Rig, chatId: string, cents: number): Promise<number> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CASH, cents }] }));
  return cash(rig, chatId);
}

async function cards(rig: Rig, chatId: string): Promise<ReviewCardView[]> {
  return rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
}

/** Interpret reads nothing; the reply's read proposes `proposals`; every other step answers with nothing. */
function plainModels(rig: Rig, proposals: JsonObject[] = []): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals });
    return "{}";
  };
}

/** The fixed pipeline with the scene role staging `ops` before it answers as classic's scene does (nothing). */
function sceneStages(rig: Rig, ops: readonly AgentOp[], seen: Applied[] = []): Applied[] {
  const roles = classicRoles();
  rig.rt.orchestrator.roles = {
    ...roles,
    scene: async (task, ctx) => {
      seen.push(await ctx.writer.apply(ops, "the scene's change"));
      return roles.scene(task, ctx);
    },
  };
  return seen;
}

/** Money out of the player character's cash, as the GM's money edit takes it: a money adjustment, which asks first by default. */
const spend = (cents: number): AgentOp => ({ kind: "gm_edit", op: { op: "adjust", account: CASH, cents: -cents } });

const sceneAtGmTier = { agents: { roles: { scene: { tier: "gm" } } } };

describe("an agents chat on the fixed pipeline in prompt-only mode", () => {
  test("a plain turn records classic's events and tells the narrator classic's lines, which it records as its outputs", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig);
    plainModels(rig);
    const a = await played(rig, classic, "I look out over the harbor.", "Gulls wheel over the water.");
    const b = await played(rig, agents, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
    expect(b.outcome).toBe(a.outcome);
    expect(b.outline).toBe(a.outline);
    // Classic keeps its lines outside the record; the agent turn records them, and nothing else changes.
    expect(outputsOf(a.rec.events)).toBeNull();
    const out = outputsOf(b.rec.events);
    expect(out).not.toBeNull();
    for (const line of out?.outcome ?? []) expect(a.outcome).toContain(line);
    expect(a.rec.agents).toBeUndefined();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a purchase records classic's events and leaves the same cash", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig);
    rig.host.quietReply = (req: QuietRequest) => {
      const prompt = req.messages[0]?.content ?? "";
      if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: "buy", params: { item: "latte", price: 5 }, confidence: 0.9 });
      if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
      return "{}";
    };
    const a = await played(rig, classic, "I buy a latte for $5.", "The barista slides it over.");
    const b = await played(rig, agents, "I buy a latte for $5.", "The barista slides it over.");
    expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
    expect(await cash(rig, agents)).toBe(await cash(rig, classic));
    expect(b.outcome).toBe(a.outcome);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a batch of minds thinks as classic's does, and the turn records the same mind events", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, (_put, worldId) => sameRoll(rig, worldId), [DANNY, PRIYA, MARCUS]);
    const { classic, agents } = await pair(rig, { chatId });
    const a = await played(rig, classic, "I wave at everyone.", "Danny, Priya and Marcus wave back.");
    const thought = seen.minds.length;
    expect(thought).toBeGreaterThanOrEqual(3);
    const b = await played(rig, agents, "I wave at everyone.", "Danny, Priya and Marcus wave back.");
    expect(seen.minds.length - thought).toBe(thought);
    expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Re-narrate tells exactly what the turn told, from the outputs it copies with the plan", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    const first = await played(rig, agents, "I look out over the harbor.", "Gulls wheel over the water.");
    const chip = (await rig.rt.view(agents, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
    rig.body(await rig.send({ type: "lre.chip", chatId: agents, chip: chip?.id, choice: "renarrate" }));
    const g = await rig.host.start(agents, { type: "swipe" });
    expect(rig.host.section("Outcome")).toBe(first.outcome);
    expect(rig.host.section("Outline")).toBe(first.outline);
    await rig.host.finish(g, "The gulls wheel on.");
    const again = await lastRecord(rig, agents);
    expect(again.events.slice(0, again.pre)).toEqual(first.rec.events.slice(0, first.rec.pre));
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("its record keeps the turn's session; a classic turn's keeps none", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig);
    plainModels(rig);
    const a = await played(rig, classic, "I stretch.", "You stretch.");
    const b = await played(rig, agents, "I stretch.", "You stretch.");
    expect(a.rec.session).toBeUndefined();
    expect(typeof b.rec.session?.segment).toBe("string");
  });

  test("a hard lock vetoes the action the intent role read, as it does on classic", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Harrowmere Hall", "mystery_manor");
    const chatId = rig.host.createChat("Evening.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
    const reads = (read: JsonObject): void => {
      rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
    };
    reads({ action: "go", params: { to: "study" } });
    await played(rig, chatId, "I walk into the study.", "The study is cold.");
    reads({ action: "open_study_safe", params: {} });
    const shut = await played(rig, chatId, "I open the study safe.", "The safe won't budge.");
    const flags = (await stateOf(rig, chatId)).state.packs.story?.flags;
    expect(isRecord(flags) && flags.safe_open === true).toBe(false);
    const head = rig.host.head(chatId);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
    expect(chips.filter((c) => c.kind === "decline").map((c) => c.label)).toEqual([expect.stringContaining("Open the study safe")]);
    expect(chips.some((c) => c.kind === "untracked")).toBe(false);
    // The narrator is told the attempt failed, from the agent turn's own lines.
    expect(outputsOf(shut.rec.events)?.outcome.some((line) => line.includes("Open the study safe"))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the Engine switch", () => {
  test("is the chat's own, kept in its metadata: a Branch keeps it, and null returns the chat to classic", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    await played(rig, agents, "I stretch.", "You stretch.");
    const head = rig.host.head(agents);
    if (!head) throw new Error("no head");
    const branch = rig.host.branch(agents, head.id);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: branch })).engine).toBe("agents");
    const next = await played(rig, branch, "I yawn.", "You yawn.");
    expect(outputsOf(next.rec.events)).not.toBeNull();
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: branch, engine: null }))).toEqual({ knowledge: null, narrator: null });
    const classic = await played(rig, branch, "I sit.", "You sit.");
    expect(outputsOf(classic.rec.events)).toBeNull();
    expect((await rig.send({ type: "lre.chat.knowledge", chatId: branch, engine: "fast" })).type).toBe("lre.error");
  });

  test("switched while the engine runs, it drops the turn the other engine prepared, and says why", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
    let switched = false;
    rig.host.quietReply = () => {
      if (!switched) void rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" });
      switched = true;
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const stopped = await rig.host.start(chatId, { type: "normal" });
    expect(switched).toBe(true);
    expect(stopped.halted).toBe("cancelled");
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.detail).toBe("This chat's engine changed after the engine ran and before the reply started");
    // Retry runs the engine again, now on agents.
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Someone waves back.");
    expect(outputsOf((await lastRecord(rig, chatId)).events)).not.toBeNull();
  });
});

describe("what an agent turn's roles write", () => {
  test("a role without the GM tier can't make a GM edit; the turn plays on without it", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    const before = await fund(rig, agents, 5000);
    const seen = sceneStages(rig, [spend(100)]);
    await played(rig, agents, "I stretch.", "You stretch.");
    expect(seen[0]?.refused.map((r) => r.code)).toEqual(["not_granted"]);
    expect(await cash(rig, agents)).toBe(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("two roles that spend the same cash both stage; the commit lands the first in the fixed order and refuses the second", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { intent: { tier: "gm" }, scene: { tier: "gm" } } }, extraction: { money_adjust: { mode: "auto" } } } }));
    const before = await fund(rig, agents, 5000);
    expect(before).toBeGreaterThanOrEqual(5000);
    const most = Math.ceil(before * 0.6);
    const roles = classicRoles();
    const staged: Applied[] = [];
    // Each role writes into its own draft, so both stage against the same head; the commit takes them in the fixed order (intent, then scene).
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        staged.push(await ctx.writer.apply([spend(most)], "scene"));
        return roles.scene(task, ctx);
      },
      intent: {
        ...roles.intent,
        interpret: async (task, ctx) => {
          staged.push(await ctx.writer.apply([spend(most + 1)], "intent"));
          return roles.intent.interpret(task, ctx);
        },
      },
    } satisfies TurnRoles;
    const { rec } = await played(rig, agents, "I check my wallet.", "You count your cash.");
    expect(staged).toHaveLength(2);
    expect(staged.every((s) => s.pending && s.refused.length === 0)).toBe(true);
    expect(await cash(rig, agents)).toBe(before - (most + 1));
    expect(rec.agents?.map((a) => a.role)).toEqual(["intent"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a newcomer past the world's spawn cap is refused as the outside writer refuses it", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig, { meta: { spawnCap: 0 } });
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: sceneAtGmTier }));
    const seen = sceneStages(rig, [{ kind: "gm_edit", op: { op: "spawn", kind: "person", name: "Rosie" } }]);
    await played(rig, agents, "I look around.", "Nobody new is here.");
    expect(seen[0]?.refused.map((r) => r.code)).toEqual(["spawn_cap"]);
    expect(Object.values((await stateOf(rig, agents)).state.entities).some((e) => e.name === "Rosie")).toBe(false);
    expect(await cards(rig, agents)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a role's change to the learned area is made in the chat's metadata as the turn closes, with no event in its record; a cancelled turn makes none", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "story" } } } } }));
    const note: AgentOp = { kind: "ws_write", path: "learned/harbour.md", text: "Marcus opens the bait shop at six." };
    const learned = async (): Promise<Record<string, unknown>> => (await rig.rt.chatAgents.get(agents, rig.host.userId)).learned;
    // Cancelled while the role works: what it staged never lands, in the learned area either.
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([note], "scene");
        void rig.send({ type: "lre.cancel", chatId: agents });
        return roles.scene(task, ctx);
      },
    };
    rig.host.sendUser(agents, "I walk to the harbour.");
    await rig.host.settle();
    expect((await rig.host.start(agents, { type: "normal" })).halted).toBe("cancelled");
    expect(await learned()).toEqual({});
    // Played through, it lands as the turn closes: the scene role's file, read with its knowledge, and no event of the record's.
    const seen = sceneStages(rig, [note]);
    const again = await rig.host.start(agents, { type: "regenerate" });
    await rig.host.finish(again, "The harbour is quiet.");
    expect(seen[0]?.applied.length).toBe(1);
    expect((await learned())["learned/harbour.md"]).toMatchObject({ readers: "everyone", role: "scene" });
    expect((await lastRecord(rig, agents)).events.some((e) => e.type.startsWith("engine.ws."))).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a change that asks first goes to the turn's review card: the narrator isn't told, and Apply lands it with its Undo and counts for its role", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: sceneAtGmTier }));
    const before = await fund(rig, agents, 5000);
    sceneStages(rig, [spend(100)]);
    const { rec } = await played(rig, agents, "I check my wallet.", "You count your cash.");
    // Money adjustments ask first: nothing landed, and the record holds nothing of it.
    expect(await cash(rig, agents)).toBe(before);
    expect(rec.agents).toBeUndefined();
    const [card] = await cards(rig, agents);
    expect(card?.placement).toBe("chips");
    expect(card?.items.map((i) => [i.source, i.role, i.changeType, i.status])).toEqual([["agent", "scene", "money_adjust", "open"]]);
    expect(card?.items[0]?.lines.length).toBeGreaterThan(0);
    const view = await rig.rt.view(agents, rig.host.userId);
    expect(view.chips.some((c) => c.kind === "review")).toBe(true);
    const answered = rig.body(await rig.send({ type: "lre.review", chatId: agents, op: "apply", turn: card?.turn }));
    expect(answered.start).toBeNull();
    expect(await cash(rig, agents)).toBe(before - 100);
    const [after] = answered.cards as ReviewCardView[];
    expect(after?.items[0]?.status).toBe("applied");
    expect(typeof after?.items[0]?.undo).toBe("string");
    expect(JSON.stringify(await rig.rt.settings.learningOf(rig.host.userId))).toContain("scene");
    // Its Undo takes it back, wherever it is pressed.
    rig.body(await rig.send({ type: "lre.chip", chatId: agents, chip: after?.items[0]?.undo, choice: "undo" }));
    expect(await cash(rig, agents)).toBe(before);
    expect((await cards(rig, agents))[0]?.items[0]?.undone).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the reply's own confirm proposals join the card, their chips held for it", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig, [{ type: "purchase", payer: "pov", item: "newspaper", price: 2 }]);
    const before = await fund(rig, agents, 5000);
    await played(rig, agents, "I look at the rack.", "You buy a newspaper.");
    const [card] = await cards(rig, agents);
    expect(card?.items.map((i) => [i.source, i.role, i.changeType, i.status])).toEqual([["read", "read", "purchase", "open"]]);
    const chips = (await rig.rt.view(agents, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "confirm")).toBe(false);
    expect(chips.some((c) => c.kind === "review")).toBe(true);
    const answered = rig.body(await rig.send({ type: "lre.review", chatId: agents, op: "apply", turn: card?.turn }));
    expect((answered.cards as ReviewCardView[])[0]?.items[0]?.status).toBe("applied");
    expect(await cash(rig, agents)).toBeLessThan(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the review gate", () => {
  const gated = { agents: { roles: { scene: { tier: "gm" } }, review: { placement: "gate" } } };

  test("the turn waits after its plan; Apply lets the change through, and the resume replays the plan without a call", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: gated }));
    const before = await fund(rig, agents, 5000);
    sceneStages(rig, [spend(100)]);
    rig.host.sendUser(agents, "I check my wallet.");
    await rig.host.settle();
    const held = await rig.host.start(agents, { type: "normal" });
    expect(held.halted).toBeDefined();
    const [card] = await cards(rig, agents);
    expect(card?.placement).toBe("gate");
    const answered = rig.body(await rig.send({ type: "lre.review", chatId: agents, op: "apply", turn: card?.turn }));
    expect(answered.start).not.toBeNull();
    const calls = rig.host.quietCalls.length;
    const g = await rig.host.start(agents, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    expect(rig.host.quietCalls.length).toBe(calls);
    await rig.host.finish(g, "You count your cash.");
    expect(await cash(rig, agents)).toBe(before - 100);
    expect((await lastRecord(rig, agents)).agents?.map((a) => a.role)).toEqual(["scene"]);
    // The gate's card is done once its turn is taken.
    expect((await cards(rig, agents)).some((c) => c.placement === "gate")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("No resumes the turn without the change", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: gated }));
    const before = await fund(rig, agents, 5000);
    sceneStages(rig, [spend(100)]);
    rig.host.sendUser(agents, "I check my wallet.");
    await rig.host.settle();
    await rig.host.start(agents, { type: "normal" });
    const [card] = await cards(rig, agents);
    rig.body(await rig.send({ type: "lre.review", chatId: agents, op: "reject", turn: card?.turn }));
    const g = await rig.host.start(agents, { type: "regenerate" });
    await rig.host.finish(g, "You count your cash.");
    expect(await cash(rig, agents)).toBe(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("cancelling an agent turn", () => {
  test("Cancel while a role works stops the turn; what it staged never lands", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { ...sceneAtGmTier, extraction: { money_adjust: { mode: "auto" } } } }));
    const before = await fund(rig, agents, 5000);
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([spend(100)], "scene");
        // The player presses Cancel while the role works.
        void rig.send({ type: "lre.cancel", chatId: agents });
        return roles.scene(task, ctx);
      },
    };
    rig.host.sendUser(agents, "I check my wallet.");
    await rig.host.settle();
    const stopped = await rig.host.start(agents, { type: "normal" });
    expect(stopped.halted).toBe("cancelled");
    expect(await cash(rig, agents)).toBe(before);
    // Sent again, the turn plays, and what the cancelled run staged is gone with it.
    rig.rt.orchestrator.roles = classicRoles();
    const again = await rig.host.start(agents, { type: "regenerate" });
    await rig.host.finish(again, "You count your cash.");
    expect(await cash(rig, agents)).toBe(before);
    expect(await cards(rig, agents)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("memory placed before the next turn", () => {
  test("the read leaves the minds' memory to the next turn, which remembers the reply first", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const { agents } = await pair(rig, { chatId });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { memory: "before_next" } } } }));
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, knowledge: false }));
    const memories = (): number => rig.host.quietCalls.filter((c) => (c.messages[0]?.content ?? "").includes(MEMORY_MARK)).length;
    const first = await played(rig, agents, "I wave at Danny.", "Danny waves back at the harbor wall.");
    expect(first.rec.memoryNext).toBe(true);
    expect(memories()).toBe(0);
    await played(rig, agents, "I ask Priya how she is.", "Priya says she is well.");
    expect(memories()).toBeGreaterThan(0);
    expect(seen.memories.some((m) => m.context.includes("Danny waves back at the harbor wall."))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("while the chat tracks knowledge, its knowledge step stays after the reply, reading what the read found, and the memory moves to the next turn", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const { agents } = await pair(rig, { chatId });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { memory: "before_next" } } } }));
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, knowledge: true }));
    const calls = (mark: string): number => rig.host.quietCalls.filter((c) => (c.messages[0]?.content ?? "").includes(mark)).length;
    const before = { memory: calls(MEMORY_MARK), knowledge: calls(KNOWLEDGE_MARK) };
    const first = await played(rig, agents, "I wave at Danny.", "Danny waves back at the harbor wall.");
    expect(first.rec.memoryNext).toBe(true);
    expect(calls(KNOWLEDGE_MARK)).toBeGreaterThan(before.knowledge);
    expect(calls(MEMORY_MARK)).toBe(before.memory);
    await played(rig, agents, "I ask Priya how she is.", "Priya says she is well.");
    expect(calls(MEMORY_MARK)).toBeGreaterThan(before.memory);
    expect(seen.memories.some((m) => m.context.includes("Danny waves back at the harbor wall."))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("what the engine keeps in memory (Settings → Agents → Budgets)", () => {
  test("past its agent turns under way, the oldest run is let go; reset, the default keeps both", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { kept: { runs: 1 } } } }));
    const core = await rig.rt.ledger.core(agents, rig.host.userId);
    if (!core) throw new Error("no ledger");
    const observed = toChain(await rig.host.chats.messages(agents, rig.host.userId));
    const begin = (generationId: string): Promise<boolean> => rig.rt.orchestrator.begin({ chatId: agents, userId: rig.host.userId, generationId, core, observed, text: "I wait by the pier." });
    expect(await begin("gen-a")).toBe(true);
    expect(await begin("gen-b")).toBe(true);
    expect([rig.rt.orchestrator.isAgent("gen-a"), rig.rt.orchestrator.isAgent("gen-b")]).toEqual([false, true]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { kept: { runs: null } } } }));
    expect(await begin("gen-c")).toBe(true);
    expect([rig.rt.orchestrator.isAgent("gen-b"), rig.rt.orchestrator.isAgent("gen-c")]).toEqual([true, true]);
  });

  test("past its turns waiting at a review gate, the oldest gate's held work is let go: its resume replays the plan and lands what was let through, but no longer says which role wrote what the run committed before the gate", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig);
    const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
    if (!greeting) throw new Error("no greeting");
    const other = rig.host.branch(classic, greeting.id);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: other, engine: "agents" }));
    plainModels(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "gm" } }, review: { placement: "gate" }, kept: { gates: 1 } } } }));
    const before = { agents: await fund(rig, agents, 5000), other: await fund(rig, other, 5000) };
    // Each chat's scene role asks once for a note, which lands at once, and a spend, which waits at the gate.
    const note: AgentOp = { kind: "ws_write", path: "notes/wallet.md", text: "Counted at the pier." };
    const asked = new Set<string>();
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        if (!asked.has(ctx.chatId)) {
          asked.add(ctx.chatId);
          await ctx.writer.apply([note, spend(100)], "scene");
        }
        return roles.scene(task, ctx);
      },
    };
    for (const chatId of [agents, other]) {
      rig.host.sendUser(chatId, "I check my wallet.");
      await rig.host.settle();
      expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
      const [card] = await cards(rig, chatId);
      expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: card?.turn })).start).not.toBeNull();
    }
    // The second chat's gate is still held; the first's was let go when the second's was held.
    for (const chatId of [other, agents]) {
      const g = await rig.host.start(chatId, { type: "regenerate" });
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, "You count your cash.");
    }
    expect([await cash(rig, agents), await cash(rig, other)]).toEqual([before.agents - 100, before.other - 100]);
    // Held, the record says the scene role wrote the note and the spend; let go, only the spend its card let through.
    expect((await lastRecord(rig, other)).agents?.map((a) => a.role)).toEqual(["scene", "scene"]);
    expect((await lastRecord(rig, agents)).agents?.map((a) => a.role)).toEqual(["scene"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a classic chat", () => {
  test("is untouched: no output events, no role attribution, no review card, no session", async () => {
    const rig = new Rig({ shipped: true });
    const { classic } = await pair(rig);
    plainModels(rig);
    const { rec } = await played(rig, classic, "I stretch.", "You stretch.");
    expect(rec.events.some((e) => e.type.startsWith("engine.out."))).toBe(false);
    expect(rec.agents).toBeUndefined();
    expect(rec.memoryNext).toBeUndefined();
    expect(rec.session).toBeUndefined();
    expect(await cards(rig, classic)).toEqual([]);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: classic }))).toEqual({ knowledge: null, narrator: null });
  });
});
