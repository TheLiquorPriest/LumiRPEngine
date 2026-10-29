// Increment 2's secrecy review (H1, H2, L1, L2), on scripted models: what an agent turn's roles write
// reaches the player and the narrator only as classic's own lines would. The director's brief and
// outline read as the player character, whatever the director reads with (H1); the scene role's notes
// are held to the narrator's knowledge and to the screens Minds lines get (H2); the pins manifest is
// the GM tier's to change (L1); and the review card names no workspace file below the GM (L2).

import { describe, expect, test } from "bun:test";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { AgentOp, ApplyResult } from "../../src/backend/agents/tools/writer";
import type { QuietRequest } from "../../src/backend/host";
import { markWording, renderPrompt } from "../../src/backend/prompts";
import { outputsOf } from "../../src/engine/outputs";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import { ROLES_TEXT } from "../../src/shared/role-prompts";
import { secretMarkText } from "../../src/shared/secret-marks";
import type { QuietScript } from "../support/fake-host";
import { alderChat, DANNY, PRIYA, type Put, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const MEMORY_MARK = "You keep the memory of";
const BRIEF_MARK = "You brief a roleplay narrator";
/** Someone the player character can't see (`known_by`, known to no one), in the room with them. */
const VIKTOR = "viktor_crane";
const HIDING = "Viktor Crane is hiding in the closet.";
const KETTLE = "SCENE-NOTE the kettle is still warm.";

/** Each role's agent answers by `answers` (its role's own, by name), the rest as a turn that changes nothing. */
function scripted(rig: Rig, answers: Readonly<Record<string, (req: QuietRequest, all: string) => QuietScript>> = {}): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const head = req.messages[0]?.content ?? "";
    const all = req.messages.map((m) => m.content).join("\n");
    const role = /You are the ([\w-]+) agent of LumiRPEngine/.exec(head)?.[1] ?? null;
    const own = role !== null ? answers[role] : undefined;
    if (own) return own(req, all);
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (all.includes(MEMORY_MARK)) return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });
    return JSON.stringify({ proposals: [] });
  };
}

/** Port Alder on agents, with Danny and Priya beside the player character and the world edited by `setup` first; no person's choice is asked, and the chat tracks no knowledge. */
async function agentChat(rig: Rig, setup: (put: Put) => Promise<void> = async () => {}, people: readonly string[] = [DANNY, PRIYA]): Promise<string> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { "npc.choose": { enabled: false } } } } }));
  const chatId = await alderChat(rig, (put) => setup(put), people);
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents", knowledge: false }));
  return chatId;
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Plays `text` with `reply`: the narrator's Scene section as delivered, and the turn's record. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<{ scene: string; rec: Rec }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  const scene = rig.host.section("Scene");
  await rig.host.finish(g, reply);
  return { scene, rec: await lastRecord(rig, chatId) };
}

/** The scene role, replaced: it stages `ops` through its writer, then answers as classic's scene does (nothing). */
function sceneStages(rig: Rig, ops: readonly AgentOp[]): ApplyResult[] {
  const seen: ApplyResult[] = [];
  const classic = classicRoles();
  rig.rt.orchestrator.roles = {
    ...rig.rt.orchestrator.roles,
    scene: async (task, ctx) => {
      seen.push(await ctx.writer.apply(ops, "the scene's change"));
      return classic.scene(task, ctx);
    },
  };
  return seen;
}

describe("the director's brief and outline", () => {
  test("read as the player character whatever the director reads with: a mind its tools could show everyone never reaches the brief (H1)", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { brief: { enabled: true, signals: ["always"] } } } } }));
    const chatId = await agentChat(rig);
    const { state, world } = await stateOf(rig, chatId);
    const pov = state.entities[world.pov]?.name ?? world.pov;
    const heads: string[] = [];
    const results: string[] = [];
    scripted(rig, {
      minds: (_req, all) => {
        const who = /You are the private mind of (.+?) in the roleplay world/.exec(all)?.[1] ?? "someone";
        return JSON.stringify({ monologue: `${who} thinks.`, depiction: `${who} looks up`, intent: "INTENT-MARK keep the debt quiet", reactions: [], mood: "tense" });
      },
      director: (req, all) => {
        if (!all.includes(BRIEF_MARK)) return "{}";
        heads.push(req.messages[0]?.content ?? "");
        // Its first call reads Danny's mind; once the tool has answered, it briefs from what it was shown.
        const answered = req.messages.findLastIndex((m) => m.role === "assistant");
        if (answered < 0) return { content: "", toolCalls: [{ name: "minds_read", args: { person: "Danny Okafor" }, callId: "c1" }] };
        const shown = req.messages.slice(answered + 1).map((m) => m.content).join("\n");
        results.push(shown);
        return JSON.stringify({ brief: shown.includes("INTENT-MARK") ? "BRIEF-MARK Danny means to INTENT-MARK keep the debt quiet." : "BRIEF-MARK Danny looks up from the boat.", beats: [] });
      },
    });
    await played(rig, chatId, "Morning, Danny.", "Danny nods.");
    const { rec } = await played(rig, chatId, "How's the boat, Danny?", "Danny shrugs.");
    // The director reads Danny's mind as the player character may: never.
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.every((h) => h.includes(renderPrompt(ROLES_TEXT.sees.pov, {}, { world: world.name, pov })))).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.includes("INTENT-MARK"))).toBe(false);
    const brief = outputsOf(rec.events)?.brief ?? "";
    expect(brief).toContain("BRIEF-MARK");
    expect(brief).not.toContain("INTENT-MARK");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the scene role's notes", () => {
  const hiding = (put: Put): Promise<void> => put("entities", VIKTOR, { id: VIKTOR, kind: "person", name: "Viktor Crane", tier: "supporting", visibility: "known_by", fields: {}, relations: [] });
  const notes = { scene: () => JSON.stringify({ lore: [], notes: [HIDING, KETTLE] }) };

  test("under the narrator's \"your character's knowledge\" with secrets left out, none written with everyone's knowledge goes in, nor one naming someone the player character can't see (H2)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, hiding, [DANNY, PRIYA, VIKTOR]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { narrator: { knowledge: "pov", secrets: "omit" } } }));
    scripted(rig, notes);
    const { scene } = await played(rig, chatId, "I look around the kitchen.", "The kitchen is quiet.");
    expect(scene).not.toContain("Viktor");
    expect(scene).not.toContain("SCENE-NOTE");
    // A scene reading as the player character tells what they may know; the hidden name still never goes in.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { knowledge: "pov" } } } } }));
    const pov = await played(rig, chatId, "I look around again.", "Still quiet.");
    expect(pov.scene).toContain(KETTLE);
    expect(pov.scene).not.toContain("Viktor");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("under the narrator's default knowledge, with secrets marked, a note naming someone hidden goes in marked as a secret kept from the player character, and one beyond them marked so (H2)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, hiding, [DANNY, PRIYA, VIKTOR]);
    const { state, world } = await stateOf(rig, chatId);
    const pov = state.entities[world.pov]?.name ?? world.pov;
    scripted(rig, notes);
    const { scene } = await played(rig, chatId, "I look around the kitchen.", "The kitchen is quiet.");
    expect(scene).toContain(secretMarkText(HIDING, [], [pov], markWording({})));
    expect(scene.split("\n").some((line) => line.includes(HIDING) && line.trim().replace(/^- /, "") === HIDING)).toBe(false);
    expect(scene).toContain(`${KETTLE} [unknown to you; known to others here]`);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the pins manifest", () => {
  test("is the GM tier's to write: a story-tier role is refused, a GM-tier role stages it (L1)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig);
    scripted(rig);
    const seen = sceneStages(rig, [{ kind: "ws_write", path: ".pins.json", text: JSON.stringify({ main: { tokens: 0 } }) }]);
    await played(rig, chatId, "I stretch.", "You stretch.");
    expect(seen[0]?.applied).toEqual([]);
    expect(seen[0]?.refused.map((r) => r.code)).toEqual(["not_granted"]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { scene: { tier: "gm" } } } } }));
    await played(rig, chatId, "I yawn.", "You yawn.");
    expect(seen[1]?.refused).toEqual([]);
    expect(seen[1]?.applied.length).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the review card", () => {
  test("words a workspace change as the player reads it, naming no file (L2)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { workspace: { mode: "confirm" } } } }));
    scripted(rig);
    sceneStages(rig, [{ kind: "ws_write", path: "notes/viktor-plans.md", text: "WS-MARK the plan." }]);
    await played(rig, chatId, "I stretch.", "You stretch.");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as JsonObject[];
    const text = JSON.stringify(cards);
    expect(cards.length).toBeGreaterThan(0);
    expect(text).not.toContain("viktor-plans");
    expect(text).toContain(renderPrompt(WRITE_NOTE.workspaceLine, {}, {}));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
