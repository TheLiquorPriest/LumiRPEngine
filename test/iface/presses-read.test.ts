// Every press the palette offers, and the map's own (Walk here, Getting there), reaches the Author as `act` with its action and the values the
// player gave, and the tool reads each as told: none is refused as unreadable (an action it does not know, a value that is none of the choices).
// A press the world's rules or the player's own sheet still ask something of (a word to type, a second pick) is answered with what it needs, which
// is not this. The skip of time is no action of the world's: `timelapse-press.test.ts`. Invented worlds, the starters.

import { expect, test } from "bun:test";
import { own } from "../../src/engine/pack-kit";
import { STARTER_WORLDS } from "../../src/packs/index";
import { palette } from "../../src/play/state/palette";
import type { JsonObject } from "../../src/shared/json";
import { formatMoney } from "../../src/shared/world";
import { registry, rig, texts } from "./rig";

const UNREADABLE = /cannot be read|there is nothing called/;

test("every press of the palette and of the map is read by act as the briefing tells the Author to send it", async () => {
  const unread: string[] = [];
  let pressed = 0;
  for (const [template, make] of Object.entries(STARTER_WORLDS)) {
    const doc = make(template, template);
    const t = await rig({}, doc);
    const reg = registry();
    const view = palette(doc, t.s.stateAt(t.turn.id).state.world, reg);
    const send = async (action: string, values: JsonObject): Promise<void> => {
      pressed++;
      const said = texts(await t.call("world_apply", { operations: [{ op: "act", action, params: values, source: { from: "player" } }] })).join(" | ");
      if (UNREADABLE.test(said)) unread.push(`${template}: ${action} ${JSON.stringify(values)}: ${said.slice(0, 200)}`);
    };
    for (const entry of view.entries) {
      const action = own(doc.actions, entry.action) ?? reg.actions.get(entry.action);
      // A pick, and the second pick it leads to (Drive's destination, Lend's borrower), as the sheet merges them.
      const picks = entry.options.flatMap((o) => (o.next ? o.next.options.slice(0, 2).map((n) => ({ ...o.params, ...n.params })) : [o.params]));
      for (const pick of picks.length > 0 ? picks : [{}]) {
        const params: JsonObject = { ...pick };
        if (entry.amount) params[entry.amount.param] = 500;
        if (entry.number) params[entry.number.param] = 1;
        // As the press is told: an amount of money as the world prints it.
        await send(entry.action, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, action !== undefined && own(action.params, k)?.type === "money" && typeof v === "number" ? formatMoney(v, doc.currency) : v])));
      }
    }
    // The map's own: Walk here on a square, and Getting there by foot or by car.
    const place = Object.keys(doc.places)[1] ?? "";
    await send("step", { x: 3, y: 4 });
    await send("go", { to: place });
    await send("drive", { vehicle: Object.keys(doc.entities).find((id) => doc.entities[id]?.kind === "vehicle") ?? "", to: place });
  }
  expect(pressed).toBeGreaterThan(100);
  expect(unread).toEqual([]);
});
