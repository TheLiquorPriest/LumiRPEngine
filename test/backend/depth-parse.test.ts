// The bootstrap's parsers through the shared Reading (the raw-against-saved audit's open items,
// BOOTSTRAP-TRIAL.md): someone the historian or the amendment lists twice in one beat's exposure is
// one entry with every way it reached them; the historian's, the amendment's and the catch-up's
// answers tell their keeper each field they didn't keep as written; an answer that isn't JSON is told
// whole, with why it failed, so its keeper keeps it as written, whether its stage fails on it (the
// historian, the amendment, the reconciliation, a play) or goes on without it (a catch-up); a
// walk-on's re-date that says no time past the scene is told before its settlement fails; a person or
// a place an answer spells as an id (jordan_ellis) is the one it names, through the shared resolver.

import { describe, expect, test } from "bun:test";
import { amendBeat, type AmendOut } from "../../src/backend/bootstrap/amend";
import { reconcile } from "../../src/backend/bootstrap/import";
import { catchUp } from "../../src/backend/character-agent";
import { beatLine, DepthAnswerError, nameKey, personNamed, placeNamed, sameName } from "../../src/backend/depth/common";
import { historian } from "../../src/backend/depth/historian";
import { personNamed as mindNamed } from "../../src/backend/minds";
import type { ModelPort, PortAnswer } from "../../src/backend/depth/port";
import { settleRead } from "../../src/backend/depth/offscreen/author";
import { play } from "../../src/backend/depth/scene/play";
import { reporting } from "../../src/backend/depth/scene/reporting";
import { WHOLE_ANSWER, type CallMisread, type Misread } from "../../src/shared/misread";
import { blobHash } from "../../src/shared/stores";
import { beatProblem, type Beat } from "../../src/shared/story";
import { modernUsWorld } from "../packs/riverton";
import { registryOf, startState } from "../packs/support";

const w = modernUsWorld("w", "R");
const s = startState(w);
const CAST = [
  { id: w.pov, name: "Sam" },
  { id: "maya", name: "Maya Chen" },
];
const ROWS = [
  { id: "m1", isUser: true, name: "Sam", text: "I watch Maya at the register.", clock: null, basis: { swipe: "c1" } },
  { id: "m2", isUser: false, name: "Narrator", text: 'Maya slips two twenties from the till. "Not a word," she tells Sam.', clock: null, basis: { swipe: "c2" } },
];

/** A port answering each call with the next text (an object as its JSON), telling `told` each field its stage misread. */
function answering(told: Misread[], ...answers: (unknown | PortAnswer)[]): ModelPort {
  return async () => {
    const next = answers.shift() ?? {};
    const reply: PortAnswer = typeof next === "object" && next !== null && "text" in next ? (next as PortAnswer) : { text: typeof next === "string" ? next : JSON.stringify(next) };
    return { ...reply, misread: (fields) => void told.push(...fields) };
  };
}

const fields = (told: readonly Misread[]): string[] => told.map((m) => m.field);

const OLD: Beat = {
  id: "b-old",
  at: s.clock,
  order: 0,
  place: "cafe",
  actors: ["maya"],
  act: "did",
  about: [],
  what: blobHash("Maya pockets two twenties."),
  surface: blobHash("Maya's hand moves to her apron."),
  exposure: [{ who: w.pov, channel: "sight", reach: "whole" }],
  by: { bootstrap: { message: "m2", swipe: "c2" } },
};

function amending(model: ModelPort): Promise<AmendOut> {
  return amendBeat(model, { world: w, state: s, texts: {}, beat: OLD, blobs: { [OLD.what]: "Maya pockets two twenties.", [OLD.surface]: "Maya's hand moves to her apron." }, message: { id: "m2", name: "Narrator", isUser: false, text: ROWS[1]?.text ?? "" }, note: "She said something to him.", cast: CAST, pov: w.pov, key: "k1" });
}

describe("someone listed twice in one beat's exposure", () => {
  test("the historian merges them, unioning the channels, and the beat reads every way to the author", async () => {
    const told: Misread[] = [];
    const model = answering(told, {
      beats: [{ message: "m2", place: "cafe", actors: ["maya"], act: "said", what: "Maya pockets two twenties and tells Sam to keep quiet.", surface: "Maya at the till, saying not a word.", quotes: "Not a word.", exposure: [{ who: "Sam", channel: "hearing", reach: "whole" }, { who: "maya", channel: "hearing", reach: "whole" }, { who: "Sam", channel: "sight", reach: "partial" }] }],
    });
    const out = await historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast: CAST }, model);
    const b = out.beats[0];
    expect(b?.beat.exposure).toEqual([
      { who: w.pov, channel: "sight", also: ["hearing"], reach: "whole" },
      { who: "maya", channel: "hearing", reach: "whole", pending: true },
    ]);
    expect(beatProblem(b?.beat)).toBeNull();
    expect(b ? beatLine(w, s, b) : "").toContain("Perceived by: Alex Rivera (id: you) by sight and hearing; Maya Chen (id: maya) by hearing.");
    // Kept whole, so nothing of it was misread.
    expect(told).toEqual([]);
  });

  test("so does the amendment", async () => {
    const out = await amending(answering([], { what: "Maya pockets two twenties and tells Sam not a word.", surface: "Maya at the till.", quotes: ["Not a word."], act: "said", actors: ["maya"], exposure: [{ who: "Sam", channel: "sight", reach: "whole" }, { who: "Sam", channel: "hearing", reach: "whole" }], why: "She spoke to him." }));
    expect(out.beat?.exposure).toEqual([
      { who: w.pov, channel: "sight", also: ["hearing"], reach: "whole" },
      { who: "maya", channel: "sight", reach: "whole", pending: true },
    ]);
    expect(beatProblem(out.beat)).toBeNull();
  });
});

describe("the historian's, the amendment's and the catch-up's answers through the shared Reading", () => {
  test("the historian tells its keeper each field it didn't keep as written, and nothing it kept", async () => {
    const told: Misread[] = [];
    const model = answering(told, {
      beats: [
        { message: "m2", place: "cafe", actors: "maya", act: "spoke", what: "Maya pockets two twenties.", surface: "Her hand moves.", quotes: ["Not a word.", "Not one."], span: [0, 900], exposure: [{ who: "Sam", channel: "smell", reach: "whole" }] },
        { message: "m9", what: "Not in the stretch." },
      ],
      newcomers: [{ name: "Stranger in a red cap", note: "waiting" }],
      uncertain: ["The date reads oddly.", 3],
    });
    const out = await historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast: CAST }, model);
    expect(fields(told)).toEqual(["uncertain[1]", "newcomers[0]", "beats[0].span", "beats[0].exposure[0].channel", "beats[0].actors", "beats[0].act", "beats[1]"]);
    expect(told.find((m) => m.field === "beats[0].exposure[0].channel")).toEqual({ field: "beats[0].exposure[0].channel", said: '"smell"', as: '"sight"' });
    expect(told.find((m) => m.field === "beats[1]")?.why).toBe("it names no message of the stretch");
    expect(told.find((m) => m.field === "beats[0].span")).toMatchObject({ said: "[0,900]", as: `[0,${ROWS[1]?.text.length}]` });
    // The list of words was read as written: joined, never misread.
    expect(out.beats[0]?.quotes).toBe("Not a word. Not one.");
    expect(out.beats[0]?.beat.act).toBe("did");
  });

  test("the amendment does", async () => {
    const told: Misread[] = [];
    const out = await amending(answering(told, { what: "Maya pockets two twenties.", surface: "Her hand moves.", act: "spoke", actors: ["maya", "Nobody Atall"], exposure: [{ who: "Sam", channel: "sight", reach: "most" }], why: "As the message has it." }));
    expect(out.beat?.act).toBe("did");
    expect(fields(told)).toEqual(["actors[1]", "exposure[0].reach", "act"]);
    expect(told[0]).toEqual({ field: "actors[1]", said: '"Nobody Atall"', why: "it names no one of the story" });
  });

  test("the catch-up does, and keeps the rest", async () => {
    const told: Misread[] = [];
    const out = await catchUp(answering(told, { memories: [{ lived: ["b1", "b-elsewhere"], about: ["the lighthouse"], text: "Voices behind the door." }], beliefs: ["The door was locked."], people: { maya: 5 }, on_my_mind: "The door." }), { who: "dev", name: "Dev", at: 620, mind: {}, lived: [{ beat: "b1", at: 600, whole: true, text: "Voices behind a door." }] });
    expect(fields(told)).toEqual(["memories[0].lived[1]", "memories[0].about[0]", "beliefs", 'people["maya"]']);
    expect(told[0]?.why).toBe("no beat of its batch");
    // What it kept: the batch lived, its memory, what's on its mind.
    expect(out.events.filter((e) => e.type === "minds.v2.write").length).toBe(2);
  });
});

describe("an answer that isn't JSON", () => {
  test("the historian's fails its stage, told whole with why, and the call keeps it as written", async () => {
    const calls: CallMisread[] = [];
    const notJson = "I can't read this stretch, sorry.";
    const port = reporting(async (): Promise<PortAnswer> => ({ text: notJson, usage: { tokensIn: 10, tokensOut: 9 } }), { call: () => undefined, misread: (_c, m) => void calls.push(m) }, () => 0);
    await expect(historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast: CAST }, port)).rejects.toBeInstanceOf(DepthAnswerError);
    expect(calls).toEqual([{ fields: [{ field: WHOLE_ANSWER, said: JSON.stringify(notJson), why: "the historian's answer wasn't the JSON object it was asked for (9 tokens out; its text ran to 33 characters)" }], count: 1, raw: notJson }]);
  });

  test("the amendment's and the reconciliation's fail, told; a play's too", async () => {
    const told: Misread[] = [];
    await expect(amending(answering(told, "Here is the beat as it was."))).rejects.toBeInstanceOf(DepthAnswerError);
    const entry = { id: "summary:1", source: "summary" as const, role: "memory" as const, title: "Summary", text: "Maya skims the till.", about: [], digest: "d1" };
    await expect(reconcile(answering(told, "They agree."), { chatId: "c1", chapter: 0, final: true, span: [0, 1], entries: [entry], beats: [OLD], blobs: {}, minds: [], basis: { message: "m2", swipe: "c2", parentPath: "p" }, at: s.clock, texts: {} })).rejects.toBeInstanceOf(DepthAnswerError);
    await expect(play(answering(told, "No."), { who: "maya", name: "Maya Chen", at: s.clock, mind: {}, beat: "b2", scene: [], reached: [] })).rejects.toBeInstanceOf(DepthAnswerError);
    expect(told.map((m) => [m.field, m.why?.split(" (")[0]])).toEqual([
      [WHOLE_ANSWER, "the author's answer wasn't the JSON object it was asked for"],
      [WHOLE_ANSWER, "the gm's answer wasn't the JSON object it was asked for"],
      [WHOLE_ANSWER, "the character's answer wasn't the JSON object it was asked for"],
    ]);
  });

  test("the catch-up's lives nothing, its beats left pending, told", async () => {
    const told: Misread[] = [];
    const out = await catchUp(answering(told, "I'd rather not say."), { who: "dev", name: "Dev", at: 620, mind: {}, lived: [{ beat: "b1", at: 600, whole: true, text: "Voices." }] });
    expect(out.events).toEqual([]);
    expect(told).toMatchObject([{ field: WHOLE_ANSWER, said: '"I\'d rather not say."' }]);
  });
});

describe("the author off screen through the shared Reading", () => {
  test("a walk-on's re-date that says no time past the scene fails its settlement, told why", async () => {
    const told: Misread[] = [];
    const settling = settleRead({ world: w, state: s, texts: {}, pov: w.pov, model: answering(told, { verdict: "redate", redate: { in: 0 } }), notebook: { files: {}, pinned: [] }, episode: { id: "e1", span: [600, 660], places: [], people: [], why: "", parts: [] }, summary: "", at: 600, beats: [], effects: [], pins: [], walkOn: { reach: [], now: 620 } });
    await expect(settling).rejects.toBeInstanceOf(DepthAnswerError);
    expect(told).toEqual([{ field: "verdict", said: '"redate"', why: "a re-date that says no time a minute or more past the scene" }]);
  });
});

describe("a person or a place an answer names as a model spells an id (nameKey)", () => {
  // Jordan Ellis beside Jordan Price, as the live turns' answers wrote him: jordan_ellis.
  const price = s.entities.jordan;
  if (!price) throw new Error("the fixture has Jordan Price");
  const st: typeof s = { ...s, entities: { ...s.entities, ellis: { ...price, name: "Jordan Ellis" } } };

  test("the shared resolver reads jordan_ellis as Jordan Ellis and riverside_park as Riverside Park, and no one else", () => {
    expect(nameKey(" Jordan_Ellis ")).toBe("jordan ellis");
    expect(sameName("jordan-ellis", "Jordan Ellis")).toBe(true);
    expect(sameName("", "")).toBe(false);
    expect(personNamed(st, "jordan_ellis")).toBe("ellis");
    expect(personNamed(st, "[Jordan-Ellis]")).toBe("ellis");
    expect(personNamed(st, "jordan")).toBe("jordan");
    expect(personNamed(st, "jordan_smith")).toBeNull();
    expect(placeNamed(w, "riverside_park")).toBe("park");
    expect(placeNamed(w, "[Lake-Erie_marina]")).toBe("lake");
    expect(placeNamed(w, "nowhere_town")).toBeNull();
    // The minds step's own reading (a witness, a plan's company) reads a name the same way.
    expect(mindNamed(registryOf(), w, st, "jordan_ellis")).toBe("ellis");
    expect(mindNamed(registryOf(), w, st, "Maya-Chen")).toBe("maya");
  });

  test("the historian's and the amendment's actors, the reconciliation's actors and who knew, and the catch-up's people file", async () => {
    const told: Misread[] = [];
    const read = await historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast: CAST }, answering(told, { beats: [{ message: "m2", place: "cafe", actors: ["maya_chen"], act: "did", what: "Maya pockets two twenties.", surface: "Her hand moves." }] }));
    expect(read.beats[0]?.beat.actors).toEqual(["maya"]);
    const amended = await amending(answering(told, { what: "Maya pockets two twenties.", surface: "Her hand moves.", act: "did", actors: ["Maya_Chen"], exposure: [], why: "As the message has it." }));
    expect(amended.beat?.actors).toEqual(["maya"]);
    const entry = { id: "summary:1", source: "summary" as const, role: "memory" as const, title: "Summary", text: "Maya skims the till.", about: [], digest: "d1" };
    const rec = await reconcile(answering(told, { recorded: [{ entry: "summary:1", beats: [{ what: "Maya skims the till.", actors: ["maya_chen"], knew: ["Maya-Chen"] }] }] }), { chatId: "c1", chapter: 0, final: true, span: [0, 1], entries: [entry], beats: [OLD], blobs: {}, minds: [{ id: "maya", name: "Maya Chen" }], basis: { message: "m2", swipe: "c2", parentPath: "p" }, at: s.clock, texts: {} });
    expect(rec.events[0]).toMatchObject({ data: { actors: ["maya"], about: [{ entity: "maya" }], exposure: [{ who: "maya", pending: true }] } });
    const caught = await catchUp(answering(told, { people: { maya_chen: "She skims the till." } }), { who: "dev", name: "Dev", at: 620, mind: {}, known: { maya: "Maya Chen" }, lived: [{ beat: "b1", at: 600, whole: true, text: "Voices." }] });
    const written = JSON.stringify(caught.events);
    expect(written).toContain("people/maya.md");
    expect(written).not.toContain("maya_chen");
    expect(fields(told).filter((f) => /actors|knew|people/.test(f))).toEqual([]);
  });
});
