// The fixed pipeline's agent-backed paths the role tests leave out (INC2-SPEC C9, lane T2), on
// scripted models: the minds family (each person's mind, the knowledge step, memory and
// consolidation), a time skip (its plan and its beats), a world's effects step, and the director's
// prose and suggested next moves. Each path's agent answers in its task's contract and the turn reads
// the answer as classic's type, by classic's own validators: the same answers record the same events,
// and tell the narrator and the player the same, as classic's calls. An answer that isn't one does as
// the role's `onFail` says: `prompt_only` makes classic's own call, with classic's result; `skip` goes
// on without it; `stop` stops the turn before the reply, the engine-failed card naming the role, and
// after the reply, with nothing left to stop, records the role's failure as the turn's own and stops
// the read as a cancelled one stops: the reply stands unread with Retry read, nothing of its read
// lands, and Retry read reads it again on the same roles.

import { describe, expect, test } from "bun:test";
import { roleContract } from "../../src/backend/agents/roles/contracts";
import type { QuietRequest } from "../../src/backend/host";
import { calendarOf, formatStamp } from "../../src/engine/calendar";
import { editRequest } from "../../src/frontend/requests";
import { noteOp } from "../../src/packs/minds/ui/ops";
import { ROLE_LABEL, type RoleId } from "../../src/shared/agent-roles";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { KNOWLEDGE_ANSWER_SHAPE, KNOWLEDGE_TEXTS, MIND_PROMPT_DEFAULTS, MINDS_EVENTS } from "../../src/shared/minds";
import { roleContractId } from "../../src/shared/role-prompts";
import { checkSchema } from "../../src/shared/schema-check";
import { SKIP_PLAN_ANSWER } from "../../src/shared/skip-plan";
import { alderChat, DANNY, PRIYA, type Put, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
/** A world effects step's own words, which its calls carry, classic's and the world role's alike. */
const FX_MARK = "WORLD-FX-MARK: note how much time the reply says passed.";
/** The time the effects step's answer passes, which the reply tells. */
const FX_MINUTES = 240;
const BRIEF = "BRIEF-MARK The harbor is calm and grey this morning.";
const OUTLINE = "OUTLINE-MARK The player character looks out over the quiet harbor.";
const CHOICE = "I CHOICE-MARK look at the boats.";

type Path = "mind" | "knowledge" | "memory" | "consolidate" | "plan" | "beats" | "effects" | "prose" | "choices";

/**
 * What each path's calls hold, classic's and its role agent's alike (a role's task texts are its
 * classic step's words), in the order they are told apart: a mind at a skip's beat is a mind.
 */
const MARKS: readonly (readonly [Path, string])[] = [
  ["plan", SKIP_PLAN_ANSWER],
  ["mind", "You are the private mind of"],
  ["consolidate", "You keep the long-term memory of"],
  ["memory", "You keep the memory of"],
  ["knowledge", "You keep track of who knows what"],
  ["beats", "skipping ahead in time"],
  ["effects", FX_MARK],
  ["choices", "Suggest three short, distinct things"],
  ["prose", "You brief a roleplay narrator"],
  ["prose", "You outline a roleplay narrator"],
];

/** Where a skip's answers put their times: so many minutes after the clock both chats start from. */
interface Start {
  stamp(minutes: number): string;
}

/** Each path's answer, in its contract, the same for classic's call and for its role's agent. */
function answer(path: Path, all: string, start: Start): JsonObject {
  const named = (re: RegExp): string => re.exec(all)?.[1] ?? "someone";
  switch (path) {
    case "mind": {
      const who = named(/You are the private mind of (.+?) in the roleplay world/);
      return { monologue: `THOUGHT-MARK of ${who}.`, depiction: `${who} looks up`, intent: "Wait and see.", reactions: [], mood: "calm" };
    }
    case "knowledge":
      // The answer's third version: a new fact says why it matters and to whom; a witnessing names who missed it, and everyone else there throughout witnessed it.
      return { facts: [{ ref: "n1", claim: "KNOW-MARK the ferry runs late today", matters: "Danny would miss the ferry", about: [], truth: "true" }], learned: [{ fact: "n1", how: "witnessed", missed: ["Priya Nair"] }], inferred: [], doubted: [] };
    case "memory":
      return { notes: [{ text: `NOTE-MARK ${named(/You keep the memory of (.+?) in the roleplay world/)} watched the harbor`, salience: 3 }], commitments: [], resolved: [], plans: [], told: [] };
    case "consolidate":
      return { summary: `SUMMARY-MARK ${named(/You keep the long-term memory of (.+?) in the roleplay world/)} keeps an eye on the harbor.` };
    case "plan":
      return { plans: [{ entity: DANNY, blocks: [{ label: "Checks the moorings", start: start.stamp(15), end: start.stamp(75), place: "alder_harbor_marina", activity: "work" }] }] };
    case "beats":
      return { beats: [{ at: start.stamp(45), reason: "BEAT-MARK the ferry horn sounds" }] };
    case "effects":
      return { proposals: [{ type: "time_advance", minutes: FX_MINUTES }] };
    case "prose":
      // The brief's own call reads `text` and the outline's `beats`; the director's reads `brief` and `beats`.
      return { text: BRIEF, brief: BRIEF, beats: [OUTLINE] };
    case "choices":
      return { choices: [CHOICE] };
  }
}

/** A call as the scripted models saw it: the role whose agent made it (null for classic's own call), its path, and what it was sent. */
interface Seen {
  role: string | null;
  path: Path | null;
  all: string;
}

/** Scripted models: each call answered by its path in its contract; a role agent's call on a path in `bad` gets an answer that isn't one. */
function script(rig: Rig, start: Start, bad: readonly Path[] = []): Seen[] {
  const seen: Seen[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const head = req.messages[0]?.content ?? "";
    const all = req.messages.map((m) => m.content).join("\n");
    const role = /You are the ([\w-]+) agent of LumiRPEngine/.exec(head)?.[1] ?? null;
    const path = MARKS.find(([, mark]) => all.includes(mark))?.[0] ?? null;
    seen.push({ role, path, all });
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (path !== null) return role !== null && bad.includes(path) ? "not an answer" : JSON.stringify(answer(path, all, start));
    if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
  return seen;
}

/** Whether a path's agent and its classic call answered among `seen`. */
function asked(seen: readonly Seen[], path: Path): { agent: boolean; classic: boolean } {
  return { agent: seen.some((s) => s.path === path && s.role !== null), classic: seen.some((s) => s.path === path && s.role === null) };
}

interface Setup {
  minds?: boolean;
  /** Settings patches, after the decisions step is switched off: no person's choice is asked here. */
  settings?: readonly JsonObject[];
  /** The world's draft before its commit. */
  world?: (put: Put) => Promise<void>;
  /** Edits at the greeting of the chat both start from, which its Branch keeps. */
  greeting?: (rig: Rig, chatId: string) => Promise<void>;
  /** Whether both chats track knowledge. */
  knowing?: boolean;
}

/** Port Alder on the same roll with Danny and Priya beside the player character, and its Branch at the greeting on agents, the roles agent-backed (§15's default). */
async function pair(rig: Rig, setup: Setup): Promise<{ classic: string; agents: string; start: Start }> {
  for (const patch of [{ modelUse: { steps: { "npc.choose": { enabled: false } } } }, ...(setup.settings ?? [])]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const classic = await alderChat(
    rig,
    async (put, worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { seedMode: "same_roll" } }));
      await setup.world?.(put);
    },
    [DANNY, PRIYA],
  );
  await setup.greeting?.(rig, classic);
  const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
  if (!greeting) throw new Error("no greeting");
  const agents = rig.host.branch(classic, greeting.id);
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, engine: "agents" }));
  for (const chatId of [classic, agents]) rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, knowledge: setup.knowing === true }));
  const { state, world } = await stateOf(rig, classic);
  return { classic, agents, start: { stamp: (minutes) => formatStamp(calendarOf(world), state.clock + minutes) } };
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/**
 * A record's events as two chats can compare them: without the agent turn's output events, each
 * message id by its place in its chat, and each claim the knowledge step made by its order (a
 * claim's id hashes the message it was learned from, which a Branch has its own of).
 */
async function comparable(rig: Rig, chatId: string, rec: Rec): Promise<unknown> {
  const at = new Map((await rig.host.chats.messages(chatId, rig.host.userId)).map((m, i) => [m.id, `#${i}`]));
  const events = rec.events.filter((e: LedgerEvent) => !e.type.startsWith("engine.out."));
  const claims = new Map<string, string>();
  const text = JSON.stringify(events, (_key, value: unknown) => (typeof value === "string" && at.has(value) ? at.get(value) : value)).replace(/claim:[0-9a-z]+/g, (id) => {
    if (!claims.has(id)) claims.set(id, `claim#${claims.size}`);
    return claims.get(id) ?? id;
  });
  return JSON.parse(text);
}

interface Turn {
  text: string;
  reply: string;
  /** A timelapse of so many minutes from the palette, in place of a typed message. */
  lapse?: number;
}

interface Played {
  /** The turn's record; null when the engine stopped it before the reply. */
  rec: Rec | null;
  halted: string | undefined;
  /** What the engine-failed card says, when there is one. */
  failed: string[];
  /** What the narrator was told. */
  told: string;
  /** The next moves suggested after the reply. */
  choices: string[];
  /** How far the turn moved the clock, in minutes. */
  minutes: number;
}

async function played(rig: Rig, chatId: string, turn: Turn): Promise<Played> {
  const before = (await stateOf(rig, chatId)).state.clock;
  if (turn.lapse !== undefined) rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: turn.lapse } }, source: "palette", now: true }));
  else {
    rig.host.sendUser(chatId, turn.text);
    await rig.host.settle();
  }
  const g = await rig.host.start(chatId, { type: "normal" });
  const told = rig.host.assembled.map((e) => e.content).join("\n");
  if (!g.halted) await rig.host.finish(g, turn.reply);
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return {
    rec: g.halted ? null : await lastRecord(rig, chatId),
    halted: g.halted,
    failed: chips.filter((c) => c.kind === "engine_failed").map((c) => c.detail ?? c.label),
    told,
    choices: chips.filter((c) => c.kind === "choice").map((c) => c.label),
    minutes: (await stateOf(rig, chatId)).state.clock - before,
  };
}

/** Whether the turn's events carry `mark`. */
function recorded(p: Played, mark: string): boolean {
  return JSON.stringify(p.rec?.events ?? []).includes(mark);
}

/** Taps the reply's Retry read: the turn as it stands then (`p` as it stood before), and whether the read was refused. */
async function retried(rig: Rig, chatId: string, p: Played): Promise<Played & { refused: boolean }> {
  const clock = (await stateOf(rig, chatId)).state.clock;
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "retry_read");
  if (!chip) throw new Error("no Retry read");
  const sent = await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "retry_read" });
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { ...p, rec: await lastRecord(rig, chatId), choices: chips.filter((c) => c.kind === "choice").map((c) => c.label), minutes: p.minutes + (await stateOf(rig, chatId)).state.clock - clock, refused: sent.type === "lre.error" };
}

/** Whether the turn recorded a skip plan with someone's blocks in it. */
function planned(p: Played): boolean {
  return (p.rec?.events ?? []).some((e) => {
    const data: unknown = "data" in e ? e.data : null;
    return isRecord(data) && Array.isArray(data.plans) && data.plans.length > 0;
  });
}

/** Two notes each for Danny and Priya, one past the one they keep (`FOLDING`): each is due a consolidation. */
async function seedNotes(rig: Rig, chatId: string): Promise<void> {
  for (const who of [DANNY, PRIYA])
    for (const text of ["Saw the van come in.", "Heard about the bid."]) {
      const op = noteOp(who, null, { text, salience: "3" });
      if (!op) throw new Error("the form refused the note");
      rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
    }
}

/** Danny's skip is the model's to plan: his routine informative. */
async function informative(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "routine_follow", entity: DANNY, role: "informative", skips: "model" }] }));
}

async function effectsStep(put: Put): Promise<void> {
  await put("steps", "fx", { id: "fx", purpose: "extract", template: FX_MARK, output: "effects", signals: ["reply"] });
}

/** The time-skip step on (it is off by default). */
const SKIP_STEP: JsonObject = { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } };
const FOLDING: JsonObject = { minds: { memory: { notes: { keep: 1 }, consolidate: { enabled: true, periodDays: 1 } } } };
const PROSE_STEPS: JsonObject = { modelUse: { steps: { brief: { enabled: true, signals: ["always"] }, outline: { enabled: true, signals: ["always"] } } } };
const CHOICES_STEP: JsonObject = { modelUse: { steps: { choices: { enabled: true, signals: ["always"] } } } };
/** Calls enough before the reply for the brief and the outline both (the default leaves the outline none). */
const PRE_CALLS: JsonObject = { modelUse: { budgets: { pre: { calls: 8 } } } };

/** The lines the narrator was told that the scripted answers wrote. */
function marks(p: Played): string[] {
  return p.told.split("\n").filter((line) => line.includes("-MARK"));
}

const SAID: Turn = { text: "I tell Danny and Priya the ferry runs late today.", reply: "Danny and Priya hear that the ferry runs late today." };
const LOOK: Turn = { text: "I look out at the harbor.", reply: "The harbor is calm." };
const LAPSE: Turn = { text: "", reply: "Two hours go by at the harbor.", lapse: 120 };

interface Case {
  title: string;
  path: Path;
  role: RoleId;
  /** Whether it runs before the reply, where `stop` stops the turn. */
  before: boolean;
  setup: Setup;
  turn: Turn;
  /** Whether what the path gives is in the turn. */
  landed(p: Played): boolean;
}

const CASES: readonly Case[] = [
  { title: "a person's mind (the minds role)", path: "mind", role: "minds", before: true, setup: { minds: true }, turn: SAID, landed: (p) => recorded(p, "THOUGHT-MARK") },
  { title: "the knowledge step after the read (the knowledge role)", path: "knowledge", role: "knowledge", before: false, setup: { minds: true, knowing: true }, turn: SAID, landed: (p) => recorded(p, "KNOW-MARK") },
  { title: "a person's memory of the turn (the memory role)", path: "memory", role: "memory", before: false, setup: { minds: true }, turn: SAID, landed: (p) => recorded(p, "NOTE-MARK") },
  { title: "consolidation (the memory role)", path: "consolidate", role: "memory", before: false, setup: { minds: true, settings: [FOLDING], greeting: seedNotes }, turn: SAID, landed: (p) => recorded(p, "SUMMARY-MARK") },
  { title: "a timelapse's skip plan (the skip role)", path: "plan", role: "skip", before: true, setup: { settings: [SKIP_STEP], greeting: informative }, turn: LAPSE, landed: planned },
  { title: "a time skip's beats (the skip role)", path: "beats", role: "skip", before: true, setup: { minds: true, settings: [SKIP_STEP] }, turn: LAPSE, landed: (p) => recorded(p, "BEAT-MARK") },
  { title: "a world's effects step (the world role)", path: "effects", role: "world", before: false, setup: { world: effectsStep }, turn: { text: "I wait for the ferry.", reply: "Four hours later, the ferry finally docks." }, landed: (p) => p.minutes >= FX_MINUTES },
  { title: "the brief alone, when the calls before the reply leave the outline none (the director role)", path: "prose", role: "director", before: true, setup: { settings: [PROSE_STEPS] }, turn: LOOK, landed: (p) => p.told.includes("BRIEF-MARK") },
  { title: "the brief and the outline (the director role)", path: "prose", role: "director", before: true, setup: { settings: [PROSE_STEPS, PRE_CALLS] }, turn: LOOK, landed: (p) => p.told.includes("BRIEF-MARK") && p.told.includes("OUTLINE-MARK") },
  { title: "suggested next moves (the director role)", path: "choices", role: "director", before: false, setup: { settings: [CHOICES_STEP] }, turn: LOOK, landed: (p) => p.choices.includes(CHOICE) },
];

/** The role's `onFail`. */
async function failing(rig: Rig, role: RoleId, onFail: "prompt_only" | "skip" | "stop"): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { [role]: { onFail } } } } }));
}

for (const c of CASES) {
  describe(c.title, () => {
    test("its agent answers as classic's type: the same answers record the same events, and tell the narrator and the player the same, as classic's calls", async () => {
      const rig = new Rig({ shipped: true, minds: c.setup.minds === true });
      const { classic, agents, start } = await pair(rig, c.setup);
      const seen = script(rig, start);
      const a = await played(rig, classic, c.turn);
      const from = seen.length;
      const b = await played(rig, agents, c.turn);
      if (!a.rec || !b.rec) throw new Error(`a turn stopped: ${[...a.failed, ...b.failed].join("; ")}`);
      expect([c.landed(a), c.landed(b)]).toEqual([true, true]);
      expect(asked(seen.slice(from), c.path)).toEqual({ agent: true, classic: false });
      expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
      expect(marks(b)).toEqual(marks(a));
      expect(b.choices).toEqual(a.choices);
      expect(rig.rt.ledger.errors).toEqual([]);
    });

    test("an answer that isn't one, under prompt_only, makes classic's own call, with classic's result", async () => {
      const rig = new Rig({ shipped: true, minds: c.setup.minds === true });
      const { classic, agents, start } = await pair(rig, c.setup);
      await failing(rig, c.role, "prompt_only");
      const seen = script(rig, start, [c.path]);
      const a = await played(rig, classic, c.turn);
      const from = seen.length;
      const b = await played(rig, agents, c.turn);
      if (!a.rec || !b.rec) throw new Error(`a turn stopped: ${[...a.failed, ...b.failed].join("; ")}`);
      expect(asked(seen.slice(from), c.path)).toEqual({ agent: true, classic: true });
      expect(c.landed(b)).toBe(true);
      expect(marks(b)).toEqual(marks(a));
      expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
      expect(rig.rt.ledger.errors).toEqual([]);
    });

    test("under skip, the turn goes on without it and makes no classic call", async () => {
      const rig = new Rig({ shipped: true, minds: c.setup.minds === true });
      const { agents, start } = await pair(rig, c.setup);
      await failing(rig, c.role, "skip");
      const seen = script(rig, start, [c.path]);
      const b = await played(rig, agents, c.turn);
      expect({ halted: b.halted, failed: b.failed }).toEqual({ halted: undefined, failed: [] });
      expect(asked(seen, c.path)).toEqual({ agent: true, classic: false });
      expect(c.landed(b)).toBe(false);
      expect(rig.rt.ledger.errors).toEqual([]);
    });

    test(c.before ? "under stop, the turn stops before the reply, the engine-failed card naming the role" : "under stop, after the reply, the read stops as a cancelled one does: the reply stands unread with Retry read and nothing of its read lands, and Retry read reads it again on the same roles", async () => {
      const rig = new Rig({ shipped: true, minds: c.setup.minds === true });
      const { agents, start } = await pair(rig, c.setup);
      await failing(rig, c.role, "stop");
      const seen = script(rig, start, [c.path]);
      const b = await played(rig, agents, c.turn);
      expect(asked(seen, c.path)).toEqual({ agent: true, classic: false });
      if (c.before) {
        expect(b.halted).toBeDefined();
        expect(b.failed.some((d) => d.startsWith(ROLE_LABEL[c.role]))).toBe(true);
        return;
      }
      expect(b.halted).toBeUndefined();
      const records = await rig.rt.diag.records(agents, rig.host.userId);
      expect(records.some((r) => r.fatal === true && r.step === ROLE_LABEL[c.role])).toBe(true);
      // The record stopped unread: its plan's events alone, none of the read's chips, and Retry read.
      expect(b.rec?.status).toBe("stopped");
      expect(b.rec?.events.length).toBe(b.rec?.pre);
      expect(c.landed(b)).toBe(false);
      expect((await rig.rt.view(agents, rig.host.userId)).chips.filter((ch) => ch.kind === "retry_read").length).toBe(1);
      // A Retry read the role stops again lands nothing either, and leaves Retry read.
      const stopped = await retried(rig, agents, b);
      expect([stopped.refused, stopped.rec?.status, stopped.rec?.events.length === stopped.rec?.pre, c.landed(stopped)]).toEqual([true, "stopped", true, false]);
      // On the same roles, answering now, Retry read reads it, and what the role gives lands.
      const again = script(rig, start);
      const read = await retried(rig, agents, b);
      expect(asked(again, c.path)).toEqual({ agent: true, classic: false });
      expect([read.refused, read.rec?.status, c.landed(read)]).toEqual([false, "ok", true]);
      expect((await rig.rt.view(agents, rig.host.userId)).chips.some((ch) => ch.kind === "retry_read")).toBe(false);
      expect(rig.rt.ledger.errors).toEqual([]);
    });
  });
}

describe("the knowledge role's answer", () => {
  test("is the knowledge step's own, its third version, and checked as classic's: everyone there throughout witnessed it but whom the answer says missed it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { agents, start } = await pair(rig, { minds: true, knowing: true });
    const seen = script(rig, start);
    const b = await played(rig, agents, SAID);
    if (!b.rec) throw new Error(`the turn stopped: ${b.failed.join("; ")}`);
    // The role is told the step's own answer, which asks why each new fact matters and names who missed a witnessing, and the step's own wording of it.
    const told = seen.find((s) => s.role === "knowledge")?.all ?? "";
    expect(told).toContain(KNOWLEDGE_ANSWER_SHAPE);
    expect(KNOWLEDGE_ANSWER_SHAPE).toContain('"matters"');
    expect(KNOWLEDGE_ANSWER_SHAPE).toContain('"missed"');
    expect(told).toContain(KNOWLEDGE_TEXTS.stepAnswer);
    expect(told).toContain(MIND_PROMPT_DEFAULTS.knowledge.split("\n")[1] ?? "");
    // Danny was there throughout and witnessed it; Priya, there too, missed it.
    const learners = b.rec.events.flatMap((e) => (e.type === MINDS_EVENTS.learn && "data" in e && isRecord(e.data) && Array.isArray(e.data.who) ? e.data.who : []));
    expect(learners).toContain(DANNY);
    expect(learners).not.toContain(PRIYA);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a new fact that doesn't say why it matters is refused as classic refuses it: no fact, and no one learns it; Test's contract says so too", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { agents, start } = await pair(rig, { minds: true, knowing: true });
    script(rig, start);
    const scripted = rig.host.quietReply;
    rig.host.quietReply = (req: QuietRequest) => {
      const reply = scripted?.(req) ?? "{}";
      if (typeof reply !== "string" || !(req.messages[0]?.content ?? "").includes("You are the knowledge agent")) return reply;
      const answer = JSON.parse(reply) as JsonObject;
      return JSON.stringify({ ...answer, facts: (answer.facts as JsonObject[]).map(({ matters: _, ...f }) => f) });
    };
    const b = await played(rig, agents, SAID);
    if (!b.rec) throw new Error(`the turn stopped: ${b.failed.join("; ")}`);
    expect(b.rec.events.filter((e) => e.type === MINDS_EVENTS.fact || e.type === MINDS_EVENTS.learn)).toEqual([]);
    const contract = roleContract(roleContractId("knowledge", "knowledge"));
    if (!contract) throw new Error("no contract");
    const fact = { ref: "n1", claim: "The ferry runs late today", about: [] };
    expect(checkSchema(contract.schema, { facts: [{ ...fact, matters: "Danny would miss it" }], learned: [], inferred: [], doubted: [] })).toEqual([]);
    expect(checkSchema(contract.schema, { facts: [fact], learned: [], inferred: [], doubted: [] }).map((p) => [p.path, p.message])).toEqual([[["facts", 0], 'needs "matters"']]);
    expect(checkSchema(contract.schema, { facts: [{ ...fact, matters: "" }], learned: [], inferred: [], doubted: [] }).map((p) => p.path)).toEqual([["facts", 0, "matters"]]);
  });
});
