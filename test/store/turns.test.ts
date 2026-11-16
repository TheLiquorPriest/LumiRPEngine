// The turn tree (plan §6.3): swipes are siblings, the path is the chain of showing swipes, a swipe is
// known by its date and saved hash and never by its position, messages gone take their turns off the
// path, a branch shares its source's turns through the chat application's old-to-new id map, and the
// path keeps each message's hidden mark. The extension's question (plan §4.2, §9.6, R-5, R-21) is
// answered from RPE's own store, on the path the question carries: the state where the coming turn
// will start, as the turn's own comparison will then find it, and that path with the store's marks.

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { castAt } from "../../src/cast/path";
import { CAST_MIGRATIONS, dropCastStaged, joinCast, takeBackCast } from "../../src/cast/index";
import { writeCast } from "../../src/cast/record";
import { LORE_MIGRATIONS } from "../../src/lore/schema";
import { hashJson } from "../../src/shared/hash";
import { swipeIndex } from "../../src/store/path";
import { migrateStore, STORE_MIGRATIONS } from "../../src/store/schema";
import { openStore, type Store, type UserStore } from "../../src/store/store";
import { JoinedTurnError, StoreInputError, type SeenMessage, type ShownMessage, type TurnRow } from "../../src/store/types";
import { storyAt } from "../../src/story/path";
import { recordStory, STORY_MIGRATIONS } from "../../src/story/index";
import { carried, engine, goTo, hand, hashOf, make, moveStoredClock, play, POV, registry, shown, testStore, tick, USER, type TestStore } from "./fixtures";
import { CHAT, CONNECTION, GREETING, openTurnBed, PRESET, replying, settledTurn, USER as BED_USER, type TurnBed } from "../turn/bed";

const placeOf = (s: UserStore, chat: string): unknown => s.headState(chat).state.world.entities[POV]?.fields.place;

/** Another store over the same database: nothing held in memory, as after a restart. */
function reopened(ts: TestStore): Store {
  return openStore({ db: ts.store.db, registry: registry(), worlds: (r) => ts.worlds.get(r) });
}

/**
 * A chat's path as the extension sees it where it asks: the player's lines `[id, text]` and replies `[id, text, swipe]`, each at
 * its place. Lumiverse's World Info context gives each message's id, `is_user`, `swipe_id`, `index_in_chat` and the text it shows,
 * and no swipe date and no hidden flag (`src/services/prompt-assembly.service.ts:2289-2305`).
 */
function seen(...messages: ([string, string] | [string, string, number])[]): SeenMessage[] {
  return messages.map(([id, text, swipe], index) => ({ id, user: swipe === undefined, index, swipe: swipe ?? 0, hash: hashOf(text) }));
}

/** The same path as the turn's own comparison is later shown it, each reply with its swipe's date. */
function asShown(path: readonly SeenMessage[], dates: Readonly<Record<string, number>>): ShownMessage[] {
  return path.map((m) => (m.user ? { id: m.id, user: true, hash: m.hash, hidden: false } : { id: m.id, user: false, hash: m.hash, date: dates[m.id] ?? null, hidden: false }));
}

/** How many changes the store's database has made so far: a call that writes nothing leaves it as it is. */
const written = (ts: TestStore): number | undefined => ts.store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n;

describe("hidden marks", () => {
  let bed: TurnBed | null = null;
  afterEach(async () => {
    await bed?.close();
    bed = null;
  });

  test("the path keeps each message's hidden mark, and a mark changed since is taken at the next comparison", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "They meet.", 1, engine(tick(10)));
    play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const chat = shown(["u1", "hello"], ["m1", "They meet.", 1], ["u2", "an aside"], ["m2", "She goes down to the cellar.", 2]);
    // The player hides messages from the prompt: Lumiverse sets each one's `extra.hidden` (`bulkSetHidden`,
    // `src/services/chats.service.ts:3087-3110`), and prompt assembly skips it (`prompt-assembly.service.ts:3252`).
    const showing = (...hidden: string[]): ShownMessage[] => chat.map((m) => ({ ...m, hidden: hidden.includes(m.id) }));
    const marks = (u: UserStore) => u.path("c").map((e) => [e.message, e.hidden]);
    s.sync("c", showing("u2", "m2"));
    expect(marks(s)).toEqual([
      ["u1", false],
      ["m1", false],
      ["u2", true],
      ["m2", true],
    ]);
    // Kept with the chat: a store opened again on its database, as after a restart, holds the same marks.
    expect(marks(reopened(ts).user(USER))).toEqual(marks(s));

    // The aside's reply shown again and the greeting hidden: the next comparison takes the marks as shown. A mark is no edit and
    // no swipe: the turns and the state stand.
    const report = s.sync("c", showing("u1", "u2"));
    expect(marks(s)).toEqual([
      ["u1", true],
      ["m1", false],
      ["u2", true],
      ["m2", false],
    ]);
    expect(report).toMatchObject({ gone: [], swiped: null, flipped: [], rebased: null, edited: [], unplayed: [] });
    expect(placeOf(s, "c")).toBe("cellar");

    // A swipe RPE plays of a hidden reply keeps the message's mark: Lumiverse keeps a message's `extra` when it adds a swipe
    // (`chats.service.ts:274`, `:3311-3318`). A reply new to the chat comes with none: its message is made with no hidden mark
    // (`generate.service.ts:1988-2003`).
    s.sync("c", showing("m2"));
    const swipe = play(s, "c", "m2", "She steps out to the market.", 3, engine(goTo(POV, "market_square")), { target: "m2" });
    play(s, "c", "m3", "The market is loud.", 4, []);
    expect(s.path("c").map((e) => [e.message, e.turn === swipe.id, e.hidden])).toEqual([
      ["u1", false, false],
      ["m1", false, false],
      ["u2", false, false],
      ["m2", true, true],
      ["m3", false, false],
    ]);
    // Ids, hashes and marks only: no message's text is kept on the path.
    const stored = ts.store.db.query<{ path: string }, [string]>("SELECT path FROM chat WHERE id = ?").get("c")?.path ?? "";
    for (const text of ["hello", "They meet.", "an aside", "She goes down to the cellar.", "She steps out to the market.", "The market is loud."]) expect(stored).not.toContain(text);
  });

  test("a turn's comparison takes each message's hidden mark from the chat as Lumiverse shows it", async () => {
    // A message the player hid has `extra.hidden` in its row (`chats.service.ts:3106`); the stand-in writes it so, and RPE reads the
    // chat's path from those rows when a turn starts.
    const b = (bed = await openTurnBed({
      answers: [replying("The stair creaks under you.")],
      messages: [
        { id: "m-greeting", role: "assistant", content: GREETING },
        { id: "u-aside", role: "user", content: "(Marlow mutters to himself about the weather.)", hidden: true },
      ],
    }));
    const said = b.host.send(CHAT, "I climb the stairs.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "normal" });
    expect(out.error).toBeNull();
    const reply = (await settledTurn(b, out.generationId ?? "")).message;
    if (reply === null) throw new Error("the turn was not tied to a reply");
    expect(b.turns.store.user(BED_USER).path(CHAT).map((e) => [e.message, e.hidden])).toEqual([
      ["m-greeting", false],
      ["u-aside", true],
      [said, false],
      [reply, false],
    ]);
  });
});

/** A message of a path as a test writes it: a player's line `[id, text]`, or a reply `[id, text, swipe]`. */
type Line = [string, string] | [string, string, number];

describe("the question's call", () => {
  test("after a restart the question's call answers from RPE's own snapshot, for the head and for a swipe's point, and holds the state", () => {
    let clock = 0;
    const ts = testStore({ snapshotEvery: 4, now: () => ++clock });
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    // Ten played turns, each passing time and moving Wren on; a snapshot is kept at every fourth along the path.
    const places = ["cellar", "market_square", "far_road", "common_room"];
    const turns = Array.from({ length: 10 }, (_, i) => play(s, "c", `m${i + 1}`, `Reply ${i + 1}.`, i + 1, engine(tick(i + 1), goTo(POV, places[i % places.length] ?? "cellar"))));
    const [seventh, eighth, ninth, tenth] = turns.slice(6);
    if (!seventh || !eighth || !ninth || !tenth) throw new Error("ten turns were not played");
    // The chat as the last turn's comparison saw it: the player's lines between the replies, an aside and its answer hidden.
    const lines = turns.flatMap((_, i): Line[] => [
      [`u${i + 1}`, `Line ${i + 1}.`],
      [`m${i + 1}`, `Reply ${i + 1}.`, 0],
    ]);
    const dates = Object.fromEntries(turns.map((_, i) => [`m${i + 1}`, i + 1]));
    s.sync("c", asShown(seen(...lines), dates).map((m) => ({ ...m, hidden: m.id === "u5" || m.id === "m5" })));
    const warm = { head: hashJson(s.headState("c").state), swipe: hashJson(s.stateAt(ninth.id).state), deleted: hashJson(s.stateAt(seventh.id).state) };
    // The player's newest line, sent since that comparison: a new reply follows it.
    const now = seen(...lines, ["u11", "Line 11."]);
    // While RPE runs, the answer is the state it holds.
    expect(s.turnStart("c", now, { follows: "u11" }).state).toBe(s.headState("c").state);

    // RPE starts again: nothing is held, and the store is all it has. It reads no chat application and calls no model.
    const cold = reopened(ts).user(USER);
    const before = written(ts);
    const atHead = cold.turnStart("c", now, { follows: "u11" });
    // A swipe of the newest reply: Lumiverse leaves the reply it replaces out of what it shows the extension
    // (`src/services/generate.service.ts:1928-1932`, `src/services/prompt-assembly.service.ts:1900-1904`).
    const atSwipe = cold.turnStart("c", seen(...lines.slice(0, -1)), { replaces: "m10" });
    // The player deletes the last three exchanges and sends a new line: it follows the seventh reply.
    const atDeleted = cold.turnStart("c", seen(...lines.slice(0, 14), ["u11", "Line 11."]), { follows: "u11" });
    expect(written(ts)).toBe(before);
    expect([atHead.node, hashJson(atHead.state)]).toEqual([tenth.node, warm.head]);
    expect([atSwipe.node, hashJson(atSwipe.state)]).toEqual([ninth.node, warm.swipe]);
    expect([atDeleted.node, hashJson(atDeleted.state)]).toEqual([seventh.node, warm.deleted]);
    expect([atHead, atSwipe, atDeleted].map((a) => a.state.world.entities[POV]?.fields.place)).toEqual(["market_square", "cellar", "far_road"]);
    // The path the question carried up to each point, with the marks the store holds by message id, so the window counts no hidden
    // message (R-21); the newest line, which no comparison has seen yet, has none.
    expect(atHead.messages.map((m) => m.id)).toEqual([...lines.map(([id]) => id), "u11"]);
    expect(atSwipe.messages.map((m) => m.id)).toEqual(lines.slice(0, -1).map(([id]) => id));
    expect(atDeleted.messages.map((m) => m.id)).toEqual([...lines.slice(0, 14).map(([id]) => id), "u11"]);
    expect(atHead.messages.filter((m) => m.hidden).map((m) => m.id)).toEqual(["u5", "m5"]);
    expect([atHead, atSwipe, atDeleted].map((a) => a.messages.filter((m) => !m.hidden).length)).toEqual([19, 17, 13]);

    // Held after: the turns that follow start from the very states the question was answered from, with nothing folded again.
    const next = cold.beginTurn({ chat: "c", kind: "normal" });
    expect(cold.startOf(next.id).state).toBe(atHead.state);
    const swipe = cold.beginTurn({ chat: "c", kind: "swipe", target: "m10" });
    expect(cold.startOf(swipe.id).state).toBe(atSwipe.state);

    // What a cold answer builds on is RPE's own snapshot: a state stored at the eighth turn is what both answers continue from.
    moveStoredClock(ts.store.db, eighth.node, 1000);
    const again = reopened(ts).user(USER);
    expect(again.turnStart("c", now, { follows: "u11" }).state.world.clock - atHead.state.world.clock).toBe(1000);
    expect(again.turnStart("c", seen(...lines.slice(0, -1)), { replaces: "m10" }).state.world.clock - atSwipe.state.world.clock).toBe(1000);
  });

  test("after the last exchange is deleted in Lumiverse and before any comparison, the answer for a new line is the state before the deleted exchange", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
    play(s, "c", "m3", "She takes it down to the cellar.", 3, engine(goTo(POV, "cellar"), tick(20)));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "light"],
      ["m2", "Bram lends her a lantern.", 0],
      ["u3", "down"],
      ["m3", "She takes it down to the cellar.", 0],
    ];
    s.sync("c", asShown(seen(...lines), { m1: 1, m2: 2, m3: 3 }));
    // RPE's record stands at the third reply. In Lumiverse the player deletes that exchange and sends a new line.
    const path = seen(...lines.slice(0, 4), ["u4", "wait here"]);
    const before = written(ts);
    const answer = s.turnStart("c", path, { follows: "u4" });
    expect(written(ts)).toBe(before);
    expect([answer.node, hashJson(answer.state)]).toEqual([t2.node, hashJson(s.stateAt(t2.id).state)]);
    expect(answer.state.world.entities[POV]?.fields.place).toBe("common_room");
    expect(s.headState("c").state.world.clock - answer.state.world.clock).toBe(20);
    expect(answer.messages.map((m) => [m.id, m.turn])).toEqual([
      ["u1", null],
      ["m1", t1.id],
      ["u2", null],
      ["m2", t2.id],
      ["u4", null],
    ]);
    // The turn's own comparison then finds the same point, and starts from the state the question was answered from.
    s.sync("c", asShown(path, { m1: 1, m2: 2 }));
    expect(s.headState("c").state).toBe(answer.state);
  });

  test("after the newest reply is flipped to its other swipe and before any comparison, the answer is the state after that swipe's turn", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const cellar = play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const market = play(s, "c", "m2", "She steps out to the market.", 3, engine(goTo(POV, "market_square")), { target: "m2" });
    const lines = (second: Line): Line[] => [["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "where now"], second];
    // The last comparison saw the first swipe showing.
    s.sync("c", asShown(seen(...lines(["m2", "She goes down to the cellar.", 0])), { m1: 1, m2: 2 }));
    expect(placeOf(s, "c")).toBe("cellar");
    // In Lumiverse the player flips to the other swipe and sends a new line.
    const path = seen(...lines(["m2", "She steps out to the market.", 1]), ["u3", "look around"]);
    const answer = s.turnStart("c", path, { follows: "u3" });
    expect([answer.node, hashJson(answer.state)]).toEqual([market.node, hashJson(s.stateAt(market.id).state)]);
    expect(answer.state.world.entities[POV]?.fields.place).toBe("market_square");
    expect(answer.messages.find((m) => m.id === "m2")?.turn).toBe(market.id);
    // Flipped back before any comparison, the answer follows the first swipe again.
    const back = s.turnStart("c", seen(...lines(["m2", "She goes down to the cellar.", 0]), ["u3", "look around"]), { follows: "u3" });
    expect([back.node, back.state.world.entities[POV]?.fields.place]).toEqual([cellar.node, "cellar"]);
    // The turn's own comparison finds the swipe that shows, and starts from the state the question was answered from.
    s.sync("c", asShown(path, { m1: 1, m2: 3 }));
    expect(s.headState("c").state).toBe(answer.state);
  });

  test("after an earlier reply's swipe is flipped and before any comparison, the answer holds the later turns applied again on the new chain", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
    const t3 = play(s, "c", "m3", "She takes it down to the cellar.", 3, engine(goTo(POV, "cellar"), ...hand("lantern", POV, "cask")));
    const t4 = play(s, "c", "m4", "Odile and she talk an hour.", 4, engine(tick(60)));
    // The other swipe of the second reply, made later: a candle, and a longer wait.
    const candle = s.beginTurn({ chat: "c", kind: "swipe", on: t1.node });
    s.addChanges(candle.id, engine(make("candle", "Candle", POV), tick(15)));
    s.tieTurn(candle.id, { message: "m2", hash: hashOf("Bram finds her a candle."), date: 5 });
    const lines = (second: Line): Line[] => [["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "light"], second, ["u3", "down"], ["m3", "She takes it down to the cellar.", 0], ["u4", "talk"], ["m4", "Odile and she talk an hour.", 0]];
    s.sync("c", asShown(seen(...lines(["m2", "Bram lends her a lantern.", 0])), { m1: 1, m2: 2, m3: 3, m4: 4 }));
    // The fourth turn's own record holds the lantern, handed into the cask.
    const own = s.stateAt(t4.id).state.world;
    expect(carried(own, "cask")).toEqual(["lantern"]);
    // In Lumiverse the player flips the second reply to the candle, and sends a new line.
    const path = seen(...lines(["m2", "Bram finds her a candle.", 1]), ["u5", "back up"]);
    const before = written(ts);
    const answer = s.turnStart("c", path, { follows: "u5" });
    expect(written(ts)).toBe(before);
    // The later turns stand on the candle now, their changes applied again; handing over a lantern never made there no longer applies.
    expect(answer.rebased).toEqual([t3.id, t4.id]);
    expect(answer.notApplied.map((n) => [n.turn, n.op, n.reports])).toEqual([
      [t3.id, "unlink", [{ code: "missing_relation" }]],
      [t3.id, "link", [{ code: "missing_relation" }]],
    ]);
    const world = answer.state.world;
    expect(world.entities.lantern).toBeUndefined();
    expect(carried(world, POV)).toContain("candle");
    expect(world.entities[POV]?.fields.place).toBe("cellar");
    expect(world.clock - own.clock).toBe(15 - 5);
    expect(answer.messages.find((m) => m.id === "m2")?.turn).toBe(candle.id);
    // After a restart, with nothing held, the answer is the same.
    expect(hashJson(reopened(ts).user(USER).turnStart("c", path, { follows: "u5" }).state)).toBe(hashJson(answer.state));
    // The turn's own comparison finds the same chain: it stores the key the answer was held under, and starts from that state.
    const report = s.sync("c", asShown(path, { m1: 1, m2: 5, m3: 3, m4: 4 }));
    expect(report.rebased?.turns).toEqual([t3.id, t4.id]);
    expect(s.chat("c")?.head).toBe(answer.node);
    expect(s.headState("c").state).toBe(answer.state);
  });

  test("after a reply in the middle is deleted and before any comparison, the answer holds the later turns applied again without it", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
    const t3 = play(s, "c", "m3", "She walks out onto the far road.", 3, engine(goTo(POV, "far_road"), tick(7)));
    const t4 = play(s, "c", "m4", "The road is long.", 4, engine(tick(9)));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "light"],
      ["m2", "Bram lends her a lantern.", 0],
      ["u3", "out"],
      ["m3", "She walks out onto the far road.", 0],
      ["u4", "on"],
      ["m4", "The road is long.", 0],
    ];
    const dates = { m1: 1, m2: 2, m3: 3, m4: 4 };
    s.sync("c", asShown(seen(...lines), dates));
    // The fourth turn's own record holds the lantern the second turn made.
    const own = s.stateAt(t4.id).state.world;
    expect(carried(own, POV)).toContain("lantern");
    // In Lumiverse the player deletes the second exchange, and sends a new line.
    const path = seen(...lines.slice(0, 2), ...lines.slice(4), ["u5", "keep going"]);
    const before = written(ts);
    const answer = s.turnStart("c", path, { follows: "u5" });
    expect(written(ts)).toBe(before);
    expect(answer.rebased).toEqual([t3.id, t4.id]);
    expect(answer.notApplied).toEqual([]);
    const world = answer.state.world;
    expect(world.entities.lantern).toBeUndefined();
    expect(world.entities[POV]?.fields.place).toBe("far_road");
    expect(own.clock - world.clock).toBe(5);
    expect(answer.messages.map((m) => [m.id, m.turn])).toEqual([
      ["u1", null],
      ["m1", t1.id],
      ["u3", null],
      ["m3", t3.id],
      ["u4", null],
      ["m4", t4.id],
      ["u5", null],
    ]);
    // The turn's own comparison finds the exchange gone and the same chain, and starts from the state the question was answered from.
    const report = s.sync("c", asShown(path, dates));
    expect(report.gone.map((g) => g.message)).toEqual(["u2", "m2"]);
    expect(s.chat("c")?.head).toBe(answer.node);
    expect(s.headState("c").state).toBe(answer.state);
  });

  test("a path whose every message is unknown to the tree answers the world's start and says so", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10), goTo(POV, "cellar")));
    const t2 = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV)));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "light"],
      ["m2", "Bram lends her a lantern.", 0],
    ];
    s.sync("c", asShown(seen(...lines), { m1: 1, m2: 2 }).map((m) => ({ ...m, hidden: m.id === "u2" })));
    // While the path shows the tree's turns, the answer names the reply and the turn it stands after.
    expect(s.turnStart("c", seen(...lines, ["u3", "and then"]), { follows: "u3" }).at).toEqual({ message: "m2", turn: t2.id });
    // In Lumiverse each reply now shows a swipe RPE did not play, and a reply written elsewhere follows them.
    const path = seen(["u1", "in"], ["m1", "Wren stays out in the rain.", 1], ["u2", "light"], ["m2", "Nobody has a lantern.", 1], ["u3", "and then"], ["m3", "A reply written elsewhere.", 0], ["u4", "go on"]);
    const before = written(ts);
    const answer = s.turnStart("c", path, { follows: "u4" });
    expect(written(ts)).toBe(before);
    expect([answer.at, answer.known, answer.node]).toEqual([null, true, null]);
    expect(answer.state.world.entities[POV]?.fields.place).toBe("common_room");
    expect(answer.messages.map((m) => [m.id, m.turn, m.hidden])).toEqual([
      ["u1", null, false],
      ["m1", null, false],
      ["u2", null, true],
      ["m2", null, false],
      ["u3", null, false],
      ["m3", null, false],
      ["u4", null, false],
    ]);
    // The world's start is the chat's world's, as a chat on the same world starts.
    s.createChat({ id: "fresh", revision });
    expect(hashJson(answer.state)).toBe(hashJson(s.headState("fresh").state));
  });

  test("a chat RPE has never seen answers the world's start and says so", () => {
    const ts = testStore();
    const { s, revision } = ts;
    // A chat RPE plays, beside the one it has never seen.
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(goTo(POV, "cellar")));
    const path = seen(["x-m0", "The tide is out.", 0], ["x-u1", "hello"], ["x-m1", "Hello yourself.", 0], ["x-u2", "what now"]);
    const before = written(ts);
    const answer = s.turnStart("elsewhere", path, { follows: "x-u2" });
    expect(written(ts)).toBe(before);
    expect(s.chat("elsewhere")).toBeNull();
    expect([answer.at, answer.known, answer.node]).toEqual([null, false, null]);
    expect(answer.messages.map((m) => [m.id, m.turn, m.hidden])).toEqual([
      ["x-m0", null, false],
      ["x-u1", null, false],
      ["x-m1", null, false],
      ["x-u2", null, false],
    ]);
    // It plays no world yet, as the chat RPE makes for it at its first turn (`src/turn/turns.ts`, `#chat`) does.
    s.createChat({ id: "elsewhere" });
    expect(hashJson(answer.state)).toBe(hashJson(s.headState("elsewhere").state));
  });

  test("a branch made from the fork's map alone: its first question is answered at the source's state at the fork", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar"), make("lamp", "Lamp", POV)));
    play(s, "source", "m3", "A long rest.", 3, engine(tick(120)));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2], ["u3", "rest"], ["m3", "A long rest.", 3]));
    // Lumiverse forks the chat at the second reply. `CHAT_FORKED` says the source, the branch and the old-to-new map, nothing more,
    // and the turn lane tells the store so when it hears it; nothing has compared the branch yet, and its line is there already.
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" } });
    // The fork is at the last message of the source's path that the map names.
    expect(s.chat("branch")).toMatchObject({ sourceChat: "source", sourceMessage: "m2" });
    expect(s.path("branch").map((e) => [e.message, e.turn])).toEqual([
      ["b-u1", null],
      ["b-m1", s.path("source")[1]?.turn],
      ["b-u2", null],
      ["b-m2", shared.id],
    ]);
    expect(s.headState("branch").node).toBe(shared.node);
    const lines = seen(["b-u1", "in"], ["b-m1", "Into the inn.", 0], ["b-u2", "down"], ["b-m2", "Down the stairs.", 0], ["b-u3", "look around"]);
    const answer = s.turnStart("branch", lines, { follows: "b-u3" });
    expect([answer.known, answer.at]).toEqual([true, { message: "b-m2", turn: shared.id }]);
    expect([answer.node, hashJson(answer.state)]).toEqual([shared.node, hashJson(s.stateAt(shared.id).state)]);
    expect(carried(answer.state.world, POV)).toContain("lamp");
    // Its first comparison says where it was branched from.
    expect(s.sync("branch", asShown(lines, { "b-m1": 1, "b-m2": 2 })).branched).toEqual({ from: "source", at: "m2" });
  });

  test("a fork not yet told answers the world's start, unknown", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1]));
    // Lumiverse has forked the chat and the store has not been told: the copies carry new ids that no link names yet.
    const answer = s.turnStart("branch", seen(["b-u1", "in"], ["b-m1", "Into the inn.", 0], ["b-u2", "look"]), { follows: "b-u2" });
    expect([answer.known, answer.at, answer.node]).toEqual([false, null, null]);
    expect(answer.state.world.entities[POV]?.fields.place).not.toBe("cellar");
    // Told, the same question is answered at the source's state there.
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1" } });
    expect(s.turnStart("branch", seen(["b-u1", "in"], ["b-m1", "Into the inn.", 0], ["b-u2", "look"]), { follows: "b-u2" }).state.world.entities[POV]?.fields.place).toBe("cellar");
  });

  test("the point agrees with the end of the path it comes with: a reply it replaces at the end is passed over, any other point is refused", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "where now"],
      ["m2", "She goes down to the cellar.", 0],
    ];
    // A swipe of the second reply starts after the first, whether the path leaves that reply out, as Lumiverse's does, or ends with it.
    const left = s.turnStart("c", seen(...lines.slice(0, -1)), { replaces: "m2" });
    const ending = s.turnStart("c", seen(...lines), { replaces: "m2" });
    expect([left.at, ending.at]).toEqual([
      { message: "m1", turn: t1.id },
      { message: "m1", turn: t1.id },
    ]);
    expect(ending.messages.map((m) => m.id)).toEqual(["u1", "m1", "u2"]);
    // Any other point would answer somewhere the path does not end: it is refused, not guessed at.
    expect(() => s.turnStart("c", seen(...lines), { follows: "m1" })).toThrow(StoreInputError);
    expect(() => s.turnStart("c", seen(...lines), { replaces: "m1" })).toThrow(StoreInputError);
    expect(() => s.turnStart("c", seen(...lines), { follows: null })).toThrow(StoreInputError);
    expect(s.turnStart("c", [], { follows: null }).at).toBeNull();
  });

  test("the answer's state is the store's own, held and frozen: a reader cannot change it, and the next turn starts from it as folded", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10), goTo(POV, "cellar")));
    const path = seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "and then"]);
    s.sync("c", asShown(path.slice(0, 2), { m1: 1 }));
    const answer = s.turnStart("c", path, { follows: "u2" });
    const wren = answer.state.world.entities[POV];
    if (wren === undefined) throw new Error("no Wren in the answer");
    // A reader that writes to what it was handed is stopped where it writes: a module runs strict, so a frozen object throws.
    expect(() => {
      wren.fields.place = "far_road";
    }).toThrow(TypeError);
    expect(() => Object.assign(answer.state.notes, { "place:far_road": { text: "x", by: null, turn: "" } })).toThrow(TypeError);
    // The turn that follows starts from that very state, as it was folded.
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    expect(s.startOf(next.id).state).toBe(answer.state);
    expect(s.startOf(next.id).state.world.entities[POV]?.fields.place).toBe("cellar");
    // A change goes through the store, which applies it to a copy of its own: the answer stays as it was.
    s.addChanges(next.id, engine(goTo(POV, "market_square")));
    expect(s.stateAt(next.id).state.world.entities[POV]?.fields.place).toBe("market_square");
    expect(answer.state.world.entities[POV]?.fields.place).toBe("cellar");
  });

  test("on an unchanged path of 10,001 messages the question costs no more than a fixed multiple of reading the chat's path once", () => {
    // 5,000 played replies, compared once. They are begun one after another and tied newest first, so no tie rewrites the path and
    // the chat is made quickly; it is what is measured on. No snapshot is kept on the way.
    const ts = testStore({ snapshotEvery: 1_000_000 });
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const replies = 5_000;
    ts.store.db.transaction(() => {
      const turns: TurnRow[] = [];
      for (let i = 0; i < replies; i++) turns.push(s.beginTurn({ chat: "c", kind: "normal", on: turns.at(-1)?.node ?? null }));
      for (let i = replies; i >= 1; i--) s.tieTurn(turns[i - 1]?.id ?? "", { message: `m${i}`, hash: hashOf(`Reply ${i}.`), date: i });
    })();
    const exchanges = Array.from({ length: replies }, (_, i): [[string, string], [string, string, number]] => [[`u${i + 1}`, `Line ${i + 1}.`], [`m${i + 1}`, `Reply ${i + 1}.`, 0]]);
    const path = seen(...exchanges.flat(), ["u-next", "And then."]);
    s.sync("c", asShown(path.slice(0, -1), Object.fromEntries(exchanges.map(([, [m]], i) => [m, i + 1]))));
    const ask = () => s.turnStart("c", path, { follows: "u-next" });
    expect(ask().at?.message).toBe(`m${replies}`);
    // Reading the chat's path once is the least a comparison of it does, and grows with the chat as any reading of the path must.
    // Taken in turns with the question, so a busy machine slows both alike, and the least of many runs of each, which noise only
    // adds to: a guard, not the gate (R-15).
    const text = ts.store.db.query<{ path: string }, []>("SELECT path FROM chat").get()?.path ?? "";
    let question = Number.POSITIVE_INFINITY;
    let reading = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 25; i++) {
      let from = performance.now();
      ask();
      question = Math.min(question, performance.now() - from);
      from = performance.now();
      JSON.parse(text);
      reading = Math.min(reading, performance.now() - from);
    }
    console.log(`the question on an unchanged path of ${2 * replies + 1} messages: ${question.toFixed(2)} ms; reading the chat's path once: ${reading.toFixed(2)} ms`);
    expect(question).toBeLessThanOrEqual(3 * reading);
  });

  test("two swipes with the same text, the older showing and nothing changed: the answer is the older swipe's turn", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const older = play(s, "c", "m2", "The road forks.", 2, engine(goTo(POV, "cellar")));
    // A regenerate came back word for word with other changes; the older swipe was shown again, and compared so.
    const newer = play(s, "c", "m2", "The road forks.", 3, engine(goTo(POV, "far_road")), { target: "m2" });
    const lines = seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "which way"], ["m2", "The road forks.", 0], ["u3", "left"]);
    s.sync("c", asShown(lines.slice(0, 4), { m1: 1, m2: 2 }));
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(older.id);
    // The text names both swipes; shown as it was then, the reply is the turn the comparison tied, not the newer one.
    const answer = s.turnStart("c", lines, { follows: "u3" });
    expect(answer.at).toEqual({ message: "m2", turn: older.id });
    expect(answer.state.world.entities[POV]?.fields.place).toBe("cellar");
    // As the turn's own comparison finds it: the next turn starts from that very state.
    s.sync("c", asShown(lines, { m1: 1, m2: 2 }));
    expect(s.startOf(s.beginTurn({ chat: "c", kind: "normal" }).id).state).toBe(answer.state);
    // A reply changed since is known by its text, as before: the newer swipe's own words now showing are the newer swipe's turn.
    const third = play(s, "c", "m2", "The road bends.", 4, engine(goTo(POV, "market_square")), { target: "m2" });
    const changed = seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "which way"], ["m2", "The road bends.", 2], ["u3", "left"]);
    expect(s.turnStart("c", changed, { follows: "u3" }).at).toEqual({ message: "m2", turn: third.id });
    expect(newer.id).not.toBe(older.id);
  });

  test("a reader cannot change the rebased and not-applied lists an answer gives, nor the next answer's", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "A lantern is lit.", 1, engine(make("lantern", "Lantern", POV)));
    const second = play(s, "c", "m2", "Wren sets the lantern in the cask.", 2, engine(...hand("lantern", POV, "cask")));
    play(s, "c", "m1", "The lamps stay dark.", 3, engine(tick(5)), { target: "m1" });
    // The first reply flipped to its swipe with no lantern: the second turn stands rebased on it, and its hand-over does not apply.
    const lines = seen(["u1", "in"], ["m1", "The lamps stay dark.", 1], ["u2", "the cask"], ["m2", "Wren sets the lantern in the cask.", 0], ["u3", "and then"]);
    const answer = s.turnStart("c", lines, { follows: "u3" });
    expect(answer.rebased).toEqual([second.id]);
    expect(answer.notApplied.map((n) => [n.turn, n.op])).toEqual([
      [second.id, "unlink"],
      [second.id, "link"],
    ]);
    const given = structuredClone({ rebased: answer.rebased, notApplied: answer.notApplied });
    // The briefing reads these lists for what to look over and what no longer applies: a reader that wrote to them is stopped there.
    expect(() => answer.rebased.push("t-elsewhere")).toThrow(TypeError);
    expect(() => answer.notApplied.splice(0, 1)).toThrow(TypeError);
    expect(() => answer.notApplied[0]?.reports.push({ code: "added_by_a_reader" })).toThrow(TypeError);
    // Nor what the next answer gives, nor the comparison that follows.
    const again = s.turnStart("c", lines, { follows: "u3" });
    expect({ rebased: again.rebased, notApplied: again.notApplied }).toEqual(given);
    expect(s.sync("c", asShown(lines, { m1: 3, m2: 2 })).notApplied).toEqual(given.notApplied);
  });

  test("after addChanges with an object value, the caller's own object can still be changed, and the held state cannot", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const turn = s.beginTurn({ chat: "c", kind: "normal" });
    // A set whose value is an object: the engine's handler puts the change's value into the state as it is.
    const notes = { mood: "wary", seen: ["bram"] };
    const { state } = s.addChanges(turn.id, engine({ type: "set", entity: POV, field: "notes", value: notes }));
    // The caller's object is still its own to change; the store applied and keeps a copy of its own.
    notes.seen.push("odile");
    expect(notes.seen).toEqual(["bram", "odile"]);
    const held = state.world.entities[POV]?.fields.notes as { seen: string[] } | undefined;
    expect(held?.seen).toEqual(["bram"]);
    expect(() => held?.seen.push("odile")).toThrow(TypeError);
    expect(s.stateAt(turn.id).state.world.entities[POV]?.fields.notes).toEqual({ mood: "wary", seen: ["bram"] });
  });

  test("a path holding a message id twice is refused", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const [line, reply, next] = seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "again"]);
    if (line === undefined || reply === undefined || next === undefined) throw new Error("no path");
    // Lumiverse's messages have ids of their own: a path holding one twice is malformed, and would fold that turn twice.
    const before = written(ts);
    expect(() => s.turnStart("c", [line, reply, { ...reply, index: 2 }, { ...next, index: 3 }], { follows: "u2" })).toThrow(StoreInputError);
    expect(() => s.turnStart("c", [line, { ...line, index: 1 }, { ...reply, index: 2 }, { ...next, index: 3 }], { follows: "u2" })).toThrow(StoreInputError);
    expect(written(ts)).toBe(before);
    expect(s.turnStart("c", [line, reply, next], { follows: "u2" }).at?.message).toBe("m1");
  });

  test("a reply whose edit was recorded is answered at its turn", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const lit = play(s, "c", "m2", "The lantern is lit.", 2, engine(make("lantern", "Lantern", POV)));
    const lines = (reply: string, swipe: number): SeenMessage[] => seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "light it"], ["m2", reply, swipe], ["u3", "and then"]);
    // The player fixed the reply's words and the comparison recorded the edit; then another swipe was shown, and compared so.
    s.sync("c", asShown(lines("The lantern is lit, at last.", 0).slice(0, 4), { m1: 1, m2: 2 }));
    expect(s.turn(lit.id)?.edited).toBe(hashOf("The lantern is lit, at last."));
    const dark = play(s, "c", "m2", "The lantern stays dark.", 3, engine(tick(1)), { target: "m2" });
    s.sync("c", asShown(lines("The lantern stays dark.", 1).slice(0, 4), { m1: 1, m2: 3 }));
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(dark.id);
    // Shown again, the edited words are no saved text of either swipe: the edit recorded on the first says it is that turn.
    const answer = s.turnStart("c", lines("The lantern is lit, at last.", 0), { follows: "u3" });
    expect(answer.at).toEqual({ message: "m2", turn: lit.id });
    expect(carried(answer.state.world, POV)).toContain("lantern");
  });

  test("a branch's continue of a shared reply, its first exchange deleted, is answered at the shared turn then the branch's own", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "source", revision });
    const first = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" } });
    s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2]));
    // The branch continues the reply it shares: its own turn goes on after the shared one, in the branch's place at that message.
    const on = s.path("branch").find((e) => e.message === "b-m2")?.node ?? null;
    const own = play(s, "branch", "b-m2", "Down the stairs. The lamp gutters.", 2, engine(tick(30)), { on, kind: "continue" });
    // Then its first exchange is deleted, before any comparison, and a line is sent.
    const lines = seen(["b-u2", "down"], ["b-m2", "Down the stairs. The lamp gutters.", 0], ["b-u3", "look"]);
    const answer = s.turnStart("branch", lines, { follows: "b-u3" });
    expect(answer.at).toEqual({ message: "b-m2", turn: own.id });
    expect(answer.rebased).toEqual([shared.id, own.id]);
    // The shared turn stands first, without the deleted reply's quarter hour, and the branch's own after it.
    expect([answer.state.world.entities[POV]?.fields.place, answer.state.world.clock - s.startOf(first.id).state.world.clock]).toEqual(["cellar", 30]);
    // As the turn's own comparison finds it.
    s.sync("branch", asShown(lines, { "b-m2": 2 }));
    expect(hashJson(s.startOf(s.beginTurn({ chat: "branch", kind: "normal" }).id).state)).toBe(hashJson(answer.state));
  });
});

describe("heard between turns", () => {
  test("an aside hidden between turns is not counted by the next question's window", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "(Marlow mutters about the weather.)"],
      ["m2", "She goes down to the cellar.", 0],
    ];
    s.sync("c", asShown(seen(...lines), { m1: 1, m2: 2 }));
    const path = seen(...lines, ["u3", "and then?"]);
    // What the window counts: the question's messages that are not hidden (R-21).
    const counted = (u: UserStore = s): string[] => u.turnStart("c", path, { follows: "u3" }).messages.flatMap((m) => (m.hidden ? [] : [m.id]));
    expect(counted()).toEqual(["u1", "m1", "u2", "m2", "u3"]);
    const held = s.turnStart("c", path, { follows: "u3" }).state;
    // Between turns the player hides the aside. Lumiverse sets its `extra.hidden` (`bulkSetHidden`, `src/services/chats.service.ts:3087-3110`)
    // and tells it, with the whole message, as `MESSAGE_EDITED`; RPE's event socket hears it before the next question.
    expect(s.markHidden("c", "u2", true)).toBe(true);
    expect(counted()).toEqual(["u1", "m1", "m2", "u3"]);
    // A mark is kept by message id with the chat, on RPE's path or not yet: the newest line too, hidden before it is answered.
    s.markHidden("c", "u3", true);
    expect(counted()).toEqual(["u1", "m1", "m2"]);
    // Shown again, each is counted again, after a restart too.
    s.markHidden("c", "u2", false);
    s.markHidden("c", "u3", false);
    expect(counted(reopened(ts).user(USER))).toEqual(["u1", "m1", "u2", "m2", "u3"]);
    // A mark changes no state: the turn that follows still starts from the state held.
    expect(s.turnStart("c", path, { follows: "u3" }).state).toBe(held);
    // The next comparison takes the marks the chat shows, a mark whose event RPE missed among them, in place of what was heard.
    s.markHidden("c", "u3", true);
    s.sync("c", asShown(path, { m1: 1, m2: 2 }).map((m) => ({ ...m, hidden: m.id === "u2" })));
    expect(counted()).toEqual(["u1", "m1", "m2", "u3"]);
    // A chat the store does not know keeps nothing: its first comparison takes the marks.
    expect(s.markHidden("elsewhere", "x-u1", true)).toBe(false);
  });

  test("a store made before what is heard was kept comes up having heard nothing, and keeps what it hears after", () => {
    const db = new Database(":memory:");
    try {
      // The store's tables as the build before this one left them, with a chat in them.
      expect(migrateStore(db, STORE_MIGRATIONS.filter((m) => m.version <= 2))).toBe(2);
      db.run("INSERT INTO chat (user, id, created) VALUES (?, 'old', 1)", [USER]);
      expect(migrateStore(db)).toBe(STORE_MIGRATIONS.length);
      expect(db.query<{ heard: string }, []>("SELECT heard FROM chat").get()?.heard).toBe("{}");
      const s = openStore({ db, registry: registry(), worlds: () => undefined }).user(USER);
      const path = seen(["u1", "(an aside)"], ["u2", "go on"]);
      expect(s.turnStart("old", path, { follows: "u2" }).messages.map((m) => m.hidden)).toEqual([false, false]);
      expect(s.markHidden("old", "u1", true)).toBe(true);
      expect(s.turnStart("old", path, { follows: "u2" }).messages.map((m) => m.hidden)).toEqual([true, false]);
    } finally {
      db.close();
    }
  });

  test("a reply edited between turns: the next question is answered with that turn's changes in, and the next comparison still records the edit as it does today", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV)));
    const lines: Line[] = [
      ["u1", "in"],
      ["m1", "Wren comes in from the rain.", 0],
      ["u2", "light"],
    ];
    s.sync("c", asShown(seen(...lines, ["m2", "Bram lends her a lantern.", 0]), { m1: 1, m2: 2 }));
    // Between turns the player edits the second reply: the text of the swipe it shows changes and that swipe keeps its date
    // (`updateMessage`, `src/services/chats.service.ts:2922-3023`); RPE's event socket hears the whole message as `MESSAGE_EDITED`.
    const text = "Bram lends her a lantern with a cracked pane.";
    const path = seen(...lines, ["m2", text, 0], ["u3", "thank him"]);
    // Unheard, the edited reply reads as a swipe no turn was played on, and the question stands before its turn.
    expect(s.turnStart("c", path, { follows: "u3" }).at).toEqual({ message: "m1", turn: t1.id });
    // Heard: the swipe is found by the message and its date, as the comparison finds it.
    expect(s.heardEdit("c", "m2", 2, hashOf(text))).toBe(t2.id);
    const answer = s.turnStart("c", path, { follows: "u3" });
    expect([answer.at, answer.node]).toEqual([{ message: "m2", turn: t2.id }, t2.node]);
    expect(carried(answer.state.world, POV)).toContain("lantern");
    expect(reopened(ts).user(USER).turnStart("c", path, { follows: "u3" }).at).toEqual({ message: "m2", turn: t2.id });
    // Kept apart from the turn's own edit mark, which only a comparison sets, so the next comparison still finds the edit,
    // records it and tells it, as it does today.
    expect(s.turn(t2.id)?.edited).toBeNull();
    const report = s.sync("c", asShown(path, { m1: 1, m2: 2 }));
    expect(report.edited).toEqual([{ turn: t2.id, message: "m2", saved: hashOf("Bram lends her a lantern."), now: hashOf(text) }]);
    expect(s.turn(t2.id)?.edited).toBe(hashOf(text));
    expect(s.turnStart("c", path, { follows: "u3" }).at).toEqual({ message: "m2", turn: t2.id });
    // Edited again after that comparison: heard again, and known by the new text, the recorded edit kept beside it.
    const again = "Bram lends her a lantern, its pane taped over.";
    expect(s.heardEdit("c", "m2", 2, hashOf(again))).toBe(t2.id);
    expect(s.turnStart("c", seen(...lines, ["m2", again, 0], ["u3", "thank him"]), { follows: "u3" }).at).toEqual({ message: "m2", turn: t2.id });
    // A swipe no turn was played on, and one that shows its text as saved, are left to the comparison.
    expect(s.heardEdit("c", "m3", 3, hashOf("A reply written elsewhere."))).toBeNull();
    expect(s.heardEdit("c", "m1", 1, hashOf("Wren comes in from the rain."))).toBeNull();
  });

  /** Two played replies, the second making Bram's lantern Wren's, compared as Lumiverse shows them, the aside between them shown. */
  function played() {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", SAVED, 2, engine(make("lantern", "Lantern", POV)));
    s.sync("c", shownWith(SAVED));
    return { ...ts, t1, t2 };
  }
  const SAVED = "Bram lends her a lantern.";
  const EDITED = "Bram lends her a lantern with a cracked pane.";
  const LINES: Line[] = [
    ["u1", "in"],
    ["m1", "Wren comes in from the rain.", 0],
    ["u2", "(Marlow mutters about the weather.)"],
  ];
  /** The chat as Lumiverse shows it to a comparison: the second reply showing `text` at `date`, every message with its hidden mark. */
  const shownWith = (text: string, date = 2, hidden: readonly string[] = []): ShownMessage[] => asShown(seen(...LINES, ["m2", text, 0]), { m1: 1, m2: date }).map((m) => ({ ...m, hidden: hidden.includes(m.id) }));
  /** The question's path: the second reply showing `text`, then the player's new line. */
  const asked = (text: string): SeenMessage[] => seen(...LINES, ["m2", text, 0], ["u3", "thank him"]);
  /** What the chat's row keeps as heard, by message. */
  const heardIn = (ts: TestStore): string[] => Object.keys(JSON.parse(ts.store.db.query<{ heard: string }, []>("SELECT heard FROM chat WHERE id = 'c'").get()?.heard ?? "{}") as object).sort();

  test("an edit heard, then a swipe and a flip back to the edited swipe and a line sent: the question is answered with that turn's changes in", () => {
    const ts = played();
    const { s, t2 } = ts;
    expect(s.heardEdit("c", "m2", 2, hashOf(EDITED))).toBe(t2.id);
    // The player swipes the reply. At the swipe's start the turn lane shows the comparison the reply being replaced as it was last
    // compared (`src/turn/turns.ts`), so that comparison records no edit; the swipe's own turn is played and tied.
    s.sync("c", shownWith(SAVED));
    play(s, "c", "m2", "Bram has no lantern to spare.", 5, engine(tick(1)), { target: "m2" });
    // The player flips back to the edited swipe, which Lumiverse tells only as `MESSAGE_SWIPED`: nothing is heard. Then a line.
    const answer = s.turnStart("c", asked(EDITED), { follows: "u3" });
    expect(answer.at).toEqual({ message: "m2", turn: t2.id });
    expect(carried(answer.state.world, POV)).toContain("lantern");
  });

  test("a hide and an edit heard between the path's read and its comparison are kept by that comparison", () => {
    const ts = played();
    const { s, t2 } = ts;
    // The turn lane takes the chat's heard count, then reads the path from Lumiverse; before it compares, the player hides the aside
    // and edits the reply, each heard.
    const upto = s.heardCount("c");
    const asRead = shownWith(SAVED);
    s.markHidden("c", "u2", true);
    expect(s.heardEdit("c", "m2", 2, hashOf(EDITED))).toBe(t2.id);
    s.sync("c", asRead, upto);
    const answer = s.turnStart("c", asked(EDITED), { follows: "u3" });
    expect(answer.messages.find((m) => m.id === "u2")?.hidden).toBe(true);
    expect(answer.at).toEqual({ message: "m2", turn: t2.id });
    // The next comparison, of a path read after both, takes them both: the mark as shown, the edit recorded.
    expect(s.sync("c", shownWith(EDITED, 2, ["u2"]), s.heardCount("c")).edited.map((e) => e.turn)).toEqual([t2.id]);
    expect(heardIn(ts)).toEqual([]);
  });

  test("a mark heard back to the compared one leaves no entry, and a deleted message's entry goes with the delete", () => {
    const ts = played();
    const { s, t2 } = ts;
    s.markHidden("c", "u2", true);
    expect(heardIn(ts)).toEqual(["u2"]);
    s.markHidden("c", "u2", false);
    expect(heardIn(ts)).toEqual([]);
    // A mark the last comparison took, and none for a message it never saw, are no news: every edit Lumiverse tells carries one.
    s.markHidden("c", "u1", false);
    s.markHidden("c", "u9", false);
    expect(heardIn(ts)).toEqual([]);
    // One the comparison took as hidden: shown again it is kept, hidden again it goes.
    s.sync("c", shownWith(SAVED, 2, ["u1"]));
    s.markHidden("c", "u1", false);
    expect(heardIn(ts)).toEqual(["u1"]);
    s.markHidden("c", "u1", true);
    expect(heardIn(ts)).toEqual([]);
    // A message deleted takes what was heard of it, its edits and its mark, with it.
    expect(s.heardEdit("c", "m2", 2, hashOf(EDITED))).toBe(t2.id);
    s.markHidden("c", "m2", true);
    s.markHidden("c", "u2", true);
    expect(heardIn(ts)).toEqual(["m2", "u2"]);
    s.heardDeleted("c", "m2");
    expect(heardIn(ts)).toEqual(["u2"]);
  });

  test("a 500-message hide on a 10,000-message chat, and its showing again, stay within their bound", () => {
    const ts = testStore();
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const lines = Array.from({ length: 10_000 }, (_, i): ShownMessage => ({ id: `u${i}`, user: true, hash: hashOf(`Line ${i}.`), hidden: false }));
    s.sync("c", lines);
    const marked = lines.filter((_, i) => i % 20 === 7).map((m) => m.id);
    expect(marked.length).toBe(500);
    // Each call reads the chat's row and writes it again: the least it does, and the bound is a fixed multiple of that, taken in turns
    // with it so a busy machine slows both alike, and the least of a few runs of each, which noise only adds to: a guard (R-15).
    const row = ts.store.db.query<unknown, [string]>("SELECT * FROM chat WHERE id = ?");
    let reading = Number.POSITIVE_INFINITY;
    let hiding = Number.POSITIVE_INFINITY;
    let showing = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run++) {
      let from = performance.now();
      for (const id of marked) s.markHidden("c", id, true);
      hiding = Math.min(hiding, performance.now() - from);
      expect(heardIn(ts).length).toBe(500);
      from = performance.now();
      for (const id of marked) s.markHidden("c", id, false);
      showing = Math.min(showing, performance.now() - from);
      expect(heardIn(ts)).toEqual([]);
      for (let i = 0; i < 25; i++) {
        from = performance.now();
        row.get("c");
        reading = Math.min(reading, performance.now() - from);
      }
    }
    console.log(`500 hidden on a chat of 10,000 messages: ${hiding.toFixed(1)} ms; shown again: ${showing.toFixed(1)} ms; reading the chat's row once: ${reading.toFixed(3)} ms`);
    // About five readings a call where it stands; parsing the chat's path at each call would be about forty.
    expect(hiding).toBeLessThanOrEqual(500 * 20 * reading);
    expect(showing).toBeLessThanOrEqual(500 * 20 * reading);
  });

  test("an edit heard for an unplayed swipe of a played message is left alone", () => {
    const ts = played();
    const { s, t1 } = ts;
    // A second swipe of the played reply, made in Lumiverse with no turn and its own date, edited there.
    const other = "Bram offers a candle instead, its wick trimmed.";
    expect(s.heardEdit("c", "m2", 9, hashOf(other))).toBeNull();
    expect(heardIn(ts)).toEqual([]);
    expect(s.turnStart("c", asked(other), { follows: "u3" }).at).toEqual({ message: "m1", turn: t1.id });
  });

  test("a mark heard between turns is still there when the store is opened again while the message is hidden", () => {
    const ts = played();
    ts.s.markHidden("c", "u2", true);
    const counted = reopened(ts)
      .user(USER)
      .turnStart("c", asked(SAVED), { follows: "u3" })
      .messages.flatMap((m) => (m.hidden ? [] : [m.id]));
    expect(counted).toEqual(["u1", "m1", "m2", "u3"]);
  });

  test("an edit heard back to the saved text takes back the heard edit", () => {
    const ts = played();
    const { s, t1, t2 } = ts;
    expect(s.heardEdit("c", "m2", 2, hashOf(EDITED))).toBe(t2.id);
    expect(s.turnStart("c", asked(EDITED), { follows: "u3" }).at).toEqual({ message: "m2", turn: t2.id });
    expect(s.heardEdit("c", "m2", 2, hashOf(SAVED))).toBeNull();
    expect(heardIn(ts)).toEqual([]);
    // The edited text is a swipe no turn is known by again.
    expect(s.turnStart("c", asked(EDITED), { follows: "u3" }).at).toEqual({ message: "m1", turn: t1.id });
  });
});

describe("a continue's held turn", () => {
  /** Two played replies, the second making Bram's lantern Wren's, compared as shown. */
  function twoReplies(options: { snapshotEvery?: number } = {}) {
    // A clock that moves on at every reading, so a turn begun after a job ended begins later than it ended (§10.9).
    let clock = 0;
    const ts = testStore({ now: () => ++clock, ...options });
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
    s.sync("c", asShown(seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "light"], ["m2", "Bram lends her a lantern.", 0]), { m1: 1, m2: 2 }));
    return { ...ts, t1, t2 };
  }

  /**
   * A continue of the second reply running on an open turn of its own (R-192 (e)). With `afterLater`, a third reply is played first
   * and the continue is the one the tag could not place: held after the path's last turn, its end naming the earlier reply (R-192 (a)).
   */
  function continued(options: { snapshotEvery?: number; afterLater?: true } = {}) {
    const ts = twoReplies(options);
    const { s, t2 } = ts;
    const later = options.afterLater ? play(s, "c", "m3", "The rain stops.", 3, engine(tick(1))) : null;
    // The player asks the reply to go on. Until the generation's end names a message, what the continue's run changes is held on its
    // own open turn, begun where the path's turn ends (§10.8), and a job it starts records there too (§10.9).
    const held = s.beginTurn({ chat: "c", kind: "continue", on: (later ?? t2).node });
    s.addChanges(held.id, engine(goTo(POV, "cellar")));
    s.addChanges(held.id, engine(...hand("lantern", POV, "cask")).map((c) => ({ ...c, job: "j-cellar" })));
    s.addChanges(held.id, engine(tick(30)));
    return { ...ts, later, held };
  }

  /** Who of Wren, Bram and the cask holds the lantern. */
  const holders = (world: { entities: Record<string, { relations: { type: string; to: string }[] }> }): string[] => [POV, "bram", "cask"].filter((who) => carried(world, who).includes("lantern"));

  /** A turn's rows as made, whatever store they are in: their order, what they say, their job, and whether each applied with its reports. */
  const asMade = (rows: readonly { ord: number; op: string; value: unknown; job: string | null; applied: boolean; reports: unknown[] }[]) => rows.map((c) => ({ ord: c.ord, op: c.op, value: c.value, job: c.job, applied: c.applied, reports: c.reports }));

  /** A state as JSON with each turn's id put as its name, so states made in two stores compare. */
  const named = (state: unknown, turns: Readonly<Record<string, string>>): string => Object.entries(turns).reduce((text, [name, id]) => text.replaceAll(id, name), JSON.stringify(state));

  test("a continue's held changes join the turn it extends, after its own and in their order, a job's change with its job, and that turn's state is the one they make", () => {
    // Every turn keeps its state stored, so one stored on a path through the extended turn is there to go stale. The road Lumiverse
    // takes to a later reply standing after the extended one: a continue the tag could not place, held after the path's last turn,
    // whose end names the earlier reply (R-192 (a)). The later turn stays recorded after the extended one, its state stored.
    const ts = continued({ snapshotEvery: 1, afterLater: true });
    const { s, t1, t2, held } = ts;
    const later = ts.later as TurnRow;
    const own = s.changes(t2.id);
    const heldRows = s.changes(held.id);
    expect(s.stateAt(t2.id).state.world.entities[POV]?.fields.place).toBe("common_room");
    // The end names the second reply, which t2 is tied to: the continue was that turn, extended (§10.10).
    const joined = s.joinTurn(held.id, t2.id);
    // Its own changes first, as they were; then the continue's, in the order they were made, the job's with their job; each the
    // row as it was recorded, its place in the turn going on from the last.
    expect(s.changes(t2.id)).toEqual([...own, ...heldRows.map((c, i) => ({ ...c, turn: t2.id, ord: own.length + i }))]);
    expect(joined).toEqual(s.changes(t2.id).slice(own.length));
    expect(joined.map((c) => [c.op, c.job])).toEqual([
      ["set", null],
      ["unlink", "j-cellar"],
      ["link", "j-cellar"],
      ["clock", null],
    ]);
    expect(s.changes(held.id)).toEqual([]);
    // That turn's state is the one they make, as if the continue had been made on it: cold, from the store alone, too.
    const at = s.stateAt(t2.id).state.world;
    expect(at.entities[POV]?.fields.place).toBe("cellar");
    expect(at.clock - s.stateAt(t1.id).state.world.clock).toBe(5 + 30);
    expect(hashJson(reopened(ts).user(USER).stateAt(t2.id).state)).toBe(hashJson(s.stateAt(t2.id).state));
    // What was stored on every path through it is let go: the later turn's state is made again on top of it.
    expect(reopened(ts).user(USER).stateAt(later.id).state.world.entities[POV]?.fields.place).toBe("cellar");
    // The job's change takes effect as a job's does: once the job has ended, just before the next turn to begin (§10.9).
    expect(carried(at, "cask")).toEqual([]);
    s.endJob("j-cellar");
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    expect(carried(s.stateAt(next.id).state.world, "cask")).toEqual(["lantern"]);
    // A delete of the extended turn's message takes the joined changes with it.
    s.sync("c", asShown(seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0]), { m1: 1 }));
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("common_room");
  });

  test("the held turn is kept, marked as joined, and the lookup names the turn it joined", () => {
    const ts = continued();
    const { s, t2, held } = ts;
    expect(s.joinedTo(held.id)).toBeNull();
    s.joinTurn(held.id, t2.id);
    // Kept, never dropped: a job the continue started may still hold it in its scope.
    expect(s.turn(held.id)).toMatchObject({ status: "joined", joined: t2.id });
    expect([s.joinedTo(held.id), s.joinedTo(t2.id)]).toEqual([t2.id, null]);
    expect(reopened(ts).user(USER).joinedTo(held.id)).toBe(t2.id);
    // A continue that saved nothing new loses its own changes, as today, while its job's still join (R-192 (f)).
    const quiet = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    s.addChanges(quiet.id, engine(tick(45)));
    s.addChanges(quiet.id, engine(make("note", "Folded note", POV)).map((c) => ({ ...c, job: "j-note" })));
    s.takeBack(quiet.id, -1);
    expect(s.joinTurn(quiet.id, t2.id).map((c) => [c.op, c.job])).toEqual([["spawn", "j-note"]]);
    expect(s.joinedTo(quiet.id)).toBe(t2.id);
    // A turn made before turns could join comes up joined to none.
    const db = new Database(":memory:");
    try {
      migrateStore(db, STORE_MIGRATIONS.filter((m) => m.version <= 3));
      db.run("INSERT INTO chat (user, id, created) VALUES (?, 'old', 1)", [USER]);
      db.run("INSERT INTO turn (user, id, chat, node, depth, kind, status, created) VALUES (?, 'old-turn', 'old', 'n', 0, 'normal', 'open', 1)", [USER]);
      expect(migrateStore(db)).toBe(STORE_MIGRATIONS.length);
      expect(openStore({ db, registry: registry(), worlds: () => undefined }).user(USER).joinedTo("old-turn")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("a write addressed to a joined turn is refused, naming the turn it joined", () => {
    const ts = continued();
    const { s, t1, t2, held } = ts;
    s.joinTurn(held.id, t2.id);
    const scene = s.openSession({ chat: "c", scene: "the inn", turn: t2.id });
    const before = written(ts);
    // Every write, and every reading of its state, a job's included: the store never sends it on to the turn it joined itself.
    const calls: [string, () => unknown][] = [
      ["a change", () => s.addChanges(held.id, engine(tick(1)))],
      ["a job's change", () => s.addChanges(held.id, engine(tick(1)).map((c) => ({ ...c, job: "j-cellar" })))],
      ["a job's reading", () => s.stateFor(held.id, "j-cellar")],
      ["a reading", () => s.stateAt(held.id)],
      ["the tree at it", () => s.viewFor(held.id, "j-cellar")],
      ["taking staged changes back", () => s.dropStaged(held.id)],
      ["taking changes back", () => s.takeBack(held.id, -1)],
      ["a tie", () => s.tieTurn(held.id, { message: "m2", hash: hashOf("Bram lends her a lantern.") })],
      ["a drop", () => s.dropTurn(held.id)],
      ["its record", () => s.updateTurn(held.id, { intent: "Go on." })],
      ["a starting state", () => s.setBase(held.id, s.stateAt(t2.id).state.world)],
      ["a session", () => s.openSession({ chat: "c", scene: "the cellar", turn: held.id })],
      ["closing a session", () => s.closeSession(scene.id, held.id)],
      ["its path", () => s.extendPath(t1.node, held.id)],
      ["where it started", () => s.startOf(held.id)],
      ["the jobs before it", () => s.jobsBefore(held.id)],
      ["its review card", () => s.reviewCard(held.id)],
      ["joining it again", () => s.joinTurn(held.id, t2.id)],
    ];
    for (const [what, call] of calls) {
      let refused: unknown = null;
      try {
        call();
      } catch (error) {
        refused = error;
      }
      expect([what, refused instanceof JoinedTurnError ? [refused.turn, refused.joined] : refused]).toEqual([what, [held.id, t2.id]]);
    }
    expect(written(ts)).toBe(before);
    // Resolved to the turn it joined, the same write lands there.
    s.addChanges(t2.id, engine(tick(1)).map((c) => ({ ...c, job: "j-cellar" })));
    expect(s.changes(t2.id).filter((c) => c.job === "j-cellar").map((c) => c.op)).toEqual(["unlink", "link", "clock"]);
    // A join is refused where it cannot be one: a turn that is not open, a turn not tied, a turn of another chat.
    const open = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    expect(() => s.joinTurn(t1.id, t2.id)).toThrow(StoreInputError);
    expect(() => s.joinTurn(open.id, s.beginTurn({ chat: "c", kind: "normal" }).id)).toThrow(StoreInputError);
    s.createChat({ id: "other", revision: ts.revision });
    const elsewhere = s.beginTurn({ chat: "other", kind: "continue" });
    expect(() => s.joinTurn(elsewhere.id, t2.id)).toThrow(StoreInputError);
  });

  test("a change the extended turn took while the continue was held: the continue's move is listed as not applied, and the lantern is held by Bram alone", () => {
    const ts = twoReplies();
    const { s, t2 } = ts;
    const held = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    s.addChanges(held.id, engine(goTo(POV, "cellar")));
    s.addChanges(held.id, engine(...hand("lantern", POV, "cask")));
    // The player hands the lantern to Bram while the continue runs: a change placed after the newest reply, on the turn being
    // continued (R-22). The continue's move was checked while Wren still held it.
    s.addChanges(t2.id, engine(...hand("lantern", POV, "bram")));
    expect(s.changes(held.id).map((c) => c.applied)).toEqual([true, true, true]);
    const joined = s.joinTurn(held.id, t2.id);
    expect(joined.map((c) => [c.op, c.applied])).toEqual([
      ["set", true],
      ["unlink", false],
      ["link", false],
    ]);
    expect(joined[1]?.reports).not.toEqual([]);
    expect(holders(s.stateAt(t2.id).state.world)).toEqual(["bram"]);
    expect(holders(reopened(ts).user(USER).stateAt(t2.id).state.world)).toEqual(["bram"]);
    expect(s.stateAt(t2.id).state.world.entities[POV]?.fields.place).toBe("cellar");

    // The same changes made on that turn in that order: the same rows, the same reports, the same state.
    const direct = twoReplies();
    direct.s.addChanges(direct.t2.id, engine(...hand("lantern", POV, "bram")));
    direct.s.addChanges(direct.t2.id, engine(goTo(POV, "cellar")));
    direct.s.addChanges(direct.t2.id, engine(...hand("lantern", POV, "cask")));
    expect(asMade(s.changes(t2.id))).toEqual(asMade(direct.s.changes(direct.t2.id)));
    const ids = (t: { t1: TurnRow; t2: TurnRow }) => ({ T1: t.t1.id, T2: t.t2.id });
    expect(named(s.stateAt(t2.id).state, ids(ts))).toBe(named(direct.s.stateAt(direct.t2.id).state, ids(direct)));
    expect(named(reopened(ts).user(USER).stateAt(t2.id).state, ids(ts))).toBe(named(direct.s.stateAt(direct.t2.id).state, ids(direct)));
  });

  test("a held turn that stood on a later turn, joined into an earlier one: the lantern ends where the same changes made there put it, a change that could not apply on the later turn now applies, and the later turn's changes that no longer apply are listed", () => {
    const ts = twoReplies();
    const { s, t2 } = ts;
    const t3 = play(s, "c", "m3", "Wren tucks the lantern away.", 3, engine(...hand("lantern", POV, "satchel")));
    // A continue the tag could not place goes after the path's last turn; its end names the earlier reply (R-192 (a)). Handing the
    // lantern to Bram could not apply there: it was in the satchel.
    const held = s.beginTurn({ chat: "c", kind: "continue", on: t3.node });
    s.addChanges(held.id, engine(...hand("lantern", POV, "bram")));
    expect(s.changes(held.id).map((c) => c.applied)).toEqual([false, false]);
    const joined = s.joinTurn(held.id, t2.id);
    expect(joined.map((c) => [c.op, c.applied, c.reports])).toEqual([
      ["unlink", true, []],
      ["link", true, []],
    ]);
    for (const at of [s.stateAt(t3.id), reopened(ts).user(USER).stateAt(t3.id)]) {
      expect(holders(at.state.world)).toEqual(["bram"]);
      expect(at.notApplied.map((n) => [n.turn, n.op])).toEqual([
        [t3.id, "unlink"],
        [t3.id, "link"],
      ]);
    }
    // Made there in that order, the same changes put the lantern in the same hands.
    const direct = twoReplies();
    direct.s.addChanges(direct.t2.id, engine(...hand("lantern", POV, "bram")));
    const d3 = play(direct.s, "c", "m3", "Wren tucks the lantern away.", 3, engine(...hand("lantern", POV, "satchel")));
    expect(named(s.stateAt(t3.id).state, { T1: ts.t1.id, T2: t2.id, T3: t3.id })).toBe(named(direct.s.stateAt(d3.id).state, { T1: direct.t1.id, T2: direct.t2.id, T3: d3.id }));
  });

  test("a job's change moved by the join is checked on the job's state on the extended turn", () => {
    const ts = twoReplies();
    const { s, t2 } = ts;
    const held = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    s.addChanges(held.id, engine(...hand("lantern", POV, "cask")).map((c) => ({ ...c, job: "j-cellar" })));
    s.addChanges(t2.id, engine(...hand("lantern", POV, "bram")));
    const joined = s.joinTurn(held.id, t2.id);
    expect(joined.map((c) => [c.op, c.job, c.applied])).toEqual([
      ["unlink", "j-cellar", false],
      ["link", "j-cellar", false],
    ]);
    // The job's view is as if its changes had been made there: Bram holds the lantern, not the cask.
    expect(holders(s.stateFor(t2.id, "j-cellar").state.world)).toEqual(["bram"]);
    const direct = twoReplies();
    direct.s.addChanges(direct.t2.id, engine(...hand("lantern", POV, "bram")));
    direct.s.addChanges(direct.t2.id, engine(...hand("lantern", POV, "cask")).map((c) => ({ ...c, job: "j-cellar" })));
    expect(asMade(s.changes(t2.id))).toEqual(asMade(direct.s.changes(direct.t2.id)));
  });

  test("a session the held turn opened is found at the extended turn after the join, on the chat's line", () => {
    const { s, t2, held } = continued();
    const cellar = s.openSession({ chat: "c", scene: "the cellar", turn: held.id });
    const inn = s.openSession({ chat: "c", scene: "the inn", turn: t2.id });
    s.closeSession(inn.id, held.id);
    s.joinTurn(held.id, t2.id);
    expect(s.session(cellar.id)).toMatchObject({ openedBy: t2.id, closedBy: null });
    expect(s.session(inn.id)).toMatchObject({ openedBy: t2.id, closedBy: t2.id });
    expect(s.line("c").map((l) => l.turn)).toContain(t2.id);
    expect(s.sessions("c").flatMap((x) => [x.openedBy, x.closedBy])).not.toContain(held.id);
  });

  test("a branch's continue of a reply the branch shares is refused by the chat check", () => {
    const { s, t2 } = twoReplies();
    s.branchChat({ id: "b", from: "c", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    s.sync("b", asShown(seen(["b-u1", "in"], ["b-m1", "Wren comes in from the rain.", 0], ["b-u2", "light"], ["b-m2", "Bram lends her a lantern.", 0]), { "b-m1": 1, "b-m2": 2 }));
    const on = s.path("b").find((e) => e.message === "b-m2")?.node ?? null;
    const held = s.beginTurn({ chat: "b", kind: "continue", on });
    s.addChanges(held.id, engine(goTo(POV, "cellar")));
    // The turn tied to the branch's copy of the reply is the source's: shared history stays shared.
    expect(s.swipes("b", "b-m2").map((t) => t.id)).toEqual([t2.id]);
    expect(() => s.joinTurn(held.id, t2.id)).toThrow(`turn ${held.id} is chat b's and turn ${t2.id} is chat c's: a continue extends a turn of its own chat`);
    expect(s.turn(held.id)?.status).toBe("open");
  });

  test("a swipe of the extended turn takes the joined changes with it, and a flip back brings them", () => {
    const { s, t2, held } = continued();
    s.joinTurn(held.id, t2.id);
    // The caller ties the extended turn again to the longer text Lumiverse saved.
    const longer = "Bram lends her a lantern. She takes it down the cellar steps.";
    s.tieTurn(t2.id, { message: "m2", hash: hashOf(longer), date: 2 });
    const showing = (text: string, date: number) => asShown(seen(["u1", "in"], ["m1", "Wren comes in from the rain.", 0], ["u2", "light"], ["m2", text, 0]), { m1: 1, m2: date });
    expect(placeOf(s, "c")).toBe("cellar");
    play(s, "c", "m2", "Bram keeps his lantern.", 5, engine(tick(2)), { target: "m2" });
    s.sync("c", showing("Bram keeps his lantern.", 5));
    expect(placeOf(s, "c")).toBe("common_room");
    s.sync("c", showing(longer, 2));
    expect(placeOf(s, "c")).toBe("cellar");
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(t2.id);
  });

  test("after the join the later turn's state read from memory is the one read after a restart", () => {
    const ts = continued({ afterLater: true });
    const { s, t2, held } = ts;
    const later = ts.later as TurnRow;
    expect(s.stateAt(later.id).state.world.entities[POV]?.fields.place).toBe("common_room");
    s.joinTurn(held.id, t2.id);
    const warm = s.stateAt(later.id);
    const cold = reopened(ts).user(USER).stateAt(later.id);
    expect(warm.state.world.entities[POV]?.fields.place).toBe("cellar");
    expect(hashJson(warm.state)).toBe(hashJson(cold.state));
    expect([warm.notApplied, warm.rebased]).toEqual([cold.notApplied, cold.rebased]);
  });

  test("the stored states on a rebased node and on a branch's path through the extended turn are dropped", () => {
    const ts = twoReplies({ snapshotEvery: 1 });
    const { s, t2 } = ts;
    // A branch from the second reply, with a turn of its own after it: its path runs through the extended turn.
    s.branchChat({ id: "b", from: "c", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    s.sync("b", asShown(seen(["b-u1", "in"], ["b-m1", "Wren comes in from the rain.", 0], ["b-u2", "light"], ["b-m2", "Bram lends her a lantern.", 0]), { "b-m1": 1, "b-m2": 2 }));
    const branchOwn = play(s, "b", "b-m3", "Out to the market.", 3, engine(tick(3)));
    // The first reply's other swipe flipped to: the second reply's turn stands rebased, on a node of its own after it.
    play(s, "c", "m1", "Wren shakes off the rain.", 4, engine(tick(20)), { target: "m1" });
    s.sync("c", asShown(seen(["u1", "in"], ["m1", "Wren shakes off the rain.", 0], ["u2", "light"], ["m2", "Bram lends her a lantern.", 0]), { m1: 4, m2: 2 }));
    const rebasedNode = s.path("c").find((e) => e.message === "m2")?.node ?? null;
    expect(rebasedNode).not.toBe(t2.node);
    // Both heads folded; the next write stores what they found worth keeping.
    s.headState("c");
    s.headState("b");
    const held = s.beginTurn({ chat: "c", kind: "continue", on: rebasedNode });
    s.addChanges(held.id, engine(goTo(POV, "cellar")));
    const storedThrough = (): string[] =>
      ts.store.db
        .query<{ node: string }, [string, string]>(
          `WITH RECURSIVE down(key) AS (SELECT key FROM path_node WHERE user = ?1 AND turn = ?2 UNION SELECT n.key FROM path_node n JOIN down d ON n.user = ?1 AND n.prev = d.key)
           SELECT node FROM snapshot WHERE user = ?1 AND node IN (SELECT key FROM down) ORDER BY node`,
        )
        .all(USER, t2.id)
        .map((r) => r.node);
    expect(storedThrough()).toEqual(expect.arrayContaining([rebasedNode as string, branchOwn.node]));
    s.joinTurn(held.id, t2.id);
    expect(storedThrough()).toEqual([]);
    // Folded again, both paths take the joined change.
    for (const store of [s, reopened(ts).user(USER)]) {
      expect(placeOf(store, "c")).toBe("cellar");
      expect(placeOf(store, "b")).toBe("cellar");
    }
  });
});

describe("one home for what a joined turn refuses", () => {
  /** A store on a database that holds the cast's, the story's and the lore's tables too, as RPE's does, with a chat of two replies. */
  function whole() {
    const db = new Database(":memory:");
    migrateStore(db);
    for (const m of [...CAST_MIGRATIONS, ...STORY_MIGRATIONS, ...LORE_MIGRATIONS]) if ("sql" in m) db.run(m.sql);
    let clock = 0;
    const ts = testStore({ db, now: () => ++clock });
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV)));
    return { ...ts, t1, t2 };
  }

  /** What a call was refused with: the error's kind, its words, and for a joined turn the turn and the turn it joined; null when it was not refused. */
  function refusal(call: () => unknown): unknown {
    try {
      call();
      return null;
    } catch (error) {
      if (!(error instanceof Error)) return error;
      return [error.name, error.message, error instanceof JoinedTurnError ? [error.turn, error.joined] : null];
    }
  }

  test("joinTurn and joinCast refuse the same cases with the same errors, from one check", () => {
    const ts = whole();
    const { s, store, revision, t1, t2 } = ts;
    s.createChat({ id: "d", revision });
    const open = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    const joined = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    s.joinTurn(joined.id, t2.id);
    const untied = s.beginTurn({ chat: "c", kind: "normal" });
    const elsewhere = s.beginTurn({ chat: "d", kind: "continue" });
    const cases: [string, string, string][] = [
      ["a held turn that is not there", "turn-nowhere", t2.id],
      ["a turn to join that is not there", open.id, "turn-nowhere"],
      ["a held turn joined already", joined.id, t2.id],
      ["a turn to join that was joined itself", open.id, joined.id],
      ["a held turn that is not open", t1.id, t2.id],
      ["a turn that is not tied", open.id, untied.id],
      ["turns of different chats", elsewhere.id, t2.id],
    ];
    const before = written(ts);
    for (const [what, held, into] of cases) {
      const byStore = refusal(() => s.joinTurn(held, into));
      expect([what, byStore === null]).toEqual([what, false]);
      expect([what, refusal(() => joinCast(store, USER, held, into))]).toEqual([what, byStore]);
    }
    expect(written(ts)).toBe(before);
    expect(s.turn(open.id)?.status).toBe("open");
  });

  test("a write to a joined turn is refused by every write call of the store, the cast and the story, naming the turn it joined", () => {
    const ts = whole();
    const { s, store, t2 } = ts;
    const held = s.beginTurn({ chat: "c", kind: "continue", on: t2.node });
    s.joinTurn(held.id, t2.id);
    const writer = { user: USER, chat: "c", turn: held.id, by: "gm", agent: "gm-1", job: null, now: 9 };
    const before = written(ts);
    const calls: [string, () => unknown][] = [
      ["the store's change", () => s.addChanges(held.id, engine(tick(1)))],
      ["the store's take-back", () => s.takeBack(held.id, -1)],
      ["the store's staged changes", () => s.dropStaged(held.id)],
      ["the cast's write", () => writeCast(store.db, { ...writer, at: null }, [{ character: "bram", part: "knowledge", item: null, value: { text: "Wren went down to the cellar." } }])],
      ["the cast's take-back", () => takeBackCast(store.db, USER, held.id, -1)],
      ["the cast's staged rows", () => dropCastStaged(store, USER, held.id)],
      ["the story's write", () => recordStory(store, writer, [{ part: "beat", item: null, value: { text: "Wren goes down with the lantern." } }])],
      ["the lore's overlay", () => recordStory(store, writer, [{ entry: "w-1", note: "The cellar is flooded now." }])],
    ];
    for (const [what, call] of calls) expect([what, refusal(call)]).toEqual([what, ["JoinedTurnError", `turn ${held.id} was joined to turn ${t2.id}: address that turn instead`, [held.id, t2.id]]]);
    expect(written(ts)).toBe(before);
  });
});

describe("the turn tree", () => {
  test("swipes of a reply are siblings under one parent, and the path follows the swipe showing", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "They meet.", 1, engine(tick(10)));
    const a = play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const b = play(s, "c", "m2", "She steps out to the market.", 3, engine(goTo(POV, "market_square")), { target: "m2" });
    expect([a.parent, b.parent]).toEqual([t1.id, t1.id]);
    expect(s.swipes("c", "m2").map((t) => t.id)).toEqual([a.id, b.id]);
    // The newest swipe joined the path when it was tied; showing the first swipe again swaps it back.
    expect(placeOf(s, "c")).toBe("market_square");
    const report = s.sync("c", shown(["u1", "hello"], ["m1", "They meet.", 1], ["u2", "where now"], ["m2", "She goes down to the cellar.", 2]));
    expect(report.swiped).toEqual({ message: "m2", from: b.id, to: a.id });
    expect(report.flipped).toEqual([]);
    expect(s.path("c").filter((e) => e.turn !== null).map((e) => e.turn)).toEqual([t1.id, a.id]);
    expect(placeOf(s, "c")).toBe("cellar");
  });

  test("a deleted swipe moves nothing: the turn showing is found by its date and saved hash, not its position", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Morning.", 1, []);
    const texts = ["To the cellar.", "To the market.", "Onto the far road."];
    const places = ["cellar", "market_square", "far_road"];
    const swipes = texts.map((text, i) => play(s, "c", "m2", text, 10 + i, engine(goTo(POV, places[i] ?? "")), i === 0 ? {} : { target: "m2" }));
    // The chat application deletes the first swipe: the third is now at position 1, and it is the one showing.
    const now = [
      { hash: hashOf(texts[1] ?? ""), date: 11 },
      { hash: hashOf(texts[2] ?? ""), date: 12 },
    ];
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", texts[2] ?? "", 12]));
    expect(placeOf(s, "c")).toBe("far_road");
    const third = swipes[2];
    if (!third) throw new Error("no third swipe");
    expect(swipeIndex(third, now)).toBe(1);
    // Showing what is now at position 0 is the second swipe, with its own state.
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", texts[1] ?? "", 11]));
    expect(placeOf(s, "c")).toBe("market_square");
  });

  test("editing a reply whose swipes share one date keeps the turn showing there, flagged edited", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Morning.", 1, []);
    // Lumiverse's own migration gave every swipe of an older message the message's date.
    const a = play(s, "c", "m2", "To the cellar.", 7, engine(goTo(POV, "cellar")));
    const b = play(s, "c", "m2", "To the market.", 7, engine(goTo(POV, "market_square")), { target: "m2" });
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the market.", 7]));
    expect(placeOf(s, "c")).toBe("market_square");
    const report = s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the market, the long way round.", 7]));
    expect(report.edited).toEqual([{ turn: b.id, message: "m2", saved: hashOf("To the market."), now: hashOf("To the market, the long way round.") }]);
    expect(report.unplayed).toEqual([]);
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(b.id);
    expect(s.turn(b.id)?.edited).toBe(hashOf("To the market, the long way round."));
    expect(placeOf(s, "c")).toBe("market_square");
    // The other swipe is still told apart by its own text.
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the cellar.", 7]));
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(a.id);
    expect(placeOf(s, "c")).toBe("cellar");
  });

  test("a path is extended only from a node there is, with a turn there is, and a refusal writes nothing", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Morning.", 1, []);
    const t2 = play(s, "c", "m2", "Noon.", 2, []);
    const nodes = () => store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM path_node").get()?.n;
    const before = nodes();
    expect(() => s.extendPath("no-such-node", t2.id)).toThrow(StoreInputError);
    expect(() => s.extendPath(t1.node, "no-such-turn")).toThrow(StoreInputError);
    expect(nodes()).toBe(before);
    // From a node that is there, one deeper: here, the node the second turn was made on.
    expect(s.extendPath(t1.node, t2.id)).toBe(t2.node);
    expect(store.db.query<{ depth: number }, [string]>("SELECT depth FROM path_node WHERE key = ?").get(t2.node)?.depth).toBe(1);
    expect(nodes()).toBe(before);
  });

  test("messages gone leave the path and the state rewinds by itself", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "One.", 1, engine(tick(5), goTo(POV, "cellar")));
    const t2 = play(s, "c", "m2", "Two.", 2, engine(tick(7), make("lamp", "Lamp", POV)));
    const t3 = play(s, "c", "m3", "Three.", 3, engine(tick(9), goTo(POV, "far_road")));
    s.sync("c", shown(["u1", "a"], ["m1", "One.", 1], ["u2", "b"], ["m2", "Two.", 2], ["u3", "c"], ["m3", "Three.", 3]));
    const before = s.stateAt(t1.id).state.world;
    const report = s.sync("c", shown(["u1", "a"], ["m1", "One.", 1]));
    expect(report.gone).toEqual([
      { message: "u2", turn: null },
      { message: "m2", turn: t2.id },
      { message: "u3", turn: null },
      { message: "m3", turn: t3.id },
    ]);
    const head = s.headState("c").state.world;
    expect([head.clock, head.entities[POV]?.fields.place, carried(head, POV)]).toEqual([before.clock, before.entities[POV]?.fields.place, carried(before, POV)]);
    expect(carried(head, POV)).not.toContain("lamp");
  });

  test("comparing paths finds an edited reply once, and the replies no turn played after the first that one did", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const first = s.beginTurn({ chat: "c", kind: "normal" });
    s.tieTurn(first.id, { message: "m1", hash: hashOf("The first reply."), date: 2 });
    const base = shown(["m0", "A greeting from before.", 0], ["u1", "go"], ["m1", "The first reply.", 2], ["u2", "on"], ["m2", "Written elsewhere.", 3], ["u3", "more"], ["m3", "Also elsewhere.", 4]);
    const report = s.sync("c", base);
    expect(report.unplayed).toEqual([{ from: "m2", to: "m3", count: 2 }]);
    expect(report.edited).toEqual([]);
    // The user edits the first reply: same swipe date, different text.
    const edited = base.map((m) => (m.id === "m1" ? { ...m, hash: hashOf("The first reply, edited.") } : m));
    const again = s.sync("c", edited);
    expect(again.edited).toEqual([{ turn: first.id, message: "m1", saved: hashOf("The first reply."), now: hashOf("The first reply, edited.") }]);
    expect(s.turn(first.id)?.edited).toBe(hashOf("The first reply, edited."));
    expect(s.path("c").find((e) => e.message === "m1")?.turn).toBe(first.id);
    expect(s.sync("c", edited).edited).toEqual([]);
  });

  test("a branch made from the fork's old-to-new map shares the source's turns, and each chat goes its own way after", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    const t1 = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar"), make("lamp", "Lamp", POV)));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    const report = s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2]));
    expect(report.branched).toEqual({ from: "source", at: "m2" });
    expect(s.path("branch").filter((e) => e.turn !== null)[0]?.turn).toBe(t1.id);
    const shared = (chat: string) => {
      const w = s.headState(chat).state.world;
      return [w.clock, w.entities[POV]?.fields.place, carried(w, POV)];
    };
    expect(shared("branch")).toEqual(shared("source"));
    // One more turn in each: the branch walks out to the market, the source rests a while.
    play(s, "branch", "b-m3", "Out to the market.", 3, engine(goTo(POV, "market_square")));
    play(s, "source", "m3", "A long rest.", 4, engine(tick(120)));
    const branch = s.headState("branch").state.world;
    const source = s.headState("source").state.world;
    expect(branch.entities[POV]?.fields.place).toBe("market_square");
    expect(source.entities[POV]?.fields.place).toBe("cellar");
    expect(source.clock - branch.clock).toBe(120);
    expect(carried(branch, POV)).toEqual(carried(source, POV));
  });

  test("a branch's turn begun after a reply it shares takes that reply's place on the branch's path with a node of its own: the shared turn's changes stay on the branch's path, and the source's path is untouched", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    const sourcePath = s.path("source");
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    const branchShown = (last: string) => shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", last, 2]);
    s.sync("branch", branchShown("Down the stairs."));

    // The branch's copy of the shared reply goes on in a turn of the branch's own, after the shared one, tied to the longer text.
    const on = s.path("branch").find((e) => e.message === "b-m2")?.node ?? null;
    const own = play(s, "branch", "b-m2", "Down the stairs. The lamp gutters.", 2, engine(tick(30)), { on, kind: "continue" });
    expect(own.parent).toBe(shared.id);
    expect(s.path("branch").find((e) => e.message === "b-m2")).toMatchObject({ turn: own.id, node: own.node, own: true, hash: hashOf("Down the stairs. The lamp gutters.") });
    // The branch's state holds the shared turn's changes, then its own.
    const branch = s.headState("branch").state.world;
    expect(branch.entities[POV]?.fields.place).toBe("cellar");
    expect(branch.clock - s.headState("source").state.world.clock).toBe(30);
    // The source keeps its path, and its turn keeps its message and text.
    expect(s.path("source")).toEqual(sourcePath);
    expect(s.turn(shared.id)).toMatchObject({ message: "m2", hash: hashOf("Down the stairs.") });

    // The branch compared again as it now shows finds nothing, and its next turn follows its own.
    expect(s.sync("branch", branchShown("Down the stairs. The lamp gutters."))).toMatchObject({ gone: [], swiped: null, flipped: [], rebased: null, unplayed: [] });
    expect(s.path("branch").find((e) => e.message === "b-m2")).toMatchObject({ turn: own.id, node: own.node, own: true });
    expect(play(s, "branch", "b-m3", "Out to the market.", 3, engine(goTo(POV, "market_square"))).parent).toBe(own.id);
    expect(s.headState("branch").state.world.entities[POV]?.fields.place).toBe("market_square");
    expect(s.headState("source").state.world.entities[POV]?.fields.place).toBe("cellar");
  });

  test("a branch's continue of a reply it shares keeps the shared turn on the branch's line, for every reader of it and through a comparison that rebuilds the path; the source is untouched", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    const first = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    const sourcePath = s.path("source");
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2]));
    const on = s.path("branch").find((e) => e.message === "b-m2")?.node ?? null;
    const own = play(s, "branch", "b-m2", "Down the stairs. The lamp gutters.", 2, engine(tick(30)), { on, kind: "continue" });

    // The shared turn stands on the branch's line just before the branch's own, at the same reply, for the story's and the cast's
    // readings, at the head and at the branch's turn.
    const line = [first.id, shared.id, own.id];
    expect(s.line("branch").map((l) => l.turn)).toEqual(line);
    expect(storyAt(s, "branch", null).turns).toEqual(line);
    expect(storyAt(s, "branch", own.id).replyOf(shared.id)).toBe(3);
    expect(castAt(s, "branch", null).turns).toEqual(line);
    expect(castAt(s, "branch", own.id).turns).toEqual(line);

    // The branch deletes its first reply: the comparison rebuilds its path, and the shared turn's move is still there, then the branch's own.
    s.sync("branch", shown(["b-u1", "in"], ["b-u2", "down"], ["b-m2", "Down the stairs. The lamp gutters.", 2]));
    expect(s.line("branch").map((l) => l.turn)).toEqual([shared.id, own.id]);
    expect(storyAt(s, "branch", null).turns).toEqual([shared.id, own.id]);
    expect(placeOf(s, "branch")).toBe("cellar");
    expect(s.headState("branch").state.world.clock - s.headState("source").state.world.clock).toBe(30 - 15);
    // The branch compared again as it shows finds nothing, and keeps the same line.
    expect(s.sync("branch", shown(["b-u1", "in"], ["b-u2", "down"], ["b-m2", "Down the stairs. The lamp gutters.", 2]))).toMatchObject({ gone: [], swiped: null, flipped: [], unplayed: [] });
    expect(s.line("branch").map((l) => l.turn)).toEqual([shared.id, own.id]);

    // The source keeps its path, its line and its state throughout.
    expect(s.path("source")).toEqual(sourcePath);
    expect(s.line("source").map((l) => l.turn)).toEqual([first.id, shared.id]);
    expect(placeOf(s, "source")).toBe("cellar");
  });

  test("deleting a chat keeps the turns a branch still shares, and removes them once nothing does", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(goTo(POV, "cellar")));
    s.branchChat({ id: "branch", from: "source", map: { m1: "b-m1" } });
    s.sync("branch", shown(["b-m1", "Into the inn.", 1]));
    expect(s.deleteChat("source")).toEqual({ kept: true });
    expect(s.headState("branch").state.world.entities[POV]?.fields.place).toBe("cellar");
    expect(s.deleteChat("branch")).toEqual({ kept: false });
    const left = (table: string) => store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    for (const table of ["message_link", "chat", "turn", "change", "path_node"]) expect([table, left(table)]).toEqual([table, 0]);
  });

  test("a user's chats are listed oldest first: not a chat deleted while a branch still shares its turns, nor another user's", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(goTo(POV, "cellar")));
    s.createChat({ id: "plain" });
    s.branchChat({ id: "branch", from: "source", map: { m1: "b-m1" } });
    store.user("user-b").createChat({ id: "theirs" });
    expect(s.chats().map((c) => [c.id, c.revision])).toEqual([
      ["source", revision],
      ["plain", null],
      ["branch", revision],
    ]);
    expect(s.deleteChat("source")).toEqual({ kept: true });
    expect(s.chats().map((c) => c.id)).toEqual(["plain", "branch"]);
  });
});
