// Needs and everyday actions (DESIGN §8): the world's needs settings, Play's Needs, needs met when
// what meets them ends and through skips, company and chatting, stated lengths, and beds.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { JsonValue } from "../../../src/shared/json";
import { ACTIVITY_SPAN_OF, type WorldDoc } from "../../../src/shared/world";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY } from "../../../src/shared/minds";
import { mindContext } from "../../../src/backend/minds-context";
import { buildCharacter } from "../../../src/engine/character";
import { buildGmWorld } from "../../../src/engine/gm-view";
import { calendarOf, clockAt, dateAt } from "../../../src/engine/calendar";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { applyTimeAdvance, runTimelapse } from "../../../src/engine/time";
import type { InterpretOutput } from "../../../src/engine/steps";
import { NEED_IDS } from "../../../src/shared/needs";
import { planTurn, timelapseIntent, type EngineTurnPlan } from "../../../src/engine/turn";
import { advance } from "../../../src/engine/simulate";
import { typedIntent } from "../../../src/engine/typed-intent";
import { Working } from "../../../src/engine/working";
import { destinations } from "../../../src/frontend/play/play";
import { UI_PACKS } from "../../../src/frontend/packs";
import { buildCatalog } from "../../../src/frontend/ui-registry";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildNeedsView, dayPlan, needValue } from "../../../src/packs/castlife/core/index";
import { decodeNeedsView, NeedsPanel } from "../../../src/packs/castlife/ui/needs";
import type { PanelProps } from "../../../src/frontend/registry";
import { propsOf } from "../../support/tree";
import type { StateView } from "../../../src/shared/state-view";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with castlife and relationships at 4, as every test here plays it. */
function testWorld(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const world = modernUsWorld("w", "R");
  world.realism.levels.castlife = 4;
  world.realism.levels.relationships = 4;
  patch(world);
  return world;
}

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = testWorld(patch);
  return new Working(reg, world, startState(world));
}

/** The clock at a time of day on the world's first day (its start is 07:30). */
function todayAt(w: Working, minuteOfDay: number): number {
  const cal = calendarOf(w.world);
  return clockAt(cal, dateAt(cal, w.state.clock).dayIndex, minuteOfDay);
}

function to(w: Working, at: number): void {
  w.apply({ type: "clock", minutes: at - w.state.clock, cause: "advance" });
}

/** The People section's lead line: the POV and the needs the narrator is told of. */
function povLine(w: Working): string {
  return reg.renderers.filter((r) => r.slot === "people" && r.hint !== true).flatMap((r) => r.render(w.ctx))[0] ?? "";
}

describe("needs settings (world.needs)", () => {
  test("a need switched off never grows, shows, is told or alerts", () => {
    const w = setup((world) => {
      world.needs = { fatigue: { on: false } };
    });
    to(w, todayAt(w, 23 * 60));
    expect(needValue(w.ctx, "you", "fatigue")).toBe(0);
    expect(buildNeedsView(w.ctx)?.needs.map((n) => n.need)).toEqual(["hunger", "social", "fun"]);
    expect(povLine(w)).not.toContain("tired");
    // A skip that would cross its alert point raises no alert for it.
    const out = runTimelapse(reg, w, { type: "duration", minutes: 24 * 60 }, { runSeed: "s", overrides: { needs: "note" } });
    if ("code" in out) throw new Error(out.reason);
    expect(w.events.some((e) => e.type === "engine.signal" && "data" in e && e.data.class === "needs" && String(e.data.text).includes("tired"))).toBe(false);
  });

  test("a world's rate sets how fast a need grows", () => {
    const plain = setup();
    const quick = setup((world) => {
      world.needs = { hunger: { rate: 10 } };
    });
    for (const w of [plain, quick]) to(w, w.state.clock + 120);
    expect(needValue(plain.ctx, "you", "hunger")).toBeCloseTo(28, 5);
    expect(needValue(quick.ctx, "you", "hunger")).toBeCloseTo(40, 5);
  });

  test("the point a world tells a need at is when the narrator hears of it", () => {
    const w = setup((world) => {
      world.needs = { hunger: { tell: 25 } };
    });
    to(w, w.state.clock + 120);
    expect(povLine(w)).toContain("hungry");
    expect(buildNeedsView(w.ctx)?.needs.find((n) => n.need === "hunger")?.pressing).toBe(true);
  });
});

describe("Needs in Play", () => {
  test("the player character's needs show on Me from Cast life 4, and not below it", () => {
    const w = setup();
    const view = buildNeedsView(w.ctx) as unknown as JsonValue;
    expect(decodeNeedsView(view)?.map((n) => [n.need, n.value])).toEqual([
      ["hunger", 20],
      ["fatigue", 20],
      ["social", 20],
      ["fun", 20],
    ]);
    const catalog = buildCatalog(UI_PACKS);
    const me = destinations(catalog, { panels: { "castlife.needs": view }, pending: [] } as unknown as StateView).find((d) => d.id === "me");
    expect(me?.panels.map((p) => p.id)).toContain("castlife.needs");
    const story = setup((world) => {
      world.realism.levels.castlife = 3;
    });
    expect(buildNeedsView(story.ctx)).toBeNull();
  });

  test("each need on Me says from which point it's told, or that it is, and what meets it", () => {
    const w = setup((world) => {
      world.needs = { hunger: { tell: 25 } };
    });
    to(w, w.state.clock + 120);
    const view = buildNeedsView(w.ctx) as unknown as JsonValue;
    const rows = decodeNeedsView(view) ?? [];
    expect(rows.find((r) => r.need === "hunger")?.pressing).toBe(true);
    const tree = NeedsPanel({ chatId: "c", view, state: {} as StateView, send: async () => ({}) } as unknown as PanelProps);
    const lines = propsOf(tree, "p").filter((p) => String(p.class).includes("lre-need-line")).map((p) => String(p.children));
    expect(lines).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      expect(row.metBy).not.toBe("");
      expect(lines[i]).toContain(row.metBy);
      // Not yet pressing: the world's own point it's told from; pressing: the narrator's word for it.
      expect(lines[i]).toContain(row.pressing ? row.label : String(row.tell));
    });
    expect(rows.find((r) => r.need === "fatigue")?.tell).toBe(60);
  });
});

describe("needs met when what meets them ends", () => {
  test("a meal meets hunger at its end, so the need grows again only from then", () => {
    const w = setup();
    to(w, todayAt(w, 12 * 60));
    const ate = resolveAction(reg, w, { action: "eat", params: {} }, createRng("e"));
    expect(ate.ok).toBe(true);
    to(w, w.state.clock + ate.duration);
    expect(needValue(w.ctx, "you", "hunger")).toBe(0);
  });

  test("after a skip through the night the player character is rested", () => {
    const w = setup();
    to(w, todayAt(w, 22 * 60));
    expect(needValue(w.ctx, "you", "fatigue")).toBeGreaterThan(50);
    // A palette Timelapse to the morning, with no Go to bed: they sleep through it by their routine.
    const out = runTimelapse(reg, w, { type: "at", at: todayAt(w, 24 * 60 + 7 * 60) }, { runSeed: "night" });
    if ("code" in out) throw new Error(out.reason);
    expect(needValue(w.ctx, "you", "fatigue")).toBeLessThan(10);
  });

  test("Go to bed and a speed-through to the morning rest the player character; getting up again doesn't", () => {
    const slept = setup();
    to(slept, todayAt(slept, 22 * 60));
    const bed = resolveAction(reg, slept, { action: "sleep", params: {} }, createRng("b"));
    if (!bed.activity) throw new Error("no sleep");
    const out = runTimelapse(reg, slept, { type: "at", at: bed.activity.until }, { runSeed: "night" });
    if ("code" in out) throw new Error(out.reason);
    expect(needValue(slept.ctx, "you", "fatigue")).toBeLessThan(10);
    const up = setup();
    to(up, todayAt(up, 22 * 60));
    const before = needValue(up.ctx, "you", "fatigue");
    resolveAction(reg, up, { action: "sleep", params: {} }, createRng("b"));
    to(up, up.state.clock + 30);
    expect(needValue(up.ctx, "you", "fatigue")).toBeGreaterThan(before);
  });
});

describe("company and fun", () => {
  test("a chat in a turn meets the social need as it ends, for as long as it was said to last", () => {
    const w = setup((world) => {
      world.entities.you!.fields.place = "apartment_hall";
    });
    to(w, todayAt(w, 18 * 60));
    expect(needValue(w.ctx, "you", "social")).toBeGreaterThan(30);
    const plan = planTurn({ registry: reg, world: w.world, state: w.state, runSeed: "run", seed: "chat", kind: "normal", userTexts: ["I talk to Rosa for an hour"], intent: { action: "chat_with", params: { target: "rosa", minutes: 60 }, probabilities: { chat_with: 1 } } });
    expect(plan.elapsedMinutes).toBe(60);
    const end = w.state.clock + 60;
    w.applyAll(plan.events);
    expect(w.state.clock).toBe(end);
    expect(needValue(w.ctx, "you", "social")).toBe(0);
    // Met as the chat ended, not as it began: it grows again from the end.
    expect(needValue(w.ctx, "you", "social", end + 120)).toBeCloseTo(3, 5);
  });
});

describe("stated durations", () => {
  test("“rest for an hour” passes within the turn, under its Speed through threshold, and meets fun as it ends", () => {
    const w = setup();
    const read = typedIntent(reg, w.world, w.state, "I rest for an hour");
    expect(read?.action).toBe("rest");
    expect(play(w, "rest", { action: "rest", params: read?.params ?? {}, probabilities: { rest: 1 } }, "I rest for an hour").elapsedMinutes).toBe(60);
    expect(needValue(w.ctx, "you", "fun")).toBe(0);
    expect(play(setup(), "rest", { action: "rest", params: {}, probabilities: { rest: 1 } }, "I rest").elapsedMinutes).toBe(30);
    const talk = typedIntent(reg, w.world, w.state, "I talk to Rosa for two hours");
    expect(talk?.params.minutes).toBe(120);
  });

  test("a rest stated past the threshold plays its half hour and offers the rest; a shorter one takes its own length", () => {
    const w = setup();
    const before = needValue(w.ctx, "you", "fun");
    const long = play(w, "rest", { action: "rest", params: { minutes: 180 }, probabilities: { rest: 1 } }, "I rest for three hours");
    expect(long.elapsedMinutes).toBe(30);
    expect(long.chips.some((c) => c.kind === "timelapse_offer")).toBe(true);
    // Not met yet: the three hours are the Speed through's.
    expect(needValue(w.ctx, "you", "fun")).toBeGreaterThan(before);
    expect(play(setup(), "rest", { action: "rest", params: { minutes: 10 }, probabilities: { rest: 1 } }, "I rest for ten minutes").elapsedMinutes).toBe(10);
  });
});

describe("beds", () => {
  test("someone with a bed sleeps there, and Go to bed takes the player character to theirs", () => {
    const w = setup((world) => {
      world.places.back_room = { id: "back_room", name: "Back room", parent: "riverton", fields: {} };
      world.entities.maya!.fields.bed = "back_room";
      world.entities.cot = { id: "cot", kind: "item", name: "Camp cot", tier: "background", fields: { place: "garage" }, relations: [] };
      world.entities.you!.fields.bed = "cot";
    });
    const nights = dayPlan(w.ctx, "maya").blocks.filter((b) => b.activity === "sleep");
    expect(nights.length).toBeGreaterThan(0);
    for (const b of nights) expect(b.place).toBe("back_room");
    const bed = resolveAction(reg, w, { action: "sleep", params: {} }, createRng("b"));
    expect(bed.ok).toBe(true);
    expect(w.state.entities.you?.fields.place).toBe("garage");
  });

  test("no player surface names a secret bed", () => {
    const secret = "The Hollow Oak";
    const w = setup((world) => {
      world.places.hollow = { id: "hollow", name: secret, parent: "riverton", fields: {}, visibility: "secret" };
      world.entities.maya!.fields.bed = "hollow";
    });
    expect(dayPlan(w.ctx, "maya").blocks.some((b) => b.activity === "sleep" && b.place === "hollow")).toBe(true);
    const start = w.events.length;
    const out = runTimelapse(reg, w, { type: "duration", minutes: 24 * 60 }, { runSeed: "night" });
    if ("code" in out) throw new Error(out.reason);
    const events: LedgerEvent[] = w.events.slice(start);
    const panels = reg.views.map((v) => JSON.stringify(v.build(w.ctx, { mapDisplay: null })));
    expect(panels.some((p) => p.includes(secret))).toBe(false);
    expect(playerLines(reg, w.world, w.state, "you", events, 200).some((l) => l.includes(secret))).toBe(false);
  });
});

/** Plays a turn on the working state, as a chat does: its events applied, its plan returned. */
function play(w: Working, seed: string, intent: InterpretOutput, text = ""): EngineTurnPlan {
  const plan = planTurn({ registry: reg, world: w.world, state: w.state, runSeed: "run", seed, kind: "normal", userTexts: [text], intent });
  w.applyAll(plan.events);
  return plan;
}

describe("what a skip meets (the replay review)", () => {
  test("a skip meets no need for time the player character spent in ordinary play", () => {
    const w = setup();
    // A day alone in ordinary play, at home in the apartment, until 19:30: no one they know comes by.
    advance(reg, w, todayAt(w, 19 * 60 + 30), { runSeed: "run", mode: "turn", cause: "tick" });
    const before = needValue(w.ctx, "you", "social");
    expect(before).toBeGreaterThan(30);
    // Rosa comes over, then half an hour passes: she was no company for the day before she came.
    w.apply({ type: "set", entity: "rosa", field: "place", value: "apartment" });
    const skip = play(w, "skip", timelapseIntent({ type: "duration", minutes: 30 }));
    expect(skip.events.some((e) => e.type === "castlife.need" && "data" in e && e.data.need === "social")).toBe(false);
    expect(needValue(w.ctx, "you", "social")).toBeGreaterThan(before);
  });

  test("a stated nap takes its length, and meets fatigue as it ends", () => {
    const w = setup();
    to(w, todayAt(w, 14 * 60));
    const before = needValue(w.ctx, "you", "fatigue");
    const nap = play(w, "nap", { action: "sleep", params: { minutes: 20 }, probabilities: { sleep: 1 } }, "I sleep for 20 minutes.");
    expect(nap.elapsedMinutes).toBe(20);
    expect(needValue(w.ctx, "you", "fatigue")).toBeLessThan(before);
  });

  test("“sleep for eight hours” plays five minutes and offers a Speed through to its end, which rests them as it ends", () => {
    const w = setup();
    to(w, todayAt(w, 14 * 60));
    const end = w.state.clock + 480;
    const bed = play(w, "nap", { action: "sleep", params: { minutes: 480 }, probabilities: { sleep: 1 } }, "I sleep for eight hours.");
    expect(bed.elapsedMinutes).toBe(5);
    const offer = bed.chips.find((c) => c.kind === "timelapse_offer");
    if (!offer || offer.kind !== "timelapse_offer") throw new Error("no speed-through offered");
    expect(offer.target).toEqual({ type: "at", at: end });
    // Not slept yet: going to bed alone meets nothing.
    expect(needValue(w.ctx, "you", "fatigue")).toBeGreaterThan(30);
    // Taken as the chip sends it (`dispatch`: its payload's hold), the span is theirs: no routine wakes them for dinner.
    play(w, "sleep", timelapseIntent(offer.target, undefined, 1, offer.povRoutine !== false));
    expect(w.state.clock).toBe(end);
    expect(w.state.entities.you?.fields.activity).toBe("sleep");
    expect(needValue(w.ctx, "you", "fatigue")).toBe(0);
  });

  test("under Speed through `auto`, “sleep for eight hours” runs the Timelapse itself", () => {
    const w = setup();
    w.state.time.speedThrough = { ...w.state.time.speedThrough, sleep: { mode: "auto", thresholdMinutes: 30 } };
    to(w, todayAt(w, 14 * 60));
    const end = w.state.clock + 480;
    const bed = play(w, "nap", { action: "sleep", params: { minutes: 480 }, probabilities: { sleep: 1 } }, "I sleep for eight hours.");
    expect(bed.timelapse).not.toBeNull();
    expect(bed.chips.some((c) => c.kind === "timelapse_offer")).toBe(false);
    expect(w.state.clock).toBe(end);
    expect(w.state.entities.you?.fields.activity).toBe("sleep");
    expect(needValue(w.ctx, "you", "fatigue")).toBe(0);
  });

  test("going to bed at 23:00 and speeding through the night is rested by 07:00, when the night ends", () => {
    const w = setup();
    to(w, todayAt(w, 23 * 60));
    const bed = play(w, "bed", { action: "sleep", params: {}, probabilities: { sleep: 1 } }, "I go to bed.");
    const offer = bed.chips.find((c) => c.kind === "timelapse_offer");
    if (!offer || offer.kind !== "timelapse_offer") throw new Error("no speed-through offered");
    play(w, "night", timelapseIntent(offer.target));
    expect(w.state.clock).toBe(todayAt(w, 7 * 60));
    expect(needValue(w.ctx, "you", "fatigue")).toBe(0);
  });

  test("Play marks a need pressing exactly when the narrator is told of it", () => {
    const w = setup();
    // Hunger 59.6 an instant before the told point of 60: neither says it, though the gauge rounds to 60.
    to(w, w.state.clock + 9 * 60 + 54);
    const hunger = (): { value: number; pressing: boolean } | undefined => buildNeedsView(w.ctx)?.needs.find((n) => n.need === "hunger");
    expect(hunger()).toMatchObject({ value: 60, pressing: false });
    expect(povLine(w)).not.toContain("hungry");
    to(w, w.state.clock + 6);
    expect(hunger()?.pressing).toBe(true);
    expect(povLine(w)).toContain("hungry");
  });
});

describe("needs an ordinary turn lives", () => {
  /** The POV at the hall; dinner, a long bath and an hour's reading are world actions with no effect on needs. */
  function atHall(world: WorldDoc): void {
    world.entities.you!.fields.place = "apartment_hall";
    world.actions.dine = { id: "dine", label: "Have dinner", params: {}, requires: [], outcomes: { default: [] }, duration: "45", activity: { type: "dinner", until: "clock + 45" } };
    // Leisure has no Speed through policy, so the bath's span runs on past the turn that begins it.
    world.actions.bath = { id: "bath", label: "Run a long bath", params: {}, requires: [], outcomes: { default: [] }, duration: "10", activity: { type: "leisure", until: "clock + 120" } };
    world.actions.read = { id: "read", label: "Read", params: {}, requires: [], outcomes: { default: [] }, duration: "60" };
  }

  /** The POV at the hall, knowing Rosa, who is there. */
  function hall(patch: (w: WorldDoc) => void = () => undefined): Working {
    const w = setup((world) => {
      atHall(world);
      patch(world);
    });
    w.apply({ type: "link", rel: "knows", from: "you", to: "rosa" });
    return w;
  }

  /** Whether a need is past the point the narrator hears of it (Play's mark and the narrator's line read the same). */
  const told = (w: Working, need: string): boolean => buildNeedsView(w.ctx)?.needs.find((n) => n.need === need)?.pressing === true;

  /** When these events met a need. */
  const metAtOf = (events: readonly LedgerEvent[], need: string): number[] => events.flatMap((e) => (e.type === "castlife.need" && "data" in e && e.data.need === need && typeof e.data.at === "number" ? [e.data.at] : []));

  const intent = (action: string, params: Record<string, JsonValue> = {}) => ({ action, params, probabilities: { [action]: 1 } });

  /** An afternoon of three hour-long ordinary turns at the hall, Rosa there or gone out; the last turn's events with it. */
  function afternoon(withRosa: boolean): { w: Working; last: readonly LedgerEvent[] } {
    const w = hall((world) => {
      world.needs = { social: { tell: 30 } };
    });
    if (!withRosa) w.apply({ type: "set", entity: "rosa", field: "place", value: "cafe" });
    to(w, todayAt(w, 13 * 60));
    let last: readonly LedgerEvent[] = [];
    for (let i = 0; i < 3; i++) last = play(w, `turn${i}`, intent("read"), "I read for an hour.").events;
    return { w, last };
  }

  test("three ordinary turns over an afternoon with someone they know keep social below the point it's told; alone, they don't", () => {
    const company = afternoon(true);
    const alone = afternoon(false);
    expect(company.w.state.clock).toBe(alone.w.state.clock);
    expect(told(company.w, "social")).toBe(false);
    expect(told(alone.w, "social")).toBe(true);
    // The company the turn's own time gave is bookkeeping: its "what changed" never says so turn after turn.
    const social = company.last.filter((e) => e.type === "castlife.need" && "data" in e && e.data.need === "social");
    expect(social.length).toBeGreaterThan(0);
    expect(playerLines(reg, company.w.world, company.w.state, "you", social)).toEqual([]);
  });

  test("an activity a turn gives them that ends within it meets its needs at its end", () => {
    const w = hall();
    to(w, todayAt(w, 18 * 60));
    expect(needValue(w.ctx, "you", "hunger")).toBeGreaterThan(30);
    const end = w.state.clock + 45;
    play(w, "dine", intent("dine"), "I have dinner.");
    expect(w.state.clock).toBe(end);
    expect(needValue(w.ctx, "you", "hunger")).toBe(0);
    // Met as dinner ended, so it grows again from then.
    expect(needValue(w.ctx, "you", "hunger", end + 60)).toBeCloseTo(4, 5);
  });

  test("“Not an action?” takes back the need the action's activity met, with the activity", () => {
    const w = hall();
    to(w, todayAt(w, 18 * 60));
    const start = structuredClone(w.state);
    const plan = play(w, "dine", intent("dine"), "I have dinner.");
    // The chip's Undo takes the turn's actions' own events (`runtime.ts`, its payload): what's left of the record without them.
    const undone = new Set(plan.resolutions.flatMap((r) => r.events.map((e) => JSON.stringify(e))));
    const kept = plan.events.filter((e) => !undone.has(JSON.stringify(e)));
    const after = fold(reg, w.world, start, kept);
    expect(after.entities.you?.fields.activity).not.toBe("dinner");
    expect(needValue(reg.context(w.world, after), "you", "hunger")).toBeGreaterThan(30);
  });

  test("a meal after a nap they got up from is met once, whatever time passes after", () => {
    const w = hall();
    to(w, todayAt(w, 13 * 60));
    const nap = play(w, "nap", intent("sleep", { minutes: 120 }), "I lie down for a two-hour nap.");
    expect(nap.chips.some((c) => c.kind === "timelapse_offer")).toBe(true);
    // They don't take it: they get up and eat, the reply tells half an hour passing, and turns go on past the nap's end.
    const eat = play(w, "eat", intent("eat"), "I get up and eat a sandwich.");
    expect(metAtOf(eat.events, "hunger")).toHaveLength(1);
    const mark = w.events.length;
    expect(applyTimeAdvance(reg, w, 30, { runSeed: "run", capMinutes: 24 * 60 }).applied).toBe(true);
    for (let i = 0; i < 2; i++) play(w, `read${i}`, intent("read"), "I read.");
    expect(metAtOf(w.events.slice(mark), "hunger")).toEqual([]);
  });

  test("an activity set without a span of its own never takes the end another activity left", () => {
    const w = hall();
    to(w, todayAt(w, 18 * 60));
    // A long bath whose span runs on past the turn, then a bite to eat, which sets the activity with no span.
    const turn = play(w, "bath", { ...intent("bath"), queue: [{ action: "eat", params: {}, text: "I eat something." }] }, "I run a bath, then eat something.");
    expect(w.state.entities.you?.fields.activity).toBe("meal");
    expect(metAtOf(turn.events, "hunger")).toHaveLength(1);
    const mark = w.events.length;
    expect(applyTimeAdvance(reg, w, 60, { runSeed: "run", capMinutes: 24 * 60 }).applied).toBe(true);
    expect(metAtOf(w.events.slice(mark), "hunger")).toEqual([]);
  });

  test("a Speed through turned down rests no one, however much time passes after", () => {
    const w = hall();
    to(w, todayAt(w, 13 * 60));
    const nap = play(w, "nap", intent("sleep", { minutes: 120 }), "I lie down for a two-hour nap.");
    expect(nap.chips.some((c) => c.kind === "timelapse_offer")).toBe(true);
    const mark = w.events.length;
    // The offer goes with the next message: they sit up and read instead, on past the nap's end, and the reply tells an hour passing.
    for (let i = 0; i < 2; i++) play(w, `read${i}`, intent("read"), "I can't sleep; I sit up and read.");
    expect(applyTimeAdvance(reg, w, 60, { runSeed: "run", capMinutes: 24 * 60 }).applied).toBe(true);
    expect(metAtOf(w.events.slice(mark), "fatigue")).toEqual([]);
  });

  test("an activity short enough to pass in turns is met as a later turn sees it out, and not when they stop it first", () => {
    const passed = hall();
    to(passed, todayAt(passed, 18 * 60));
    // The bath has no Speed through policy: its two hours pass in the turns that follow.
    const bath = play(passed, "bath", intent("bath"), "I run a bath.");
    expect(bath.chips.some((c) => c.kind === "timelapse_offer")).toBe(false);
    const ends = passed.state.clock - 10 + 120;
    const reading: LedgerEvent[] = [];
    for (let i = 0; i < 2; i++) reading.push(...play(passed, `read${i}`, intent("read"), "I read in the bath.").events);
    expect(metAtOf(reading, "fun")).toEqual([ends]);
    // Getting out to eat first ends it there: nothing of it is met after.
    const stopped = hall();
    to(stopped, todayAt(stopped, 18 * 60));
    play(stopped, "bath", intent("bath"), "I run a bath.");
    const after = [...play(stopped, "eat", intent("eat"), "I get out and eat.").events, ...play(stopped, "read", intent("read"), "I read.").events, ...play(stopped, "read2", intent("read"), "I read.").events];
    expect(metAtOf(after, "fun")).toEqual([]);
  });

  test("a skip right after the turns reads none of their time again", () => {
    // Alone, from 12:10: a nap they turn down by reading on, so it ends unmet as that turn begins;
    // Rosa is back as they end. A skip that read their time again would meet fatigue for the nap.
    const w = hall();
    w.apply({ type: "set", entity: "rosa", field: "place", value: "cafe" });
    to(w, todayAt(w, 12 * 60 + 10));
    play(w, "nap", intent("sleep", { minutes: 120 }), "I lie down for a two-hour nap.");
    play(w, "read", intent("read"), "I get up and read.");
    const end = w.state.clock;
    w.apply({ type: "set", entity: "rosa", field: "place", value: "apartment_hall" });
    const mark = w.events.length;
    const out = runTimelapse(reg, w, { type: "duration", minutes: 6 * 60 }, { runSeed: "run", povRoutine: false });
    if ("code" in out) throw new Error(out.reason);
    // The skip's own events as it made them, before a record coarsens them: it meets needs only in time it passes.
    const met = NEED_IDS.flatMap((need) => metAtOf(w.events.slice(mark), need));
    expect(met.length).toBeGreaterThan(0);
    expect(met.filter((at) => at <= end)).toEqual([]);
  });

  test("which activity a span was given for is the engine's own record: no field list or mind reads it", () => {
    const w = hall();
    to(w, todayAt(w, 13 * 60));
    play(w, "nap", intent("sleep", { minutes: 120 }), "I lie down for a two-hour nap.");
    // Rosa's own rest gives her a span too.
    expect(resolveAction(reg, w, { actor: "rosa", action: "rest", params: {} }, createRng("rosa")).ok).toBe(true);
    for (const who of ["you", "rosa"]) {
      expect(w.state.entities[who]?.fields[ACTIVITY_SPAN_OF]).toBeDefined();
      const gm = buildGmWorld(reg, w.world, w.state).entities.find((e) => e.id === who);
      expect(gm?.fields.map((f) => f.id)).not.toContain(ACTIVITY_SPAN_OF);
      const page = buildCharacter(reg, w.world, who, w.state);
      expect(page?.character.sections.flatMap((s) => s.fields.map((f) => f.id))).not.toContain(ACTIVITY_SPAN_OF);
    }
    const mind = mindContext({ reg, world: w.world, state: w.state, who: "rosa", memory: DEFAULT_MINDS_MEMORY, messages: [], hideJson: true, reads: DEFAULT_MIND_READS, moment: { kind: "turn", at: w.state.clock, reason: "", user: "", reply: "" } });
    expect(mind).not.toContain(ACTIVITY_SPAN_OF.replace(/_/g, " ").trim());
  });

  test("the record alone, folded on a fresh start, gives the needs the turns played", () => {
    const tuned = (world: WorldDoc): void => {
      world.needs = { social: { rate: 20 }, hunger: { rate: 10 } };
    };
    const w = hall(tuned);
    to(w, todayAt(w, 18 * 60));
    play(w, "dine", intent("dine"), "I have dinner.");
    play(w, "chat", intent("chat_with", { target: "rosa" }), "I talk with Rosa.");
    play(w, "read", intent("read"), "I read.");
    expect(w.events.some((e) => e.type === "castlife.need" && "data" in e && e.data.lived === true)).toBe(true);
    // Everything the chat recorded since its world began, folded on a start built afresh from the world.
    const world = testWorld((x) => {
      atHall(x);
      tuned(x);
    });
    const folded = fold(reg, world, startState(world), w.events);
    expect(folded.clock).toBe(w.state.clock);
    expect(folded.entities.you?.fields.needs).toEqual(w.state.entities.you?.fields.needs);
    for (const need of NEED_IDS) expect(needValue(reg.context(world, folded), "you", need)).toBeCloseTo(needValue(w.ctx, "you", need), 9);
  });
});
