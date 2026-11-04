// The narrator states the prices the engine charges (DESIGN §9.5): its Money section lists what is
// sold where the player character is, at the price a purchase there charges today, and its rules tell
// it to state the engine's price whenever a purchase or a price comes up. Settings → Narrator →
// Prices off sends neither, and the helpers never get the list.

import { describe, expect, test } from "bun:test";
import { PRICES_RULE } from "../../src/shared/prompts";
import { Rig } from "../support/rig";

/** A Port Alder turn at Bluebird Coffee, with Settings → Narrator → Prices as `statePrices` says (absent: as shipped). */
async function atCafe(statePrices?: boolean): Promise<Rig> {
  const rig = new Rig({ shipped: true });
  if (statePrices !== undefined) rig.body(await rig.send({ type: "lre.settings.set", patch: { statePrices } }));
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "The street wakes up.");
  rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "place", value: "bluebird_coffee" }));
  await rig.turn(chatId, "I read the menu board.", "The board lists the drinks.");
  return rig;
}

describe("the narrator states the engine's prices", () => {
  test("as shipped, the Money section lists the café's prices and the rules say to state them", async () => {
    const rig = await atCafe();
    expect(rig.host.section("Money")).toMatch(/\n- Prices at Bluebird Coffee, before sales tax: [^\n]*Drip coffee[^\n]*\$\d+\.\d\d/);
    expect(rig.host.section("Narrator rules")).toContain(PRICES_RULE);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Settings → Narrator → Prices off sends neither the prices nor the rule", async () => {
    const rig = await atCafe(false);
    expect(rig.host.section("Money")).not.toContain("Prices at");
    expect(rig.host.section("Money")).toContain("Balances now");
    expect(rig.host.section("Narrator rules")).not.toContain(PRICES_RULE);
  });

  test("the helpers never get the price list", async () => {
    const rig = await atCafe();
    for (const call of rig.host.quietCalls) for (const m of call.messages) expect(m.content).not.toContain("Prices at Bluebird Coffee");
  });
});
