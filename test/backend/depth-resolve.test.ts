// The GM inside a depth scene (DEPTH-PLAN §5.2 "GM, resolution", §1.3): what someone tries is read
// against the actions the rules have for them and resolved by the engine itself (its check, its
// requirements, its effects), the outcome beat written only when the rules decided something the act
// didn't say, a misread never told as the story's outcome; and the player's own beats are written
// beside the engine run's resolutions, his out-of-character lines kept as signals.

import { describe, expect, test } from "bun:test";
import type { ModelPort, PortMessage } from "../../src/backend/depth/port";
import { attemptSeed, playerBeats, QUOTE_WORDS_MOST, QUOTES_PER_ANSWER_MOST, QUOTES_PER_BEAT_MOST, resolveAttempt, type PlayerBeatsOut } from "../../src/backend/depth/scene/resolve";
import type { WorldDoc } from "../../src/shared/world";
import { resolveOn } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";
import { MINDS_V2_KEY, povOf } from "../../src/shared/character-engine";

const reg = registryOf();

/** Mira at the cafe with a wall to climb (d20 + skill against 12), a door to knock on (no check) and a safe she can't open (skill 5 needed). */
function cafe(): WorldDoc {
  const world = baseWorld({
    entities: {
      ...baseWorld().entities,
      [POV]: { id: POV, kind: "person", name: "Sam", tier: "principal", fields: { place: "cafe", home: "home", cash: 5000, skill: 2 }, relations: [] },
      mira: { id: "mira", kind: "person", name: "Mira", tier: "principal", fields: { place: "cafe", home: "cafe", skill: 0 }, relations: [] },
    },
  });
  world.checks.climb = { id: "climb", dice: "d20", modifier: "self.skill", dc: "12" };
  world.actions.climb = {
    id: "climb",
    label: "Climb the wall",
    params: {},
    requires: [],
    check: "climb",
    outcomes: { success: [{ type: "set", args: { entity: "self", field: "activity", value: "up" } }], failure: [{ type: "add", args: { entity: "self", field: "stress", delta: 5 } }] },
    duration: "5",
  };
  world.actions.knock = { id: "knock", label: "Knock on the door", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "activity", value: "knocking" } }] }, duration: "1" };
  world.actions.open_safe = { id: "open_safe", label: "Open the safe", params: {}, requires: ["self.skill >= 5"], outcomes: { default: [{ type: "set", args: { entity: "self", field: "activity", value: "rich" } }] }, duration: "10" };
  return world;
}

function port(...answers: unknown[]): ModelPort & { sent: { role: string; messages: PortMessage[] }[] } {
  const sent: { role: string; messages: PortMessage[] }[] = [];
  const fn = (async (role, messages) => {
    sent.push({ role, messages });
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 2, tokensOut: 1 } };
  }) as ModelPort & { sent: typeof sent };
  fn.sent = sent;
  return fn;
}

describe("an attempt in the scene", () => {
  test("the engine resolves a character's attempt by the world's own check, and the GM writes how it came out", async () => {
    const world = cafe();
    const state = startState(world);
    const act = { actor: "mira", surface: "Mira grabs the drainpipe and starts up the wall.", attempt: "climb the wall" };
    const seed = attemptSeed("turn-seed", "b7");
    const model = port({ actions: [{ action: "climb", params: {}, words: "climb the wall" }], judgement: null, none: null }, { what: "Mira climbs: the check rolled, as the rules read it.", surface: "Mira hauls herself up the drainpipe.", about: ["mira"] });
    const out = await resolveAttempt(model, { registry: reg, world, state, act, seed, runSeed: "run" });
    expect(model.sent.map((s) => s.role)).toEqual(["gm", "gm"]);
    // The GM read her act against her own catalog.
    const asked = model.sent[0]?.messages.at(-1)?.content ?? "";
    expect(asked).toContain("climb: Climb the wall");
    expect(asked).toContain(act.surface);
    expect(asked).toContain("climb the wall");
    // The engine itself rolled it, for her.
    const res = out.resolutions[0];
    expect(res?.actor).toBe("mira");
    expect(res?.check).not.toBeNull();
    const direct = resolveOn(reg, world, state, { action: "climb", actor: "mira" }, createRng(seed), { runSeed: "run" }).resolution;
    expect(res?.outcome).toBe(direct.outcome);
    expect(out.events.length).toBeGreaterThan(0);
    expect(fold(reg, world, state, out.events)).toEqual(out.state);
    expect(out.minutes).toBe(5);
    expect(out.outcome).toEqual({ what: "Mira climbs: the check rolled, as the rules read it.", surface: "Mira hauls herself up the drainpipe.", about: [{ entity: "mira" }] });
    // The same beat rolls the same; another beat its own.
    const again = await resolveAttempt(port({ actions: [{ action: "climb", params: {}, words: "starts up the wall" }] }, { what: "w", surface: "s" }), { registry: reg, world, state, act, seed, runSeed: "run" });
    expect(again.resolutions[0]?.check?.total).toBe(res?.check?.total);
  });

  test("an act the rules settle without a roll needs no outcome; a misread is dropped, never told", async () => {
    const world = cafe();
    const state = startState(world);
    const knock = port({ actions: [{ action: "knock", params: {}, words: "raps on the back door" }] });
    const k = await resolveAttempt(knock, { registry: reg, world, state, act: { actor: "mira", surface: "Mira raps on the back door.", attempt: "knock" }, seed: "s1", runSeed: "run" });
    expect(knock.sent).toHaveLength(1);
    expect(k.outcome).toBeNull();
    expect(k.resolutions.map((r) => [r.action, r.ok])).toEqual([["knock", true]]);
    expect(k.state.entities.mira?.fields.activity).toBe("knocking");

    const misread = port({ actions: [{ action: "fly", params: {}, words: "flaps her arms" }, { action: "knock", params: { door: "nowhere" }, words: "flaps her arms" }], none: null });
    const m = await resolveAttempt(misread, { registry: reg, world, state, act: { actor: "mira", surface: "Mira flaps her arms.", attempt: "fly" }, seed: "s2", runSeed: "run" });
    expect(m.read.dropped.map((d) => d.action)).toEqual(["fly"]);
    // An extra param the action doesn't take is no misread: it knocks.
    expect(m.resolutions.map((r) => r.action)).toEqual(["knock"]);

    const talk = port({ actions: [], none: "She only talks." });
    const t = await resolveAttempt(talk, { registry: reg, world, state, act: { actor: "mira", surface: "Mira says hello.", quotes: "Hello." }, seed: "s3", runSeed: "run" });
    expect([t.resolutions, t.events, t.outcome, t.read.none]).toEqual([[], [], null, "She only talks."]);
  });

  test("a requirement holds whoever acts; an outcome the GM leaves unwritten is told in the engine's words, marked uncertain", async () => {
    const world = cafe();
    const state = startState(world);
    const model = port({ actions: [{ action: "open_safe", params: {}, words: "open the safe" }] }, { what: "", surface: "" });
    const out = await resolveAttempt(model, { registry: reg, world, state, act: { actor: "mira", surface: "Mira spins the safe's dial.", attempt: "open the safe" }, seed: "s4", runSeed: "run" });
    expect(out.resolutions.map((r) => [r.ok, r.failed?.code])).toEqual([[false, "requirement"]]);
    expect(out.events).toEqual([]);
    expect(out.outcome?.what).toContain("it failed");
    expect(out.outcome?.surface).toBe("Mira: Open the safe: it doesn't come off.");
    expect(out.outcome?.uncertain).toBeDefined();
  });

  // LIVE3 L3a-5: handed the player's whole message, the GM read the door Jordan opened as the rules'
  // get_up, from "roll out of bed" in another act of his (it failed, and "he did not rise" was told
  // beside his own "Jordan got out of bed"), and "take the stairs after Danny" (down) as a climb up.
  test("each action quotes the act's own words it plays: one whose words aren't that act's is dropped as a misread, never resolved; case, quote marks, a final stop, a pronoun or an inflection aside", async () => {
    const world = cafe();
    world.actions.get_up = { id: "get_up", label: "Get up", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "activity", value: "up" } }] }, duration: "1" };
    world.actions.open_door = { id: "open_door", label: "Open the door", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "activity", value: "at the door" } }] }, duration: "1" };
    const state = startState(world);
    const door = { actor: POV, surface: "Sam pulls the door of his flat open.", attempt: "get the door open before Mira is gone", input: "get my door open before she's gone." };
    // The door, read as getting up from words of another act of his: dropped, and no outcome told.
    const up = port({ actions: [{ action: "get_up", params: {}, words: "roll out of bed" }], judgement: null, none: null });
    const u = await resolveAttempt(up, { registry: reg, world, state, act: door, seed: "s5", runSeed: "run" });
    expect(u.read.dropped).toEqual([{ action: "get_up", why: "“roll out of bed” isn't in your words" }]);
    expect([u.read.actions, u.resolutions, u.events, u.outcome]).toEqual([[], [], [], null]);
    expect(up.sent).toHaveLength(1);
    // The GM was given that act's own words, never the rest of his message.
    expect(up.sent[0]?.messages.at(-1)?.content).toContain("The player's own words for this act: get my door open before she's gone.");
    // The stairs taken after Mira, down, read as a climb up: dropped, its check never rolled.
    const stairs = port({ actions: [{ action: "climb", params: {}, words: "climb up the stairs" }], judgement: { rating: 2, reason: "He pushes the climb." }, none: null });
    const s = await resolveAttempt(stairs, { registry: reg, world, state, act: { actor: POV, surface: "Sam starts up the stairs after Mira.", attempt: "climb up the stairs after Mira", input: "take the stairs after Mira" }, seed: "s6", runSeed: "run" });
    expect(s.read.dropped).toEqual([{ action: "climb", why: "“climb up the stairs” isn't in your words" }]);
    expect([s.resolutions, s.minutes]).toEqual([[], 0]);
    // His own words, as a model copies them, play: curly quotes, another case and no final stop; a pronoun and an inflection; a list of them.
    for (const words of ["“Get my door open before she’s gone”", "gets his door open", ["get my door", "open"]]) {
      const open = port({ actions: [{ action: "open_door", params: {}, words }] });
      const o = await resolveAttempt(open, { registry: reg, world, state, act: door, seed: "s7", runSeed: "run" });
      expect([o.read.dropped, o.resolutions.map((r) => r.action)]).toEqual([[], ["open_door"]]);
    }
    // A character's act is its surface, its words and what it tries: an action quoting none of them, or nothing, is dropped.
    const mira = { actor: "mira", surface: "Mira raps on the back door.", quotes: "Anyone home?", attempt: "knock" };
    const knocks = port({ actions: [{ action: "knock", params: {}, words: "pounds on the door" }, { action: "knock", params: {} }, { action: "knock", params: {}, words: "Anyone home" }] });
    const k = await resolveAttempt(knocks, { registry: reg, world, state, act: mira, seed: "s8", runSeed: "run" });
    expect(k.read.dropped).toEqual([
      { action: "knock", why: "“pounds on the door” isn't in Mira's act" },
      { action: "knock", why: "it quotes none of Mira's act" },
    ]);
    expect(k.resolutions.map((r) => r.action)).toEqual(["knock"]);
  });

  // After Play as, the world doc's own pov is still whom the chat opened with; the player plays the
  // one he switched to (`povOf`, D-10). The GM read her act as an ordinary character's, and his old
  // one's as the player character's.
  test("after the player switches to another character, the GM reads her act as the player character's, by her own catalog, and his old one's as anyone's", async () => {
    const world = cafe();
    world.actions.greet = { id: "greet", label: "Greet someone", params: { whom: { type: "ref", ref: "person" } }, requires: [], outcomes: { default: [] }, duration: "1" };
    const start = startState(world);
    const state = { ...start, packs: { ...start.packs, minds: { [MINDS_V2_KEY]: { pov: "mira" } } } };
    expect([world.pov, povOf(world, state)]).toEqual([POV, "mira"]);
    const asked = async (actor: string, surface: string): Promise<string> => {
      const model = port({ actions: [], none: "Only a wave." });
      await resolveAttempt(model, { registry: reg, world, state, act: { actor, surface }, seed: "s9", runSeed: "run" });
      return model.sent[0]?.messages.at(-1)?.content ?? "";
    };
    const greets = (who: string): RegExp => new RegExp(`- greet: Greet someone\\. Params: whom \\(person: [^)\\n]*\\b${who}\\b`);
    const hers = await asked("mira", "Mira waves at Sam.");
    expect(hers).toContain("The act, by Mira (id: mira), the player character:");
    // Her own catalog: whom she may greet is everyone here but her.
    expect(hers).toContain("What Mira can do now");
    expect(hers).toMatch(greets(POV));
    expect(hers).not.toMatch(greets("mira"));
    const his = await asked(POV, "Sam waves at Mira.");
    expect(his).toContain(`The act, by Sam (id: ${POV}):`);
    expect(his).not.toContain("the player character");
    expect(his).toContain("What Sam can do now");
    expect(his).toMatch(greets("mira"));
    expect(his).not.toMatch(greets(POV));
  });
});

describe("the player's own beats", () => {
  test("his acts and words as he wrote them, each resolved action's outcome as the rules decided it, his out-of-character lines as signals", async () => {
    const world = cafe();
    const before = startState(world);
    const climbed = resolveOn(reg, world, before, { action: "climb" }, createRng("turn"), { runSeed: "run" });
    const input = "I wave at Mira and start up the wall. I hope she didn't see the letter. (OOC: make it rain later)";
    const model = port({
      beats: [
        { kind: "act", act: "did", actors: ["Sam"], addressed: ["Mira"], about: ["mira"], what: "Sam waves at Mira and starts climbing the wall.", surface: "Sam waves at Mira and grabs the drainpipe.", words: "wave at Mira and start up the wall" },
        { kind: "inner", act: "did", what: "Sam hopes Mira didn't see the letter.", surface: "Sam hopes Mira didn't see the letter.", words: "I hope she didn't see the letter" },
      ],
      signals: ["(OOC: make it rain later)"],
    });
    const out = await playerBeats(model, { registry: reg, world, state: climbed.state, pov: POV, input, resolutions: [climbed.resolution], minutes: 5 });
    expect(model.sent[0]?.role).toBe("gm");
    const asked = model.sent[0]?.messages.at(-1)?.content ?? "";
    expect(asked).toContain(input);
    expect(asked).toContain("climb check");
    expect(asked).toContain("No scene is playing: his turn opens one.");
    expect(out.signals).toEqual(["(OOC: make it rain later)"]);
    expect(out.beats.map((b) => [b.kind, b.decided, b.actors, b.inner ?? false])).toEqual([
      ["act", "player", [POV], false],
      ["inner", "player", [POV], true],
      // The check the GM's answer left out is told all the same, in the engine's words.
      ["outcome", "gm", [], false],
    ]);
    expect(out.beats[0]?.addressed).toEqual(["mira"]);
    expect(out.beats.map((b) => b.words)).toEqual(["wave at Mira and start up the wall", "I hope she didn't see the letter", undefined]);
    expect(out.refused).toEqual([]);
    expect(out.beats[2]).toMatchObject({ resolution: 0, uncertain: expect.any(String) });
    expect(out.beats[2]?.what).toContain(climbed.resolution.outcome ?? "?");
  });

  // LIVE3 L3a-5: the GM read "take the stairs after Danny" as a climb up, though Danny had gone down;
  // and nothing held what an act of his attempts to the words he wrote.
  test("his beats are read against the scene so far, each quoting the words of his message it rests on, kept as his message has them: the act's own words, which what it attempts is read from", async () => {
    const world = cafe();
    const state = startState(world);
    const input = "I take the stairs after Mira. “Wait up!”";
    const scene = { beats: ["- [b1] 9:00 AM, Cafe (id: cafe); did by Mira (id: mira): Mira heads down the cellar stairs. Perceived by: Sam (id: pov) by sight."], staging: [{ who: "mira", where: "on the cellar stairs, below Sam", doing: "going down" }] };
    const model = port({
      beats: [
        { kind: "act", act: "did", what: "Sam goes down the cellar stairs after Mira.", surface: "Sam starts down the cellar stairs after Mira.", words: "Takes the stairs after Mira", attempt: "catch up with Mira" },
        { kind: "act", act: "said", addressed: ["mira"], what: "Sam calls to Mira to wait.", surface: "Sam calls after Mira.", words: ["“Wait up!”"], quotes: "Wait up!" },
      ],
      signals: [],
    });
    const out = await playerBeats(model, { registry: reg, world, state, pov: POV, input, scene, resolutions: [] });
    const asked = model.sent[0]?.messages.at(-1)?.content ?? "";
    expect(asked).toContain(`The scene so far (each beat opens with its id):\n${scene.beats[0]}`);
    expect(asked).toContain("Where everyone in it is:\n- Mira (id: mira): on the cellar stairs, below Sam; going down");
    expect(out.beats.map((b) => [b.surface, b.words, b.attempt])).toEqual([
      ["Sam starts down the cellar stairs after Mira.", "take the stairs after Mira", "catch up with Mira"],
      ["Sam calls after Mira.", "Wait up", undefined],
    ]);
    expect(out.refused).toEqual([]);
  });

  // The depth release's late correctness review, finding 1: a beat of his whose words the GM tidied
  // past one in four, or that quoted none, was dropped whole, so his act never happened in canon.
  test("his own beat is kept whatever its quote, a typo'd message's words tidied or none given: only what an act attempts rests on his words, and where his message doesn't hold them it isn't read, said", async () => {
    const world = cafe();
    const state = startState(world);
    const typed = "ok im gonna grab teh keys n head out to the truck";
    const tidied = port({ beats: [{ kind: "act", act: "did", actors: [POV], about: [], what: "Sam grabs the keys and heads out to the truck.", deed: "Sam grabs the keys and heads out to the truck.", surface: "Sam takes the keys and goes out.", words: "I'm going to grab the keys and head out to the truck", attempt: "take the keys" }], signals: [] });
    const t = await playerBeats(tidied, { registry: reg, world, state, pov: POV, input: typed, resolutions: [] });
    // His act stands as the GM wrote it, with no words his message doesn't hold, and nothing it attempts is read from them.
    expect(t.beats.map((b) => [b.kind, b.decided, b.actors, b.what, b.deed, b.surface, b.words, b.attempt])).toEqual([["act", "player", [POV], "Sam grabs the keys and heads out to the truck.", "Sam grabs the keys and heads out to the truck.", "Sam takes the keys and goes out.", undefined, undefined]]);
    expect(t.refused).toEqual(["“Sam takes the keys and goes out.” stands, but not what it attempts (“take the keys”): “I'm going to grab the keys and head out to the truck” isn't in your message"]);

    // No words at all (a prompt the user customized before the field existed): each beat is kept, and nothing is said of one that attempts nothing.
    const knock = "I knock on Mira's door. Hope she's up.";
    const none = port({
      beats: [
        { kind: "act", act: "did", actors: [POV], about: ["mira"], what: "Sam knocks on Mira's door.", surface: "Someone knocks on the door.", attempt: "wake Mira" },
        { kind: "inner", act: "did", what: "Sam hopes Mira is up.", surface: "Sam hopes Mira is up." },
      ],
      signals: [],
    });
    const n = await playerBeats(none, { registry: reg, world, state, pov: POV, input: knock, resolutions: [] });
    expect(n.beats.map((b) => [b.kind, b.decided, b.surface, b.words, b.attempt, b.inner ?? false])).toEqual([
      ["act", "player", "Someone knocks on the door.", undefined, undefined, false],
      ["inner", "player", "Sam hopes Mira is up.", undefined, undefined, true],
    ]);
    expect(n.refused).toEqual(["“Someone knocks on the door.” stands, but not what it attempts (“wake Mira”): it quotes none of your message"]);
  });

  // The depth release's late security review, S5: a quote was held to his message by an edit
  // distance over every word of both, at once, on the worker every user shares (a 4,000-word quote
  // against a 40,000-word message held it 8 seconds), and nothing bounded the quote or the message.
  // Held to how its time grows, never to a clock a busy machine slows: four times the quote against
  // four times the message costs under 6× the time, where an edit distance over both costs 16×; and
  // a real stall still fails, each under a second. Of varied words only: the next test holds common ones.
  test("a quote of varied words is held to his message near its own words, other work given way to first: one of more than an act's own words is refused unmatched", async () => {
    const world = cafe();
    const state = startState(world);
    const words = (n: number, salt: string, from = 0): string => Array.from({ length: n }, (_, i) => `${salt}${((from + i) * 7919) % 10007}`).join(" ");
    // The quickest of three runs: the worker's own pace, as near as a busy machine lets it be.
    const timed = async (quote: string, input: string): Promise<{ out: PlayerBeatsOut | null; ms: number }> => {
      let out: PlayerBeatsOut | null = null;
      let ms = Infinity;
      for (let run = 0; run < 3; run++) {
        const model = port({ beats: [{ kind: "act", act: "did", what: "Sam acts.", surface: "Sam acts.", words: quote, attempt: "act" }], signals: [] });
        const started = performance.now();
        out = await playerBeats(model, { registry: reg, world, state, pov: POV, input, resolutions: [] });
        ms = Math.min(ms, performance.now() - started);
      }
      return { out, ms };
    };
    const input = words(40_000, "w");
    // A 4,000-word quote against the 40,000-word message, and a quarter of each: under 6× the time
    // (the smaller taken as a millisecond at least, too quick a run to time being no measure), and
    // under a second.
    const short = await timed(words(1_000, "x"), words(10_000, "w"));
    const long = await timed(words(4_000, "x"), input);
    expect(long.ms / Math.max(short.ms, 1)).toBeLessThan(6);
    expect(long.ms).toBeLessThan(1_000);
    expect(long.out?.refused).toEqual([`“Sam acts.” stands, but not what it attempts (“act”): “${words(12, "x")} …” quotes more than an act's own words`]);
    // As long as an act's own words may be, its words all in the message but not in its order: matched near them alone.
    const most = await timed(words(QUOTE_WORDS_MOST, "w", 5_000).split(" ").reverse().join(" "), input);
    expect(most.ms).toBeLessThan(1_000);
    expect(most.out?.refused[0]).toEndWith("isn't in your message");
    const deep = await timed(words(40, "w", 30_000), input);
    expect(deep.out?.beats[0]?.words).toBe(words(40, "w", 30_000));
    // Each quote gives way first: a task already waiting runs before the matching does.
    const order: string[] = [];
    setTimeout(() => order.push("waiting"), 0);
    await playerBeats(port({ beats: [{ kind: "act", act: "did", what: "Sam acts.", surface: "Sam acts.", words: "w0" }], signals: [] }), { registry: reg, world, state, pov: POV, input: "w0", resolutions: [] });
    order.push("matched");
    expect(order).toEqual(["waiting", "matched"]);
  });

  // The depth release's final security review, F3: S5's bound held only for a message of varied
  // words. A quote whose words all stood all through it was matched against the whole of it (a
  // 120-word quote of "a" against a million words of it held the worker 678 ms), any number of
  // quotes was held, and a stopped reply went on matching.
  test("a quote whose words stand too often in his message to match near them is refused unmatched, within a work budget however long the message is", async () => {
    const world = cafe();
    const state = startState(world);
    const held = async (quote: string, input: string): Promise<{ out: PlayerBeatsOut; ms: number }> => {
      const started = performance.now();
      const out = await playerBeats(port({ beats: [{ kind: "act", act: "did", what: "Sam acts.", surface: "Sam acts.", words: quote, attempt: "act" }], signals: [] }), { registry: reg, world, state, pov: POV, input, resolutions: [] });
      return { out, ms: performance.now() - started };
    };
    const tooOften = "uses words that stand too often in your message to be held to it";
    // Every word of the quote is every word of the message: its rarest stand everywhere.
    const same = await held(Array.from({ length: QUOTE_WORDS_MOST }, () => "a").join(" "), "a ".repeat(400_000));
    expect(same.out.refused[0]).toEndWith(tooOften);
    expect(same.ms).toBeLessThan(1_000);
    // Each of its words stands a few times only, but far apart all through a long message: too much of it to match near them.
    const quote = Array.from({ length: QUOTE_WORDS_MOST }, (_, i) => `x${i}`);
    const spread = Array.from({ length: 10 }, () => quote.map((w) => `${w} ${"zz ".repeat(200)}`).join("")).join("");
    const far = await held([...quote].reverse().join(" "), spread);
    expect(far.out.refused[0]).toEndWith(tooOften);
    expect(far.ms).toBeLessThan(1_000);
    // Within the budget, his words are held as ever.
    expect((await held("x5 zz zz", spread)).out.beats[0]?.words).toBe("x5 zz zz");
  });

  test("no more quotes are held than a beat's most and an answer's, the rest refused unmatched, and a stopped reply stops holding them", async () => {
    const world = cafe();
    const state = startState(world);
    const input = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const quotes = (from: number, n: number): string[] => Array.from({ length: n }, (_, i) => `w${from + i}`);
    const past = `past the most quotes held (${QUOTES_PER_BEAT_MOST} a beat, ${QUOTES_PER_ANSWER_MOST} an answer)`;
    // One beat quoting one more than a beat holds.
    const one = await playerBeats(port({ beats: [{ kind: "act", act: "did", what: "Sam acts.", surface: "Sam acts.", words: quotes(0, QUOTES_PER_BEAT_MOST + 1), attempt: "act" }], signals: [] }), { registry: reg, world, state, pov: POV, input, resolutions: [] });
    expect(one.refused).toEqual([`“Sam acts.” stands, but not what it attempts (“act”): “w${QUOTES_PER_BEAT_MOST}” is ${past}`]);
    // Beats each quoting a beat's most, past an answer's: a beat past it holds none.
    const full = QUOTES_PER_ANSWER_MOST / QUOTES_PER_BEAT_MOST;
    const beats = Array.from({ length: full + 1 }, (_, b) => ({ kind: "act", act: "did", what: `Sam acts ${b}.`, surface: `Sam acts ${b}.`, words: quotes(b, QUOTES_PER_BEAT_MOST), attempt: "act" }));
    const many = await playerBeats(port({ beats, signals: [] }), { registry: reg, world, state, pov: POV, input, resolutions: [] });
    expect(many.beats.map((b) => b.words !== undefined)).toEqual([...Array.from({ length: full }, () => true), false]);
    expect(many.refused).toHaveLength(1);
    expect(many.refused[0]).toEndWith(`are ${past}`);
    // Stopped as the answer comes in: no quote is held after.
    const stop = new AbortController();
    const stopping = (async () => {
      stop.abort();
      return { text: JSON.stringify({ beats: [{ kind: "act", act: "did", what: "Sam acts.", surface: "Sam acts.", words: "w0", attempt: "act" }], signals: [] }), usage: { tokensIn: 2, tokensOut: 1 } };
    }) as ModelPort;
    await expect(playerBeats(stopping, { registry: reg, world, state, pov: POV, input, resolutions: [], signal: stop.signal })).rejects.toThrow();
  });
});
