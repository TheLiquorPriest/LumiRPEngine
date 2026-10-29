// The main agent's secrecy (Increment 2 reviews: secrecy M1-M3, integration M2 and L7, correctness
// M6). Its words reach each task of a role held to that task's own knowledge, whatever the main agent
// reads with; another role's run inside the role's gets none of them. Its session keeps the knowledge
// each message was made under and the workspace files its tools read, and a turn reads only what its
// knowledge, and those files' readers, take in now; only that is counted and compacted. Models are
// scripted; roles run prompt-only unless a test captures what a task is told.

import { describe, expect, test } from "bun:test";
import { screenBrief } from "../../src/backend/agents/brief";
import { emptyUsage } from "../../src/backend/agents/usage";
import { historyOf, knowledgeLens, sessionTokens } from "../../src/backend/agents/compaction";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import { roleCtx } from "../../src/backend/agents/roles/agent";
import type { TurnAgentCtx } from "../../src/backend/agents/turn-ctx";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { playerKnows, povMayKnow } from "../../src/engine/player-events";
import { kindIs, placeOfEntity } from "../../src/engine/scope";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { QuietScript } from "../support/fake-host";
import { DANNY, stateOf } from "../support/mind-chat";
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

async function mainChat(rig: Rig, knowledge: "pov" | "everyone" | "gm" = "everyone"): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY, main: { knowledge } } } }));
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

describe("the main agent's words for a task (secrecy M1, M2)", () => {
  test("a player-character task gets no line naming someone the player character doesn't know of, also while the main agent reads as the player character", async () => {
    const rig = new Rig({ shipped: true });
    for (const knowledge of ["everyone", "pov"] as const) {
      const chatId = await mainChat(rig, knowledge);
      const who = await stranger(rig, chatId);
      const told: string[] = [];
      const roles = classicRoles();
      rig.rt.orchestrator.roles = { ...roles, intent: { ...roles.intent, interpret: (task, ctx) => (told.push(ctx.brief?.for("pov") ?? ""), roles.intent.interpret(task, ctx)) } };
      const asked = models(rig, { task: `Read the harbor look.\n${who} is watching from the alley.` });
      await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
      expect(told[0]).toContain("Read the harbor look.");
      expect(told[0]).not.toContain(who);
      // The run's answer, with the note, reaches the main agent in its next stage (it committed beside the call).
      expect(asked.some((req) => sentOf(req).includes("wasn't sent to the intent role"))).toBe(true);
    }
  });

  test("a decision reads its chooser's own knowledge, prose and choices the player character's; another role's run inside a role's gets none of the words", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    const { world, state } = await stateOf(rig, chatId);
    const head = { world, state };
    const unmet = Object.entries(state.entities).find(([id, e]) => id !== DANNY && kindIs(rig.rt.registry, world, e.kind, "person") && !playerKnows(rig.rt.registry, world, state, DANNY, id))?.[1].name;
    const text = `Keep it short.\n${unmet} hid the ledger in the cellar.`;
    expect(screenBrief(rig.rt.registry, head, text, "everyone")).toEqual({ text, withheld: false });
    expect(screenBrief(rig.rt.registry, head, text, { own: DANNY })).toEqual({ text: "Keep it short.", withheld: true });
    expect(screenBrief(rig.rt.registry, head, text, { own: null })).toEqual({ text: "", withheld: true });
    // The skip's minds at its beats, or a decision's knowledge step, run as another role: none of the words.
    const ctx = { role: "skip", agentId: "skip:1", userId: rig.host.userId, brief: { for: () => text } } as unknown as TurnAgentCtx;
    expect((await roleCtx(rig.rt, ctx, "minds")).brief).toBeNull();
  });
});

describe("the main session as its knowledge reads it (secrecy M3, integration M2)", () => {
  test("narrowed, the main agent no longer reads what it said under wider knowledge; widened again, it does", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig, "everyone");
    let says = "NOTE-WIDE about the harbor.";
    const asked = models(rig, { says: () => says });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    says = "";
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { main: { knowledge: "pov" } } } }));
    const narrowed = asked.length;
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(sentOf(asked[narrowed] as QuietRequest)).not.toContain("NOTE-WIDE");
    // With nothing of its own it reads, its turn task is the chat so far.
    expect(sentOf(asked[narrowed] as QuietRequest)).toContain("You take this chat up now");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { main: { knowledge: "everyone" } } } }));
    const widened = asked.length;
    await played(rig, chatId, "I sit down.", "You sit.");
    expect(sentOf(asked[widened] as QuietRequest)).toContain("NOTE-WIDE");
  });

  test("a workspace note it read drops from its session once the note's readers no longer take its knowledge in", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig, "everyone");
    const path = "notes/harbor.md";
    rig.body(await rig.send({ type: "lre.workspace", chatId, op: "write", path, text: "HARBOR-NOTE: the boat leaves at dawn.", readers: "everyone" }));
    const asked = models(rig, { script: (req, n) => (n === 0 && resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_read", { path }, "read")] } : undefined) });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    rig.body(await rig.send({ type: "lre.workspace", chatId, op: "write", path, text: "HARBOR-NOTE: the boat leaves at dawn.", readers: "gm" }));
    const next = asked.length;
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(sentOf(asked[next] as QuietRequest)).not.toContain("HARBOR-NOTE");
  });

  test("a session kept before knowledge was stored reads as the GM's, and a fixed pipeline's digest segments are neither read nor counted", () => {
    const old = { summary: "OLD-SUMMARY", summaryKnowledge: "gm" as const, segments: [{ hash: "a", messages: [{ role: "user", content: "OLD-TASK", by: "main" }] }, { hash: "b", messages: [{ role: "assistant", content: "A fixed pipeline's reply." }] }] };
    expect(historyOf(old, {}, knowledgeLens("everyone"))).toEqual([]);
    expect(sessionTokens(old, knowledgeLens("everyone"))).toBe(0);
    expect(historyOf(old, {}, knowledgeLens("gm")).map((m) => m.text).join("\n")).toContain("OLD-TASK");
    expect(historyOf(old, {}, knowledgeLens("gm")).map((m) => m.text).join("\n")).not.toContain("fixed pipeline's reply");
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
    // At the decisions' stage the main agent runs the director, runs it again once it failed, revises the run that answered, then commits.
    let step = 0;
    models(rig, {
      script: (req, n) => {
        if (!/^- director:/m.test(stageOf(req)) || step >= 3) return undefined;
        step++;
        if (step === 1) return { content: "", toolCalls: [call("run_role", { role: "director", task: "Decide." }, `c${n}_d`)] };
        if (step === 2) return { content: "", toolCalls: [call("run_role", { role: "director", task: "Decide again." }, `c${n}_d`)] };
        return { content: "", toolCalls: [call("revise", { agentId: /director:[\w-]+:\d+/.exec(resultsOf(req).join("\n"))?.[0] ?? "", message: "Weigh it once more." }, `c${n}_r`)] };
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
