// The preview gates (DESIGN §5.1), on Port Alder: with the intent gate on, a typed message's read
// action waits, nothing generated, on Play, Edit or Cancel, and Edit's details are what plays; with
// the outline gate on, the turn's outline waits before the reply is written, and the outline as the
// player edited it is the one the narrator is told.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const OUTLINE_MARK = "You outline a roleplay narrator's next reply";

/** A Port Alder chat after `settings` patches, with minds off (no model answers them here), and `places` committed first. */
async function alder(settings: JsonObject[], places: [string, JsonObject][] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = () => "{}";
  for (const patch of [...settings, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  for (const [id, value] of places) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value }));
  if (places.length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

async function chipOf(rig: Rig, chatId: string, kind: Chip["kind"]): Promise<Chip | undefined> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === kind);
}

async function where(rig: Rig, chatId: string): Promise<string | null> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return placeOfEntity(state, "pov");
}

async function clock(rig: Rig, chatId: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state.clock;
}

async function placeName(rig: Rig, chatId: string, place: string): Promise<string> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const name = state ? core?.worldAt(state.revision)?.places[place]?.name : undefined;
  if (!name) throw new Error(`no place ${place}`);
  return name;
}

describe("the intent gate", () => {
  test("a typed action waits with nothing generated, Edit changes where it goes, and Play's Regenerate plays it as edited", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    let reads = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      reads++;
      return JSON.stringify({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 });
    };
    rig.host.sendUser(chatId, "I walk to Bluebird Coffee.");
    await rig.host.settle();
    const held = await rig.host.start(chatId, { type: "normal" });
    expect(held.halted).toBe("cancelled");
    expect(rig.host.assembled).toEqual([]);
    const gate = await chipOf(rig, chatId, "intent_gate");
    expect(gate?.actions.map((a) => a.id)).toEqual(["play", "edit", "cancel"]);
    // Edit is the Actions palette at the read action, with its picks made, never a box of JSON.
    expect(gate?.actions.find((a) => a.id === "edit")?.input).toMatchObject({ type: "action", action: "go", params: { to: "bluebird_coffee" } });
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { to: "alder_market" } } })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "You head to the market instead.");
    expect(await where(rig, chatId)).toBe("alder_market");
    // The read was made once: the resume plays the kept read, not a new one.
    expect(reads).toBe(1);
    expect(await chipOf(rig, chatId, "intent_gate")).toBeUndefined();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the chip says the read action in words: the place by its name, never its id", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }) : "{}");
    rig.host.sendUser(chatId, "I walk to Bluebird Coffee.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    expect(gate?.label).toBe("Play Go to: Bluebird Coffee?");
    expect(`${gate?.label} ${gate?.detail}`).not.toContain("bluebird_coffee");
    expect(`${gate?.label} ${gate?.detail}`).not.toMatch(/[{}"]/);
  });

  test("the card names what the action acts on in the player's words, and each action after it", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    // "letter" is a thing the player says is there (Take's claim); nothing in the world goes by it.
    rig.host.quietReply = (req: QuietRequest) =>
      (req.messages[0]?.content ?? "").includes(INTERPRET_MARK)
        ? JSON.stringify({
            action: "take",
            params: { item: "letter" },
            thing: "other",
            text: "I take the letter from the clerk",
            confidence: 0.9,
            more: [
              { action: "give_gift", params: { target: "danny_okafor" }, text: "I give Danny his present" },
              { action: "chat_with", params: { target: "danny_okafor" }, text: "I chat with Danny" },
            ],
          })
        : "{}";
    rig.host.sendUser(chatId, "I take the letter from the clerk, give Danny his present and chat with him.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    expect(gate?.label).toBe("Play Take: letter, then 2 more?");
    expect(gate?.detail?.split("\n")).toEqual(["“I take the letter from the clerk”", "Then Give a gift: Danny Okafor — “I give Danny his present”", "Then Chat with: Danny Okafor — “I chat with Danny”"]);
  });

  test("a time skip's card says how long it runs, from when to when, and what fills it, and Edit changes its length", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    let reads = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      reads++;
      return JSON.stringify({ action: "timelapse", params: { span: "an hour", minutes: 60 }, text: "I sort the stock", confidence: 0.9 });
    };
    const before = await clock(rig, chatId);
    rig.host.sendUser(chatId, "(OOC: skip ahead an hour, I sort the stock.)");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    const gate = await chipOf(rig, chatId, "intent_gate");
    expect(gate?.label).toMatch(/^Play Timelapse: 1 h, \d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M\?$/);
    expect(gate?.detail).toContain("Filled with: “I sort the stock”");
    expect(gate?.detail).toContain("Play runs the clock on in one go");
    // Edit is the Timelapse sheet at the skip as read: its length, and the POV held where the story has it.
    expect(gate?.actions.find((a) => a.id === "edit")?.input).toMatchObject({ type: "action", action: "timelapse", params: { target: { type: "duration", minutes: 60 }, followRoutine: false } });
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { target: { type: "duration", minutes: 30 }, overrides: {}, followRoutine: false } } })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Half an hour goes by among the shelves.");
    expect((await clock(rig, chatId)) - before).toBe(30);
    expect(reads).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Cancel drops the read: the next Regenerate reads the message afresh and shows the new read", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    let reads = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      reads++;
      return JSON.stringify({ action: "go", params: { to: reads === 1 ? "bluebird_coffee" : "alder_market" }, confidence: 0.9 });
    };
    rig.host.sendUser(chatId, "I walk over there.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    expect(gate?.label).toBe("Play Go to: Bluebird Coffee?");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "cancel" })).applied).toBe(true);
    expect(await chipOf(rig, chatId, "intent_gate")).toBeUndefined();
    expect((await rig.host.start(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(reads).toBe(2);
    expect((await chipOf(rig, chatId, "intent_gate"))?.label).toBe(`Play Go to: ${await placeName(rig, chatId, "alder_market")}?`);
    expect(rig.host.assembled).toEqual([]);
  });
});

describe("the outline gate", () => {
  test("the outline waits before the reply, and the outline the player edited is the one the narrator is told", async () => {
    const { rig, chatId } = await alder([{ modelUse: { preset: "full" } }, { gates: { outline: true } }]);
    let outlines = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").startsWith(OUTLINE_MARK)) return "{}";
      outlines++;
      return JSON.stringify({ beats: ["Danny glances at the clock."] });
    };
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 10 } }, source: "palette", now: true }));
    const held = await rig.host.start(chatId, { type: "normal" });
    expect(held.halted).toBe("cancelled");
    expect(rig.host.assembled).toEqual([]);
    const gate = await chipOf(rig, chatId, "outline_gate");
    expect(gate?.detail).toContain("Danny glances at the clock.");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { text: "Danny waits by the window.\nThe rain starts." } })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    const outline = rig.host.section("Outline");
    expect(outline).toContain("- Danny waits by the window.");
    expect(outline).toContain("- The rain starts.");
    expect(outline).not.toContain("Danny glances at the clock.");
    await rig.host.finish(reply, "Time passes.");
    // The resume writes no new outline: the edited one stands in for it.
    expect(outlines).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("no request plays a place the player character can't know of", () => {
  const vault: [string, JsonObject] = ["hidden_vault", { id: "hidden_vault", name: "The Vault", parent: "port_alder", visibility: "secret", fields: {} }];

  test("the intent gate's Edit to a secret place is refused, and the chip stays", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }], [vault]);
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }) : "{}");
    rig.host.sendUser(chatId, "I walk to Bluebird Coffee.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    const answer = await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { to: "hidden_vault" } } });
    expect(answer.type).toBe("lre.error");
    expect(await chipOf(rig, chatId, "intent_gate")).toBeDefined();
    expect(await where(rig, chatId)).not.toBe("hidden_vault");
  });

  test("the intent gate's Edit bringing along someone the palette doesn't offer is refused, and the chip stays", async () => {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }) : "{}");
    rig.host.sendUser(chatId, "I walk to Bluebird Coffee.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    // Marcus is across town: Go's "Who comes along" offers only the people here.
    const answer = await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { to: "bluebird_coffee", with: ["marcus_delgado"] } } });
    expect(answer.type).toBe("lre.error");
    expect(await chipOf(rig, chatId, "intent_gate")).toBeDefined();
  });

  test("an lre.action to a secret place is refused, and the player character stays put", async () => {
    const { rig, chatId } = await alder([], [vault]);
    const before = await where(rig, chatId);
    const answer = await rig.send({ type: "lre.action", chatId, action: "go", params: { to: "hidden_vault" }, source: "palette", now: true });
    expect(answer.type).toBe("lre.error");
    // The turn after the request plays out, whatever it left.
    const reply = await rig.host.start(chatId, { type: "normal" });
    if (!reply.halted) await rig.host.finish(reply, "Time passes.");
    expect(await where(rig, chatId)).toBe(before);
  });
});

describe("an outline let through is for its one turn", () => {
  test("after Play, a Re-run swipe plans again and waits on the gate again", async () => {
    const { rig, chatId } = await alder([{ modelUse: { preset: "full" } }, { gates: { outline: true } }]);
    let outlines = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").startsWith(OUTLINE_MARK)) return "{}";
      outlines++;
      return JSON.stringify({ beats: [`Beat number ${outlines}.`] });
    };
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 10 } }, source: "palette", now: true }));
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "outline_gate");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "play" }));
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Time passes.");
    const swiped = await rig.host.start(chatId, { type: "swipe" });
    expect(swiped.halted).toBe("cancelled");
    expect(outlines).toBe(2);
    expect((await chipOf(rig, chatId, "outline_gate"))?.detail).toContain("Beat number 2.");
  });
});

describe("the intent gate's Edit and a claimed thing (DESIGN §9.4)", () => {
  /** "I give Danny a coffee" with no coffee: the read gives a coffee it makes real. */
  async function claimed() {
    const { rig, chatId } = await alder([{ gates: { intent: true } }]);
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "give", params: { item: "coffee", to: "danny_okafor" }, thing: "drink", confidence: 0.9 }) : "{}");
    rig.host.sendUser(chatId, "I give Danny a coffee.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = await chipOf(rig, chatId, "intent_gate");
    if (!gate) throw new Error("no gate");
    return { rig, chatId, gate };
  }

  test("an edit naming, for the claimed thing, something the palette doesn't offer is refused", async () => {
    const { rig, chatId, gate } = await claimed();
    // Marcus's office key is across town in his pocket: the player character can't hand it over.
    const answer = await rig.send({ type: "lre.chip", chatId, chip: gate.id, choice: "edit", payload: { params: { item: "shop_office_key", to: "danny_okafor" } } });
    expect(answer.type).toBe("lre.error");
    expect(await chipOf(rig, chatId, "intent_gate")).toBeDefined();
  });

  test("a real pick for the claimed thing wins: the pocketknife is given and no coffee is made", async () => {
    const { rig, chatId, gate } = await claimed();
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate.id, choice: "edit", payload: { params: { item: "pov_pocketknife", to: "danny_okafor" } } })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(reply, "Danny turns the knife over in his hands.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    expect(state?.entities.pov_pocketknife?.fields.owner).toBe("danny_okafor");
    expect(Object.values(state?.entities ?? {}).some((e) => e.fields.claimed === true)).toBe(false);
  });
});
