// The main agent's secrecy is guidance (DESIGN §4.5, §7.1), and correctness M6. Its words reach each
// task of a role whole, a name the player character doesn't know of too; another role's run inside a
// role's gets none of them. Its session is read whole: its summary and every message of its own, a
// session kept before knowledge was stored too. Models are scripted; roles run prompt-only unless a
// test captures what a task is told.

import { describe, expect, test } from "bun:test";
import { emptyUsage } from "../../src/backend/agents/usage";
import { historyOf, sessionTokens } from "../../src/backend/agents/compaction";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import { roleCtx } from "../../src/backend/agents/roles/agent";
import type { TurnAgentCtx } from "../../src/backend/agents/turn-ctx";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { povMayKnow } from "../../src/engine/player-events";
import { kindIs, placeOfEntity } from "../../src/engine/scope";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { QuietScript } from "../support/fake-host";
import { stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const INTERPRET_MARK = "You map a player's typed input";
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));
const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const isMain = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "run_role");
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
const stageOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");

/** The main agent runs every role its stage asks for with `task`, saying `says`, then commits, unless `script` answers first; the roles' classic calls read nothing. */
function models(rig: Rig, opts: { task?: string; says?: () => string; script?: (req: QuietRequest, n: number) => QuietScript | undefined } = {}): QuietRequest[] {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req) => {
    if (!isMain(req)) return (req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : "{}";
    asked.push(req);
    const n = asked.length - 1;
    const own = opts.script?.(req, n);
    if (own !== undefined) return own;
    const roles = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
    return { content: opts.says?.() ?? "", toolCalls: [...roles.map((role) => call("run_role", { role, task: opts.task ?? "Go on." }, `c${n}_${role}`)), call("commit", {}, `c${n}_commit`)] };
  };
  return asked;
}

async function mainChat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY } } }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  return chatId;
}

async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<void> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  await rig.host.finish(g, reply);
}

/** Someone the player character doesn't know of, spawned by name at a place in Port Alder away from them. */
async function stranger(rig: Rig, chatId: string): Promise<string> {
  const before = await stateOf(rig, chatId);
  const here = placeOfEntity(before.state, before.world.pov);
  const away = Object.keys(before.world.places).find((p) => p !== here);
  if (!here || !away) throw new Error("no place away from the player character");
  const name = "Ossian Vell";
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "spawn", kind: "person", name, place: away }] }));
  const { world, state } = await stateOf(rig, chatId);
  const found = Object.entries(state.entities).find(([, e]) => e.name === name);
  if (!found || !kindIs(rig.rt.registry, world, found[1].kind, "person") || povMayKnow(rig.rt.registry, world, state, found[0])) throw new Error("the stranger is known");
  return name;
}

describe("the main agent's words for a task", () => {
  test("a player-character task gets its words whole, a name the player character doesn't know of too, and nothing is said to be held back", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    const who = await stranger(rig, chatId);
    const told: string[] = [];
    const roles = classicRoles();
    rig.rt.orchestrator.roles = { ...roles, intent: { ...roles.intent, interpret: (task, ctx) => (told.push(ctx.brief ?? ""), roles.intent.interpret(task, ctx)) } };
    const asked = models(rig, { task: `Read the harbor look.\n${who} is watching from the alley.` });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(told[0]).toContain("Read the harbor look.");
    expect(told[0]).toContain(who);
    expect(asked.some((req) => sentOf(req).includes("wasn't sent to the intent role"))).toBe(false);
  });

  test("another role's run inside a role's gets none of the words", async () => {
    const rig = new Rig({ shipped: true });
    await mainChat(rig);
    // The skip's minds at its beats, or a decision's knowledge step, run as another role.
    const ctx = { role: "skip", agentId: "skip:1", userId: rig.host.userId, brief: "Keep it short." } as unknown as TurnAgentCtx;
    expect((await roleCtx(rig.rt, ctx, "minds")).brief).toBeNull();
  });
});

describe("the main session, read whole", () => {
  test("a session kept before knowledge was stored is read whole, and a fixed pipeline's digest segments are neither read nor counted", () => {
    const old = { summary: "OLD-SUMMARY", summaryKnowledge: "gm" as const, segments: [{ hash: "a", messages: [{ role: "user", content: "OLD-TASK", by: "main" }] }, { hash: "b", messages: [{ role: "assistant", content: "A fixed pipeline's reply." }] }] };
    const read = historyOf(old, {}).map((m) => m.text).join("\n");
    expect(read).toContain("OLD-SUMMARY");
    expect(read).toContain("OLD-TASK");
    expect(read).not.toContain("fixed pipeline's reply");
    expect(sessionTokens(old)).toBeGreaterThan(0);
  });
});

describe("a decision the main agent runs again (correctness M6)", () => {
  test("a re-run and a revised decision hand the turn the learnings of the run that stands, once", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "standard" } } }));
    // Dev is at home with the player character and has a choice to make: the turn asks the director for decisions here.
    const worldId = await rig.newWorld("Calls");
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
    for (const [id, fields] of [["dev", { place: "home", tie: true }], ["sam", { place: "home" }]] as const) {
      const e = draft.entities[id];
      if (!e) throw new Error(`no ${id}`);
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value: { ...e, fields: { ...e.fields, ...fields } } }));
    }
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY } } }));
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    // Each run of the decisions has its chooser learn something of its own first, as the knowledge step before the plan does; the first run fails.
    let runs = 0;
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      director: {
        ...roles.director,
        decisions: async (task) => {
          const n = ++runs;
          const [from, to] = n === 1 ? ["dev", POV] : n === 2 ? [POV, "dev"] : ["dev", "home"];
          task.heard?.learned([{ type: "link", rel: "knows", from, to }]);
          return n === 1 ? { ok: false, code: "contract", reason: "the scripted first run fails", usage: emptyUsage() } : { ok: true, out: null, usage: emptyUsage(), via: "prompt_only" };
        },
      },
    };
    // At the decisions' stage the main agent runs the director, runs it again once it failed, revises
    // the run that answered, then commits: a run_role now would be a fresh run (Fresh runs per
    // request), replacing the revised one.
    let step = 0;
    models(rig, {
      script: (req, n) => {
        if (!/^- director:/m.test(stageOf(req)) || step >= 4) return undefined;
        step++;
        if (step === 1) return { content: "", toolCalls: [call("run_role", { role: "director", task: "Decide." }, `c${n}_d`)] };
        if (step === 2) return { content: "", toolCalls: [call("run_role", { role: "director", task: "Decide again." }, `c${n}_d`)] };
        if (step === 3) return { content: "", toolCalls: [call("revise", { agentId: /director:[\w-]+:\d+/.exec(resultsOf(req).join("\n"))?.[0] ?? "", message: "Weigh it once more." }, `c${n}_r`)] };
        return { content: "", toolCalls: [call("commit", {}, `c${n}_c`)] };
      },
    });
    rig.host.sendUser(chatId, "I walk to the ferry and wait.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The ferry horn sounds.");
    expect(runs).toBe(3);
    // Only the revised run's learning reaches the turn's record, once; the failed run's and the one the revision replaced don't.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
    const links = (rec?.events ?? []).flatMap((e) => (e.type === "link" && e.rel === "knows" ? [`${e.from}>${e.to}`] : []));
    expect(links.filter((l) => [`dev>${POV}`, `${POV}>dev`, "dev>home"].includes(l))).toEqual(["dev>home"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
