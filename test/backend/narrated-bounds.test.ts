// Narrated-change channels and their bounds (DESIGN §9.4): a time skip under `confirm` waits on a
// confirm chip and applies whole on Apply.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/** A fresh Port Alder chat whose next reply the extractor reads as `proposals`, with `extraction` settings applied first. */
async function chat(proposals: JsonObject[], extraction: JsonObject) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction } }));
  const state = async () => {
    const s = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    if (!s) throw new Error("no state");
    return s;
  };
  // A first turn reads nothing, so the clock starts from a played turn.
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around.", "The shop is quiet.");
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await rig.turn(chatId, "I sit with Danny.", "An hour later, Danny trusts you a good deal more.");
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { rig, chatId, state, chips };
}

describe("a narrated time skip under confirm", () => {
  test("waits on a confirm chip, then applies whole on Apply", async () => {
    const got = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } });
    const confirm = got.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    expect(confirm.actions.map((a) => a.id)).toEqual(["confirm", "reject"]);
    const read = (await got.state()).clock;
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "confirm" }));
    expect((await got.state()).clock - read).toBe(45);
    expect(got.rig.rt.ledger.errors).toEqual([]);
    const learning = await got.rig.rt.settings.learningOf(got.rig.host.userId);
    expect(learning.connections.active?.time_advance?.accepted).toBe(1);
  });

  test("No leaves the clock alone", async () => {
    const got = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } });
    const confirm = got.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    const read = (await got.state()).clock;
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "reject" }));
    expect((await got.state()).clock).toBe(read);
  });

  test("a skip past the cap is offered as a Timelapse, not applied", async () => {
    const got = await chat([{ type: "time_advance", minutes: 600 }], { time_advance: { mode: "confirm" } });
    expect(got.chips.some((c) => c.kind === "confirm")).toBe(false);
    const offer = got.chips.find((c) => c.kind === "timelapse_offer" && c.label.includes("skipped ahead"));
    expect(offer).toBeDefined();
    expect(offer?.actions.map((a) => a.id)).toEqual(["timelapse"]);
  });
});
