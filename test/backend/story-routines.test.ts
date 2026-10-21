// What the story changes of a character's routine (DESIGN §8, §9.4): a reply that states a new shift
// changes that character's routine from the next day, as the chat's own change with source `story`
// and its turn. A habit only mentioned, a mind's thought, someone the reply doesn't name, a place the
// player can't know of, or a clash with their schedule the reply doesn't say it replaces changes
// nothing. Its chip undoes it, a GM edit drops it, a Re-narrate that doesn't tell it again has none, a
// replay folds it alike, and a change the story makes never ends what the player can't know of.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import type { MindsGmView } from "../../src/shared/minds";
import type { LaidBlock, RoutineChangeSummary, RoutineGmView } from "../../src/shared/routines";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";
const MIND_MARK = "You are the private mind of";

interface Chat {
  rig: Rig;
  chatId: string;
}

/** A Port Alder chat on its first morning, a Monday, one turn played; `routines` are authored first. `helper` answers every call. */
async function alder(opts: { routines?: Record<string, JsonObject>; minds?: boolean; helper?: (req: QuietRequest) => string } = {}): Promise<Chat> {
  const rig = new Rig({ shipped: true, ...(opts.minds ? { minds: true } : {}) });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  if (opts.routines) {
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    for (const [id, value] of Object.entries(opts.routines)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "routines", id, value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = opts.helper ?? (() => "{}");
  await rig.turn(chatId, "I look around.", "The flat is quiet.");
  return { rig, chatId };
}

/** Plays a turn whose reply the extractor reads as `proposals`. */
async function told(chat: Chat, proposals: JsonObject[], user: string, reply: string): Promise<void> {
  chat.rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await chat.rig.turn(chat.chatId, user, reply);
}

/** Someone's routine and day as the GM reads them, `offset` days from today. */
async function day(chat: Chat, entity: string, offset = 0): Promise<RoutineGmView> {
  const today = (chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "day", entity, view: "gm" })).gm as RoutineGmView).day.index;
  return chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "day", entity, view: "gm", day: today + offset })).gm as RoutineGmView;
}

/** Everyone this chat changed, as the GM's list reads it. */
async function changed(chat: Chat): Promise<RoutineChangeSummary[]> {
  return chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "changed" })).changed as RoutineChangeSummary[];
}

/** The blocks of a day the chat's own changes laid. */
function changedBlocks(view: RoutineGmView): LaidBlock[] {
  return view.day.blocks.filter((b) => b.origin.type === "routine" && b.origin.owner.level === "chat");
}

async function chips(chat: Chat): Promise<{ id: string; kind: string; label: string }[]> {
  return (await chat.rig.rt.view(chat.chatId, chat.rig.host.userId)).chips;
}

async function home(chat: Chat, entity: string): Promise<unknown> {
  const core = await chat.rig.rt.ledger.core(chat.chatId, chat.rig.host.userId);
  return core?.fold(toChain(await chat.rig.host.chats.messages(chat.chatId, chat.rig.host.userId))).state.entities[entity]?.fields.home;
}

const NIGHTS: JsonObject = { type: "routine", entity: "marcus_delgado", change: "start", label: "Night shift at the marina", days: "weekdays", start: "22:00", end: "06:00", activity: "work", place: "alder_harbor_marina" };
const NIGHTS_SAID = "Marcus rubs his eyes. \"Took the night shift at the marina, weekdays, ten till six.\"";

describe("a reply that states a change to someone's week", () => {
  test("a new shift is theirs from the next day, as the story's change with its turn", async () => {
    const chat = await alder();
    await told(chat, [NIGHTS], "Marcus, you look beat.", NIGHTS_SAID);
    const turn = chat.rig.host.head(chat.chatId)?.id;
    expect(turn).toBeDefined();
    // Today was laid as the story had it; tomorrow night he works at the marina, and no morning before it is his shift's.
    expect(changedBlocks(await day(chat, "marcus_delgado"))).toEqual([]);
    const tomorrow = changedBlocks(await day(chat, "marcus_delgado", 1));
    expect(tomorrow.map((b) => [b.from, b.place, b.activity])).toEqual([["22:00", "alder_harbor_marina", "work"]]);
    expect(tomorrow[0]?.origin).toMatchObject({ type: "routine", owner: { level: "chat" }, source: { type: "story", turn } });
    // The night after, the shift he started the night before runs into the morning.
    expect(changedBlocks(await day(chat, "marcus_delgado", 2)).map((b) => b.from)).toEqual(["00:00", "22:00"]);
    // The GM's list has it among the changes the story made, for him alone; the player has its chip.
    const list = await changed(chat);
    expect(list.map((c) => c.entity)).toEqual(["marcus_delgado"]);
    expect(list[0]?.blocks).toEqual([{ block: expect.any(String), source: expect.objectContaining({ type: "story", turn }), off: false }]);
    expect(list[0]?.schedules).toEqual([]);
    expect((await chips(chat)).some((c) => c.kind === "undo" && c.label.includes("Night shift at the marina"))).toBe(true);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("its chip undoes it, a GM edit drops it, and a habit the story ends goes", async () => {
    const chat = await alder();
    await told(chat, [NIGHTS], "Marcus, you look beat.", NIGHTS_SAID);
    const undo = (await chips(chat)).find((c) => c.kind === "undo" && c.label.includes("Night shift"));
    if (!undo) throw new Error("no undo chip");
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: undo.id, choice: "undo" }));
    expect(await changed(chat)).toEqual([]);
    expect(changedBlocks(await day(chat, "marcus_delgado", 1))).toEqual([]);

    // Told again, the GM takes it back from the routine controls.
    await told(chat, [NIGHTS], "So, the marina?", NIGHTS_SAID);
    const block = (await changed(chat))[0]?.blocks[0]?.block;
    if (!block) throw new Error("no change");
    chat.rig.body(await chat.rig.send({ type: "lre.edit", chatId: chat.chatId, ops: [{ op: "routine_block", entity: "marcus_delgado", block, value: null }] }));
    expect(await changed(chat)).toEqual([]);

    // A habit the story gave him, then one he gave up.
    await told(chat, [{ type: "routine", entity: "marcus_delgado", change: "start", label: "Swimming", days: ["tuesday", "thursday"], start: "06:00", end: "06:25", place: "lakefront_park", activity: "exercise" }], "You swim now?", "Marcus nods. \"Tuesdays and Thursdays at six, out at the lake.\"");
    expect((await changed(chat))[0]?.blocks.map((b) => b.off)).toEqual([false]);
    await told(chat, [{ type: "routine", entity: "marcus_delgado", change: "stop", label: "swimming" }], "Still swimming?", "Marcus laughs. \"Gave up swimming. Too cold.\"");
    expect(await changed(chat)).toEqual([]);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("a clash with their schedule changes nothing unless the reply says the new shift takes its place; then it takes them off it", async () => {
    const chat = await alder();
    const days: JsonObject = { type: "routine", entity: "marcus_delgado", change: "start", label: "Day shift at the marina", days: "weekdays", start: "08:00", end: "16:00", activity: "work", place: "alder_harbor_marina" };
    await told(chat, [days], "Busy week?", "Marcus says he's picked up days at the marina.");
    expect(await changed(chat)).toEqual([]);
    await told(chat, [{ ...days, replaces: true }], "And the garage?", "Marcus shrugs. \"Sold my share. I work days at the marina now, instead.\"");
    const list = await changed(chat);
    expect(list[0]?.schedules.map((s) => [s.schedule, s.off, s.source.type]).sort()).toEqual([
      ["marcus_delgado_activity_1", true, "story"],
      ["marcus_delgado_place_1", true, "story"],
    ]);
    // Tomorrow: the marina from eight, and no weekday at the garage.
    const tomorrow = await day(chat, "marcus_delgado", 1);
    expect(changedBlocks(tomorrow).map((b) => [b.from, b.place])).toEqual([["08:00", "alder_harbor_marina"]]);
    expect(tomorrow.day.blocks.some((b) => b.place === "alder_automotive")).toBe(false);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("moving house moves their home", async () => {
    const chat = await alder();
    expect(await home(chat, "danny_okafor")).toBe("harbor_street_114");
    await told(chat, [{ type: "routine", entity: "danny_okafor", change: "move", label: "Moved onto his boat", place: "alder_harbor_marina" }], "Danny, you moving?", "Danny grins. \"Living on the boat at the marina now.\"");
    expect(await home(chat, "danny_okafor")).toBe("alder_harbor_marina");
    const undo = (await chips(chat)).find((c) => c.kind === "undo" && c.label.includes("moved"));
    if (!undo) throw new Error("no undo chip");
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: undo.id, choice: "undo" }));
    expect(await home(chat, "danny_okafor")).toBe("harbor_street_114");
  });
});

/** Whom the chat changed, by entity. */
async function who(chat: Chat): Promise<string[]> {
  return (await changed(chat)).map((c) => c.entity);
}

describe("what changes no one's routine", () => {
  test("a habit only mentioned in passing: already their schedule or their routine", async () => {
    const swim = { id: "priya_swim", owner: "priya_nair", blocks: [{ id: "swim", label: "Swim at the lake", activity: "exercise", kind: "fixed", at: "07:00", minutes: 60, days: { weekdays: [2] }, place: { place: "lakefront_park" } }] };
    const chat = await alder({ routines: { priya_swim: swim } });
    const drinks = (day: string): JsonObject => ({ type: "routine", entity: "danny_okafor", change: "start", label: "Drinks with friends", days: [day], start: "17:30", end: "21:30", activity: "socialize", place: "rusty_anchor" });
    const swimming = (day: string): JsonObject => ({ type: "routine", entity: "priya_nair", change: "start", label: "Swimming", days: day, start: "07:00", end: "08:00", activity: "exercise", place: "lakefront_park" });
    await told(chat, [drinks("friday"), swimming("tuesday")], "Morning, both.", "Danny says he'll see Priya at the Anchor Friday, like always; Priya's hair is still damp from her Tuesday swim.");
    expect(await who(chat)).toEqual([]);
    expect((await chips(chat)).some((c) => c.label.includes("routine"))).toBe(false);
    // What they don't do yet is a change: drinks on Thursdays too, a swim on Wednesdays.
    await told(chat, [drinks("thursday"), swimming("wednesday")], "Thursdays now?", "Danny says he's added Thursday drinks at the Anchor; Priya says she's swimming Wednesdays as well.");
    expect(await who(chat)).toEqual(["danny_okafor", "priya_nair"]);
  });

  test("a mind's thought: no mind reaches the read of the reply, which alone counts", async () => {
    const SWIM = "start swimming at the lakefront on Tuesdays";
    const helper = (req: QuietRequest): string => {
      const content = req.messages.map((m) => m.content).join("\n");
      if (content.includes(MIND_MARK)) return JSON.stringify({ monologue: `Maybe I'll ${SWIM}.`, depiction: "busy", intent: `To ${SWIM}.`, reactions: [], plans: [], mood: "calm" });
      // An extractor that takes every mention of it for a change: a thought that reached it would change his routine.
      if (content.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: /swimming/i.test(content) ? [{ type: "routine", entity: "danny_okafor", change: "start", label: "Swimming", days: "tuesday", start: "18:00", end: "19:00", activity: "exercise", place: "lakefront_park" }] : [] });
      return "{}";
    };
    const chat = await alder({ minds: true, helper });
    await chat.rig.turn(chat.chatId, "Morning, Danny.", "Danny nods at you over his coffee.");
    const minds = chat.rig.body(await chat.rig.send({ type: "lre.gm", chatId: chat.chatId })).minds as MindsGmView;
    expect(minds.characters.find((c) => c.entity === "danny_okafor")?.mind?.monologue).toContain("swimming");
    expect(await who(chat)).toEqual([]);
    // When the reply says it, it is the story's.
    await chat.rig.turn(chat.chatId, "Any news?", "Danny says he's started swimming at the lakefront on Tuesdays.");
    expect(await who(chat)).toEqual(["danny_okafor"]);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("someone the reply doesn't name, or a place the player can't know of", async () => {
    const chat = await alder();
    await told(chat, [{ ...NIGHTS, entity: "priya_nair" }], "Long week?", NIGHTS_SAID);
    expect(await who(chat)).toEqual([]);
    // 12 Birch Lane is Marcus's home, and secret: a reply's read never finds it, by its id or its name.
    const evenings: JsonObject = { ...NIGHTS, label: "Evening shift", start: "18:00", end: "21:00" };
    await told(chat, [{ ...evenings, place: "birch_lane_12" }, { ...evenings, place: "12 Birch Lane" }], "Where are you evenings?", "Marcus says he works evenings at home now.");
    expect(await who(chat)).toEqual([]);
    expect((await chips(chat)).some((c) => c.label.includes("Birch") || c.label.includes("routine"))).toBe(false);
    // Named, and somewhere the player knows: the story's.
    await told(chat, [{ ...NIGHTS, entity: "priya_nair" }, { ...evenings, place: "rusty_anchor" }], "And Priya?", "Priya took the night shift at the marina; Marcus works evenings at the Anchor now.");
    expect(await who(chat)).toEqual(["marcus_delgado", "priya_nair"]);
  });
});

describe("secrecy and replay", () => {
  test("what the story ends never takes a private block, and its chip names only the reply's own words", async () => {
    const bookie = { id: "danny_private", owner: "danny_okafor", blocks: [{ id: "bookie", label: "Settles up with the bookie", activity: "errand", kind: "fixed", at: "22:00", minutes: 30, days: { weekdays: [5] }, place: { place: "rusty_anchor" }, private: true }] };
    const chat = await alder({ routines: { danny_private: bookie } });
    await told(chat, [{ type: "routine", entity: "danny_okafor", change: "stop", label: "Friday drinks at the Anchor", place: "rusty_anchor" }], "Coming Friday?", "Danny shakes his head. \"I'm done with Friday drinks at the Anchor.\"");
    const list = await changed(chat);
    expect(list[0]?.blocks).toEqual([]);
    expect(list[0]?.schedules.map((s) => [s.schedule, s.off]).sort()).toEqual([
      ["danny_okafor_activity_2", true],
      ["danny_okafor_place_2", true],
    ]);
    // His private block stays in force, and nothing the player sees names it.
    expect((await day(chat, "danny_okafor")).blocks.find((b) => b.block.id === "bookie")?.off).toBe(false);
    const labels = (await chips(chat)).map((c) => c.label).join("\n");
    expect(labels).toContain("Friday drinks at the Anchor");
    expect(labels).not.toContain("bookie");
    expect(JSON.stringify(chat.rig.latestView(chat.chatId))).not.toContain("bookie");
  });

  test("a replay folds the change alike, and a Re-narrate that doesn't tell it again has none", async () => {
    const chat = await alder();
    await told(chat, [NIGHTS], "Marcus, you look beat.", NIGHTS_SAID);
    const before = { changed: await changed(chat), tomorrow: await day(chat, "marcus_delgado", 1) };
    const again: Chat = { rig: chat.rig.restart(), chatId: chat.chatId };
    expect({ changed: await changed(again), tomorrow: await day(again, "marcus_delgado", 1) }).toEqual(before);

    again.rig.rt.setSwipeChoice(again.chatId, "renarrate");
    again.rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [] }) : "{}");
    await again.rig.host.finish(await again.rig.host.start(again.chatId, { type: "swipe" }), "Marcus shrugs and says nothing.");
    expect(await changed(again)).toEqual([]);
    expect(again.rig.rt.ledger.errors).toEqual([]);
  });
});
