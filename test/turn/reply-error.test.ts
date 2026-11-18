// A turn that ends with no reply after its progress line went out (plan §10.7): Lumiverse shows the player the line from
// `reply-errors.md` in its notice, and keeps the generation's message with its thinking. The line goes into that thinking too, so the
// kept message says why; but filled with no detail, since the provider's or an error's own words in kept thinking can reach a later
// prompt. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("a provider that fails before the reply: the notice carries the provider's words, the thinking Lumiverse keeps the same line without them", async () => {
  // No retries, so the one failure scripted is the turn's own.
  const b = await openTurnBed({ answers: [{ pieces: [], end: { error: "UPSTREAM-WORDS The gateway at relay-7 answered 502." } }], global: "calls:\n  retries: 0\n" });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toContain("The model's provider failed before a reply was written: ");
  expect(out.error).toContain("UPSTREAM-WORDS");
  const seen = b.host.streams.get(out.generationId!);
  expect(seen?.reasoning).toContain("The model's provider failed before a reply was written.");
  expect(seen?.reasoning).not.toContain("UPSTREAM-WORDS");
  expect(seen?.reasoning).not.toContain("relay-7");
  // The message Lumiverse keeps holds no text and that thinking, the line without the provider's words, and says in its outcome why it ended.
  expect(out.messageId).toBeDefined();
  const kept = b.db.rows("SELECT content, extra FROM messages WHERE id = ?", out.messageId!)[0]!;
  expect(kept.content).toBe("");
  // RPE's log answers why: one line at warn with the turn, the chat and the kind, in the line the player is shown.
  const told = await b.until("the run's end to be told in the log", () => {
    const lines = b.logged.filter((l) => l.level === "warn" && l.message.startsWith("A turn's run ended failed"));
    return lines.length > 0 ? lines : undefined;
  });
  expect(told).toHaveLength(1);
  expect(told[0]!.message).toContain("UPSTREAM-WORDS");
  expect(told[0]!.fields).toMatchObject({ chat: CHAT, kind: "new" });
  const extra = JSON.parse(String(kept.extra)) as { reasoningBySwipe: string[]; generationOutcomeBySwipe: { error: string }[] };
  expect(extra.reasoningBySwipe[0]).toContain("The model's provider failed before a reply was written.");
  expect(extra.reasoningBySwipe[0]).not.toContain("UPSTREAM-WORDS");
  expect(extra.generationOutcomeBySwipe[0]!.error).toContain("UPSTREAM-WORDS");
});

// The Author ends with no reply after `reply-missing`'s one reminder: its plain text, with no reply contract's mark, both times.
const UNMARKED = [{ pieces: [{ text: "The keeper waits by the lamp." }] }, { pieces: [{ text: "The keeper still waits; the tide is in." }] }];

test("the last plain text, when set: it goes to Lumiverse in place of the error line, and the run says the setting sent it", async () => {
  const b = await openTurnBed({ answers: UNMARKED, global: "reply:\n  lastText: true\n" });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toBeNull();
  expect(out.reply?.content).toBe("The keeper still waits; the tide is in.");
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "no-reply", lastText: true, reply: "The keeper still waits; the tide is in." });
  expect(b.model.requests.length).toBe(2);
});

test("the error line by default: a run with no reply after the reminder ends with reply-errors.md's line, and its last text stays RPE's", async () => {
  const b = await openTurnBed({ answers: UNMARKED });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toBe("The Author ended this turn without writing a reply. RPE's Turn page shows what it did.");
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "no-reply", lastText: false, reply: "" });
  expect(run?.error).toMatchObject({ code: "no-reply", text: "The keeper still waits; the tide is in." });
});

test("a run stopped at its call limit ends with what it has: no reply written, the limit's line, and the run says which limit ended it", async () => {
  const b = await openTurnBed({ answers: [{ pieces: [{ text: "<intent>Look first.</intent>" }, { call: "world_query", args: { at: "world" } }] }], global: "limits:\n  turn:\n    calls: 1\n" });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toBe("The turn reached its limit of 1 on calls before a reply was written.");
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "limit", stoppedBy: { limit: { limit: "calls", per: "turn", max: 1 } }, reply: "" });
  expect(b.model.requests.length).toBe(1);
});

test("a run stopped at its call limit with no reply, the last plain text set: the Author's text outside its tags goes out as the reply", async () => {
  const answers = [{ pieces: [{ text: "<intent>Look first.</intent>\nThe keeper turns to the stairs." }, { call: "world_query", args: { at: "world" } }] }];
  const b = await openTurnBed({ answers, global: "limits:\n  turn:\n    calls: 1\nreply:\n  lastText: true\n" });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toBeNull();
  expect(out.reply?.content).toBe("The keeper turns to the stairs.");
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "limit", stoppedBy: { limit: { limit: "calls", per: "turn", max: 1 } }, lastText: true, reply: "The keeper turns to the stairs." });
});
