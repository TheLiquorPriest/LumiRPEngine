// The history gate's planted facts and their reader (PlanGates-20 and PlanGates-20-fix1; STANDALONE-PLAN
// §17.3 l.1799). Item by item: twenty facts in each chat, chat b asking chat a's (R-199); facts of the
// kinds a story is made of; the age a fact keeps; an absent principal who cannot know; one match for the
// check and for grading, in every form a writer uses; each fact at its own moment; the report each
// question needs; and the lows of the landing check. The chats here are invented, made as the data says.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSINGS, FACTS, MIX, RETURNING, type Kind, type PlantedFact } from "../../../scripts/proof/history-facts/facts";
import {
  checkChat,
  factsFor,
  findAnswer,
  grade,
  LAST_PLACE,
  mentions,
  OPTIONS,
  PRINCIPALS,
  textOf,
  type Ask,
  type ChatCheck,
  type ChatMessage,
  type ChatName,
  type CheckInput,
  type Lore,
  type PrincipalId,
} from "../../../scripts/proof/history-facts/reader";
import { isRecord } from "../../../src/shared/json";

const root = join(import.meta.dir, "..", "..", "..");

// The test instance's world starts from this starter (`scripts/testbed/steps/world.ts`).
const starterText = readFileSync(join(root, "src/packs/starters/modern_slice_of_life.json"), "utf8");
const starter: unknown = JSON.parse(starterText);
const records = (value: unknown): Record<string, Record<string, unknown>> =>
  isRecord(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (isRecord(item) ? [[key, item]] : []))) : {};
const entities = records(isRecord(starter) ? starter.entities : undefined);
const places = records(isRecord(starter) ? starter.places : undefined);
const fieldsOf = (id: string): Record<string, unknown> => (isRecord(entities[id]?.fields) ? entities[id].fields : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const fact = (id: string): PlantedFact => {
  const found = FACTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no fact ${id}`);
  return found;
};

// ---- What the starter world ties each principal to (item 4) ----

/** Places a principal works at, lives at, owns, or that its role names. */
function tiedPlaces(id: PrincipalId): Set<string> {
  const fields = fieldsOf(id);
  const out = new Set<string>();
  const employer = text(fields.employer);
  if (places[employer] !== undefined) out.add(employer);
  const home = text(fields.home);
  if (home !== "") out.add(home);
  for (const thing of Object.values(entities)) {
    const f = isRecord(thing.fields) ? thing.fields : {};
    const owners = Array.isArray(f.owners) ? f.owners : [];
    if (!owners.some((owner) => isRecord(owner) && owner.party === id && owner.role === "owner")) continue;
    if (typeof f.place === "string") out.add(f.place);
    if (Array.isArray(f.places)) for (const p of f.places) if (typeof p === "string") out.add(p);
  }
  // A proper name in the role ("Alder Automotive", "Harbor Fest") ties the places whose name or description holds it.
  const role = text(fields.role);
  for (const match of role.matchAll(/(?<=\s)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g)) {
    for (const [placeId, place] of Object.entries(places)) if (`${text(place.name)} ${text(place.description)}`.includes(match[0])) out.add(placeId);
  }
  return out;
}

/** Whether two principals share a workplace or a home. */
function belong(a: PrincipalId, b: PrincipalId): boolean {
  const fa = fieldsOf(a);
  const fb = fieldsOf(b);
  return (text(fa.employer) !== "" && fa.employer === fb.employer) || (text(fa.home) !== "" && fa.home === fb.home && places[text(fa.home)]?.parent !== undefined);
}

// ---- The data's rules (items 2, 3, 4 and 8), as one list of faults per fact ----

const LABEL_FOUND = /\b(?:find|finds|found)\b/i;
const LABEL_WORDS = /\b(?:stamped|stencil(?:l)?ed|engraved|printed|carved|inked|scratched|written on|tag|label)\b/i;
const OPEN_ENDS = /\b(?:later|look (?:it )?up|owes?|owing|tomorrow|next week|someday|one day|come back|be back|stay(?:s|ing)?|for now)\b/i;
const LEAVES = /\bfor good\b|\b(?:drives?|drove|fl(?:y|ies|ew)|sails?|sailed|heads?|headed|goes|went|rides?|rode)\s+(?:back\s+)?home\b|\bleaves?\s+(?:port alder|town|michigan|the lakes?)\b/i;
const SOLITUDE = /\b(?:alone|nobody i know|none of my friends|among strangers|the only customer)\b/i;
/** Proper names of places the lines name outside the starter world, and other capitalised words a line may hold. */
const ELSEWHERE = new Set(["I", "Muskegon", "Wisconsin", "Ontario", "Indiana", "Ohio", "Cornwall", "England", "Lyon", "France", "Chicago", "Toledo", "Michigan", "Holland", "Lansing", "Texas", "Kentucky", "Duluth", "Arizona", "Detroit", "Toronto", "Grand", "Rapids", "Scottish", "New", "Zealand", "Great", "Lakes", "States", "November", "Thursday", "Saturday", "Road", "ATV", "Main", "Street"]);
const PLACE_WORDS = new Set(Object.values(places).flatMap((place) => text(place.name).split(/[^A-Za-z]+/).filter(Boolean)));

function capitalisedUnknown(f: PlantedFact): string[] {
  const allowed = new Set([...ELSEWHERE, ...PLACE_WORDS, ...Object.values(PRINCIPALS).flatMap((p) => [p.first, p.surname]), ...f.strangers.flatMap((s) => s.split(/[^A-Za-z]+/))]);
  if (f.answer.type === "name") allowed.add(f.answer.name);
  const out: string[] = [];
  for (const match of f.line.matchAll(/[A-Za-z]+/g)) {
    const before = f.line.slice(0, match.index).trimEnd();
    const starts = before === "" || /[.!?]$/.test(before);
    if (!starts && /^[A-Z]/.test(match[0]) && !allowed.has(match[0])) out.push(match[0]);
  }
  return out;
}

function factFaults(f: PlantedFact): string[] {
  const out: string[] = [];
  if (f.place % 2 !== 1) out.push(`place ${f.place} is not the player's: the card's first message is 0, so the player's lines are at odd indices`);
  if (f.place > LAST_PLACE) out.push(`place ${f.place} is later than ${LAST_PLACE}, so it or its reply is inside the window when the 300th message asks`);
  if (findAnswer(f.line, f.answer) === null) out.push("its own line does not carry its answer");
  if (LABEL_FOUND.test(f.line) && LABEL_WORDS.test(f.line)) out.push("its answer is a label on an object found");
  const open = OPEN_ENDS.exec(f.line);
  if (open !== null) out.push(`its line leaves something open: "${open[0]}"`);
  if (f.closed !== null) {
    if (!f.line.includes(f.closed.words)) out.push(`its line does not hold its closing words "${f.closed.words}"`);
    if (!CLOSINGS[f.closed.how].test(f.closed.words)) out.push(`"${f.closed.words}" are not words of its closing, ${f.closed.how}`);
  }
  for (const stranger of f.strangers) if (!f.line.includes(stranger)) out.push(`its line does not name "${stranger}" as listed`);
  if (f.strangers.length > 0 && !LEAVES.test(f.line)) out.push("a stranger in its line stays in town");
  for (const word of capitalisedUnknown(f)) out.push(`its line names ${word}, who is neither in the world nor listed as a stranger`);
  const named = (line: string): PrincipalId[] => Object.values(PRINCIPALS).filter((p) => mentions(line, p.id)).map((p) => p.id);
  if (f.half === "event") {
    if (f.witness !== null || f.absent !== null) out.push("a thing that happened has a witness or an absent principal");
    for (const id of named(f.line)) out.push(`its line names ${PRINCIPALS[id].name}, though no principal was there`);
    for (const id of named(f.question)) out.push(`its question names ${PRINCIPALS[id].name}`);
    if (!SOLITUDE.test(f.line)) out.push("its line does not say that no one Jordan knows is there");
    return out;
  }
  if (f.witness === null || f.absent === null) return [...out, "a witnessed fact has no witness or no absent principal"];
  const witness = PRINCIPALS[f.witness];
  const absent = PRINCIPALS[f.absent.principal];
  if (absent.id === witness.id) out.push("its absent principal is its witness");
  for (const id of named(f.line)) if (id !== witness.id) out.push(`its line names ${PRINCIPALS[id].name}, who was not there`);
  if (!mentions(f.line, witness.id)) out.push(`its line does not put ${witness.name} there`);
  if (!f.question.startsWith(`${witness.first},`)) out.push(`its question is not put to ${witness.first}`);
  for (const id of named(f.question)) if (id !== witness.id) out.push(`its question names ${PRINCIPALS[id].name}`);
  if (!f.absent.question.startsWith(`${absent.first},`)) out.push(`its absent question is not put to ${absent.first}`);
  for (const id of named(f.absent.question)) if (id !== absent.id) out.push(`its absent question names ${PRINCIPALS[id].name}`);
  if (f.where !== null && tiedPlaces(absent.id).has(f.where)) out.push(`${absent.name} works at, lives at, owns or is named for ${f.where}, where it happens`);
  if (belong(absent.id, witness.id)) out.push(`${absent.name} shares a workplace or a home with ${witness.name}`);
  return out;
}

// ---- Item 1: twenty facts in each chat ----

describe("item 1: twenty facts in each chat, chat b asking chat a's", () => {
  test("forty facts: chats a and c plant twenty each, chat b's list is chat a's, and no line is planted after message 300", () => {
    expect(FACTS).toHaveLength(40);
    expect(new Set(FACTS.map((f) => f.id)).size).toBe(40);
    expect(factsFor("a").map((f) => f.id)).toEqual(Array.from({ length: 20 }, (_, i) => `a-${String(i + 1).padStart(2, "0")}`));
    expect(factsFor("c").map((f) => f.id)).toEqual(Array.from({ length: 20 }, (_, i) => `c-${String(i + 1).padStart(2, "0")}`));
    expect(factsFor("b")).toEqual(factsFor("a"));
    for (const chat of ["a", "c"] as const) expect(new Set(factsFor(chat).map((f) => f.place)).size).toBe(20);
    for (const f of FACTS) expect(f.place, f.id).toBeLessThan(300);
  });
});

// ---- Item 2: facts of the kinds a story is made of ----

const kindsOf = (facts: readonly PlantedFact[]): Record<Kind, number> => {
  const out: Record<Kind, number> = { act: 0, exchange: 0, name: 0, time: 0, hurt: 0, word: 0 };
  for (const f of facts) out[f.kind]++;
  return out;
};

describe("item 2: facts of the kinds a story is made of", () => {
  test("each half of each chat's twenty holds three acts, two exchanges, two names or places, a time, a hurt and a word given", () => {
    for (const chat of ["a", "c"] as const) {
      for (const half of ["event", "witnessed"] as const) {
        const facts = factsFor(chat).filter((f) => f.half === half);
        expect(facts, `${chat} ${half}`).toHaveLength(10);
        expect(kindsOf(facts), `${chat} ${half}`).toEqual({ ...MIX });
      }
    }
  });

  test("each answer is one invented name of eight letters or more, an amount that is no year, or a time, and they are far enough apart that one letter off finds only its own", () => {
    for (const f of FACTS) {
      if (f.answer.type === "name") expect(/^[A-Z][a-z]{7,}$/.test(f.answer.name), f.id).toBe(true);
      else if (f.answer.type === "amount") expect(Number.isInteger(f.answer.dollars) && f.answer.dollars >= 100 && f.answer.dollars <= 9999 && !/^(19|20)\d\d$/.test(String(f.answer.dollars)), f.id).toBe(true);
      else expect(/^([01]\d|2[0-3]):[0-5]\d$/.test(f.answer.at), f.id).toBe(true);
    }
    const names = FACTS.flatMap((f) => (f.answer.type === "name" ? [{ id: f.id, name: f.answer.name }] : []));
    for (const a of names) for (const b of names) if (a !== b) expect(findAnswer(b.name, { type: "name", name: a.name }), `${a.id} and ${b.id}`).toBeNull();
  });

  test("each answer is in its own line and in no other line, question, the starter world, or any file under scripts/testbed/", () => {
    const testbed = join(root, "scripts/testbed");
    const files = readdirSync(testbed, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.some((file) => file.endsWith("steps/chats.ts")) && files.some((file) => file.endsWith("steps/book.ts"))).toBe(true);
    const sources = [{ name: "the starter world", body: textOf(starter) }, ...files.map((file) => ({ name: file.slice(root.length + 1), body: readFileSync(file, "utf8") }))];
    const found: string[] = [];
    for (const f of FACTS) {
      if (findAnswer(f.line, f.answer) === null) found.push(`${f.id}'s answer is not in its own line`);
      for (const other of FACTS) {
        const texts = [...(other === f ? [] : [other.line]), other.question, ...(other.absent ? [other.absent.question] : [])];
        for (const t of texts) if (findAnswer(t, f.answer) !== null) found.push(`${f.id}'s answer in ${other.id}: ${t}`);
      }
      for (const source of sources) if (findAnswer(source.body, f.answer) !== null) found.push(`${f.id}'s answer in ${source.name}`);
    }
    expect(found).toEqual([]);
  });

  test("no fact is a label on an object found: every line passes, and the old kind of fact fails", () => {
    for (const f of FACTS) expect(factFaults(f).filter((fault) => fault.includes("label")), f.id).toEqual([]);
    const label: PlantedFact = { ...fact("a-01"), line: "Alone in the shop's back room I find an old brass padlock with 2580 stamped on its tag, and I drop it back in the drawer." };
    expect(factFaults(label)).toContain("its answer is a label on an object found");
  });
});

// ---- Item 3: the age a fact keeps ----

describe("item 3: sixteen facts closed off in their own lines, at most four that may come back", () => {
  test("in each chat at most four may come back, one act, one exchange, one name and one word given; every other line holds its closing words", () => {
    for (const chat of ["a", "c"] as const) {
      const returning = factsFor(chat).filter((f) => f.closed === null);
      expect(returning.length, chat).toBeLessThanOrEqual(OPTIONS.mayReturn);
      expect(returning.map((f) => f.kind).sort(), chat).toEqual([...RETURNING].sort());
    }
    for (const f of FACTS) expect(factFaults(f), f.id).toEqual([]);
  });

  test("a closed line that says later, look it up or owes fails, and so does one that leaves a stranger in town or lacks its closing words", () => {
    const a13 = fact("a-13");
    for (const [said, open] of [[" I will look into him later.", "later"], [" I mean to look it up.", "look it up"], [" He still owes the bagger an apology.", "owes"]] as const) {
      expect(factFaults({ ...a13, line: `${a13.line}${said}` })).toContain(`its line leaves something open: "${open}"`);
    }
    const stays = { ...a13, line: a13.line.replace("staggers onto the evening bus and leaves town for good", "rents the room above the hardware store") };
    expect(factFaults(stays)).toContain("a stranger in its line stays in town");
    expect(factFaults(stays)).toContain('its line does not hold its closing words "for good"');
    const unlisted = { ...a13, line: a13.line.replace("a teenage bagger", "a bagger named Ostrell") };
    expect(factFaults(unlisted)).toContain("its line names Ostrell, who is neither in the world nor listed as a stranger");
  });
});

// ---- Item 4: the absent principal cannot know ----

describe("item 4: the absent principal cannot know", () => {
  test("the principals' names are the starter world's: first name, surname and role", () => {
    for (const p of Object.values(PRINCIPALS)) {
      const fields = fieldsOf(p.id);
      expect(text(entities[p.id]?.name)).toBe(p.name);
      expect(`${p.first} ${p.surname}`).toBe(p.name);
      expect(p.roles[0]).toBe(text(fields.role));
      const said = ` ${`${text(fields.role)} ${text(fields.description)}`.toLowerCase().replace(/'s\b/g, "").replace(/[^a-z]+/g, " ")} `;
      for (const role of p.roles) for (const word of role.toLowerCase().replace(/'s\b/g, "").split(/[^a-z]+/).filter((w) => !["of", "the", "at", "and"].includes(w))) expect(said.includes(` ${word} `), `${p.id}: ${role}`).toBe(true);
    }
  });

  test("every witnessed fact's absent principal is named nowhere in its line, works, lives and owns nothing there, and shares no workplace or home with the witness", () => {
    for (const f of FACTS.filter((each) => each.half === "witnessed")) {
      const absent = f.absent === null ? "no absent principal" : PRINCIPALS[f.absent.principal].name;
      expect(factFaults(f).filter((fault) => fault.includes(absent) || fault.includes("absent")), f.id).toEqual([]);
    }
  });

  test("a line naming the absent principal by surname or by role fails, and so does one whose place is the absent principal's workplace", () => {
    const a04 = fact("a-04");
    expect(a04.absent?.principal).toBe("dale_whitcomb");
    expect(factFaults({ ...a04, line: a04.line.replace("Marcus and I", "Marcus, Whitcomb and I") })).toContain("its line names Dale Whitcomb, who was not there");
    expect(factFaults({ ...a04, line: `${a04.line} The marina owner hears it all from his truck.` })).toContain("its line names Dale Whitcomb, who was not there");
    expect(factFaults({ ...a04, where: "alder_harbor_marina" })).toContain("Dale Whitcomb works at, lives at, owns or is named for alder_harbor_marina, where it happens");
    const c04 = fact("c-04");
    expect(factFaults({ ...c04, absent: { principal: "danny_okafor", question: "Danny, do you know how much the trucker paid?" } })).toContain("Danny Okafor works at, lives at, owns or is named for alder_automotive, where it happens");
  });
});

// ---- Chats made as the data says ----

const PLAYER = "I get on with my day and keep my eyes open.";
const REPLY = "Port Alder goes about its business around you.";

/** `length` messages: the card's first message at 0, the player's lines at odd indices with the facts planted at their places, replies between. */
function chatOf(planted: readonly PlantedFact[], length: number): ChatMessage[] {
  const at = new Map(planted.map((f) => [f.place, f]));
  return Array.from({ length }, (_, index): ChatMessage => {
    if (index === 0) return { index_in_chat: 0, is_user: false, content: "Monday comes in grey and cool off the lake." };
    if (index % 2 === 1) return { index_in_chat: index, is_user: true, content: at.get(index)?.line ?? PLAYER };
    return { index_in_chat: index, is_user: false, content: REPLY };
  });
}

/** The chat with one message's text, and any other field given, changed or added. */
function said(messages: readonly ChatMessage[], index: number, content: string, change: Partial<ChatMessage> = {}): ChatMessage[] {
  const known = messages.some((m) => m.index_in_chat === index);
  const out = known ? messages.map((m) => (m.index_in_chat === index ? { ...m, content, ...change } : m)) : [...messages, { index_in_chat: index, is_user: index % 2 === 1, content, ...change }];
  return out.sort((x, y) => x.index_in_chat - y.index_in_chat);
}

const lore: Lore = {
  card: { name: "the card", text: textOf({ name: "Port Alder (invented)", description: "The narrator of a small lake town.", first_mes: "Monday comes in grey and cool off the lake." }) },
  books: [{ name: "book Port Alder lore, entry The marina office", text: textOf({ comment: "The marina office", key: ["marina office"], content: "A white shed at the head of the main dock." }) }],
  world: [{ name: "world lore, entry The Harbor Watch whistle", text: "Three short blasts on the whistle mean a boat is loose." }],
};

const chatFor = (id: string): ChatName => (id.startsWith("c-") ? "c" : "a");
const madeFor = (chat: ChatName, length = 299): ChatMessage[] => chatOf(factsFor(chat), length);

function check(chat: ChatName, messages: readonly ChatMessage[], asks: readonly Ask[], more: Partial<CheckInput> = {}): ChatCheck {
  return checkChat({ chat, messages, window: 40, reasoning: "not replayed", lore, asks, ...more });
}

const ask = (id: string, at = 299, to: Ask["to"] = "question"): Ask => ({ fact: id, to, at });

// ---- Item 5: one match, for the check and for grading ----

/** Each form a writer or a model writes an answer in, with a fact whose answer it is. */
const FORMS: [id: string, written: string][] = [
  ["a-01", "2580"], ["a-01", "2,580"], ["a-01", "2.580"], ["a-01", "2 580"], ["a-01", "2-5-8-0"], ["a-01", "2 5 8 0"], ["a-01", "2.5.8.0"],
  ["a-01", "25-80"], ["a-01", "25 80"], ["a-01", "two five eight oh"], ["a-01", "twenty-five eighty"], ["a-01", "two thousand five hundred and eighty"],
  ["a-01", "twenty-five hundred and eighty"], ["a-01", "MC2580"], ["a-01", "#2580"], ["a-01", "No. 2580"], ["a-01", "$2,580"], ["a-01", "2580km"], ["a-01", "$2,580.00"],
  ["a-09", "8-5-3"], ["a-09", "eight fifty-three"], ["a-09", "eight hundred and fifty-three"],
  ["a-11", "9:17"], ["a-11", "9.17"], ["a-11", "09:17"], ["a-11", "21:17"], ["a-11", "9:17 p.m."], ["a-11", "nine seventeen"], ["a-11", "twenty-one seventeen"], ["a-11", "seventeen minutes past nine"],
  ["c-11", "05:43"], ["c-11", "5.43 in the morning"], ["c-11", "five forty-three"], ["c-11", "seventeen minutes to six"], ["c-10", "3:38:20 in the afternoon"], ["c-10", "15:38"],
  ["a-04", "BRENNQUIST"], ["a-04", "brennquist"], ["a-04", "Brennquist's"], ["a-04", "Brenn-quist"], ["a-04", "Brenn quist"],
  ["a-04", "Brenquist"], ["a-04", "Brennnquist"], ["a-04", "Brennqiust"], ["a-04", "Brennquest"],
];

/** Near misses: one digit off, the other half of the day, two letters off, or another fact's answer. */
const NEAR: [id: string, written: string][] = [
  ["a-01", "2,581"], ["a-01", "2579"], ["a-01", "twenty-five eighty-one"], ["a-01", "$3,160"], ["a-01", "12,580"], ["a-01", "$2,580.50"],
  ["a-09", "$854"], ["a-09", "eight fifty-four"],
  ["a-11", "9:18"], ["a-11", "9:17 a.m."], ["a-11", "nine eighteen"], ["a-11", "11:26"],
  ["c-11", "5:43 p.m."], ["c-11", "17:43"], ["c-10", "version 3.38.0"], ["c-10", "release 1.3.38"],
  ["a-04", "Bremquast"], ["a-04", "Sorvenna"],
];

describe("item 5: one match finds the answer in every form, for the check and for grading", () => {
  test("each form, found inside the window, fails the check; carried in a reply, it is graded right", () => {
    for (const [id, written] of FORMS) {
      const f = fact(id);
      expect(grade(`It was ${written}, as I remember it.`, f).right, `${id} graded: ${written}`).toBe(true);
      const result = check(chatFor(id), said(madeFor(chatFor(id)), 280, `${REPLY} ${written}.`), [ask(id)]);
      expect(result.asks[0].faults, `${id} in the window: ${written}`).toContain("the answer is in message 280, inside the window of the latest 40 messages");
      expect(result.whole).toBe(false);
    }
  });

  test("a near miss is graded wrong and does not fail the check", () => {
    for (const [id, written] of NEAR) {
      expect(grade(`It was ${written}, as I remember it.`, fact(id)), `${id}: ${written}`).toEqual({ right: false, form: null });
      const result = check(chatFor(id), said(madeFor(chatFor(id)), 280, `${REPLY} ${written}.`), [ask(id)]);
      expect(result.asks[0].faults, `${id}: ${written}`).toEqual([]);
    }
  });
});

// ---- Item 6: each fact at its own moment ----

describe("item 6: each fact at its own moment", () => {
  test("three facts asked in a row with right answers are all three whole, each read up to its own question", () => {
    let messages = madeFor("c");
    const asked: [string, string][] = [["c-01", "Her name was Stavrinelle."], ["c-03", "The locksmith charged you $381."], ["c-05", "The rangers called it Qorrindale."]];
    asked.forEach(([id, answer], n) => {
      messages = said(messages, 299 + 2 * n, fact(id).question);
      messages = said(messages, 300 + 2 * n, answer);
    });
    const result = check("c", messages, asked.map(([id], n) => ask(id, 299 + 2 * n)));
    expect(result.asks.map((a) => [a.fact.id, a.whole, a.askable])).toEqual([["c-01", true, true], ["c-03", true, true], ["c-05", true, true]]);
    expect(result.whole).toBe(true);
    // Read after its right answer instead, the first fact is no longer whole.
    expect(check("c", messages, [ask("c-01", 305)]).asks[0].faults).toEqual(["the answer is in message 300, inside the window of the latest 40 messages"]);
  });
});

// ---- Item 7: the report each question needs ----

describe("item 7: the report says, fact by fact, whether it can be asked and why", () => {
  test("a fact repeated one message outside the window can be asked in chat a and not in chat b, where it is not the far past", () => {
    const a19 = fact("a-19");
    const inA = check("a", said(madeFor("a"), 258, `${REPLY} You think of Evvenrith again.`), [ask("a-19")]).asks[0];
    expect([inA.whole, inA.askable, inA.last, inA.reply, inA.outside, inA.windowFrom]).toEqual([true, true, { index: 258, form: "as written" }, 259, { statement: 2, reply: 1 }, 260]);
    expect(inA.repeats).toEqual([{ index: 258, hidden: false }]);
    expect(inA.line).toContain("last stated in message 258 (as written), 2 outside the window, its reply message 259, 1 outside");
    expect(inA.line.endsWith("can be asked.")).toBe(true);

    const carried = said(madeFor("b", 519), 478, `${REPLY} You think of Evvenrith again.`);
    const story = [{ part: "chapter", from: 0, to: 300 }, { part: "scene", from: 301, to: 470 }, { part: "beats", from: 471, to: 479 }] as const;
    const inB = check("b", carried, [{ ...ask("a-19", 519), reach: { plain: null, story } }, { ...ask("a-17", 519), reach: { plain: null, story } }]).asks;
    expect([inB[0].whole, inB[0].askable, inB[0].story]).toEqual([true, false, "beats"]);
    expect(inB[0].holds).toEqual(["its last statement, message 478, lies in the story so far's beats (471-479), not its far past"]);
    expect(inB[0].line).toContain(`${a19.id} (its question, at 519)`);
    expect(inB[0].line).toContain("cannot be asked: its last statement, message 478, lies in the story so far's beats (471-479), not its far past.");
    expect([inB[1].askable, inB[1].story, inB[1].last?.index]).toEqual([true, "chapter", 215]);
    expect(check("b", carried, [ask("a-17", 519)]).asks[0].holds).toEqual(["chat b's story so far was not given, so its far past cannot be told"]);
  });

  test("a fact repeated to its absent principal, by name or on stage, cannot be asked for that question, and its own question still can", () => {
    const named = said(madeFor("a"), 150, `${REPLY} Over coffee you tell Dale all about Brennquist.`);
    const [own, absent] = check("a", named, [ask("a-04"), ask("a-04", 299, "absent")]).asks;
    expect([own.askable, own.heard]).toEqual([true, [150]]);
    expect([absent.whole, absent.askable]).toEqual([true, false]);
    expect(absent.line).toContain("a-04 (asked of Dale, who was not there, at 299); planted at 45;");
    expect(absent.line).toContain("cannot be asked: its absent principal, Dale, has heard it: message 150.");

    const onStage = said(madeFor("a"), 160, `${REPLY} The talk turns to Brennquist.`);
    const stage = [{ from: 158, to: 162, on: ["dale_whitcomb"] as PrincipalId[] }];
    expect(check("a", onStage, [ask("a-04", 299, "absent")], { stage }).asks[0].holds).toEqual(["its absent principal, Dale, has heard it: message 160"]);
    expect(check("a", onStage, [ask("a-04", 299, "absent")]).asks[0].askable).toBe(true);
  });

  test("each line names the summaries' reach from the ranges given, or says they were not recorded", () => {
    const [covered, missed, unrecorded] = check("a", madeFor("a"), [
      { ...ask("a-04"), reach: { plain: { from: 0, to: 120 }, story: [{ part: "scene", from: 30, to: 60 }] } },
      { ...ask("a-19"), reach: { plain: { from: 0, to: 120 }, story: [{ part: "scene", from: 30, to: 60 }] } },
      ask("a-10"),
    ]).asks;
    expect([covered.plain, covered.story, missed.plain, missed.story, unrecorded.plain, unrecorded.story]).toEqual(["covers it", "scene", "does not cover it", "in no part", "not recorded", "not given"]);
    expect(covered.line).toContain("Lumiverse's summary: covers it; story so far: scene");
  });
});

// ---- Item 8: the lows of the landing check ----

describe("item 8: the lows of the landing check", () => {
  test("no place is later than 258, so a line and its reply both stand outside the window the 300th message asks with", () => {
    expect(LAST_PLACE).toBe(258);
    for (const f of FACTS) expect(f.place, f.id).toBeLessThanOrEqual(LAST_PLACE);
    expect(factFaults({ ...fact("a-20"), place: 259 })).toContain("place 259 is later than 258, so it or its reply is inside the window when the 300th message asks");
    // A statement at 259 has left the window, but its reply at 260 is the oldest message the window holds.
    const edge = check("a", said(madeFor("a"), 259, "I keep thinking of Evvenrith."), [ask("a-19")]).asks[0];
    expect([edge.whole, edge.askable, edge.outside, edge.holds]).toEqual([true, false, { statement: 1, reply: 0 }, ["the reply to its last statement, message 260, is still inside the window"]]);
  });

  test("two messages at one index are a fault, and the match ignores case", () => {
    const twice = [...madeFor("a"), { index_in_chat: 280, is_user: false, content: REPLY }];
    expect(check("a", twice, [ask("a-04")]).faults).toEqual(["two messages are at index 280"]);
    expect(check("a", twice, [ask("a-04")]).whole).toBe(false);
    expect(check("a", said(madeFor("a"), 280, "bReNnQuIsT"), [ask("a-04")]).asks[0].faults).toEqual(["the answer is in message 280, inside the window of the latest 40 messages"]);
  });

  test("the check refuses to run without the card or the world's lore, and names the sources it read", () => {
    expect(() => check("a", madeFor("a"), [ask("a-04")], { lore: { ...lore, card: { name: "the card", text: " " } } })).toThrow("The check needs the card");
    expect(() => check("a", madeFor("a"), [ask("a-04")], { lore: { ...lore, world: [] } })).toThrow("The check needs the world's own lore");
    expect(check("a", madeFor("a"), [ask("a-04")]).read.sources).toEqual(["the card", "book Port Alder lore, entry The marina office", "world lore, entry The Harbor Watch whistle"]);
  });

  test("it reads a player's regex appendix and, where the connection replays it, a reply's stored reasoning, and names the fields it read", () => {
    const appendix = said(madeFor("a"), 281, PLAYER, { extra: { associative_regex_append: [{ content: "A note: Brennquist." }] } });
    expect(check("a", appendix, [ask("a-04")]).asks[0].faults).toEqual(["the answer is in message 281, inside the window of the latest 40 messages"]);
    for (const carrier of [{ type: "reasoning_content", content: "They mean Brennquist." }, { type: "thinking_blocks", blocks: [{ type: "thinking", thinking: "Brennquist, the trucker.", signature: "x" }] }]) {
      const reasoned = said(madeFor("a"), 282, REPLY, { extra: { reasoningCarrier: carrier } });
      const replayed = check("a", reasoned, [ask("a-04")], { reasoning: "replayed" });
      expect(replayed.asks[0].faults).toEqual(["the answer is in message 282, inside the window of the latest 40 messages"]);
      expect(replayed.read.fields).toContain("extra.reasoningCarrier (the model's turns, which this connection replays)");
      const kept = check("a", reasoned, [ask("a-04")]);
      expect(kept.asks[0].faults).toEqual([]);
      expect(kept.read.fields).toEqual(["content", "extra.associative_regex_append (the player's turns)", "not extra.reasoningCarrier (this connection does not replay it)"]);
    }
  });

  test("the card, an attached book and the world's lore count as lore; lore written in play is the record, listed and never a fault", () => {
    const book = { name: "book Port Alder lore, entry The county road", text: "Truckers like Brennquist take County Road 12." };
    expect(check("a", madeFor("a"), [ask("a-04")], { lore: { ...lore, books: [book] } }).asks[0].faults).toEqual(["the answer is in book Port Alder lore, entry The county road"]);
    const played = { name: "world lore written in play, entry The overturned rig", text: "A trucker named Brennquist was pulled from his rig." };
    const result = check("a", madeFor("a"), [ask("a-04")], { lore: { ...lore, played: [played] } });
    expect([result.asks[0].faults, result.asks[0].played, result.asks[0].askable]).toEqual([[], [played.name], true]);
    expect(result.read.sources).toContain(`${played.name} (written in play: listed, not counted)`);
  });

  test("a chat made as the data says can be asked every fact, chat by chat, and a hidden or missing line cannot", () => {
    for (const chat of ["a", "c"] as const) {
      const result = check(chat, madeFor(chat), factsFor(chat).map((f) => ask(f.id)));
      expect(result.asks.filter((a) => !a.askable).map((a) => a.line)).toEqual([]);
      expect(result.asks.every((a) => a.windowFrom === 260)).toBe(true);
    }
    const c13 = fact("c-13");
    const hiddenLine = said(madeFor("c"), c13.place, c13.line, { extra: { hidden: true } });
    expect(check("c", hiddenLine, [ask("c-13")]).asks[0].faults).toEqual([`the line that plants it, at index ${c13.place}, is hidden, so it was never in a prompt`]);
    expect(check("c", said(madeFor("c"), c13.place, PLAYER), [ask("c-13")]).asks[0].faults).toEqual([`the message at index ${c13.place} does not hold the line that plants it`]);
    // Hidden messages near the end do not count toward the window (R-21): three hidden reach it back to 257.
    let hiding = madeFor("a");
    for (const index of [270, 280, 290]) hiding = said(hiding, index, REPLY, { extra: { hidden: true } });
    const reached = check("a", hiding, [ask("a-20")]).asks[0];
    expect([reached.windowFrom, reached.faults]).toEqual([257, []]);
    expect(reached.holds).toEqual([]);
    expect(check("a", hiding, [ask("a-20")], { window: 42 }).asks[0].faults).toEqual(["the line that plants it, message 255, is inside the window of the latest 42 messages"]);
  });
});
