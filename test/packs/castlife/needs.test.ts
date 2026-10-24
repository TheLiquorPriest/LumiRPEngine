// Needs and everyday actions (DESIGN §8): the world's needs settings, Play's Needs, needs met when
// what meets them ends and through skips, company and chatting, stated lengths, and beds.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { JsonValue } from "../../../src/shared/json";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, dateAt } from "../../../src/engine/calendar";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { planTurn, timelapseIntent, type EngineTurnPlan } from "../../../src/engine/turn";
import { advance } from "../../../src/engine/simulate";
import { placeOfEntity } from "../../../src/engine/scope";
import { typedIntent } from "../../../src/engine/typed-intent";
import { Working } from "../../../src/engine/working";
import { destinations } from "../../../src/frontend/play/play";
import { UI_PACKS } from "../../../src/frontend/packs";
import { buildCatalog } from "../../../src/frontend/ui-registry";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildNeedsView, dayPlan, needValue } from "../../../src/packs/castlife/core/index";
import { decodeNeedsView } from "../../../src/packs/castlife/ui/needs";
import type { StateView } from "../../../src/shared/state-view";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.castlife = 4;
  world.realism.levels.relationships = 4;
  patch(world);
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
function play(w: Working, seed: string, intent: { action: string; params: Record<string, JsonValue>; probabilities: Record<string, number> }, text = ""): EngineTurnPlan {
  const plan = planTurn({ registry: reg, world: w.world, state: w.state, runSeed: "run", seed, kind: "normal", userTexts: [text], intent });
  w.applyAll(plan.events);
  return plan;
}

describe("what a skip meets (the replay review)", () => {
  test("a skip meets no need for time the player character spent in ordinary play", () => {
    const w = setup((world) => {
      world.entities.you!.fields.place = "apartment_hall";
    });
    // A day alone in ordinary play: everyone else at the apartment goes out, and the turns run it to 19:30.
    w.applyAll(Object.keys(w.state.entities).filter((id) => id !== "you" && placeOfEntity(w.state, id) === "apartment_hall" && w.state.entities[id]?.kind !== "item").map((id): LedgerEvent => ({ type: "set", entity: id, field: "place", value: "cafe" })));
    advance(reg, w, todayAt(w, 19 * 60 + 30), { runSeed: "run", mode: "turn", cause: "tick" });
    const before = needValue(w.ctx, "you", "social");
    expect(before).toBeGreaterThan(30);
    // Rosa comes over, then half an hour passes: she was no company for the day before she came.
    w.apply({ type: "set", entity: "rosa", field: "place", value: "apartment_hall" });
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
