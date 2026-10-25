// Character minds on demand (DESIGN §24.9, `lre.minds`): a GM asks the minds of some characters, or
// of everyone Live and Near, between turns. The run thinks at the chat's head exactly as a turn's
// minds would: the head's state, the latest reply's end (and a player's message still waiting for a
// reply), recall by presence from the chat's messages, and lore read as each of them with what is
// pinned first. It answers the request at once and goes on in the background, at most a few calls at
// a time, pushing its progress to the session that started it; its minds are recorded as one GM edit
// (a `fix` entry marked as the GM's, with the GM edit chip's Undo). Nothing reaches a player surface:
// the edit's lines word nothing for a player, and the progress is GM data shown behind the gate.

import type { ChatId, EntityId, UserId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { Fidelity, MindMoment, MindsRunEntry, MindsRunView } from "../shared/minds";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { own } from "../engine/pack-kit";
import { fixChip } from "./view";
import { fidelityOf } from "../packs/minds/core/fidelity";
import { latestTexts } from "./gm";
import { toChain } from "./ledger-io";
import { mindsStepConfig, runMinds } from "./minds";
import { TimeoutFired, within } from "../shared/timeouts";
import type { Runtime } from "./runtime";

/** Calls a run makes at once: a long list of minds never floods the connection. */
const RUN_CONCURRENCY = 4;
/** What a mind is told when the player hasn't said anything since the latest reply. */
const BETWEEN_TURNS = "Nothing new has been said since; take stock of where things stand now.";

export class RunError extends Error {
  constructor(
    readonly code: "bad_request" | "conflict" | "not_world_chat" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "RunError";
  }
}

interface Run {
  view: MindsRunView;
  stop: AbortController;
  cancelled: boolean;
}

export class MindsRuns {
  /** Each chat's latest run, by `user \0 chat`. */
  private readonly runs = new Map<string, Run>();
  private seq = 0;

  constructor(private readonly rt: Runtime) {}

  /** The chat's latest run, or null. */
  status(chatId: ChatId, userId: UserId): MindsRunView | null {
    return this.runs.get(`${userId}\u0000${chatId}`)?.view ?? null;
  }

  /** Stops a running run: what is still thinking is dropped and nothing is recorded. */
  cancel(chatId: ChatId, userId: UserId, runId: string): MindsRunView | null {
    const run = this.runs.get(`${userId}\u0000${chatId}`);
    if (!run || run.view.runId !== runId || run.view.status !== "running") return run?.view ?? null;
    run.cancelled = true;
    run.stop.abort();
    return run.view;
  }

  /**
   * Starts a run for `who` (absent: everyone Live and Near at the head, as GM → Minds shows them) and
   * answers with it at once; the minds think in the background. One run at a time per chat.
   */
  async start(chatId: ChatId, userId: UserId, session: string | undefined, who: readonly EntityId[] | undefined): Promise<MindsRunView> {
    const key = `${userId}\u0000${chatId}`;
    if (this.runs.get(key)?.view.status === "running") throw new RunError("conflict", "Minds are already running in this chat; wait for them, or cancel the run.");
    const core = await this.rt.ledger.core(chatId, userId);
    if (!core || !(await this.rt.runOf(chatId, userId))) throw new RunError("not_world_chat", "this chat is not attached to a world");
    const settings = await this.rt.settings.get(userId);
    const config = mindsStepConfig(settings.modelUse, "mind");
    if (!config) throw new RunError("bad_request", "The mind step is switched off in Settings → Steps: switch it on to run minds.");
    const messages = await this.rt.host.chats.messages(chatId, userId);
    const observed = toChain(messages);
    const render = core.renderState(observed);
    if (!render) throw new RunError("unavailable", "the chat's world revision is not loaded");
    const { world, state } = render;
    const ctx = this.rt.registry.context(world, state);
    const scores = new Map(fidelityOf(ctx, latestTexts(observed)).map((s) => [s.entity, s]));
    const picked = who === undefined ? [...scores.values()].filter((s) => s.level === "live" || s.level === "near").map((s) => s.entity) : [...new Set(who)];
    if (picked.length === 0) throw new RunError("bad_request", who === undefined ? "No one is Live or Near now." : "Pick someone to run.");
    for (const id of picked) if (!scores.has(id)) throw new RunError("bad_request", `${own(state.entities, id)?.name ?? id} can't have a mind now: they aren't a person acting in the world, or they are the player character.`);
    const levels: Record<EntityId, Fidelity> = Object.fromEntries(picked.map((id) => [id, scores.get(id)?.level ?? "near"]));
    // The moment is the head: a player's message still waiting for its reply, as the turn will read
    // it, else how the latest reply ended, with nothing new said since.
    const last = messages.at(-1);
    const text = (m: (typeof messages)[number] | undefined): string => (m ? (m.swipes[m.swipeId] ?? m.content) : "");
    const waiting = last?.isUser === true;
    const reply = waiting ? messages.slice(0, -1).findLast((m) => !m.isUser) : messages.findLast((m) => !m.isUser);
    const moment: MindMoment = { kind: "turn", at: state.clock, reason: waiting ? "" : BETWEEN_TURNS, user: waiting ? text(last) : "", reply: text(reply) };
    const view: MindsRunView = { runId: `mr${Date.now().toString(36)}${(++this.seq).toString(36)}`, status: "running", startedAt: Date.now(), entries: picked.map((id) => ({ entity: id, name: own(state.entities, id)?.name ?? id, level: levels[id] ?? "near", status: "waiting" })), message: null, pending: false, undo: null };
    const run: Run = { view, stop: new AbortController(), cancelled: false };
    this.runs.set(key, run);
    if (this.runs.size > 256) this.runs.delete(this.runs.keys().next().value ?? "");
    const push = (): void => this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.minds.update", chatId, run: structuredClone(run.view) }, userId, session);
    const progress = (entry: MindsRunEntry): void => {
      run.view.entries = run.view.entries.map((e) => (e.entity === entry.entity ? { ...entry } : e));
      push();
    };
    // The run's own limit is the user's (Settings → Timeouts → Minds run on demand); "none" runs until it ends.
    const signal = within(run.stop.signal, "mindsRunMs", settings.timeouts.mindsRunMs);
    void (async () => {
      try {
        const ran = await runMinds(this.rt.minds, { chatId, userId, world, state, who: picked, moment, levels, reasons: Object.fromEntries(picked.map((id) => [id, "gm"])), signal, messages, concurrency: RUN_CONCURRENCY, progress });
        for (const entry of ran.report ?? []) progress(run.cancelled && entry.status !== "recorded" ? { ...entry, status: "cancelled", reason: "you cancelled the run" } : entry);
        if (run.cancelled) return this.end(run, "cancelled", "Cancelled: nothing was recorded.");
        if (ran.events.length === 0) return this.end(run, "failed", signal.reason instanceof TimeoutFired ? "The run reached its time limit before any mind came back, so nothing was recorded: raise Minds run on demand in Settings → Timeouts." : "No mind came back, so nothing was recorded; each one says why.");
        await this.record(chatId, userId, run, ran.events);
      } catch (error) {
        this.rt.host.log("error", `[LumiRPEngine] minds run in chat ${chatId}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`, userId);
        this.end(run, "failed", `The run failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        push();
      }
    })();
    return structuredClone(view);
  }

  private end(run: Run, status: MindsRunView["status"], message: string | null): void {
    run.view.status = status;
    run.view.message = message;
  }

  /** Writes the minds as one GM edit on the head; the entry it wrote names the GM edit chip that undoes it. */
  private async record(chatId: ChatId, userId: UserId, run: Run, events: LedgerEvent[]): Promise<void> {
    const written = await this.rt.ledger.write(chatId, userId, { kind: "post", id: `${run.view.runId}w`, target: "head", entry: { kind: "fix", gm: true, events } });
    if (written.reason === "paused") return this.end(run, "failed", "An earlier message was edited: Keep or Discard it first, then run the minds again.");
    if (!written.applied && !written.pending) return this.end(run, "failed", `The minds weren't recorded: ${written.reason ?? "the edit was refused"}.`);
    this.rt.push.changed(chatId, userId);
    run.view.pending = written.pending;
    if (written.posted) run.view.undo = fixChip(written.posted.messageId, written.posted.swipeId, written.posted.seq);
    const recorded = run.view.entries.filter((e) => e.status === "recorded").length;
    this.end(run, "done", written.pending ? `${recorded} recorded; it lands when the reply being written finishes.` : null);
  }
}
