// The drawer's live trace (AGENT-LOOP-PLAN §9; INC2-SPEC lane T4): while an agent turn runs, the
// activity line it pushes (`lre.activity`) carries one row per role at work, its label and the tokens
// all its agents have spent this turn, and nothing else: never a row per agent (whose count would tell
// how many people a role works for, off-screen or unseen ones too), a tool's name or arguments, nor a
// task the main agent wrote. A role's row goes once none of its agents works, and every row with the turn.
// Cancel on a row is the line's own `lre.cancel`. The models are scripted, as in the main agent's tests.

import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { ROLE_IDS, ROLE_LABEL } from "../../src/shared/agent-roles";
import { AGENT_ROLES, agentLabel, MAIN_AGENT_ROLE } from "../../src/shared/agent-settings";
import type { Activity } from "../../src/shared/diagnostics";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
/** Words a main agent's task holds that only the GM may read. */
const SECRET = "Marcus wrote the anonymous letters";

const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const isMain = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "run_role");
const stageOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";

/** The main agent runs each role its stage asks for, with a task naming the secret, and commits; each of its calls reports usage. */
function models(rig: Rig): void {
  let n = 0;
  rig.host.quietReply = (req) => {
    if (isMain(req)) {
      n += 1;
      const roles = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      return { content: "", toolCalls: [...roles.map((role) => call("run_role", { role, task: `${SECRET}: work ${role}` }, `c${n}_${role}`)), call("commit", {}, `c${n}_commit`)], usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 } };
    }
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
}

async function mainChat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY } } }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  return chatId;
}

/** Every activity line pushed for the chat so far. */
function lines(rig: Rig, chatId: string): Activity[] {
  return rig.host.sent.flatMap((m) => (m.type === "lre.activity" && m.chatId === chatId && m.activity ? [m.activity] : []));
}

describe("the live trace", () => {
  test("an agent turn's line carries a row per role at work, its label and tokens so far, and none of what it calls; the rows go with the turn", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    models(rig);
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Gulls wheel over the water.");
    await rig.host.settle();

    const traced = lines(rig, chatId).filter((a) => a.agents !== undefined);
    expect(traced.length).toBeGreaterThan(0);
    const rows = traced.flatMap((a) => a.agents ?? []);
    // Each row holds its role, its label and its tokens, and nothing else; never two rows for one role.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["id", "label", "tokens"]);
      expect(Object.keys(row.tokens).sort()).toEqual(["in", "out"]);
      expect(row.label).toBe(agentLabel(row.id));
    }
    for (const line of traced) expect(new Set((line.agents ?? []).map((r) => r.id)).size).toBe(line.agents?.length ?? 0);
    // The main agent's row, its tokens growing as its calls report them.
    const main = rows.filter((r) => r.label === agentLabel(MAIN_AGENT_ROLE));
    expect(main.length).toBeGreaterThan(0);
    expect(main[0]?.tokens).toEqual({ in: 0, out: 0 });
    expect(main.some((r) => r.tokens.in >= 1200 && r.tokens.out >= 40)).toBe(true);
    // A row is only ever a role's, the assistant's or the main agent's label.
    const known = new Set([...ROLE_IDS.map((id) => ROLE_LABEL[id]), ...AGENT_ROLES.map((r) => r.label)]);
    for (const row of rows) expect(known.has(row.label)).toBe(true);
    // Nothing the main agent called or wrote reaches any line the chat was pushed.
    for (const line of lines(rig, chatId)) {
      const text = JSON.stringify(line);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("run_role");
    }
    // The turn over, no row stands.
    expect(rig.rt.diag.activityOf(chatId)?.agents).toBeUndefined();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("one row per role at work, holding all its agents' tokens this turn: one stopping changes nothing its count could tell; the row goes when the last stops (L3)", () => {
    const rig = new Rig();
    const chatId = "chat-trace";
    const user = rig.host.userId;
    const at = { chatId, userId: user, turn: "m1:0" };
    rig.rt.diag.begin(at);
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_a", role: "intent" }, { in: 0, out: 0 });
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_b", role: "director" }, { in: 300, out: 12 });
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_c", role: "director" }, { in: 200, out: 8 });
    expect(rig.rt.diag.activityOf(chatId)?.agents).toEqual([
      { id: "intent", label: ROLE_LABEL.intent, tokens: { in: 0, out: 0 } },
      { id: "director", label: ROLE_LABEL.director, tokens: { in: 500, out: 20 } },
    ]);
    // One chooser's agent done: the director's row keeps what it spent.
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_b", role: "director" }, null);
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_a", role: "intent" }, { in: 900, out: 30 });
    const both = [
      { id: "intent", label: ROLE_LABEL.intent, tokens: { in: 900, out: 30 } },
      { id: "director", label: ROLE_LABEL.director, tokens: { in: 500, out: 20 } },
    ];
    expect(rig.rt.diag.activityOf(chatId)?.agents).toEqual(both);
    // The last one done: the row goes; the role's next agent this turn shows what all of them spent.
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_c", role: "director" }, null);
    expect(rig.rt.diag.activityOf(chatId)?.agents).toEqual([both[0]]);
    rig.rt.diag.agentAtWork(chatId, user, { id: "agent_d", role: "director" }, { in: 100, out: 4 });
    expect(rig.rt.diag.activityOf(chatId)?.agents).toEqual([both[0], { id: "director", label: ROLE_LABEL.director, tokens: { in: 600, out: 24 } }]);
    // The last pushed line says the same.
    expect(lines(rig, chatId).at(-1)?.agents).toEqual(rig.rt.diag.activityOf(chatId)?.agents);
    rig.rt.diag.end(at);
    expect(rig.rt.diag.activityOf(chatId)).toBeNull();
  });
});
