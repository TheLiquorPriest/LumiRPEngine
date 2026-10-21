// A move the reply tells (extract's location channel) doesn't carry over what the person was doing
// where they were: the shift their routine or the planner gave them stays behind (DESIGN §9.4).

import { expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const MARCUS = "marcus_delgado";
const SHOP = "alder_automotive";

test("a narrated move to another place leaves no activity from where they were", async () => {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Noon.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: SHOP }, { op: "move", entity: MARCUS, to: SHOP }, { op: "set", entity: MARCUS, field: "activity", value: "work" }] }));
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "location", entity: MARCUS, place: "rusty_anchor" }], where: null }) : "{}");
  await rig.turn(chatId, "I keep at the brakes.", "Marcus pulls his jacket on and walks over to the Anchor for lunch.");
  const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  expect(state ? placeOfEntity(state, MARCUS) : null).toBe("rusty_anchor");
  expect(state?.entities[MARCUS]?.fields.activity).not.toBe("work");
});
