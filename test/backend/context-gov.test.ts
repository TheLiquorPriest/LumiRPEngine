// Context governance (NEXT-AFTER-Q1 "DECIDED", batch S; DESIGN §4.4-§4.6, §7.1), on Port Alder with
// scripted models: Settings → Agents → Context steers what each role starts with (its sections and
// pinned files) and tells the main agent, the governor of every role's context, the same config; a
// role's perspective is a hint, never a screen, so the turn's readers read the GM's data with every
// secret marked; the director starts with Minds and the scene notes; a director's line that
// contradicts the state is flagged and kept; and the default turn budget never refuses a role.

import { describe, expect, test } from "bun:test";
import { CHARS_PER_TOKEN } from "../../src/backend/book";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { ROLE_IDS, ROLE_LABEL } from "../../src/shared/agent-roles";
import { defaultContextSettings } from "../../src/shared/agent-context";
import type { JsonObject } from "../../src/shared/json";
import { MINDS_SLOT } from "../../src/shared/minds";
import { holdsSecretMark } from "../../src/shared/secret-marks";
import type { QuietScript } from "../support/fake-host";
import { alderChat, DANNY, PRIYA, type Put } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const MEMORY_MARK = "You keep the memory of";
const MAIN_MARK = "run_role";
/** How a role's message leads the sections it starts with, as shipped (`role.context`). */
const CONTEXT_LEAD = "What the narrator would be told now, in the engine's sections";
/** How the Scene and the Minds sections lead, as shipped. */
const SCENE_LEAD = "Where the player character is now, when, and what they can perceive there";
const MINDS_LEAD = "Each mind below is scoped to what that character knows";
/** Someone the player character can't see (`known_by`, known to no one), in the room with them. */
const VIKTOR = "viktor_crane";
const TRUTH = "TRUTH-MARK the old boat was sunk on purpose";
/** The brief and the outline on, with calls enough before the reply for both. */
const PROSE: JsonObject = { modelUse: { steps: { brief: { enabled: true, signals: ["always"] }, outline: { enabled: true, signals: ["always"] } }, budgets: { pre: { calls: 8 } } } };

/** A call as the scripted models saw it: the role whose agent made it (null for any other call), its first message and the rest. */
interface Seen {
  role: string | null;
  head: string;
  rest: string;
  req: QuietRequest;
}

/** Each role's agent answers by `answers` (its role's own, by name), the rest as a turn that changes nothing. */
function scripted(rig: Rig, answers: Readonly<Record<string, (req: QuietRequest) => QuietScript>> = {}): Seen[] {
  const seen: Seen[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const head = req.messages[0]?.content ?? "";
    const rest = req.messages.slice(1).map((m) => m.content).join("\n");
    const role = /You are the ([\w-]+) agent of LumiRPEngine/.exec(head)?.[1] ?? null;
    seen.push({ role, head, rest, req });
    const own = role !== null ? answers[role] : undefined;
    if (own) return own(req);
    const all = `${head}\n${rest}`;
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (role === "minds") return JSON.stringify({ monologue: "thinks.", depiction: "DEPICTION-MARK looks up from the counter", intent: "INTENT-MARK keep the debt quiet", reactions: [], mood: "tense" });
    if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (all.includes(MEMORY_MARK)) return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });
    return JSON.stringify({ proposals: [] });
  };
  return seen;
}

/** A role's agent that calls `calls` first, then answers `answer` once the tools have answered; what the tools gave back lands in `results`. */
function toolsThen(calls: readonly QuietToolCall[], answer: string, results: string[]): (req: QuietRequest) => QuietScript {
  return (req) => {
    const last = req.messages.at(-1);
    const back = (last?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
    if (back.length === 0 && !req.messages.some((m) => m.role === "assistant")) return { content: "", toolCalls: [...calls] };
    results.push(...back);
    return answer;
  };
}

/** Port Alder on agents, the roles agent-backed (§15's default), with Danny and Priya beside the player character, the world edited by `setup` first; `patch` joins the settings. */
async function agentChat(rig: Rig, patch: JsonObject = {}, setup: (put: Put) => Promise<void> = async () => {}, people: readonly string[] = [DANNY, PRIYA]): Promise<string> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { "npc.choose": { enabled: false } } } } }));
  const chatId = await alderChat(rig, (put) => setup(put), people);
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents", knowledge: false })).engine).toBe("agents");
  return chatId;
}

/** Plays `text` with `reply`: everything the narrator was told. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<string> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  const told = rig.host.assembled.map((e) => e.content).join("\n");
  await rig.host.finish(g, reply);
  return told;
}

describe("a role's prompt, as Settings → Agents → Context sets it", () => {
  test("carries the sections its config starts it with and the files it pins, whatever the role", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const roles = Object.fromEntries(ROLE_IDS.map((id) => [id, { start: ["scene"], pins: ["notes/context.md"] }]));
    const chatId = await agentChat(rig, { agents: { context: { roles } } });
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: "notes/context.md", text: "CONTEXT-PIN-MARK: the ferry is late on Sundays.", readers: "everyone" }));
    const seen = scripted(rig);
    await played(rig, chatId, "I look around the shop.", "The shop is quiet.");
    const ran = [...new Set(seen.flatMap((s) => (s.role === null ? [] : [s.role])))];
    for (const role of ["intent", "scene", "read", "minds"]) expect(ran).toContain(role);
    for (const s of seen.filter((x) => x.role !== null)) {
      expect(s.head).toContain("[notes/context.md]\nCONTEXT-PIN-MARK: the ferry is late on Sundays.");
      expect(s.rest).toContain(CONTEXT_LEAD);
      expect(s.rest).toContain(SCENE_LEAD);
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the director's, by default, starts with the Minds and the Scene, the scene role's notes in it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await agentChat(rig, PROSE);
    expect(defaultContextSettings().roles.director.start).toEqual(["scene", MINDS_SLOT]);
    const seen = scripted(rig, {
      scene: () => JSON.stringify({ lore: [], notes: ["SCENE-NOTE-MARK the kettle is still warm."] }),
      director: () => JSON.stringify({ brief: "BRIEF-OK The harbor is grey.", beats: ["OUTLINE-OK Jordan looks out at the harbor."] }),
    });
    // The first turn's minds are what the second turn's Minds section tells.
    await played(rig, chatId, "Morning, Danny.", "Danny nods.");
    seen.length = 0;
    await played(rig, chatId, "How's the boat, Danny?", "Danny shrugs.");
    const director = seen.filter((s) => s.role === "director");
    expect(director.length).toBeGreaterThan(0);
    for (const s of director) {
      expect(s.rest).toContain(MINDS_LEAD);
      expect(s.rest).toContain("DEPICTION-MARK");
      expect(s.rest).toContain(SCENE_LEAD);
      expect(s.rest).toContain("SCENE-NOTE-MARK the kettle is still warm.");
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the main agent's stable prefix tells it every role's context config", async () => {
    const rig = new Rig({ shipped: true });
    const prompt = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));
    const chatId = await agentChat(rig, { agents: { pipeline: { mode: "main" }, roles: prompt, context: { roles: { director: { pins: ["notes/director-guide.md"] } } } } });
    const asked: QuietRequest[] = [];
    scripted(rig);
    const own = rig.host.quietReply;
    if (!own) throw new Error("no scripted models");
    // The main agent runs every role its stage asks for, then commits.
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.tools ?? []).some((t) => t.name === MAIN_MARK)) return own(req);
      asked.push(req);
      const stage = req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
      const roles = [...new Set([...stage.matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      const n = asked.length;
      return { content: "", toolCalls: [...roles.map((role) => ({ name: "run_role", args: { role, task: `task for ${role}` }, callId: `c${n}_${role}` })), { name: "commit", args: {}, callId: `c${n}_commit` }] };
    };
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(asked.length).toBeGreaterThan(0);
    for (const req of asked) {
      const sent = req.messages.map((m) => m.content).join("\n\n");
      expect(sent).toContain("- director: works from");
      expect(sent).toContain("notes/director-guide.md");
      for (const role of ROLE_IDS) expect(sent).toContain(`- ${role}: works from`);
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the turn's readers: the GM's data, every secret marked", () => {
  const hiding = (put: Put): Promise<void> => put("entities", VIKTOR, { id: VIKTOR, kind: "person", name: "Viktor Crane", tier: "supporting", visibility: "known_by", fields: {}, relations: [] });

  test("a role working from the player character's perspective reads someone they can't see, marked as a secret", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, { agents: { context: { roles: { intent: { perspective: "pov" } } } } }, hiding, [DANNY, PRIYA, VIKTOR]);
    const results: string[] = [];
    scripted(rig, { intent: toolsThen([{ name: "people_sheet", args: { person: "Viktor Crane" }, callId: "c1" }], JSON.stringify({ action: null, params: {}, confidence: 0.9 }), results) });
    await played(rig, chatId, "I look around the kitchen.", "The kitchen is quiet.");
    expect(results.length).toBe(1);
    const sheet = results[0] ?? "";
    expect(sheet).toContain("Viktor Crane");
    expect(holdsSecretMark(sheet)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a track's every stage with its unrevealed truth marked, and a mind whole, as GM → Minds shows it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const wreck = (put: Put): Promise<void> => put("tracks", "wreck", { id: "wreck", kind: "secret", label: "The wreck", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: TRUTH } } });
    const chatId = await agentChat(rig, { agents: { roles: { intent: { families: ["people", "quests", "minds"] } } } }, wreck);
    const answer = JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    scripted(rig);
    // The first turn's minds give Danny the mind the second turn reads.
    await played(rig, chatId, "Morning, Danny.", "Danny nods.");
    const results: string[] = [];
    scripted(rig, { intent: toolsThen([{ name: "quests_stage", args: { track: "wreck" }, callId: "q1" }, { name: "minds_read", args: { person: "Danny Okafor" }, callId: "m1" }], answer, results) });
    await played(rig, chatId, "How's the boat, Danny?", "Danny shrugs.");
    expect(results.length).toBe(2);
    const [stage = "", mind = ""] = results;
    const parsed = JSON.parse(stage) as { stages?: { truth?: string }[]; visibility?: string };
    expect(parsed.visibility).toBe("secret");
    const truth = parsed.stages?.[0]?.truth ?? "";
    expect(truth).toContain(TRUTH);
    expect(holdsSecretMark(truth)).toBe(true);
    expect(mind).toContain("INTENT-MARK keep the debt quiet");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the director's lines", () => {
  test("one that contradicts the state it was given is flagged in Diagnostics and kept for the narrator", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, PROSE);
    const here = "Marcus Delgado leans on the counter beside Jordan.";
    scripted(rig, { director: () => JSON.stringify({ brief: "BRIEF-OK The harbor is grey this morning.", beats: ["OUTLINE-OK Jordan looks out at the harbor.", here] }) });
    const told = await played(rig, chatId, "I look out at the harbor.", "The harbor is calm.");
    expect(told).toContain("OUTLINE-OK Jordan looks out at the harbor.");
    expect(told).toContain(here);
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.director && r.level === "warn" && (r.reason ?? "").includes(`1 flagged, still in the reply's prompt (it has someone here whom the engine has elsewhere: "${here}")`))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the default turn budget", () => {
  test("never refuses a role on a starter-world turn whose roles send more than the old 100k-token turn limit", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentChat(rig, { agents: { main: { pinsTokens: 60_000 } } });
    // A pinned file of about 45k tokens goes with every role: the intent's and the scene's alone come to about 90k.
    const long = `# Harbor log\n${"The tide turns twice a day at the north pier, and the ferry waits for it. ".repeat(Math.ceil((45_000 * CHARS_PER_TOKEN) / 74))}`;
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: "notes/log.md", text: long, readers: "everyone" }));
    rig.body(await rig.send({ type: "lre.workspace", op: "pin", chatId, path: "notes/log.md", pinned: true }));
    const seen = scripted(rig);
    await played(rig, chatId, "I walk down to the pier.", "The pier is quiet.");
    const read = seen.filter((s) => s.role === "read");
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((s) => s.head.includes("The tide turns twice a day"))).toBe(true);
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.filter((r) => /per turn/.test(r.reason ?? ""))).toEqual([]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "engine_failed")).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);
});

describe("Settings → Agents → Context, as the settings store patches it", () => {
  test("a field of one role's context patches alone, and null returns the role to its defaults", async () => {
    const rig = new Rig();
    const user = rig.host.userId;
    const defaults = defaultContextSettings().roles.director;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { context: { roles: { director: { perspective: "gm" } } } } } }));
    expect((await rig.rt.settings.get(user)).agents.context.roles.director).toEqual({ ...defaults, perspective: "gm" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { context: { roles: { director: { pins: ["notes/a.md"], never: ["money"] } } } } } }));
    expect((await rig.rt.settings.get(user)).agents.context.roles.director).toEqual({ ...defaults, perspective: "gm", pins: ["notes/a.md"], never: ["money"] });
    // Another role's context stands as it was.
    expect((await rig.rt.settings.get(user)).agents.context.roles.read).toEqual(defaultContextSettings().roles.read);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { context: { roles: { director: { pins: null } } } } } }));
    expect((await rig.rt.settings.get(user)).agents.context.roles.director).toEqual({ ...defaults, perspective: "gm", never: ["money"] });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { context: { roles: { director: null } } } } }));
    expect((await rig.rt.settings.get(user)).agents.context.roles.director).toEqual(defaults);
  });
});
