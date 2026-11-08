// The narrator's render (DEPTH-PLAN §1.3, §3.8, §3.10, §5.2): the scene's decided beats become the
// reply, moment by moment, from the player character's point of view. Each moment the scene decides
// is rendered, checked by the GM against that moment's beats and streamed, strictly in order, while
// the scene decides the next: the first paragraph arrives after one beat, the thinking block shows
// each check and redraft, Stop lands between beats, and no streamed word is ever rewritten. A
// passage that fails its check goes back with the GM's notes, up to Settings → Depth's redrafts per
// passage; one that still fails streams with a chip saying where it departs, and canon stays the
// beats. The narrator may ask for a detail canon lacks; the author decides it as a beat of that
// moment before the passage renders. Nothing reads the reply to decide anything.
//
// What the narrator sees is fixed by construction: of each beat, only what reached the player
// character (the surface and exact words where the reach was whole, his own point of view where it
// was partial), and of the player's own beats, which his message already tells, what he did; never
// another beat's truth, a mind or a take. The GM's check reads the whole beats, out of world.
//
// When the narrator fails (a call that failed, or no passage after its redrafts), it renders nothing
// more, and the scene goes on deciding its moments, which stay canon: the moments it didn't render
// come back as one `story.unrendered` event after the prose, so the reply's chip says so and a
// Re-narrate renders them (§1.4: nothing hidden from the player).
//
// A Re-narrate (P3) renders its source's beats again exactly, regrouped as its source's prose
// grouped them and its unrendered moments held them (`renarrateMoments`), and asks nothing: it never
// decides a beat. Pure apart from the port and the sink: each passage comes back as a `story.passage`
// event for the record's read part.

import { renderPrompt } from "../../prompts";
import { own } from "../../../engine/pack-kit";
import { cutShort } from "../../agents/runtime";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { NARRATION_TEXT } from "../../../shared/narration-prompts";
import { departsLine, type Passage, type PassageDraft, passageEvent, passagesIn, unrenderedEvent, unrenderedIn, type UnrenderedMoment } from "../../../shared/passage";
import { heardAlone, wordsAlone } from "../../../shared/character-engine";
import { type Beat, beatOf, type Exposure, STORY_BEAT, STORY_STAGING, type Staging, stagingOf } from "../../../shared/story";
import { type Blobs, putText, readAnswer, type StagingText } from "../common";
import { addUsage, NO_USAGE, roomAgain, type PortMessage, type PortUsage } from "../port";
import type { Moment, NarrationDeps, NarrationFactory, NarrationInput, NarrationOutcome, NarrationPort, PassageOutcome, RenderBeat } from "./contract";

/** How a beat of the moment reached the player character: his own (context), whole, in part with his point of view, or whole by hearing alone with his point of view (LIVE3c L3c-4: never what there was to see). */
type Seen = { kind: "context"; b: RenderBeat } | { kind: "whole"; b: RenderBeat; via: Exposure } | { kind: "partial" | "heard"; b: RenderBeat; via: Exposure; pov: string };

/** A beat of the moment the player character didn't perceive, or perceived in part with no point of view written: the check is told it, the narrator never. */
interface Unseen {
  b: RenderBeat;
  partial?: true;
}

interface Sorted {
  seen: Seen[];
  unseen: Unseen[];
}

/** One check's verdict: faithful, not, or null when no check could be read; what it says to change; its line for the chip. */
export interface Verdict {
  faithful: boolean | null;
  notes: string;
  departs?: string;
  reasoning?: string;
}

/** Checks of one draft before it counts as unchecked: the first, and one more when its answer doesn't read, with more room where the first was cut off at its room (`roomAgain`). */
const CHECK_TRIES = 2;

/** An answer line asking for a detail (`depth.narrator.ask`). */
const ASK_LINE = /^\s*ASK:\s*(.+?)\s*$/i;

/** A Stop seen between the narrator's steps: the passage being made never streams. */
class Stopped extends Error {}

/** How each beat of a moment reached `pov`: the player's own beats are context, which his message already tells. */
function sortBeats(beats: readonly RenderBeat[], pov: EntityId): Sorted {
  const out: Sorted = { seen: [], unseen: [] };
  for (const b of beats) {
    if ("turn" in b.beat.by && b.beat.by.decided === "player") {
      out.seen.push({ kind: "context", b });
      continue;
    }
    const via = b.beat.exposure.find((x) => x.who === pov);
    if (!via) out.unseen.push({ b });
    // Heard alone, a beat with more than its words reaches him as his own point of view of it, never what there was to see (LIVE3c L3c-4); its words alone are its surface.
    else if (via.reach === "whole" && heardAlone(b.beat, pov) && !wordsAlone(b.beat) && b.pov !== undefined && b.pov.trim() !== "") out.seen.push({ kind: "heard", b, via, pov: b.pov.trim() });
    else if (via.reach === "whole") out.seen.push({ kind: "whole", b, via });
    else if (b.pov !== undefined && b.pov.trim() !== "") out.seen.push({ kind: "partial", b, via, pov: b.pov.trim() });
    else out.unseen.push({ b, partial: true });
  }
  return out;
}

function section(heading: string, body: string | undefined): string {
  const text = body?.trim() ?? "";
  return text === "" ? "" : `## ${heading}\n${text}`;
}

function stagingLine(s: StagingText | undefined): string | undefined {
  if (!s) return undefined;
  const occluded = s.occluded?.trim();
  return [s.where.trim(), s.doing.trim(), occluded ? `what blocks their view or hearing: ${occluded}` : ""].filter((p) => p !== "").join("; ");
}

/** A beat's exact words, as the narrator and the check read them. */
function words(b: RenderBeat, indent = ""): string {
  return b.quotes && b.quotes.trim() !== "" ? `\n${indent}Exact words: “${b.quotes.trim()}”` : "";
}

function nameOf(state: NarrationInput["state"], id: EntityId): string {
  return own(state.entities, id)?.name ?? id;
}

/** Where a beat came from, as the check reads it. */
function decidedBy(beat: Beat): string {
  if ("turn" in beat.by) return `decided by the ${beat.by.decided}`;
  if ("draft" in beat.by) return "from a settled draft";
  return "bootstrap" in beat.by ? "distilled from the history" : "from an imported memory";
}

/** The details an answer asks for, when every line of it is an "ASK: " line; null when it is a passage. */
function asksIn(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const asked = lines.map((l) => ASK_LINE.exec(l)?.[1] ?? "");
  return lines.length > 0 && asked.every((q) => q !== "") ? asked : null;
}

/** Whether anything of `beats` reaches `pov` for the narrator to tell: a beat beyond his own (the player's, which his message already tells) that he perceived as far as it can be told (LIVE3c L3c-5). */
export function reaches(beats: readonly RenderBeat[], pov: EntityId): boolean {
  return sortBeats(beats, pov).seen.some((s) => s.kind !== "context");
}

/** A check's answer read: `faithful` must be a boolean, and its problems become the notes the redraft reads. Null when it doesn't read (none: it wasn't JSON). */
export function verdictOf(a: Record<string, unknown> | null): Verdict | null {
  if (!a || typeof a.faithful !== "boolean") return null;
  const lines: string[] = [];
  for (const p of Array.isArray(a.problems) ? a.problems : []) {
    if (typeof p !== "object" || p === null) continue;
    const q = p as Record<string, unknown>;
    const said = typeof q.words === "string" && q.words.trim() !== "" ? `“${q.words.trim()}”` : "";
    const beat = typeof q.beat === "string" && q.beat.trim() !== "" ? ` (beat ${q.beat.trim()})` : q.beat === null ? " (an addition)" : "";
    const problem = typeof q.problem === "string" ? q.problem.trim() : "";
    const change = typeof q.change === "string" && q.change.trim() !== "" ? ` Change: ${q.change.trim()}` : "";
    const line = `${said}${beat}${said || beat ? ": " : ""}${problem}${change}`.trim();
    if (line !== "") lines.push(line);
  }
  const notes = lines.map((l) => `- ${l}`).join("\n");
  if (a.faithful) return { faithful: true, notes };
  const departs = typeof a.departs === "string" && a.departs.trim() !== "" ? a.departs.trim() : lines[0];
  return { faithful: false, notes: notes !== "" ? notes : (departs ?? "The GM found the passage unfaithful to its beats but named nothing: render the moment again from what the beats hold."), ...(departs !== undefined ? { departs } : {}) };
}

/** One passage as it is made: the moment (with any beats an ask added), its drafts and verdicts, its asks and timings. */
interface Making {
  moment: Moment;
  sorted: Sorted;
  drafts: { text: string; verdict: Verdict; reasoning?: string }[];
  asked: { questions: string[]; beats: string[] }[];
  ms: { render: number; check: number };
  started: number;
  /** Nothing of the turn reached the player character but his own beats (LIVE3c L3c-5): the one passage tells him where he is and what he's doing, so the reply is never empty. */
  quiet?: true;
}

type Rendered = { kind: "passage"; text: string } | { kind: "ask"; questions: string[] };

interface PartOptions {
  asks: boolean;
  asked: boolean;
  redraft?: { draft: string; verdict: Verdict };
}

/**
 * The narrator of one turn (`NarrationPort`): moments are added in the order the scene decides
 * them and rendered one after another in the background, so the scene never waits on the prose.
 */
export class Narration implements NarrationPort {
  private readonly queue: Moment[] = [];
  private running: Promise<void> | null = null;
  private readonly streamed: { outcome: PassageOutcome; making: Making }[] = [];
  /** The moments the narrator didn't render once it failed: the one it failed on, and every later one something reached the player character in. */
  private readonly unrendered: Moment[] = [];
  /** Every moment added, in order: the quiet passage's (`drain`). */
  private readonly given: Moment[] = [];
  /** The moment being rendered, with any beats an ask added to it. */
  private making: Making | null = null;
  private usage: PortUsage = NO_USAGE;
  private stopped = false;
  private failure: string | undefined;
  private drained = false;
  private lastMark = -1;
  private readonly povName: string;
  private readonly vars: Record<string, string>;
  private readonly now: () => number;

  constructor(
    private readonly deps: NarrationDeps & { now?: () => number },
    private readonly input: NarrationInput & { knows?: readonly EntityId[] },
  ) {
    this.povName = nameOf(input.state, input.pov);
    this.vars = { world: input.world.name, pov: this.povName };
    this.now = deps.now ?? Date.now;
  }

  /** A moment the scene decided: rendered after every moment before it, while the scene goes on. */
  add(moment: Moment): void {
    if (this.drained) throw new Error("the narration was drained: no moment can follow");
    if (moment.mark <= this.lastMark) throw new Error(`moment ${moment.mark} came after moment ${this.lastMark}: moments come in the order the scene decides them`);
    this.lastMark = moment.mark;
    this.queue.push(moment);
    this.given.push(moment);
    this.pump();
  }

  /**
   * Once every moment added has streamed, the turn stopped or the narrator failed: what was told, its
   * events, and where Stop's cut falls. Where nothing of the turn reached the player character but his
   * own beats, and so nothing streamed (LIVE3c L3c-5), its one passage is a short, honest one of where
   * he is and what he's doing as the turn's last moment leaves him, its beats all of the turn's, so the
   * reply is never empty; the passage says so (`quiet`), and so does the reply's chip. Not where a
   * stage of the turn failed (`quiet: false`): the turn then fails as it would.
   */
  async drain(o: { quiet?: boolean } = {}): Promise<NarrationOutcome> {
    while (this.running) await this.running;
    this.drained = true;
    if (o.quiet !== false && this.streamed.length === 0 && this.failure === undefined && !this.stopped) await this.quiet();
    return this.outcome();
  }

  /** The quiet passage (`drain`): every moment's beats as one, with the player character's staging as the last moment that had one left it. */
  private async quiet(): Promise<void> {
    const last = this.given.at(-1);
    const beats = this.given.flatMap((m) => m.beats);
    if (!last || beats.length === 0) return;
    const staging = this.given.findLast((m) => m.staging !== undefined)?.staging;
    try {
      if (this.input.signal.aborted) throw new Stopped();
      await this.render({ beats, mark: last.mark, ...(staging ? { staging } : {}) }, true);
    } catch (error) {
      if (this.input.signal.aborted || error instanceof Stopped) {
        this.stopped = true;
        return;
      }
      this.failure = error instanceof Error ? error.message : String(error);
      this.deps.sink.progress(`The narrator couldn't render the reply (${this.failure}). The scene's beats stand as decided.`);
    } finally {
      this.making = null;
    }
  }

  private pump(): void {
    if (this.running) return;
    this.running = this.run().finally(() => {
      this.running = null;
      // A moment added after the queue emptied but before this ran.
      if (this.queue.length > 0) this.pump();
    });
  }

  private async run(): Promise<void> {
    for (let moment = this.queue.shift(); moment; moment = this.queue.shift()) {
      if (this.input.signal.aborted) this.stopped = true;
      if (this.stopped) continue;
      let failed = moment;
      if (this.failure === undefined) {
        try {
          await this.render(moment);
          continue;
        } catch (error) {
          if (this.input.signal.aborted || error instanceof Stopped) {
            this.stopped = true;
            continue;
          }
          this.failure = error instanceof Error ? error.message : String(error);
          failed = this.making?.moment ?? moment;
          this.deps.sink.progress(`The narrator couldn't render passage ${this.streamed.length + 1} (${this.failure}). What streamed stands; the scene's beats stand as decided, and the reply's chip offers Re-narrate, which renders every moment again.`);
        } finally {
          this.making = null;
        }
      }
      // The narrator failed, on this moment or before: kept for `story.unrendered` where something of it reached the player character.
      if (sortBeats(failed.beats, this.input.pov).seen.some((s) => s.kind !== "context")) this.unrendered.push(failed);
    }
  }

  /** Thinking-block text (D-5), shown only when Settings → Depth shows the whole thinking. */
  private reasoning(text: string): void {
    if (this.input.settings.thinking === "whole" && text.trim() !== "") this.deps.sink.reasoning(`\n\n${text.trim()}\n\n`);
  }

  // ---------------------------------------------------------------- one moment

  private async render(given: Moment, quiet = false): Promise<void> {
    const sorted = sortBeats(given.beats, this.input.pov);
    // Nothing reached the player character but his own beats: the moment is decided, with no passage (but the quiet one, `drain`).
    if (!quiet && !sorted.seen.some((s) => s.kind !== "context")) return;
    const index = this.streamed.length;
    const n = index + 1;
    const making: Making = { moment: { ...given, beats: [...given.beats] }, sorted, drafts: [], asked: [], ms: { render: 0, check: 0 }, started: this.now(), ...(quiet ? { quiet: true as const } : {}) };
    this.making = making;
    const asks = !quiet && this.input.asks && this.deps.ask !== undefined;
    this.deps.sink.progress(`The narrator is rendering passage ${n}`);
    let rendered = await this.narrate(making, { asks, asked: false });
    if (rendered.kind === "ask") {
      // One round of asks: the author decides what it will as beats of this moment, then it renders.
      this.reasoning(`The narrator asks, for passage ${n}: ${rendered.questions.join("; ")}`);
      this.deps.sink.progress("The author is deciding what the narrator asked for");
      const added = (await this.deps.ask?.({ questions: rendered.questions, moment: making.moment })) ?? [];
      if (this.input.signal.aborted) throw new Stopped();
      const fresh = added.filter((b) => !making.moment.beats.some((x) => x.beat.id === b.beat.id));
      making.moment.beats.push(...fresh);
      making.sorted = sortBeats(making.moment.beats, this.input.pov);
      making.asked.push({ questions: rendered.questions, beats: fresh.map((b) => b.beat.id) });
      this.deps.sink.progress(`The narrator is rendering passage ${n}`);
      rendered = await this.narrate(making, { asks: false, asked: true });
    }
    let draft = rendered.kind === "passage" ? rendered.text : "";
    let verdict = await this.check(making, draft, n);
    for (let redraft = 1; verdict.faithful === false && redraft <= this.input.settings.redrafts; redraft++) {
      this.deps.sink.progress(`The narrator is redrafting passage ${n} (${redraft} of ${this.input.settings.redrafts})`);
      const again = await this.narrate(making, { asks: false, asked: making.asked.length > 0, redraft: { draft, verdict } });
      draft = again.kind === "passage" ? again.text : "";
      verdict = await this.check(making, draft, n);
    }
    if (draft === "") throw new Error("the narrator wrote no passage");
    const departs = verdict.faithful === true ? undefined : departsLine(verdict.departs ?? (verdict.faithful === null ? "This passage couldn't be checked against its beats." : "This passage departs from its beats."));
    if (departs !== undefined) this.reasoning(`Passage ${n} streams with a chip: ${departs}`);
    // Stop lands between beats: a passage the player stopped before never streams, and its beats go.
    if (this.input.signal.aborted) throw new Stopped();
    this.deps.sink.content(`${index > 0 ? "\n\n" : ""}${draft}`);
    this.streamed.push({
      making,
      outcome: {
        index,
        mark: given.mark,
        beats: making.moment.beats.map((b) => b.beat.id),
        text: draft,
        faithful: verdict.faithful,
        redrafts: making.drafts.length - 1,
        ...(departs !== undefined ? { departs } : {}),
        ms: { render: making.ms.render, check: making.ms.check, total: this.now() - making.started },
      },
    });
  }

  /** The narrator's part of its prompt, which the frame places: its rules, the scene's context and the moment as it reached the player character. */
  private part(making: Making, o: PartOptions): string {
    const texts = this.input.texts;
    const knows = this.input.knows?.filter((id) => id !== this.input.pov).map((id) => nameOf(this.input.state, id));
    const reply = this.streamed.map((s) => s.outcome.text).filter((t) => t.trim() !== "").join("\n\n");
    // In the order they happened, without their ids, which belong to the check and never to the prose.
    const seen = making.sorted.seen
      .map((s, i) => {
        if (s.kind === "context") return `${i + 1}. ${this.povName}'s own, as the player wrote it (already in the player's message):\n${s.b.what.trim()}${words(s.b)}`;
        if (s.kind === "whole") return `${i + 1}. It reached ${this.povName} whole, by ${s.via.channel}:\n${s.b.surface.trim()}${words(s.b)}`;
        if (s.kind === "heard") return `${i + 1}. It reached ${this.povName} by hearing alone: only what could be heard of it, nothing of what there was to see. What reached them:\n${s.pov}${words(s.b)}`;
        return `${i + 1}. It reached ${this.povName} only in part, by ${s.via.channel}. What reached them:\n${s.pov}`;
      })
      .join("\n\n");
    return [
      renderPrompt(NARRATION_TEXT.render, texts, this.vars),
      o.asks ? renderPrompt(NARRATION_TEXT.ask, texts, this.vars) : "",
      knows !== undefined ? section(`Whom ${this.povName} knows by name`, knows.length > 0 ? `${knows.join(", ")}. Describe anyone else as they appear.` : "No one here: describe everyone as they appear.") : "",
      section("From the author's notebook, for this scene", (this.input.excerpts ?? []).map((e) => e.trim()).filter((e) => e !== "").join("\n\n")),
      section("Words from earlier in the story, exactly as they were written (the author pulled them for a callback)", (this.input.quotes ?? []).map((q) => `From message ${q.index + 1}${q.when ? ` (${q.when})` : ""}${q.why ? `, for ${q.why}` : ""}${q.truncated ? ", its start" : ""}:\n${q.text}`).join("\n\n")),
      // The frame carries the recent window itself (B2's short context).
      this.deps.frame ? "" : section("The story so far", this.input.before),
      section("This reply so far", reply),
      section(`Where ${this.povName} is`, stagingLine(making.moment.staging)),
      section("This moment", seen),
      making.quiet ? renderPrompt(NARRATION_TEXT.quiet, texts, this.vars) : "",
      section("What the player asked this telling to change", this.input.direction?.trim()),
      o.asked ? renderPrompt(NARRATION_TEXT.asked, texts, this.vars) : "",
      o.redraft ? section("Your draft", o.redraft.draft === "" ? "(nothing)" : o.redraft.draft) : "",
      o.redraft ? section("What the GM found", o.redraft.verdict.notes) : "",
      o.redraft ? renderPrompt(NARRATION_TEXT.redraft, texts, this.vars) : "",
      renderPrompt(NARRATION_TEXT.answer, texts, this.vars),
    ]
      .filter((p) => p.trim() !== "")
      .join("\n\n");
  }

  /** One narrator call: a passage (its draft kept), or the details it asks for where it may ask. */
  private async narrate(making: Making, o: PartOptions): Promise<Rendered> {
    if (this.input.signal.aborted) throw new Stopped();
    const started = this.now();
    const part = this.part(making, o);
    const r = await this.deps.model("narrator", this.deps.frame ? this.deps.frame(part) : [{ role: "user", content: part }], { signal: this.input.signal });
    this.usage = addUsage(this.usage, r.usage);
    making.ms.render += this.now() - started;
    if (r.reasoning) this.reasoning(`Narrator, passage ${this.streamed.length + 1}: ${r.reasoning}`);
    const asked = asksIn(r.text);
    if (asked && o.asks) return { kind: "ask", questions: asked };
    // Asks where it may not ask render nothing, which the check sends back like any empty draft.
    const text = asked ? "" : r.text.trim();
    making.drafts.push({ text, verdict: { faithful: null, notes: "" }, ...(r.reasoning ? { reasoning: r.reasoning } : {}) });
    return { kind: "passage", text };
  }

  /** The GM's check of the latest draft (§1.3, §5.2), kept on it: its verdict, what to change, and its line for the chip. */
  private async check(making: Making, draft: string, n: number): Promise<Verdict> {
    const kept = making.drafts.at(-1);
    const verdict = await this.verdict(making, draft, n);
    if (kept) kept.verdict = verdict;
    return verdict;
  }

  private async verdict(making: Making, draft: string, n: number): Promise<Verdict> {
    if (draft === "") {
      this.reasoning(`Passage ${n} came back empty: it goes back to the narrator.`);
      return { faithful: false, notes: "The narrator wrote no passage: render the moment from what the beats hold.", departs: "The narrator wrote no passage for these beats." };
    }
    this.deps.sink.progress(`The GM is checking passage ${n}`);
    const started = this.now();
    try {
      // The room the next try asks for: the role's own at first; once an answer is cut off at it, more (`roomAgain`), within what the model takes (the port holds it to a limit its provider states).
      let room: number | undefined;
      for (let attempt = 1; ; attempt++) {
        if (this.input.signal.aborted) throw new Stopped();
        const r = await this.deps.model("check", this.checkMessages(making, draft), { json: true, ...(room !== undefined ? { maxTokens: room } : {}), signal: this.input.signal });
        this.usage = addUsage(this.usage, r.usage);
        const read = verdictOf(readAnswer("check", r).answer);
        const thought = r.reasoning ? `\n${r.reasoning.trim()}` : "";
        if (read) {
          this.reasoning(read.faithful ? `GM's check of passage ${n}: faithful.${thought}` : `GM's check of passage ${n}: not faithful.\n${read.notes}${thought}`);
          return { ...read, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
        }
        if (attempt >= CHECK_TRIES) {
          this.reasoning(`GM's check of passage ${n} couldn't be read; the passage streams unchecked, with a chip.`);
          return { faithful: null, notes: `The GM's check couldn't be read: ${r.text.trim().slice(0, 400)}`, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
        }
        const more = cutShort(r.finish) && r.capped === undefined && r.room !== undefined ? roomAgain(r.room) : null;
        if (more !== null) {
          room = more;
          this.reasoning(`GM's check of passage ${n} was cut off at its answer room of ${(r.room ?? 0).toLocaleString("en-US")} tokens; asking again with room for ${more.toLocaleString("en-US")}.`);
        }
      }
    } catch (error) {
      if (this.input.signal.aborted || error instanceof Stopped) throw error;
      const why = error instanceof Error ? error.message : String(error);
      this.reasoning(`GM's check of passage ${n} failed (${why}); the passage streams unchecked, with a chip.`);
      return { faithful: null, notes: `The GM's check failed: ${why}` };
    } finally {
      making.ms.check += this.now() - started;
    }
  }

  /** The check's call: its rules, then the passage, every beat of its moment whole, where the player character was, and whom he knows. */
  private checkMessages(making: Making, draft: string): PortMessage[] {
    const pov = this.povName;
    const beat = (b: RenderBeat, how: string): string => `- [${b.beat.id}] ${b.beat.act} by ${b.beat.actors.map((id) => `${nameOf(this.input.state, id)} [${id}]`).join(", ") || "no one"} (${decidedBy(b.beat)}). What happened: ${b.what.trim()}\n  What there was to sense: ${b.surface.trim()}${words(b, "  ")}\n  ${how}`;
    const beats = [
      ...making.sorted.seen.map((s) =>
        beat(s.b, s.kind === "context" ? `${pov}'s own, which the player's message already tells: it need not be told again, but nothing may contradict it.` : s.kind === "whole" ? `It reached ${pov} whole, by ${s.via.channel}.` : s.kind === "heard" ? `It reached ${pov} by hearing alone: the passage may show only what could be heard of it, never what there was to see. What reached them: ${s.pov}` : `It reached ${pov} only in part, by ${s.via.channel}. What reached them: ${s.pov}`),
      ),
      ...making.sorted.unseen.map((u) => beat(u.b, u.partial ? `It reached ${pov} only in part, and what reached them wasn't written: the passage must not show it.` : `It didn't reach ${pov}: the passage must not show it.`)),
    ];
    const knows = this.input.knows?.filter((id) => id !== this.input.pov).map((id) => nameOf(this.input.state, id));
    const data = [
      section("The passage", draft),
      section("The beats of its moment", beats.join("\n")),
      section(`Where ${pov} was`, stagingLine(making.moment.staging)),
      knows !== undefined ? section(`Whom ${pov} knows by name`, knows.length > 0 ? knows.join(", ") : "No one here.") : "",
      // What the player asked of this telling (§3.9): texture he asked for is the narrator's to give him, never a departure; facts still come only from the beats.
      section("What the player asked this telling to change", this.input.direction?.trim() ? `${this.input.direction.trim()}\nThe texture he asked for (phrasing, rhythm, colour, tone, what the passage dwells on) is allowed and is no departure from the beats; an act, a word, an outcome or a detail anyone could later notice still has to be in them.` : undefined),
    ]
      .filter((p) => p !== "")
      .join("\n\n");
    return [
      { role: "system", content: renderPrompt(NARRATION_TEXT.check, this.input.texts, this.vars) },
      { role: "user", content: data },
    ];
  }

  // ---------------------------------------------------------------- the outcome

  private outcome(): NarrationOutcome {
    const blobs: Blobs = {};
    const events: PackEvent[] = this.streamed.map(({ outcome, making }) => {
      const drafts: PassageDraft[] = making.drafts.map((d) => ({
        text: putText(blobs, d.text === "" ? "(nothing)" : d.text),
        faithful: d.verdict.faithful,
        ...(d.verdict.notes.trim() !== "" ? { notes: putText(blobs, d.verdict.notes) } : {}),
        ...(d.reasoning ? { reasoning: putText(blobs, d.reasoning) } : {}),
        ...(d.verdict.reasoning ? { checkReasoning: putText(blobs, d.verdict.reasoning) } : {}),
      }));
      const passage: Passage = {
        moment: outcome.mark,
        index: outcome.index,
        beats: outcome.beats,
        pov: this.input.pov,
        text: putText(blobs, outcome.text),
        through: this.deps.throughOf(outcome.mark),
        drafts,
        ...(making.asked.length > 0 ? { asked: making.asked.map((a) => ({ question: putText(blobs, a.questions.join("\n")), beats: a.beats })) } : {}),
        ...(outcome.departs !== undefined ? { departs: outcome.departs } : {}),
        ...(making.quiet ? { quiet: true as const } : {}),
      };
      return passageEvent(passage);
    });
    // Stopped, the record keeps nothing past the last streamed moment, and the unrendered ones lie past it.
    if (this.unrendered.length > 0 && this.failure !== undefined && !this.stopped && !this.input.signal.aborted) {
      const moments: UnrenderedMoment[] = this.unrendered.map((m) => ({ moment: m.mark, beats: m.beats.map((b) => b.beat.id), through: this.deps.throughOf(m.mark) }));
      events.push(unrenderedEvent({ moments, pov: this.input.pov, why: departsLine(this.failure) }));
    }
    return {
      told: this.streamed.map((s) => s.outcome),
      events,
      blobs,
      streamedThrough: this.streamed.at(-1)?.outcome.mark ?? null,
      stopped: this.stopped,
      ...(this.failure !== undefined ? { failed: this.failure } : {}),
      usage: this.usage,
    };
  }
}

/** The narrator bound to a turn (`NarrationFactory`). */
export const narrationOf: NarrationFactory = (deps, input) => new Narration(deps, input);

// ------------------------------------------------------------------ Re-narrate (P3)

/**
 * A Re-narrate's moments (P3, §4.8): its source's beats, copied with its plan exactly as they were
 * (ids, texts, exposure), regrouped as the source's prose grouped them and its unrendered moments
 * held them (`story.unrendered`), each with the player character's staging and his own point of view
 * where his reach was partial; the turn's own beats after the last of those, as a source rendered
 * only in part left them, grouped by their order in the scene (a source with neither: all of its
 * beats). `throughOf` gives each moment's `through`, where a Stop's cut falls in the copied plan:
 * the source's own, else the plan up to the next moment's first beat. Moments the player character
 * didn't perceive aren't rendered; their beats stay wherever the cut keeps them. `text` reads a blob
 * (null: missing, read as empty).
 */
export async function renarrateMoments(source: { pre: readonly LedgerEvent[]; read: readonly LedgerEvent[] }, pov: EntityId, text: (hash: string) => Promise<string | null>): Promise<{ moments: Moment[]; throughOf: (mark: number) => number }> {
  const beats = new Map<string, { beat: Beat; at: number }>();
  const stagings: { staging: Staging; at: number }[] = [];
  source.pre.forEach((e, at) => {
    if (e.type === STORY_BEAT) {
      const beat = beatOf(e.data);
      if (beat && !beats.has(beat.id)) beats.set(beat.id, { beat, at });
    } else if (e.type === STORY_STAGING) {
      const staging = stagingOf(e.data);
      if (staging) stagings.push({ staging, at });
    }
  });
  const groups: { mark: number; ids: string[]; through?: number }[] = [...passagesIn(source.read), ...unrenderedIn(source.read)]
    .map((m) => ({ mark: m.moment, ids: m.beats.filter((id) => beats.has(id)), ...(m.through !== undefined ? { through: m.through } : {}) }))
    .sort((a, b) => a.mark - b.mark);
  // The turn's own beats past every moment held, by their order in the scene: walk-ons' settled drafts were never its moments.
  const covered = new Set(groups.flatMap((g) => g.ids));
  const after = Math.max(-1, ...[...covered].map((id) => beats.get(id)?.at ?? -1));
  let mark = Math.max(-1, ...groups.map((g) => g.mark));
  let order: number | null = null;
  const trailing: { mark: number; ids: string[] }[] = [];
  for (const { beat } of [...beats.values()].filter((b) => b.at > after && !covered.has(b.beat.id) && "turn" in b.beat.by).sort((a, b) => a.at - b.at)) {
    if (beat.order !== order || trailing.length === 0) trailing.push({ mark: ++mark, ids: [] });
    trailing.at(-1)?.ids.push(beat.id);
    order = beat.order;
  }
  groups.push(...trailing);
  const read = async (hash: string): Promise<string> => (await text(hash)) ?? "";
  const moments: Moment[] = [];
  const through = new Map<number, number>();
  for (const g of groups) {
    const placed = g.ids.map((id) => beats.get(id)).filter((b): b is { beat: Beat; at: number } => b !== undefined).sort((a, b) => a.at - b.at);
    const first = placed[0];
    const last = placed.at(-1);
    if (!first || !last) continue;
    const out: RenderBeat[] = [];
    for (const { beat } of placed) {
      const reach = beat.exposure.find((x) => x.who === pov);
      out.push({
        beat,
        what: await read(beat.what),
        surface: await read(beat.surface),
        ...(beat.quotes ? { quotes: await read(beat.quotes) } : {}),
        ...(reach?.pov && (reach.reach === "partial" || heardAlone(beat, pov)) ? { pov: await read(reach.pov) } : {}),
      });
    }
    const mine = stagings.filter((s) => s.staging.who === pov && s.at < first.at).at(-1)?.staging;
    moments.push({
      beats: out,
      mark: g.mark,
      ...(mine ? { staging: { staging: mine, where: await read(mine.where), doing: await read(mine.doing), ...(mine.occluded ? { occluded: await read(mine.occluded) } : {}) } } : {}),
    });
    // Without its own: the plan through the next moment's first beat after this one's last.
    const ids = new Set(g.ids);
    const next = Math.min(...[...beats.values()].filter((b) => b.at > last.at && !ids.has(b.beat.id)).map((b) => b.at));
    through.set(g.mark, g.through ?? (Number.isFinite(next) ? next : source.pre.length));
  }
  return { moments, throughOf: (mark) => through.get(mark) ?? source.pre.length };
}
