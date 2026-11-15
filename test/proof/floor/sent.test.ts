// What the model was sent (STANDALONE-PLAN §17.1 l.1764; PlanGates-4): recorded pairs, all invented (a
// lighthouse keeper's chat), of the Author's first request as RPH kept it and the prompt Lumiverse stored
// with the reply. A message missing, extra, out of order or sent with another role fails the turn and is
// named; a joined message stands for the rows it joined; history the window left out is told from a miss
// by the chat's rows, a hidden row not counting; the prompt must start right after the opening block; and
// the row passes only when every RPE turn does.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSent, sentFold, type SentInput, type StoredMessage } from "../../../scripts/proof/lib/sent";

/** A recorded pair as its fixture keeps it: the request file, Lumiverse's breakdown, and what the floor read beside them. */
interface Recorded {
  request: { messages: SentInput["request"] };
  breakdown: { messages: SentInput["stored"] };
  rows?: SentInput["rows"];
  keep?: number;
  framing?: string;
}

function pair(name: string): SentInput {
  const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", `sent-${name}.json`), "utf8")) as Recorded;
  return { request: recorded.request.messages, stored: recorded.breakdown.messages, rows: recorded.rows, keep: recorded.keep, framing: recorded.framing };
}

const first80 = (text: string): string => text.slice(0, 80);

test("a whole pair passes, with RPH's carry and briefing after the prompt and the reply's own row among the rows", () => {
  const verdict = compareSent(pair("whole"));
  expect(verdict).toMatchObject({ pass: true, opening: true, startsAfterOpening: true, owed: 10, inOrder: 10, missing: [], extra: [], reordered: [], roles: [], beyond: [], leftOut: [] });
  expect(verdict.words).toBe("All 10 messages Lumiverse sent that the window kept are in the Author's first request, in order, with their roles, right after the opening block");
});

test("a message of Lumiverse's missing from the request fails the turn and is named, and nothing after it is called out of order", () => {
  const input = pair("missing");
  const verdict = compareSent(input);
  const lost = first80(input.stored[5].content);
  expect(verdict.pass).toBe(false);
  expect(verdict.missing).toEqual([{ place: 6, role: "assistant", text: lost, rows: ["lh-3"] }]);
  expect(verdict).toMatchObject({ extra: [], reordered: [], roles: [], beyond: [], startsAfterOpening: true, owed: 10, inOrder: 9 });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: missing: stored 6, assistant "${lost}"`);
});

test("a joined message of two queued rows is matched as the two rows it stands for, each counting toward the window", () => {
  const verdict = compareSent(pair("joined"));
  expect(verdict.pass).toBe(true);
  expect(verdict.history.find((h) => h.place === 9)).toEqual({ place: 9, rows: ["lh-6", "lh-7"], kept: true });
  // Counted as its two rows, the joined message and Brisa's third reply fill the window of 3, so the four older messages were rightly left out.
  expect(verdict.leftOut.map((m) => [m.place, m.rows])).toEqual([
    [4, ["lh-1"]],
    [5, ["lh-2"]],
    [6, ["lh-3"]],
    [7, ["lh-4"]],
  ]);
  expect(verdict).toMatchObject({ owed: 6, inOrder: 6, missing: [], beyond: [] });
  expect(verdict.words).toBe("All 6 messages Lumiverse sent that the window kept are in the Author's first request, in order, with their roles, right after the opening block; the window left out 4 older messages");
});

test("a joined message whose first row is older than the window's edge is left out whole, as Lumiverse numbers it by that row", () => {
  const input = pair("joined");
  const joined = input.stored[8];
  // A window of 1 keeps only lh-7, the second of the joined rows: the joined message goes by lh-6, so it is left out with all older history.
  const bare = [...input.request.slice(0, 4), ...input.request.slice(6)];
  const verdict = compareSent({ ...input, keep: 1, request: bare });
  expect(verdict).toMatchObject({ pass: true, owed: 4, missing: [] });
  expect(verdict.leftOut.at(-1)).toEqual({ place: 9, role: "user", text: first80(joined.content), rows: ["lh-6", "lh-7"] });

  const kept = compareSent({ ...input, keep: 1, request: [...bare.slice(0, 4), { role: "user", text: joined.content }, ...bare.slice(4)] });
  expect(kept.pass).toBe(false);
  expect(kept.beyond.map((m) => m.stored.rows)).toEqual([["lh-6", "lh-7"]]);
});

test("a message the request has out of its order fails the turn and is named, with nothing called missing or extra", () => {
  const input = pair("reordered");
  const verdict = compareSent(input);
  const lore = first80(input.stored[2].content);
  expect(verdict.pass).toBe(false);
  expect(verdict.reordered).toEqual([{ stored: { place: 3, role: "system", text: lore }, sent: { place: 7, role: "system", text: lore } }]);
  expect(verdict).toMatchObject({ missing: [], extra: [], roles: [], inOrder: 9 });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: out of order: stored 3, system "${lore}", sent 7`);
});

test("a message that is not Lumiverse's inside the prompt fails the turn and is named, while RPH's blocks after the prompt are not", () => {
  const input = pair("extra");
  const verdict = compareSent(input);
  const note = first80(input.request[8].text);
  expect(verdict.pass).toBe(false);
  expect(verdict.extra).toEqual([{ place: 9, role: "system", text: note }]);
  expect(verdict).toMatchObject({ missing: [], reordered: [], roles: [], inOrder: 10 });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: extra: sent 9, system "${note}"`);
});

test("older history the window left out passes with the chat's rows, a hidden row not counting, and is missing without them", () => {
  const input = pair("window");
  const verdict = compareSent(input);
  expect(verdict.pass).toBe(true);
  expect(verdict.leftOut.map((m) => [m.place, m.role, m.rows])).toEqual([
    [4, "assistant", ["lh-1"]],
    [5, "user", ["lh-2"]],
    [6, "assistant", ["lh-3"]],
  ]);
  // The hidden aside does not count, so the window of 4 reaches back to the player's "Lead the way." (lh-4), which the request holds.
  expect(verdict.history.find((h) => h.place === 7)).toEqual({ place: 7, rows: ["lh-4"], kept: true });

  const blind = compareSent({ ...input, rows: undefined });
  expect(blind.pass).toBe(false);
  expect(blind.missing.map((m) => [m.place, m.role, m.text])).toEqual([4, 5, 6].map((place) => [place, input.stored[place - 1].role, first80(input.stored[place - 1].content)]));
  expect(blind).toMatchObject({ extra: [], reordered: [], leftOut: [] });
});

test("a request whose prompt does not start right after the opening block fails, though every message is there in order", () => {
  const input = pair("no-opening");
  const verdict = compareSent(input);
  const main = first80(input.stored[0].content);
  expect(verdict).toMatchObject({ pass: false, opening: false, startsAfterOpening: false, missing: [], extra: [], reordered: [], roles: [], beyond: [], inOrder: 10 });
  expect(verdict.startWhy).toBe(`the request has no opening block: it starts with a message Lumiverse sent, system "${main}"`);
  expect(verdict.words).toBe(`Not as Lumiverse sent it: ${verdict.startWhy}`);

  // The briefing put in front of the prompt stands where the prompt should start, and is not Lumiverse's.
  const whole = pair("whole");
  const briefing = whole.request[12];
  const fronted = compareSent({ ...whole, request: [whole.request[0], briefing, ...whole.request.slice(1, 12)] });
  expect(fronted).toMatchObject({ pass: false, opening: true, startsAfterOpening: false, extra: [{ place: 2, role: "system", text: first80(briefing.text) }], missing: [] });
  expect(fronted.startWhy).toBe(`sent 2, system "${first80(briefing.text)}", stands between the opening block and the prompt`);
});

test("the framing line RPH puts in front of the prompt is its head when its text is given, and named when it is not", () => {
  const input = pair("framed");
  const verdict = compareSent(input);
  expect(verdict).toMatchObject({ pass: true, framed: true, startsAfterOpening: true, extra: [], inOrder: 10 });
  expect(verdict.words).toBe("All 10 messages Lumiverse sent that the window kept are in the Author's first request, in order, with their roles, right after the opening block and its framing line");

  const frame = first80(input.request[1].text);
  const unframed = compareSent({ ...input, framing: undefined });
  expect(unframed).toMatchObject({ pass: false, framed: false, startsAfterOpening: false, extra: [{ place: 2, role: "system", text: frame }] });
  expect(unframed.startWhy).toBe(`sent 2, system "${frame}", stands between the opening block and the prompt`);
});

test("a user message pi joined from its parts with a line break matches what Lumiverse joined with nothing; a system message must match exactly", () => {
  const input = pair("parts");
  expect(compareSent(input)).toMatchObject({ pass: true, owed: 8, inOrder: 8 });

  // RPH hands pi a system message as one text, so the same difference there makes another message.
  const asSystem = compareSent({
    ...input,
    request: input.request.map((m, j) => (j === 7 ? { ...m, role: "system" } : m)),
    stored: input.stored.map((m, k) => (k === 6 ? { ...m, role: "system" } : m)),
  });
  expect(asSystem.pass).toBe(false);
  expect(asSystem.missing.map((m) => m.place)).toEqual([7]);
  expect(asSystem.extra.map((m) => m.place)).toEqual([8]);
});

test("a message in its place with another role fails the turn and is named", () => {
  const whole = pair("whole");
  const verdict = compareSent({ ...whole, request: whole.request.map((m, j) => (j === 10 ? { ...m, role: "user" } : m)) });
  const post = first80(whole.stored[9].content);
  expect(verdict.pass).toBe(false);
  expect(verdict.roles).toEqual([{ stored: { place: 10, role: "system", text: post }, sent: { place: 11, role: "user", text: post } }]);
  expect(verdict).toMatchObject({ missing: [], extra: [], reordered: [] });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: another role: stored 10, system "${post}", sent 11 as user`);
});

test("a message the window left out that the request has all the same fails the turn and is named", () => {
  const window = pair("window");
  const lh3 = window.stored[5].content;
  const verdict = compareSent({ ...window, request: [...window.request.slice(0, 4), { role: "assistant", text: lh3 }, ...window.request.slice(4)] });
  expect(verdict.pass).toBe(false);
  expect(verdict.beyond).toEqual([{ stored: { place: 6, role: "assistant", text: first80(lh3), rows: ["lh-3"] }, sent: { place: 5, role: "assistant", text: first80(lh3) } }]);
  expect(verdict.leftOut.map((m) => m.place)).toEqual([4, 5]);
  expect(verdict).toMatchObject({ missing: [], extra: [], reordered: [] });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: sent though the window left it out: stored 6, assistant "${first80(lh3)}", sent 5`);
});

test("with a step, the window keeps from its last cut: an older message is owed that a window without one leaves out", () => {
  const window = pair("window");
  const lh3 = window.stored[5].content;
  const withLh3 = [...window.request.slice(0, 4), { role: "assistant", text: lh3 }, ...window.request.slice(4)];
  // Seven messages against a window of 4 with a step of 2: it was last cut back at six, so at seven it holds five, back to lh-3.
  expect(compareSent({ ...window, step: 2, request: withLh3 })).toMatchObject({ pass: true, owed: 9, beyond: [] });
  const short = compareSent({ ...window, step: 2 });
  expect(short.missing).toEqual([{ place: 6, role: "assistant", text: first80(lh3), rows: ["lh-3"] }]);
  expect(short.leftOut.map((m) => m.place)).toEqual([4, 5]);
});

test("with the hold on, the request may keep an unbroken stretch of the messages the hold can reach, and no more", () => {
  const window = pair("window");
  const [g, u1, a1] = [window.stored[3], window.stored[4], window.stored[5]];
  const withOlder = (...older: StoredMessage[]) => [...window.request.slice(0, 4), ...older.map((m) => ({ role: m.role, text: m.content })), ...window.request.slice(4)];
  // A cap of 2 lets the window reach back over lh-2 and lh-3, as far as the story record leaves them uncovered.
  expect(compareSent({ ...window, hold: 2 })).toMatchObject({ pass: true, owed: 8 });
  expect(compareSent({ ...window, hold: 2, request: withOlder(a1) })).toMatchObject({ pass: true, owed: 9 });
  expect(compareSent({ ...window, hold: 2, request: withOlder(u1, a1) })).toMatchObject({ pass: true, owed: 10 });
  const gap = compareSent({ ...window, hold: 2, request: withOlder(u1) });
  expect(gap.pass).toBe(false);
  expect(gap.missing.map((m) => m.rows)).toEqual([["lh-3"]]);
  const past = compareSent({ ...window, hold: 2, request: withOlder(g, u1, a1) });
  expect(past.pass).toBe(false);
  expect(past.beyond.map((m) => m.stored.rows)).toEqual([["lh-1"]]);
});

test("the row passes only when every RPE turn passes: a failing turn fails it and is named, a turn not compared leaves it unjudged", () => {
  const whole = compareSent(pair("whole"));
  const missing = compareSent(pair("missing"));
  const unread = { turn: "t-03", verdict: null, why: "Lumiverse stored no prompt with message m-03" };

  expect(sentFold([{ turn: "t-01", verdict: whole, why: null }, { turn: "t-02", verdict: whole, why: null }])).toEqual({
    verdict: "pass",
    measured: "2 of 2 RPE turns held every message Lumiverse sent that the window kept, in order, with their roles, right after the opening block",
    notes: [],
  });

  const failed = sentFold([{ turn: "t-01", verdict: whole, why: null }, { turn: "t-02", verdict: missing, why: null }, unread]);
  expect(failed).toEqual({
    verdict: "fail",
    measured: "1 of 3 RPE turns held every message Lumiverse sent that the window kept, in order, with their roles, right after the opening block; 1 could not be compared",
    notes: [`turn t-02: ${missing.words}`, "turn t-03 could not be compared: Lumiverse stored no prompt with message m-03"],
  });

  expect(sentFold([{ turn: "t-01", verdict: whole, why: null }, unread])).toMatchObject({ verdict: "not judged", notes: ["turn t-03 could not be compared: Lumiverse stored no prompt with message m-03"] });
  expect(sentFold([])).toEqual({ verdict: "not judged", measured: "no RPE turn to compare", notes: ["the run gave no RPE turn to compare"] });
});
