// A routine the player's own message states (DESIGN §9.4, §8): it brings up "Would you like to add
// this to your routine?" on that message, naming the change plainly, and nothing changes without the
// player's yes. Yes records it as the story's changes are, with the message as its turn and the
// player as who said it, from the next day; No records nothing; Undo takes it back. A question, words
// the message doesn't hold, what is already their routine, or a place the player can't know of brings
// up no ask.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import type { VNode } from "preact";
import { Badge, IdText, ListRow } from "../../src/frontend/components";
import { gmReloadKey } from "../../src/frontend/play/gm";
import { CharacterRows, RoutineSections } from "../../src/packs/castlife/ui/routines-gm";
import { routineRows } from "../../src/packs/castlife/ui/routines-ops";
import type { LaidBlock, RoutineChangeSummary, RoutineGmView } from "../../src/shared/routines";
import { DEFAULT_ROUTINE_ROLES } from "../../src/shared/routines";
import type { Chip, GmView, StateView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";
import { expand, propsOf, type Props } from "../support/tree";

const INTERPRET_MARK = "You map a player's typed input";

interface Chat {
  rig: Rig;
  chatId: string;
}

/** A Port Alder chat on its first morning, a Monday, one turn played; `routines` are authored first. */
async function alder(routines: Record<string, JsonObject> = {}): Promise<Chat> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  if (Object.keys(routines).length > 0) {
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    for (const [id, value] of Object.entries(routines)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "routines", id, value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around.", "The flat is quiet.");
  return { rig, chatId };
}

/** Plays a turn whose typed message `interpret` reads as stating `routine` (and no action); every other step reads nothing. */
async function said(chat: Chat, user: string, routine: JsonObject[], reply = "Marcus nods."): Promise<void> {
  chat.rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9, routine }) : "{}");
  await chat.rig.turn(chat.chatId, user, reply);
}

async function chips(chat: Chat): Promise<Chip[]> {
  return (await chat.rig.rt.view(chat.chatId, chat.rig.host.userId)).chips;
}

async function asks(chat: Chat): Promise<Chip[]> {
  return (await chips(chat)).filter((c) => c.kind === "routine_ask");
}

/** The player's last message. */
async function lastUser(chat: Chat): Promise<string> {
  const id = toChain(await chat.rig.host.chats.messages(chat.chatId, chat.rig.host.userId)).findLast((m) => m.isUser)?.id;
  if (!id) throw new Error("no player message");
  return id;
}

async function changed(chat: Chat): Promise<RoutineChangeSummary[]> {
  return chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "changed" })).changed as RoutineChangeSummary[];
}

/** The blocks the chat's own changes laid for someone, `offset` days from today. */
async function changedOn(chat: Chat, entity: string, offset: number): Promise<LaidBlock[]> {
  const today = (chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "day", entity, view: "gm" })).gm as RoutineGmView).day.index;
  const view = chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "day", entity, view: "gm", day: today + offset })).gm as RoutineGmView;
  return view.day.blocks.filter((b) => b.origin.type === "routine" && b.origin.owner.level === "chat");
}

async function answer(chat: Chat, chip: Chip, choice: string): Promise<void> {
  chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: chip.id, choice }));
}

/** The state the chat's pages hold once every scheduled push is sent (a delta of it, after the first snapshot). */
async function pushed(chat: Chat): Promise<StateView> {
  await chat.rig.rt.push.settle();
  return chat.rig.rt.view(chat.chatId, chat.rig.host.userId);
}

/** The words a rendered tree shows. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** GM → Routines' "Changes made in play" for someone, as rendered from the backend's reads: each row's title, its turns and its words. */
async function storyRows(chat: Chat, entity: string): Promise<{ title: unknown; ids: unknown[]; text: string }[]> {
  const view = chat.rig.body(await chat.rig.send({ type: "lre.routine", chatId: chat.chatId, op: "day", entity, view: "gm" })).gm as RoutineGmView;
  const gm = chat.rig.body(await chat.rig.send({ type: "lre.gm", chatId: chat.chatId })) as unknown as GmView;
  const summary = (await changed(chat)).find((s) => s.entity === entity);
  const root = RoutineSections({ view, gm, summary, busy: false, open: () => undefined }) as VNode<Props>;
  const children = root.props.children;
  const tree = (Array.isArray(children) ? children : [children]).map((child) => expand(child));
  const list = propsOf(tree, "div").find((p) => p["data-lre-gm-list"] === "routine-story");
  return propsOf(list?.children, ListRow).map((r) => ({ title: r.title, ids: propsOf(r.subtitle, IdText).map((p) => p.id), text: textOf(r.subtitle) }));
}

/** GM → Routines' list as rendered from the backend's reads: each badged row's badge words, by entity. */
async function listBadges(chat: Chat): Promise<Record<string, string>> {
  const gm = chat.rig.body(await chat.rig.send({ type: "lre.gm", chatId: chat.chatId })) as unknown as GmView;
  const tree = CharacterRows({ rows: routineRows(gm.minds.characters, gm.entities, await changed(chat), DEFAULT_ROUTINE_ROLES), onOpen: () => undefined });
  const out: Record<string, string> = {};
  for (const row of propsOf(tree, ListRow)) {
    const badge = propsOf(row.subtitle, Badge)[0];
    if (badge && typeof row.id === "string") out[row.id] = textOf(badge.children);
  }
  return out;
}

const SWIM_SAID = "Marcus says he's started swimming at Lakefront Park on Tuesdays at six";
const SWIM: JsonObject = { entity: "marcus_delgado", change: "start", label: "Swimming", days: ["tuesday"], start: "06:00", end: "06:25", activity: "exercise", place: "lakefront_park", said: SWIM_SAID };

describe("a routine the player's message states", () => {
  test("brings up the ask on that message, naming who, what, when and where, and changes nothing yet", async () => {
    const chat = await alder();
    await said(chat, `${SWIM_SAID}. I tell him that's brave in this weather.`, [SWIM]);
    const [ask, ...more] = await asks(chat);
    if (!ask) throw new Error("no ask");
    expect(more).toEqual([]);
    expect(ask.messageId).toBe(await lastUser(chat));
    expect(ask.label).toContain("Marcus");
    expect(ask.actions.map((a) => a.id)).toEqual(["yes", "no"]);
    for (const part of ["Marcus", "Swimming", "tuesday", "06:00", "Lakefront Park"]) expect(ask.detail).toContain(part);
    expect(await changed(chat)).toEqual([]);

    // The player character's own: "your routine".
    await said(chat, "I start nights at the marina Monday, ten till six, weekdays.", [{ entity: "pov", change: "start", label: "Nights at the marina", days: "weekdays", start: "22:00", end: "06:00", activity: "work", place: "alder_harbor_marina", said: "I start nights at the marina Monday, ten till six, weekdays" }]);
    const mine = await asks(chat);
    expect(mine.map((c) => c.label.includes("your routine"))).toEqual([true]);
    expect(await changed(chat)).toEqual([]);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("Yes records it with its source and turn, from the next day; Undo takes it back", async () => {
    const chat = await alder();
    await said(chat, `${SWIM_SAID}.`, [SWIM]);
    const turn = await lastUser(chat);
    const [ask] = await asks(chat);
    if (!ask) throw new Error("no ask");
    await answer(chat, ask, "yes");
    const list = await changed(chat);
    expect(list.map((c) => c.entity)).toEqual(["marcus_delgado"]);
    expect(list[0]?.blocks).toEqual([{ block: expect.any(String), label: "Swimming", source: expect.objectContaining({ type: "story", turn, by: "player" }), off: false }]);
    // Today (Monday) was laid already; tomorrow, Tuesday, he swims at six.
    expect(await changedOn(chat, "marcus_delgado", 0)).toEqual([]);
    expect((await changedOn(chat, "marcus_delgado", 1)).map((b) => [b.from, b.place, b.activity])).toEqual([["06:00", "lakefront_park", "exercise"]]);
    expect(await asks(chat)).toEqual([]);

    const added = (await chips(chat)).find((c) => c.kind === "routine_added");
    if (!added) throw new Error("no Undo");
    expect(added.messageId).toBe(turn);
    await answer(chat, added, "undo");
    expect(await changed(chat)).toEqual([]);
    expect(await changedOn(chat, "marcus_delgado", 1)).toEqual([]);
    expect(chat.rig.rt.ledger.errors).toEqual([]);
  });

  test("Yes and its Undo each move the chat on, so GM mode reads it again at once", async () => {
    const chat = await alder();
    await said(chat, `${SWIM_SAID}.`, [SWIM]);
    const before = await pushed(chat);
    const [ask] = await asks(chat);
    if (!ask) throw new Error("no ask");
    await answer(chat, ask, "yes");
    const yes = await pushed(chat);
    // The pushed state already has the Undo, and its change is one GM mode reloads on.
    expect(yes.chips.some((c) => c.kind === "routine_added")).toBe(true);
    expect(gmReloadKey(yes)).not.toBe(gmReloadKey(before));
    const added = yes.chips.find((c) => c.kind === "routine_added");
    if (!added) throw new Error("no Undo");
    await answer(chat, added, "undo");
    expect(gmReloadKey(await pushed(chat))).not.toBe(gmReloadKey(yes));
  });

  test("GM → Routines lists it by its own name, from the player's message with its turn, in its row and its badge; the reply's change stays the story's", async () => {
    const chat = await alder();
    await said(chat, `${SWIM_SAID}.`, [{ ...SWIM, label: "Swimming at Lakefront Park" }]);
    const turn = await lastUser(chat);
    const [ask] = await asks(chat);
    if (!ask) throw new Error("no ask");
    await answer(chat, ask, "yes");
    // The reply's own change, for someone else.
    chat.rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes("propose concrete state changes") ? JSON.stringify({ proposals: [{ type: "routine", entity: "danny_okafor", change: "start", label: "Night shift at the marina", days: "weekdays", start: "22:00", end: "06:00", activity: "work", place: "alder_harbor_marina" }] }) : "{}");
    await chat.rig.turn(chat.chatId, "Danny, you look beat.", "Danny rubs his eyes. \"Took the night shift at the marina, weekdays, ten till six.\"");
    const mine = await storyRows(chat, "marcus_delgado");
    const told = await storyRows(chat, "danny_okafor");
    expect(mine.map((r) => [r.title, r.ids])).toEqual([["Swimming at Lakefront Park", [turn]]]);
    expect(told.map((r) => r.title)).toEqual(["Night shift at the marina"]);
    // The wording is what's at stake: where each came from, plainly, and the in-force line names no source.
    expect(mine[0]?.text).toContain("From your message");
    expect(mine[0]?.text).not.toContain("story");
    expect(told[0]?.text).toContain("The story");
    const badges = await listBadges(chat);
    expect(badges.marcus_delgado).toBe("Changed from your message");
    expect(badges.danny_okafor).toBe("Changed by the story");
  });

  test("No records nothing", async () => {
    const chat = await alder();
    await said(chat, `${SWIM_SAID}.`, [SWIM]);
    const [ask] = await asks(chat);
    if (!ask) throw new Error("no ask");
    await answer(chat, ask, "no");
    expect(await asks(chat)).toEqual([]);
    expect((await chips(chat)).some((c) => c.kind === "routine_added")).toBe(false);
    expect(await changed(chat)).toEqual([]);
    expect(await changedOn(chat, "marcus_delgado", 1)).toEqual([]);
  });

  test("the ask names each part once: a place its label names isn't named again", async () => {
    const chat = await alder();
    const { end: _end, ...evening } = SWIM;
    await said(chat, "Marcus says he's started swimming at Lakefront Park on Thursday evenings.", [{ ...evening, label: "swimming at Lakefront Park", days: ["thursday"], start: "evening", said: "Marcus says he's started swimming at Lakefront Park on Thursday evenings" }]);
    const [ask] = await asks(chat);
    if (!ask) throw new Error("no ask");
    // The place once, and the label and the day still named.
    expect(ask.detail?.split("Lakefront Park").length).toBe(2);
    expect(ask.detail).toContain("swimming at Lakefront Park");
    expect(ask.detail).toContain("thursday");
  });
});

describe("what brings up no ask", () => {
  test("a question, words the message doesn't hold, or what is already their routine", async () => {
    const swim = { id: "priya_swim", owner: "priya_nair", blocks: [{ id: "swim", label: "Swim at the lake", activity: "exercise", kind: "fixed", at: "07:00", minutes: 60, days: { weekdays: [2] }, place: { place: "lakefront_park" } }] };
    const chat = await alder({ priya_swim: swim });
    // An over-eager read takes each of these for a stated change: the engine still asks nothing.
    await said(chat, "Marcus, do you still swim at Lakefront Park on Tuesdays at six?", [{ ...SWIM, said: "do you still swim at Lakefront Park on Tuesdays at six" }]);
    expect(await asks(chat)).toEqual([]);
    await said(chat, "Morning, Marcus.", [SWIM]);
    expect(await asks(chat)).toEqual([]);
    await said(chat, "Priya's hair is still damp from her Tuesday swim at the lake.", [{ entity: "priya_nair", change: "start", label: "Swimming", days: "tuesday", start: "07:00", end: "08:00", activity: "exercise", place: "lakefront_park", said: "Priya's hair is still damp from her Tuesday swim at the lake" }]);
    expect(await asks(chat)).toEqual([]);
    expect(await changed(chat)).toEqual([]);
  });

  test("a place the player can't know of, by its id or its name, is never asked about", async () => {
    const chat = await alder();
    const words = "Marcus says he works evenings at 12 Birch Lane now, six till nine";
    const evenings: JsonObject = { entity: "marcus_delgado", change: "start", label: "Evening shift", days: "weekdays", start: "18:00", end: "21:00", activity: "work", said: words };
    await said(chat, `${words}.`, [{ ...evenings, place: "birch_lane_12" }, { ...evenings, place: "12 Birch Lane" }]);
    expect(await asks(chat)).toEqual([]);
    expect(JSON.stringify(await chips(chat))).not.toContain("Birch");
    expect(await changed(chat)).toEqual([]);
  });

  test("a place the world doesn't have brings up no ask", async () => {
    const chat = await alder();
    // Port Alder has no pool: the read gives the place in the message's own words, as nothing lists it.
    const words = "Marcus mentions he's started swimming at the community pool every Tuesday evening";
    await said(chat, `${words}.`, [{ ...SWIM, label: "Swimming", place: "the community pool", start: "evening", said: words }]);
    expect(await asks(chat)).toEqual([]);
    expect(await changed(chat)).toEqual([]);
  });
});
