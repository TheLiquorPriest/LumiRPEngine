// How a beat reaches a mind (DEPTH-PLAN §4.2, §4.4): the point-of-view render is given, per person
// of the moment, exactly how its perceiver may name them, and a point of view that names someone who
// wasn't there by a name its perceiver knows is refused and redrafted once; an actor lives its own act
// as its own, as its deed has it where the beat has one (whatever its surface says, and from no one
// else's side), a message's sender lives sending it with no place, and its recipient lives only the
// message and that it came; the historian asks for each beat's deed beside a surface from no one's
// side, and makes every actor, the player character included, a perceiver of its own act.

import { describe, expect, test } from "bun:test";
import { catchUp, fellBackLine, povFallback, povRender, unseenNames } from "../../src/backend/character-agent";
import { livedPovs, povRefs } from "../../src/backend/character-engine";
import type { ModelPort, PortMessage } from "../../src/backend/depth/port";
import { historian } from "../../src/backend/depth/historian";
import { livedCorpus, mindLivedEvent, mindV2At, needsPov, pendingFor, presentAt, reachOf } from "../../src/shared/character-engine";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { Misread } from "../../src/shared/misread";
import type { Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import type { WorldDoc } from "../../src/shared/world";
import mindsPack from "../../src/packs/minds/core/index";
import { baseWorld, fold, registryOf, startState } from "../packs/support";

const JORDAN = "pov";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const JESS = "jess_kowalczyk";
const DALE = "dale_whitcomb";
const HELEN = "helen_kowalczyk";
const MARCUS = "marcus_delgado";

/** Port Alder's people in a small world: Priya knows Danny and Jess; Dale, at the marina, is a stranger to her. */
const person = (id: string, name: string, place: string, knows: string[] = []): WorldDoc["entities"][string] => ({ id, kind: "person", name, tier: "principal", fields: { place, home: place }, relations: knows.map((to) => ({ type: "knows", to })) });
const world = baseWorld({
  pov: JORDAN,
  entities: {
    [JORDAN]: person(JORDAN, "Jordan Ellis", "home"),
    [DANNY]: person(DANNY, "Danny Okafor", "cafe", [PRIYA]),
    [PRIYA]: person(PRIYA, "Priya Nair", "town", [DANNY, JESS]),
    [JESS]: person(JESS, "Jess Kowalczyk", "home"),
    [DALE]: person(DALE, "Dale Whitcomb", "cafe"),
  },
});
const reg = registryOf([mindsPack]);
const state = startState(world, reg);

/** A port answering each call with the next answer, keeping what it was sent. */
function port(...answers: unknown[]): ModelPort & { sent: { role: string; messages: PortMessage[] }[] } {
  const sent: { role: string; messages: PortMessage[] }[] = [];
  const fn = (async (role, messages) => {
    sent.push({ role, messages: messages.map((m) => ({ ...m })) });
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: typeof sent };
  fn.sent = sent;
  return fn;
}
const asked = (p: { sent: { messages: PortMessage[] }[] }, i: number): string => (p.sent[i]?.messages ?? []).map((m) => m.content).join("\n");

describe("the point-of-view render names each person only as its perceiver may", () => {
  // Dale, a stranger to her, and Priya act at once; the floorboard and his face reach her in part.
  const moment = { id: "b1", surface: "A floorboard creaks behind him; her eyes move from his face to the keys on the counter.", actors: [DALE, PRIYA], about: [], exposure: [{ who: PRIYA, channel: "sight" as const, reach: "partial" as const }] };
  const staging = [{ who: DALE, where: "behind the counter", doing: "counting keys" }];
  const refs = povRefs({ registry: reg }, { state, world }, [PRIYA], [...presentAt(moment), ...staging.map((s) => s.who)]);

  test("each person of the moment comes with how she may name them: the people she knows who weren't there never reach the render", async () => {
    expect(refs[PRIYA]).toMatchObject({ self: "Priya Nair", present: { [DALE]: null }, absent: ["Danny Okafor", "Jess Kowalczyk"], strangers: ["Dale Whitcomb"] });
    const model = port({ povs: { [PRIYA]: "A floorboard creaks behind the man at the counter; your eyes go from his face to the keys." } });
    const r = await povRender(model, { beat: moment, staging, who: [PRIYA], refs });
    expect(r).toMatchObject({ povs: { [PRIYA]: "A floorboard creaks behind the man at the counter; your eyes go from his face to the keys." }, fellBack: {} });
    expect(model.sent.length).toBe(1);
    const sent = asked(model, 0);
    expect(sent).toContain(`### ${PRIYA}: by sight; in part; their own act`);
    expect(sent).toContain(`- ${PRIYA}: you`);
    expect(sent).toContain(`- ${DALE}: no name (someone they don't know)`);
    for (const never of ["Danny", "Jess", "Dale Whitcomb", "Priya Nair"]) expect(sent).not.toContain(never);
  });

  test("a point of view that puts the name of someone she knows, who wasn't there, on the man there is refused and redrafted once", async () => {
    const model = port({ povs: { [PRIYA]: "A floorboard creaks behind Jess; your eyes go from Jess's face to the keys." } }, { povs: { [PRIYA]: "A floorboard creaks behind the man at the counter; your eyes go from his face to the keys." } });
    const r = await povRender(model, { beat: moment, staging, who: [PRIYA], refs });
    expect(r.povs[PRIYA]).toBe("A floorboard creaks behind the man at the counter; your eyes go from his face to the keys.");
    expect(r.fellBack).toEqual({});
    // The redraft is asked with what it wrote and the name it can't use there.
    expect(model.sent.length).toBe(2);
    expect(model.sent[1]?.messages.at(-2)?.content).toContain("behind Jess");
    expect(model.sent[1]?.messages.at(-1)?.content).toContain(`- ${PRIYA}: Jess Kowalczyk`);
  });

  test("a name inside the exact words stands", async () => {
    const said = { ...moment, quotes: "Tell Jess I'm coming." };
    const words = port({ povs: { [PRIYA]: "Half a sentence through the door: “Tell Jess…”" } });
    expect(await povRender(words, { beat: said, staging, who: [PRIYA], refs })).toMatchObject({ povs: { [PRIYA]: "Half a sentence through the door: “Tell Jess…”" }, fellBack: {} });
    expect(words.sent.length).toBe(1);
  });
});

describe("a point of view is never lost: one refused or unwritten twice falls back to a plain one with no name it may not use (conformance finding 7)", () => {
  const partial = { id: "b1", surface: "A floorboard creaks behind him; her eyes move from his face to the keys on the counter.", actors: [DALE, PRIYA], about: [], exposure: [{ who: PRIYA, channel: "sight" as const, reach: "partial" as const }] };
  const staging = [{ who: DALE, where: "behind the counter", doing: "counting keys" }];
  const refs = povRefs({ registry: reg }, { state, world }, [PRIYA], [...presentAt(partial), ...staging.map((s) => s.who)]);

  test("still naming someone who wasn't there after its redraft, a reach in part gets only that something reached her, by what way, and is said", async () => {
    const twice = port({ povs: { [PRIYA]: "Danny is behind the counter." } }, { povs: { [PRIYA]: "Danny Okafor is behind the counter." } });
    const r = await povRender(twice, { beat: partial, staging, who: [PRIYA], refs });
    expect(r.povs).toEqual({ [PRIYA]: "Something reached you by sight, only in part." });
    expect(r.fellBack).toEqual({ [PRIYA]: ["Danny Okafor"] });
    expect(twice.sent.length).toBe(2);
    expect(fellBackLine("Priya", "beat b1", r.fellBack[PRIYA] ?? [])).toBe("The point of view for Priya of beat b1 named someone who wasn't there (Danny Okafor), and again when redrafted: in its place Priya gets a plain one that names no one they may not name.");
  });

  test("one the answer left out is asked for again in the same call, and still missing, falls back", async () => {
    const none = port({ povs: {} }, { povs: {} });
    const r = await povRender(none, { beat: partial, staging, who: [PRIYA], refs });
    expect(r.povs).toEqual({ [PRIYA]: "Something reached you by sight, only in part." });
    expect(r.fellBack).toEqual({ [PRIYA]: [] });
    expect(none.sent.length).toBe(2);
    expect(none.sent[1]?.messages.at(-1)?.content).toContain(`Your answer has no point of view for these people:\n- ${PRIYA}`);
    // Written the second time, it is hers.
    const late = port({ povs: {} }, { povs: { [PRIYA]: "A floorboard creaks; your eyes go to the keys." } });
    expect(await povRender(late, { beat: partial, staging, who: [PRIYA], refs })).toMatchObject({ povs: { [PRIYA]: "A floorboard creaks; your eyes go to the keys." }, fellBack: {} });
  });

  test("a whole reach with a stranger in it falls back to what was there to sense with him told as someone, his name said aloud kept; a message, to only that one came", async () => {
    const whole = { id: "b2", surface: "Dale Whitcomb sets the keys on the counter. “Dale's the name,” he says, and Whitcomb's grin widens.", actors: [DALE], about: [{ entity: DALE }], exposure: [{ who: PRIYA, channel: "sight" as const, reach: "whole" as const }] };
    const twice = port({ povs: { [PRIYA]: "Danny sets the keys down." } }, { povs: { [PRIYA]: "Danny sets the keys down." } });
    const r = await povRender(twice, { beat: whole, staging, who: [PRIYA], refs });
    expect(r.povs[PRIYA]).toBe("Someone sets the keys on the counter. “Dale's the name,” he says, and someone's grin widens.");
    const message = { id: "b3", surface: "A text lands on Priya's phone.", actors: [DALE], about: [], exposure: [{ who: PRIYA, channel: "message" as const, reach: "whole" as const }] };
    expect(povFallback({ beat: message, refs }, PRIYA)).toBe("A message reached you.");
  });
});

describe("the name filter counts only a name that can only be someone who wasn't there", () => {
  const refs = { self: "Priya Nair", present: { [DALE]: null }, absent: ["Danny Okafor", "Rosa Alder", "Jess Whitcomb"], strangers: ["Dale Whitcomb"], world: ["Port Alder", "Harbor Street"] };
  const beat = { surface: "A boat painted DANNY rocks at the slip; the man at the counter looks up." };

  test("a word of the world's names or of someone there's, or one what was there to sense holds in any case, doesn't count alone", () => {
    expect(unseenNames("You pass the Alder ferry sign; the Danny rocks at the slip.", refs, beat)).toEqual([]);
    expect(unseenNames("Whitcomb is stitched on the man's jacket.", refs, beat)).toEqual([]);
  });

  test("a whole name, or a word of it no one there or nothing in the world shares, still does", () => {
    expect(unseenNames("Rosa Alder waves from the door.", refs, beat)).toEqual(["Rosa Alder"]);
    expect(unseenNames("Jess is at the counter.", refs, beat)).toEqual(["Jess Whitcomb"]);
    expect(unseenNames("Okafor is at the counter.", refs, beat)).toEqual(["Danny Okafor"]);
  });
});

describe("a point of view tells only its beat: what each perceiver could sense of the staging, never as acts, and an actor's own deed only to itself (LIVE3 L3a-7)", () => {
  const boots = {
    id: "b4",
    surface: "From under the front of the van, boots and shins stick out; a wrench clinks.",
    deed: "You work the axle nut loose under the van.",
    actors: [JORDAN],
    about: [],
    exposure: [
      { who: JORDAN, channel: "sight" as const, reach: "whole" as const },
      { who: DANNY, channel: "sight" as const, reach: "partial" as const },
      { who: JESS, channel: "hearing" as const, reach: "partial" as const },
      { who: PRIYA, channel: "message" as const, reach: "whole" as const },
    ],
  };
  const staging = [
    { who: JORDAN, where: "under the van", doing: "working on the axle" },
    { who: DANNY, where: "at the front door", doing: "answering over his shoulder; then shouldering the front door open" },
    { who: JESS, where: "behind her chained door in 1A", doing: "listening", occluded: "the chained door" },
  ];
  const who = [JORDAN, DANNY, JESS, PRIYA];
  const refs = povRefs({ registry: reg }, { state, world }, who, [...presentAt(boots), ...staging.map((s) => s.who)]);

  test("each perceiver's part holds only what its senses reached of where everyone was, and the deed only the actor's", async () => {
    const model = port({ povs: Object.fromEntries(who.map((w) => [w, "Boots under the van; a wrench clinks."])) });
    await povRender(model, { beat: boots, staging, who, refs });
    const sent = asked(model, 0);
    const part = (id: string): string => sent.split("\n### ").find((s) => s.startsWith(`${id}:`)) ?? "";
    // Where everyone was is no longer one list the whole call reads.
    expect(sent).not.toContain("## Where everyone was");
    // The actor: its own act, as it did it, with everyone's place and doing.
    expect(part(JORDAN)).toContain("What they did and said, as they did it: You work the axle nut loose under the van.");
    // By sight: where each was and what they were doing, as the moment began.
    expect(part(DANNY)).toContain(`- ${JORDAN}: under the van; working on the axle`);
    expect(part(DANNY)).not.toContain("axle nut");
    // By hearing alone, behind a door: her own place and what blocked her, and only where the others were.
    expect(part(JESS)).toContain(`- ${JESS}: behind her chained door in 1A; listening; blocked: the chained door`);
    expect(part(JESS)).toContain(`- ${DANNY}: at the front door`);
    expect(part(JESS)).not.toContain("shouldering");
    expect(part(JESS)).not.toContain("working on the axle");
    // By message, elsewhere: nothing of anyone's staging.
    expect(part(PRIYA)).not.toContain("What they could sense of where everyone was");
    for (const id of [DANNY, JESS, PRIYA]) expect(part(id)).not.toContain("What they did and said");
    // The render is told staging is where things stood, never what anyone did.
    expect(model.sent[0]?.messages[0]?.content).toContain("never what anyone did: tell no act from it, theirs or anyone's");
  });
});

describe("an actor lives its own act as its own, and a message's recipient only the message", () => {
  const T = {
    text: "TEXT-SURFACE: Danny thumbs a message in his truck at the cafe's curb, the engine idling.",
    words: "Running late. Save me a seat.",
    textWhat: "TEXT-TRUTH: Danny texts Priya that he is late.",
    walk: "WALK-SURFACE: a woman crosses the wet gravel barefoot and lays a warm hand on a man's jaw.",
    walkWhat: "WALK-TRUTH: Priya crosses to Danny and touches his jaw.",
    inside: "WALK-INSIDE: you cross the wet gravel barefoot and lay your hand on the stranger's jaw.",
    note: "NOTE-SURFACE: a folded note changes hands across the counter.",
  };
  const blobs = new Map([...Object.values(T)].map((t) => [blobHash(t), t]));
  const store = { get: async (_u: string, hash: string) => blobs.get(hash) ?? null };
  const beat = (id: string, at: number, actors: string[], surface: string, what: string, exposure: Beat["exposure"], quotes?: string): Beat => ({ id, at, order: 1, place: "cafe", actors, act: "did", about: [], what: blobHash(what), surface: blobHash(surface), ...(quotes ? { quotes: blobHash(quotes) } : {}), exposure, by: { turn: "t1", decided: "author" } });
  const chain = [
    // Danny texts Priya, who is elsewhere: the message reaches her, never his truck.
    beat("text", 600, [DANNY], T.text, T.textWhat, [{ who: DANNY, channel: "sight", reach: "whole" }, { who: PRIYA, channel: "message", reach: "whole" }], T.words),
    // Priya's own act, which those there saw: she lives it as hers.
    beat("walk", 610, [PRIYA], T.walk, T.walkWhat, [{ who: PRIYA, channel: "sight", reach: "whole" }, { who: DANNY, channel: "sight", reach: "whole" }]),
    // Her own act with Dale, a stranger: her own point of view, from the inside.
    beat("withDale", 620, [PRIYA], T.walk, T.walkWhat, [{ who: PRIYA, channel: "sight", reach: "whole", pov: blobHash(T.inside) }]),
    // A message whose words weren't kept and no point of view written: nothing of it can be lived yet.
    beat("note", 630, [JESS], T.note, T.note, [{ who: PRIYA, channel: "message", reach: "whole" }]),
  ];

  test("the reach: her own act as its text or from the inside; the message as its words, from whom, never where it was sent from; its sender with no place", () => {
    expect(reachOf(chain[0] as Beat, PRIYA)).toEqual({ beat: "text", at: 600, channel: "message", whole: true, as: "message", from: [DANNY], text: blobHash(T.words) });
    expect(reachOf(chain[0] as Beat, DANNY)).toMatchObject({ as: "act", text: blobHash(T.text) });
    expect(reachOf(chain[0] as Beat, DANNY)?.place).toBeUndefined();
    expect(reachOf(chain[1] as Beat, PRIYA)).toMatchObject({ as: "act", text: blobHash(T.walk) });
    expect(reachOf(chain[1] as Beat, DANNY)).toMatchObject({ as: "sensed", text: blobHash(T.walk) });
    expect(reachOf(chain[2] as Beat, PRIYA)).toMatchObject({ as: "inside", text: blobHash(T.inside) });
    expect(reachOf(chain[3] as Beat, PRIYA)).toBeNull();
    expect(pendingFor(chain, mindV2At(state, PRIYA), PRIYA).map((b) => b.id)).toEqual(["text", "walk", "withDale"]);
  });

  test("her catch-up lives the message's words from Danny and her acts as hers; neither the truck nor the truth reaches her", async () => {
    const lived = await livedPovs(store, "u1", world, pendingFor(chain, mindV2At(state, PRIYA), PRIYA), PRIYA);
    const model = port({ memories: [{ lived: ["text"], text: "Danny's running late." }] });
    await catchUp(model, { who: PRIYA, name: "Priya Nair", at: 640, mind: {}, known: { [DANNY]: "Danny Okafor", [JESS]: "Jess Kowalczyk" }, lived });
    const sent = asked(model, 0);
    expect(sent).toContain(`[beat text] Fri 16 Oct 2026, 10:00 AM (a message to you from Danny Okafor)\n${T.words}`);
    expect(sent).toContain(`[beat walk] Fri 16 Oct 2026, 10:10 AM at Cafe (your own act, as those there could see and hear it)\n${T.walk}`);
    expect(sent).toContain(`[beat withDale] Fri 16 Oct 2026, 10:20 AM at Cafe (your own act)\n${T.inside}`);
    for (const never of ["TEXT-SURFACE", "TRUTH", "NOTE-SURFACE", "Words said"]) expect(sent).not.toContain(never);
    // What she recalls of the message is its words, with no place: she was elsewhere.
    const corpus = livedCorpus({ who: PRIYA, mind: mindV2At(fold(reg, world, state, [mindLivedEvent({ who: PRIYA, beats: ["text", "walk"], at: 640, mode: "catch-up" }) as LedgerEvent]), PRIYA), beats: chain, texts: Object.fromEntries(blobs) });
    expect(corpus.map((d) => [d.beat, d.as, d.place, d.text])).toEqual([
      ["text", "message", undefined, T.words],
      ["walk", "act", "cafe", T.walk],
    ]);
  });
});

describe("outside views: each actor lives its own act as it did it, a message's sender sending it, its recipient only the words", () => {
  // A Port Alder morning at 114 Harbor Street as the historian wrote it before: each surface from Jordan's side upstairs.
  const T = {
    call: "UPSTAIRS: Danny's voice carries up through the old building as he calls down to the ground floor.",
    callDeed: "Danny calls down the stairs to Helen, offering her coffee at the shop.",
    callWords: "Morning, Helen! Coffee's on at the shop if you want it!",
    answer: "MUFFLED: A muffled voice from 1A, unintelligible.",
    answerDeed: "Helen calls back to Danny from behind her door.",
    answerWords: "Save me a cup, love!",
    text: "NIGHTSTAND: A phone buzzes on the nightstand; the screen shows a text from Marcus.",
    textDeed: "Marcus texts Danny and Jordan to be at the shop by seven.",
    textWords: "Both of you at the shop by 7. Ferris truck.",
  };
  const blobs = new Map(Object.values(T).map((t) => [blobHash(t), t]));
  const store = { get: async (_u: string, hash: string) => blobs.get(hash) ?? null };
  const said = (id: string, at: number, actors: string[], addressed: string[], t: { surface: string; deed: string; words: string }, exposure: Beat["exposure"]): Beat => ({ id, at, order: 1, place: "home", actors, act: "said", about: [], what: blobHash(`${id}: the truth of it`), deed: blobHash(t.deed), surface: blobHash(t.surface), quotes: blobHash(t.words), addressed, exposure, by: { bootstrap: { message: "m1", swipe: "c1" } } });
  // Danny's own call down the stairs: Helen and Jordan heard it whole.
  const call = said("call", 375, [DANNY], [HELEN], { surface: T.call, deed: T.callDeed, words: T.callWords }, [{ who: HELEN, channel: "hearing", reach: "whole" }, { who: JORDAN, channel: "hearing", reach: "whole" }, { who: DANNY, channel: "sight", reach: "whole" }]);
  // Helen's answer through her door: Danny on the stairs heard it whole, Jordan upstairs in part, and the historian listed her as hearing her own voice in part.
  const answer = said("answer", 375, [HELEN], [DANNY], { surface: T.answer, deed: T.answerDeed, words: T.answerWords }, [{ who: DANNY, channel: "hearing", reach: "whole" }, { who: JORDAN, channel: "hearing", reach: "partial" }, { who: HELEN, channel: "hearing", reach: "partial" }]);
  // Marcus texts Danny and Jordan from elsewhere; the beat is placed where the story was, where it was read.
  const text = said("text", 376, [MARCUS], [DANNY, JORDAN], { surface: T.text, deed: T.textDeed, words: T.textWords }, [{ who: JORDAN, channel: "message", reach: "whole" }, { who: DANNY, channel: "message", reach: "whole" }, { who: MARCUS, channel: "sight", reach: "whole" }]);
  const morning = [call, answer, text];

  test("an actor's own call: Danny lives his deed and his words, where he was; Helen, who heard it, what there was to sense", () => {
    expect(reachOf(call, DANNY)).toEqual({ beat: "call", at: 375, place: "home", channel: "sight", whole: true, as: "deed", text: blobHash(T.callDeed), quotes: blobHash(T.callWords) });
    expect(reachOf(call, HELEN)).toMatchObject({ as: "sensed", place: "home", text: blobHash(T.call), quotes: blobHash(T.callWords) });
    // His deed asks no point of view of his; one naming someone he doesn't know still does, so it never names a stranger to him.
    expect(needsPov(call, DANNY, [HELEN, JORDAN])).toBe(false);
    expect(needsPov(call, DANNY, [JORDAN])).toBe(true);
  });

  test("an answer through a door: Helen lives her own answer whole, words and all, with no point of view to wait for; Danny what reached him", () => {
    expect(reachOf(answer, HELEN)).toEqual({ beat: "answer", at: 375, place: "home", channel: "hearing", whole: true, as: "deed", text: blobHash(T.answerDeed), quotes: blobHash(T.answerWords) });
    expect(needsPov(answer, HELEN, [DANNY, JORDAN])).toBe(false);
    expect(reachOf(answer, DANNY)).toMatchObject({ as: "sensed", whole: true, text: blobHash(T.answer), quotes: blobHash(T.answerWords) });
    // With no deed, her reach in part waits for her own point of view, as before.
    const { deed: _, ...bare } = answer;
    expect(reachOf(bare, HELEN)).toBeNull();
    expect(needsPov(bare, HELEN, [DANNY, JORDAN])).toBe(true);
  });

  test("a text sent from elsewhere: Marcus lives sending it, with no place and no point of view, even beside someone he doesn't know; Danny lives only its words, from him", () => {
    expect(reachOf(text, MARCUS)).toEqual({ beat: "text", at: 376, channel: "sight", whole: true, as: "deed", text: blobHash(T.textDeed), quotes: blobHash(T.textWords) });
    expect(needsPov(text, MARCUS, [])).toBe(false);
    expect(reachOf(text, DANNY)).toEqual({ beat: "text", at: 376, channel: "message", whole: true, as: "message", from: [MARCUS], text: blobHash(T.textWords) });
    expect(needsPov(text, DANNY, [MARCUS, HELEN])).toBe(false);
  });

  test("each one's catch-up lives its own act as its own, and never a surface written from someone else's side", async () => {
    const known = { [DANNY]: "Danny Okafor", [HELEN]: "Helen Kowalczyk", [MARCUS]: "Marcus Delgado", [JORDAN]: "Jordan Ellis" };
    const sent = async (who: string, name: string): Promise<string> => {
      const model = port({ memories: [] });
      await catchUp(model, { who, name, at: 380, mind: {}, known, lived: await livedPovs(store, "u1", world, pendingFor(morning, mindV2At(state, who), who), who) });
      return asked(model, 0);
    };
    const danny = await sent(DANNY, "Danny Okafor");
    expect(danny).toContain(`[beat call] Fri 16 Oct 2026, 6:15 AM at Home (your own act)\n${T.callDeed}\nWords said: ${T.callWords}`);
    expect(danny).toContain(`[beat answer] Fri 16 Oct 2026, 6:15 AM at Home (it reached you whole)\n${T.answer}\nWords said: ${T.answerWords}`);
    expect(danny).toContain(`[beat text] Fri 16 Oct 2026, 6:16 AM (a message to you from Marcus Delgado)\n${T.textWords}`);
    for (const never of ["UPSTAIRS", "NIGHTSTAND", T.textDeed, "the truth of it"]) expect(danny).not.toContain(never);
    const helen = await sent(HELEN, "Helen Kowalczyk");
    expect(helen).toContain(`[beat answer] Fri 16 Oct 2026, 6:15 AM at Home (your own act)\n${T.answerDeed}\nWords said: ${T.answerWords}`);
    expect(helen).not.toContain("MUFFLED");
    const marcus = await sent(MARCUS, "Marcus Delgado");
    expect(marcus).toContain(`[beat text] Fri 16 Oct 2026, 6:16 AM (your own act)\n${T.textDeed}\nWords said: ${T.textWords}`);
    for (const never of ["NIGHTSTAND", "at Home", "UPSTAIRS", "MUFFLED"]) expect(marcus).not.toContain(never);
  });
});

describe("the historian: whoever acts perceives it, and a beat happens at a listed place", () => {
  const rows = [
    { id: "m1", isUser: true, name: "Jordan Ellis", text: "I tell Danny the truck's fixed and toss him the keys.", clock: null, basis: { swipe: "c1" } },
    { id: "m2", isUser: false, name: "Narrator", text: "Priya slides the invoice across the bunkhouse table to Danny.", clock: null, basis: { swipe: "c2" } },
  ];
  const cast = [{ id: JORDAN, name: "Jordan Ellis" }, { id: DANNY, name: "Danny Okafor" }, { id: PRIYA, name: "Priya Nair" }];

  test("the player character's act reaches whoever was there and him; an actor left out of the exposure perceives her own act; a place made from an earlier stretch is named, not made again", async () => {
    const model = port({
      beats: [
        { message: "m1", place: "cafe", actors: [JORDAN], act: "said", about: [DANNY], what: "Jordan tells Danny the truck is fixed and tosses him the keys.", surface: "Jordan, saying the truck's fixed; keys arcing through the air.", quotes: "Truck's fixed.", addressed: [DANNY], exposure: [{ who: DANNY, channel: "sight", reach: "whole" }] },
        { message: "m2", place: "bsp_bunkhouse", actors: [PRIYA], act: "did", about: [DANNY], what: "Priya hands Danny the invoice.", surface: "A sheet of paper slides across the table.", exposure: [{ who: DANNY, channel: "sight", reach: "whole" }] },
      ],
      newPlaces: [{ ref: "new:bunkhouse", name: "The bunkhouse", in: "town", note: "the ranch's bunkhouse" }],
    });
    const out = await historian({ world, state, texts: {}, chunk: rows, before: { beats: [], staging: [] }, cast, places: [{ id: "bsp_bunkhouse", name: "The bunkhouse" }] }, model);
    const sent = asked(model, 0);
    expect(sent).toContain("The player character's acts and words are beats like anyone's: whoever is there sees what he does and hears what he says aloud.");
    expect(sent).toContain("a room, a yard, a spot or a corner of a listed place is that place");
    expect(sent).toContain("- The bunkhouse (id: bsp_bunkhouse)");
    const [his, hers] = out.beats.map((b) => b.beat);
    expect(his?.exposure.map((x) => [x.who, x.pending ?? false])).toEqual([[DANNY, true], [JORDAN, false]]);
    expect(hers?.exposure.map((x) => [x.who, x.pending ?? false])).toEqual([[DANNY, true], [PRIYA, true]]);
    // The run's own place, which the fold doesn't hold yet, is where her beat happened; it isn't made again under its name.
    expect(hers?.place).toBe("bsp_bunkhouse");
    expect(out.newPlaces).toEqual([]);
  });

  test("it asks for each beat's deed beside a surface from no one's side, and keeps the deed for its actors: none where no one acts, a doubt where an actor got none", async () => {
    const told: Misread[] = [];
    const sent: PortMessage[][] = [];
    const model: ModelPort = async (_role, messages) => {
      sent.push(messages);
      const beats = [
        { message: "m1", place: "cafe", actors: [JORDAN], act: "did", about: [DANNY], what: "Jordan tosses Danny the keys.", surface: "Keys arc through the air.", exposure: [{ who: DANNY, channel: "sight", reach: "whole" }] },
        { message: "m2", place: "cafe", actors: [PRIYA], act: "did", about: [DANNY], what: "Priya hands Danny the invoice.", deed: "Priya slides the invoice across the table to Danny.", surface: "A sheet of paper slides across a table.", exposure: [{ who: DANNY, channel: "sight", reach: "whole" }] },
        { message: "m2", place: "cafe", actors: [], act: "happened", about: [], what: "Rain starts.", deed: "It rains.", surface: "Rain on the window.", exposure: [{ who: DANNY, channel: "hearing", reach: "whole" }] },
        { message: "m2", place: "cafe", actors: [DANNY], act: "did", about: [], what: "Danny pockets the invoice.", surface: "A man folds a paper into his pocket.", exposure: [] },
      ];
      return { text: JSON.stringify({ beats }), misread: (fields) => void told.push(...fields) };
    };
    const out = await historian({ world, state, texts: {}, chunk: rows, before: { beats: [], staging: [] }, cast }, model);
    const prompt = (sent[0] ?? []).map((m) => m.content).join("\n");
    expect(prompt).toContain('"deed": what its actors did and said, plainly, as they did it, never as anyone saw or heard it');
    expect(prompt).toContain("write the surface as anyone there could sense it, from no one's side, the player character's included, never as it reached one person there");
    expect(prompt).toContain("its sender lives sending it, as its deed has it");
    const [toss, invoice, rain, pocket] = out.beats.map((b) => b.beat);
    // Hers is kept, and is what she lives of it.
    expect(invoice?.deed !== undefined ? out.blobs[invoice.deed] : undefined).toBe("Priya slides the invoice across the table to Danny.");
    expect(invoice ? reachOf(invoice, PRIYA)?.text : undefined).toBe(invoice?.deed);
    expect(invoice?.uncertain).toBeUndefined();
    // The rain's, with no one acting, is no one's: dropped, and told.
    expect(rain?.deed).toBeUndefined();
    expect(told).toEqual([{ field: "beats[2].deed", said: '"It rains."', why: "no one acts in it" }]);
    // The player character's own act needs none; Danny's, without one, says so for the spot checks.
    expect(toss?.uncertain).toBeUndefined();
    expect(pocket?.deed).toBeUndefined();
    expect(pocket?.uncertain !== undefined ? out.blobs[pocket.uncertain] : "").toContain("Nothing was said of what its actors did as they did it");
  });
});
