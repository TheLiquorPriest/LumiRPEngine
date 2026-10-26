// Inferred checks (DESIGN §11), on Port Alder with the Fifth profile: a typed attempt no catalog
// action with its own check covers is read as Try something and rolled with the world's sheet. The
// Outcome tells the narrator the result and its Narrate line; an opponent's numbers stay out of every
// chip, prompt section and panel, the inspector included; companions roll their own; a reaction the
// message asks for rolls; the chat's policy (off, suggest, when, which skills, the most rolls)
// holds, layered as the adjudication policy is, with off leaving the world's skill actions to typed
// text; an older Story chat rolls without pausing; and a catalog action with its own check is never doubled.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import { presetAdjudication } from "../../src/shared/adjudication";
import { INFERRED_PRESETS, type InferredChecks } from "../../src/shared/inferred";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import type { Chip, ContextView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld } from "../packs/support";
import { Rig } from "../support/rig";

const INTERPRET = "You map a player's typed input";
const HERE = "harbor_street_114";

/**
 * Port Alder on the Fifth profile (or, with `profile: null`, on its own sheet), a bouncer with a
 * sharp eye where Jordan stands, Marcus there too, and the chat's policy (null: none of the user's,
 * so the chat plays by its realism preset's), with what `puts` adds to the world and any other
 * settings `patch` names.
 */
async function chat(policy: Partial<InferredChecks> | null, opts: { puts?: [string, JsonObject][]; patch?: JsonObject; profile?: "fifth" | null } = {}): Promise<{ rig: Rig; chatId: string }> {
  const { puts = [], patch = {}, profile = "fifth" } = opts;
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  if (profile) rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile, choices: {} }));
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  const marcus = { ...draft.entities.marcus_delgado, fields: { ...draft.entities.marcus_delgado?.fields, place: HERE } };
  const bouncer = { id: "bouncer", kind: "character", name: "the bouncer", tier: "supporting", fields: { place: HERE, wis: 50, insight: 2 }, relations: [] };
  for (const [collection, value] of [["entities", bouncer], ["entities", marcus], ...puts] as [string, JsonObject][]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  // The world sets none, so a new chat starts from the user's own policy.
  const inferred = policy ? { inferred: { ...INFERRED_PRESETS.simulation, ...policy } as unknown as JsonObject } : {};
  rig.body(await rig.send({ type: "lre.settings.set", patch: { ...inferred, ...patch } }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` reads every message as `read`; every other step reads nothing. */
function reading(rig: Rig, read: JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
}

const tryRead = (params: JsonObject): JsonObject => ({ action: "try", params });

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

async function events(rig: Rig, chatId: string): Promise<LedgerEvent[]> {
  return toChain(await rig.host.chats.messages(chatId, rig.host.userId)).flatMap((m) => Object.values(m.ledger?.swipes ?? {}).flatMap((r) => r.events));
}

const checks = (all: readonly LedgerEvent[]): { actor: unknown; total: unknown; outcome: unknown }[] => all.flatMap((e) => (e.type === "engine.check" && "data" in e ? [{ actor: e.data.actor, total: e.data.total, outcome: e.data.outcome }] : []));

/**
 * Where the hidden checks' own data shows in what the player sees (DESIGN §11): one's event (an
 * object with its roller and roll, or the opposed outcome); its roll or total said as one ("rolled
 * 17", "against 17", "the bouncer … 17") in words about the check (`about`: its skills and rollers);
 * or the attempt's margin, which with the player's own roll gives it away. Never a bare number: a
 * palette's "DC 10" or a lore count is no leak.
 */
function hiddenCheckIn(surfaces: readonly unknown[], hidden: readonly JsonObject[], about: readonly string[]): string[] {
  const found: string[] = [];
  const rollers = new Set(hidden.map((d) => String(d.actor)));
  // A number said as a roll or a score: one a unit follows (minutes, a time, a percentage) is something else.
  const said = (n: number): RegExp => new RegExp(`(?:\\b(?:rolled|natural|total(?: of)?|scored?|dc|against|set it at|beat|by)\\s+|\\b(?:${about.join("|")})\\b[^.;\\n]{0,40}\\b)${n}\\b(?!\\s*(?:min|h\\b|hours?|%|:|[ap]m\\b))`, "i");
  const numbers = hidden.flatMap((d) => [d.total, d.natural].filter((n): n is number => typeof n === "number")).map(said);
  const concerns = new RegExp(`\\b(?:${about.join("|")})\\b`, "i");
  const walk = (v: unknown, at: string): void => {
    if (typeof v === "string") {
      if (concerns.test(v) && numbers.some((re) => re.test(v))) found.push(`${at}: ${v}`);
      if (concerns.test(v) && /\bby \d+\b/.test(v)) found.push(`${at} (a margin): ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}/${i}`));
    else if (isRecord(v)) {
      const who = v.actor ?? v.who;
      if (v.outcome === "opposed" || (typeof who === "string" && rollers.has(who) && ["total", "natural", "score", "dc"].some((k) => typeof v[k] === "number"))) found.push(`${at}: ${JSON.stringify(v)}`);
      for (const [k, x] of Object.entries(v)) walk(x, `${at}/${k}`);
    }
  };
  surfaces.forEach((s, i) => walk(s, `#${i}`));
  return found;
}

describe("an attempt read as a check", () => {
  test("persuasion: the check rolls, and the Outcome carries its result and a Narrate line", async () => {
    const { rig, chatId } = await chat({});
    reading(rig, tryRead({ attempt: "talk my way past the door", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I try to talk my way past the door.", "You talk.");
    const roll = (await chips(rig, chatId)).find((c) => c.kind === "roll");
    expect(roll?.label).toMatch(/^Persuasion check: (success|failure|great)$/);
    expect(roll?.detail).toMatch(/^Rolled d20 = \d+ against 15\. Odds: /);
    expect(rig.host.section("Outcome")).toMatch(/Persuasion check for "talk my way past the door", Jordan Ellis \(hard\): (success|failure|great) by \d+(, only just|, close to \w+)?\. Narrate it (succeeding|failing)/);
  });

  test("opposed: the bouncer's insight rolls against it, and his numbers reach no chip, Outcome, prompt section or panel, the inspector included", async () => {
    // Every check rolls (so the player's own roll and a margin are there to give his away), every
    // step runs (so the inspector holds each one's record), and companions roll their own, hidden too.
    const { rig, chatId } = await chat({ detail: "margin" }, { patch: { overrideWorldAdjudication: true, adjudication: presetAdjudication("crunchy") as unknown as JsonObject, modelUse: { preset: "full" } } });
    reading(rig, tryRead({ attempt: "talk the bouncer into letting me in", skill: "persuasion", difficulty: "moderate", with: ["danny_okafor"], against: [{ who: "bouncer", skill: "insight" }] }));
    await rig.turn(chatId, "We try to talk the bouncer into letting us in.", "He looks you over.");
    const hidden = (await events(rig, chatId)).flatMap((e) => (e.type === "engine.check" && "data" in e && e.data.npc === true ? [e.data] : []));
    const his = hidden.find((d) => d.actor === "bouncer");
    expect(his?.outcome).toBe("opposed");
    expect(hidden.map((d) => d.actor)).toEqual(["bouncer", "danny_okafor"]);
    expect(rig.host.section("Outcome")).toMatch(/^\[Outcome\]\n(?:.*\n)*- Persuasion check for "talk the bouncer into letting me in", Jordan Ellis with Danny Okafor against the bouncer: Jordan Ellis \w+; Danny Okafor \w+\./);
    // Opening the inspector checks the prompt on a dry run: every panel the player's view carries, then.
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const view = await rig.rt.view(chatId, rig.host.userId);
    // The inspector holds the turn's record, with what each step searched the lore with. (Read off
    // a copy: an asymmetric matcher inside toMatchObject can empty the object it reads.)
    const inspector = view.panels["core.context"] as unknown as ContextView;
    expect(inspector.generations[0]?.lore?.map((l) => l.step)).toEqual(expect.arrayContaining(["brief", "extract"]));
    expect(view.chips.find((c) => c.kind === "roll")?.detail).toMatch(/^Rolled d20/);
    expect(hiddenCheckIn([view, rig.host.assembled.map((e) => e.content)], hidden, ["Persuasion", "Insight", "Read People", "the bouncer"])).toEqual([]);
    expect(view.chips.find((c) => c.kind === "roll")?.detail).not.toMatch(/Odds|%/);
  });

  test("companions: 'we sneak past' rolls a check for each companion who joins in", async () => {
    const { rig, chatId } = await chat({ who: "companions" });
    reading(rig, tryRead({ attempt: "sneak past the bouncer", skill: "stealth", difficulty: "moderate", with: ["danny_okafor", "jess_kowalczyk"], against: [{ who: "bouncer", skill: "perception" }] }));
    await rig.turn(chatId, "We sneak past the bouncer.", "You creep along the wall.");
    expect(checks(await events(rig, chatId)).filter((c) => c.actor !== "bouncer").map((c) => c.actor)).toEqual(["danny_okafor", "jess_kowalczyk"]);
    expect(rig.host.section("Outcome")).toMatch(/Stealth check for "sneak past the bouncer", Jordan Ellis with Danny Okafor and Jess Kowalczyk against the bouncer: Jordan Ellis \w+.*; Danny Okafor \w+; Jess Kowalczyk \w+\. .*Narrate the others as their rolls fell\./);
  });

  test("reactive: watching Marcus answer rolls insight against his deception", async () => {
    const { rig, chatId } = await chat({});
    reading(rig, tryRead({ attempt: "tell whether Marcus is lying", skill: "insight", difficulty: "moderate", against: [{ who: "marcus_delgado", skill: "deception" }] }));
    await rig.turn(chatId, "I watch Marcus as he answers: is he lying?", "Marcus shrugs.");
    expect(checks(await events(rig, chatId)).map((c) => c.actor)).toEqual(["marcus_delgado"]);
    expect(rig.host.section("Outcome")).toContain("Read People check for \"tell whether Marcus is lying\", Jordan Ellis against Marcus Delgado:");
  });
});

describe("an attempt that names someone hidden", () => {
  const VEX: [string, JsonObject] = ["entities", { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: "alder_automotive" }, relations: [] }];
  const PAST = tryRead({ attempt: "talk my way past Vex Morrow", skill: "persuasion", difficulty: "hard" });
  const TYPED = ["I try to talk my way past the door.", "I try to talk my way past Vex Morrow."];

  test("the question and the narrator say it only when the player typed it, and then as in a world without them", async () => {
    /** The check question's detail and the Outcome once the player rolls, after `typed`, in a world with `puts`. */
    const asked = async (typed: string, puts: [string, JsonObject][]): Promise<{ ask: string; outcome: string }> => {
      const { rig, chatId } = await chat({ mode: "suggest" }, { puts });
      reading(rig, PAST);
      rig.host.sendUser(chatId, typed);
      await rig.host.settle();
      expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
      const ask = (await chips(rig, chatId)).find((c) => c.kind === "check");
      expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "roll" })).applied).toBe(true);
      const reply = await rig.host.start(chatId, { type: "regenerate" });
      const outcome = rig.host.section("Outcome");
      await rig.host.finish(reply, "You talk.");
      return { ask: ask?.detail ?? "", outcome };
    };
    for (const typed of TYPED) {
      const { ask, outcome } = await asked(typed, [VEX]);
      expect(outcome).toMatch(/Persuasion check\b.*Jordan Ellis \(hard\)/);
      expect({ typed, asked: /Vex|Morrow/.test(ask), told: /Vex|Morrow/.test(outcome) }).toEqual({ typed, asked: typed.includes("Vex"), told: typed.includes("Vex") });
    }
    // The player's own words: the narrator is told the attempt as in a world without anyone hidden by them.
    const own = TYPED[1] ?? "";
    const attempt = 'Persuasion check for "talk my way past Vex Morrow"';
    expect((await asked(own, [])).outcome).toContain(attempt);
    expect((await asked(own, [VEX])).outcome).toContain(attempt);
  });

  test("the intent gate's card says it only when the player typed it", async () => {
    for (const typed of TYPED) {
      const { rig, chatId } = await chat({}, { puts: [VEX], patch: { gates: { intent: true } } });
      reading(rig, PAST);
      rig.host.sendUser(chatId, typed);
      await rig.host.settle();
      await rig.host.start(chatId, { type: "normal" });
      const gate = (await chips(rig, chatId)).find((c) => c.kind === "intent_gate");
      expect(gate?.label).toBe(typed.includes("Vex") ? "Play Persuasion check: “talk my way past Vex Morrow”, looking hard?" : "Play Persuasion check, looking hard?");
    }
  });
});

describe("the chat's policy", () => {
  test("off keeps typed text reading the world's skill actions, as before inferred checks, and offers no Try something", async () => {
    // The Fifth profile's Use a skill, and on Port Alder's own sheet the Sheets pack's Attempt, whose Mechanics stat it rolls.
    const cases = [
      { profile: "fifth" as const, action: "skill_check", params: { skill: "investigation", difficulty: "moderate" }, said: "I use my Investigation skill on the engine.", label: /^Use a skill: / },
      { profile: null, action: "attempt", params: { stat: "mechanics", difficulty: "moderate" }, said: "I use my Mechanics skill on the engine.", label: /^Attempt: / },
    ];
    for (const c of cases) {
      const { rig, chatId } = await chat({ mode: "off" }, { profile: c.profile });
      const prompts: string[] = [];
      rig.host.quietReply = (req: QuietRequest) => {
        const system = req.messages[0]?.content ?? "";
        if (!system.includes(INTERPRET)) return "{}";
        prompts.push(system);
        return JSON.stringify({ confidence: 0.9, action: c.action, params: c.params });
      };
      await rig.turn(chatId, c.said, "You get to work.");
      const catalog = prompts[0]?.split("Action catalog:\n")[1]?.split("\nRules:")[0] ?? "";
      const ids = catalog.split("\n").map((l) => l.split(" — ")[0]);
      expect(ids).toContain(c.action);
      expect(ids).not.toContain("try");
      // Read as the world's own action, it rolls that action's check.
      expect((await chips(rig, chatId)).find((x) => x.kind === "roll")?.label).toMatch(c.label);
    }
  });

  test("suggest gives a chip with nothing generated, and Roll plays the message with the roll", async () => {
    const { rig, chatId } = await chat({ mode: "suggest" });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    rig.host.sendUser(chatId, "I try to talk my way in.");
    await rig.host.settle();
    const halted = await rig.host.start(chatId, { type: "normal" });
    expect(halted.halted).toBe("cancelled");
    const ask = (await chips(rig, chatId)).find((c) => c.kind === "check");
    expect(ask).toMatchObject({ label: "Roll Persuasion?", actions: [{ id: "roll", label: "Roll" }, { id: "drop", label: "No roll" }] });
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "roll" })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(reply, "You talk.");
    expect((await chips(rig, chatId)).find((c) => c.kind === "roll")?.label).toMatch(/^Persuasion check: /);
  });

  test("a new reply after a reply suggests no check again for the message the turn before played, and rolls nothing more", async () => {
    const { rig, chatId } = await chat({ mode: "suggest" });
    let reads = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET)) return "{}";
      reads++;
      return JSON.stringify({ confidence: 0.9, ...tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }) });
    };
    rig.host.sendUser(chatId, "I try to talk my way in.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: (await chips(rig, chatId)).find((c) => c.kind === "check")?.id, choice: "roll" }));
    const played = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(played, "You talk.");
    const rolled = checks(await events(rig, chatId)).length;
    // Send, with nothing typed: the reply after that one goes out, and the talk isn't asked about or rolled again.
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    expect(reads).toBe(1);
    expect((await chips(rig, chatId)).some((c) => c.kind === "check")).toBe(false);
    await rig.host.finish(reply, "The door stays shut.");
    expect(checks(await events(rig, chatId))).toHaveLength(rolled);
  });

  test("'only when the message says it tries' holds: a read that doesn't say so plays as roleplay", async () => {
    const { rig, chatId } = await chat({ when: "tries" });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(false);
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard", tried: true }));
    await rig.turn(chatId, "I try to talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(true);
  });

  test("the skills list restricts what can be inferred", async () => {
    const { rig, chatId } = await chat({ skills: ["stealth"] });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I try to talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(false);
  });

  test("the most rolls a turn holds: past it a companion doesn't roll, and an opponent sets the difficulty without a roll", async () => {
    const { rig, chatId } = await chat({ who: "everyone", most: 2 });
    reading(rig, tryRead({ attempt: "sneak past", skill: "stealth", difficulty: "moderate", with: ["danny_okafor", "jess_kowalczyk"], against: [{ who: "bouncer", skill: "perception" }] }));
    await rig.turn(chatId, "We sneak past.", "You creep.");
    expect(checks(await events(rig, chatId)).map((c) => c.actor)).toEqual(["danny_okafor"]);
  });

  test("a catalog action with its own check keeps it, and an inferred check beside it isn't doubled", async () => {
    const climb: JsonObject = { id: "climb", label: "Climb the wall", params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
    const { rig, chatId } = await chat({}, { puts: [["actions", climb]] });
    reading(rig, { action: "climb", params: {}, more: [{ action: "try", params: { attempt: "climb the wall", skill: "athletics", difficulty: "moderate" }, text: "I try to climb the wall" }] });
    await rig.turn(chatId, "I try to climb the wall.", "You climb.");
    expect((await chips(rig, chatId)).filter((c) => c.kind === "roll").map((c) => c.label)).toEqual([expect.stringMatching(/^Climb the wall: /)]);
    expect((await chips(rig, chatId)).some((c) => c.kind === "choice" && c.label.includes("climb"))).toBe(false);
  });
});

describe("where a chat's policy comes from", () => {
  const inferOf = (world: WorldDoc, settings = defaultSettings()): InferredChecks | undefined => {
    const m = startMarkersFrom(settings, world, "rev").find((b) => b.kind === "infer");
    return m?.kind === "infer" ? m.to : undefined;
  };
  const authored = { ...INFERRED_PRESETS.grounded, most: 5 };
  const mine = { ...INFERRED_PRESETS.story, mode: "suggest" as const, most: 2 };

  test("the world's default, then the user's setting, then the chat's own marker", async () => {
    const plain = baseWorld();
    const ruled = baseWorld({ ruleset: { inferred: authored } });
    // Neither sets one: the chat's starting realism preset (Story) at its Sheets level.
    expect(inferOf(plain)).toEqual(INFERRED_PRESETS.story);
    expect(inferOf(ruled)).toEqual(authored);
    expect(inferOf(plain, { ...defaultSettings(), inferred: mine })).toEqual(mine);
    expect(inferOf(ruled, { ...defaultSettings(), inferred: mine })).toEqual(authored);
    expect(inferOf(ruled, { ...defaultSettings(), inferred: mine, overrideWorldAdjudication: true })).toEqual(mine);
    const { rig, chatId } = await chat({ most: 4 });
    const most = async () => (await rig.rt.view(chatId, rig.host.userId)).controls?.inferred.most;
    expect(await most()).toBe(4);
    reading(rig, { action: null, params: {} });
    await rig.turn(chatId, "Hello.", "Hi.");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "infer", to: { ...INFERRED_PRESETS.simulation, most: 7 } as unknown as JsonObject }));
    expect(await most()).toBe(7);
  });

  test("a Story chat older than the policy (no infer marker) rolls an attempt it says it tries, without pausing on a chip", async () => {
    // Story's realism, the user's own over the world's, and no policy of anyone's.
    const { rig, chatId: played } = await chat(null, { patch: { overrideWorldDefaults: true } });
    reading(rig, { action: null, params: {} });
    await rig.turn(played, "Hello.", "Hi.");
    // As a chat an earlier build started: its starting markers hold none for inferred checks.
    for (const m of rig.host.chat(played).messages) {
      const stored = m.bag[LEDGER_NAMESPACE];
      if (isRecord(stored) && Array.isArray(stored.markers)) m.bag = { ...m.bag, [LEDGER_NAMESPACE]: { ...stored, markers: stored.markers.filter((mk) => !(isRecord(mk) && mk.kind === "infer")) } };
    }
    const chatId = rig.host.importCopy(played);
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect(Object.values(core?.journal.messages ?? {}).flatMap((jm) => jm.ledger.markers.map((mk) => mk.kind))).not.toContain("infer");
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.inferred).toEqual(INFERRED_PRESETS.story);
    reading(rig, tryRead({ attempt: "talk my way past the door", skill: "persuasion", difficulty: "hard", tried: true }));
    await rig.turn(chatId, "I try to talk my way past the door.", "You talk.");
    const after = await chips(rig, chatId);
    expect(after.some((c) => c.kind === "check")).toBe(false);
    expect(after.find((c) => c.kind === "roll")?.label).toMatch(/^Persuasion check: /);
  });
});
