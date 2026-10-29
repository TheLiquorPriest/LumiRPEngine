// The minds' knowledge step on the fake host (DESIGN §24.11; AGENT-LOOP-PLAN §11, Increment 0): after
// the reply, one call for the scene works out who learned what, and the engine keeps only what each
// person could have learned: no one witnesses what they weren't there for, a teller holds what they
// tell, an inference rests on what its person holds or witnessed, and one held less surely than the
// threshold is a suspicion. Then what everyone sees of it: each mind reads its own holdings, the
// narrator's Who knows what follows its scope and the chat's own narrator knowledge, a fact at a time
// (who holds it, who keeps it secret, who here doesn't know it) that its caps keep or leave out whole,
// a secret first among what someone holds; Play's What you know lists the player character's own (a
// secret told to them waiting for their Apply), GM → Minds shows every holding with its witness entry,
// and a swipe, a Re-run and a Branch carry them with the path. With knowledge off, a chat plays as it
// did before knowledge was tracked.

import { describe, expect, test } from "bun:test";
import { liveLore } from "../../src/backend/book-lore";
import { checkKnowledge, knowledgeBatches, knowledgeContext, type KnowledgeTurn } from "../../src/backend/knowledge-step";
import { toChain } from "../../src/backend/ledger-io";
import { buildSections } from "../../src/backend/sections-build";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import { claimFactId, DEFAULT_MINDS_MEMORY, factId, KNOWLEDGE_DEFAULTS, MEMORY_ANSWER_V2, MIND_ANSWER_FORMATS, MINDS_EVENTS, witnessRef, type Holding, type KnowledgeFact, type KnowledgeSettings, type KnownView, type LearnEventData, type MindsGmView, type MindsSlice } from "../../src/shared/minds";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { NarratorView } from "../../src/shared/settings";
import type { WorldDoc } from "../../src/shared/world";
import { markedText } from "../../src/engine/feed";
import type { WorldState } from "../../src/engine/state";
import { findLeaks, unrevealedSecretFacts, unrevealedSecrets } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { factsOf, holdingsOf, isSuspicion, knowersOf, rankedHoldings, type InPlay } from "../../src/packs/minds/core/knowledge";
import { readCharacter, readSlice } from "../../src/packs/minds/core/state";
import { Rig } from "../support/rig";

const POV = "pov";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
/** Marcus's shop, where a Port Alder weekday puts him, Danny and the player character. */
const SHOP = "alder_automotive";
/** Where Priya is while the letter is read. */
const MARINA = "alder_harbor_marina";

/** What Marcus isn't saying: Port Alder's secret track's truth. */
const DEBT = factId({ kind: "track", track: "s_shop_trouble", stage: "truth" });
/** Words of it that only someone who holds it may read. */
const DEBT_WORDS = ["$112,000", "lift-equipment loan"];
/** The author gives Marcus the shop's trouble from the start, kept from everyone (Build → World → Minds). */
const MARCUS_KEEPS: JsonObject = { [MARCUS]: { [DEBT]: { keptFrom: "everyone" } } };

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
const KNOWLEDGE = "You keep track of who knows what in the roleplay world";

/** Every event type that records knowledge. */
const KNOWLEDGE_EVENTS: readonly string[] = [MINDS_EVENTS.fact, MINDS_EVENTS.learn, MINDS_EVENTS.forget, MINDS_EVENTS.keep, MINDS_EVENTS.settle, MINDS_EVENTS.knowledge];

/** What each mind, memory and knowledge call was given, in the order asked. */
interface Seen {
  minds: { name: string; context: string }[];
  memories: { name: string; system: string; context: string }[];
  knowledge: string[];
}

/**
 * The helper as these tests script it: every mind thinks plainly, every memory answers `memory`'s
 * answer for them, the knowledge step answers `knowledge`'s for the turn it reads, interpret finds no
 * action, and every other step finds nothing.
 */
function models(rig: Rig, knowledge: (context: string) => JsonObject, memory: (name: string) => JsonObject = () => ({})): Seen {
  const seen: Seen = { minds: [], memories: [], knowledge: [] };
  rig.host.quietReply = (req) => {
    const system = req.messages[0]?.content ?? "";
    const context = req.messages[1]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) {
      seen.minds.push({ name: mind, context });
      return JSON.stringify({ monologue: `${mind} turns it over.`, depiction: `${mind} looks up`, intent: "Wait and see.", reactions: [], mood: "calm" });
    }
    const remembers = MEMORY.exec(system)?.[1];
    if (remembers) {
      seen.memories.push({ name: remembers, system, context });
      return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], ...memory(remembers) });
    }
    if (system.startsWith(KNOWLEDGE)) {
      seen.knowledge.push(context);
      return JSON.stringify(knowledge(context));
    }
    if (system.includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals: [] });
  };
  return seen;
}

/** The knowledge step's answer for the turn whose reply ends on a mark, by mark; any other turn's learns nothing. */
function onReply(answers: Readonly<Record<string, JsonObject>>): (context: string) => JsonObject {
  return (context) => Object.entries(answers).find(([mark]) => context.includes(mark))?.[1] ?? {};
}

/** The latest context `name` was given, or "". */
function lastFor(list: readonly { name: string; context: string }[], name: string): string {
  return list.findLast((c) => c.name === name)?.context ?? "";
}

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/** Marcus and Danny at the shop for the next turn, and whoever `more` names where it says, as the GM moves people. */
async function atShop(rig: Rig, chatId: string, more: Readonly<Record<string, string>> = {}): Promise<void> {
  const at = { [MARCUS]: SHOP, [DANNY]: SHOP, ...more };
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: Object.entries(at).map(([entity, to]) => ({ op: "move", entity, to })) }));
}

/**
 * A Port Alder chat at Marcus's shop early on a weekday: the player character, Marcus and Danny there,
 * Priya at the marina. Marcus and Danny think every turn (the author's `always`, the thresholds
 * keeping everyone else Background, no refreshes). `minds` joins the world's minds config (what the
 * author gives people from the start) and `lore` its lore.
 */
async function shopChat(rig: Rig, setup: { minds?: JsonObject; lore?: readonly JsonObject[]; owners?: Readonly<Record<string, string>> } = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [MARCUS, DANNY] }, ...setup.minds } }));
  for (const value of setup.lore ?? []) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: String(value.id), value }));
  // A track's owner, as Build → Tracks sets it.
  const draft = Object.keys(setup.owners ?? {}).length > 0 ? (rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc) : null;
  for (const [track, owner] of Object.entries(setup.owners ?? {})) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: track, value: { ...(draft?.tracks[track] as unknown as JsonObject), owner } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  await atShop(rig, chatId, { [POV]: SHOP, [PRIYA]: MARINA });
  return chatId;
}

/** Every event the chat's displayed path records: each turn's and each entry added after it. */
async function recorded(rig: Rig, chatId: string): Promise<LedgerEvent[]> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const messages = await rig.host.chats.messages(chatId, rig.host.userId);
  return messages.flatMap((m) => {
    const rec = core?.journal.messages[m.id]?.ledger.swipes[String(m.swipeId)];
    return rec ? [...rec.events, ...rec.post.flatMap((p) => p.events)] : [];
  });
}

/** The learnings among some events. */
function learnings(events: readonly LedgerEvent[]): LearnEventData[] {
  return events.flatMap((e) => (e.type === MINDS_EVENTS.learn && "data" in e ? [e.data as unknown as LearnEventData] : []));
}

/** The id of the fact the chat holds under `claim`, else "". */
function factOf(state: Readonly<WorldState>, claim: string): string {
  return Object.values(factsOf(readSlice(state))).find((f) => f.claim === claim)?.id ?? "";
}

/** The claims of what someone holds, in order. */
function claimsOf(state: Readonly<WorldState>, who: string): string[] {
  const slice = readSlice(state);
  return Object.keys(holdingsOf(slice, who))
    .map((id) => factsOf(slice)[id]?.claim ?? id)
    .sort();
}

/** Play's What you know, as the page holds it. */
function whatYouKnow(rig: Rig, chatId: string): KnownView | undefined {
  const panels = rig.latestView(chatId)?.panels;
  return isRecord(panels) ? (panels["minds.known"] as KnownView | undefined) : undefined;
}

/** Every state Play was pushed, as text. */
function pushed(rig: Rig): string {
  return JSON.stringify(rig.host.sent.filter((m) => m.type === "lre.state.snapshot" || m.type === "lre.state.delta"));
}

async function chipsOf(rig: Rig, chatId: string) {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

describe("Port Alder's third letter (assess-knowledge §6.7)", () => {
  const LETTERS = "Marcus has had three anonymous letters this month about the township claim and Tuesday's board vote";
  const DEADLINE = "The third letter, signed 'A friend', gives him until the end of the month";
  const APRIL = "The first letter said only 'Ask about April'; Marcus burned the first two";
  const SENDER = "Who sent the letters";
  const GUESS = "Whoever sent the letters knows about the township claim";
  /**
   * The knowledge step's answer for the scene: Marcus's own mail; the deadline read over the player
   * character's shoulder; the rest told aloud by Marcus; who sent them, an open question; Danny's guess
   * at the sender, from the letters he was told of; and Priya, at the marina, said to have read it too.
   */
  const ANSWER: JsonObject = {
    facts: [
      { ref: "letters", claim: LETTERS, about: ["Marcus Delgado"], truth: "true" },
      { ref: "deadline", claim: DEADLINE, about: ["Marcus Delgado"], truth: "true" },
      { ref: "april", claim: APRIL, about: ["Marcus Delgado"], truth: "true" },
      { ref: "sender", claim: SENDER, about: ["Marcus Delgado"], truth: "open" },
      { ref: "guess", claim: GUESS, about: ["Marcus Delgado"], truth: "open" },
    ],
    learned: [
      { who: ["Marcus Delgado"], fact: "letters", how: "witnessed" },
      { who: ["Marcus Delgado"], fact: "deadline", how: "witnessed" },
      { who: ["Marcus Delgado"], fact: "april", how: "witnessed" },
      { who: ["you", "Danny Okafor"], fact: "deadline", how: "witnessed" },
      { who: ["you", "Danny Okafor"], fact: "letters", how: "told", by: "Marcus Delgado" },
      { who: ["you", "Danny Okafor"], fact: "april", how: "told", by: "Marcus Delgado" },
      { who: ["Priya Nair"], fact: "deadline", how: "witnessed" },
    ],
    inferred: [{ who: "Danny Okafor", fact: "guess", confidence: 0.4, evidence: ["letters"], belief: "true" }],
    doubted: [],
  };

  test("Jordan and Danny hold the letters, the deadline witnessed and the rest told by Marcus; Danny's guess is a suspicion; nobody knows who sent them; Priya, there the next turn, holds none of it and the narrator is told so; Danny never reads Marcus's secret", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    // Marcus's memory says he told them too: with knowledge tracked, telling is the knowledge step's alone.
    const seen = models(rig, onReply({ "THIRD-LETTER": ANSWER }), (name): JsonObject => (name === "Marcus Delgado" ? { told: [{ to: ["Danny Okafor", "Jordan Ellis"], what: "MEMORY-TOLD the letters came from the township" }] } : {}));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "I lean over Marcus's shoulder to read the letter.", "Marcus slits open the third envelope at the counter. Danny reads it over your shoulder: signed 'A friend', it gives Marcus until the end of the month. Marcus says the first one said only 'Ask about April', and that he burned the first two. THIRD-LETTER");
    const first = await stateOf(rig, chatId);
    const slice = readSlice(first.state);
    const [letters, deadline, april, guess] = [LETTERS, DEADLINE, APRIL, GUESS].map((claim) => factOf(first.state, claim));
    for (const id of [letters, deadline, april, guess]) expect(id).not.toBe("");

    // The author's secret was seeded at the chat's first knowledge turn: Marcus's, from the start, kept from everyone.
    expect(holdingsOf(slice, MARCUS)[DEBT]).toMatchObject({ how: "authored", by: null, belief: "true", confidence: 1, keptFrom: "everyone" });
    // His own mail: he saw all of it.
    for (const id of [letters, deadline, april]) expect(holdingsOf(slice, MARCUS)[id]).toMatchObject({ how: "witnessed", by: null, belief: "true", confidence: 1 });
    // Jordan and Danny read the deadline themselves, and were told the rest by Marcus.
    for (const who of [POV, DANNY]) {
      expect(holdingsOf(slice, who)[deadline]).toMatchObject({ how: "witnessed", by: null, belief: "true", confidence: 1 });
      for (const id of [letters, april]) expect(holdingsOf(slice, who)[id]).toMatchObject({ how: "told", by: MARCUS, belief: "true", confidence: 1 });
    }
    // Danny's telling rests on the `told` entry it added to his witness log.
    const told = readCharacter(first.state, DANNY).witness.find((w) => w.how === "told" && w.by === MARCUS && w.what === LETTERS);
    if (!told) throw new Error("Danny's log has no line of Marcus telling him");
    expect(holdingsOf(slice, DANNY)[letters]?.evidence).toEqual([witnessRef(told)]);
    // A memory's telling reached no one: the memory step answered without `told`, as asked.
    expect(seen.memories.length).toBeGreaterThan(0);
    for (const m of seen.memories) {
      expect(m.system).toContain(MEMORY_ANSWER_V2);
      expect(m.system).not.toContain('"told"');
    }
    for (const who of [POV, DANNY]) expect(readCharacter(first.state, who).witness.some((w) => w.what.includes("MEMORY-TOLD"))).toBe(false);

    // Danny's guess at the sender rests on the letters he holds, and is under the threshold: a suspicion.
    const hunch = holdingsOf(slice, DANNY)[guess];
    if (!hunch) throw new Error("Danny holds no guess");
    expect(hunch).toMatchObject({ how: "inferred", by: null, evidence: [letters], belief: "true", confidence: 0.4 });
    expect(isSuspicion(hunch, KNOWLEDGE_DEFAULTS.threshold)).toBe(true);
    // Nobody knows who sent them: no one holds that question, and no open fact anyone holds is held as known.
    expect(knowersOf(slice, factOf(first.state, SENDER))).toEqual([]);
    for (const [id, f] of Object.entries(factsOf(slice))) {
      if (f.truth !== "open") continue;
      for (const who of knowersOf(slice, id)) {
        const h = holdingsOf(slice, who)[id];
        expect([who, id, h !== undefined && h.belief === "true" && !isSuspicion(h, KNOWLEDGE_DEFAULTS.threshold)]).toEqual([who, id, false]);
      }
    }
    // Priya was at the marina: the engine refused her reading it.
    expect(holdingsOf(slice, PRIYA)).toEqual({});
    expect(rig.host.logs.some((l) => l.includes("refused Priya Nair wasn't there to witness"))).toBe(true);

    // Jordan's learning came back as `learn` changes, automatic by default: applied, each with its Undo.
    const learned = (await chipsOf(rig, chatId)).filter((c) => c.kind === "undo" && c.label.startsWith("Learned: "));
    expect(learned.map((c) => c.label.slice("Learned: ".length).split(" · ")[0]).sort()).toEqual([APRIL, DEADLINE, LETTERS].sort());
    for (const c of learned) expect(c.actions.map((a) => a.id)).toContain("undo");
    // Play's What you know lists the letters as told by Marcus.
    expect(whatYouKnow(rig, chatId)?.tracking).toBe(true);
    expect(whatYouKnow(rig, chatId)?.items.find((i) => i.claim === LETTERS)).toMatchObject({ how: "told", byName: "Marcus Delgado", belief: "true", suspicion: false, open: false });
    // GM → Minds shows Danny's holdings, each with the witness entry it rests on.
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })).minds as MindsGmView;
    const dannys = gm.characters.find((c) => c.entity === DANNY)?.holdings ?? [];
    expect(dannys.find((h) => h.fact === letters)).toMatchObject({ how: "told", byName: "Marcus Delgado", suspicion: false, evidenceShown: [{ ref: witnessRef(told), kind: "witness", text: expect.stringContaining(LETTERS) }] });
    expect(dannys.find((h) => h.fact === deadline)?.evidenceShown).toEqual([{ ref: expect.any(String), kind: "witness", text: expect.stringContaining(DEADLINE) }]);
    expect(dannys.find((h) => h.fact === guess)).toMatchObject({ how: "inferred", suspicion: true, evidenceShown: [{ ref: letters, kind: "fact", text: LETTERS }] });

    // Priya comes in for the next turn.
    await atShop(rig, chatId, { [PRIYA]: SHOP });
    await rig.turn(chatId, "Morning, Priya.", "Priya comes in with a tray of coffees.");
    const second = await stateOf(rig, chatId);
    expect(holdingsOf(readSlice(second.state), PRIYA)).toEqual({});
    // The narrator is told she doesn't know any of it (in the narrator's default knowledge, everyone in the scene).
    const section = rig.host.section("Who knows what");
    for (const claim of [LETTERS, DEADLINE, APRIL]) expect(section).toContain(`- Priya Nair doesn't know: ${claim}`);
    expect(section).not.toContain("- Priya Nair: ");
    // Danny's next mind reads what he knows, his guess as a suspicion.
    const danny = lastFor(seen.minds, "Danny Okafor");
    expect(danny).toContain("## What you know\n");
    expect(danny).toContain(`- ${LETTERS} (told by Marcus Delgado)`);
    expect(danny).toContain(`- ${DEADLINE} (saw it)`);
    expect(danny).toContain(`- Suspects: ${GUESS} (worked it out, about 40% sure)`);
    // Marcus's secret never reaches Danny's mind or memory, nor did the author's seeding ride twice.
    for (const c of [...seen.minds, ...seen.memories].filter((x) => x.name === "Danny Okafor")) for (const words of DEBT_WORDS) expect(c.context).not.toContain(words);
    expect((await recorded(rig, chatId)).filter((e) => e.type === MINDS_EVENTS.fact && "data" in e && isRecord(e.data.fact) && e.data.fact.id === DEBT)).toHaveLength(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

/** A turn at the shop as the knowledge step reads it, on `state`: the player character with Marcus and Danny, Priya away. */
function shopTurn(rig: Rig, world: WorldDoc, state: Readonly<WorldState>, settings: KnowledgeSettings = { ...KNOWLEDGE_DEFAULTS }): KnowledgeTurn {
  const msg = "m-check";
  return {
    reg: rig.rt.registry,
    world,
    state,
    before: state,
    messageId: msg,
    user: "I watch the street.",
    reply: "Marcus mutters about the letters while Danny sweeps.",
    presence: { said: { msg, at: state.clock, place: SHOP, who: [MARCUS, DANNY], saw: [] }, met: null, left: [] },
    happened: [],
    settings,
    memory: { witness: DEFAULT_MINDS_MEMORY.witness },
    hideJson: true,
    pinned: [],
    named: (name) => Object.keys(state.entities).find((id) => id === name.trim() || state.entities[id]?.name.toLowerCase() === name.trim().toLowerCase()) ?? null,
  };
}

describe("the engine's checks on the knowledge step's answer", () => {
  const SEDAN = "A black sedan idled outside the shop at dawn";
  const WATCHED = { ref: "n1", claim: "Someone has been watching the shop", about: ["Marcus Delgado"] };

  test("no one witnesses where they weren't, a teller holds what they tell, an inference rests on what its person holds or saw, confidence runs from 0 to 1, the player character never infers, and an inference under the threshold is a suspicion", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, onReply({ "SEDAN-MARK": { facts: [{ ref: "n1", claim: SEDAN }], learned: [{ who: ["you", "Danny Okafor"], fact: "n1", how: "witnessed" }] } }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "I open the shutters.", "Outside, a black sedan idles at the curb, then pulls away. SEDAN-MARK");
    const { state, world } = await stateOf(rig, chatId);
    const sedan = factOf(state, SEDAN);
    const sawIt = readCharacter(state, DANNY).witness.find((w) => w.how === "saw" && w.what === SEDAN);
    if (!sawIt) throw new Error("Danny's log has no line of the sedan");
    const turn = shopTurn(rig, world, state);
    const scene = knowledgeBatches(turn);
    expect(scene).toEqual([[POV, MARCUS, DANNY]]);
    const check = (raw: JsonObject) => checkKnowledge(turn, scene[0] ?? [], raw);
    const watched = claimFactId(WATCHED.claim, turn.messageId);

    // Perception: Priya, at the marina, witnessed nothing; Danny, there, did.
    const absent = check({ facts: [WATCHED], learned: [{ who: ["Danny Okafor", "Priya Nair"], fact: "n1", how: "witnessed" }] });
    expect(absent.refused).toEqual([expect.stringContaining("Priya Nair wasn't there to witness")]);
    expect(learnings(absent.events).map((l) => l.who)).toEqual([[DANNY]]);

    // A teller holds what they tell: Marcus may tell Danny his secret; Danny can't tell the player character it.
    const hearsay = check({ learned: [{ who: ["you"], fact: DEBT, how: "told", by: "Danny Okafor" }] });
    expect(hearsay.refused).toEqual([expect.stringContaining("Danny Okafor told what they don't hold")]);
    expect([hearsay.events, hearsay.proposals]).toEqual([[], []]);
    const confided = check({ learned: [{ who: ["Danny Okafor"], fact: DEBT, how: "told", by: "Marcus Delgado" }] });
    expect(confided.refused).toEqual([]);
    expect(learnings(confided.events)).toEqual([expect.objectContaining({ who: [DANNY], fact: DEBT, how: "told", by: MARCUS })]);

    // Evidence: a fact he doesn't hold, a line of someone else's log, or nothing at all, holds nothing.
    const elsewhere = witnessRef({ at: state.clock, what: "Marcus burned the first two letters", how: "saw", by: null, place: SHOP });
    for (const evidence of [[DEBT], [elsewhere], []]) {
      const unheld = check({ facts: [WATCHED], inferred: [{ who: "Danny Okafor", fact: "n1", confidence: 0.6, evidence }] });
      expect(unheld.refused).toEqual([expect.stringContaining(`Danny Okafor infers from what they neither hold nor witnessed (${evidence.join(", ") || "nothing"})`)]);
      expect(unheld.events).toEqual([]);
    }
    // A confidence runs from 0 to 1, and only someone else than the player character infers.
    expect(check({ facts: [WATCHED], inferred: [{ who: "Danny Okafor", fact: "n1", confidence: 1.5, evidence: [sedan] }] }).refused).toEqual([expect.stringContaining("Danny Okafor's inference has no confidence from 0 to 1")]);
    expect(check({ facts: [WATCHED], inferred: [{ who: "you", fact: "n1", confidence: 0.6, evidence: [sedan] }] }).refused).toEqual([expect.stringContaining("or by the player character")]);

    // From what he holds and what he saw himself: held as given, a suspicion under the threshold, and not over it.
    const held = (confidence: number) => {
      const out = check({ facts: [WATCHED], inferred: [{ who: "Danny Okafor", fact: "n1", confidence, evidence: [sedan, witnessRef(sawIt)] }] });
      expect(out.refused).toEqual([]);
      const w = new Working(rig.rt.registry, world, state);
      for (const e of out.events) expect(w.apply(e)).toBeNull();
      const h = holdingsOf(readSlice(w.state), DANNY)[watched];
      if (!h) throw new Error("Danny holds no inference");
      expect(h).toMatchObject({ how: "inferred", by: null, evidence: [sedan, witnessRef(sawIt)], belief: "true", confidence });
      return isSuspicion(h, KNOWLEDGE_DEFAULTS.threshold);
    };
    expect(held(0.4)).toBe(true);
    expect(held(0.9)).toBe(false);

    // What the call reads: who could perceive it, each one's holdings and witness log by the refs an
    // answer cites. A call about one person (Settings → Minds → Knowledge, per character) reads theirs alone.
    const context = knowledgeContext(turn, scene[0] ?? []);
    const perceived = context.split("## Who could perceive it\n")[1]?.split("\n\n")[0] ?? "";
    expect(perceived.split("\n")).toEqual([`- Jordan Ellis (id: ${POV}; the player character, "you"): there throughout`, `- Marcus Delgado (id: ${MARCUS}): there throughout`, `- Danny Okafor (id: ${DANNY}): there throughout`]);
    expect(context).toContain(`- [${sedan}] ${SEDAN} (saw it)`);
    expect(context).toContain(`- [${witnessRef(sawIt)}] `);
    const each = { ...KNOWLEDGE_DEFAULTS, batch: "character" as const };
    expect(knowledgeBatches(shopTurn(rig, world, state, each))).toEqual([[POV], [MARCUS], [DANNY]]);
    const dannys = knowledgeContext(shopTurn(rig, world, state, each), [DANNY]);
    expect(dannys).toContain(`### Danny Okafor (id: ${DANNY})`);
    expect(dannys).not.toContain(`### Marcus Delgado (id: ${MARCUS})`);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("what each mind, the narrator and the player see", () => {
  test("each mind reads only what it holds: Danny what he saw, Marcus what he saw and the secret the author gave him, neither the other's", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const DANNY_SAW = "A black sedan idled across the street before dawn";
    const MARCUS_SAW = "A fourth envelope came through the mail slot, and Marcus pocketed it unopened";
    const answer: JsonObject = {
      facts: [
        { ref: "d", claim: DANNY_SAW, about: [] },
        { ref: "m", claim: MARCUS_SAW, about: ["Marcus Delgado"] },
      ],
      learned: [
        { who: ["Danny Okafor"], fact: "d", how: "witnessed" },
        { who: ["Marcus Delgado"], fact: "m", how: "witnessed" },
      ],
    };
    const seen = models(rig, onReply({ "DAWN-MARK": answer }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "I unlock the shop.", "Danny squints out at the street while Marcus fishes the mail out of the slot. DAWN-MARK");
    await atShop(rig, chatId);
    await rig.turn(chatId, "Morning, both of you.", "They nod.");
    const danny = lastFor(seen.minds, "Danny Okafor");
    const marcus = lastFor(seen.minds, "Marcus Delgado");
    expect(danny).toContain(`- ${DANNY_SAW} (saw it)`);
    expect(danny).not.toContain(MARCUS_SAW);
    for (const words of DEBT_WORDS) expect(danny).not.toContain(words);
    // Marcus's secret reads in what he knows, as his own, whom he keeps it from with it.
    expect(marcus).toContain(`- ${MARCUS_SAW} (saw it)`);
    expect(marcus).toContain("(from the start); keeps it from everyone");
    for (const words of DEBT_WORDS) expect(marcus).toContain(words);
    expect(marcus).not.toContain(DANNY_SAW);
    // The player character was given neither.
    expect(holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)).toEqual({});
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the narrator's Who knows what follows its scope: everyone here's holdings with secrets marked, or the player character's alone", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const TAPED = "Marcus taped the third letter inside the office door";
    const SEDAN = "A black sedan idled across the street before dawn";
    const answer: JsonObject = {
      facts: [
        { ref: "t", claim: TAPED, about: [] },
        { ref: "s", claim: SEDAN, about: ["Danny Okafor"] },
      ],
      learned: [
        { who: ["you", "Danny Okafor", "Marcus Delgado"], fact: "t", how: "witnessed" },
        { who: ["Danny Okafor"], fact: "s", how: "witnessed" },
      ],
    };
    models(rig, onReply({ "TAPE-MARK": answer }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "I watch Marcus at the office door.", "Marcus tapes the letter inside the office door while Danny keeps glancing at the window. TAPE-MARK");
    // The section's scope as the GM sets it, as the narrator's knowledge sets it for every section with
    // none of its own: everyone in the scene (`gm`), then the player character's own (`player`).
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "feed", section: "knowledge", to: { scope: "gm" } }] }));
    await atShop(rig, chatId);
    await rig.turn(chatId, "Anything else?", "They get back to work.");
    const everyone = rig.host.section("Who knows what");
    for (const line of [`- You: ${TAPED} (saw it)`, `- Danny Okafor: ${TAPED} (saw it)`, `- Marcus Delgado: ${TAPED} (saw it)`]) expect(everyone).toContain(line);
    // What only Danny holds goes in marked as his; Marcus's secret as a secret known to him alone.
    expect(everyone).toContain(`- Danny Okafor: ${SEDAN} (saw it) [unknown to you; known to Danny Okafor]`);
    expect(everyone).toMatch(/- Marcus Delgado: Alder Automotive is about \$112,000 behind[^\n]*\(from the start\); keeps it from everyone \[secret; known to Marcus Delgado\]/);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "feed", section: "knowledge", to: { scope: "player" } }] }));
    await atShop(rig, chatId);
    await rig.turn(chatId, "And now?", "Quiet.");
    const own = rig.host.section("Who knows what");
    expect(own).toContain(`- You: ${TAPED} (saw it)`);
    for (const words of [SEDAN, "Danny Okafor", "Marcus Delgado", "doesn't know", ...DEBT_WORDS]) expect(own).not.toContain(words);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the player character's learning applies with an Undo, and Undo restores the holding they had before it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const CLUTCH = "The tow truck needs a new clutch before the township inspection";
    const clutch: KnowledgeFact = { id: claimFactId(CLUTCH, null), kind: "claim", claim: CLUTCH, about: [MARCUS], truth: "true", source: { msg: null, at: 0 } };
    models(rig, onReply({ "CLUTCH-MARK": { learned: [{ who: ["you"], fact: clutch.id, how: "told", by: "Marcus Delgado" }] } }));
    const chatId = await shopChat(rig);
    // Marcus has known it all along; the player character only guessed at it (corrections, as the GM writes them).
    const now = (await stateOf(rig, chatId)).state.clock;
    const events: LedgerEvent[] = [
      { type: MINDS_EVENTS.fact, data: { fact: clutch as unknown as JsonObject } },
      { type: MINDS_EVENTS.learn, data: { who: [MARCUS], fact: clutch.id, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, msg: null, at: now } },
      { type: MINDS_EVENTS.learn, data: { who: [POV], fact: clutch.id, how: "guessed", by: null, evidence: [], belief: "uncertain", confidence: 0.3, msg: null, at: now } },
    ];
    await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "clutch", target: "head", entry: { kind: "fix", events } });
    await rig.host.settle();
    const before = holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)[clutch.id];
    expect(before).toMatchObject({ how: "guessed", belief: "uncertain", confidence: 0.3 });

    await rig.turn(chatId, "What's wrong with the tow truck?", "Marcus wipes his hands: it's the clutch, and it won't pass the township inspection without a new one. CLUTCH-MARK");
    expect(holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)[clutch.id]).toMatchObject({ how: "told", by: MARCUS, belief: "true", confidence: 1 });
    const chip = (await chipsOf(rig, chatId)).find((c) => c.kind === "undo" && c.label.startsWith(`Learned: ${CLUTCH}`));
    if (!chip) throw new Error("no Learned chip");
    expect(chip.actions.map((a) => a.id)).toContain("undo");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    const after = readSlice((await stateOf(rig, chatId)).state);
    expect(holdingsOf(after, POV)[clutch.id]).toEqual(before);
    expect(holdingsOf(after, MARCUS)[clutch.id]).toMatchObject({ how: "authored", confidence: 1 });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a secret told to the player character waits for their Apply; then What you know and their Quests open it, and nothing Play is pushed names the secret's track", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, onReply({ "TRUTH-MARK": { learned: [{ who: ["you"], fact: DEBT, how: "told", by: "Marcus Delgado" }] } }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "Morning, Marcus.", "Marcus grunts a hello from under a truck.");
    await atShop(rig, chatId);
    await rig.turn(chatId, "What's really going on with the shop?", "Marcus finally puts down the wrench and tells you everything. TRUTH-MARK");
    // A reveal, confirm by default: offered with Apply and No, its chip wording no secret, and nothing opened yet.
    const reveal = (await chipsOf(rig, chatId)).find((c) => c.kind === "confirm" && c.label.startsWith("A secret the story revealed to you"));
    if (!reveal) throw new Error("no reveal chip");
    expect(reveal.actions.map((a) => a.id)).toEqual(["confirm", "reject"]);
    expect(holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)[DEBT]).toBeUndefined();
    for (const words of DEBT_WORDS) expect(pushed(rig)).not.toContain(words);

    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reveal.id, choice: "confirm" }));
    expect(holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)[DEBT]).toMatchObject({ how: "told", by: MARCUS, belief: "true" });
    expect(whatYouKnow(rig, chatId)?.items.find((i) => i.claim.startsWith("Alder Automotive is about $112,000 behind"))).toMatchObject({ how: "told", byName: "Marcus Delgado" });
    // A secret the player character holds counts as revealed on their screens.
    const panels = rig.latestView(chatId)?.panels;
    const quests = JSON.stringify(isRecord(panels) ? panels["story.quests"] : null);
    expect(quests).toContain("What Marcus isn't saying");
    expect(quests).toContain("$112,000");
    // Its track's own id never reaches Play, What you know's rows included.
    expect(pushed(rig)).not.toContain("s_shop_trouble");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("Who knows what, a fact at a time, as the chat's own narrator knowledge has it", () => {
  const TAPED = "Marcus taped the third letter inside the office door";
  const SEDAN = "A black sedan idled across the street before dawn";
  const DEADLINE = "The third letter gives Marcus until the end of the month";
  const SCENE: NarratorView = { knowledge: "scene", secrets: "marked" };
  const OMIT: NarratorView = { knowledge: "scene", secrets: "omit" };
  const OWN: NarratorView = { knowledge: "pov", secrets: "marked" };
  /** The lines of a section's text. */
  const bullets = (content: string | null | undefined): string[] => (content ?? "").split("\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2)] : []));

  /**
   * The shop after a turn the knowledge step reads so: everyone there saw the letter taped up, Danny
   * alone saw the sedan, and the player character alone read the deadline. Marcus keeps the shop's
   * trouble from everyone, as the author gave it him; Priya joins them for the next turn. Returns the
   * chat and the trouble's claim.
   */
  async function tapedChat(rig: Rig): Promise<{ chatId: string; debt: string }> {
    const answer: JsonObject = {
      facts: [
        { ref: "t", claim: TAPED, about: [] },
        { ref: "s", claim: SEDAN, about: ["Danny Okafor"] },
        { ref: "d", claim: DEADLINE, about: ["Marcus Delgado"] },
      ],
      learned: [
        { who: ["you", "Danny Okafor", "Marcus Delgado"], fact: "t", how: "witnessed" },
        { who: ["Danny Okafor"], fact: "s", how: "witnessed" },
        { who: ["you"], fact: "d", how: "witnessed" },
      ],
    };
    models(rig, onReply({ "TAPE-MARK": answer }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "I watch Marcus at the office door.", "Marcus tapes the letter inside the office door while Danny keeps glancing at the window. TAPE-MARK");
    await atShop(rig, chatId, { [PRIYA]: SHOP });
    const debt = factsOf(readSlice((await stateOf(rig, chatId)).state))[DEBT]?.claim ?? "";
    for (const words of DEBT_WORDS) expect(debt).toContain(words);
    return { chatId, debt };
  }

  test("the chat's own choice (GM → This chat → Knowledge): everyone in the scene gives each one's holdings, a secret marked, and who here doesn't know what the player character holds; the player character's gives theirs alone; with secrets left out the secret's line goes and every fact is still told whole", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, debt } = await tapedChat(rig);
    const told = async (narrator: NarratorView): Promise<string[]> => {
      expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, narrator }))).toEqual({ knowledge: null, narrator });
      await atShop(rig, chatId, { [PRIYA]: SHOP });
      await rig.turn(chatId, "What now?", "They get on with the morning.");
      return bullets(rig.host.section("Who knows what"));
    };
    // Each fact whole: who holds it (the player character first), then who here doesn't know it.
    const deadline = [`You: ${DEADLINE} (saw it)`, `Danny Okafor doesn't know: ${DEADLINE}`, `Marcus Delgado doesn't know: ${DEADLINE}`, `Priya Nair doesn't know: ${DEADLINE}`];
    const taped = [`You: ${TAPED} (saw it)`, `Danny Okafor: ${TAPED} (saw it)`, `Marcus Delgado: ${TAPED} (saw it)`, `Priya Nair doesn't know: ${TAPED}`];
    const sedan = markedText({ text: `Danny Okafor: ${SEDAN} (saw it)`, known: "scene", who: "Danny Okafor" });
    // Everyone in the scene: the facts the player character holds, the most relevant first, then what
    // is beyond them, Marcus's secret first, marked as known to him alone.
    expect(await told(SCENE)).toEqual([...deadline, ...taped, secretMarkText(`Marcus Delgado: ${debt} (from the start); keeps it from everyone`, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING), sedan]);
    // Secrets left out: the secret's line goes, and nothing else.
    expect(await told(OMIT)).toEqual([...deadline, ...taped, sedan]);
    // The player character's own knowledge: theirs alone.
    expect(await told(OWN)).toEqual([`You: ${DEADLINE} (saw it)`, `You: ${TAPED} (saw it)`]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a cap leaves out whole facts from the end, those beyond the player character's riding after theirs, never a fact's lines without the rest, in every scope and with secrets marked or left out", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, debt } = await tapedChat(rig);
    const reg = rig.rt.registry;
    const followed = await stateOf(rig, chatId);
    // The GM gives the section a scope of its own in this chat: what the people here know.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "feed", section: "knowledge", to: { scope: "scene" } }] }));
    const scoped = await stateOf(rig, chatId);
    /** The section at a cap, one token a line so the cap is a number of lines, with the shared budget no limit. */
    const section = (at: { world: WorldDoc; state: Readonly<WorldState> }, view: NarratorView, cap: number): { scope: string | undefined; lines: string[] } => {
      const { world, state } = at;
      const built = buildSections({ registry: reg, world, state, secrets: unrevealedSecrets(reg, world, state), narrator: { chat: view, view }, wording: SECRET_MARK_WORDING, budget: Number.MAX_SAFE_INTEGER, mindsBudget: Number.MAX_SAFE_INTEGER, knowledge: { ...KNOWLEDGE_DEFAULTS, narratorTokens: cap }, said: "", planned: { outcome: [], montage: [] }, outline: [], elapsed: null, hasEntry: () => true, cost: (content) => bullets(content).length, seen: () => {}, warn: () => {} });
      const out = built.sections.find((s) => s.slot === "knowledge");
      return { scope: out?.scope, lines: bullets(out?.content) };
    };
    /** Lines as runs of one fact each: the claim a line tells of. */
    const runs = (lines: readonly string[]): { claim: string; lines: string[] }[] => {
      const out: { claim: string; lines: string[] }[] = [];
      for (const line of lines) {
        const claim = [DEADLINE, TAPED, debt, SEDAN].find((c) => line.includes(c)) ?? line;
        const last = out.at(-1);
        if (last?.claim === claim) last.lines.push(line);
        else out.push({ claim, lines: [line] });
      }
      return out;
    };
    const marked = /\[(?:unknown to you|secret); [^\]]*\]$/;
    const cases = [
      { at: followed, view: SCENE, scope: "gm", facts: [DEADLINE, TAPED, debt, SEDAN] },
      { at: followed, view: OMIT, scope: "gm", facts: [DEADLINE, TAPED, SEDAN] },
      { at: followed, view: OWN, scope: "player", facts: [DEADLINE, TAPED] },
      { at: scoped, view: SCENE, scope: "scene", facts: [DEADLINE, TAPED, debt, SEDAN] },
      { at: scoped, view: OMIT, scope: "scene", facts: [DEADLINE, TAPED, SEDAN] },
    ];
    for (const c of cases) {
      const whole = section(c.at, c.view, Number.MAX_SAFE_INTEGER);
      expect(whole.scope).toBe(c.scope);
      // Each fact in one run, the most relevant first: those the player character holds, then those beyond them.
      const facts = runs(whole.lines);
      expect(facts.map((f) => f.claim)).toEqual(c.facts);
      const theirs = facts.filter((f) => !f.lines.some((l) => marked.test(l)));
      const beyond = facts.filter((f) => f.lines.every((l) => marked.test(l)));
      expect(theirs.length + beyond.length).toBe(facts.length);
      for (let cap = 0; cap <= whole.lines.length; cap++) {
        // What fits whole, from the first: the player character's facts while they fit, then those beyond them while they fit.
        const fit: string[] = [];
        for (const part of [theirs, beyond])
          for (const f of part) {
            if (fit.length + f.lines.length > cap) break;
            fit.push(...f.lines);
          }
        expect({ scope: c.scope, view: c.view, cap, lines: section(c.at, c.view, cap).lines }).toEqual({ scope: c.scope, view: c.view, cap, lines: fit });
      }
    }
  });

  test("a secret ranks first among what someone holds, one the world keeps from the player character as much as one its holder keeps, and never loses a tie to an ordinary fact on its id", async () => {
    const SPRING = "Marcus wants the shop sold by spring";
    // Danny told the debt and an ordinary thing about Marcus in one breath: alike in all but their ids.
    const spring = claimFactId(SPRING, "m1");
    const told: Holding = { how: "told", by: MARCUS, evidence: [], since: { msg: "m1", at: 480 }, belief: "true", confidence: 1 };
    const facts: Record<string, KnowledgeFact> = { [DEBT]: { id: DEBT, kind: "track", claim: "The shop is behind on its loan", about: [MARCUS], truth: "true" }, [spring]: { id: spring, kind: "claim", claim: SPRING, about: [MARCUS], truth: "true" } };
    const slice = (held: Record<string, Holding>): Pick<MindsSlice, "knowledge"> => ({ knowledge: { facts, holdings: { [DANNY]: held } } });
    const ranked = (held: Record<string, Holding>, secret: InPlay["secret"]): string[] => rankedHoldings(slice(held), DANNY, { here: [POV, MARCUS, DANNY, SHOP], recent: new Set(["m1"]), secret }).map((h) => h.id);
    expect(spring < DEBT).toBe(true);
    // Ordinary both, the id decides, the same every time; the world's secret comes first whatever its id.
    expect(ranked({ [spring]: told, [DEBT]: told }, () => false)).toEqual([spring, DEBT]);
    expect(ranked({ [spring]: told, [DEBT]: told }, (id) => id === DEBT)).toEqual([DEBT, spring]);
    // One Danny keeps from Priya comes first too, though it is about no one here and older than the turn.
    expect(ranked({ [spring]: told, [DEBT]: { ...told, since: { msg: null, at: 0 }, keptFrom: [PRIYA] } }, () => false)).toEqual([DEBT, spring]);

    // In the narrator's section, at one fact a person: each shows the debt, Danny's as told to him.
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, onReply({ "SPRING-MARK": { facts: [{ ref: "n1", claim: SPRING, about: ["Marcus Delgado"] }], learned: [{ who: ["Marcus Delgado"], fact: "n1", how: "witnessed" }, { who: ["Danny Okafor"], fact: "n1", how: "told", by: "Marcus Delgado" }, { who: ["Danny Okafor"], fact: DEBT, how: "told", by: "Marcus Delgado" }] } }));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { knowledge: { perPerson: 1 } } } }));
    await rig.turn(chatId, "Morning.", "They look up.");
    await atShop(rig, chatId);
    await rig.turn(chatId, "I give them a minute.", "Marcus takes Danny aside and tells him everything. SPRING-MARK");
    const { state } = await stateOf(rig, chatId);
    const debt = factsOf(readSlice(state))[DEBT]?.claim ?? "";
    expect(holdingsOf(readSlice(state), DANNY)[DEBT]).toMatchObject({ how: "told", by: MARCUS });
    expect(holdingsOf(readSlice(state), DANNY)[factOf(state, SPRING)]).toMatchObject({ how: "told", by: MARCUS });
    await atShop(rig, chatId);
    await rig.turn(chatId, "Everything all right?", "Nobody answers.");
    expect(bullets(rig.host.section("Who knows what"))).toEqual([
      secretMarkText(`Danny Okafor: ${debt} (told by Marcus Delgado)`, ["Danny Okafor"], ["Jordan Ellis"], SECRET_MARK_WORDING),
      secretMarkText(`Marcus Delgado: ${debt} (from the start); keeps it from everyone`, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING),
    ]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("swipes, Re-run and Branch", () => {
  test("what was learned follows the path: a Re-run asks the knowledge step again, and a swipe, a Re-run and a Branch of a later turn carry it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const DRAWER = "Marcus keeps the letters in the top drawer of his desk";
    const NOBODY = "Marcus has shown the letters to no one but Danny";
    // Marcus says it aloud, each telling of the turn its own: his to tell, the others' as told.
    const answers = Object.fromEntries(
      [
        ["DRAWER-MARK", DRAWER],
        ["NOBODY-MARK", NOBODY],
      ].map(([mark, claim]): [string, JsonObject] => [mark, { facts: [{ ref: "n1", claim, about: ["Marcus Delgado"] }], learned: [{ who: ["Marcus Delgado"], fact: "n1", how: "witnessed" }, { who: ["you", "Danny Okafor"], fact: "n1", how: "told", by: "Marcus Delgado" }] }]),
    );
    const seen = models(rig, onReply(answers));
    const chatId = await shopChat(rig);
    const holds = async (who: string, chat = chatId): Promise<string[]> => claimsOf((await stateOf(rig, chat)).state, who);
    await rig.turn(chatId, "Where do you keep them?", "Marcus taps the top drawer of his desk. DRAWER-MARK");
    expect(await holds(DANNY)).toEqual([DRAWER]);
    expect(await holds(POV)).toEqual([DRAWER]);

    // A Re-run of the turn asks again, and its answer is what this swipe holds.
    const asked = seen.knowledge.length;
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Marcus says he has shown them to no one but Danny. NOBODY-MARK");
    expect(seen.knowledge.length).toBe(asked + 1);
    expect(seen.knowledge.at(-1)).toContain("NOBODY-MARK");
    expect(await holds(DANNY)).toEqual([NOBODY]);
    expect(await holds(POV)).toEqual([NOBODY]);
    // Back on the first swipe, its own.
    const first = rig.host.head(chatId);
    if (!first) throw new Error("no reply");
    rig.host.navigate(chatId, first.id, 0);
    await rig.host.settle();
    expect(await holds(DANNY)).toEqual([DRAWER]);

    // A later turn, swiped by Re-narrate and by Re-run: what the first turn taught stays.
    await atShop(rig, chatId);
    await rig.turn(chatId, "Thanks.", "Marcus nods.");
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Marcus nods slowly.");
    expect(await holds(DANNY)).toEqual([DRAWER]);
    expect(await holds(POV)).toEqual([DRAWER]);
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Marcus just nods.");
    expect(await holds(DANNY)).toEqual([DRAWER]);
    expect(await holds(POV)).toEqual([DRAWER]);

    // A Branch from here folds the same knowledge, and its GM → Minds shows it.
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const branch = rig.host.branch(chatId, head.id);
    await rig.rt.ledger.open(branch, rig.host.userId);
    await rig.host.settle();
    expect(readSlice((await stateOf(rig, branch)).state).knowledge).toEqual(readSlice((await stateOf(rig, chatId)).state).knowledge);
    const branched = rig.body(await rig.send({ type: "lre.gm", chatId: branch })).minds as MindsGmView;
    expect(branched.characters.find((c) => c.entity === DANNY)?.holdings.map((h) => [h.claim, h.how, h.byName])).toEqual([[DRAWER, "told", "Marcus Delgado"]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("knowledge off", () => {
  const DANNY_SECRET: JsonObject = { id: "danny_debt", title: "Danny's debt", content: "HELD-MARK: Danny owes the marina three months' slip fees.", keys: [], links: [], secret: true, gate: "false", holders: [DANNY] };

  test("with knowledge off the chat plays as before it: no knowledge call or event, the memory step records telling, minds read their secret lines, and no Who knows what", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { knowledge: { enabled: false } } } }));
    // Were the knowledge step asked, it would teach them something.
    const seen = models(
      rig,
      () => ({ facts: [{ ref: "n1", claim: "ASKED-MARK the knowledge step ran" }], learned: [{ who: ["you", "Danny Okafor"], fact: "n1", how: "witnessed" }] }),
      (name): JsonObject => (name === "Danny Okafor" ? { told: [{ to: ["Marcus Delgado"], what: "DANNY-TOLD the pontoon is sold" }] } : {}),
    );
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS }, lore: [DANNY_SECRET] });
    await rig.turn(chatId, "Morning.", "They look up.");
    await atShop(rig, chatId);
    await rig.turn(chatId, "Busy day?", "Danny shrugs.");
    const { state } = await stateOf(rig, chatId);

    expect(seen.knowledge).toEqual([]);
    expect(rig.host.quietCalls.some((c) => (c.messages[0]?.content ?? "").startsWith(KNOWLEDGE))).toBe(false);
    expect((await recorded(rig, chatId)).filter((e) => KNOWLEDGE_EVENTS.includes(e.type))).toEqual([]);
    expect(readSlice(state).knowledge).toBeUndefined();
    expect((rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.minds ?? []).some((t) => t.purpose === "knowledge")).toBe(false);
    // The memory step answers with `told`, and what it says was told reaches who was there.
    expect(seen.memories.length).toBeGreaterThan(0);
    for (const m of seen.memories) expect(m.system).toContain(MIND_ANSWER_FORMATS.memory);
    expect(readCharacter(state, MARCUS).witness.filter((w) => w.how === "told").map((w) => [w.by, w.what])).toContainEqual([DANNY, "DANNY-TOLD the pontoon is sold"]);
    // A mind reads its own secret in who it is, turn after turn.
    const danny = lastFor(seen.minds, "Danny Okafor");
    expect(danny).toContain("- Your secret, Danny's debt: HELD-MARK: Danny owes the marina three months' slip fees.");
    expect(danny).not.toContain("## What you know\n");
    // No Who knows what for the narrator.
    expect(rig.host.section("Who knows what")).toBe("");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("switched off mid-chat, the next turn records it once and every reader reads as before knowledge, while what was learned stays recorded; switched on again, it reads again", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const SEDAN = "A black sedan idled outside the shop at dawn";
    const seen = models(rig, onReply({ "SEDAN-MARK": { facts: [{ ref: "n1", claim: SEDAN }], learned: [{ who: ["you", "Danny Okafor"], fact: "n1", how: "witnessed" }] } }));
    const chatId = await shopChat(rig);
    const tracking = async (): Promise<unknown[]> => (await recorded(rig, chatId)).flatMap((e) => (e.type === MINDS_EVENTS.knowledge && "data" in e ? [e.data.on] : []));
    await rig.turn(chatId, "I open the shutters.", "A black sedan idles at the curb, then pulls away. SEDAN-MARK");
    await atShop(rig, chatId);
    await rig.turn(chatId, "Did you see that?", "Danny nods.");
    expect(rig.host.section("Who knows what")).toContain(`- You: ${SEDAN} (saw it)`);
    expect(lastFor(seen.minds, "Danny Okafor")).toContain(`- ${SEDAN} (saw it)`);
    expect(await tracking()).toEqual([]);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { knowledge: { enabled: false } } } }));
    const asked = seen.knowledge.length;
    for (const [text, reply] of [["Anyway.", "They get back to work."], ["Lunch?", "Danny laughs."]] as const) {
      await atShop(rig, chatId);
      await rig.turn(chatId, text, reply);
    }
    expect(seen.knowledge.length).toBe(asked);
    expect(await tracking()).toEqual([false]);
    expect(rig.host.section("Who knows what")).toBe("");
    expect(lastFor(seen.minds, "Danny Okafor")).not.toContain("## What you know\n");
    expect(whatYouKnow(rig, chatId)).toEqual({ tracking: false, items: [] });
    // What was learned stays in the chat's state, for when it's switched on again.
    const off = readSlice((await stateOf(rig, chatId)).state);
    expect(off.knowledge?.off).toBe(true);
    expect(claimsOf((await stateOf(rig, chatId)).state, DANNY)).toEqual([SEDAN]);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { knowledge: { enabled: true } } } }));
    await atShop(rig, chatId);
    await rig.turn(chatId, "Back to it.", "They nod.");
    expect(await tracking()).toEqual([false, true]);
    expect(seen.knowledge.length).toBe(asked + 1);
    expect(lastFor(seen.minds, "Danny Okafor")).toContain(`- ${SEDAN} (saw it)`);
    expect(whatYouKnow(rig, chatId)?.items.map((i) => i.claim)).toEqual([SEDAN]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the review's fixes (Increment 0)", () => {
  const SEEN = "SEEN-MARK: Jordan saw the boat go down from the breakwater";
  /** An entry a user's book holds, as the host's World Info editor writes it. */
  const bookEntry = (content: string) => ({ comment: "The breakwater", content, keys: ["breakwater"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {} });
  /** The lines of a section's text. */
  const bullets = (content: string | null | undefined): string[] => (content ?? "").split("\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2)] : []));

  test("H1: the player character's own World Info secret is never told to the narrator as kept from them, whatever the view", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const chatId = await shopChat(rig);
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    await rig.host.books.createEntry(bookId, bookEntry(`The breakwater is older than the pier.\n{{// Secret (known to Jordan): ${SEEN}}}`), rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [bookId] }, rig.host.userId);
    // The first turn with the book seeds what its mark gives the player character; the sections read it from the next.
    await rig.turn(chatId, "Morning.", "The shop opens.");
    const told = async (narrator: NarratorView): Promise<string[]> => {
      rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, narrator }));
      await atShop(rig, chatId);
      await rig.turn(chatId, "I look out at the water.", "Gulls wheel over the harbor.");
      return bullets(rig.host.section("Who knows what"));
    };
    // Theirs plainly, no secret kept from them, though they keep it from everyone else as the mark says.
    const yours = `You: ${SEEN} (from the start); keeps it from everyone`;
    const unknowing = [`Danny Okafor doesn't know: ${SEEN}`, `Marcus Delgado doesn't know: ${SEEN}`];
    // The default view, everyone in the scene with secrets marked: theirs plainly, and who here doesn't know it.
    const scene = await told({ knowledge: "scene", secrets: "marked" });
    expect(scene.filter((l) => l.includes(SEEN))).toEqual([yours, ...unknowing]);
    // Secrets left out: theirs is no secret kept from them, so it stays.
    expect((await told({ knowledge: "scene", secrets: "omit" })).filter((l) => l.includes(SEEN))).toEqual([yours, ...unknowing]);
    // Their own view, secrets marked: theirs, plainly.
    expect(await told({ knowledge: "pov", secrets: "marked" })).toEqual([yours]);
    const { state } = await stateOf(rig, chatId);
    expect(Object.values(holdingsOf(readSlice(state), POV)).map((h) => h.how)).toEqual(["authored"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("M1: an entry indexed from a book with an older hash is seeded once, as its book entry, however many turns read it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, bookEntry(`{{// Secret (known to Jordan): ${SEEN}}}`), rig.host.userId);
    const chatId = await shopChat(rig, { lore: [{ id: "l_seen", title: "The breakwater", content: SEEN, keys: ["breakwater"], links: [], source: { kind: "book", bookId, entryId, hash: "indexed-before-it-was-marked" } }] });
    for (const n of [1, 2, 3]) {
      await atShop(rig, chatId);
      await rig.turn(chatId, `Turn ${n}.`, "The morning goes on.");
    }
    const events = await recorded(rig, chatId);
    const wi = factId({ kind: "wi", book: bookId, entry: entryId, mark: null });
    const seeded = events.flatMap((e) => (e.type === MINDS_EVENTS.fact && "data" in e && isRecord(e.data.fact) ? [String(e.data.fact.id)] : []));
    expect(seeded).toEqual([wi]);
    expect(learnings(events).map((l) => [l.fact, l.who])).toEqual([[wi, [POV]]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("M5: a secret track the player character owns is theirs from the start, yet none of its stages reaches Play", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const chatId = await shopChat(rig, { owners: { s_shop_trouble: POV } });
    await rig.turn(chatId, "I open the shutters.", "The morning is slow.");
    const { state, world } = await stateOf(rig, chatId);
    const slice = readSlice(state);
    expect(holdingsOf(slice, POV)[DEBT]?.how).toBe("authored");
    const truth = world.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
    expect(findLeaks(truth, unrevealedSecrets(rig.rt.registry, world, state))).toEqual([truth]);
    for (const words of DEBT_WORDS) expect(pushed(rig)).not.toContain(words);
    expect(whatYouKnow(rig, chatId)?.items.some((i) => DEBT_WORDS.some((w) => i.claim.includes(w)))).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("M2, M3, S2, L1 and S1: inference, telling, part-time presence, the chat's limit and the player character's screens", async () => {
    const RUMOUR = "Someone at the marina has been asking after the shop's lease";
    const SEDAN = "A black sedan idled outside the shop at dawn";
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const chatId = await shopChat(rig, { minds: { holdings: { [MARCUS]: { [DEBT]: { keptFrom: "everyone", belief: "true", confidence: 0.4 } } } } });
    await rig.turn(chatId, "I open the shutters.", "Marcus counts the till.");
    const { state, world } = await stateOf(rig, chatId);
    const turn = shopTurn(rig, world, state);
    const scene = knowledgeBatches(turn)[0] ?? [];
    const sawSedan = { facts: [{ ref: "s", claim: SEDAN }], learned: [{ who: ["Marcus Delgado", "Danny Okafor"], fact: "s", how: "witnessed" }] };

    // M2: an inference less sure than Marcus's holding leaves it; a surer one replaces it and keeps it from everyone still.
    const weaker = checkKnowledge(turn, scene, { ...sawSedan, inferred: [{ who: "Marcus Delgado", fact: DEBT, confidence: 0.3, evidence: ["s"] }] });
    expect(weaker.refused).toEqual([expect.stringContaining("Marcus Delgado already holds it at least as surely")]);
    const surer = checkKnowledge(turn, scene, { ...sawSedan, inferred: [{ who: "Marcus Delgado", fact: DEBT, confidence: 0.8, evidence: ["s"] }] });
    expect(learnings(surer.events).find((l) => l.fact === DEBT)).toEqual(expect.objectContaining({ how: "inferred", confidence: 0.8, keptFrom: "everyone" }));

    // M3: Danny's guess, told on, is no surer for the telling: the player character only suspects it.
    const guessed = checkKnowledge(turn, scene, { ...sawSedan, facts: [...sawSedan.facts, { ref: "r", claim: RUMOUR }], inferred: [{ who: "Danny Okafor", fact: "r", confidence: 0.4, evidence: ["s"] }] });
    const w = new Working(rig.rt.registry, world, state);
    w.applyAll(guessed.events);
    const rumour = claimFactId(RUMOUR, turn.messageId);
    const toldOn = checkKnowledge({ ...turn, state: w.state }, scene, { learned: [{ who: ["you"], fact: rumour, how: "told", by: "Danny Okafor" }] });
    expect(toldOn.proposals.map((p) => [p.type, p.learn.belief, p.learn.confidence])).toEqual([["learn", "true", 0.4]]);
    expect(isSuspicion(toldOn.proposals[0]?.learn ?? { confidence: 1 }, KNOWLEDGE_DEFAULTS.threshold)).toBe(true);

    // S2: Danny, who left partway, can't be held to have witnessed anything in the turn.
    const partway = checkKnowledge({ ...turn, presence: { ...turn.presence, left: [DANNY] } }, scene, sawSedan);
    expect(partway.refused).toEqual([expect.stringContaining("Danny Okafor was there for only part of the turn")]);
    expect(learnings(partway.events).map((l) => l.who)).toEqual([[MARCUS]]);

    // L1: a new fact two calls both make counts once against the chat's limit.
    const one = { ...turn, settings: { ...KNOWLEDGE_DEFAULTS, factsPerChat: 1 } };
    const spent = { facts: new Set<string>(), learnings: 0 };
    expect(checkKnowledge(one, [MARCUS], sawSedan, spent).refused).toEqual([]);
    const again = checkKnowledge(one, [DANNY], { ...sawSedan, facts: [...sawSedan.facts, { ref: "r", claim: RUMOUR }] }, spent);
    expect(again.refused).toEqual([expect.stringContaining(RUMOUR)]);

    // S1: what the player character would learn carrying the secret's words is a reveal of that secret, whose chip never words it.
    const truth = world.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
    const overheard = checkKnowledge({ ...turn, reply: truth, settings: { ...KNOWLEDGE_DEFAULTS, claimChars: truth.length + 40 } }, scene, { facts: [{ ref: "d", claim: `Jordan overheard it: ${truth}` }], learned: [{ who: ["you"], fact: "d", how: "witnessed" }] });
    expect(overheard.proposals.map((p) => [p.type, p.learn.fact])).toEqual([["reveal", DEBT]]);
  });
});

describe("the re-review's fixes (Increment 0)", () => {
  const MILL = "Jordan burned the old mill down years ago";
  /** A user's book entry as an earlier build kept a secret: stored switched off, its secrecy in its LRE fields. */
  const oldSecret = (content: string, lore: JsonObject) => ({ comment: "The old mill", content, keys: ["mill"], disabled: true, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: { [LEDGER_NAMESPACE]: { lore } } });

  test("N1: an earlier build's gated secret naming the player character among its holders stays shut to them: not in What you know, and caught by the leak screen", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const chatId = await shopChat(rig);
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, oldSecret(`${MILL}.`, { secret: true, gate: 'flag("never_set")', holders: [POV] }), rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [bookId] }, rig.host.userId);
    await rig.turn(chatId, "I open the shutters.", "The morning is slow.");
    const { state, world } = await stateOf(rig, chatId);
    const wi = factId({ kind: "wi", book: bookId, entry: entryId, mark: null });
    // Recorded, so the book isn't read again, but held by no one: its gate decides when it opens to the player character.
    expect(factsOf(readSlice(state))[wi]?.claim).toBe(`${MILL}.`);
    expect(holdingsOf(readSlice(state), POV)[wi]).toBeUndefined();
    const live = await liveLore(rig.host, world, chatId, rig.host.userId);
    expect(findLeaks(MILL, unrevealedSecrets(rig.rt.registry, live, state)).length).toBeGreaterThan(0);
    expect(JSON.stringify(whatYouKnow(rig, chatId))).not.toContain("old mill");
    expect(pushed(rig)).not.toContain("old mill");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("N2, N5: the debt truth told word for word, longer than a claim may be, reveals the debt stage: its Apply opens it in What you know, on the Quests page and to the narrator", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    let truth = "";
    models(rig, (context): JsonObject => (context.includes("CONFESS-MARK") ? { facts: [{ ref: "d", claim: truth, about: ["Marcus Delgado"] }], learned: [{ who: ["Marcus Delgado"], fact: "d", how: "witnessed" }, { who: ["you"], fact: "d", how: "told", by: "Marcus Delgado" }] } : {}));
    const chatId = await shopChat(rig, { minds: { holdings: MARCUS_KEEPS } });
    await rig.turn(chatId, "Morning, Marcus.", "Marcus grunts a hello from under a truck.");
    truth = (await stateOf(rig, chatId)).world.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
    expect(truth.length).toBeGreaterThan(KNOWLEDGE_DEFAULTS.claimChars);
    await atShop(rig, chatId);
    await rig.turn(chatId, "What's really going on with the shop?", `Marcus puts down the wrench. "${truth}" CONFESS-MARK`);
    const reveal = (await chipsOf(rig, chatId)).find((c) => c.kind === "confirm" && c.label.startsWith("A secret the story revealed to you"));
    if (!reveal) throw new Error("no reveal chip");
    // Its chip words no secret, and What you know holds nothing of it until Apply.
    for (const words of DEBT_WORDS) expect(reveal.label).not.toContain(words);
    expect(holdingsOf(readSlice((await stateOf(rig, chatId)).state), POV)[DEBT]).toBeUndefined();

    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reveal.id, choice: "confirm" }));
    // What they hold is the secret the claim carried, as surely as Marcus said it.
    const { state } = await stateOf(rig, chatId);
    expect(holdingsOf(readSlice(state), POV)[DEBT]).toMatchObject({ how: "told", by: MARCUS, belief: "true", confidence: 1 });
    const debt = factsOf(readSlice(state))[DEBT]?.claim ?? "";
    expect(truth.startsWith(debt.replace(/…$/, ""))).toBe(true);
    expect(whatYouKnow(rig, chatId)?.items.find((i) => i.claim === debt)).toMatchObject({ how: "told", byName: "Marcus Delgado" });
    const panels = rig.latestView(chatId)?.panels;
    expect(JSON.stringify(isRecord(panels) ? panels["story.quests"] : null)).toContain("$112,000");
    // The narrator is told the player character knows it, never that it is kept from them.
    await atShop(rig, chatId);
    await rig.turn(chatId, "So what now?", "Marcus shrugs.");
    const told = rig.host.section("Who knows what") ?? "";
    expect(told.split("\n")).toContain(`- You: ${debt} (told by Marcus Delgado)`);
    expect(told).not.toContain("kept from Jordan Ellis");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("N4, N5: a claim reveals a secret only when it carries every phrase of it, as the step wrote it: part of one is refused and never shown, and two secrets whole are refused", async () => {
    const HARBOR = "The harbor master owes money to every boat owner on the pier. He keeps the stolen ledger hidden under the bait shop floor.";
    const OWES = "The harbor master owes money to every boat owner on the pier.";
    // A secret whose last sentence is too short for the leak screen's phrases: it still has to be told.
    const SHELF = "The money went missing from the bait shop's back shelf. It was Helen.";
    const SHELF_FIRST = "The money went missing from the bait shop's back shelf.";
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, (context): JsonObject => (context.includes("PIER-MARK") ? { facts: [{ ref: "h", claim: OWES }], learned: [{ who: ["you"], fact: "h", how: "witnessed" }] } : {}));
    const chatId = await shopChat(rig, {
      lore: [
        { id: "l_harbor", title: "The harbor master's debts", content: HARBOR, keys: ["harbor master"], links: [], secret: true, gate: "self.cash > 100000" },
        { id: "l_shelf", title: "The back shelf", content: SHELF, keys: ["back shelf"], links: [], secret: true, gate: "self.cash > 100000" },
      ],
    });
    await rig.turn(chatId, "Morning.", "The shop opens.");
    await atShop(rig, chatId);
    await rig.turn(chatId, "Any news from the pier?", `Danny leans in. "${OWES}" PIER-MARK`);
    const { state, world } = await stateOf(rig, chatId);
    // Part of a secret is no learning of it: the player character holds nothing, What you know never shows the rest, and the leak screen keeps the whole entry.
    expect(claimsOf(state, POV)).toEqual([]);
    expect(JSON.stringify(whatYouKnow(rig, chatId))).not.toContain("ledger");
    expect(findLeaks("He keeps the stolen ledger hidden under the bait shop floor", unrevealedSecrets(rig.rt.registry, world, state)).length).toBeGreaterThan(0);

    const truth = world.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
    // The reply holds every secret's words, so only the coverage check decides what each claim reveals.
    const turn = { ...shopTurn(rig, world, state), reply: `${truth} ${HARBOR} ${SHELF}` };
    const scene = knowledgeBatches(turn)[0] ?? [];
    const told = (claim: string) => checkKnowledge(turn, scene, { facts: [{ ref: "c", claim }], learned: [{ who: ["you"], fact: "c", how: "witnessed" }] });
    // The long truth whole, read before it is cut to a claim: a reveal of its stage.
    expect(told(truth).proposals.map((p) => [p.type, p.learn.fact])).toEqual([["reveal", DEBT]]);
    const part = told(OWES);
    expect([part.proposals, part.refused]).toEqual([[], [expect.stringContaining("only part of a secret")]]);
    const both = told(`${truth} ${HARBOR}`);
    expect([both.proposals, both.refused]).toEqual([[], [expect.stringContaining("more than one secret")]]);
    // N4b: a short last sentence ("It was Helen") counts as part of the secret: the first sentence alone is refused, and only the whole reveals it.
    const shelf = unrevealedSecretFacts(rig.rt.registry, world, state).find((s) => s.text === SHELF)?.fact ?? "";
    expect(shelf).not.toBe("");
    const first = told(SHELF_FIRST);
    expect([first.proposals, first.refused]).toEqual([[], [expect.stringContaining("only part of a secret")]]);
    expect(told(SHELF).proposals.map((p) => [p.type, p.learn.fact])).toEqual([["reveal", shelf]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("N3: a telling never leaves anyone less sure than they were: Danny's doubt told to Marcus leaves Marcus's own secret as he holds it, and Marcus's surer telling keeps whom Danny kept it from", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    models(rig, () => ({}));
    const chatId = await shopChat(rig, { minds: { holdings: { ...MARCUS_KEEPS, [DANNY]: { [DEBT]: { belief: "false", confidence: 0.3, keptFrom: [PRIYA] } } } } });
    await rig.turn(chatId, "I open the shutters.", "Marcus counts the till.");
    const { state, world } = await stateOf(rig, chatId);
    expect(holdingsOf(readSlice(state), MARCUS)[DEBT]).toMatchObject({ belief: "true", confidence: 1, keptFrom: "everyone" });
    const turn = shopTurn(rig, world, state);
    const scene = knowledgeBatches(turn)[0] ?? [];
    const doubtful = checkKnowledge(turn, scene, { learned: [{ who: ["Marcus Delgado"], fact: DEBT, how: "told", by: "Danny Okafor" }] });
    expect([doubtful.events, doubtful.proposals, doubtful.refused]).toEqual([[], [], []]);
    const sure = checkKnowledge(turn, scene, { learned: [{ who: ["Danny Okafor"], fact: DEBT, how: "told", by: "Marcus Delgado" }] });
    expect(learnings(sure.events)).toEqual([expect.objectContaining({ who: [DANNY], fact: DEBT, how: "told", by: MARCUS, belief: "true", confidence: 1, keptFrom: [PRIYA] })]);
  });
});
