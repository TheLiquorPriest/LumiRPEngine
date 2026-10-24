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
  test("chatting with someone meets the social need as the chat ends", () => {
    const w = setup((world) => {
      world.entities.you!.fields.place = "apartment_hall";
    });
    to(w, todayAt(w, 18 * 60));
    expect(needValue(w.ctx, "you", "social")).toBeGreaterThan(30);
    const chat = resolveAction(reg, w, { action: "chat_with", params: { target: "rosa" } }, createRng("c"));
    expect(chat.ok).toBe(true);
    to(w, w.state.clock + chat.duration);
    expect(needValue(w.ctx, "you", "social")).toBe(0);
  });
});

describe("stated durations", () => {
  test("“rest for an hour” takes an hour, and a rest with none stated its usual half hour", () => {
    const w = setup();
    const read = typedIntent(reg, w.world, w.state, "I rest for an hour");
    expect(read?.action).toBe("rest");
    const rest = resolveAction(reg, w, { action: "rest", params: read?.params ?? {} }, createRng("r"));
    expect(rest.duration).toBe(60);
    expect(rest.activity?.until).toBe(w.state.clock + 60);
    expect(resolveAction(reg, setup(), { action: "rest", params: {} }, createRng("r")).duration).toBe(30);
    const talk = typedIntent(reg, w.world, w.state, "I talk to Rosa for two hours");
    expect(talk?.params.minutes).toBe(120);
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
