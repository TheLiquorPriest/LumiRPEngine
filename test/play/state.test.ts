// A chat's state view, read from RPE's store: today's `StateView` whole, with every pack's panel; what
// a turn records shows in the panels at the chat's head, and a turn's own state is read at that turn;
// a chat that plays no world reads as today's chat that is not a world's; and one user's chat is not
// another's to read.

import { describe, expect, test } from "bun:test";
import type { StateView } from "../../src/shared/state-view";
import { CHAT, makeBed, OTHER, panel, registry, USER } from "./bed";

const SAID = { source: { from: "prose", message: "msg-said-1" } };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The view read as the page reads it, after it crossed the network as JSON, held to `StateView`'s type part by part: every part the
 * type declares is there, of the kind it declares.
 */
function holdsToType(view: StateView): void {
  const read: unknown = JSON.parse(JSON.stringify(view));
  if (!isObject(read)) throw new Error("not an object");
  expect(read.v).toBe(1);
  expect(typeof read.chatId).toBe("string");
  for (const key of ["worldId", "revision"]) expect(read[key] === null || typeof read[key] === "string").toBe(true);
  expect(typeof read.status === "string" && ["not_world", "idle", "in_flight", "paused"].includes(read.status)).toBe(true);
  for (const key of ["chips", "keepReport", "pending"]) expect(Array.isArray(read[key])).toBe(true);
  for (const key of ["replyClocks", "panels", "packs"]) expect(isObject(read[key])).toBe(true);
  for (const n of Object.values(read.packs as object)) expect(typeof n).toBe("number");
  expect(read.meter).toBeNull();
  const { hud, scene, palette, controls, currency } = read;
  if (!isObject(hud) || !isObject(hud.clock) || !isObject(scene) || !isObject(palette) || !isObject(controls) || !isObject(currency)) throw new Error("a part of a world chat's view is missing");
  expect({ minutes: typeof hud.clock.minutes, label: typeof hud.clock.label, dayPart: typeof hud.clock.dayPart, paused: typeof hud.clock.paused, scale: typeof hud.clock.scale }).toEqual({ minutes: "number", label: "string", dayPart: "string", paused: "boolean", scale: "number" });
  expect(isObject(hud.fixes)).toBe(true);
  expect({ sceneType: typeof scene.sceneType, elapsed: typeof scene.elapsed, present: Array.isArray(scene.present) }).toEqual({ sceneType: "string", elapsed: "number", present: true });
  expect(Array.isArray(palette.entries)).toBe(true);
  for (const part of ["realism", "time", "adjudication", "knowledge", "things", "offstage"]) expect(isObject(controls[part])).toBe(true);
  for (const part of ["sections", "sources"]) expect(Array.isArray(controls[part])).toBe(true);
  expect(typeof currency.decimals).toBe("number");
}

describe("the panels of a chat", () => {
  test("are today's state view whole, with a panel from every pack that registers one", async () => {
    const bed = makeBed();
    const { doc, revision } = await bed.plays("fantasy_town");
    await bed.turn();
    const view = await bed.state();
    holdsToType(view);
    expect({ chatId: view.chatId, worldId: view.worldId, revision: view.revision, status: view.status }).toEqual({ chatId: CHAT, worldId: doc.id, revision, status: "idle" });
    // No engine of today's plays the chat: today's pages draw none of today's harness parts for it.
    expect("engine" in view).toBe(false);
    // A panel read an item at a time when a page opens one (the organizations' pages) is no part of the view.
    expect(Object.keys(view.panels).sort()).toEqual(registry().views.filter((v) => v.apart !== true).map((v) => v.panel).sort());
    // Each built by its pack, none failing.
    expect(Object.entries(view.panels).filter(([, p]) => isObject(p) && "error" in p)).toEqual([]);
    expect(view.packs).toEqual(Object.fromEntries(registry().packs.map((p) => [p.id, p.version])));
    // What only today's ledger held is present and empty.
    expect({ chips: view.chips, replyClocks: view.replyClocks, keepReport: view.keepReport, pending: view.pending }).toEqual({ chips: [], replyClocks: {}, keepReport: [], pending: [] });
    // The Journal's notes are no part of the view: the Journal reads them apart.
    expect("journal" in view).toBe(false);
    // The HUD, the scene, the palette and the controls are read from the chat's state.
    const state = bed.store.user(USER).headState(CHAT).state.world;
    expect(view.hud?.clock.minutes).toBe(state.clock);
    expect(view.scene?.placeId).toBe(state.entities[doc.pov]?.fields.place as string);
    expect(view.palette?.entries.length).toBeGreaterThan(0);
    expect(view.currency).toEqual(doc.currency);
  });

  test("show what a turn's payment recorded, at the head, and the state before it at the turn before", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const first = await bed.turn();
    const before = panel(await bed.state(), "economy.money");
    await bed.turn(async (apply) => {
      await apply([{ op: "pay", who: "pov", to: "marcus_delgado", amount: 20, for: "a round of coffee at the diner", ...SAID }]);
    });
    const after = panel(await bed.state(), "economy.money");
    const banked = (money: Record<string, unknown>): number => {
      const overview = money.overview;
      const line = isObject(overview) && Array.isArray(overview.breakdown) ? overview.breakdown.find((b) => isObject(b) && b.label === "Bank accounts") : undefined;
      if (!isObject(line) || typeof line.cents !== "number") throw new Error("no bank accounts in the money panel");
      return line.cents;
    };
    expect(banked(before) - banked(after)).toBe(2000);
    // The state at the turn before the payment is as it was.
    expect(banked(panel(await bed.state({ turn: first.id }), "economy.money"))).toBe(banked(before));
  });

  test("say a turn of the chat runs while one does", async () => {
    const bed = makeBed();
    await bed.plays("mystery_manor");
    bed.running.add(CHAT);
    expect((await bed.state()).status).toBe("in_flight");
    bed.running.delete(CHAT);
    expect((await bed.state()).status).toBe("idle");
  });

  test("of a chat that plays no world, or that RPE never played, read as today's chat that is not a world's", async () => {
    const bed = makeBed();
    await bed.writes.run(() => bed.store.user(USER).createChat({ id: "chat-plain" }));
    for (const chat of ["chat-plain", "chat-never-seen"]) {
      const view = await bed.state({}, USER, chat);
      expect({ status: view.status, worldId: view.worldId, hud: view.hud, panels: view.panels }).toEqual({ status: "not_world", worldId: null, hud: null, panels: {} });
    }
  });

  test("are not another user's to read, and a turn the chat does not have is refused", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    const played = await bed.turn();
    const theirs = await bed.state({}, OTHER);
    expect({ status: theirs.status, panels: theirs.panels, hud: theirs.hud }).toEqual({ status: "not_world", panels: {}, hud: null });
    await expect(bed.state({ turn: played.id }, OTHER)).rejects.toMatchObject({ status: 404 });
    await expect(bed.state({ turn: "turn-nowhere" })).rejects.toMatchObject({ status: 404 });
  });
});
