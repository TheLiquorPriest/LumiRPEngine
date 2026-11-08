// The Character Engine (DEPTH-PLAN §4.4): mind writes fold from `engine.ws.write` and
// `minds.v2.write`, the player character has no agent and can be switched (D-10), the core and the
// user's pinned edits stay out of the agent's reach, and a character recalls nothing it didn't live.

import { describe, expect, test } from "bun:test";
import { catchUp, cardCoreText, interview, povRender, reflect, seedCore } from "../../../src/backend/character-agent";
import type { ModelPort, PortMessage } from "../../../src/backend/depth/port";
import {
  MIND_WRITE,
  livedCorpus,
  mindFileWrite,
  mindFilesAt,
  mindLivedEvent,
  mindMetaAt,
  mindPath,
  mindPovEvent,
  mindV2At,
  pendingFor,
  povOf,
  probesOf,
  recallSearch,
  type ExposedBeat,
} from "../../../src/shared/character-engine";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { blobHash } from "../../../src/shared/stores";
import { validateEvent } from "../../../src/engine/events";
import type { WorldState } from "../../../src/engine/state";
import mindsPack from "../../../src/packs/minds/core/index";
import { baseWorld, fold, POV, registryOf, startState } from "../support";

const world = baseWorld({
  entities: {
    ...baseWorld().entities,
    mira: { id: "mira", kind: "person", name: "Mira", tier: "principal", fields: { place: "cafe", home: "cafe" }, relations: [] },
  },
});
const reg = registryOf([mindsPack]);
const start = startState(world, reg);

function refusal(state: Readonly<WorldState>, events: readonly LedgerEvent[]): string | null {
  const s = structuredClone(state) as WorldState;
  for (const e of events) {
    const ctx = reg.context(world, s);
    const r = validateEvent(reg, e, ctx);
    if (r) return r.code;
    reg.get(e.type)?.apply(e, s, ctx);
  }
  return null;
}

/** A port that answers each call with the next of `answers`, and keeps what it was asked. */
function port(...answers: unknown[]): ModelPort & { asked: { role: string; messages: PortMessage[] }[] } {
  const asked: { role: string; messages: PortMessage[] }[] = [];
  const fn = (async (role, messages) => {
    asked.push({ role, messages });
    const next = answers.shift();
    return { text: typeof next === "string" ? next : JSON.stringify(next ?? {}), usage: { tokensIn: 10, tokensOut: 5 } };
  }) as ModelPort & { asked: typeof asked };
  fn.asked = asked;
  return fn;
}

const SURFACE = { b1: "Dev sets two cups on the counter and says the pier floods at eight.", b2: "Raised voices behind the kitchen door.", b3: "Mira slips a letter into her coat.", b4: "The bell over the door rings twice." };
const QUOTES = { b1: "\"The pier floods at eight.\"", b2: "\"Burn it before he reads it.\"" };
const POV_B2 = "Through the door, two voices, too muffled to make out; one sounds angry.";
const MIRA_MIND = "I took the letter. No one saw.";

const blob = (text: string): string => blobHash(text);

/** The beats of a small chain: b1 (Dev's own act) reached Dev whole, b2 in part, b3 only Mira, b4 reached Dev but he hasn't lived it. */
const beats: ExposedBeat[] = [
  { id: "b1", at: 600, order: 1, place: "cafe", actors: ["dev"], surface: blob(SURFACE.b1), quotes: blob(QUOTES.b1), exposure: [{ who: "dev", channel: "sight", reach: "whole" }, { who: POV, channel: "sight", reach: "whole" }] },
  { id: "b2", at: 610, order: 1, place: "cafe", actors: [], surface: blob(SURFACE.b2), quotes: blob(QUOTES.b2), exposure: [{ who: "dev", channel: "hearing", reach: "partial", pov: blob(POV_B2) }] },
  { id: "b3", at: 615, order: 1, place: "cafe", actors: ["mira"], surface: blob(SURFACE.b3), exposure: [{ who: "mira", channel: "sight", reach: "whole" }] },
  { id: "b4", at: 620, order: 1, place: "cafe", actors: [], surface: blob(SURFACE.b4), exposure: [{ who: "dev", channel: "hearing", reach: "whole" }] },
];
const texts: Record<string, string> = Object.fromEntries([...Object.values(SURFACE), ...Object.values(QUOTES), POV_B2, MIRA_MIND].map((t) => [blob(t), t]));

describe("mind writes fold", () => {
  test("a seeded core and a catch-up's writes fold into the mind, each revision counted", async () => {
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "# Dev\n\nKeeps the cafe; trusts no one quickly." });
    const model = port({
      memories: [{ lived: ["b1", "b3"], about: ["Sam"], text: "Sam came in early. I told them the pier floods at eight. I meant it as a warning." }],
      beliefs: "- The pier floods at eight. I'd swear to it.",
      people: { sam: "Sam listens more than they talk." },
      plans: "Close early tonight.",
      planned: [{ what: "close the cafe early", when: "1970-01-01 19:00" }],
      now: "Wiping the counter, watching the door.",
      on_my_mind: "Sam's face when I said eight.",
    });
    const out = await catchUp(model, {
      who: "dev",
      name: "Dev",
      at: 620,
      mind: { "core.md": "# Dev\n\nKeeps the cafe; trusts no one quickly." },
      known: { sam: "Sam" },
      timeOf: (t) => (t === "1970-01-01 19:00" ? 1140 : null),
      lived: [
        { beat: "b1", at: 600, whole: true, text: SURFACE.b1, quotes: QUOTES.b1 },
        { beat: "b2", at: 610, whole: false, text: POV_B2 },
      ],
    });
    expect(model.asked[0]?.role).toBe("character");
    const state = fold(reg, world, start, [...core.events, ...out.events]);
    const files = mindFilesAt(state, "dev");
    expect(Object.keys(files).sort()).toEqual(["beliefs.md", "core.md", "memories/000000600-1.md", "now.md", "on-my-mind.md", "people/sam.md", "plans.md"]);
    const meta = mindMetaAt(state, "dev");
    // The memory cites only the beats of its own batch: b3 never reached Dev.
    expect(meta["memories/000000600-1.md"]?.lived).toEqual(["b1"]);
    expect(meta["memories/000000600-1.md"]?.about).toEqual(["sam"]);
    expect(meta["plans.md"]?.plans).toEqual([{ what: "close the cafe early", when: 1140 }]);
    expect(meta["core.md"]?.source).toBe("card");
    expect(Object.keys(mindV2At(state, "dev").lived).sort()).toEqual(["b1", "b2"]);
    for (const [hash, text] of Object.entries(out.blobs)) expect(blobHash(text)).toBe(hash);
    // A second write of a file counts its revision.
    const again = fold(reg, world, state, mindFileWrite({ who: "dev", path: mindPath("dev", "now"), at: 630, mode: "reflect", lived: [], about: [] }, "Calmer now.").events);
    expect(mindMetaAt(again, "dev")["now.md"]?.rev).toBe(2);
  });

  test("a write without its file's workspace write, the core by the agent, a pinned file and the player character's are refused", () => {
    const write = (who: string, kind: "core" | "now" | "beliefs", mode: "catch-up" | "user" | "seed", text: string) => mindFileWrite({ who, path: mindPath(who, kind), at: 5, mode, lived: [], about: [] }, text).events;
    expect(refusal(start, [write("dev", "now", "catch-up", "x")[1] as LedgerEvent])).toBe("bad_event");
    expect(refusal(start, write("dev", "core", "catch-up", "Me."))).toBe("core");
    expect(refusal(start, write("dev", "core", "user", "Me, as you wrote me."))).toBeNull();
    expect(refusal(start, write("dev", "beliefs", "seed", "seed"))).toBe("bad_event");
    const pinned = fold(reg, world, start, write("dev", "beliefs", "user", "- The cafe is mine."));
    expect(refusal(pinned, write("dev", "beliefs", "catch-up", "- The cafe is the bank's."))).toBe("pinned");
    // `now.md` is live state: the user's edit of it pins nothing.
    const now = fold(reg, world, start, write("dev", "now", "user", "Tired."));
    expect(refusal(now, write("dev", "now", "catch-up", "Awake again."))).toBeNull();
    expect(refusal(start, write(POV, "now", "catch-up", "Sam's own agent?"))).toBe("player_character");
    expect(refusal(start, [mindLivedEvent({ who: POV, beats: ["b1"], at: 5, mode: "catch-up" })])).toBe("player_character");
    expect(refusal(start, write(POV, "now", "user", "The player's own note on Sam."))).toBeNull();
    expect(refusal(start, write("nobody", "now", "user", "x"))).toBe("missing_entity");
    expect(refusal(start, [{ type: MIND_WRITE, data: { who: "dev", path: "notes/dev.md", hash: blobHash("x"), at: 1, mode: "user", lived: [], about: [] } }])).toBe("bad_event");
  });

  test("the player can switch whom he plays (D-10): the new player character has no agent, the old one gets one", () => {
    expect(povOf(world, start)).toBe(POV);
    const switched = fold(reg, world, start, [mindPovEvent("dev")]);
    expect(povOf(world, switched)).toBe("dev");
    const agentWrite = (who: string) => mindFileWrite({ who, path: mindPath(who, "now"), at: 5, mode: "catch-up", lived: [], about: [] }, `${who} now`).events;
    expect(refusal(switched, agentWrite("dev"))).toBe("player_character");
    expect(refusal(switched, agentWrite(POV))).toBeNull();
    expect(refusal(switched, [mindPovEvent("dev")])).toBe("no_change");
    // Switching back to the world's own player character clears the switch.
    const back = fold(reg, world, switched, [mindPovEvent(POV)]);
    expect(povOf(world, back)).toBe(POV);
    expect(refusal(back, agentWrite("dev"))).toBeNull();
    // What reached Sam while he was the player character is his to catch up on once he isn't.
    expect(pendingFor(beats, mindV2At(switched, POV), POV).map((b) => b.id)).toEqual(["b1"]);
  });

  test("an interview is a probe unless marked neutral; then what it changed in its story of itself folds", async () => {
    const asked = await interview(port({ answer: "Dev? Quiet lately. Something's eating him.", self: "I notice more than I say." }), { who: "mira", name: "Mira", at: 700, mind: {}, question: "What do you make of Dev lately?", by: "gm", neutral: false });
    expect(asked.folded).toBe(false);
    const probe = fold(reg, world, start, asked.out.events);
    expect(Object.keys(mindFilesAt(probe, "mira"))).toEqual([]);
    expect(probesOf(probe, "mira").map((p) => p.neutral)).toEqual([false]);
    const neutral = await interview(port({ answer: "I keep my head down.", self: "I keep my head down, and I'm tired of it." }), { who: "mira", name: "Mira", at: 710, mind: {}, question: "How do you get by?", by: "author", neutral: true });
    expect(neutral.folded).toBe(true);
    const folded = fold(reg, world, probe, neutral.out.events);
    expect(Object.keys(mindFilesAt(folded, "mira"))).toEqual(["self.md"]);
    expect(probesOf(folded, "mira").map((p) => p.neutral)).toEqual([false, true]);
  });

  test("reflection rewrites self and what it keeps in mind, never the core, citing the beats behind the memories it read", async () => {
    const mind = { "core.md": "Dev.", "memories/000000600-1.md": "The pier, eight o'clock." };
    const meta = { "memories/000000600-1.md": { hash: blobHash("The pier, eight o'clock."), at: 620, mode: "catch-up" as const, lived: ["b1"], about: [], rev: 1 } };
    const out = await reflect(port({ self: "I'm someone who warns people.", on_my_mind: "Whether Sam listened.", core: "rewritten?" }), { who: "dev", name: "Dev", at: 800, mind, meta });
    const state = fold(reg, world, start, out.events);
    expect(Object.keys(mindFilesAt(state, "dev")).sort()).toEqual(["on-my-mind.md", "self.md"]);
    expect(mindMetaAt(state, "dev")["self.md"]?.lived).toEqual(["b1"]);
  });
});

describe("recall returns nothing it didn't live", () => {
  // Dev lived b1 (whole) and b2 (in part); b3 reached only Mira; b4 reached Dev but is still pending.
  const lived = fold(reg, world, start, [mindLivedEvent({ who: "dev", beats: ["b1", "b2"], at: 615, mode: "catch-up" }), ...mindFileWrite({ who: "mira", path: "minds/mira/memories/000000615-1.md", at: 615, mode: "catch-up", lived: ["b3"], about: [] }, MIRA_MIND).events]);
  const corpus = livedCorpus({ who: "dev", mind: mindV2At(lived, "dev"), beats, texts });
  const hits = (cue: string) => recallSearch(corpus, cue).map((h) => h.doc.id);

  test("its corpus holds only what reached it and it lived, as it reached it", () => {
    expect(corpus.map((d) => d.id)).toEqual(["beat:b1", "beat:b2"]);
    const all = corpus.map((d) => d.text).join("\n");
    expect(all).not.toContain("letter");
    expect(all).not.toContain("Burn it");
    expect(all).not.toContain("bell");
    expect(all).toContain(QUOTES.b1);
  });

  test("whatever a cue, recall answers only with what it lived; a cue about what it lived finds that first", () => {
    for (const cue of ["the letter Mira slipped into her coat", "burn it before he reads it", "the bell over the door", "I took the letter, no one saw"]) {
      for (const hit of recallSearch(corpus, cue)) {
        expect(["beat:b1", "beat:b2"]).toContain(hit.doc.id);
        for (const never of ["letter", "Burn it", "bell"]) expect(hit.doc.text).not.toContain(never);
      }
    }
    expect(hits("what did Dev say about the pier?")[0]).toBe("beat:b1");
    expect(hits("the muffled voices through the door")[0]).toBe("beat:b2");
  });

  test("once it lives a pending beat, it can recall it", () => {
    expect(pendingFor(beats, mindV2At(lived, "dev"), "dev").map((b) => b.id)).toEqual(["b4"]);
    const later = fold(reg, world, lived, [mindLivedEvent({ who: "dev", beats: ["b4"], at: 625, mode: "catch-up" })]);
    expect(recallSearch(livedCorpus({ who: "dev", mind: mindV2At(later, "dev"), beats, texts }), "the bell rang")[0]?.doc.id).toBe("beat:b4");
    expect(pendingFor(beats, mindV2At(later, "dev"), "dev")).toEqual([]);
  });
});

describe("an answer that doesn't read", () => {
  test("keeps nothing and lives nothing: the batch stays pending for the next call", async () => {
    const out = await catchUp(port("I'd rather not say."), { who: "dev", name: "Dev", at: 620, mind: {}, lived: [{ beat: "b1", at: 600, whole: true, text: SURFACE.b1 }] });
    expect(out.events).toEqual([]);
    const kept = await catchUp(port({}), { who: "dev", name: "Dev", at: 620, mind: {}, lived: [{ beat: "b1", at: 600, whole: true, text: SURFACE.b1 }] });
    // An answer that reads but keeps nothing still lived the batch.
    expect(kept.events.map((e) => e.type)).toEqual(["minds.v2.lived"]);
  });
});

describe("the point-of-view render and the card", () => {
  test("the render is asked only what was there to sense and where everyone was, and answers for those it reached in part", async () => {
    const model = port({ povs: { dev: POV_B2, mira: "not asked" } });
    const r = await povRender(model, { beat: { id: "b2", surface: SURFACE.b2, quotes: QUOTES.b2, actors: [], exposure: [{ who: "dev", channel: "hearing", reach: "partial" }] }, staging: [{ who: "dev", where: "behind the counter", doing: "wiping cups", occluded: "the kitchen door" }], who: ["dev"], refs: { dev: { self: "Dev", present: {}, absent: [], strangers: [], world: [] } } });
    expect(r.povs).toEqual({ dev: POV_B2 });
    expect(r.pending).toEqual({});
    expect(model.asked[0]?.role).toBe("pov");
    const sent = model.asked[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(sent).toContain(SURFACE.b2);
    expect(sent).toContain("the kitchen door");
  });

  test("a card becomes a core, its empty parts left out and its macros read", () => {
    const text = cardCoreText({ id: "c1", name: "Mira", description: "{{char}} runs errands for {{user}}'s aunt.", personality: "", scenario: "", examples: "{{char}}: \"Not now.\"" }, { player: "Sam" });
    expect(text).toBe("# Mira\n\nMira runs errands for Sam's aunt.\n\n## How Mira talks\n\nMira: \"Not now.\"");
  });
});
