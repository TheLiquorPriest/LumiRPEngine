// The history gate's sixty planted facts and their reader (PlanGates-20; STANDALONE-PLAN §17.3 l.1799).
// Item 1: the facts as data, each answer an invented word or number found in its own line and nowhere
// else, not in the test instance's world, card or book, each line at a place that has left a window of
// 40 by the 300th message. Item 2: the check every package runs on a chat before it asks: a fact also
// inside the window, before its line, in lore or in the card, or with its line missing or hidden fails;
// a later repeat that has also left the window is listed and passes; hidden messages are not counted
// in the window (READINGS R-21). The chats here are invented, built as the data says.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FACTS } from "../../../scripts/proof/history-facts/facts";
import { checkChat, factsFor, GATE_LENGTH, GATE_WINDOW, holds, plantedIn, textOf, type ChatCheck, type ChatMessage, type PlantedFact, type Source } from "../../../scripts/proof/history-facts/reader";
import { isRecord } from "../../../src/shared/json";

const root = join(import.meta.dir, "..", "..", "..");

// The test instance's world starts from this starter (`scripts/testbed/steps/world.ts`).
const starter: unknown = JSON.parse(readFileSync(join(root, "src/packs/starters/modern_slice_of_life.json"), "utf8"));

/** The world's principals other than the player's own character, by name. */
const principals: string[] = Object.entries(isRecord(starter) && isRecord(starter.entities) ? starter.entities : {}).flatMap(([id, thing]) =>
  id !== "pov" && isRecord(thing) && thing.kind === "character" && thing.tier === "principal" && typeof thing.name === "string" ? [thing.name] : [],
);

const first = (name: string): string => name.split(" ")[0];

/** The principals a text names, by first name. */
function named(text: string): string[] {
  return principals.filter((name) => holds(text, first(name)));
}

describe("the facts as data", () => {
  test("sixty facts, twenty to a chat, ten things that happened and ten a principal witnessed in each, every answer its own", () => {
    expect(FACTS).toHaveLength(60);
    for (const chat of ["a", "b", "c"] as const) {
      const facts = factsFor(chat);
      expect(facts).toHaveLength(20);
      expect(facts.filter((fact) => fact.kind === "event")).toHaveLength(10);
      expect(facts.filter((fact) => fact.kind === "witnessed")).toHaveLength(10);
      for (const fact of facts) expect(fact.id.startsWith(`${chat}-`)).toBe(true);
    }
    expect(new Set(FACTS.map((fact) => fact.id)).size).toBe(60);
    expect(new Set(FACTS.map((fact) => fact.answer.toLowerCase())).size).toBe(60);
    for (const fact of FACTS) {
      // One invented name, or a four-digit number that cannot be read as a year turning up in prose by chance.
      const year = /^(19|20)\d\d$/.test(fact.answer);
      expect(/^[A-Z][a-z]{5,}$/.test(fact.answer) || (/^[1-9]\d{3}$/.test(fact.answer) && !year), `${fact.id}: ${fact.answer}`).toBe(true);
    }
  });

  test("every line is the player's and has left a window of 40 by the 300th message; chats a and b share one stretch, so no two of their places meet", () => {
    for (const fact of FACTS) {
      // The card's first message is at index 0, so the player's lines are at odd indices.
      expect(fact.place % 2, fact.id).toBe(1);
      expect(GATE_LENGTH - 1 - fact.place, `${fact.id} at ${fact.place}`).toBeGreaterThanOrEqual(GATE_WINDOW);
    }
    expect(plantedIn("a")).toHaveLength(40);
    expect(new Set(plantedIn("a").map((fact) => fact.place)).size).toBe(40);
    expect(new Set(plantedIn("c").map((fact) => fact.place)).size).toBe(20);
  });

  test("who was there: a witnessed line names its witness and not the principal asked as absent; no line of a thing that happened names a principal", () => {
    expect([...principals].sort()).toEqual(["Dale Whitcomb", "Danny Okafor", "Marcus Delgado", "Priya Nair"]);
    for (const fact of FACTS) {
      if (fact.kind === "event") {
        expect(fact.witness, fact.id).toBeNull();
        expect(fact.absent, fact.id).toBeNull();
        expect(named(fact.line), fact.id).toEqual([]);
        continue;
      }
      if (fact.witness === null || fact.absent === null) throw new Error(`${fact.id} is witnessed by nobody`);
      expect(principals, fact.id).toContain(fact.witness);
      expect(principals, fact.id).toContain(fact.absent.principal);
      expect(fact.absent.principal, fact.id).not.toBe(fact.witness);
      expect(named(fact.line), fact.id).toEqual([fact.witness]);
    }
  });

  test("each question is put as the player asks it, to the witness, to the principal who was not there, or for a thing that happened to nobody, and carries no answer", () => {
    const questions = FACTS.flatMap((fact) => [fact.question, ...(fact.absent ? [fact.absent.question] : [])]);
    expect(questions).toHaveLength(90);
    for (const fact of FACTS) {
      if (fact.witness !== null && fact.absent !== null) {
        expect(fact.question.startsWith(`${first(fact.witness)},`), fact.id).toBe(true);
        expect(fact.absent.question.startsWith(`${first(fact.absent.principal)},`), fact.id).toBe(true);
      } else expect(named(fact.question), fact.id).toEqual([]);
      for (const question of questions) expect(holds(question, fact.answer), `${fact.answer} in "${question}"`).toBe(false);
    }
  });

  test("each answer is in its own line and in no other line of any chat", () => {
    for (const fact of FACTS) {
      expect(holds(fact.line, fact.answer), fact.id).toBe(true);
      for (const other of FACTS) if (other !== fact) expect(holds(other.line, fact.answer), `${fact.answer} in ${other.id}`).toBe(false);
    }
  });

  test("no answer is in the test instance's world, card or book", () => {
    // The card, the book and the world's added parts exist only as the instance's steps write them, before the instance is made.
    const testbed = join(root, "scripts/testbed");
    const steps = readdirSync(testbed, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry): Source => {
        const path = join(entry.parentPath, entry.name);
        return { name: path.slice(root.length + 1), text: readFileSync(path, "utf8") };
      });
    expect(steps.some((step) => step.name.endsWith("steps/chats.ts"))).toBe(true);
    expect(steps.some((step) => step.name.endsWith("steps/book.ts"))).toBe(true);
    const lore: Source[] = [{ name: "the test world's starter", text: textOf(starter) }, ...steps];
    const found = FACTS.flatMap((fact) => lore.filter((source) => holds(source.text, fact.answer)).map((source) => `${fact.answer} in ${source.name}`));
    expect(found).toEqual([]);
  });
});

// ---- Item 2: the reader's check, over chats built as the data says ----

const PLAYER_FILLER = "I get on with the day and keep my eyes open.";
const REPLY_FILLER = "Port Alder goes about its business around you.";

/** A chat of `length` messages: the card's first message at 0, the player's lines at odd indices with `facts` planted at their places, replies between. */
function chatOf(facts: readonly PlantedFact[], length: number, echo = true): ChatMessage[] {
  const at = new Map(facts.map((fact) => [fact.place, fact]));
  return Array.from({ length }, (_, index): ChatMessage => {
    if (index === 0) return { index_in_chat: 0, is_user: false, content: "Monday comes in grey and cool off the lake." };
    if (index % 2 === 1) return { index_in_chat: index, is_user: true, content: at.get(index)?.line ?? PLAYER_FILLER };
    const planted = at.get(index - 1);
    // A model's reply often says again what the player just did.
    return { index_in_chat: index, is_user: false, content: planted && echo ? `${REPLY_FILLER} You think again of ${planted.answer}.` : REPLY_FILLER };
  });
}

const sources: Source[] = [
  { name: "the card", text: textOf({ name: "Port Alder (invented)", description: "The narrator of a small lake town.", first_mes: "Monday comes in grey and cool off the lake." }) },
  { name: "book Port Alder · lore, entry The marina office", text: textOf({ comment: "The marina office", key: ["marina office"], content: "A white shed at the head of the main dock." }) },
];

/** The chat with one message's text, and any other field given, changed. */
function said(messages: ChatMessage[], index: number, content: string, change: Partial<ChatMessage> = {}): ChatMessage[] {
  return messages.map((message) => (message.index_in_chat === index ? { ...message, content, ...change } : message));
}

const fact = (id: string): PlantedFact => {
  const found = FACTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no fact ${id}`);
  return found;
};

/** Every fault of a check, each after its fact's id. */
const faultsOf = (check: ChatCheck): string[] => [...check.faults, ...check.facts.flatMap((each) => each.faults.map((fault) => `${each.fact.id}: ${fault}`))];

describe("the reader", () => {
  test("a chat's twenty by name, in the order of their places; chat a's script plants chat b's twenty too and asks only its own", () => {
    const a = factsFor("a");
    expect(a.every((each) => each.chat === "a")).toBe(true);
    expect(a.map((each) => each.place)).toEqual([...a.map((each) => each.place)].sort((x, y) => x - y));
    const script = plantedIn("a");
    expect(script.filter((each) => each.chat === "b")).toEqual(factsFor("b"));
    expect(plantedIn("b")).toEqual(script);
    expect(plantedIn("c")).toEqual(factsFor("c"));
  });

  test("a chat of 300 made as the data says can be asked: each line stands at its place, with the reply that repeats it as part of the plant", () => {
    const check = checkChat({ chat: "c", messages: chatOf(plantedIn("c"), 300), sources, window: GATE_WINDOW });
    expect(faultsOf(check)).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.windowFrom).toBe(260);
    for (const each of check.facts) {
      expect(each.plant).toEqual([each.fact.place, each.fact.place + 1]);
      expect(each.repeats).toEqual([]);
    }
  });

  test("one fact also in the last 40 messages fails, named with its message; the others still pass", () => {
    const messages = said(chatOf(plantedIn("c"), 300), 280, `${REPLY_FILLER} Someone mutters "${fact("c-05").answer}" on the way past.`);
    const check = checkChat({ chat: "c", messages, sources, window: GATE_WINDOW });
    expect(check.ok).toBe(false);
    expect(faultsOf(check)).toEqual(["c-05: the answer is in message 280, one of the latest 40 messages, which the prompt holds"]);
  });

  test("one fact repeated once in a later message that has also left the window is listed as a repeat and passes", () => {
    const messages = said(chatOf(plantedIn("c"), 300), 200, `${REPLY_FILLER} The name ${fact("c-05").answer} comes back to you.`);
    const check = checkChat({ chat: "c", messages, sources, window: GATE_WINDOW });
    expect(faultsOf(check)).toEqual([]);
    expect(check.facts.find((each) => each.fact.id === "c-05")?.repeats).toEqual([200]);
  });

  test("the window is the chat's own: with 60, a fact whose line or reply is among the latest 60 fails", () => {
    const check = checkChat({ chat: "c", messages: chatOf(plantedIn("c"), 300), sources, window: 60 });
    expect(check.windowFrom).toBe(240);
    // c-19's line, at 239, has left; the reply it got, at 240, repeats it inside the window.
    expect(faultsOf(check)).toEqual([
      "c-19: the answer is in message 240, one of the latest 60 messages, which the prompt holds",
      "c-20: the line that plants it, at index 253, is one of the latest 60 messages, which the prompt holds",
      "c-20: the answer is in message 254, one of the latest 60 messages, which the prompt holds",
    ]);
  });

  test("an answer before its line, in a lore entry, or in the card fails, named", () => {
    const c09 = fact("c-09");
    const before = checkChat({ chat: "c", messages: said(chatOf(plantedIn("c"), 300), 40, `${REPLY_FILLER} A parcel number, ${c09.answer}, on a scrap of paper.`), sources, window: GATE_WINDOW });
    expect(faultsOf(before)).toEqual(["c-09: the answer is in message 40, before the line that plants it"]);

    const entry: Source = { name: "book Port Alder · lore, entry The post office", text: textOf({ comment: "The post office", key: ["post office", c09.answer], content: "Open weekdays until five." }) };
    const inLore = checkChat({ chat: "c", messages: chatOf(plantedIn("c"), 300), sources: [...sources, entry], window: GATE_WINDOW });
    expect(faultsOf(inLore)).toEqual(["c-09: the answer is in book Port Alder · lore, entry The post office"]);

    const card: Source = { name: "the card", text: textOf({ name: "Port Alder (invented)", scenario: `Tracking number ${c09.answer} waits at the post office.` }) };
    const inCard = checkChat({ chat: "c", messages: chatOf(plantedIn("c"), 300), sources: [card], window: GATE_WINDOW });
    expect(faultsOf(inCard)).toEqual(["c-09: the answer is in the card"]);
  });

  test("a line missing, moved or hidden fails: there is no plant to recall", () => {
    const c13 = fact("c-13");
    const missing = checkChat({ chat: "c", messages: said(chatOf(plantedIn("c"), 300), c13.place, PLAYER_FILLER), sources, window: GATE_WINDOW });
    expect(faultsOf(missing)).toContain(`c-13: the message at index ${c13.place} does not hold the line that plants it`);
    expect(missing.ok).toBe(false);

    // A chat that opened without the card's first message: every line sits one index early.
    const shifted = chatOf(plantedIn("c"), 301).slice(1).map((message) => ({ ...message, index_in_chat: message.index_in_chat - 1 }));
    const moved = checkChat({ chat: "c", messages: shifted, sources, window: GATE_WINDOW });
    expect(moved.facts.every((each) => each.faults.includes(`the message at index ${each.fact.place} is not the player's, so the line that plants it is not there`))).toBe(true);

    const hidden = checkChat({ chat: "c", messages: said(chatOf(plantedIn("c"), 300), c13.place, c13.line, { extra: { hidden: true } }), sources, window: GATE_WINDOW });
    expect(faultsOf(hidden)).toEqual([`c-13: the line that plants it, at index ${c13.place}, is hidden, so it was never in a prompt`]);
  });

  test("hidden messages are not in the prompt and do not count toward the window (R-21)", () => {
    const script = chatOf(plantedIn("a"), 300, false);
    expect(faultsOf(checkChat({ chat: "a", messages: script, sources, window: GATE_WINDOW }))).toEqual([]);

    // Three hidden near the end: the window's 40 reach back to 257, where a-20 was planted.
    let hiding = script;
    for (const index of [270, 280, 290]) hiding = said(hiding, index, REPLY_FILLER, { extra: { hidden: true } });
    const reached = checkChat({ chat: "a", messages: hiding, sources, window: GATE_WINDOW });
    expect(reached.windowFrom).toBe(257);
    expect(faultsOf(reached)).toEqual(["a-20: the line that plants it, at index 257, is one of the latest 40 messages, which the prompt holds"]);

    // An answer in a hidden message among the latest is not in the prompt: a repeat, not a fault.
    const a19 = fact("a-19");
    const tucked = checkChat({ chat: "a", messages: said(script, 284, `${REPLY_FILLER} ${a19.answer}.`, { extra: { hidden: true } }), sources, window: GATE_WINDOW });
    expect(faultsOf(tucked)).toEqual([]);
    expect(tucked.facts.find((each) => each.fact.id === "a-19")?.repeats).toEqual([284]);
  });

  test("chat b is asked at its own end: its facts, planted in the stretch it shares with chat a, pass there, and fail if repeated inside that window", () => {
    const carried = chatOf(plantedIn("b"), 520);
    const atEnd = checkChat({ chat: "b", messages: carried, sources, window: GATE_WINDOW });
    expect(faultsOf(atEnd)).toEqual([]);
    expect(atEnd.windowFrom).toBe(480);

    const b20 = fact("b-20");
    const recalled = checkChat({ chat: "b", messages: said(carried, 500, `${REPLY_FILLER} Priya laughs about ${b20.answer} again.`), sources, window: GATE_WINDOW });
    expect(faultsOf(recalled)).toEqual(["b-20: the answer is in message 500, one of the latest 40 messages, which the prompt holds"]);
  });
});
