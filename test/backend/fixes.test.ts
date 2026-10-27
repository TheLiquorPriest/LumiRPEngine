// ✎ fixes (DESIGN §12): checked against the field they write, one `fix` entry each with its own
// Undo chip. One made while a reply streams lands after it, over what the reply changed, and no later
// read of that reply undoes it (DESIGN §7); a held fix that can't be made at all is told, never
// dropped silently.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** A test-world chat whose person kind has a bounded number, an enum and a locked field. */
async function chat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld();
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const person: JsonObject = {
    id: "person",
    label: "Person",
    fields: { cash: { type: "money" }, mood: { type: "text" }, detail: { type: "text" }, grit: { type: "number", min: 1, max: 5 }, temper: { type: "enum", values: ["calm", "hot"] }, secret: { type: "text", locked: true } },
  };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "kinds", id: "person", value: person }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "look around", "Quiet.");
  return chatId;
}

async function fields(rig: Rig, chatId: string): Promise<JsonObject> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  return core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.entities[POV]?.fields ?? {};
}

async function chips(rig: Rig, chatId: string, kind: Chip["kind"]): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === kind);
}

async function refusal(rig: Rig, request: Record<string, unknown>): Promise<string> {
  const reply = await rig.send(request);
  if (reply.type !== "lre.error") throw new Error(`${String(request.field)} was accepted`);
  return reply.message;
}

describe("✎ fixes", () => {
  test("a fix is checked against its field: out of range, the wrong type, an unknown enum value and a locked field are refused", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    const fix = (field: string, value: unknown) => ({ type: "lre.fix", chatId, entity: POV, field, value });
    expect(await refusal(rig, fix("grit", 9))).toContain("between 1 and 5");
    expect(await refusal(rig, fix("grit", 0))).toContain("between 1 and 5");
    expect(await refusal(rig, fix("grit", "four"))).toContain("must be a number");
    expect(await refusal(rig, fix("temper", "furious"))).toContain("calm, hot");
    expect(await refusal(rig, fix("secret", "the key is under the mat"))).toContain("locked");
    // Nothing refused was written.
    expect((await fields(rig, chatId)).grit).toBeUndefined();
    rig.body(await rig.send(fix("grit", 5)));
    rig.body(await rig.send(fix("temper", "hot")));
    // A value that looks like a formula is stored as typed.
    rig.body(await rig.send(fix("mood", "=1+1")));
    expect(await fields(rig, chatId)).toMatchObject({ grit: 5, temper: "hot", mood: "=1+1" });
  });

  test("each fix gets a Corrected chip whose Undo takes it back", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "grit", value: 2 }));
    const corrected = await chips(rig, chatId, "fix");
    expect(corrected.map((c) => [c.label, c.actions.map((a) => a.label)])).toEqual([
      ["Corrected", ["Undo"]],
      ["Corrected", ["Undo"]],
    ]);
    const mood = corrected.find((c) => c.detail?.includes("calm"));
    if (!mood) throw new Error("no chip for the mood fix");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: mood.id, choice: "undo" }));
    expect(await fields(rig, chatId)).toMatchObject({ mood: "fine", grit: 2 });
    expect((await chips(rig, chatId, "fix")).map((c) => c.id)).not.toContain(mood.id);
    // The Journal keeps the correction that stands, as its own line.
    const journal = (await rig.rt.view(chatId, rig.host.userId)).journal.filter((n) => n.kind === "fix");
    expect(journal.map((n) => n.text)).toEqual([expect.stringContaining("2")]);
  });

  test("a held fix that can't be made at all after the reply shows a notice until dismissed", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    rig.host.sendUser(chatId, "buy:lamp:20");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Made while the reply streams: held, and checked again when the reply finishes (P2). It keeps no
    // request to resolve again, so its own event is checked, and there is no lamp to use.
    const held = await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "w-held", target: "head", entry: { kind: "fix", events: [{ type: "test.use", data: { item: "lamp" } }] } });
    expect(held.pending).toBe(true);
    await rig.host.finish(g, "The lamp slips away. [lose:lamp]");
    const [notice] = await chips(rig, chatId, "refused");
    expect(notice?.actions.map((a) => a.id)).toEqual(["dismiss"]);
    // It stays until dismissed, restarts included.
    const again = rig.restart();
    expect((await chips(again, chatId, "refused")).map((c) => c.id)).toEqual(["refused:w-held"]);
    again.body(await again.send({ type: "lre.chip", chatId, chip: "refused:w-held", choice: "dismiss" }));
    expect(await chips(again, chatId, "refused")).toEqual([]);
  });
});

const EXTRACT_MARK = "propose concrete state changes";
/** The time the narration says passed, as the reply's read proposes it. */
const NARRATED: Record<string, number> = { "An hour later": 60, "Two hours later": 120 };

/** A chat whose reply's read proposes the time its narration says passed. */
async function timedChat(rig: Rig): Promise<string> {
  rig.host.quietReply = (req) => {
    if (!req.messages[0]?.content.includes(EXTRACT_MARK)) return "{}";
    const text = req.messages[1]?.content ?? "";
    const said = Object.entries(NARRATED).find(([words]) => text.includes(words));
    return JSON.stringify({ proposals: said ? [{ type: "time_advance", minutes: said[1] }] : [] });
  };
  return chat(rig);
}

/** The clock as the time row's ✎ reads it: the date and time of day where the player character is. */
async function clock(rig: Rig, chatId: string): Promise<string | undefined> {
  const fix = (await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.time;
  return fix?.type === "time" ? fix.value : undefined;
}

const TYPED = "2026-10-16 07:30";

describe("the clock's ✎ and the time a reply narrates", () => {
  test("set while a reply that narrates an hour streams, the clock reads the time typed once it finishes", async () => {
    const rig = new Rig();
    const chatId = await timedChat(rig);
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(rig.body(await rig.send({ type: "lre.fix", chatId, time: TYPED })).pending).toBe(true);
    await rig.host.finish(g, "An hour later, the kettle sings.");
    expect(await clock(rig, chatId)).toBe(TYPED);
    expect(await chips(rig, chatId, "refused")).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("set after a reply, a Re-read of that reply edited to narrate more time leaves the clock at the time typed", async () => {
    const rig = new Rig();
    const chatId = await timedChat(rig);
    await rig.turn(chatId, "I wait.", "An hour later, the kettle sings.");
    rig.body(await rig.send({ type: "lre.fix", chatId, time: TYPED }));
    expect(await clock(rig, chatId)).toBe(TYPED);
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, "Two hours later, the kettle sings.");
    await rig.host.settle();
    const [reread] = await chips(rig, chatId, "reread");
    if (!reread) throw new Error("no Re-read edit chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" }));
    // The read was of a reply written before the fix, so it comes before it: the fix still stands.
    expect(await clock(rig, chatId)).toBe(TYPED);
    expect((await chips(rig, chatId, "fix")).length).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("set on a later reply, a Re-read of an earlier reply edited to narrate more time leaves the clock at the time typed", async () => {
    const rig = new Rig();
    const chatId = await timedChat(rig);
    await rig.turn(chatId, "I wait.", "An hour later, the kettle sings.");
    const earlier = rig.host.head(chatId);
    if (!earlier) throw new Error("no reply");
    await rig.turn(chatId, "I make tea.", "Steam fogs the window.");
    const later = "2026-10-16 09:30";
    rig.body(await rig.send({ type: "lre.fix", chatId, time: later }));
    expect(await clock(rig, chatId)).toBe(later);
    rig.host.editMessage(chatId, earlier.id, "Two hours later, the kettle sings.");
    await rig.host.settle();
    const reread = (await chips(rig, chatId, "reread")).find((c) => c.messageId === earlier.id);
    if (!reread) throw new Error("no Re-read edit chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" }));
    // The later reply now follows the earlier one's new read, and the fix on it is made again there.
    expect(await clock(rig, chatId)).toBe(later);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
