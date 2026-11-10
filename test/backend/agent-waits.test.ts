// An agent turn's waits (AGENT-LOOP-PLAN §7, DESIGN §4.6): every gate keeps the turn's run whole for
// its resume, which calls no agent again and loses nothing its roles committed or set aside; with the
// outline and the review gate both on, the outline shows first; and the Engine switch waits for a
// turn that waits at a gate, so what it kept (approved changes among it) still lands.
import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { AgentOp } from "../../src/backend/agents/tools/writer";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { Rec } from "../../src/shared/ledger";
import type { ReviewCardView } from "../../src/shared/protocol";
import type { Chip } from "../../src/shared/state-view";
import { alderChat, DANNY, MARCUS, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const PROMPT_ONLY = { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } };
const OUTLINE_GATE = { gates: { outline: true }, modelUse: { steps: { outline: { enabled: true, signals: ["always"] } }, budgets: { pre: { calls: 8 } } } };
const CASH = "acct_pov_cash";
const INTERPRET_MARK = "You map a player's typed input";
const OUTLINE_MARK = "You outline a roleplay narrator";
const MIND = /You are the private mind of (.+?) in the roleplay world/;

const spend = (cents: number): AgentOp => ({ kind: "gm_edit", op: { op: "adjust", account: CASH, cents: -cents } });
const PRE_NOTE: AgentOp = { kind: "ws_write", path: "notes/scene.md", text: "SCENE-NOTE." };
const PLAN_NOTE: AgentOp = { kind: "ws_write", path: "notes/beats.md", text: "BEAT-NOTE." };
const INTENT_NOTE: AgentOp = { kind: "ws_write", path: "notes/intent.md", text: "INTENT-NOTE." };

/** A Port Alder chat on agents, every role prompt-only, $50 in the player's cash; a typed message reads as `action` (none by default). */
async function agentsChat(rig: Rig, action: string | null = null): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
  rig.host.quietReply = (req: QuietRequest) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify(action ? { action, params: { item: "latte", price: 5 }, confidence: 0.9 } : { action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(OUTLINE_MARK)) return JSON.stringify({ beats: ["You glance at your wallet."] });
    return JSON.stringify({ proposals: [] });
  };
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CASH, cents: 5000 }] }));
  return chatId;
}

/** The head reply's active record. */
async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

const cashOf = async (rig: Rig, chatId: string): Promise<number> => (await stateOf(rig, chatId)).state.accounts[CASH] ?? 0;
const chipsOf = async (rig: Rig, chatId: string): Promise<Chip[]> => (await rig.rt.view(chatId, rig.host.userId)).chips;
const cardsOf = async (rig: Rig, chatId: string): Promise<ReviewCardView[]> => rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
const itemsOf = (cards: ReviewCardView[]): string[] => cards.flatMap((c) => c.items.map((i) => `${i.role}:${i.changeType}`));

/** Presses `choice` on the chat's chip of `kind`. */
async function press(rig: Rig, chatId: string, kind: string, choice: string): Promise<void> {
  const chip = (await chipsOf(rig, chatId)).find((c) => c.kind === kind);
  if (!chip) throw new Error(`no ${kind} chip`);
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice }));
}

/** Applies the chat's review card, at its gate. */
async function apply(rig: Rig, chatId: string): Promise<void> {
  const card = (await cardsOf(rig, chatId))[0];
  if (!card) throw new Error("no review card");
  rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: card.turn }));
}

/** Roles that stage before the plan (the scene: an ask-first spend and a note) and after it (the director: a note), counting the scene's runs. */
function stagingRoles(rig: Rig): { sceneRuns: () => number } {
  const roles = classicRoles();
  let sceneRuns = 0;
  rig.rt.orchestrator.roles = {
    ...roles,
    scene: async (task, ctx) => {
      sceneRuns++;
      await ctx.writer.apply([spend(100), PRE_NOTE], "scene");
      return roles.scene(task, ctx);
    },
    director: {
      ...roles.director,
      prose: async (task, ctx) => {
        await ctx.writer.apply([PLAN_NOTE], "director");
        return roles.director.prose(task, ctx);
      },
    },
  };
  return { sceneRuns: () => sceneRuns };
}

describe("an agent turn's wait keeps its run for the resume", () => {
  test("the outline gate: the scene runs once, its ask-first change reaches the card, and both notes the record", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { ...OUTLINE_GATE, agents: { roles: { scene: { tier: "gm" } } } } }));
    const roles = stagingRoles(rig);
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    await press(rig, chatId, "outline_gate", "play");
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "You count your cash.");
    const rec = await lastRecord(rig, chatId);
    const events = JSON.stringify(rec.events);
    expect({ sceneRuns: roles.sceneRuns(), card: itemsOf(await cardsOf(rig, chatId)), preNote: events.includes("notes/scene.md"), planNote: events.includes("notes/beats.md"), agents: rec.agents?.map((a) => a.role) ?? [] }).toEqual({ sceneRuns: 1, card: ["scene:money_adjust"], preNote: true, planNote: true, agents: ["scene", "director"] });
  });

  test("the intent gate: what the intent role wrote before it lands, and Play reads nothing again", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, "buy");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { gates: { intent: true }, agents: { roles: { intent: { tier: "story" } } } } }));
    const roles = classicRoles();
    let reads = 0;
    rig.rt.orchestrator.roles = {
      ...roles,
      intent: {
        ...roles.intent,
        interpret: async (task, ctx) => {
          reads++;
          await ctx.writer.apply([INTENT_NOTE], "intent");
          return roles.intent.interpret(task, ctx);
        },
      },
    };
    rig.host.sendUser(chatId, "I buy a latte for $5.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    await press(rig, chatId, "intent_gate", "play");
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The barista slides it over.");
    expect({ reads, note: JSON.stringify((await lastRecord(rig, chatId)).events).includes("notes/intent.md") }).toEqual({ reads: 1, note: true });
  });

  test("minds still thinking at the intent gate: classic and prompt-only agents ask each mind once across the wait and its Play", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const asked: Record<"classic" | "agents", string[]> = { classic: [], agents: [] };
    let which: "classic" | "agents" = "classic";
    // The minds answer only once released: the gate shows while they think.
    const waiting: (() => void)[] = [];
    let hold = true;
    rig.host.quietReply = (req: QuietRequest) => {
      const system = req.messages[0]?.content ?? "";
      const mind = MIND.exec(system)?.[1];
      if (mind) {
        asked[which].push(mind);
        const answer = JSON.stringify({ monologue: `THOUGHT of ${mind}.`, depiction: `${mind} looks up`, intent: "Wait.", reactions: [], mood: "calm" });
        if (!hold) return answer;
        const { promise, resolve } = Promise.withResolvers<string>();
        waiting.push(() => resolve(answer));
        return promise;
      }
      if (system.includes(INTERPRET_MARK)) return JSON.stringify({ action: "buy", params: { item: "latte", price: 5 }, confidence: 0.9 });
      return JSON.stringify({ proposals: [] });
    };
    const classic = await alderChat(
      rig,
      async (_put, worldId) => {
        rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { seedMode: "same_roll" } }));
      },
      [DANNY, PRIYA, MARCUS],
    );
    const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
    if (!greeting) throw new Error("no greeting");
    const agents = rig.host.branch(classic, greeting.id);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, engine: "agents" }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { ...PROMPT_ONLY, gates: { intent: true } } }));
    const play = async (chatId: string): Promise<void> => {
      rig.host.sendUser(chatId, "I buy a latte for $5.");
      await rig.host.settle();
      hold = true;
      expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
      hold = false;
      // The minds answer while the card waits; then the player presses Play.
      for (const release of waiting.splice(0)) release();
      await rig.host.settle();
      await press(rig, chatId, "intent_gate", "play");
      const g = await rig.host.start(chatId, { type: "regenerate" });
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, "The barista slides it over.");
    };
    which = "classic";
    await play(classic);
    which = "agents";
    await play(agents);
    expect(asked.classic).toHaveLength(3);
    expect([...asked.agents].sort()).toEqual([...asked.classic].sort());
  });

  for (const placement of ["chips", "gate"] as const) {
    test(`review placement ${placement}: what the director committed after the plan is in the turn's record`, async () => {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig);
      rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "gm" } }, review: { placement } } } }));
      const roles = stagingRoles(rig);
      const before = await cashOf(rig, chatId);
      rig.host.sendUser(chatId, "I check my wallet.");
      await rig.host.settle();
      let g = await rig.host.start(chatId, { type: "normal" });
      if (placement === "gate") {
        expect(g.halted).toBeDefined();
        await apply(rig, chatId);
        g = await rig.host.start(chatId, { type: "regenerate" });
      }
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, "You count your cash.");
      const events = JSON.stringify((await lastRecord(rig, chatId)).events);
      expect({ sceneRuns: roles.sceneRuns(), preNote: events.includes("notes/scene.md"), planNote: events.includes("notes/beats.md") }).toEqual({ sceneRuns: 1, preNote: true, planNote: true });
      if (placement === "gate") expect(await cashOf(rig, chatId)).toBe(before - 100);
    });
  }
});

describe("the outline gate and the review gate both on", () => {
  test("the outline shows first; Play brings the review card; Apply plays the turn, its change landing once", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { ...OUTLINE_GATE, agents: { roles: { scene: { tier: "gm" } }, review: { placement: "gate" } } } }));
    const roles = stagingRoles(rig);
    const before = await cashOf(rig, chatId);
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    const first = await rig.host.start(chatId, { type: "normal" });
    expect(first.halted).toBeDefined();
    expect((await chipsOf(rig, chatId)).map((c) => c.kind)).toContain("outline_gate");
    expect(await cardsOf(rig, chatId)).toEqual([]);
    await press(rig, chatId, "outline_gate", "play");
    const second = await rig.host.start(chatId, { type: "regenerate" });
    expect(second.halted).toBeDefined();
    expect((await chipsOf(rig, chatId)).map((c) => c.kind)).not.toContain("outline_gate");
    expect(itemsOf(await cardsOf(rig, chatId))).toEqual(["scene:money_adjust"]);
    await apply(rig, chatId);
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "You count your cash.");
    const rec = await lastRecord(rig, chatId);
    const events = JSON.stringify(rec.events);
    expect({ sceneRuns: roles.sceneRuns(), spent: before - (await cashOf(rig, chatId)), preNote: events.includes("notes/scene.md"), planNote: events.includes("notes/beats.md"), outline: events.includes("You glance at your wallet.") }).toEqual({ sceneRuns: 1, spent: 100, preNote: true, planNote: true, outline: true });
  });
});

describe("the Engine switch while a turn waits at a gate", () => {
  test("is refused until the turn finishes, so the changes its review card approved land", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "gm" } }, review: { placement: "gate" } } } }));
    stagingRoles(rig);
    const before = await cashOf(rig, chatId);
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    const waiting = await rig.send({ type: "lre.chat.knowledge", chatId, engine: "classic" });
    expect(waiting.type === "lre.error" ? waiting.code : null).toBe("conflict");
    await apply(rig, chatId);
    // Approved, the card stands until the reply takes the turn: the switch still waits.
    const resuming = await rig.send({ type: "lre.chat.knowledge", chatId, engine: "classic" });
    expect(resuming.type === "lre.error" ? resuming.code : null).toBe("conflict");
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "You count your cash.");
    expect(await cashOf(rig, chatId)).toBe(before - 100);
    // The turn done, the chat switches; what it chose stays as it is.
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "classic" })).engine).toBeUndefined();
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId })).engine).toBeUndefined();
  });

  test("a classic turn at its intent gate holds the switch to agents; Cancel lets it go", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, "buy");
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "classic" }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { gates: { intent: true } } }));
    rig.host.sendUser(chatId, "I buy a latte for $5.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeDefined();
    const refused = await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" });
    expect(refused.type === "lre.error" ? refused.code : null).toBe("conflict");
    await press(rig, chatId, "intent_gate", "cancel");
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  });
});
