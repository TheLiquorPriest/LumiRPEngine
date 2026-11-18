// What a turn is told of a person's needs (DESIGN §8): in the words the Needs view shows the player, through the one reading
// (`needsOf`), never the record they are kept in: the world state and world_query's tree, the due list it and the tools give, and a
// planned day's reasons. On the modern starter (Cast life 4), whose people and places are invented.

import { expect, test } from "bun:test";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import type { LedgerEvent } from "../../src/shared/ledger";
import { needsOf } from "../../src/packs/castlife/core";
import { timeDue } from "../../src/store/due";
import { worldState } from "../../src/store/world-state";
import { CHAT } from "../play/bed";
import { rig } from "../play/undo-rig";
import { SHIPPED_LAYOUT, SHIPPED_PART } from "./fixtures";

test("a pressing need is told by its name, its figure and its word, since when, and what meets it; never as it is kept", async () => {
  const r = await rig();
  const pov = r.doc.pov;
  const start = r.world().clock;
  // He ate at the start: hunger is kept as met then ({v, t}); then a turn passed sixteen hours, and hunger presses.
  await r.record([{ type: "castlife.need", data: { entity: pov, need: "hunger", delta: -20, at: start, from: 20 } } as unknown as LedgerEvent]);
  await r.record([{ type: "clock", minutes: 16 * 60, cause: "advance" } as unknown as LedgerEvent]);
  expect(r.world().entities[pov]?.fields.needs).toMatchObject({ hunger: { v: 0, t: start } });

  // The Needs view's own reading: hunger 64, pressing from 60 since fifteen hours after the meal.
  const ctx = r.store.env.registry.context(r.doc, r.world());
  const hunger = needsOf(ctx, pov).find((n) => n.need === "hunger");
  expect(hunger).toMatchObject({ value: 64, pressing: true, label: "hungry", since: start + 15 * 60 });
  const since = formatClock(calendarOf(r.doc), start + 15 * 60);

  // The tree an agent reads (the world state's horizon, world_query): the need in words, the record never.
  const tree = r.s.view(CHAT).print(`entity:${pov}`, 0, SHIPPED_PART) ?? "";
  expect(tree).toContain(`· needs: Hunger 64 of 100, so hungry since ${since}. Met by eating; from 80 it falls due when time passes.`);
  expect(tree).not.toMatch(/"v":|\{"hunger"/);

  // The due list: hunger reaching the point it falls due from, in the same words, by name; as the world state lists it too.
  const due = timeDue(r.store);
  const ahead = due.due(r.s.headState(CHAT).state, { from: r.world().clock, to: r.world().clock + 6 * 60 }, null, 50).items.find((i) => i.kind === "need");
  expect(ahead?.words).toStartWith("Hunger 80 of 100, so hungry since");
  const next = await r.writes.run(() => r.s.beginTurn({ chat: CHAT, kind: "normal" }), "the next turn");
  const block = worldState(r.s, { chat: CHAT, turn: next.id, layout: SHIPPED_LAYOUT, due, charsPerToken: 4 });
  expect(block.text).toContain(": need, Jordan Ellis (Hunger 80 of 100, so hungry since");
  expect(block.text).not.toMatch(/\{"need"|"line":/);
});
