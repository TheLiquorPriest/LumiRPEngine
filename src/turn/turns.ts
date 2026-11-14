// A turn, from a tagged request to a saved message (plan §10.1, §10.7, §10.8, §6.3). Code gathers what
// the Author is shown and records what it did; it decides nothing about how a turn is run.
//
// Intake: the chat in RPE's store (a fork of a chat RPE knows shares its tree), the generations that
// ended unheard tied to what they saved, the chat's path compared with the turn tree, the turns that
// left the path cancelled, the wait for the previous turn's run (a swipe or regenerate does not wait for
// the attempt it replaces: it stops it), the new turn (a continue goes on with the turn its message is
// tied to), the chat's session, and the briefing's blocks that exist so far: the turn's facts, the lore
// map, and what has happened since the last turn.
//
// The run: RPH answers, its reply streamed to Lumiverse as it is written; the run may go on after the
// reply is released, and Lumiverse stopping before the release stops it. A run that ends with no reply
// ends the reply with a plain line from a file.
//
// Commit: when Lumiverse says the generation ended, the saved message is read back and the turn tied
// to it by the hash of what was stored; an impersonation, which saves no message, leaves an attempt with
// no state. If the event was missed, the next intake ties it the same way.

import { loadGuidance, type Guidance, type LinesPart, type TemplatePart } from "rp-harness";
import type { Clock, ContextBlock, Harness, Log, ReplyError, ReplySink, Scope, SinceItem, TurnRequest, Usage } from "rp-harness/contract";
import { forkOf, reconcile, type ChatChange, type ChatChanges } from "../adapter/lumiverse/events";
import type { TaggedTurn, TurnPlayer } from "../adapter/lumiverse/provider";
import type { LumiverseReads, LvStep } from "../adapter/lumiverse/reads";
import type { ReplyStream } from "../adapter/lumiverse/stream";
import type { LiveHub } from "../app";
import { calendarOf, formatClock } from "../engine/calendar";
import { type Lore, loreMapFields } from "../lore";
import type { PathReport, ShownMessage, Store, TurnRow } from "../store";
import type { TreeChats, TreeFiles } from "../tree";
import type { Writes } from "./kv";
import type { TurnPrompts } from "./prompt";
import { leftOutOf, maxTokensOf, prefillOf, promptOf, samplingOf, summarizedOf } from "./request";
import type { Run, RunRecord, Runs } from "./runs";
import { type TurnSettings, turnSettings } from "./settings";

/** The prompt parts the turn lane lays its texts out by (each under `.prompts/`). */
export const PARTS = { progress: "progress", notices: "notices", errors: "reply-errors", turnFacts: "turn-facts", loreMap: "lore-map" } as const;

/** The names the briefing's template places the host's blocks by. */
export const BLOCKS = { turnFacts: "turn-facts", loreMap: "lore-map" } as const;

/** A session's id while a chat has none yet: the settings are read before the turn that opens one, and no file of theirs is a session's. */
const NO_SESSION = "none";

export interface TurnLaneDeps {
  store: Store;
  writes: Writes;
  files: TreeFiles;
  chats: TreeChats;
  prompts: TurnPrompts;
  lore: Lore;
  runs: Runs;
  live: LiveHub;
  /** The adapter's reads of Lumiverse; null before it is mounted, or when RPE is not set up for a Lumiverse. */
  reads(): LumiverseReads | null;
  /** The harness, once built. */
  harness(): Harness;
  /** The Lumiverse user this RPE plays for; null before one is set. */
  owner(): string | null;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  log: Log;
}

/** RPH's usage as an OpenAI-compatible one, for the reply's end. */
function usageOut(u: Usage): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  return { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output };
}

function lines(part: TemplatePart | LinesPart | undefined): LinesPart | undefined {
  return part?.format === "lines" ? part : undefined;
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Ended = Extract<ChatChange, { kind: "generation-ended" }>;

export class TurnLane implements TurnPlayer, ChatChanges {
  readonly #d: TurnLaneDeps;
  /** Each chat's standby line, from its progress part at its last intake. */
  readonly #standby = new Map<string, string>();
  /** The standby line of a chat RPE has not met yet: the shipped and global levels' progress part. */
  #standbyDefault: string | null = null;
  /** Ends heard for a generation whose turn is not made yet. */
  readonly #early = new Map<string, Ended>();
  /** Changes being recorded, so the next intake can wait for them. */
  readonly #recording = new Set<Promise<unknown>>();

  constructor(deps: TurnLaneDeps) {
    this.#d = deps;
  }

  // ---------------------------------------------------------------- the adapter's side

  standbyLine(turn: TaggedTurn): string {
    return this.#standby.get(`${turn.tag.user}\u0000${turn.tag.chat}`) ?? this.#standbyDefault ?? "";
  }

  /** Reads the standby line a chat RPE has not met yet is given: the progress part of the shipped and global levels. */
  async preload(): Promise<void> {
    const user = this.#d.owner();
    if (user === null) return;
    const part = lines(await loadGuidance(this.#d.files, { user, chat: crypto.randomUUID(), session: NO_SESSION }).part(PARTS.progress));
    this.#standbyDefault = part?.line("started") ?? null;
  }

  async play(tagged: TaggedTurn, out: ReplyStream, signal: AbortSignal): Promise<void> {
    const received = this.#d.clock.now();
    const reads = this.#d.reads();
    if (reads === null) throw new Error("RPE is not set up for a Lumiverse, so it cannot play this chat.");
    const { tag } = tagged;
    const { user, chat } = tag;
    const store = this.#d.store.user(user);

    // The chat, its folders, and what Lumiverse saved for generations whose end was not heard.
    await this.#chat(reads, user, chat);
    await this.#catchUp(reads, user, chat);

    // The chat's path compared with the turn tree (plan §6.3). The message a new reply is being written to is the turn at hand, not yet a reply.
    const steps = await reads.path(chat);
    if (steps === null) throw new Error(`Lumiverse has no chat ${chat} for this RPE's user.`);
    const writing = tag.kind === "new" ? tag.target.message : null;
    const shown: ShownMessage[] = steps.filter((s) => s.id !== writing).map((s) => ({ id: s.id, user: s.role !== "assistant", hash: s.shown.hash, date: s.shown.date }));
    const report = await this.#d.writes.run(() => store.sync(chat, shown), "comparing the chat's path with its turns");
    const replaced = tag.kind === "swipe" || tag.kind === "regenerate" ? tag.target.message : null;
    await this.#left(user, chat, report, replaced);

    // The chat's settings and texts, read before the turn is made: its session is the chat's open one.
    const open = store.sessions(chat).findLast((s) => s.closedBy === null) ?? null;
    const base: Scope = { user, chat, session: open?.id ?? NO_SESSION };
    const guidance = loadGuidance(this.#d.files, base);
    const [settings, progress, notices, errors] = await Promise.all([turnSettings(this.#d.files, base, this.#d.log), guidance.part(PARTS.progress), guidance.part(PARTS.notices), guidance.part(PARTS.errors)]);
    const started = lines(progress)?.line("started");
    if (started !== undefined) this.#standby.set(`${user}\u0000${chat}`, started);

    // The previous turn's run: waited for up to its limit, then stopped where it stands.
    await this.#previous(user, chat, settings, lines(progress), out);

    // The turn: a new attempt, or for a continue the turn its message is tied to (plan §10.10).
    const continued = tag.kind === "continue" && tag.target.message !== null ? this.#tiedTo(user, chat, tag.target.message) : null;
    const begun = continued ?? (await this.#d.writes.run(() => store.beginTurn({ chat, kind: tag.kind, generation: tag.generation, target: replaced }), "beginning a turn"));
    const session = open ?? (await this.#d.writes.run(() => store.openSession({ chat, scene: "", turn: begun.id }), "opening a session"));
    const scope = { user, chat, session: session.id, turn: begun.id };

    const { messages, left } = promptOf(tagged.prompt);
    if (left > 0) this.#d.log.warn("Parts of the prompt RPH cannot carry were left out.", { turn: begun.id, parts: left });
    const prefill = prefillOf(tagged, messages);
    // What Lumiverse puts in front of the reply when it saves it: a continue's earlier text, else the prefill.
    const front = tag.kind === "continue" && tag.target.message !== null ? ((await reads.messagesById(chat, [tag.target.message]))[0]?.text ?? "") : (prefill ?? "");

    const over = Promise.withResolvers<void>();
    const run: Run = {
      user,
      turn: begun.id,
      chat,
      session: session.id,
      generation: tag.generation,
      target: tag.kind === "impersonate" ? null : tag.target.message,
      kind: tag.kind,
      status: "running",
      received,
      started: null,
      firstWord: null,
      released: null,
      ended: null,
      usage: null,
      reply: "",
      progress: [],
      error: null,
      base: front,
      saved: null,
      stop: new AbortController(),
      over: over.promise,
    };
    await this.#d.writes.run((db) => {
      this.#d.prompts.keep(db, { user, turn: begun.id, chat, layout: tagged.layout, lore: tag.lore, cut: tagged.cut, summarized: summarizedOf(tag, steps), at: received });
      this.#d.runs.put(db, run);
    }, "keeping the turn's request");
    this.#d.runs.hold(run);

    // The briefing's blocks, and what has happened since the last turn.
    const [briefing, since] = await Promise.all([this.#briefing(reads, guidance, scope, tagged, steps), this.#since(user, chat, report, steps, lines(notices))]);
    const sampling = samplingOf(tagged.parameters);
    const maxTokens = maxTokensOf(tagged.parameters);
    const request: TurnRequest = {
      scope,
      ...(begun.parent !== null ? { parent: begun.parent } : {}),
      kind: tag.kind,
      ...(tag.speaker.name !== null ? { speaker: tag.speaker.name } : {}),
      lead: settings.lead,
      prompt: messages,
      leftOut: leftOutOf(tagged.cut.keep, steps.map((s) => s.id)),
      briefing,
      carry: settings.carry,
      since,
      ...(prefill !== undefined ? { prefill } : {}),
      ...(sampling !== undefined ? { presetSampling: sampling } : {}),
      ...(maxTokens !== undefined ? { replyMaxTokens: maxTokens } : {}),
    };
    await this.#run(run, request, out, signal, lines(errors), over);
    const early = this.#early.get(tag.generation);
    if (early !== undefined) {
      this.#early.delete(tag.generation);
      this.changed(early);
    }
  }

  // ---------------------------------------------------------------- Lumiverse's changes

  changed(change: ChatChange): void {
    const user = this.#d.owner();
    if (user === null) return;
    let work: Promise<unknown> | null = null;
    if (change.kind === "generation-ended") work = this.#ended(user, change);
    else if (change.kind === "message-deleted") work = this.#deleted(user, change.chat, change.message);
    // An edit, a swipe flipped and a fork are found by the next turn's comparison of the path.
    if (work === null) return;
    const done = work.catch((error: unknown) => this.#d.log.error("A change Lumiverse told of could not be recorded; the chat's next turn finds it again.", { chat: change.chat, change: change.kind, error: words(error) }));
    this.#recording.add(done);
    void done.finally(() => this.#recording.delete(done));
  }

  /** What was missed while the event socket was closed is found again at each chat's next intake, by the comparison and by `#catchUp`. */
  reopened(): void {}

  /** Resolves once every change heard so far is recorded. */
  async settled(): Promise<void> {
    while (this.#recording.size > 0) await Promise.allSettled([...this.#recording]);
  }

  /** Stops a turn's run where it stands; false when it is not going on. */
  stop(user: string, turn: string): boolean {
    const run = this.#d.runs.running(user, turn);
    if (run === undefined) return false;
    run.stop.abort(new Error("The player stopped the turn."));
    return true;
  }

  // ---------------------------------------------------------------- intake

  /** The chat in the store: made on the spot the first time, sharing its source's tree when it is a fork of a chat RPE knows; and its folders. */
  async #chat(reads: LumiverseReads, user: string, chat: string): Promise<void> {
    const store = this.#d.store.user(user);
    const placed = this.#d.chats.folders(user, chat) !== null;
    if (store.chat(chat) !== null && placed) return;
    const lv = await reads.chat(chat);
    if (store.chat(chat) === null) {
      const fork = await forkOf(reads, chat);
      const at = lv?.metadata.branch_at_message;
      await this.#d.writes.run(() => {
        if (store.chat(chat) !== null) return;
        if (fork !== null && store.chat(fork.from) !== null) store.branchChat({ id: chat, from: fork.from, map: fork.ids, at: typeof at === "string" ? at : null });
        else store.createChat({ id: chat });
      }, "making a chat");
    }
    if (!placed) {
      const character = lv === null || lv.character === null ? null : await reads.character(lv.character);
      await this.#d.chats.place(user, chat, { character: character === null ? null : { id: character.id, name: character.name }, chat: { name: lv?.name ?? "" } });
    }
  }

  /** The chat's generations that ended without their end being heard: tied now to what Lumiverse saved, as their end would have tied them. */
  async #catchUp(reads: LumiverseReads, user: string, chat: string): Promise<void> {
    await this.settled();
    const store = this.#d.store.user(user);
    const awaiting = this.#d.runs.ended(user, chat).filter((r) => r.generation !== null && store.turn(r.turn)?.status === "open");
    if (awaiting.length === 0) return;
    const found = await reconcile(reads, { chat, messages: [], awaiting: awaiting.map((r) => ({ generation: r.generation ?? "", message: r.target })) });
    for (const change of found) if (change.kind === "generation-ended") await this.#ended(user, change);
  }

  /** Turns that left the path since it was last compared: their work is cancelled (plan §10.9 "This work belongs to its turn"). The attempt a swipe or regenerate replaces is among them. */
  async #left(user: string, chat: string, report: PathReport, replaced: string | null): Promise<void> {
    const gone = new Set<string>();
    for (const g of report.gone) if (g.turn !== null) gone.add(g.turn);
    if (report.swiped !== null && report.swiped.from !== null) gone.add(report.swiped.from);
    for (const f of report.flipped) if (f.from !== null) gone.add(f.from);
    if (replaced !== null) for (const r of this.#d.runs.ofChat(user, chat)) if (r.target === replaced) gone.add(r.turn);
    await Promise.all([...gone].map((turn) => this.#cancel(user, chat, turn)));
  }

  /** A turn off the path: its run, if it goes on, stopped, and RPH told. */
  async #cancel(user: string, chat: string, turn: string): Promise<void> {
    const run = this.#d.runs.running(user, turn);
    run?.stop.abort(new Error("The turn left the chat's path."));
    await this.#d.harness().turnLeft({ user, chat, session: run?.session ?? this.#d.runs.record(user, turn)?.session ?? NO_SESSION, turn });
    await run?.over;
  }

  /** The previous turn's run: a new turn waits for it up to the limit, with a progress line, then stops it where it stands. */
  async #previous(user: string, chat: string, settings: TurnSettings, progress: LinesPart | undefined, out: ReplyStream): Promise<void> {
    const before = this.#d.runs.ofChat(user, chat);
    if (before.length === 0) return;
    const line = progress?.line("waiting_previous");
    if (line !== undefined) out.progress(line);
    const late = Promise.withResolvers<void>();
    const timer = this.#d.clock.setTimeout(late.resolve, settings.previousRunMs);
    try {
      await Promise.race([Promise.all(before.map((r) => r.over)), late.promise]);
    } finally {
      this.#d.clock.clearTimeout(timer);
    }
    for (const r of before) r.stop.abort(new Error("The next turn began, and this run had used the time it was given."));
    await Promise.all(before.map((r) => r.over));
  }

  /** The turn tied to a message, for a continue of it; null when none is (a continue of a reply made without RPE begins a turn of its own). */
  #tiedTo(user: string, chat: string, message: string): TurnRow | null {
    const store = this.#d.store.user(user);
    const entry = store.path(chat).find((e) => e.message === message);
    return entry === undefined || entry.turn === null ? null : store.turn(entry.turn);
  }

  /** The briefing's blocks that exist so far (plan §10.2 block 4): the turn's facts and the lore map, each laid out by its part. */
  async #briefing(reads: LumiverseReads, guidance: Guidance, scope: Scope & { turn: string }, tagged: TaggedTurn, steps: readonly LvStep[]): Promise<ContextBlock[]> {
    const { tag } = tagged;
    const blocks: ContextBlock[] = [];
    const [factsPart, mapPart] = await Promise.all([guidance.part(PARTS.turnFacts), guidance.part(PARTS.loreMap)]);
    if (factsPart?.format === "template") {
      const facts = factsPart.render({ kind: tag.kind, ...(tag.speaker.name !== null ? { speaker: tag.speaker.name } : {}), ...(tag.target.message !== null ? { message: tag.target.message } : {}), ...this.#storyTime(scope.user, scope.chat) }).text;
      if (facts.trim() !== "") blocks.push({ name: BLOCKS.turnFacts, text: facts.trimEnd() });
    }
    // The world's own keys are looked for in the chat's visible messages, as Lumiverse scans them by default: every message, keys case-blind.
    const world = this.#d.store.user(scope.user).chat(scope.chat)?.revision ?? null;
    const texts = world === null ? [] : (await reads.messages(scope.chat, { from: 0, to: steps.length })).filter((m) => !m.hidden).map((m) => m.text);
    const map = await this.#d.lore.loreMap({ user: scope.user, chat: scope.chat, turn: scope.turn, messages: texts });
    if (mapPart?.format === "template") {
      const laid = mapPart.render({ ...loreMapFields(map) }).text;
      if (laid.trim() !== "") blocks.push({ name: BLOCKS.loreMap, text: laid.trimEnd() });
    }
    return blocks;
  }

  /** The story's time where the chat's state keeps a clock, as the world's calendar writes it. */
  #storyTime(user: string, chat: string): { story_time?: string } {
    const store = this.#d.store.user(user);
    if ((store.chat(chat)?.revision ?? null) === null) return {};
    const state = store.headState(chat).state.world;
    const world = this.#d.store.env.worlds(state.revision);
    return world === undefined ? {} : { story_time: formatClock(calendarOf(world), state.clock) };
  }

  /** What has happened since the last turn, as far as the path comparison reports it, each in the words of the notices part. */
  async #since(user: string, chat: string, report: PathReport, steps: readonly LvStep[], notices: LinesPart | undefined): Promise<SinceItem[]> {
    const items: SinceItem[] = [];
    const place = new Map(steps.map((s, i) => [s.id, i]));
    const add = (kind: SinceItem["kind"], line: string | undefined, extra: Partial<SinceItem> = {}): void => {
      if (line !== undefined && line.trim() !== "") items.push({ kind, text: line, ...extra });
    };
    const gone = report.gone.filter((g) => g.turn !== null);
    if (gone.length > 0) add("delete", notices?.line("deleted", { count: gone.length }));
    const dropped = report.notApplied.map((n) => `${n.op}: ${n.reason}`).join("; ");
    for (const f of report.flipped) add("restacked", notices?.line("swipe_flipped", { message: f.message, dropped }), f.to !== null ? { turn: f.to } : {});
    for (const e of report.edited) add("edit", notices?.line("edited", { message: e.message }), { turn: e.turn });
    for (const u of report.unplayed) {
      const from = place.get(u.from);
      const to = place.get(u.to);
      if (from === undefined || to === undefined) continue;
      add("unplayed", notices?.line("unplayed", { range: from === to ? `${from + 1}` : `${from + 1}-${to + 1}` }), { range: { from, to: to + 1 } });
    }
    // The last turn's reply, where Lumiverse saved it otherwise than it was released (plan §10.8).
    const store = this.#d.store.user(user);
    for (const r of this.#d.runs.ofChatKept(user, chat, 1)) {
      const message = store.turn(r.turn)?.message ?? null;
      if (r.saved !== null && message !== null) add("saved-differs", notices?.line("saved_differs", { message, released: r.base + r.reply, saved: r.saved }), { turn: r.turn });
    }
    return items;
  }

  // ---------------------------------------------------------------- the run

  async #run(run: Run, request: TurnRequest, out: ReplyStream, signal: AbortSignal, errors: LinesPart | undefined, over: PromiseWithResolvers<void>): Promise<void> {
    const { live, clock } = this.#d;
    const replied = Promise.withResolvers<void>();
    // Lumiverse stopping before the reply is out stops the turn; after it, the run goes on (plan §10.9).
    const onAbort = (): void => {
      if (run.released === null) run.stop.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    const sink: ReplySink = {
      progress: (line) => {
        out.progress(line);
        live.publish(run.chat, { kind: "reply", data: { run: run.turn, line: run.progress.length, progress: line } });
        run.progress.push(line);
      },
      content: (delta) => {
        if (run.firstWord === null) run.firstWord = clock.now();
        out.content(delta);
        live.publish(run.chat, { kind: "reply", data: { run: run.turn, from: run.reply.length, text: delta } });
        run.reply += delta;
      },
      finish: (usage) => {
        run.released ??= clock.now();
        out.finish({ reason: "stop", usage: usageOut(usage) });
        replied.resolve();
      },
      error: (e: ReplyError) => {
        run.error = e;
        out.error(this.#errorWords(e, errors));
        replied.resolve();
      },
    };
    run.started = clock.now();
    void this.#d.harness()
      .answer(request, sink, run.stop.signal)
      .then(
        (outcome) => {
          run.status = outcome.status;
          run.usage = outcome.usage;
          if (outcome.error !== undefined) run.error = outcome.error;
        },
        (error: unknown) => {
          run.status = "failed";
          const failed: ReplyError = { code: "failed", detail: words(error) };
          if (run.released === null && run.error === null) sink.error(failed);
          run.error = failed;
        },
      )
      .finally(async () => {
        signal.removeEventListener("abort", onAbort);
        run.ended ??= clock.now();
        replied.resolve();
        try {
          await this.#d.runs.save(run, "keeping a turn's run");
          const usage = run.usage;
          const timings = { received: run.received, started: run.started, firstWord: run.firstWord, released: run.released, ended: run.ended };
          await this.#d.writes.run(() => this.#d.store.user(run.user).updateTurn(run.turn, { timings, ...(usage !== null ? { tokensIn: usage.input, tokensOut: usage.output } : {}) }), "keeping a turn's timings");
        } catch (error) {
          this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(error) });
        } finally {
          over.resolve();
        }
      });
    await replied.promise;
  }

  /** The line the player is shown when a turn ends with no reply, in the words of the reply-errors part. */
  #errorWords(e: ReplyError, errors: LinesPart | undefined): string {
    const fields = { ...(e.detail !== undefined ? { detail: e.detail } : {}), ...(e.limit !== undefined ? { limit: e.limit.limit, per: e.limit.per, max: e.limit.max, value: e.limit.value } : {}) };
    return errors?.line(e.code, fields) ?? "";
  }

  // ---------------------------------------------------------------- commit

  /** A generation ended (plan §10.8): its turn tied to what Lumiverse saved, or, saving nothing, left an attempt with no state. */
  async #ended(user: string, change: Ended): Promise<void> {
    const run: RunRecord | null = this.#d.runs.byGeneration(user, change.generation);
    if (run === null) {
      this.#early.set(change.generation, change);
      return;
    }
    const store = this.#d.store.user(user);
    const turn = store.turn(run.turn);
    if (turn === null || turn.status === "dropped") return;
    const stopped = change.stopped === true;
    const message = run.kind === "impersonate" ? null : (change.message ?? (stopped ? run.target : null));
    const reads = this.#d.reads();
    const saved = message === null || reads === null ? undefined : (await reads.messagesById(change.chat, [message]))[0];
    if (saved === undefined || (stopped && saved.text === run.base)) {
      if (turn.status === "open") await this.#d.writes.run(() => store.dropTurn(run.turn), "dropping a turn that saved nothing");
      return;
    }
    const differs = saved.text === run.base + run.reply ? null : saved.text;
    const live = this.#d.runs.running(user, run.turn);
    if (live !== undefined) live.saved = differs;
    await this.#d.writes.run((db) => {
      store.tieTurn(run.turn, { message: saved.id, hash: saved.shown.hash, date: saved.shown.date, status: stopped ? "cut" : "done" });
      this.#d.runs.put(db, { ...(live ?? run), saved: differs });
    }, "tying a turn to its saved message");
  }

  /** A message was deleted: the work of every turn tied to it is cancelled now; the next turn's comparison takes them off the path. */
  async #deleted(user: string, chat: string, message: string): Promise<void> {
    const store = this.#d.store.user(user);
    const tied = store.chat(chat) === null ? [] : store.swipes(chat, message);
    const running = this.#d.runs.ofChat(user, chat).filter((r) => r.target === message);
    const turns = new Set([...tied.map((t) => t.id), ...running.map((r) => r.turn)]);
    await Promise.all([...turns].map((turn) => this.#cancel(user, chat, turn)));
  }
}
