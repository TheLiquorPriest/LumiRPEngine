// What an agent turn's roles write, against the user's settings (Increment 2's correctness review, M4
// and M5): a role on its default connection learns its change types where the review card counts
// them, so per-source learning flips its mode; and GM edits per turn caps the whole turn, every phase
// together, not each phase on its own.

import { describe, expect, test } from "bun:test";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { AgentOp, ApplyResult } from "../../src/backend/agents/tools/writer";
import type { QuietRequest } from "../../src/backend/host";
import { recordOutcome } from "../../src/backend/settings-store";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { ReviewCardView } from "../../src/shared/protocol";
import { stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const PROMPT_ONLY = { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } };
/** Port Alder's player character's cash on hand. */
const CASH = "acct_pov_cash";
/** Money out of the player character's cash, as the GM's money edit takes it. */
const spend = (cents: number): AgentOp => ({ kind: "gm_edit", op: { op: "adjust", account: CASH, cents: -cents } });

/** Port Alder on agents, every role prompt-only and `patch` set, with cash to spend; every model call reads nothing. */
async function agentChat(rig: Rig, patch: JsonObject): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
  rig.body(await rig.send({ type: "lre.settings.set", patch }));
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : JSON.stringify({ proposals: [] }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CASH, cents: 5000 }] }));
  return chatId;
}

/** Plays a turn; how much cash it spent. */
async function spent(rig: Rig, chatId: string): Promise<number> {
  const before = (await stateOf(rig, chatId)).state.accounts[CASH] ?? 0;
  rig.host.sendUser(chatId, "I check my wallet.");
  await rig.host.settle();
  await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "You count your cash.");
  return before - ((await stateOf(rig, chatId)).state.accounts[CASH] ?? 0);
}

describe("an agent turn's writes", () => {
  test("a role on its default connection learns where the review card counts it: once its money adjustments are learned Auto, the next lands without the card (M4)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, { agents: { roles: { scene: { tier: "gm" } } } });
    const user = rig.host.userId;
    // Thirty Applies of the scene role's money adjustments, counted as the review card counts them: the item's connection, else the default one.
    const settings = await rig.rt.settings.get(user);
    const learning = await rig.rt.settings.learningOf(user);
    const active = await rig.rt.activeConnectionId(user);
    for (let i = 0; i < 30; i++) recordOutcome(settings, learning, active, "money_adjust", "accepted", Date.now(), "scene");
    await rig.rt.settings.saveLearning(user);
    const classic = classicRoles();
    rig.rt.orchestrator.roles = {
      ...rig.rt.orchestrator.roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([spend(100)], "the scene's change");
        return classic.scene(task, ctx);
      },
    };
    expect(await spent(rig, chatId)).toBe(100);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect(cards.flatMap((c) => c.items)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("GM edits per turn caps the whole turn: with a cap of 1, an edit staged after the plan or the reply, once one landed before it, is refused (M5)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, { agents: { gmOpsPerTurn: 1, roles: { scene: { tier: "gm" }, director: { tier: "gm" }, read: { tier: "gm" } } }, extraction: { money_adjust: { mode: "auto" } } });
    const seen: Record<string, ApplyResult> = {};
    const classic = classicRoles();
    rig.rt.orchestrator.roles = {
      ...rig.rt.orchestrator.roles,
      scene: async (task, ctx) => {
        seen.scene = await ctx.writer.apply([spend(100)], "the scene's change");
        return classic.scene(task, ctx);
      },
      director: {
        ...classic.director,
        prose: async (task, ctx) => {
          seen.director = await ctx.writer.apply([spend(101)], "the director's change");
          return classic.director.prose(task, ctx);
        },
      },
      read: {
        extract: async (task, ctx) => {
          seen.read = await ctx.writer.apply([spend(102)], "the read's change");
          return classic.read.extract(task, ctx);
        },
      },
    };
    expect(await spent(rig, chatId)).toBe(100);
    expect(Object.fromEntries(Object.entries(seen).map(([role, r]) => [role, { applied: r.applied.length, refused: r.refused.map((x) => x.code) }]))).toEqual({
      scene: { applied: 1, refused: [] },
      director: { applied: 0, refused: ["gm_cap"] },
      read: { applied: 0, refused: ["gm_cap"] },
    });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
