// What the model was sent (STANDALONE-PLAN §17.1 l.1764; PlanGates-4; PlanGates-4-fix1 items 8 and 9):
// recorded pairs, all invented (a lighthouse keeper's chat), of the Author's first request as RPH kept it
// and the prompt Lumiverse stored with the reply. A message missing, extra, out of order or sent with
// another role fails the turn and is named; a joined message stands for the rows it joined; history the
// window left out is told from a miss by the chat's rows, a hidden row not counting, and the window is
// R-95's; the framing line is accepted in exactly one place, as RPH renders the shipped file; a message
// after the prompt passes only when the kept request names it as RPH's own; nothing is passed unseen.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { noteOf, renderFrame } from "../../../scripts/proof/lib/frame";
import { compareSent, sentFold, windowStart, type RequestMessage, type SentInput, type StoredMessage } from "../../../scripts/proof/lib/sent";

/** A recorded pair as its fixture keeps it: the request file, Lumiverse's breakdown, and what the floor read beside them. */
interface Recorded {
  request: { messages: { role: string; text: string }[] };
  breakdown: { messages: StoredMessage[] };
  rows?: SentInput["rows"];
  keep?: number;
  framing?: string;
}

/** RPH's own blocks after the prompt, named as an RPH that names its blocks keeps them (`block`); the pinned RPH names none. */
const blockOf = (text: string): string | null => (text.startsWith("What this scene has carried so far") ? "carry" : text.startsWith("Turn facts:") ? "briefing" : null);

function pair(name: string): SentInput & { request: RequestMessage[]; stored: StoredMessage[] } {
  const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", `sent-${name}.json`), "utf8")) as Recorded;
  return { request: recorded.request.messages.map((m) => ({ ...m, block: blockOf(m.text) })), stored: recorded.breakdown.messages, rows: recorded.rows, keep: recorded.keep, framing: recorded.framing };
}

const first80 = (text: string | null): string => (text ?? "").slice(0, 80);
const textAt = (input: { stored: StoredMessage[] }, k: number): string => input.stored[k]?.content ?? "";

const REPO = resolve(import.meta.dir, "../../..");
/** The shipped framing file at the build, header included, as RPH renders it. */
async function shippedFrame(): Promise<{ framing: string; framingNote: string }> {
  const rendered = await renderFrame(readFileSync(join(REPO, "guidance/.prompts/prompt-frame.md"), "utf8"));
  if ("none" in rendered) throw new Error(rendered.none);
  const note = await noteOf(rendered.text);
  if ("none" in note) throw new Error(note.none);
  return { framing: rendered.text, framingNote: note.text };
}

test("a whole pair passes, with RPH's carry and briefing named after the prompt and the reply's own row among the rows", () => {
  const verdict = compareSent(pair("whole"));
  expect(verdict).toMatchObject({ pass: true, opening: true, startsAfterOpening: true, owed: 10, inOrder: 10, missing: [], extra: [], unnamed: [], reordered: [], roles: [], beyond: [], leftOut: [] });
  expect(verdict.words).toBe("All 10 messages Lumiverse sent that the window kept are in the Author's first request, in order, with their roles, right after the opening block");
});

test("a message of Lumiverse's missing from the request fails the turn and is named, and nothing after it is called out of order", () => {
  const input = pair("missing");
  const verdict = compareSent(input);
  const lost = first80(textAt(input, 5));
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
  const joined = textAt(input, 8);
  // A window of 1 keeps only lh-7, the second of the joined rows: the joined message goes by lh-6, so it is left out with all older history.
  const bare = [...input.request.slice(0, 4), ...input.request.slice(6)];
  const verdict = compareSent({ ...input, keep: 1, request: bare });
  expect(verdict).toMatchObject({ pass: true, owed: 4, missing: [] });
  expect(verdict.leftOut.at(-1)).toEqual({ place: 9, role: "user", text: first80(joined), rows: ["lh-6", "lh-7"] });

  const kept = compareSent({ ...input, keep: 1, request: [...bare.slice(0, 4), { role: "user", text: joined }, ...bare.slice(4)] });
  expect(kept.pass).toBe(false);
  expect(kept.beyond.map((m) => m.stored.rows)).toEqual([["lh-6", "lh-7"]]);
});

test("line breaks are set aside only inside a joined message: there they may differ, in any other message they fail it", () => {
  const joined = pair("joined");
  const broken = joined.request.map((m, j) => (j === 5 ? { ...m, text: m.text.replace("brass rail.", "brass\n rail.") } : m));
  expect(compareSent({ ...joined, request: broken }).pass).toBe(true);
  // A user message pi joined from its parts with a line break, which Lumiverse stored joined by nothing, is no joined message of the chat's rows: it is not taken as the same.
  const parts = compareSent(pair("parts"));
  expect(parts.pass).toBe(false);
  expect(parts.missing.map((m) => m.place)).toEqual([7]);
  expect(parts.extra.map((m) => m.place)).toEqual([8]);
});

test("a message the request has out of its order fails the turn and is named, with nothing called missing or extra", () => {
  const input = pair("reordered");
  const verdict = compareSent(input);
  const lore = first80(textAt(input, 2));
  expect(verdict.pass).toBe(false);
  expect(verdict.reordered).toEqual([{ stored: { place: 3, role: "system", text: lore }, sent: { place: 7, role: "system", text: lore } }]);
  expect(verdict).toMatchObject({ missing: [], extra: [], roles: [], inOrder: 9 });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: out of order: stored 3, system "${lore}", sent 7`);
});

test("a message that is not Lumiverse's inside the prompt fails the turn and is named", () => {
  const input = pair("extra");
  const verdict = compareSent(input);
  const note = first80(input.request[8]?.text ?? "");
  expect(verdict.pass).toBe(false);
  expect(verdict.extra).toEqual([{ place: 9, role: "system", text: note }]);
  expect(verdict).toMatchObject({ missing: [], reordered: [], roles: [], inOrder: 10 });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: extra: sent 9, system "${note}"`);
});

test("an unnamed message after the prompt fails the turn and is named; RPH's own blocks named by the kept request pass", () => {
  const whole = pair("whole");
  const unnamed = compareSent({ ...whole, request: whole.request.map((m) => ({ ...m, block: null })) });
  expect(unnamed.pass).toBe(false);
  expect(unnamed.unnamed.map((m) => m.place)).toEqual([12, 13]);
  expect(unnamed.words).toContain(`extra after the prompt: sent 12, system "${first80(whole.request[11]?.text ?? "").trim()}", which the kept request does not name as RPH's own`);
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
  expect(blind.missing.map((m) => [m.place, m.role, m.text])).toEqual([4, 5, 6].map((place) => [place, input.stored[place - 1]?.role, first80(textAt(input, place - 1))]));
  expect(blind).toMatchObject({ extra: [], reordered: [], leftOut: [] });
});

test("a request whose prompt does not start right after the opening block fails, though every message is there in order", () => {
  const input = pair("no-opening");
  const verdict = compareSent(input);
  const main = first80(textAt(input, 0));
  expect(verdict).toMatchObject({ pass: false, opening: false, startsAfterOpening: false, missing: [], extra: [], reordered: [], roles: [], beyond: [], inOrder: 10 });
  expect(verdict.startWhy).toBe(`the request has no opening block: it starts with a message Lumiverse sent, system "${main}"`);
  expect(verdict.words.startsWith(`Not as Lumiverse sent it: ${verdict.startWhy}`)).toBe(true);

  // The briefing put in front of the prompt stands where the prompt should start, and is not Lumiverse's.
  const whole = pair("whole");
  const briefing = whole.request[12] as RequestMessage;
  const fronted = compareSent({ ...whole, request: [whole.request[0] as RequestMessage, briefing, ...whole.request.slice(1, 12)] });
  expect(fronted).toMatchObject({ pass: false, opening: true, startsAfterOpening: false, extra: [{ place: 2, role: "system", text: first80(briefing.text) }], missing: [] });
  expect(fronted.startWhy).toBe(`sent 2, system "${first80(briefing.text)}", stands between the opening block and the prompt`);
});

test("over the shipped prompt-frame.md at the build, header and all: framed immediately before the prompt passes, as a system message or RPH's marked note", async () => {
  const frame = await shippedFrame();
  expect(frame.framing.startsWith("---")).toBe(false);
  const input = pair("framed");
  const verdict = compareSent({ ...input, ...frame });
  expect(verdict).toMatchObject({ pass: true, framed: true, startsAfterOpening: true, extra: [], framingAt: [], inOrder: 10 });
  expect(verdict.words).toBe("All 10 messages Lumiverse sent that the window kept are in the Author's first request, in order, with their roles, right after the opening block and its framing line");
  const noted = compareSent({ ...input, ...frame, request: input.request.map((m, j) => (j === 1 ? { role: "user", text: frame.framingNote, block: null } : m)) });
  expect(noted).toMatchObject({ pass: true, framed: true });
  // The file as the chat's view serves it, header and all, is never the text RPH sends.
  const served = readFileSync(join(REPO, "guidance/.prompts/prompt-frame.md"), "utf8");
  expect(compareSent({ ...input, framing: served }).pass).toBe(false);
});

test("the framing line after the prompt fails and is named; one anywhere but immediately before the prompt is never accepted", async () => {
  const frame = await shippedFrame();
  const input = pair("framed");
  const line = input.request[1] as RequestMessage;
  const after = [input.request[0] as RequestMessage, ...input.request.slice(2, 12), line, ...input.request.slice(12)];
  const verdict = compareSent({ ...input, ...frame, request: after });
  expect(verdict.pass).toBe(false);
  expect(verdict.framingAt).toEqual([{ place: 12, role: "system", text: first80(line.text) }]);
  expect(verdict.words).toContain("the framing line, sent 12, is not immediately before the prompt");
});

test("a stored message whose content is not text is named, not compared, and leaves the turn not judged", () => {
  const whole = pair("whole");
  // A message of pictures alone: Lumiverse's content is no text, and RPH keeps it with none.
  const verdict = compareSent({ ...whole, stored: whole.stored.map((m, k) => (k === 9 ? { ...m, content: null } : m)), request: whole.request.map((m, j) => (j === 10 ? { ...m, text: "" } : m)) });
  expect(verdict).toMatchObject({ pass: false, faulty: false, notText: [{ place: 10, role: "system", text: "not text" }] });
  expect(verdict.words).toBe("Not judged: not text: not compared: stored 10 (system)");
});

test("a message in its place with another role fails the turn and is named", () => {
  const whole = pair("whole");
  const verdict = compareSent({ ...whole, request: whole.request.map((m, j) => (j === 10 ? { ...m, role: "user" } : m)) });
  const post = first80(textAt(whole, 9));
  expect(verdict.pass).toBe(false);
  expect(verdict.roles).toEqual([{ stored: { place: 10, role: "system", text: post }, sent: { place: 11, role: "user", text: post } }]);
  expect(verdict).toMatchObject({ missing: [], extra: [], reordered: [] });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: another role: stored 10, system "${post}", sent 11 as user`);
});

test("a message the window left out that the request has all the same fails the turn and is named", () => {
  const window = pair("window");
  const lh3 = textAt(window, 5);
  const verdict = compareSent({ ...window, request: [...window.request.slice(0, 4), { role: "assistant", text: lh3 }, ...window.request.slice(4)] });
  expect(verdict.pass).toBe(false);
  expect(verdict.beyond).toEqual([{ stored: { place: 6, role: "assistant", text: first80(lh3), rows: ["lh-3"] }, sent: { place: 5, role: "assistant", text: first80(lh3) } }]);
  expect(verdict.leftOut.map((m) => m.place)).toEqual([4, 5]);
  expect(verdict).toMatchObject({ missing: [], extra: [], reordered: [] });
  expect(verdict.words).toBe(`Not as Lumiverse sent it: sent though the window left it out: stored 6, assistant "${first80(lh3)}", sent 5`);
});

test("R-95: a window of 4 with a step of 2 holds six, both ends, and at seven is cut back to four", () => {
  expect([4, 5, 6, 7, 8, 9, 10].map((count) => count - windowStart(count, 4, 2))).toEqual([4, 5, 6, 4, 5, 6, 4]);
  const window = pair("window");
  // Six history rows (lh-1 gone): the window of 4 with a step of 2 holds all six, so lh-2 and lh-3 are owed.
  const six = { ...window, rows: window.rows?.filter((r) => r.id !== "lh-1"), stored: window.stored.filter((_, k) => k !== 3) };
  const short = compareSent({ ...six, step: 2 });
  expect(short.missing.map((m) => m.rows)).toEqual([["lh-2"], ["lh-3"]]);
  expect(short.words).toContain("(R-95: a window of 4 with a step of 2 holds it; RPE's window departs from that reading)");
  const held = [...window.request.slice(0, 4), { role: "user", text: textAt(window, 4) }, { role: "assistant", text: textAt(window, 5) }, ...window.request.slice(4)];
  expect(compareSent({ ...six, step: 2, request: held })).toMatchObject({ pass: true, owed: 10 });
  // Seven history rows: cut back to four, so lh-3 is left out as without a step, and sending it fails.
  expect(compareSent({ ...window, step: 2 })).toMatchObject({ pass: true, owed: 8 });
  expect(compareSent({ ...window, step: 2, request: [...window.request.slice(0, 4), { role: "assistant", text: textAt(window, 5) }, ...window.request.slice(4)] }).beyond.map((m) => m.stored.rows)).toEqual([["lh-3"]]);
});

test("with the hold on, the turn is judged only when the story record's reach is given, and then the window reaches back to it, at most the cap", () => {
  const window = pair("window");
  const withOlder = (...older: number[]) => [...window.request.slice(0, 4), ...older.map((k) => ({ role: window.stored[k]?.role ?? "", text: textAt(window, k) })), ...window.request.slice(4)];
  const blind = compareSent({ ...window, hold: 2 });
  expect(blind).toMatchObject({ pass: false, faulty: false });
  expect(blind.words).toBe("Not judged: the hold is on, and no reach of the story record was given for the turn, so which older messages it keeps is not known");
  // The record covers lh-1 and lh-2: lh-3 is not covered, so the hold keeps it.
  expect(compareSent({ ...window, hold: 2, reach: 2 }).missing.map((m) => m.rows)).toEqual([["lh-3"]]);
  expect(compareSent({ ...window, hold: 2, reach: 2, request: withOlder(5) })).toMatchObject({ pass: true, owed: 9 });
  // Covering nothing, the hold reaches back at most its cap of 2: lh-1 stays out.
  expect(compareSent({ ...window, hold: 2, reach: 0, request: withOlder(4, 5) })).toMatchObject({ pass: true, owed: 10 });
  expect(compareSent({ ...window, hold: 2, reach: 0, request: withOlder(3, 4, 5) }).beyond.map((m) => m.stored.rows)).toEqual([["lh-1"]]);
});

test("the row passes only when every RPE turn passes: a failing turn fails it and is named, a turn not judged leaves it unjudged", () => {
  const whole = compareSent(pair("whole"));
  const missing = compareSent(pair("missing"));
  const unread = { turn: "t-03", verdict: null, why: "Lumiverse stored no prompt with message m-03" };

  expect(sentFold([{ turn: "t-01", verdict: whole, why: null }, { turn: "t-02", verdict: whole, why: null }])).toEqual({
    verdict: "pass",
    measured: "2 of 2 RPE turns held every message Lumiverse sent that the window kept, in order, with their roles, right after the opening block",
    notes: [],
    why: [],
  });

  const failed = sentFold([{ turn: "t-01", verdict: whole, why: null }, { turn: "t-02", verdict: missing, why: null }, unread]);
  expect(failed).toEqual({
    verdict: "fail",
    measured: "1 of 3 RPE turns held every message Lumiverse sent that the window kept, in order, with their roles, right after the opening block; 1 could not be judged",
    notes: [`turn t-02: ${missing.words}`, "turn t-03 could not be judged: Lumiverse stored no prompt with message m-03"],
    why: [],
  });

  expect(sentFold([{ turn: "t-01", verdict: whole, why: null }, unread])).toMatchObject({ verdict: "not judged", why: ["1 RPE turn(s): Lumiverse stored no prompt with message m-03"] });
  const held = compareSent({ ...pair("window"), hold: 2 });
  expect(sentFold([{ turn: "t-04", verdict: held, why: null }])).toMatchObject({ verdict: "not judged", why: [`1 RPE turn(s): ${held.unjudged[0]}`] });
  expect(sentFold([])).toEqual({ verdict: "not judged", measured: "no RPE turn to compare", notes: ["the run gave no RPE turn to compare"], why: ["the run gave no RPE turn to compare"] });
});
