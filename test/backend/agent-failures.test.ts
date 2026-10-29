// An agent turn's failures (INC2-SPEC C9, DESIGN §4.6): a role that fails lands nothing it staged,
// whatever its onFail and whether the orchestrator or a main agent ran it; a stop before the reply
// ends the run at once, with no later role and no gate hiding it; and minds or a prompt-only role's
// classic call that fail stop an agent turn under `stop` exactly as they stop a classic one.
import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { AgentOp } from "../../src/backend/agents/tools/writer";
import { emptyUsage } from "../../src/backend/agents/usage";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { ReviewCardView } from "../../src/shared/protocol";
import { alderChat, DANNY, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const PROMPT_ONLY_ROLES = Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }]));
const PROMPT_ONLY = { agents: { roles: PROMPT_ONLY_ROLES } };
const CASH = "acct_pov_cash";
const INTERPRET_MARK = "You map a player's typed input";
const BRIEF_MARK = "You brief a roleplay narrator";
const FAILED = { ok: false as const, code: "contract" as const, reason: "the answer doesn't keep the task's form", usage: emptyUsage(), via: "agent" as const };

const spend = (cents: number): AgentOp => ({ kind: "gm_edit", op: { op: "adjust", account: CASH, cents: -cents } });
const NOTE: AgentOp = { kind: "ws_write", path: "notes/intent.md", text: "INTENT-NOTE." };

/** A Port Alder chat on agents, every role prompt-only unless `patch` says otherwise, $50 more in the player's cash. */
async function agentsChat(rig: Rig, patch: JsonObject = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : JSON.stringify({ proposals: [] }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CASH, cents: 5000 }] }));
  return chatId;
}

const cashOf = async (rig: Rig, chatId: string): Promise<number> => (await stateOf(rig, chatId)).state.accounts[CASH] ?? 0;

/** Sends `text` and starts the reply: whether it halted, and what the engine-failed card says. */
async function attempt(rig: Rig, chatId: string, text: string): Promise<{ halted: boolean; failed: string[]; chips: string[] }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  if (!g.halted) await rig.host.finish(g, "The harbor is calm.");
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { halted: g.halted !== undefined, failed: chips.filter((c) => c.kind === "engine_failed").map((c) => c.detail ?? c.label), chips: chips.map((c) => c.kind) };
}

describe("a role that fails lands nothing it staged", () => {
  for (const onFail of ["prompt_only", "skip"] as const) {
    test(`a scene agent that stages, then fails (onFail ${onFail}): the turn goes on without it`, async () => {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig, { agents: { roles: { scene: { promptOnly: false, tier: "gm", onFail } } }, extraction: { money_adjust: { mode: "auto" } } });
      const before = await cashOf(rig, chatId);
      const roles = classicRoles();
      let agentRuns = 0;
      rig.rt.orchestrator.roles = {
        ...roles,
        scene: async (task, ctx) => {
          if (ctx.settings.promptOnly) return roles.scene(task, ctx);
          agentRuns++;
          await ctx.writer.apply([spend(100)], "scene");
          return FAILED;
        },
      };
      const turn = await attempt(rig, chatId, "I check my wallet.");
      expect({ halted: turn.halted, agentRuns, spent: before - (await cashOf(rig, chatId)) }).toEqual({ halted: false, agentRuns: 1, spent: 0 });
    });
  }

  test("its prompt-only run, after the agent's failed one, lands its own change once", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { roles: { scene: { promptOnly: false, tier: "gm", onFail: "prompt_only" } } }, extraction: { money_adjust: { mode: "auto" } } });
    const before = await cashOf(rig, chatId);
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([spend(100)], "scene");
        return ctx.settings.promptOnly ? roles.scene(task, ctx) : FAILED;
      },
    };
    const turn = await attempt(rig, chatId, "I check my wallet.");
    expect({ halted: turn.halted, spent: before - (await cashOf(rig, chatId)) }).toEqual({ halted: false, spent: 100 });
  });

  test("a main agent's run that fails: its commit goes on without the role's changes", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { pipeline: { mode: "main" }, roles: { scene: { promptOnly: false, tier: "gm" } } }, extraction: { money_adjust: { mode: "auto" } } });
    const before = await cashOf(rig, chatId);
    mainModels(rig);
    const roles = classicRoles();
    let agentRuns = 0;
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        if (ctx.settings.promptOnly) return roles.scene(task, ctx);
        agentRuns++;
        await ctx.writer.apply([spend(100)], "scene");
        return FAILED;
      },
    };
    const turn = await attempt(rig, chatId, "I check my wallet.");
    expect({ halted: turn.halted, agentRuns, spent: before - (await cashOf(rig, chatId)) }).toEqual({ halted: false, agentRuns: 1, spent: 0 });
  });
});

/**
 * The scripted main agent: each stage runs every role it asks for and commits in the same answer,
 * unless `fail` says to throw on the `n`th call; the roles' classic calls read no action and propose
 * nothing.
 */
function mainModels(rig: Rig, fail: (n: number) => boolean = () => false): void {
  let n = 0;
  rig.host.quietReply = (req: QuietRequest) => {
    if ((req.tools ?? []).some((t) => t.name === "run_role")) {
      const at = n++;
      if (fail(at)) throw new Error("connection reset");
      const stage = req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
      const roles = [...new Set([...stage.matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
      return { content: "", toolCalls: [...roles.map((role) => call("run_role", { role, task: `task for ${role}` }, `c${at}_${role}`)), call("commit", {}, `c${at}_commit`)] };
    }
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals: [] });
  };
}

describe("a stop before the reply", () => {
  test("a scene agent under stop, with the review gate on: the engine-failed card, no later role, no card, nothing it staged", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { roles: { scene: { promptOnly: false, tier: "gm", onFail: "stop" } }, review: { placement: "gate" } } });
    const before = await cashOf(rig, chatId);
    const roles = classicRoles();
    let prose = 0;
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        if (ctx.settings.promptOnly) return roles.scene(task, ctx);
        await ctx.writer.apply([spend(100)], "scene");
        return FAILED;
      },
      director: {
        ...roles.director,
        prose: async (task, ctx) => {
          prose++;
          return roles.director.prose(task, ctx);
        },
      },
    };
    const turn = await attempt(rig, chatId, "I check my wallet.");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect({ halted: turn.halted, failed: turn.failed.length, prose, cards: cards.length, spent: before - (await cashOf(rig, chatId)) }).toEqual({ halted: true, failed: 1, prose: 0, cards: 0, spent: 0 });
    expect(turn.failed[0]).toContain("Scene");
  });

  test("the intent role failing under its default stop: no other role runs, and no gate shows", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { roles: { intent: { promptOnly: false }, scene: { tier: "gm" } }, review: { placement: "gate" } } });
    const roles = classicRoles();
    let scene = 0;
    rig.rt.orchestrator.roles = {
      ...roles,
      intent: {
        ...roles.intent,
        interpret: async (task, ctx) => {
          if (ctx.settings.promptOnly) return roles.intent.interpret(task, ctx);
          await ctx.writer.apply([NOTE], "intent");
          return FAILED;
        },
      },
      scene: async (task, ctx) => {
        scene++;
        await ctx.writer.apply([spend(100)], "scene");
        return roles.scene(task, ctx);
      },
    };
    const turn = await attempt(rig, chatId, "I check my wallet.");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect({ halted: turn.halted, failed: turn.failed.length, scene, cards: cards.length }).toEqual({ halted: true, failed: 1, scene: 0, cards: 0 });
    expect(turn.failed[0]).toContain("Intent");
  });

  test("a main agent that fails at the beats, its scene's change asked first at the review gate: the engine-failed card, no card", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { pipeline: { mode: "main" }, roles: { scene: { tier: "gm" } }, review: { placement: "gate" } } });
    const before = await cashOf(rig, chatId);
    // The intent's stage and the scene's go through; the beats' call fails.
    mainModels(rig, (n) => n >= 2);
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([spend(100)], "scene");
        return roles.scene(task, ctx);
      },
    };
    const turn = await attempt(rig, chatId, "I check my wallet.");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect({ halted: turn.halted, failed: turn.failed.length, cards: cards.length, spent: before - (await cashOf(rig, chatId)) }).toEqual({ halted: true, failed: 1, cards: 0, spent: 0 });
    expect(turn.failed[0]).toContain("Main agent");
  });
});

describe("a classic call that fails under stop stops an agent turn as it stops a classic one", () => {
  /** A classic chat and its branch on agents, with the minds or the brief on. */
  async function pair(rig: Rig, patches: JsonObject[]): Promise<{ classic: string; agents: string }> {
    for (const patch of [{ modelUse: { steps: { "npc.choose": { enabled: false } } } }, PROMPT_ONLY, ...patches]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const classic = await alderChat(rig, async (_put, worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { seedMode: "same_roll" } }));
    });
    const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
    if (!greeting) throw new Error("no greeting");
    const agents = rig.host.branch(classic, greeting.id);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, engine: "agents" }));
    return { classic, agents };
  }

  /** The models: `bad` calls fail as `how` says; the rest read no action, think, and brief. */
  function script(rig: Rig, bad: RegExp, how: "unanswered" | "thrown"): void {
    rig.host.quietReply = (req: QuietRequest) => {
      const all = req.messages.map((m) => m.content).join("\n");
      if (bad.test(all)) {
        if (how === "thrown") throw new Error("the provider is down");
        return "not an answer";
      }
      if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      if (all.includes("You are the private mind of")) return JSON.stringify({ monologue: "Hm.", depiction: "looks up", intent: "Wait.", reactions: [], mood: "calm" });
      if (all.includes(BRIEF_MARK)) return JSON.stringify({ text: "BRIEF" });
      return "{}";
    };
  }

  for (const promptOnly of [true, false]) {
    test(`a mind that doesn't answer, the minds role ${promptOnly ? "prompt-only" : "an agent"} under stop`, async () => {
      const rig = new Rig({ shipped: true, minds: true });
      const { classic, agents } = await pair(rig, [{ agents: { roles: { minds: { promptOnly, onFail: "stop" } } } }]);
      // The agent's own minds: its answer is the classic step's, which leaves Danny's unanswered.
      const roles = classicRoles();
      rig.rt.orchestrator.roles = { ...roles, minds: async (task, ctx) => ({ ...(await roles.minds(task, ctx)), via: "agent" }) };
      script(rig, /You are the private mind of Danny/, "unanswered");
      const a = await attempt(rig, classic, "I look out at the harbor.");
      const b = await attempt(rig, agents, "I look out at the harbor.");
      expect({ classic: a.halted, agents: b.halted }).toEqual({ classic: true, agents: true });
      expect(b.failed).toEqual(a.failed);
    });
  }

  test("the brief's call fails: the prompt-only director under stop", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig, [{ modelUse: { steps: { brief: { enabled: true, signals: ["always"] } } } }, { agents: { roles: { director: { onFail: "stop" } } } }]);
    script(rig, new RegExp(BRIEF_MARK), "thrown");
    const a = await attempt(rig, classic, "I look out at the harbor.");
    const b = await attempt(rig, agents, "I look out at the harbor.");
    expect({ classic: a.halted, agents: b.halted }).toEqual({ classic: true, agents: true });
    // Its card says what classic's says: the brief's own failure.
    expect(b.failed).toEqual(a.failed);
  });

  test("under skip, the same failures let the agent turn go on", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { agents } = await pair(rig, [{ modelUse: { steps: { brief: { enabled: true, signals: ["always"] } } } }, { agents: { roles: { minds: { onFail: "skip" }, director: { onFail: "skip" } } } }]);
    script(rig, new RegExp(`You are the private mind of Danny|${BRIEF_MARK}`), "unanswered");
    expect((await attempt(rig, agents, "I look out at the harbor.")).halted).toBe(false);
  });
});
