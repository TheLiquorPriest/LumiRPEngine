// The POV's place drifting from the story (issue #32), on Port Alder: a message that takes for
// granted a move the engine didn't make ("I sit down next to Marcus" while the engine has the POV at
// the market) is read as that move before the reply, from where the POV last saw Marcus and what its
// last message left unplayed (DESIGN §5.2); and a reply that puts the POV somewhere else with no move
// says so on screen, offering the POV's move there for Apply (DESIGN §9.4).

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9 };
const GO_TO_SHOP: JsonObject = { action: "go", params: { to: "alder_automotive" }, confidence: 0.9 };

const TO_SHOP = "I walk over to Alder Automotive.";
const FIRST = "Before we sit down, I run over to Alder Market and buy a bag of chips and a soda with cash, then come back and pull up a stool next to Marcus.";
const SECOND = "I set my chips and soda on the counter, sit down next to Marcus, and ask him straight out what's really going on with the shop's money.";
/** What the first message's queue left when the market held the POV up: the buy and the walk back. */
const LEFT = "I buy a bag of chips and a soda with cash. I come back and pull up a stool next to Marcus";
const AT_THE_SHOP = "Marcus pats the stool beside his at the customer counter of Alder Automotive. “The money? It's complicated.”";

/** Something comes up as the POV reaches Alder Market: a sign it sees, which stops a message's queue (DESIGN §11). */
const HOLD_UP: JsonObject = { id: "market_holdup", on: { enter: "alder_market" }, when: "at(pov, 'alder_market')", do: [{ type: "signal", args: { class: "incident", text: "A delivery truck blocks the market's doors." } }], once: true };

/** A Port Alder chat where Marcus is at his shop from the start, with someone there the POV can't see, something holds the POV up at the market, and a cellar it hasn't found lies under its building. */
async function portAlder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  };
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
  const marcus = draft.entities.marcus_delgado;
  if (!marcus) throw new Error("no Marcus");
  await put("entities", "marcus_delgado", { ...marcus, fields: { ...marcus.fields, place: "alder_automotive" } });
  await put("rules", "market_holdup", HOLD_UP);
  await put("entities", "vex_morrow", { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: "alder_automotive" }, relations: [] });
  await put("places", "hidden_cellar", { id: "hidden_cellar", name: "Hidden Cellar", parent: "harbor_street_114", visibility: "discoverable", fields: {} });
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

async function povPlace(rig: Rig, chatId: string): Promise<string | null> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return placeOfEntity(state, "pov");
}

/** The chips on the latest reply that move someone: a narrated move's Undo, Apply or decline ("you → Alder Automotive"). */
async function moveChips(rig: Rig, chatId: string): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && (c.kind === "undo" || c.kind === "confirm" || c.kind === "decline") && c.label.includes(" → "));
}

/** The prompt's Scene lines. */
function scene(system: string): string[] {
  const lines = system.split("\n");
  const from = lines.indexOf("Scene:");
  const end = lines.findIndex((l, i) => i > from && /^(Places \(|Recent messages|Action catalog)/.test(l));
  return from < 0 ? [] : lines.slice(from + 1, end < 0 ? undefined : end);
}

/** Answers on a chat: `interpret`'s read of each typed message from its prompt, and the reply's read (`where` it leaves the POV). */
interface Script {
  read: (text: string, system: string) => JsonObject;
  extract?: (narration: string) => JsonObject;
}

/** Scripts the helper; returns interpret's prompts, by typed text. */
function script(rig: Rig, s: Script): Map<string, string> {
  const prompts = new Map<string, string>();
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const text = req.messages[1]?.content ?? "";
    if (system.includes(EXTRACT_MARK)) return JSON.stringify(s.extract?.(text) ?? { proposals: [] });
    if (!system.includes(INTERPRET_MARK)) return "{}";
    prompts.set(text, system);
    return JSON.stringify(s.read(text, system));
  };
  return prompts;
}

/** The repro's first message read as its plan was: the run to the market, then the buy and the walk back. */
function firstRead(text: string): JsonObject | null {
  if (text === TO_SHOP) return GO_TO_SHOP;
  if (text !== FIRST) return null;
  return {
    action: "go",
    params: { to: "alder_market" },
    confidence: 0.9,
    more: [
      { action: "buy", params: { item: "bag of chips and a soda", method: "cash" }, text: "I buy a bag of chips and a soda with cash" },
      { action: "go", params: { to: "alder_automotive" }, text: "I come back and pull up a stool next to Marcus" },
    ],
  };
}

/**
 * The repro's first two turns: the POV walks to the shop, where Marcus is, then runs to the market
 * for chips and a soda and is held up there, with the buy and the walk back left on the Send chip.
 */
async function heldUpAtTheMarket(s: Script): Promise<{ rig: Rig; chatId: string; prompts: Map<string, string>; rest: Chip | undefined }> {
  const { rig, chatId } = await portAlder();
  const prompts = script(rig, { ...s, read: (text, system) => firstRead(text) ?? s.read(text, system) });
  await rig.turn(chatId, TO_SHOP, "The radio plays in the shop. Marcus looks up from the counter.");
  await rig.turn(chatId, FIRST, "A delivery truck blocks the market's doors while you wait.");
  expect(await povPlace(rig, chatId)).toBe("alder_market");
  const head = rig.host.head(chatId);
  const rest = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.messageId === head?.id && c.kind === "choice");
  return { rig, chatId, prompts, rest };
}

/** Where the scene says the POV last saw Marcus: at his shop, a few minutes ago. */
const MARCUS_AWAY = /^Named in the input but not here: Marcus Delgado \(marcus_delgado\), last seen at Alder Automotive \(alder_automotive\) \d+ min ago\.$/;

describe("a message that takes for granted a move the engine didn't make", () => {
  test("the repro's second message: interpret is told where the POV is, where it last saw Marcus and what its last message left, and the move it reads plays", async () => {
    // A model reads the move only from what its prompt gives it: that Marcus isn't here, and where he was last seen.
    const { rig, chatId, prompts, rest } = await heldUpAtTheMarket({ read: (_text, system) => (scene(system).some((l) => MARCUS_AWAY.test(l)) ? GO_TO_SHOP : NONE) });
    expect(rest?.label).toBe(LEFT);
    await rig.turn(chatId, SECOND, AT_THE_SHOP);
    const lines = scene(prompts.get(SECOND) ?? "");
    expect(lines[0]).toMatch(/^Now: .+, at Alder Market \(alder_market\), in Port Alder \(port_alder\)\.$/);
    expect(lines.filter((l) => MARCUS_AWAY.test(l))).toHaveLength(1);
    expect(lines).toContain(`Left from your last message, not played yet: ${LEFT}`);
    // The move plays before the reply: the engine has the POV where the story does.
    expect(await povPlace(rig, chatId)).toBe("alder_automotive");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a message that takes nothing for granted gets no move, though its prompt has what the last message left", async () => {
    const { rig, chatId, prompts } = await heldUpAtTheMarket({ read: (_text, system) => (scene(system).some((l) => l.startsWith("Named in the input but not here:")) ? GO_TO_SHOP : NONE), extract: () => ({ proposals: [], where: "alder_market" }) });
    const look = "I look over the apples by the door.";
    await rig.turn(chatId, look, "You turn a red apple over in your hand by the market's door.");
    const lines = scene(prompts.get(look) ?? "");
    expect(lines).toContain(`Left from your last message, not played yet: ${LEFT}`);
    expect(lines.some((l) => l.startsWith("Named in the input but not here:"))).toBe(false);
    // Nothing moves the POV: not the read, nor a reply that leaves it where the engine has it.
    expect(await povPlace(rig, chatId)).toBe("alder_market");
    expect(await moveChips(rig, chatId)).toEqual([]);
  });

  test("the rest of the message sent with its chip's Send is the message itself, never left over", async () => {
    const { rig, chatId, prompts, rest } = await heldUpAtTheMarket({ read: () => NONE });
    if (!rest) throw new Error("no Send chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: rest.id, choice: "send" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "You pay at the register.");
    const sent = prompts.get(LEFT) ?? "";
    expect(sent).not.toBe("");
    expect(scene(sent).some((l) => l.startsWith("Left from your last message"))).toBe(false);
    // Marcus, whom the sent words name, is still placed for the read.
    expect(scene(sent).filter((l) => MARCUS_AWAY.test(l))).toHaveLength(1);
  });

  test("a message sent again in place of one deleted still reads what the last message left", async () => {
    const { rig, chatId, prompts } = await heldUpAtTheMarket({ read: () => NONE });
    // The send lapses the reply's chips; the message goes before its reply is generated.
    const typo = rig.host.sendUser(chatId, "I set my chpis and soda on the countre.");
    await rig.host.settle();
    rig.host.deleteMessage(chatId, typo);
    await rig.host.settle();
    await rig.turn(chatId, SECOND, AT_THE_SHOP);
    expect(scene(prompts.get(SECOND) ?? "")).toContain(`Left from your last message, not played yet: ${LEFT}`);
  });

  test("someone the POV can't know is never placed for the read, though the message names them", async () => {
    const { rig, chatId, prompts } = await heldUpAtTheMarket({ read: () => NONE });
    const both = "I squeeze in between Marcus and Vex Morrow at the counter.";
    await rig.turn(chatId, both, AT_THE_SHOP);
    const system = prompts.get(both) ?? "";
    expect(scene(system).filter((l) => MARCUS_AWAY.test(l))).toHaveLength(1);
    for (const hidden of ["Vex", "vex_morrow"]) expect(system).not.toContain(hidden);
  });
});

/** Replies the safety net reads: at the shop and at the cafe with no move told, and a walk to the lakefront told. */
const AT_THE_CAFE = "You sip a latte at a window table in Bluebird Coffee.";
const TO_THE_LAKE = "You wander down to the lakefront and sit on a picnic table.";

/** The reply's read of each: where it leaves the POV, and the move the lakefront one tells. */
function replyRead(narration: string): JsonObject {
  if (narration.includes(AT_THE_SHOP)) return { proposals: [], where: "alder_automotive" };
  if (narration.includes(AT_THE_CAFE)) return { proposals: [], where: "bluebird_coffee" };
  if (narration.includes(TO_THE_LAKE)) return { proposals: [{ type: "location", entity: "pov", place: "lakefront_park" }], where: "lakefront_park" };
  return { proposals: [], where: null };
}

/** Moves as Settings → Changes from the reply shows them on the player's connection: the mode, and the outcomes learned from. */
async function movesSetting(rig: Rig): Promise<Record<string, unknown>> {
  const { extraction } = rig.body(await rig.send({ type: "lre.settings.get" }));
  return isRecord(extraction) && isRecord(extraction.location) ? extraction.location : {};
}

describe("a reply that puts the POV somewhere the engine doesn't have them", () => {
  test("with no move, under auto: the POV stays put until Apply plays the move, Apply or No counts nothing toward the learning, and a told move still applies by itself and counts", async () => {
    // The read misses what the message takes for granted; the reply plays at the shop.
    const { rig, chatId } = await heldUpAtTheMarket({ read: () => NONE, extract: replyRead });
    rig.host.activeConnection = { id: "conn-ds", name: "Deepseek" };
    expect(await movesSetting(rig)).toMatchObject({ mode: "auto", accepted: 0, rejected: 0 });
    await rig.turn(chatId, SECOND, AT_THE_SHOP);
    expect(await povPlace(rig, chatId)).toBe("alder_market");
    const [apply, ...others] = await moveChips(rig, chatId);
    expect(others).toEqual([]);
    expect(apply).toMatchObject({ kind: "confirm", label: "you → Alder Automotive" });
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: apply?.id, choice: "confirm" })).applied).toBe(true);
    expect(await povPlace(rig, chatId)).toBe("alder_automotive");
    // A reply that has the POV at the cafe: No keeps them at the shop.
    await rig.turn(chatId, "I look around.", AT_THE_CAFE);
    const [offered] = await moveChips(rig, chatId);
    expect(offered).toMatchObject({ kind: "confirm", label: "you → Bluebird Coffee" });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offered?.id, choice: "reject" }));
    expect(await povPlace(rig, chatId)).toBe("alder_automotive");
    expect(await movesSetting(rig)).toMatchObject({ mode: "auto", accepted: 0, rejected: 0 });
    // A move the reply tells applies by itself, with its Undo, and the Undo counts.
    await rig.turn(chatId, "I look around.", TO_THE_LAKE);
    expect(await povPlace(rig, chatId)).toBe("lakefront_park");
    const [undo, ...more] = await moveChips(rig, chatId);
    expect(more).toEqual([]);
    expect(undo).toMatchObject({ kind: "undo", label: "you → Lakefront Park" });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo?.id, choice: "undo" }));
    expect(await povPlace(rig, chatId)).toBe("alder_automotive");
    expect(await movesSetting(rig)).toMatchObject({ mode: "auto", accepted: 0, rejected: 1 });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("only a place the engine doesn't have the POV at or inside, with no move of the turn's own or the reply's, is offered", async () => {
    const { rig, chatId } = await portAlder();
    let read: JsonObject = { proposals: [], where: null };
    script(rig, { read: (text) => (text === TO_SHOP ? GO_TO_SHOP : NONE), extract: () => read });
    // The turn walks to the shop, and its reply still has the POV at home: the engine's outcome wins.
    read = { proposals: [], where: "harbor_street_114" };
    await rig.turn(chatId, TO_SHOP, "You lock the flat behind you.");
    expect([await povPlace(rig, chatId), await moveChips(rig, chatId)]).toEqual(["alder_automotive", []]);
    // A reply that has the POV where the engine has them, or in the town around it.
    for (const where of ["alder_automotive", "port_alder"]) {
      read = { proposals: [], where };
      await rig.turn(chatId, "I look around.", "The radio plays.");
      expect([await povPlace(rig, chatId), await moveChips(rig, chatId)]).toEqual(["alder_automotive", []]);
    }
    // A place the POV hasn't found is never named, nor moved to.
    read = { proposals: [], where: "hidden_cellar" };
    await rig.turn(chatId, "I look around.", "You feel your way down the cellar steps.");
    expect([await povPlace(rig, chatId), await moveChips(rig, chatId)]).toEqual(["alder_automotive", []]);
    const shown = JSON.stringify(await rig.rt.view(chatId, rig.host.userId));
    for (const hidden of ["Hidden Cellar", "hidden_cellar"]) expect(shown).not.toContain(hidden);
    // A narrated move of the POV's says where they went: it is the only one.
    read = { proposals: [{ type: "location", entity: "pov", place: "lakefront_park" }], where: "bluebird_coffee" };
    await rig.turn(chatId, "I look around.", "You wander down to the lakefront.");
    expect((await moveChips(rig, chatId)).map((c) => [c.kind, c.label])).toEqual([["undo", "you → Lakefront Park"]]);
    expect(await povPlace(rig, chatId)).toBe("lakefront_park");
    // A reply that has them somewhere else, with no move: the move there, offered.
    read = { proposals: [], where: "bluebird_coffee" };
    await rig.turn(chatId, "I look around.", "You sip a latte at Bluebird Coffee.");
    expect((await moveChips(rig, chatId)).map((c) => [c.kind, c.label])).toEqual([["confirm", "you → Bluebird Coffee"]]);
    expect(await povPlace(rig, chatId)).toBe("lakefront_park");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
