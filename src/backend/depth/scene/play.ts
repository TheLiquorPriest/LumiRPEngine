// The character agent at play (DEPTH-PLAN §4.4 Play, §5.2 "Character, play", §1.3): a character
// playing as its own agent gets its own point of view of the scene, beat by beat, and answers with
// what it does and says now (the observable part of its beat: the act, what there was to sense of
// it, its exact words) and its take (private: what it noticed, what it makes of it, how it lands),
// which it keeps as its working memory of the scene until it remembers the scene. It may think back
// first: a cue in its own voice, answered over its own mind and what it lived, never the archive.
//
// What a play reads is its own mind and what reached it, by construction: `PlayInput` has no place
// for a beat's truth (`what`), another mind, anyone else's take, the author's notebook, the world's
// state or the scene's staging, and `sceneSoFar` builds the scene from its own takes and the reaches
// of the beats it lived. What it perceives of the people around it is what beats brought it, as the
// author exposed them (§4.2): the scene's opening, their acts, and points of view where a reach was
// partial, which the truth-blind render writes from the staging. The author's staging is never its to
// read, and its people files are all of them, as every mode's are, so no list of who is here decides them.
// The stage is pure apart from its model port and the recall it is given: it returns its events (the
// beats it lived, its take, its now, a memory it keeps at once) and their blobs, and lands nothing,
// so a real-time answer the author's watch drops writes nothing. The scene writes the beat itself
// (`actBeatTexts`), with the author's exposure; whoever decides a beat writes it, and the character
// decided this one.

import { CHARACTER_TEXT } from "../../../shared/character-prompts";
import { exposedBeats, livedCorpus, mindLivedEvent, mindTakeEvent, mindV2At, pendingFor, reachOf, recallSearch, takesOf, type ExposedBeat, type Reach, type RecallDoc, type RecallHit } from "../../../shared/character-engine";
import type { EntityId, UserId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { Beat, StoryRead } from "../../../shared/story";
import type { WorldDoc } from "../../../shared/world";
import type { WorldState } from "../../../engine/state";
import { knownNames, livedText, mindContext, reachedHow, systemOf, textIn, textsIn, Writes, type LivedPov, type MindInput, type StageOut } from "../../character-agent";
import { livedPovs } from "../../character-engine";
import { renderPrompt } from "../../prompts";
import { DepthAnswerError, readAnswer, type Reading } from "../common";
import { addUsage, NO_USAGE, type ModelPort, type PortMessage } from "../port";

/** Reads a blob's text: a scene's reader looks at the turn's own texts first, then the user's store. */
export interface BlobReader {
  get(userId: UserId, hash: string): Promise<string | null>;
}

/** One moment of the scene as the character lived it so far: what reached it, or its own play (what it did and said, and its take then). */
export type SceneMoment = { reached: LivedPov } | { played: { beat?: string; did?: string; said?: string; take: string } };

export interface PlayInput extends MindInput {
  /** The id its act takes as a beat, should it act: the scene assigns it before asking. */
  beat: string;
  /** This scene as it lived it so far, in order (`sceneSoFar`). */
  scene: readonly SceneMoment[];
  /** What just reached it since it last played, in order (`sceneSoFar`; real time: the player's line, whole). */
  reached: readonly LivedPov[];
  /** Answers a cue in its own voice over its own mind and what it lived (`sceneRecall`); absent: it can't think back. */
  recall?: (cue: string) => Promise<RecallHit[]>;
  /** How many times it may think back before it must answer (default 2). */
  recalls?: number;
}

/** What it does and says: the observable part of its beat. */
export interface PlayAct {
  act: "said" | "did";
  /** What there was to sense of it: plain words, in the third person, no motive. */
  surface: string;
  /** Its exact words aloud. */
  quotes?: string;
  addressed?: EntityId[];
  /** What it tries to bring about, when that could fail or needs the world's answer: for the author and the GM (`resolveAttempt`), never in the beat. */
  attempt?: string;
}

export interface PlayOut extends StageOut {
  /** Null: it let the moment pass, doing nothing anyone could notice. */
  act: PlayAct | null;
  /** Its take, as it wrote it (recorded in `events` as `minds.v2.take`). */
  take: string;
  /** Each time it thought back: its cue, and how many of its own documents answered. */
  recalls: { cue: string; hits: number }[];
}

/** Times a play may think back before it must answer, unless the scene says otherwise. */
const RECALLS = 2;
/** The documents a recall gives back at most. */
const RECALL_HITS = 5;
/** What reached a character that a play lives at most, newest kept: the rest stays pending for its catch-up. */
const REACHED_MOST = 40;

// ------------------------------------------------------------------ the scene as it lived it

export interface SceneRead {
  world: WorldDoc;
  /** The turn's state at this moment: its snapshot with the scene's events so far applied (takes and lived batches fold into the minds' part). */
  state: Readonly<WorldState>;
  /** The chain's story at the turn's basis. */
  story: Pick<StoryRead, "beats" | "replaced">;
  /** The scene's own beats so far, in order: not on the chain yet. */
  beats?: readonly Beat[];
}

/** The beats a scene reads: the chain's live ones less what was replaced, then the scene's own. */
function beatsOf(read: SceneRead): { all: ExposedBeat[]; replaced: Set<string> } {
  const { beats: chain, replaced } = exposedBeats(read.story);
  const own = read.beats ?? [];
  const ownIds = new Set(own.map((b) => b.id));
  return { all: [...chain.filter((b) => !replaced.has(b.id) && !ownIds.has(b.id)), ...own], replaced };
}

/**
 * The scene as `who` lived it so far, and what reached it since: its takes not yet remembered, each
 * after the beats it lived in that play (as they reached it: the surface where whole, its own point
 * of view where partial, the exact words only where whole) and with what it did and said; then what
 * reached it and it hasn't lived, in story order, the newest `limit` (the rest waits for its
 * catch-up). Only its own takes and the reaches of beats that reached it are read: never a beat's
 * truth, another mind or anyone else's take. Queue-free.
 */
export async function sceneSoFar(blobs: BlobReader, userId: UserId, read: SceneRead, who: EntityId, o: { limit?: number } = {}): Promise<{ scene: SceneMoment[]; reached: LivedPov[] }> {
  const { all } = beatsOf(read);
  const byId = new Map(all.map((b) => [b.id, b]));
  const scene: SceneMoment[] = [];
  const seen = new Set<string>();
  for (const t of takesOf(read.state, who)) {
    const lived = t.lived.filter((id) => !seen.has(id)).flatMap((id) => byId.get(id) ?? []);
    for (const pov of await livedPovs(blobs, userId, read.world, lived, who)) scene.push({ reached: pov });
    for (const id of t.lived) seen.add(id);
    const mine = t.beat !== undefined ? byId.get(t.beat) : undefined;
    const did = mine ? await blobs.get(userId, mine.surface) : null;
    const said = mine?.quotes !== undefined ? await blobs.get(userId, mine.quotes) : null;
    const take = (await blobs.get(userId, t.hash)) ?? "";
    scene.push({ played: { ...(t.beat !== undefined ? { beat: t.beat } : {}), ...(did ? { did } : {}), ...(said ? { said } : {}), take } });
    if (t.beat !== undefined) seen.add(t.beat);
  }
  const pending = pendingFor(all, mindV2At(read.state, who), who);
  const reached = await livedPovs(blobs, userId, read.world, pending.slice(-Math.max(1, o.limit ?? REACHED_MOST)), who);
  return { scene, reached };
}

/**
 * A character's recall during a play (§4.3, §4.4): a cue it writes in its own voice, answered by a
 * lexical search over its own mind's files and the beats it lived (the chain's and the scene's), as
 * they reached it. Never the archive at large, another mind, the truth of a beat, or a beat it hasn't
 * lived. Queue-free: the corpus is read once, at the first cue, from the state the play reads.
 */
export function sceneRecall(blobs: BlobReader, userId: UserId, read: SceneRead, who: EntityId, o: { limit?: number } = {}): (cue: string) => Promise<RecallHit[]> {
  let corpus: Promise<RecallDoc[]> | null = null;
  const build = async (): Promise<RecallDoc[]> => {
    const { all, replaced } = beatsOf(read);
    const mind = mindV2At(read.state, who);
    const lived = all.filter((b) => hasOwn(mind.lived, b.id));
    const reaches = lived.map((b) => reachOf(b, who)).filter((r): r is Reach => r !== null);
    const texts: Record<string, string> = {};
    for (const hash of new Set([...Object.values(mind.files).map((m) => m.hash), ...reaches.flatMap((r) => [r.text, ...(r.whole && r.quotes ? [r.quotes] : [])])])) {
      const text = await blobs.get(userId, hash);
      if (text !== null) texts[hash] = text;
    }
    return livedCorpus({ who, mind, beats: lived, texts, replaced });
  };
  return async (cue) => recallSearch(await (corpus ??= build()), cue, o.limit ?? RECALL_HITS);
}

// ------------------------------------------------------------------ the play

/** Exact words without the marks a model may wrap them in. */
function bare(words: string): string {
  return words.replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
}

/** Its own earlier play, as it lived it. */
function playedText(p: { beat?: string; did?: string; said?: string; take: string }): string {
  const head = p.beat !== undefined ? `[you, beat ${p.beat}]` : "[you]";
  const did = p.did !== undefined && p.did.trim() !== "" ? `\nWhat you did: ${p.did.trim()}` : "";
  const said = p.said !== undefined && p.said.trim() !== "" ? `\nWhat you said: ${p.said.trim()}` : "";
  const passed = did === "" && said === "" ? "\nYou let the moment pass." : "";
  const take = p.take.trim() !== "" ? `\nYour take then: ${p.take.trim()}` : "";
  return `${head}${did}${said}${passed}${take}`;
}

/** What came back to a cue: its own documents, each with where it came from (a beat as it lived it: its own act, a message to it, or what it sensed whole or in part). */
function hitsText(hits: readonly RecallHit[]): string {
  if (hits.length === 0) return "Nothing comes back to you.";
  return hits
    .map(({ doc }) => {
      const from = doc.kind === "file" ? `(your ${doc.path ?? "mind"})` : `[beat ${doc.beat ?? ""}] ${reachedHow({ ...(doc.as !== undefined && doc.as !== "sensed" ? { as: doc.as } : {}), whole: doc.whole === true })}`;
      return `${from}\n${doc.text.trim()}`;
    })
    .join("\n\n");
}

/** What there was to sense of its act: what it did, then its words aloud by its name. */
function surfaceOf(name: string, did: string | null, said: string | null): string {
  const words = said !== null ? `${name} says, “${said}”` : null;
  return [did, words].filter((p): p is string => p !== null && p !== "").join(" ");
}

/**
 * Play (§4.4): the character's turn to act in the scene, as a player plays. Its context is its own
 * mind (core first, then self and what it keeps in mind as the stable prefix; then now, beliefs,
 * plans and the people it knows), the scene as it lived it and what just reached it: what it
 * perceives of the others is what those beats brought it. It answers with what it does and says (its beat's act, surface and
 * quotes), what it tries to bring about (for the GM, never in the beat), its take, which it keeps,
 * how it is now, and a memory if this will stay with it; it may first think back with a cue, a few
 * times at most. Its events: the beats it lived (what reached it, and its own beat when it acts),
 * its take, then its now and any memory it kept. An answer that isn't one JSON object fails closed
 * (`DepthAnswerError`): nothing of it is kept, and the call's keeper is told why (`readAnswer`).
 */
export async function play(model: ModelPort, input: PlayInput): Promise<PlayOut> {
  const texts = input.texts ?? {};
  const mind: MindInput = input;
  const names = knownNames(mind);
  const user = [
    mindContext(mind),
    `## This scene as you have lived it\n${input.scene.length > 0 ? input.scene.map((m) => ("reached" in m ? livedText([m.reached], { names }) : playedText(m.played))).join("\n\n") : "Nothing of it yet."}`,
    `## What just reached you\n${input.reached.length > 0 ? livedText(input.reached, { names }) : "Nothing new."}`,
    renderPrompt(CHARACTER_TEXT.play, texts, { name: input.name }),
    renderPrompt(CHARACTER_TEXT.playAnswer, texts, {}),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  const messages: PortMessage[] = [systemOf(mind), { role: "user", content: user }];
  const rounds = input.recall ? Math.max(0, input.recalls ?? RECALLS) : 0;
  const recalls: PlayOut["recalls"] = [];
  const reasoning: string[] = [];
  let usage = NO_USAGE;
  let answer: Record<string, unknown>;
  let read: Reading;
  for (let round = 0; ; round++) {
    const r = await model("character", messages, { json: true, ...(input.signal ? { signal: input.signal } : {}) });
    usage = addUsage(usage, r.usage);
    if (r.reasoning) reasoning.push(r.reasoning);
    const got = readAnswer("character", r);
    if (!got.answer) throw new DepthAnswerError("character", r.text, r);
    answer = got.answer;
    read = got.read;
    const cue = textIn(answer.recall);
    const onlyCue = cue !== null && textIn(answer.do) === null && textIn(answer.say) === null && textIn(answer.take) === null;
    if (!onlyCue || !input.recall || round >= rounds) break;
    const hits = await input.recall(cue);
    recalls.push({ cue, hits: hits.length });
    messages.push({ role: "assistant", content: r.text }, { role: "user", content: `${renderPrompt(CHARACTER_TEXT.recalled, texts, { cue })}\n\n${hitsText(hits)}` });
  }

  const did = textIn(answer.do);
  const sayRaw = textIn(answer.say);
  const said = sayRaw === null ? null : bare(sayRaw) || null;
  const reached = [...new Set(input.reached.map((p) => p.beat))];
  const acts = did !== null || said !== null;
  const lived = acts ? [...new Set([...reached, input.beat])] : reached;
  const w = new Writes(mind, "play", lived, read);
  const addressed = [...new Set(textsIn(answer.to).flatMap((s) => w.person(s) ?? []))].filter((id) => id !== input.who);
  const attempt = textIn(answer.attempt);
  const act: PlayAct | null = acts
    ? { act: said !== null ? "said" : "did", surface: surfaceOf(input.name, did, said), ...(said !== null ? { quotes: said } : {}), ...(addressed.length > 0 ? { addressed } : {}), ...(attempt !== null ? { attempt } : {}) }
    : null;
  const take = textIn(answer.take) ?? "";
  if (lived.length > 0) w.events.push(mindLivedEvent({ who: input.who, beats: lived, at: input.at, mode: "play" }));
  if (acts || take !== "") {
    const t = mindTakeEvent({ who: input.who, at: input.at, lived: reached, ...(acts ? { beat: input.beat } : {}), take });
    w.events.push(t.event);
    Object.assign(w.blobs, t.blobs);
  }
  w.single("now", "now", answer.now);
  const keep = textIn(answer.keep);
  if (keep !== null) w.memory(keep, lived, addressed, input.at);
  return { events: w.events, blobs: w.blobs, ...(reasoning.length > 0 ? { reasoning: reasoning.join("\n\n") } : {}), usage, act, take, recalls };
}

/**
 * A character's act as its beat's texts (§4.2): what there was to sense of it, which is also what
 * happened as far as the act goes (a character's own act hides no truth; an outcome is the GM's
 * beat, a motive never a beat's), and its exact words. The scene writes the beat around them: id,
 * order, place, scene, actors, `addressed`, the author's exposure and `by: {turn, decided: "character"}`.
 */
export function actBeatTexts(act: PlayAct, _name: string): { what: string; surface: string; quotes?: string } {
  return { what: act.surface, surface: act.surface, ...(act.quotes !== undefined ? { quotes: act.quotes } : {}) };
}
