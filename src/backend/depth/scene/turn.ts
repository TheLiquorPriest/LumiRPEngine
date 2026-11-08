// One depth turn (DEPTH-PLAN §1.3, §2.3–§2.5, §4.4, §5.2; the order is `contract.ts`'s): the author
// runs the scene like a DM. A Re-narrate renders its source's beats again and decides nothing; a live
// conversation goes line by line (A2d) unless the author's watch hands the line back; otherwise the
// GM writes the player's own beats (A2b) and resolves what his acts attempt by the rules (§5.2: the
// engine run before the scene read none of his words), the author sets the scene, and the scene plays
// beat by beat until the author ends the turn: the characters playing as their own agents act from
// their own minds (A2b), at once when several do; the GM resolves what they attempt (A2b); the
// author's step writes who perceived each beat, what the world does, the acts of those it plays or
// handles, and who acts next. Each decided moment goes to the narrator (A2c) as it is decided, and
// streams while the next is. A Stop lands between beats and keeps the moments whose prose streamed.
//
// No one plays from what isn't canon (§4.6, §5.3): before the scene plays past what an open draft
// holds (the people in it, its place, the things there, from before the scene's minute), the author
// reads the draft against everything since its story time and settles it, drops it, or re-dates it
// past the scene: at the scene's start, for what the setup brings in, and before each beat as the
// scene's minute moves (`walkOns`). What that comes to rides in the record before the moment it
// precedes; a settlement's beats are lived by whoever they reached in their next play. A line of
// real-time dialogue that reaches what an open draft holds (the character, the player character, his
// place, the things there) plays as a scene, so the draft settles first. What the turn cost rides in
// its record too (§4.7): each walk-on's own line, then the scene's.
// The author reads what the budget dial leaves the turn at its setup and at each step, and spends by
// it (§6.5): once a ceiling binds, whoever still plays as their own agent is played by the author
// from that moment, said, and the scene plays on as far as the author judges, within the turn's
// steps (Settings → Depth); a real-time line goes to a scene.
//
// Every judgment here is an agent's; the loop only keeps its bookkeeping: ids, minutes, the order of
// moments, exposure's pending marks, which drafts are due, the bounds of a turn, what it cost, and
// the record's layout.

import { spendEvent } from "../../../shared/author";
import { hasAgent, mindedAt, povOf, withPov, MIND_TAKE, type RecallHit } from "../../../shared/character-engine";
import type { DepthEffort } from "../../../shared/depth-views";
import { draftOf, dropEvent, STORY_DRAFT, type DraftData } from "../../../shared/episodes";
import { hashParts } from "../../../shared/hash";
import type { EntityId, PlaceId, UserId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { GenerationKind, LedgerEvent } from "../../../shared/ledger";
import { sceneEvent, sceneId, sceneOf, STORY_SCENE, type SceneCast, type SceneData } from "../../../shared/scene";
import { STORY_BEAT, type Beat, type BeatDecider, type StoryRef } from "../../../shared/story";
import { talkNow } from "../../../shared/talk";
import type { WorldDoc } from "../../../shared/world";
import { listWords } from "../../../shared/words";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import type { Registry } from "../../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { together } from "../../../engine/presence";
import { relocate } from "../../../engine/relocate";
import type { WorldState } from "../../../engine/state";
import { Working } from "../../../engine/working";
import { stagingBefore } from "../../../engine/ledger/story";
import type { LivedPov } from "../../character-agent";
import { knowsFor, mindInput, readMind } from "../../character-engine";
import { budgetWords, costTokens, type CeilingBind } from "../budget";
import { beatLine, DepthAnswerError, named, type BeatText, type Blobs } from "../common";
import type { NotebookRead } from "../notebook";
import { notebookFiles, notebookOf } from "../../../engine/notebook";
import { draftsOn, dueDrafts, type DraftOn, type SceneReach } from "../offscreen/drafts";
import { readDraft } from "../offscreen/settle";
import type { ModelPort } from "../port";
import { addSpent, metered, NO_COST, spendData, spentSince, type Metered, type Spent } from "../spend";
import { authorAsk, authorSetup, authorStep, notebookText, type DraftBeat, type PlayedMind, type Present, type SetupResult, type StagingDraft, type StepResult } from "./author";
import { SceneBook } from "./book";
import { reaches } from "./narration";
import { talkWritten } from "./talk";
import type { AfterReply, ArchivePassage, DepthTurnInput, DepthTurnResult, Moment, NarrationFactory, NarrationOutcome, NarrationPort, RealtimeCtx, RealtimeOutcome, RenderBeat, SceneAt } from "./contract";
import type { BlobReader, PlayAct, PlayInput, PlayOut, SceneMoment, SceneRead } from "./play";
import type { AttemptInput, AttemptOut, PlayerBeat, PlayerBeatsInput, PlayerBeatsOut } from "./resolve";
import type { Resolution } from "../../../engine/resolve";

// ------------------------------------------------------------------ the plugs

/** Where the other lanes plug in (`plugs.ts` binds the real ones; a test binds scripted ones). */
export interface ScenePlugs {
  /** The GM's beats for the player's own input (A2b): his acts and words, his inner life, what the rules resolved; his out-of-character lines as signals. */
  playerBeats(model: ModelPort, input: PlayerBeatsInput): Promise<PlayerBeatsOut>;
  /** A character playing as its own agent (A2b). */
  play(model: ModelPort, input: PlayInput): Promise<PlayOut>;
  sceneSoFar(blobs: BlobReader, userId: UserId, read: SceneRead, who: EntityId): Promise<{ scene: SceneMoment[]; reached: LivedPov[] }>;
  sceneRecall(blobs: BlobReader, userId: UserId, read: SceneRead, who: EntityId): (cue: string) => Promise<RecallHit[]>;
  actBeatTexts(act: PlayAct, name: string): { what: string; surface: string; quotes?: string };
  /** An attempt in the scene (A2b): the engine's rules where they settle it, the GM's outcome beat where they decided something. */
  resolveAttempt(model: ModelPort, input: AttemptInput): Promise<AttemptOut>;
  /** The draws an attempt takes: the turn's seed with the beat's id (A2b's `attemptSeed`). */
  attemptSeed(turnSeed: string, beat: string): string;
  narration: NarrationFactory;
  renarrateMoments(source: { pre: readonly LedgerEvent[]; read: readonly LedgerEvent[] }, pov: EntityId, text: (hash: string) => Promise<string | null>): Promise<{ moments: Moment[]; throughOf: (mark: number) => number }>;
  realtimeTurn(ctx: RealtimeCtx): Promise<RealtimeOutcome>;
}

/** The notebook at a state as the author reads it (`readNotebook`'s), through the turn's own blob reader: every file, and the player's edits it hasn't written over. */
async function notebookAt(blobs: BlobReader, userId: UserId, state: Readonly<WorldState>): Promise<NotebookRead> {
  const { authored } = notebookOf(state);
  const out: NotebookRead = { files: {}, pinned: [] };
  for (const f of notebookFiles(state)) {
    const text = (await blobs.get(userId, f.hash)) ?? "";
    out.files[f.path] = text;
    if (!f.pinned) continue;
    const was = own(authored, f.path);
    out.pinned.push({ path: f.path, before: was ? ((await blobs.get(userId, was)) ?? "") : "", after: text });
  }
  return out;
}

// ------------------------------------------------------------------ bounds and words

// The author's steps a turn takes at most are Settings → Depth → Steps per turn (`depth.steps`): a
// bound on a turn's length, never a judgment; the author is told as it nears.
/** The scene's beats the author reads at most, newest kept (the record keeps them all; this bounds a prompt). */
const SCENE_BEATS_READ = 60;
/** Those elsewhere the setup is told of besides those with the player character, whom the scene may reach only from afar or bring in (a prompt's bound). */
const OTHERS_READ = 24;

/** The scene that is playing at a fold: the last `story.scene`, unless it ended there. */
export function sceneNow(events: SceneAt["events"]): SceneData | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.event.type !== STORY_SCENE) continue;
    const s = sceneOf("data" in e.event ? e.event.data : null);
    if (!s) continue;
    return s.ends ? null : s;
  }
  return null;
}

/** What runs after the reply, read off the record's pre: the scene, whether it ended, the agents who played (their takes), the beats; with the player's signals the turn read. */
export function afterOf(pre: readonly LedgerEvent[], poll: boolean, signals: readonly string[] = []): AfterReply {
  let scene: string | null = null;
  let ended = false;
  const remember: EntityId[] = [];
  const beats: string[] = [];
  for (const e of pre) {
    if (!("data" in e)) continue;
    if (e.type === STORY_SCENE) {
      const s = sceneOf(e.data);
      if (s) {
        scene = s.scene;
        ended = ended || s.ends === true;
      }
    } else if (e.type === MIND_TAKE && typeof e.data.who === "string" && !remember.includes(e.data.who)) remember.push(e.data.who);
    else if (e.type === STORY_BEAT && typeof e.data.id === "string") beats.push(e.data.id);
  }
  return { scene, ended, remember, poll, beats, ...(signals.length > 0 ? { signals: [...signals] } : {}) };
}

/** How a turn came, as the author's poll reads it among the player's signals: a swipe, a Regenerate or a Re-narrate (a new reply or a Continue says nothing). */
export function cameAs(kind: GenerationKind): string[] {
  return kind === "swipe" ? ["a swipe"] : kind === "regenerate" ? ["a Regenerate"] : kind === "renarrate" ? ["a Re-narrate"] : [];
}

// ------------------------------------------------------------------ the turn

/** Runs one depth turn; what it returns, the bridge commits (`DepthTurnResult`). */
export async function runDepthTurn(input: DepthTurnInput, plugs: ScenePlugs): Promise<DepthTurnResult> {
  if (input.kind === "renarrate") return renarrate(input, plugs);
  return new Turn(input, plugs).run();
}

/**
 * A Re-narrate renders its source's beats afresh (P3): its pre is the source's, cut on a Stop, with
 * what rendering them again cost after it (the source's own spend rides with the beats it copies);
 * nothing is decided.
 */
async function renarrate(input: DepthTurnInput, plugs: ScenePlugs): Promise<DepthTurnResult> {
  const { at, userId, settings } = input;
  if (!input.source) throw new Error("A Re-narrate needs its source turn's record.");
  const source = input.source;
  const pov = povOf(at.world, at.state);
  const meter = metered(input.model);
  input.sink.progress("The narrator renders the same beats afresh…");
  const { moments, throughOf } = await plugs.renarrateMoments(source, pov, (hash) => input.rt.blobs.get(userId, hash));
  const narration = plugs.narration(
    { model: meter.port, sink: input.sink, throughOf, ...(input.frame ? { frame: input.frame } : {}) },
    { world: at.world, state: at.state, texts: settings.prompts.texts, pov, knows: knowsFor({ registry: input.rt.registry }, at, [pov])[pov] ?? [], settings: { redrafts: settings.depth.redrafts, thinking: settings.depth.thinking }, ...(input.recent ? { before: input.recent } : {}), ...(input.direction ? { direction: input.direction } : {}), asks: false, signal: input.signal },
  );
  for (const m of moments) narration.add(m);
  const out = await narration.drain();
  const pre = !out.stopped ? [...source.pre] : out.streamedThrough === null ? [] : source.pre.slice(0, throughOf(out.streamedThrough));
  const spend = spendData(meter.spent(), { treatment: "scene", interval: settings.depth.budget.interval, at: at.state.clock, for: input.turn });
  return { pre: [...pre, ...(spend ? [spendEvent(spend)] : [])], read: out.events, blobs: out.blobs, dropped: [], chips: [], stopped: out.stopped, ...(out.failed ? { failed: out.failed } : {}), after: afterOf(pre, pre.length > 0, [...cameAs(input.kind), ...(input.signals ?? [])]) };
}

/** One turn's run: its book, its narration, and the author's steps. */
class Turn {
  readonly input: DepthTurnInput;
  readonly plugs: ScenePlugs;
  readonly book: SceneBook;
  readonly pov: EntityId;
  readonly world: WorldDoc;
  readonly whole: boolean;
  readonly texts: Record<string, string>;
  /** Every model call of the turn, metered: what the scene and each walk-on cost. */
  readonly meter: Metered;
  notebook: NotebookRead = { files: {}, pinned: [] };
  narration: NarrationPort | null = null;
  /** The setup's excerpts of the notebook for the narrator. */
  excerpts: string[] = [];
  /** The archive excerpts the setup pulled for the narrator. */
  quotes: ArchivePassage[] = [];
  /** Characters playing as their own agents this scene. */
  agents = new Set<EntityId>();
  /** The scene ends with this turn (the setup's or a step's call). */
  sceneEnds = false;
  /** The player's signals the turn read (how it came, his out-of-character lines), for the poll. */
  signals: string[] = [];
  /** What a ceiling put off this turn, a line each: the scene's spend keeps them (§6.5). */
  readonly put: string[] = [];
  /** Those the budget slid from their own agents to the author this turn (§6.5): the author plays them, and its steps may name them next. */
  readonly slid = new Set<EntityId>();
  /** The drafts on the chain, as the turn found them and its walk-ons left them. */
  private drafts: DraftOn[];
  /** The beats the walk-ons made canon, dated when they happened: a play lives those that reached it. */
  private readonly settled: Beat[] = [];
  /** What became of each draft a walk-on read, in a line, for the setup. */
  private readonly offscreen: string[] = [];
  /** What each walk-on cost: its own line in the turn's budget (§4.6 Walk-ons). */
  private readonly walked: { draft: string; spent: Spent }[] = [];
  private stepFailed = false;
  /** What the author's last answer (the setup's or a step's) couldn't keep, with why: its next step hears it (LIVE3 L3a-3). */
  private unkept: readonly string[] = [];
  /** Something beyond his own beats has reached the player character this turn, for the narrator to tell (LIVE3c L3c-5). */
  private reached = false;

  constructor(input: DepthTurnInput, plugs: ScenePlugs) {
    this.input = input;
    this.plugs = plugs;
    this.world = input.at.world;
    this.pov = povOf(input.at.world, input.at.state);
    this.whole = input.settings.depth.thinking === "whole";
    this.texts = input.settings.prompts.texts;
    this.meter = metered(input.model);
    this.drafts = draftsOn(input.at.events);
    // The engine reads the doc's own pov as the player character (D-10): the scene's state, its moves and the time its beats
    // run play on the world re-pointed at the one the player plays now, so after Play as a scene holds whoever is in it with
    // him from their routines and schedules, never with the world's own (LIVE3d L3d-4).
    this.book = new SceneBook({ registry: input.rt.registry, world: withPov(input.at.world, input.at.state), state: input.at.state, prefix: input.plan?.events ?? [], turn: input.turn, userId: input.userId, blobs: input.rt.blobs, pov: this.pov, say: (t) => this.say(t) });
  }

  /** The turn's model port, metered. */
  get model(): ModelPort {
    return this.meter.port;
  }

  /** A note the player must see whatever the thinking block shows: a refusal, a bound reached. */
  say(text: string): void {
    if (this.whole) this.input.sink.reasoning(text);
    else this.input.sink.progress(text);
  }

  /** The author's thinking and each beat as decided: shown when the thinking block shows it whole (D-5). */
  think(text: string | undefined): void {
    if (this.whole && text && text.trim() !== "") this.input.sink.reasoning(text.trim());
  }

  get signal(): AbortSignal {
    return this.input.signal;
  }

  private name(id: EntityId): string {
    return own(this.book.state.entities, id)?.name ?? own(this.world.entities, id)?.name ?? id;
  }

  /** The narrator for this turn, bound to its sink, frame, recent prose and settings. */
  private narrate(o: { asks: boolean; throughOf: (mark: number) => number }): NarrationPort {
    const { input } = this;
    const settings = input.settings;
    return this.plugs.narration(
      {
        model: this.model,
        sink: input.sink,
        throughOf: o.throughOf,
        ...(o.asks ? { ask: (q: { questions: string[]; moment: Moment }) => this.ask(q) } : {}),
        ...(input.frame ? { frame: input.frame } : {}),
      },
      {
        world: this.world,
        state: this.book.state,
        texts: this.texts,
        pov: this.pov,
        knows: knowsFor({ registry: input.rt.registry }, { state: this.book.state, world: this.world }, [this.pov])[this.pov] ?? [],
        settings: { redrafts: settings.depth.redrafts, thinking: settings.depth.thinking },
        ...(input.recent ? { before: input.recent } : {}),
        ...(this.excerpts.length > 0 ? { excerpts: this.excerpts } : {}),
        ...(this.quotes.length > 0 ? { quotes: this.quotes } : {}),
        ...(input.direction ? { direction: input.direction } : {}),
        asks: o.asks,
        signal: input.signal,
      },
    );
  }

  /**
   * The turn: a real-time line, or the scene played to where the player answers. A Stop can land
   * inside any call: the turn then ends as a Stop between beats does, keeping the moments whose
   * prose streamed. So does a stage that fails once a passage has streamed (§3.14), and the turn
   * says why; one that fails before any did fails the turn.
   */
  async run(): Promise<DepthTurnResult> {
    try {
      const exchange = await this.decide();
      if (exchange) return exchange;
    } catch (error) {
      if (!this.input.signal.aborted) return this.finish(error);
    }
    return this.finish();
  }

  /** Decides the turn: a real-time exchange's result, or null once the scene's moments are decided (`finish` lays them out). */
  private async decide(): Promise<DepthTurnResult | null> {
    const { input, book } = this;
    const at = input.at;
    this.notebook = await notebookAt(book.reader, input.userId, at.state);

    // A conversation in real time: the line goes straight to the character, unless the watch hands it
    // back, or an open draft holds from before now what the line reaches, as a scene's start would (the
    // character, the player character, his place, the things there): it settles first, in a scene.
    const talk = talkNow(at.events, null);
    let takeover: string | undefined;
    if (talk && talk.state === "on" && input.input !== null && this.present(talk.with)) {
      const held = dueDrafts(this.drafts, this.reach(placeOfEntity(book.state, this.pov), [talk.with]), this.now(), (a, b) => together(this.world, a, b));
      const holds = [...new Set(held.flatMap((d) => d.touches.map((t) => this.touched(t.ref))))];
      if (holds.length > 0) takeover = `Something off screen, not canon yet, holds ${holds.join(", ")} from before now: it settles first, so this line plays as a scene.`;
      else {
        const playing = sceneNow(at.events);
        const outcome = await this.plugs.realtimeTurn({
          chatId: input.chatId,
          userId: input.userId,
          rt: input.rt,
          at: { ...at, state: book.state },
          turn: input.turn,
          runSeed: input.runSeed,
          seed: input.seed,
          line: input.input.text,
          talk,
          scene: talk.scene ?? playing?.scene ?? sceneId(input.turn),
          model: this.model,
          sink: input.sink,
          signal: input.signal,
          notebook: notebookText(this.notebook),
          settings: input.settings,
          binds: () => this.binds(),
          narrate: (theirs) => this.narrate({ asks: false, throughOf: (k) => book.prefix.length + theirs(k) }),
        });
        if (outcome.kind === "exchange") return this.exchange(outcome);
        takeover = outcome.why;
        if (outcome.put) this.put.push(outcome.put);
      }
    }

    // What the scene starts with that an open draft holds comes first: the people with him, his place, the things there.
    await this.walkOns(this.reach(placeOfEntity(book.state, this.pov)), 0);

    // The GM's beats for the player's input, read against the scene that is playing (its beats so far
    // and where everyone in it is), each of his attempts resolved by the rules right after the act that
    // makes it, from that act's own words and the scene so far (LIVE3 L3a-5); then the author's setup,
    // which reads the same scene. An empty Send carries no new words of his: no beats of his own.
    const playing = sceneNow(at.events);
    const earlier = playing ? { staging: await this.stagingDrafts(playing.scene), beats: await this.sceneBeats(playing.scene) } : null;
    const sofar = earlier ? earlier.beats.map((b) => beatLine(this.world, book.state, b.beat)) : [];
    const player = input.input === null ? { beats: [], signals: [] } : await this.gmReads(input.input.text, earlier ? { beats: sofar, staging: earlier.staging } : undefined);
    this.signals = [...cameAs(input.kind), ...(input.signals ?? []), ...player.signals];
    const resolved: Resolution[] = [...(input.plan?.resolutions ?? [])];
    const playerDrafts: DraftBeat[] = [];
    // What his attempts took: the scene opens where the turn starts, and its beats come after them.
    let took = 0;
    for (const b of player.beats) {
      const ref = `p${playerDrafts.length + 1}`;
      playerDrafts.push({
        ref,
        decided: b.decided,
        actors: b.actors,
        act: b.act,
        what: b.what,
        ...(b.deed ? { deed: b.deed } : {}),
        surface: b.surface,
        ...(b.quotes ? { quotes: b.quotes } : {}),
        ...(b.addressed ? { addressed: b.addressed } : {}),
        about: b.about,
        exposure: [],
        ...(b.inner ? { inner: true as const } : {}),
        ...(b.uncertain ? { uncertain: b.uncertain } : {}),
      });
      if (b.attempt === undefined || b.words === undefined) continue;
      const r = await this.playerAttempt(b, b.attempt, ref, b.words, sofar);
      resolved.push(...r.resolutions);
      took += Math.max(0, r.minutes);
      if (r.outcome) playerDrafts.push({ ref: `p${playerDrafts.length + 1}`, decided: "gm", actors: [], act: "happened", what: r.outcome.what, surface: r.outcome.surface, ...(r.outcome.quotes ? { quotes: r.outcome.quotes } : {}), about: r.outcome.about, exposure: [] });
    }
    input.sink.progress("The author is setting the scene…");
    const setup = await this.setup(playerDrafts, this.signals, resolved, playing && earlier ? { id: playing.scene, place: playing.place, cast: playing.cast, ...earlier } : null, talk && talk.state === "on" ? { with: talk.with } : null, takeover);
    for (const r of setup.reads) this.think(r);
    this.think(setup.reasoning);
    if (setup.note) this.think(`The scene: ${setup.note}`);
    if (setup.redone.length > 0) this.say(`The author's setup couldn't all be kept: ${setup.redone.join("; ")}. Told why, it set the scene again.`);
    for (const r of setup.refused) this.say(`The author's setup: ${r}`);
    this.unkept = setup.refused;

    // The scene, its cast and staging, and moment 0: the player's beats, the opening, the world's.
    // A ceiling that binds already (§6.5): whoever the setup still cast as their own agent the author plays instead, said.
    const cast = this.slideOf(setup.cast);
    const pcPlace = placeOfEntity(book.state, this.pov);
    book.scene = setup.continues && playing ? playing.scene : sceneId(input.turn);
    book.place = setup.place ?? (setup.continues && playing ? playing.place : null) ?? pcPlace ?? Object.keys(this.world.places)[0] ?? "";
    book.cast = cast;
    book.orderBase = at.story.beats.reduce((n, p) => Math.max(n, p.beat.order + 1), 0);
    this.agents = new Set(cast.filter((c) => c.effort === "agent").map((c) => c.who));
    this.sceneEnds = setup.ends;
    this.excerpts = setup.excerpts;
    this.quotes = setup.quotes;
    // What the setup brought in that an open draft holds comes next: its cast, the place it chose, the things there.
    await this.walkOns(this.reach(book.place, cast.map((c) => c.who)), 0);
    if (setup.continues && playing) await this.loadStaging(playing.scene);
    book.apply([sceneEvent({ scene: book.scene, place: book.place, at: book.minute, cast, ...(setup.continues && playing ? {} : { opens: true as const }), ...(setup.ends ? { ends: true as const } : {}) })], 0);
    // Where the author stages each person moves them: the scene's place those it places there, the player character among them (where it gives him no place too), and anyone it places elsewhere there (LIVE3 L3b-1, LIVE3c L3c-2).
    this.placed(setup.staging, 0, true);
    book.minute += took;
    this.think(`The cast: ${cast.map((c) => `${this.name(c.who)} ${EFFORT_WORDS[c.effort]} (${c.why || "no reason given"})`).join("; ") || "no one but you"}.`);
    book.stage(setup.staging, 0);
    this.narration = this.narrate({ asks: true, throughOf: (k) => book.throughOf(k) });
    const first: BeatText[] = [];
    for (const d of playerDrafts) {
      const exposure = setup.exposure.filter((x) => x.beat === d.ref).map(({ who, channel, reach }) => ({ who, channel, reach }));
      const b = await book.write({ ...d, exposure }, d.decided, 0, { model: this.model, texts: this.texts, signal: input.signal });
      if (b) first.push(b);
    }
    for (const d of setup.beats) {
      const b = await book.write(d, "author", 0, { model: this.model, texts: this.texts, signal: input.signal });
      if (b) first.push(b);
    }
    const entered = this.realtime(setup);
    await this.moment(first, 0);

    // The scene, beat by beat, until the author ends the turn.
    const most = input.settings.depth.steps;
    let next = setup.next;
    let end = setup.end;
    // Real time entered at the setup starts with its partner's own answer to his line (LIVE3c L3c-5): their own agent plays before the turn can end, said, and the author's first step hears it.
    if (entered !== null && (end !== null || !next.includes(entered))) {
      const why = `real-time dialogue with ${this.name(entered)} starts with their own answer: their own agent plays now${end !== null ? ", and the turn goes on to them rather than ending" : ""}`;
      this.say(`The author's setup: ${why}.`);
      this.unkept = [...this.unkept, why];
      next = [...new Set([...next, entered])];
      end = null;
    }
    let mark = 0;
    let steps = 0;
    while (end === null && next.length > 0 && !input.signal.aborted && !this.stepFailed) {
      if (steps >= most) {
        this.say(`The turn reached its bound of ${most} step${most === 1 ? "" : "s"} between beats (Settings → Depth → Steps per turn): the player answers here, and the scene goes on next turn.`);
        break;
      }
      mark += 1;
      steps += 1;
      // As the scene's minute moves, what it holds that an open draft holds from before then comes first.
      await this.walkOns(this.reach(book.place, book.cast.map((c) => c.who)), mark);
      // A ceiling that binds now slides whoever still plays as their own agent to the author, from this moment (§6.5): the scene goes on.
      this.slide(mark);
      const step = await this.beat(next, mark, most - steps);
      if (step === null) break;
      next = step.next;
      end = step.end;
      if (step.sceneEnds) this.sceneEnds = true;
    }
    // No turn ends with nothing for the player character (LIVE3c L3c-5): where it would (the author's
    // end, the steps' bound, no one next) with nothing beyond his own beats reaching him, the author is
    // told exactly that and takes one more step, once, whoever was due to act acting first.
    let unreached = false;
    if (!this.reached && !input.signal.aborted && !this.stepFailed) {
      this.say(`Nothing this turn has reached ${this.name(this.pov)} beyond the player's own beats: the author takes one more step for what reaches them.`);
      unreached = true;
      mark += 1;
      await this.walkOns(this.reach(book.place, book.cast.map((c) => c.who)), mark);
      this.slide(mark);
      const step = await this.beat(end === null ? next : [], mark, 0, true);
      next = step?.next ?? [];
      end = step?.end ?? null;
      if (step?.sceneEnds) this.sceneEnds = true;
    }
    if (end !== null) this.think(`The turn ends: ${end}`);
    else if (!input.signal.aborted && !this.stepFailed && (unreached || (next.length === 0 && steps < most))) this.think(unreached && next.length > 0 ? "The turn ends after the step it was given for the player character: the player answers here." : "No one acts next: the player answers here.");
    if (this.sceneEnds && !setup.ends) book.apply([sceneEvent({ scene: book.scene, place: book.place, at: book.minute, cast: book.cast, ends: true })], mark);
    return null;
  }

  /** The scene's minute now: its last beat's, or the clock the engine run left, whichever is later. */
  private now(): number {
    return Math.max(this.book.minute, this.book.state.clock);
  }

  /** The ceiling that binds now (§6.5), at what the turn has spent so far; null when none does, or the turn has no budget. */
  private binds(): CeilingBind | null {
    return this.input.budget?.binds(costTokens(this.meter.spent().cost)) ?? null;
  }

  /** The budget as the author reads it now (`budgetWords`): what the ceilings leave the turn, or the one that binds; undefined with no ceiling to read. */
  private budgetNow(): string | undefined {
    const b = this.input.budget;
    return (b ? budgetWords(b, costTokens(this.meter.spent().cost)) : null) ?? undefined;
  }

  /**
   * The budget's slide (§4.4, §6.5): once a ceiling binds, whoever in `cast` still plays as their own
   * agent is played by the author instead, its reason kept with why, said and kept in the scene's
   * spend. The user's ceiling binds, and the author's rung is the cheaper one (one call for several);
   * how far the scene goes is still the author's. The same cast when nothing binds or no one moves.
   */
  private slideOf(cast: readonly SceneCast[]): SceneCast[] {
    const bind = this.binds();
    const moving = bind ? cast.filter((c) => c.effort === "agent") : [];
    if (!bind || moving.length === 0) return [...cast];
    const names = moving.map((c) => this.name(c.who)).join(", ");
    this.say(`The budget: ${bind.words}, so the author plays ${names} from here rather than their own agents, as far as it judges the scene should go.`);
    this.put.push(`${names} played by the author rather than their own agents: ${bind.words}`);
    for (const c of moving) this.slid.add(c.who);
    const why = `The budget slid them to the author: ${bind.which === "day" ? "today's" : "this turn's"} ceiling binds.`;
    return cast.map((c) => (c.effort === "agent" ? { ...c, effort: "author" as const, why: c.why ? `${c.why} ${why}` : why } : c));
  }

  /** The slide under way (`slideOf`), from moment `mark`: the scene's cast changes, and a `story.scene` there records it. */
  private slide(mark: number): void {
    const { book } = this;
    const cast = this.slideOf(book.cast);
    if (cast.every((c, i) => c.effort === book.cast[i]?.effort)) return;
    book.cast = cast;
    this.agents = new Set(cast.filter((c) => c.effort === "agent").map((c) => c.who));
    book.apply([sceneEvent({ scene: book.scene, place: book.place, at: book.minute, cast })], mark);
  }

  /**
   * Where the author stages each person moves them (LIVE3 L3b-1, LIVE3c L3c-2): each of `staging`
   * (the setup's, or a step's) whom it places at one of the world's places, the scene's own for
   * everyone there in person, and whom the state puts somewhere not together with that place, is
   * moved there in moment `mark`, the author's decision landing with the scene: a told move by the
   * one move path (`relocate`, so what they were doing stays behind and they stand where the place
   * takes arrivals), one unit each, kept only whole. The player character given no place is at the
   * scene's place, since the scene plays from where he is: staged without one, or, at the setup
   * (`opening`), not staged at all. Someone the scene reaches only from afar (the far end of a phone
   * call), the player character included, is never moved, nor anyone else it gives no place: no
   * place is guessed. Someone there already, the player character the rules moved by what he
   * attempted (the GM's decision) among them, isn't moved. Said in the thinking block, by where each went.
   */
  private placed(staging: readonly StagingDraft[], mark: number, opening = false): void {
    const { book, input } = this;
    const moved = new Map<PlaceId, string[]>();
    // A person staged twice in one answer stands where the last staging puts them, as `SceneBook.stage` keeps it.
    const last = new Map(staging.map((s) => [s.who, s]));
    const where = new Map<EntityId, PlaceId | undefined>(opening && !last.has(this.pov) ? [[this.pov, book.place]] : []);
    for (const [id, d] of last) where.set(id, d.remote ? undefined : (d.place ?? (id === this.pov ? book.place : undefined)));
    for (const [id, to] of where) {
      if (to === undefined || !own(this.world.places, to)) continue;
      const s = book.state;
      if (!hasOwn(s.entities, id) || isGone(s, id) || together(this.world, to, placeOfEntity(s, id))) continue;
      const events = relocate(book.working.ctx, id, to, { told: true });
      if (!Array.isArray(events) || events.length === 0) continue;
      const group = events.length > 1 ? `fx:${hashParts(input.turn, "placed", id, String(mark), to).slice(0, 10)}` : undefined;
      const unit = group ? events.map((e) => ({ ...e, group })) : events;
      // A unit stands whole or not at all: tried on a copy of the scene's state first.
      if (new Working(input.rt.registry, book.world, s).applyAll(unit).length !== unit.length) continue;
      if (book.apply(unit, mark).length > 0) moved.set(to, [...(moved.get(to) ?? []), this.name(id)]);
    }
    for (const [to, names] of moved) {
      const now = `${listWords(names)} ${names.length === 1 ? "is" : "are"} at ${own(this.world.places, to)?.name ?? to} now`;
      this.think(to === book.place ? `Where the scene plays moves the people in it: ${now}.` : `Where the author stages them moves them: ${now}.`);
    }
  }

  /** What the scene reaches at `place`: the player character, `cast`, everyone and everything there (or in a place together with it), and the place. */
  private reach(place: PlaceId | null, cast: readonly EntityId[] = []): SceneReach {
    const s = this.book.state;
    const entities = new Set<EntityId>([this.pov, ...cast]);
    if (place) for (const id of Object.keys(s.entities)) if (!isGone(s, id) && together(this.world, place, placeOfEntity(s, id))) entities.add(id);
    return { entities, places: new Set(place ? [place] : []) };
  }

  /**
   * The walk-ons (§4.6's invariant, §5.3): each open draft holding someone or something `reach` has,
   * from the scene's minute or before, is read by the author against everything since its story
   * time, this turn's beats included, and settled, dropped or re-dated past the scene, in moment
   * `mark`, before anyone plays. What it comes to joins the record there; a settlement's beats are
   * lived by whoever they reached in their next play, and what each reading cost is its own line in
   * the turn's budget. A settlement that keeps none of its beats leaves nothing of it: the draft is
   * dropped, said. An answer that can't be read twice fails the turn, as the setup's does: the scene
   * never plays around a draft.
   */
  private async walkOns(reach: SceneReach, mark: number): Promise<void> {
    const { input, book } = this;
    const cal = calendarOf(this.world);
    for (;;) {
      if (input.signal.aborted) return;
      const now = this.now();
      const due = dueDrafts(this.drafts, reach, now, (a, b) => together(this.world, a, b))[0];
      if (!due) return;
      const draft = due.draft.draft;
      const what = draft.summary || draft.episode.why || "something off screen";
      input.sink.progress("The author reads what this scene reaches of something off screen…");
      const before = this.meter.spent();
      const read = await readDraft({
        registry: input.rt.registry,
        world: this.world,
        state: book.state,
        userId: input.userId,
        blobs: book.reader,
        draft,
        pins: [...input.at.story.beats.map((p) => p.beat), ...this.settled, ...book.beats.map((b) => b.beat)],
        notebook: this.notebook,
        texts: this.texts,
        model: this.model,
        signal: input.signal,
        plugs: this.plugs,
        runSeed: input.runSeed,
        seed: input.turn,
        walkOn: { reach: due.touches.map((t) => `${this.touched(t.ref)}, from ${formatClock(cal, t.from)}`), now },
      });
      this.walked.push({ draft: draft.id, spent: spentSince(before, this.meter.spent()) });
      this.think(read.reasoning);
      for (const line of read.said) this.say(`Off screen: ${line}`);
      const settles = read.verdict === "settle" && read.events.length > 0;
      const events = read.events.length > 0 ? read.events : [dropEvent({ draft: draft.id, why: "Settled with none of its beats kept: nothing of it happened." })];
      if (book.apply(events, mark)[0] !== events[0]) throw new Error(`What the author decided of an off-screen draft (${draft.id}) couldn't be kept, so the scene can't play past it.`);
      Object.assign(book.blobs, read.blobs);
      const later = events.flatMap((e) => (e.type === STORY_DRAFT && "data" in e ? [draftOf(e.data)].filter((d): d is DraftData => d !== null) : []));
      this.drafts = [...this.drafts.map((d): DraftOn => (d.draft.id === draft.id ? { ...d, state: settles ? "settled" : "dropped" } : d)), ...later.map((d): DraftOn => ({ draft: d, from: due.draft.from, state: "open" }))];
      if (settles) this.settled.push(...read.beats);
      const why = read.why ? `: ${read.why}` : "";
      const line = settles ? `Settled, canon now: ${what}${why}` : read.verdict === "redate" && later[0] ? `Re-dated past this scene, to ${formatClock(cal, later[0].episode.span[0])}: ${what}${why}` : `Dropped, it didn't happen: ${what}${why}`;
      this.offscreen.push(line);
      this.say(`Off screen: ${line}`);
    }
  }

  /** Whether `who` is with the player character now (and still in the chat). */
  private present(who: EntityId): boolean {
    const s = this.book.state;
    return hasOwn(s.entities, who) && !isGone(s, who) && together(this.world, placeOfEntity(s, this.pov), placeOfEntity(s, who));
  }

  /** Whom or what a draft's touch holds, as a role's data names it (a person or place with its id). */
  private touched(ref: StoryRef): string {
    const s = this.book.state;
    return "entity" in ref ? named(this.world, s, ref.entity) : "place" in ref ? named(this.world, s, ref.place) : "thing" in ref ? ref.thing : ref.fact;
  }

  /** The GM's beats for the player's words, read against the scene playing (`scene`, absent when none is), asked again once when its answer can't be read; a second failure fails the turn (the bridge says so). What of the answer wasn't kept is said: what an act of his attempts, where his message doesn't hold the words it quotes (the act itself plays). */
  private async gmReads(text: string, scene: PlayerBeatsInput["scene"]): Promise<PlayerBeatsOut> {
    const { input, book } = this;
    input.sink.progress("The GM is reading your turn…");
    const ask = () => this.plugs.playerBeats(this.model, { registry: input.rt.registry, world: this.world, state: book.state, pov: this.pov, input: text, ...(scene ? { scene } : {}), resolutions: input.plan?.resolutions ?? [], ...(input.plan ? { minutes: input.plan.elapsedMinutes } : {}), texts: this.texts, signal: input.signal });
    let out: PlayerBeatsOut;
    try {
      out = await ask();
    } catch (error) {
      if (!(error instanceof DepthAnswerError) || input.signal.aborted) throw error;
      this.say("The GM's reading of your turn didn't come back in a form that could be read; asking again.");
      out = await ask();
    }
    this.think(out.reasoning);
    for (const r of out.refused) this.say(`The GM's reading of your turn: ${r}.`);
    return out;
  }

  /**
   * What an act of the player's attempts (§5.2, "the player's action at setup"): the GM reads it,
   * with that act's own words (`words`, the words of his message it rests on, never the rest of it)
   * and the scene so far (`scene`, its beats as lines), against what the rules let him do now, as the
   * intent reader and the judge would; the engine resolves it on the scene's state, drawn from the
   * turn's seed with the act's ref, and its changes join moment 0. The outcome, where the rules
   * decided one, is the GM's beat. Each action the GM's reading dropped is said (LIVE3 L3a-5).
   */
  private async playerAttempt(b: PlayerBeat, attempt: string, ref: string, words: string, scene: readonly string[]): Promise<AttemptOut> {
    const { input, book } = this;
    input.sink.progress("The GM resolves what you attempt…");
    const r = await this.plugs.resolveAttempt(this.model, {
      registry: input.rt.registry,
      world: this.world,
      state: book.state,
      act: { actor: this.pov, surface: b.surface, ...(b.quotes ? { quotes: b.quotes } : {}), attempt, input: words },
      seed: this.plugs.attemptSeed(input.seed, ref),
      runSeed: input.runSeed,
      scene,
      texts: this.texts,
      signal: input.signal,
    });
    this.think(r.reasoning);
    for (const d of r.read.dropped) this.say(`The GM's reading of what you attempt dropped ${d.action}: ${d.why}.`);
    book.apply(r.events, 0);
    return r;
  }

  /** The setup, asked again once when its answer can't be read; a second failure fails the turn (the bridge says so). `resolved`: the actions the rules resolved of the player's turn, the ones he picked and those he attempted; `scene`: the scene playing, with its staging and its beats on the chain, or null when none is. */
  private async setup(playerBeats: DraftBeat[], signals: string[], resolved: readonly Resolution[], scene: Parameters<typeof authorSetup>[0]["scene"], talk: { with: EntityId } | null, takeover: string | undefined): Promise<SetupResult> {
    const { input, book } = this;
    const at = input.at;
    const state = book.state;
    const here = placeOfEntity(state, this.pov);
    const minded = new Set(mindedAt(state));
    const people = Object.keys(state.entities).filter((id) => {
      const e = state.entities[id];
      return id !== this.pov && e !== undefined && !isGone(state, id) && kindIs(input.rt.registry, this.world, e.kind, "person");
    });
    // Everyone the scene may reach (LIVE3d L3d-5), each by their id: the player character, everyone
    // with him, and those elsewhere it may reach only from afar (the far end of a call) or bring in:
    // first the world's own player character after a switch (he has no mind) and whom this turn names
    // (his beats, the scene playing, the talk), then whom he knows, then anyone with a mind.
    const named = new Set<EntityId>([this.world.pov, ...playerBeats.flatMap((b) => [...b.actors, ...(b.addressed ?? []), ...b.about.flatMap((r) => ("entity" in r ? [r.entity] : []))]), ...(scene ? [...scene.cast.map((c) => c.who), ...scene.staging.map((s) => s.who)] : []), ...(talk ? [talk.with] : [])]);
    const known = new Set(knowsFor({ registry: input.rt.registry }, { state, world: this.world }, [this.pov])[this.pov] ?? []);
    const rank = (id: EntityId): number => (named.has(id) ? 0 : known.has(id) ? 1 : minded.has(id) ? 2 : 3);
    const present: Present[] = [{ who: this.pov, mind: false }];
    const far: EntityId[] = [];
    for (const id of people) {
      if (together(this.world, here, placeOfEntity(state, id))) present.push({ who: id, mind: minded.has(id) });
      else if (rank(id) < 3) far.push(id);
    }
    const others = far
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, OTHERS_READ)
      .map((id): Present => {
        const p = placeOfEntity(state, id);
        return { who: id, mind: minded.has(id), where: (p ? own(this.world.places, p)?.name : undefined) ?? "somewhere else" };
      });
    const replaced = new Set(at.story.replaced.map((r) => r.id));
    const minds: PlayedMind[] = [];
    for (const p of present) if (p.mind && p.who !== this.pov) minds.push(await this.played(p.who, replaced, ["core", "now"]));
    const budget = this.budgetNow();
    const ask = () =>
      authorSetup({
        world: this.world,
        state,
        texts: this.texts,
        pov: this.pov,
        model: this.model,
        signal: input.signal,
        notebook: this.notebook,
        input: input.input?.text ?? null,
        playerBeats,
        resolved: resolved.map((r) => `${this.name(r.actor)}: ${r.action}${r.ok ? "" : " (failed)"}${r.outcome ? `, ${r.outcome}` : ""}${r.observable ? `: ${r.observable}` : ""}`),
        signals,
        scene,
        present: [...present, ...others],
        place: here,
        ...(takeover ? { takeover } : {}),
        talk,
        realtime: input.settings.depth.realtime,
        minds,
        ...(input.archive ? { archive: input.archive } : {}),
        ...(this.offscreen.length > 0 ? { offscreen: this.offscreen } : {}),
        ...(budget ? { budget } : {}),
      });
    try {
      return await ask();
    } catch (error) {
      if (!(error instanceof DepthAnswerError) || input.signal.aborted) throw error;
      this.say("The author's setup didn't come back in a form that could be read; asking again.");
      return ask();
    }
  }

  /** A character's mind files the author reads (core, self, now, on my mind), from the turn's state. */
  private async played(who: EntityId, replaced: ReadonlySet<string>, kinds: readonly ("core" | "self" | "now" | "mind")[]): Promise<PlayedMind> {
    const files = await readMind(this.book.reader, this.input.userId, this.book.state, who, replaced);
    const name = { core: "core.md", self: "self.md", now: "now.md", mind: "on-my-mind.md" } as const;
    const out: PlayedMind["files"] = {};
    for (const k of kinds) if (files[name[k]]) out[k] = files[name[k]];
    return { who, files: out };
  }

  /** The staging of a scene on the chain, with its texts. */
  private async stagingDrafts(scene: string): Promise<StagingDraft[]> {
    const out: StagingDraft[] = [];
    for (const s of stagingBefore(this.input.at.story, Number.MAX_SAFE_INTEGER, scene).values()) {
      const where = await this.book.reader.get(this.input.userId, s.where);
      const doing = await this.book.reader.get(this.input.userId, s.doing);
      const occluded = s.occluded ? await this.book.reader.get(this.input.userId, s.occluded) : null;
      if (where !== null && doing !== null) out.push({ who: s.who, where, doing, ...(occluded ? { occluded } : {}) });
    }
    return out;
  }

  /** Takes a continuing scene's staging as it stands, so the author's updates apply over it. */
  private async loadStaging(scene: string): Promise<void> {
    for (const s of await this.stagingDrafts(scene)) this.book.staging.set(s.who, s);
  }

  /** A scene's beats on the chain, newest kept, with their texts and refs. */
  private async sceneBeats(scene: string): Promise<{ ref: string; beat: BeatText }[]> {
    const placed = this.input.at.story.beats.filter((p) => p.beat.scene === scene).slice(-SCENE_BEATS_READ);
    const out: { ref: string; beat: BeatText }[] = [];
    for (const [i, p] of placed.entries()) {
      const what = await this.book.reader.get(this.input.userId, p.beat.what);
      const surface = await this.book.reader.get(this.input.userId, p.beat.surface);
      const quotes = p.beat.quotes ? await this.book.reader.get(this.input.userId, p.beat.quotes) : null;
      if (what === null || surface === null) continue;
      out.push({ ref: `e${i + 1}`, beat: { beat: p.beat, what, surface, ...(quotes ? { quotes } : {}) } });
    }
    return out;
  }

  /** The scene as the author reads it now: its beats on the chain (a continuing scene's) and this turn's, with refs. */
  private async sceneSoFar(): Promise<{ id: string; place: PlaceId; cast: SceneCast[]; staging: StagingDraft[]; beats: { ref: string; beat: BeatText }[] }> {
    const earlier = await this.sceneBeats(this.book.scene);
    const now = this.book.beats.slice(-SCENE_BEATS_READ).map((b, i) => ({ ref: `t${i + 1}`, beat: b }));
    return { id: this.book.scene, place: this.book.place, cast: this.book.cast, staging: [...this.book.staging.values()], beats: [...earlier, ...now].slice(-SCENE_BEATS_READ) };
  }

  /** Real time entered or ended by the setup (§2.5): a `story.talk` in moment 0, its line in the thinking block (`talkWritten`); an offer while it starts only from the chip, which says it. One refused (the budget slid them to the author) is said, and the author's next step hears it (LIVE3 L3b-3). The partner of real time it entered, or null. */
  private realtime(setup: SetupResult): EntityId | null {
    const r = setup.realtime;
    if (r === null) return null;
    const talk = talkNow(this.input.at.events, null);
    const say = { texts: this.texts, sink: this.input.sink, thinking: this.input.settings.depth.thinking };
    if ("end" in r) {
      if (!talk) return null;
      this.book.apply([talkWritten({ with: talk.with, state: "off", by: "author", why: r.end }, { ...say, name: this.name(talk.with) })], 0);
      return null;
    }
    if (!this.agents.has(r.with) || !hasAgent(this.world, this.book.state, r.with)) {
      const why = `real-time dialogue with ${this.name(r.with)} needs them playing as their own agent${this.slid.has(r.with) ? ", and the budget slid them to the author" : ""}; it wasn't entered`;
      this.say(`The author's setup: ${why}`);
      this.unkept = [...this.unkept, why];
      return null;
    }
    const offer = this.input.settings.depth.realtime === "chip";
    this.book.apply([talkWritten({ with: r.with, state: offer ? "offer" : "on", by: "author", scene: this.book.scene, ...(r.why ? { why: r.why } : {}) }, { ...say, name: this.name(r.with) })], 0);
    return offer ? null : r.with;
  }

  /** Hands a decided moment to the narrator, with the player character's staging. */
  private async moment(beats: readonly BeatText[], mark: number): Promise<void> {
    for (const b of beats) this.think(beatWords((id) => this.name(id), b));
    const render: RenderBeat[] = [];
    for (const b of beats) render.push(await this.book.renderBeat(b));
    if (reaches(render, this.pov)) this.reached = true;
    const staging = this.book.stagingOf(this.pov);
    this.narration?.add({ beats: render, ...(staging ? { staging } : {}), mark });
  }

  /** One character's play: its own mind, the scene as it lived it, what just reached it; null when its answer couldn't be read (said). */
  private async play(who: EntityId, read: SceneRead): Promise<{ who: EntityId; id: string; out: PlayOut } | null> {
    const { input, book } = this;
    const id = book.nextId();
    try {
      const mind = await mindInput({ registry: input.rt.registry, blobs: book.reader }, input.userId, { state: book.state, world: this.world, story: input.at.story }, who, input.settings);
      const so = await this.plugs.sceneSoFar(book.reader, input.userId, read, who);
      // What it perceives of the others is what the scene's beats brought it (§4.2): never the author's staging.
      const out = await this.plugs.play(this.model, { ...mind, beat: id, scene: so.scene, reached: so.reached, recall: this.plugs.sceneRecall(book.reader, input.userId, read, who), signal: input.signal });
      return { who, id, out };
    } catch (error) {
      if (input.signal.aborted) return null;
      if (!(error instanceof DepthAnswerError)) throw error;
      this.say(`${this.name(who)}'s agent gave no answer that could be read, so they let the moment pass.`);
      return null;
    }
  }

  /**
   * One beat of the scene (§2.3): the agents named play at once, from the same moment; what they
   * attempt goes to the GM; the author's step writes who perceived each beat, the staging it moved,
   * what the world does and the acts of those it plays or handles (those named whom the budget slid
   * to it among them), and who acts next. Null when the scene can't go on (a Stop, a step that
   * failed twice). `unreached`: nothing beyond his own beats has reached the player character this
   * turn, and this is the one more step the author is given for what does (LIVE3c L3c-5).
   */
  private async beat(next: readonly EntityId[], mark: number, left: number, unreached = false): Promise<StepResult | null> {
    const { input, book } = this;
    // Those named whom the budget slid to the author are its step's to play.
    const playing = next.filter((who) => this.agents.has(who));
    const handed = next.filter((who) => !this.agents.has(who));
    for (const who of playing) input.sink.progress(`${this.name(who)} decides what to do…`);
    // Whoever a walk-on's settled beats reached lives them as what reached them since it last played.
    const read: SceneRead = { world: this.world, state: book.state, story: input.at.story, beats: [...this.settled, ...book.beats.map((b) => b.beat)] };
    const plays = (await Promise.all(playing.map((who) => this.play(who, read)))).filter((p): p is { who: EntityId; id: string; out: PlayOut } => p !== null);
    if (input.signal.aborted) return null;
    const decided: { draft: DraftBeat; id: string }[] = [];
    let n = 0;
    for (const p of plays) {
      book.apply(p.out.events, mark);
      Object.assign(book.blobs, p.out.blobs);
      this.think(p.out.reasoning ? `${this.name(p.who)} (its own agent): ${p.out.reasoning}` : undefined);
      const act = p.out.act;
      if (act === null) {
        this.think(`${this.name(p.who)} lets the moment pass.`);
        continue;
      }
      const t = this.plugs.actBeatTexts(act, this.name(p.who));
      decided.push({ id: p.id, draft: { ref: `d${++n}`, decided: "character", actors: [p.who], act: act.act, ...t, ...(act.addressed ? { addressed: act.addressed } : {}), about: [], exposure: [] } });
      if (act.attempt === undefined) continue;
      input.sink.progress(`The GM resolves what ${this.name(p.who)} attempts…`);
      const r = await this.plugs.resolveAttempt(this.model, {
        registry: input.rt.registry,
        world: this.world,
        state: book.state,
        act: { actor: p.who, surface: t.surface, ...(t.quotes ? { quotes: t.quotes } : {}), attempt: act.attempt },
        seed: this.plugs.attemptSeed(input.seed, p.id),
        runSeed: input.runSeed,
        scene: book.beats.map((b) => beatLine(this.world, book.state, b)),
        texts: this.texts,
        signal: input.signal,
      });
      this.think(r.reasoning);
      for (const d of r.read.dropped) this.say(`The GM's reading of what ${this.name(p.who)} attempts dropped ${d.action}: ${d.why}.`);
      book.apply(r.events, mark);
      book.minute += Math.max(0, r.minutes);
      if (r.outcome) decided.push({ id: book.nextId(), draft: { ref: `d${++n}`, decided: "gm", actors: [], act: "happened", what: r.outcome.what, surface: r.outcome.surface, ...(r.outcome.quotes ? { quotes: r.outcome.quotes } : {}), about: r.outcome.about, exposure: [] } });
    }
    if (input.signal.aborted) return null;
    input.sink.progress("The author reads the moment…");
    const step = await this.step(decided.map((d) => d.draft), left, handed, unreached);
    if (step === null) {
      // The author couldn't go on: what was decided stands with the exposure each actor has of their own act.
      const kept: BeatText[] = [];
      for (const d of decided) {
        const b = await book.write(d.draft, d.draft.decided, mark, { id: d.id, model: this.model, texts: this.texts, signal: input.signal });
        if (b) kept.push(b);
      }
      await this.moment(kept, mark);
      return null;
    }
    this.think(step.reasoning);
    if (step.redone.length > 0) this.say(`The author's step couldn't all be kept: ${step.redone.join("; ")}. Told why, it took the step again.`);
    for (const r of step.refused) this.say(`The author's step: ${r}`);
    this.unkept = step.refused;
    const moment: BeatText[] = [];
    for (const d of decided) {
      const exposure = step.exposure.filter((x) => x.beat === d.draft.ref).map(({ who, channel, reach }) => ({ who, channel, reach }));
      const b = await book.write({ ...d.draft, exposure }, d.draft.decided, mark, { id: d.id, model: this.model, texts: this.texts, signal: input.signal });
      if (b) moment.push(b);
    }
    // Whom it stages arriving the scene moves where it plays, and whom it places elsewhere there, as the setup's (LIVE3 L3b-1, LIVE3c L3c-2).
    this.placed(step.staging, mark);
    book.stage(step.staging, mark, moment.at(-1)?.beat.id);
    for (const d of step.beats) {
      const b = await book.write(d, "author", mark, { model: this.model, texts: this.texts, signal: input.signal });
      if (b) moment.push(b);
    }
    await this.moment(moment, mark);
    return step;
  }

  /** The author's step, asked again once when its answer can't be read; null when it still can't (the turn ends where it is, said). */
  private async step(decided: DraftBeat[], left: number, handed: readonly EntityId[], unreached: boolean): Promise<StepResult | null> {
    const { input } = this;
    const scene = await this.sceneSoFar();
    const replaced = new Set(input.at.story.replaced.map((r) => r.id));
    const played: PlayedMind[] = [];
    for (const c of this.book.cast) if (c.effort === "author") played.push(await this.played(c.who, replaced, ["core", "self", "now", "mind"]));
    const budget = this.budgetNow();
    const ask = () => authorStep({ world: this.world, state: this.book.state, texts: this.texts, pov: this.pov, model: this.model, signal: input.signal, notebook: this.notebook, scene, decided, played, left, ...(this.unkept.length > 0 ? { refusedBefore: this.unkept } : {}), ...(budget ? { budget } : {}), ...(this.slid.size > 0 ? { slid: [...this.slid] } : {}), ...(handed.length > 0 ? { handed } : {}), ...(unreached ? { unreached: true as const } : {}) });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ask();
      } catch (error) {
        if (input.signal.aborted) return null;
        if (!(error instanceof DepthAnswerError)) throw error;
        if (attempt === 0) this.say("The author's step didn't come back in a form that could be read; asking again.");
      }
    }
    this.stepFailed = true;
    this.say("The author's step still couldn't be read: the turn ends here, and the player answers.");
    return null;
  }

  /** The narrator's question about a detail canon lacks: the author decides it as beats of that moment, or none. */
  private async ask(q: { questions: string[]; moment: Moment }): Promise<RenderBeat[] | null> {
    const { input, book } = this;
    if (input.signal.aborted) return null;
    try {
      const ids = new Set(q.moment.beats.map((b) => b.beat.id));
      const scene = await this.sceneSoFar();
      const refs = scene.beats.filter((b) => ids.has(b.beat.beat.id)).map((b) => b.ref);
      const answer = await authorAsk({ world: this.world, state: book.state, texts: this.texts, pov: this.pov, model: this.model, signal: input.signal, notebook: this.notebook, scene, moment: refs, questions: q.questions });
      this.think(answer.reasoning);
      for (const r of answer.refused) this.say(`The author's answer to the narrator: ${r}`);
      if (answer.beats.length === 0) return null;
      const out: RenderBeat[] = [];
      for (const d of answer.beats) {
        const b = await book.write(d, "author", q.moment.mark, { model: this.model, texts: this.texts, signal: input.signal });
        if (!b) continue;
        this.think(beatWords((id) => this.name(id), b));
        out.push(await book.renderBeat(b));
      }
      return out.length > 0 ? out : null;
    } catch (error) {
      if (!(error instanceof DepthAnswerError)) throw error;
      this.say("The author's answer to the narrator couldn't be read: the narrator renders without the detail.");
      return null;
    }
  }

  /** The moments are decided, or a stage failed (`failure`): the narrator finishes those it was given, a Stop's or the failure's cut is taken, and the record laid out. */
  private async finish(failure?: unknown): Promise<DepthTurnResult> {
    const { input, book } = this;
    // A stage that failed never ends in the quiet passage (LIVE3c L3c-5), nor does an author step unreadable twice (its
    // soft end): before any passage streamed, the turn fails as it would, or comes back empty with Retry.
    const out = this.narration ? await this.narration.drain({ quiet: failure === undefined && !this.stepFailed }) : null;
    const stopped = out?.stopped === true || input.signal.aborted;
    const streamed = out?.streamedThrough ?? null;
    // Before any passage streamed, a failure is the turn's: nothing of the scene stands, and the bridge says why.
    if (failure !== undefined && !stopped && streamed === null) throw failure;
    const error = failure === undefined || stopped ? null : failure instanceof Error ? failure.message : String(failure);
    const keep: number | "all" = stopped || error !== null ? (streamed ?? -1) : "all";
    if (stopped) this.say(keep === -1 ? "Stopped before any passage streamed: nothing of the scene is kept." : "Stopped: the beats whose prose streamed are kept.");
    else if (error !== null) this.say(`The scene stops here, since a stage failed: ${error}. The beats whose prose streamed are kept; nothing after them was decided.`);
    const layout = book.layout(keep, { runSeed: input.runSeed, capMinutes: input.settings.time.askBeyondMinutes });
    const result = this.result(layout.pre, out, stopped);
    return error !== null ? { ...result, error } : result;
  }

  /** A real-time exchange's result: the engine run's events, then the exchange's, as A2d cut them. */
  private exchange(outcome: Extract<RealtimeOutcome, { kind: "exchange" }>): DepthTurnResult {
    const { book } = this;
    book.apply(outcome.events, 0);
    Object.assign(book.blobs, outcome.blobs);
    const layout = book.layout("all", { runSeed: this.input.runSeed, capMinutes: this.input.settings.time.askBeyondMinutes });
    const result = this.result(layout.pre, outcome.narration, outcome.narration.stopped);
    // The character remembers the conversation when it ends, as a scene's end is for it.
    const talk = talkNow(this.input.at.events, null);
    return { ...result, after: { ...result.after, remember: outcome.ended && talk ? [talk.with] : [], poll: outcome.pollDeferred !== true } };
  }

  private result(pre: LedgerEvent[], out: NarrationOutcome | null, stopped: boolean): DepthTurnResult {
    const { book } = this;
    const blobs: Blobs = { ...book.blobs, ...(out?.blobs ?? {}) };
    return {
      pre: [...pre, ...this.spend()],
      read: out?.events ?? [],
      blobs,
      dropped: book.dropped,
      chips: this.input.plan?.chips ?? [],
      stopped,
      ...(out?.failed ? { failed: out.failed } : {}),
      after: afterOf(pre, true, this.signals),
    };
  }

  /**
   * What the turn cost, as its record keeps it (§4.7: spend folds with the work it paid for, so a
   * swipe that discards the turn gives it back): each walk-on's own line, then the scene's, the rest
   * of its calls, with what a ceiling put off. Counted in the story interval the turn starts in.
   */
  private spend(): LedgerEvent[] {
    const { input } = this;
    const at = { interval: input.settings.depth.budget.interval, at: input.at.state.clock };
    const out: LedgerEvent[] = [];
    let walked: Spent = { cost: NO_COST, roles: {} };
    for (const w of this.walked) {
      const d = spendData(w.spent, { treatment: "walk-on", ...at, for: w.draft });
      if (d) out.push(spendEvent(d));
      walked = addSpent(walked, w.spent);
    }
    const scene = spendData(spentSince(walked, this.meter.spent()), { treatment: "scene", ...at, for: input.turn, put: this.put });
    return scene ? [...out, spendEvent(scene)] : out;
  }
}

const EFFORT_WORDS: Readonly<Record<DepthEffort, string>> = { agent: "plays as their own agent", author: "is played by the author", world: "is part of the world" };

const DECIDER_WORDS: Readonly<Record<BeatDecider, string>> = { player: "you", character: "their own agent", gm: "the GM", author: "the author" };

/** A beat as the thinking block shows it as it is decided: who decided it, what happened, the words, and who perceived it. */
function beatWords(name: (id: EntityId) => string, b: BeatText): string {
  const decider = "turn" in b.beat.by ? DECIDER_WORDS[b.beat.by.decided] : "history";
  const who = b.beat.exposure.map((x) => `${name(x.who)}${x.reach === "partial" ? " (in part)" : ""}`).join(", ");
  return `Beat (${decider}): ${b.what}${b.quotes ? ` “${b.quotes}”` : ""}${who ? ` Perceived by ${who}.` : " No one perceived it."}`;
}
