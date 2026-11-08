// A depth turn's book (DEPTH-PLAN §4.2, §4.8, §4.9): where the scene's decisions become the record's
// events as they are made. It holds the turn's working state (every event validated against exactly
// the state it will see on re-fold, then applied), the record's pre in moment buckets (decision order
// within each; an ask's beats go into the moment that asked, which is safe because beats change no
// state), the texts the turn made, and the scene's beats and staging as the author reads them.
//
// A beat is written here once, whole: its id and minute, its place in the scene (`order`: the
// moment), the author's exposure with its bookkeeping (each actor perceives their own act; a reach
// to someone with a mind who isn't playing the scene as their own agent is `pending`, for a catch-up
// the poll decides), and the points of view of everyone it reached only in part, from the
// truth-blind render, which reads the surface, the words and the staging, never the truth.
//
// The final layout (`layout`) replays the engine run's events and the kept moments into a fresh
// working state, then passes the minutes the scene ran past the clock through the engine's time
// channel, so the record's pre folds exactly as it was decided, and a Stop's cut never keeps a
// moment it didn't stream.

import { heardAlone, mindedAt, needsPov, ownActWithoutDeed, presentAt } from "../../../shared/character-engine";
import type { EntityId, PlaceId, UserId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import type { PromptTexts } from "../../../shared/prompts";
import type { SceneCast } from "../../../shared/scene";
import { beatEvent, beatId, stagingEvent, type Beat, type BeatDecider, type Exposure, type StoryRef } from "../../../shared/story";
import type { WorldDoc } from "../../../shared/world";
import type { Registry } from "../../../engine/registry-impl";
import type { WorldState } from "../../../engine/state";
import { applyTimeAdvance, type AdvanceOutcome } from "../../../engine/time";
import { Working } from "../../../engine/working";
import { fellBackLine, povRender, type PovStaging } from "../../character-agent";
import { knowsFor, povRefs } from "../../character-engine";
import { putText, type BeatText, type Blobs, type StagingText } from "../common";
import type { ModelPort, PortUsage } from "../port";
import type { DraftBeat, ExposureDraft, StagingDraft } from "./author";
import type { RenderBeat } from "./contract";

/** A refusal or a note the thinking block says, so nothing is dropped silently. */
export type Say = (text: string) => void;

export interface BookInput {
  registry: Registry;
  world: WorldDoc;
  /** The fold the turn reads, before the engine run. */
  state: Readonly<WorldState>;
  /** The engine run's events, applied first. */
  prefix: readonly LedgerEvent[];
  /** The turn's token: beat ids are made from it. */
  turn: string;
  userId: UserId;
  /** The user's blobs: the turn's own texts are read first. */
  blobs: { get(userId: UserId, hash: string): Promise<string | null> };
  /** The player character (`povOf`). */
  pov: EntityId;
  say: Say;
}

export class SceneBook {
  readonly registry: Registry;
  readonly world: WorldDoc;
  readonly base: Readonly<WorldState>;
  readonly prefix: LedgerEvent[];
  readonly turn: string;
  readonly userId: UserId;
  readonly pov: EntityId;
  /** The working state: the engine run's events and every decision so far, applied. */
  readonly working: Working;
  /** The texts the turn made, by hash: put before the commit. */
  readonly blobs: Blobs = {};
  /** The turn's beats, in decision order, with their texts. */
  readonly beats: BeatText[] = [];
  /** Each of the turn's beats' moment. */
  readonly markOf = new Map<string, number>();
  /** Events the working state refused, with why. */
  readonly dropped: { event: LedgerEvent; reason: string }[] = [];
  /** What the turn's points of view cost. */
  usage: PortUsage = { tokensIn: 0, tokensOut: 0 };
  private readonly buckets: LedgerEvent[][] = [];
  private readonly store: BookInput["blobs"];
  private readonly say: Say;
  private count = 0;

  // The scene as it stands.
  scene = "";
  place: PlaceId = "";
  cast: SceneCast[] = [];
  /** Each person's current staging, as the author and the render read it. */
  readonly staging = new Map<EntityId, StagingDraft>();
  /** The first `order` this turn's moments take: after every beat on the chain, so story order never puts a later moment first. */
  orderBase = 0;
  /** The scene's minute: the last beat's. It starts at the turn's own (before the engine run's time) and moves by the minutes the author says pass and an attempt takes. */
  minute: number;

  constructor(input: BookInput) {
    this.registry = input.registry;
    this.world = input.world;
    this.base = input.state;
    this.prefix = [...input.prefix];
    this.turn = input.turn;
    this.userId = input.userId;
    this.pov = input.pov;
    this.store = input.blobs;
    this.say = input.say;
    this.working = new Working(input.registry, input.world, input.state);
    this.minute = input.state.clock;
    for (const e of this.prefix) {
      const r = this.working.apply(e);
      if (r) this.refused(e, r.reason);
    }
  }

  /** The working state now. */
  get state(): Readonly<WorldState> {
    return this.working.state;
  }

  /** Reads a text: the turn's own first, then the user's store. */
  readonly reader = {
    get: async (userId: UserId, hash: string): Promise<string | null> => this.blobs[hash] ?? (await this.store.get(userId, hash)),
  };

  private refused(event: LedgerEvent, reason: string): void {
    this.dropped.push({ event, reason });
    this.say(`An event of the scene wasn't kept (${event.type}): ${reason}`);
  }

  /** Applies events in decision order into moment `mark`; one the working state refuses is dropped and said. Returns those kept. */
  apply(events: readonly LedgerEvent[], mark: number): LedgerEvent[] {
    while (this.buckets.length <= mark) this.buckets.push([]);
    const bucket = this.buckets[mark] as LedgerEvent[];
    const kept: LedgerEvent[] = [];
    for (const e of events) {
      const r = this.working.apply(e);
      if (r) {
        this.refused(e, r.reason);
        continue;
      }
      bucket.push(e);
      kept.push(e);
    }
    return kept;
  }

  /** How many of the record's pre events run through moment `mark`: the engine run's, then each moment's. */
  throughOf(mark: number): number {
    let n = this.prefix.length;
    for (let i = 0; i <= mark && i < this.buckets.length; i++) n += this.buckets[i]?.length ?? 0;
    return n;
  }

  /** Who has a mind at the working state. */
  minded(): Set<EntityId> {
    return new Set(mindedAt(this.working.state));
  }

  /** Sets the scene's staging and records it (`story.staging`), after beat `after` when the scene is under way. */
  stage(drafts: readonly StagingDraft[], mark: number, after?: string): void {
    for (const d of drafts) {
      this.staging.set(d.who, d);
      const t = this.stagingOf(d.who) as StagingText;
      this.apply([stagingEvent({ ...t.staging, ...(after ? { after } : {}) })], mark);
    }
  }

  /** A person's current staging with its texts (the narrator's moment, a play's own staging). */
  stagingOf(who: EntityId): StagingText | undefined {
    const d = this.staging.get(who);
    if (!d) return undefined;
    const where = putText(this.blobs, d.where);
    const doing = putText(this.blobs, d.doing);
    const occluded = d.occluded ? putText(this.blobs, d.occluded) : undefined;
    return { staging: { who, scene: this.scene, where, doing, ...(occluded ? { occluded } : {}) }, where: d.where, doing: d.doing, ...(d.occluded ? { occluded: d.occluded } : {}) };
  }

  /** A new beat's id, unique in the turn. */
  nextId(): string {
    return beatId(this.turn, String(this.count++));
  }

  /**
   * The exposure a beat is written with: the author's, each actor added as perceiving their own act
   * (whole, by sight) where the author left them out, and a reach to someone with a mind who doesn't
   * play the scene as their own agent marked pending, for the catch-up the poll decides.
   */
  exposure(actors: readonly EntityId[], given: readonly ExposureDraft[]): Exposure[] {
    const minded = this.minded();
    const agents = new Set(this.cast.filter((c) => c.effort === "agent").map((c) => c.who));
    const out: Exposure[] = [];
    const add = (x: ExposureDraft): void => {
      if (out.some((o) => o.who === x.who)) return;
      const pending = x.who !== this.pov && minded.has(x.who) && !agents.has(x.who);
      out.push({ who: x.who, channel: x.channel, reach: x.reach, ...(pending ? { pending: true as const } : {}) });
    };
    for (const x of given) add(x);
    for (const a of actors) if (hasOwn(this.working.state.entities, a)) add({ who: a, channel: "sight", reach: "whole" });
    return out;
  }

  /**
   * The points of view the truth-blind render writes (one call covers them all), for everyone the
   * shared reach rule says needs one (`needsPov`): a reach in part, a message received without its
   * words, and a whole reach of a beat that involves someone they don't know, so the surface never
   * names a stranger to them; and each actor of a beat with no deed but the player character
   * (`ownActWithoutDeed`), as the one doing it, so none lives the surface as its own act. Each is told
   * how it may name each person of the moment, the beat's people and the scene's staged ones
   * (`povRefs`), and what it could sense of the staging. One the render, asked again, still wrote
   * none of, or named someone who wasn't there in and its GM's check couldn't set right, is left
   * without one, pending (said); no rule writes it.
   */
  async povs(beat: { id: string; surface: string; deed?: string; quotes?: string } & Pick<Beat, "actors" | "about"> & Partial<Pick<Beat, "addressed">>, exposure: Exposure[], model: ModelPort, texts: PromptTexts | undefined, signal: AbortSignal | undefined): Promise<void> {
    const at = { state: this.working.state, world: this.world };
    const knows = knowsFor({ registry: this.registry }, at, exposure.map((x) => x.who));
    const need = exposure.filter((x) => x.pov === undefined && (needsPov({ ...beat, exposure }, x.who, knows[x.who] ?? []) || ownActWithoutDeed(beat, x.who, this.pov))).map((x) => x.who);
    if (need.length === 0) return;
    const staging: PovStaging[] = [...this.staging.values()].map((s) => ({ who: s.who, where: s.where, doing: s.doing, ...(s.occluded ? { occluded: s.occluded } : {}) }));
    const refs = povRefs({ registry: this.registry }, at, need, [...presentAt({ ...beat, exposure }), ...staging.map((s) => s.who)]);
    const out = await povRender(model, { beat: { id: beat.id, surface: beat.surface, ...(beat.quotes ? { quotes: beat.quotes } : {}), actors: beat.actors, exposure }, staging, who: need, refs, ...(texts ? { texts } : {}), ...(signal ? { signal } : {}) });
    this.usage = { tokensIn: this.usage.tokensIn + out.usage.tokensIn, tokensOut: this.usage.tokensOut + out.usage.tokensOut };
    for (const x of exposure) {
      const pov = out.povs[x.who];
      if (x.pov === undefined && need.includes(x.who) && pov !== undefined) x.pov = putText(this.blobs, pov);
    }
    for (const [who, names] of Object.entries(out.pending)) this.say(fellBackLine(who, `beat ${beat.id}`, names));
  }

  /**
   * Writes a beat, whole: its id, minute (the scene's, plus `after`), moment and place, its texts as
   * blobs (a deed only where someone acts in it: each actor lives it as their own act), its exposure
   * with the points of view of a partial reach, and who decided it. The working state applies it in
   * moment `mark`. Returns it with its texts, or null when the working state refused it (said).
   */
  async write(draft: DraftBeat, decided: BeatDecider, mark: number, o: { id?: string; model: ModelPort; texts?: PromptTexts; signal?: AbortSignal; supersedes?: string[] }): Promise<BeatText | null> {
    const id = o.id ?? this.nextId();
    this.minute += draft.after ?? 0;
    // His inner life reaches no one but him, whatever exposure an answer gave it (§4.2).
    const exposure = draft.inner ? [{ who: this.pov, channel: "sight" as const, reach: "whole" as const }] : this.exposure(draft.actors, draft.exposure);
    const about: StoryRef[] = draft.about.length > 0 ? draft.about : [...new Set([...draft.actors, ...(draft.addressed ?? [])])].map((entity) => ({ entity }));
    const deed = draft.deed !== undefined && draft.actors.length > 0 ? draft.deed : undefined;
    await this.povs({ id, surface: draft.surface, ...(deed !== undefined ? { deed } : {}), ...(draft.quotes ? { quotes: draft.quotes } : {}), actors: draft.actors, about, ...(draft.addressed ? { addressed: draft.addressed } : {}) }, exposure, o.model, o.texts, o.signal);
    const beat: Beat = {
      id,
      at: this.minute,
      order: this.orderBase + mark,
      scene: this.scene,
      place: this.place,
      actors: draft.actors,
      act: draft.act,
      about,
      what: putText(this.blobs, draft.what),
      ...(deed !== undefined ? { deed: putText(this.blobs, deed) } : {}),
      surface: putText(this.blobs, draft.surface),
      ...(draft.quotes ? { quotes: putText(this.blobs, draft.quotes) } : {}),
      ...(draft.addressed && draft.addressed.length > 0 ? { addressed: draft.addressed } : {}),
      exposure,
      by: { turn: this.turn, decided },
      ...(o.supersedes && o.supersedes.length > 0 ? { supersedes: o.supersedes } : {}),
      ...(draft.uncertain ? { uncertain: putText(this.blobs, draft.uncertain) } : {}),
    };
    if (this.apply([beatEvent(beat)], mark).length === 0) return null;
    const text: BeatText = { beat, what: draft.what, surface: draft.surface, ...(draft.quotes ? { quotes: draft.quotes } : {}) };
    this.beats.push(text);
    this.markOf.set(id, mark);
    return text;
  }

  /** A beat as the narrator renders it: its texts and, where the player character's reach was partial or by hearing alone (LIVE3c L3c-4), his own point of view. */
  async renderBeat(b: BeatText): Promise<RenderBeat> {
    const x = b.beat.exposure.find((e) => e.who === this.pov);
    const pov = x?.pov && (x.reach === "partial" || heardAlone(b.beat, this.pov)) ? await this.reader.get(this.userId, x.pov) : null;
    return { ...b, ...(pov !== null ? { pov } : {}) };
  }

  /**
   * The record's pre in its final layout: the engine run's events, then the moments through `keep`
   * (every moment with "all", none with -1), replayed into a fresh working state, then the minutes
   * the kept beats ran past its clock passed through the engine's time channel. What the replay
   * refuses is dropped and said (it never should: every state change keeps the order it was decided in).
   */
  layout(keep: number | "all", time: { runSeed: string; capMinutes: number }): { pre: LedgerEvent[]; advance: AdvanceOutcome | null } {
    const w = new Working(this.registry, this.world, this.base);
    const last = keep === "all" ? this.buckets.length - 1 : keep;
    for (const e of [...this.prefix, ...this.buckets.slice(0, last + 1).flat()]) {
      const r = w.apply(e);
      if (r) this.refused(e, r.reason);
    }
    const minute = this.beats.filter((b) => (this.markOf.get(b.beat.id) ?? Infinity) <= last).reduce((m, b) => Math.max(m, b.beat.at), w.state.clock);
    const over = minute - w.state.clock;
    const advance = over > 0 ? applyTimeAdvance(this.registry, w, over, { runSeed: time.runSeed, capMinutes: time.capMinutes, unitCap: w.state.time.unitCap }) : null;
    if (advance && !advance.applied && advance.reason !== null) this.say(`The scene ran ${over} minutes past the clock, more than one time advance reaches: the Timelapse chip takes the clock there.`);
    return { pre: w.events, advance };
  }
}
