// The GM's truth-link (DEPTH-PLAN §4.4, §5.2): out of world, after characters have lived new beats
// and written what they believe, the GM files the world-truth facts the beats establish, links each
// belief that concerns a fact (a world secret included) with its reason and a confidence it derives
// from the character's own words, and writes the player character's holdings from what reached him.
// Its answer becomes `minds.fact`, `minds.link`, `minds.unlink` and `minds.settle` events, each
// checked in order against a working copy of the fold, so what it returns lands whole; the holdings
// projection (`packs/minds/core/truth.ts`) keeps secret gating, the leak check and What you know
// right. A character's beliefs are read only from its own mind; the player character's holdings only
// from beats that reached him. Nothing here decides what anyone noticed.

import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import type { Basis } from "../../shared/layer";
import { depthCall } from "../../shared/depth-settings";
import { hashParts } from "../../shared/hash";
import { blobHash } from "../../shared/stores";
import { layerEntryId } from "../../engine/ledger/layer";
import { land, readMind, type EngineRt } from "../character-engine";
import type { LedgerEvent, PackEvent } from "../../shared/ledger";
import type { DepthBeliefLink } from "../../shared/depth-views";
import { DEPTH_TEXT } from "../../shared/depth-prompts";
import { loreIsSecret } from "../../shared/lore";
import type { FactId, FactTruth, HoldingBelief, KeptFrom, KnowledgeFact } from "../../shared/minds";
import { claimFactId, FACT_TRUTHS, factId, HOLDING_BELIEFS, KNOWLEDGE_DEFAULTS, MINDS_EVENTS, parseFactId } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
import { linksOf, linkVerdict, LINK_HOWS, TRUTH_EVENTS, type LinkEventData, type TruthLinkFrom } from "../../shared/truth-links";
import { trackOwner, type WorldDoc } from "../../shared/world";
import { own } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import type { WorldState } from "../../engine/state";
import { loreFactId } from "../../engine/visibility";
import { Working } from "../../engine/working";
import { readKnowledge } from "../../packs/minds/core/state";
import type { Runtime } from "../runtime";
import { tokensOf } from "../book";
import { askRole, bareId, beatLine, beatTexts, named, personNamed, placeNamed, twice, type BeatText, type Blobs, type StageCost } from "./common";
import { beatPeople, type Beat } from "../../shared/story";
import { hasAgent, MIND_FILE_NAMES, mindPath, povOf } from "../../shared/character-engine";
import type { ModelPort } from "./port";

export interface TruthLinkInput {
  registry: Registry;
  world: WorldDoc;
  /** The fold the links are made at: the beats' and the beliefs' basis. */
  state: Readonly<WorldState>;
  texts: PromptTexts;
  /** The beats just lived. */
  beats: readonly BeatText[];
  /** The beliefs files characters just wrote, whole, each in its holder's own words. */
  beliefs: readonly { who: EntityId; path: string; text: string }[];
  /** The message the links are made at (their holdings' `since`). */
  msg: MessageId | null;
  /** The user's knowledge bounds: a claim's length and the chat's claims (Settings → Minds → Knowledge). */
  limits?: { claimChars: number; factsPerChat: number };
  /** The GM's own answer room (Settings → Depth): the call's grows from it with what it reads (`truthLinkRoom`). Absent: the role's own. */
  room?: number;
  signal?: AbortSignal;
}

export interface TruthLinkResult extends StageCost {
  /** In order: facts filed, then links, unlinks and truths settled; each checked against the fold. */
  events: PackEvent[];
  /** What of the answer couldn't be made, and why, for the turn's inspector and the spot checks. */
  refused: string[];
  blobs: Blobs;
}

/**
 * Tokens of answer room per token the truth link reads. Its answer is mostly reasoning at the Strong
 * row's effort (64–75% on the owner's dev-copy chat, DeepSeek at effort high), then the links' JSON,
 * and both grow with the beats and beliefs it reads: there a read of 6.6–11.3K tokens took 10.8K to
 * 23.4K out, and a room of 16,384 cut one of 6.6K (BOOTSTRAP-TRIAL.md).
 */
export const TRUTH_LINK_ROOM_PER_TOKEN = 4;

/** The truth link's answer room for a read of `tokens` tokens: the GM's own (`own`, Settings → Depth), or four times the read where that is more. */
export function truthLinkRoom(own: number, tokens: number): number {
  return Math.max(own, Math.ceil(tokens * TRUTH_LINK_ROOM_PER_TOKEN));
}

/**
 * Every fact the GM may link a belief to, by id with its words: the facts the chat knows, every
 * track stage with a truth, and every secret lore entry, each once. The world's own are whole, as the
 * world says them; one the chat doesn't hold yet is filed with the first link to it.
 */
export function truthCatalogue(world: WorldDoc, state: Readonly<WorldState>): Map<FactId, KnowledgeFact> {
  const out = new Map<FactId, KnowledgeFact>(Object.entries(readKnowledge(state).facts));
  for (const [track, t] of Object.entries(world.tracks)) {
    const owner = trackOwner(t);
    for (const [stage, s] of Object.entries(t.stages)) {
      const id = factId({ kind: "track", track, stage });
      if (s.truth && s.truth.trim() !== "" && !out.has(id)) out.set(id, { id, kind: "track", claim: s.truth, about: owner ? [owner] : [], truth: "true" });
    }
  }
  for (const l of Object.values(world.lore)) {
    const id = loreFactId(l);
    const kind = parseFactId(id)?.kind;
    if (!loreIsSecret(l) || out.has(id) || (kind !== "lore" && kind !== "wi") || typeof l.content !== "string" || l.content.trim() === "") continue;
    out.set(id, { id, kind, claim: l.content, about: [...l.links], truth: "true" });
  }
  return out;
}

function truthData(input: TruthLinkInput, catalogue: ReadonlyMap<FactId, KnowledgeFact>): string {
  const { world, state } = input;
  const facts = [...catalogue.values()].map((f) => `- [${f.id}] (${f.truth === "open" ? "an open question" : f.truth}) ${f.claim}`);
  const beats = input.beats.map((b) => `${beatLine(world, state, b)} What there was to sense: ${b.surface}`);
  const beliefs = input.beliefs.map((b) => `## ${named(world, state, b.who)}, ${b.path}\n${b.text}`);
  // The player character in force (D-10): the one the player switched to last, else the world's.
  const pov = povOf(world, state);
  const people = [...new Set([pov, ...input.beliefs.map((b) => b.who), ...input.beats.flatMap((b) => beatPeople(b.beat))])];
  const links = people.flatMap((who) => Object.entries(linksOf(state.packs.minds, who)).map(([fact, l]) => `- ${named(world, state, who)} → [${fact}]: ${l.holding.belief}, ${Math.round(l.holding.confidence * 100)}% (“${l.words}”), from ${"mind" in l.from ? l.from.mind : `beat ${l.from.beat}`}`));
  return [
    `The people (name each by the id given here):\n${people.map((id) => `- ${named(world, state, id)}${id === pov ? ": the player character. He has no mind of his own here; his holdings come from the beats that reached him" : ""}`).join("\n")}`,
    `The facts the chat knows, and the world's secrets (name each by the id in brackets):\n${facts.join("\n") || "- (none yet)"}`,
    `The new beats (each opens with its id in brackets):\n${beats.join("\n") || "- (none)"}`,
    `What characters wrote as beliefs:\n\n${beliefs.join("\n\n") || "(no one wrote any)"}`,
    `Your links so far for these people:\n${links.join("\n") || "- (none)"}`,
  ].join("\n\n");
}

/** Links what characters believe, and what reached the player character, to the world's truth. */
export async function truthLink(input: TruthLinkInput, model: ModelPort): Promise<TruthLinkResult> {
  const { registry, world, state } = input;
  const limits = input.limits ?? { claimChars: KNOWLEDGE_DEFAULTS.claimChars, factsPerChat: KNOWLEDGE_DEFAULTS.factsPerChat };
  const catalogue = truthCatalogue(world, state);
  const data = truthData(input, catalogue);
  const asked = await askRole(model, "gm", DEPTH_TEXT.truthLink, { world, state, texts: input.texts, data, ...(input.room !== undefined ? { maxTokens: truthLinkRoom(input.room, tokensOf(data)) } : {}), ...(input.signal ? { signal: input.signal } : {}) });
  const { answer: a, read } = asked;
  const w = new Working(registry, world, state);
  const refused: string[] = [];
  const land = (e: PackEvent, what: string): boolean => {
    const no = w.apply(e as LedgerEvent);
    if (no) refused.push(`${what}: ${no.reason}`);
    return no === null;
  };
  // A fact the chat doesn't hold yet is filed before the first link that names it.
  const file = (id: FactId): boolean => {
    if (own(readKnowledge(w.state).facts, id)) return true;
    const f = catalogue.get(id);
    return f !== undefined && land({ type: MINDS_EVENTS.fact, data: { fact: f as never } }, `the fact [${id}]`);
  };
  // A person the answer names, by id or by the one person a name names; a name naming no one is dropped.
  const person = (field: string, v: unknown): EntityId | null => {
    const who = typeof v === "string" ? personNamed(w.state, v) : null;
    if (who === null) read.drop(field, v);
    return who;
  };
  const refs = new Map<string, FactId>();
  let claims = Object.values(readKnowledge(state).facts).filter((f) => f.kind === "claim").length;
  for (const [i, raw] of read.list("facts", a.facts).entries()) {
    const g = `facts[${i}]`;
    const f = read.record(g, raw);
    if (!f) continue;
    const said = read.text(`${g}.claim`, f.claim);
    const matters = read.text(`${g}.matters`, f.matters).slice(0, limits.claimChars);
    if (said === "" || matters === "") {
      if (said !== "") refused.push(`a fact that doesn't say why it matters, or to whom: "${said.slice(0, limits.claimChars)}"`);
      read.drop(g, f);
      continue;
    }
    const claim = said.slice(0, limits.claimChars);
    if (claim.length < said.length) read.change(`${g}.claim`, said, `its first ${limits.claimChars} characters`);
    if (claims >= limits.factsPerChat) {
      refused.push(`the chat holds as many facts as Settings → Minds → Knowledge allows: "${claim}"`);
      continue;
    }
    const id = claimFactId(claim, input.msg);
    const about = [
      ...new Set(
        read.list(`${g}.about`, f.about).flatMap((x, k) => {
          const at = typeof x === "string" ? (personNamed(w.state, x) ?? placeNamed(world, x)) : null;
          if (at === null) read.drop(`${g}.about[${k}]`, x);
          return at ?? [];
        }),
      ),
    ];
    const truth: FactTruth = read.pick(`${g}.truth`, f.truth, FACT_TRUTHS, "true");
    const fact: KnowledgeFact = { id, kind: "claim", claim, about, truth, source: { msg: input.msg, at: state.clock }, matters };
    if (land({ type: MINDS_EVENTS.fact, data: { fact: fact as never } }, `the fact "${claim}"`)) {
      claims += 1;
      if (typeof f.ref === "string") refs.set(f.ref, id);
      catalogue.set(id, fact);
    }
  }
  const factOf = (v: unknown): FactId | null => {
    if (typeof v !== "string") return null;
    const t = bareId(v);
    return refs.get(t) ?? (catalogue.has(t) ? t : null);
  };
  const beliefsOf = new Map(input.beliefs.map((b) => [`${b.who}\u0000${b.path}`, b]));
  const beatsById = new Map(input.beats.map((b) => [b.beat.id, b.beat]));
  for (const [i, raw] of read.list("links", a.links).entries()) {
    const g = `links[${i}]`;
    const l = read.record(g, raw);
    if (!l) continue;
    const who = typeof l.who === "string" ? personNamed(w.state, l.who) : null;
    const fact = factOf(l.fact);
    const why = read.text(`${g}.why`, l.why);
    if (who === null || fact === null || why === "") {
      refused.push(`a link without a person in the world, a fact the chat knows, or a reason (${JSON.stringify(l).slice(0, 200)})`);
      read.drop(g, l);
      continue;
    }
    // What the GM read: the holder's own beliefs file, or a beat that reached them; nothing else.
    const fromRec = read.record(`${g}.from`, l.from);
    let from: TruthLinkFrom | null = null;
    let at = state.clock;
    let channel: string | null = null;
    if (fromRec && typeof fromRec.mind === "string" && beliefsOf.has(`${who}\u0000${fromRec.mind}`)) from = { mind: fromRec.mind };
    else if (fromRec && typeof fromRec.beat === "string") {
      const beat = beatsById.get(bareId(fromRec.beat));
      const reached = beat?.exposure.find((x) => x.who === who);
      if (beat && reached) {
        from = { beat: beat.id };
        at = beat.at;
        channel = reached.channel;
      }
    }
    if (!from) {
      refused.push(`a link for ${named(world, state, who)} that rests on neither their own beliefs nor a beat that reached them`);
      read.drop(g, l);
      continue;
    }
    const belief: HoldingBelief = read.pick(`${g}.belief`, l.belief, HOLDING_BELIEFS, "uncertain");
    const sure = read.number(`${g}.confidence`, l.confidence);
    if (sure === null) {
      refused.push(`a link for ${named(world, state, who)} without how sure they are`);
      read.drop(g, l);
      continue;
    }
    const confidence = Math.min(1, Math.max(0, sure));
    if (confidence !== sure) read.change(`${g}.confidence`, sure, confidence);
    const told = channel === "told" || channel === "message" || channel === "rumor";
    const how = read.pick(`${g}.how`, l.how, LINK_HOWS, told ? "told" : channel !== null ? "witnessed" : "inferred");
    const teller = l.by === undefined || l.by === null ? null : person(`${g}.by`, l.by);
    if (teller === who) read.drop(`${g}.by`, l.by);
    const by = teller !== null && teller !== who ? teller : null;
    // "Told", with no one who told it, is inferred.
    if (how === "told" && by === null && l.how === "told") read.change(`${g}.how`, l.how, "inferred");
    const kept = l.keptFrom === "everyone" ? "everyone" : read.list(`${g}.keptFrom`, l.keptFrom).flatMap((x, k) => person(`${g}.keptFrom[${k}]`, x) ?? []).filter((x) => x !== who);
    const keptFrom: KeptFrom | undefined = kept === "everyone" ? "everyone" : kept.length > 0 ? [...new Set(kept)] : undefined;
    if (!file(fact)) continue;
    const data: LinkEventData = { who, fact, from, words: read.words(`${g}.words`, l.words), why, how: how === "told" && by === null ? "inferred" : how, by: how === "told" ? by : null, evidence: [], belief, confidence, ...(keptFrom ? { keptFrom } : {}), msg: input.msg, at };
    // A link the GM already made, as it was, is no change.
    const before = own(linksOf(w.state.packs.minds, who), fact);
    if (before && before.why === data.why && before.holding.belief === belief && before.holding.confidence === confidence && before.words === data.words) continue;
    land({ type: TRUTH_EVENTS.link, data: data as never }, `the link of ${named(world, state, who)} to [${fact}]`);
  }
  for (const [i, raw] of read.list("unlinks", a.unlinks).entries()) {
    const u = read.record(`unlinks[${i}]`, raw);
    if (!u) continue;
    const fact = factOf(u.fact);
    const who = typeof u.who === "string" ? personNamed(w.state, u.who) : null;
    const why = read.text(`unlinks[${i}].why`, u.why);
    if (who === null || fact === null || why === "") {
      read.drop(`unlinks[${i}]`, u);
      continue;
    }
    if (own(linksOf(w.state.packs.minds, who), fact)) land({ type: TRUTH_EVENTS.unlink, data: { who, fact, why } }, `taking back the link of ${named(world, state, who)} to [${fact}]`);
  }
  for (const [i, raw] of read.list("settle", a.settle).entries()) {
    const s = read.record(`settle[${i}]`, raw);
    if (!s) continue;
    const fact = factOf(s.fact);
    const truth = typeof s.truth === "string" && (FACT_TRUTHS as readonly string[]).includes(s.truth) ? (s.truth as FactTruth) : null;
    if (fact === null || truth === null) {
      read.drop(`settle[${i}]`, s);
      continue;
    }
    if (!file(fact)) continue;
    if (own(readKnowledge(w.state).facts, fact)?.truth !== truth) land({ type: MINDS_EVENTS.settle, data: { fact, truth } }, `settling [${fact}]`);
  }
  return { events: w.events as PackEvent[], refused, blobs: {}, ...(asked.reasoning ? { reasoning: asked.reasoning } : {}), ...(asked.usage ? { usage: asked.usage } : {}) };
}

/** What the truth link at a basis reads and lands through (`Runtime` is one). */
export type LinkRt = Pick<EngineRt, "blobs" | "ledger" | "registry" | "settings">;

/**
 * The GM's truth link at `basis`, landed there as one entry (§4.4: the GM links each belief a
 * character writes that concerns a fact, and §5.1: it reads what characters write as beliefs): the
 * facts `beats` establish and the player character's holdings from what of them reached him, and
 * the beliefs `who` hold there now, each read from their own mind. Whatever wrote them (the reply's
 * remembering, a catch-up, a reflection, an interview, a settlement's catch-ups), it runs once they
 * landed. `key` names the occasion beside the basis (none: the reply's own link), and the entry's id
 * names what it read, so a link of the same beliefs and beats lands once and a later one beside it.
 * Nothing to read asks nothing.
 */
export async function linkTruths(rt: LinkRt, chatId: ChatId, userId: UserId, basis: Basis, o: { who: readonly EntityId[]; beats: readonly Beat[]; key?: readonly string[]; model: ModelPort; signal?: AbortSignal }): Promise<{ linked: boolean; refused: string[] }> {
  const at = await rt.ledger.foldAtBasis(chatId, userId, basis);
  if (!at) throw new Error("the reply it reads left the chat's chain");
  const settings = await rt.settings.get(userId);
  const replaced = new Set(at.story.replaced.map((r) => r.id));
  const beliefs: { who: EntityId; path: string; text: string; hash: string }[] = [];
  for (const who of new Set(o.who)) {
    if (!hasAgent(at.world, at.state, who)) continue;
    const text = (await readMind(rt.blobs, userId, at.state, who, replaced))[MIND_FILE_NAMES.beliefs];
    if (text !== undefined && text.trim() !== "") beliefs.push({ who, path: mindPath(who, "beliefs"), text, hash: blobHash(text) });
  }
  const beats = await beatTexts(rt, userId, o.beats);
  if (beats.length === 0 && beliefs.length === 0) return { linked: false, refused: [] };
  const { claimChars, factsPerChat } = settings.minds.knowledge;
  const r = await twice(() => truthLink({ registry: rt.registry, world: at.world, state: at.state, texts: settings.prompts.texts, beats, beliefs, msg: basis.message, limits: { claimChars, factsPerChat }, room: depthCall(settings, "gm").maxTokens, ...(o.signal ? { signal: o.signal } : {}) }, o.model), o.signal);
  if (r.events.length === 0) return { linked: false, refused: r.refused };
  const read = o.key === undefined ? [] : [...o.key, hashParts(...beliefs.flatMap((b) => [b.who, b.hash]), ...beats.map((b) => b.beat.id))];
  await land(rt, chatId, userId, basis, "truthlink", { events: r.events, blobs: r.blobs, ...(r.reasoning ? { reasoning: r.reasoning } : {}) }, layerEntryId("truthlink", chatId, basis.message, basis.swipe, ...read), "gm");
  return { linked: true, refused: r.refused };
}

/** The GM's links for one character, as GM → Minds shows them beside the truth (§4.4): their words, the fact's, how they stand, and why. */
export function beliefLinksAt(state: Readonly<WorldState>, who: EntityId): DepthBeliefLink[] {
  const facts = readKnowledge(state).facts;
  return Object.entries(linksOf(state.packs.minds, who)).map(([fact, l]) => {
    const f = own(facts, fact);
    return { belief: l.words, truth: f?.claim ?? null, verdict: linkVerdict(l.holding.belief, f?.truth ?? null), why: l.why };
  });
}

/** The GM's links for one character at the chat's head. */
export async function beliefLinks(rt: Runtime, chatId: string, userId: string, who: EntityId): Promise<DepthBeliefLink[]> {
  const basis = await rt.ledger.basisFor(chatId, userId);
  const head = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis) : null;
  return head ? beliefLinksAt(head.state, who) : [];
}
