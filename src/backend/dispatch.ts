// Protocol dispatch (ARCHITECTURE §4): every frontend request gets exactly one `lre.result` or
// `lre.error` with its `reqId`. Ledger writes go through the queue and are held inside open
// windows (P2: `pending: true`).

import type { Band, ChatId, DomainId, RevisionId, UserId, WorldId } from "../shared/ids";
import { CLAIM_MODE_LABEL } from "../shared/claims";
import { DOMAINS, pathSafe } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { EventRef, HeldWrite, LedgerEvent, MarkerBody } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { RulesetDef, WorldDoc } from "../shared/world";
import { WORLD_FORMAT } from "../shared/world";
import type { StudioOffer } from "../shared/studio-bridge";
import { isWorldDoc, migrateWorld, previewSheet } from "../engine/authoring";
import { parseEditOps, resolveEdit } from "../engine/edits";
import { sheetRulesetProblem } from "../engine/ruleset";
import { formulaFunctions } from "../engine/scope";
import { neutralizeMacros } from "../shared/macros";
import type { DraftChanged, ErrorCode, FrontendToBackend, LintIssue, MarkerPreview, ResultBodies, StudioOfferView, UpgradePreview, WorldChatInfo } from "../shared/protocol";
import { AGENT_API, PROTOCOL_VERSION } from "../shared/protocol";
import { EXTRACTION_TYPES, helperCallOf } from "../shared/settings";
import { formatMs, TimeoutFired, timerMs } from "../shared/timeouts";
import type { TimelapseTarget } from "../shared/ledger";
import { TIME_CONTROLS, validMarkerBody } from "../engine/events";
import { materializeIfNeeded } from "../engine/materialize";
import { optionalService } from "../engine/pack-kit";
import { rulesetFloor } from "../engine/registry-impl";
import { applyTimeAdvance, clockFix, IN_FIGHT, parseOverrides, parseTarget } from "../engine/time";
import { timelapseIntent } from "../engine/turn";
import { definitionsLag, planUpgrade } from "../engine/upgrade";
import { actionOdds } from "../engine/resolve";
import { Working } from "../engine/working";
import type { ChainMessage } from "../engine/ledger/chain";
import { activeRecord } from "../engine/ledger/path";
import type { StoredChip } from "./chips";
import { toChain } from "./ledger-io";
import { JobError, type JobRunner } from "./jobs";
import { bookDrift, saveFromChat } from "./lore";
import { pinBooks, pinEntries, pinViews } from "./lore-pins";
import { MindsRuns, RunError } from "./minds-run";
import { ACTIVE_CONNECTION, declineNote, readRun, Runtime } from "./runtime";
import { recordOutcome, undoModeChange, type ModeChange } from "./settings-store";
import { applyProposals, TIME_ADVANCE_CAP } from "./turn-model";
import { upgradePreview } from "./upgrade-preview";
import { recentLines, TIMELAPSE_ACTION } from "./view";
import { buildGmView } from "./gm";
import { type DraftNotice, macroReview, newChatRun, WORLD_COLLECTIONS, WorldError } from "./worlds";

export class RequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly lint?: LintIssue[],
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const PACK_DOMAIN: Record<string, DomainId> = { economy: "money" };

/** Whose level a band-scoped preview line names (the band labels, said as people). */
const BAND_WHO: Record<Band, string> = { principal: "leads", supporting: "supporting characters", background: "background characters" };

function isRequest(raw: unknown): raw is FrontendToBackend {
  return isRecord(raw) && raw.lre === PROTOCOL_VERSION && typeof raw.type === "string" && typeof raw.reqId === "string";
}

/** Notes that a request changed a world's working copy, to the state it has now. */
type DraftNoted = DraftNotice;

/** Outside clients remembered by session: a CLI makes a session per connection, so old ones go. */
const CLIENTS_CAP = 256;

export class Dispatcher {
  private writeSeq = 0;
  /** Stored chip actions in flight per (user, chat): one at a time, so a double tap acts once. */
  private readonly chipLocks = new Map<string, Promise<void>>();
  /** Sessions that said `lre.hello` with `client` (DESIGN §23), by `user \0 session`: their commits are `agent`'s. */
  private readonly clients = new Map<string, { name: string; version: string }>();
  /** GM → Minds' runs on demand (DESIGN §24.9). */
  private readonly minds: MindsRuns;

  constructor(
    private readonly rt: Runtime,
    private readonly jobs: JobRunner,
  ) {
    this.minds = new MindsRuns(rt);
  }

  start(): void {
    this.rt.host.frontend.onMessage((message, userId, session) => {
      void this.handle(message, userId, session);
    });
  }

  async handle(raw: unknown, userId: UserId, session?: string): Promise<void> {
    // Ids that name storage paths must be plain (a `..` chat or world id would reach other files).
    const unsafe = isRecord(raw) ? ["chatId", "worldId", "revision"].find((k) => raw[k] !== undefined && raw[k] !== null && !pathSafe(raw[k])) : undefined;
    if (!isRequest(raw)) return;
    if (unsafe) {
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: raw.reqId, code: "bad_request", message: `invalid ${unsafe}` }, userId, session);
      return;
    }
    // The drafts the request changed, announced to every session of the user once it is answered,
    // so the session that changed one has its result (and the draft's version) first (DESIGN §23).
    const drafts = new Map<WorldId, DraftChanged>();
    const announce = (): void => {
      for (const push of drafts.values()) this.rt.host.frontend.send(push, userId);
      drafts.clear();
    };
    const reply = <K extends keyof ResultBodies>(request: K, body: ResultBodies[K]): void => {
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: raw.reqId, request, body } as never, userId, session);
      announce();
    };
    const noted: DraftNoted = (worldId, draft) => {
      drafts.set(worldId, { lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: draft.version, stored: draft.stored, base: draft.base });
    };
    const chatId = isRecord(raw) && typeof raw.chatId === "string" ? raw.chatId : null;
    const what = `${raw.type}${isRecord(raw) && typeof raw.op === "string" ? ` ${raw.op}` : ""}`;
    const t0 = performance.now();
    try {
      // The Studio bridge serves each user from their first request on (DESIGN §15).
      await this.rt.studio.serve(userId);
      await this.route(raw, userId, session, reply, noted);
    } catch (error) {
      const e = error instanceof RequestError ? error : error instanceof WorldError ? new RequestError(error.code, error.message, error.lint) : error instanceof JobError ? new RequestError(error.code, error.message) : new RequestError("internal", error instanceof Error ? error.message : String(error));
      if (e.code === "internal") this.rt.host.log("error", `[LumiRPEngine] ${raw.type}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`, userId);
      // A request the engine couldn't answer goes to the chat's diagnostics; a refused one is the player's to read.
      if (chatId && (e.code === "internal" || e.code === "unavailable")) this.rt.diag.error({ chatId, userId, turn: null }, what, error);
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: raw.reqId, code: e.code, message: e.message, ...(e.lint ? { lint: e.lint } : {}) }, userId, session);
      // A request that failed after it changed a draft (a commit whose book sync failed) still says so.
      announce();
    } finally {
      const ms = performance.now() - t0;
      // Any view or edit over a second is kept, so a slow tab says which request was slow.
      this.rt.diag.slow(userId, chatId, what, ms);
      // One slower than the user's Engine requests limit had the tab stop waiting before it answered: say so.
      const limit = timerMs(this.rt.settings.known(userId)?.timeouts.requestMs ?? "none");
      if (limit !== null && ms > limit) this.rt.diag.timeout({ chatId, userId, turn: null }, "request", what, new TimeoutFired("requestMs", limit), `${what} answered after ${formatMs(ms)}, so the tab had shown it as unanswered`);
    }
  }

  private nextId(): string {
    return `w${Date.now().toString(36)}${(++this.writeSeq).toString(36)}`;
  }

  private async requireWorldChat(chatId: ChatId, userId: UserId): Promise<void> {
    if (!(await this.rt.runOf(chatId, userId)) || !(await this.rt.ledger.core(chatId, userId))) throw new RequestError("not_world_chat", "this chat is not attached to a world");
  }

  private async write(chatId: ChatId, userId: UserId, w: HeldWrite): Promise<{ applied: boolean; pending: boolean }> {
    await this.requireWorldChat(chatId, userId);
    const result = await this.rt.ledger.write(chatId, userId, w);
    if (result.reason === "paused") throw new RequestError("paused", "an earlier message was edited: Keep or Discard first");
    if (!result.applied && !result.pending) throw new RequestError("bad_request", result.reason ?? "the write was refused");
    this.rt.push.changed(chatId, userId);
    return { applied: result.applied, pending: result.pending };
  }

  private async head(chatId: ChatId, userId: UserId): Promise<{ state: Working["state"]; world: Working["world"] }> {
    const core = await this.rt.ledger.core(chatId, userId);
    if (!core) throw new RequestError("not_world_chat", "this chat is not attached to a world");
    const render = core.renderState(toChain(await this.rt.host.chats.messages(chatId, userId)));
    if (!render) throw new RequestError("unavailable", "the chat's world revision is not loaded");
    return render;
  }

  /** The chat run's seed, which samples on-demand detail; `head` opened the run's core and bridge. */
  private runSeedOf(chatId: ChatId): string {
    const runSeed = this.rt.bridgeOf(chatId)?.runSeed;
    if (runSeed === undefined) throw new RequestError("not_world_chat", "this chat is not attached to a world");
    return runSeed;
  }

  private async route(r: FrontendToBackend, userId: UserId, session: string | undefined, reply: <K extends keyof ResultBodies>(request: K, body: ResultBodies[K]) => void, noted: DraftNoted): Promise<void> {
    switch (r.type) {
      case "lre.hello":
      case "lre.state.resync": {
        if (r.type === "lre.hello") {
          reply("lre.hello", { accepted: true, agentApi: AGENT_API, requestMs: (await this.rt.settings.get(userId)).timeouts.requestMs, canStop: this.rt.host.capabilities.cancel });
          this.meet(userId, session, r.client);
        } else reply("lre.state.resync", { accepted: true });
        // The frontend says which Loom preset is active: the preset prompts assemble with (DESIGN §6.8).
        if (r.type === "lre.hello" && r.presetId !== undefined && this.rt.presets.useLoom(userId, typeof r.presetId === "string" ? r.presetId : null)) this.rt.ledger.inputsChanged(userId);
        // Which chat this page shows, and whether on screen: who starts a prepared reply (DESIGN §5.1). An outside client is no page.
        if (session !== undefined && !(r.type === "lre.hello" && r.client !== undefined)) this.rt.ledger.page(session, userId, r.chatId, r.chatId !== null && r.viewing !== false);
        if (r.chatId) {
          const run = await this.rt.runOf(r.chatId, userId);
          if (run) {
            await this.rt.ledger.open(r.chatId, userId);
            this.rt.jsonHiding.seen(r.chatId, run.worldId, userId);
          }
          await this.rt.push.snapshot(r.chatId, userId, session);
          // A frontend that opens mid-turn (or after a failed one) shows the activity line at once.
          this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.activity", chatId: r.chatId, activity: this.rt.diag.activityOf(r.chatId) }, userId, session);
          // A reply the engine prepared while this page slept, or that another page held, starts here now.
          this.rt.ledger.askAgain(r.chatId, userId, session);
        }
        return;
      }
      case "lre.page": {
        reply("lre.page", { accepted: true });
        if (session === undefined) return;
        this.rt.ledger.page(session, userId, r.chatId, r.chatId !== null && r.viewing);
        if (r.chatId && r.viewing) this.rt.ledger.askAgain(r.chatId, userId, session);
        return;
      }
      case "lre.restart":
        reply("lre.restart", { start: this.rt.ledger.claimRestart(r.chatId, userId, session, r.turn) });
        return;
      case "lre.action": {
        await this.requireWorldChat(r.chatId, userId);
        const bridge = this.rt.bridgeOf(r.chatId);
        // Words typed with the action describe the player's approach (the judge rates them); without
        // any, the message is only the action's label.
        const said = r.text?.trim() ?? "";
        let text = said;
        if (r.action === TIMELAPSE_ACTION) {
          const target = parseTarget(r.params.target);
          if (!target) throw new RequestError("bad_request", "a timelapse needs a target");
          const intent = timelapseIntent(target, stringRecord(parseOverrides(r.params.overrides)));
          text ||= `(Timelapse: ${neutralizeMacros(targetLabel(target))})`;
          bridge?.setIntent(text, intent);
        } else {
          const { world } = await this.head(r.chatId, userId);
          const action = (hasOwn(world.actions, r.action) ? world.actions[r.action] : undefined) ?? this.rt.registry.actions.get(r.action);
          if (!action) throw new RequestError("not_found", `unknown action ${r.action}`);
          text ||= `(${neutralizeMacros(action.label)})`;
          bridge?.setIntent(text, { action: r.action, params: r.params, probabilities: { [r.action]: 1 } });
        }
        const messageId = await this.rt.host.chats.appendUserMessage(r.chatId, text, { [LEDGER_NAMESPACE]: { action: r.action, params: r.params, source: r.source, ...(said !== "" ? { described: true } : {}) } }, true, userId);
        reply("lre.action", { messageId });
        return;
      }
      case "lre.chip": {
        reply("lre.chip", await this.chip(r.chatId, userId, r.chip, r.choice, r.payload));
        return;
      }
      case "lre.view.open": {
        await this.requireWorldChat(r.chatId, userId);
        if (r.panel === "core.context") {
          // Opening the inspector runs the preset lint on a dry run (decision #5c); delivery is each
          // turn's own (`onActivated`). The lint waits on a dry run of the whole prompt, so it runs
          // after the reply, and its warnings come with the next state push.
          reply("lre.view.open", { materialized: false, pending: false });
          this.rt.checkPresetLater(r.chatId, userId);
          return;
        }
        const run = await this.rt.runOf(r.chatId, userId);
        const { state, world } = await this.head(r.chatId, userId);
        const pack = r.panel.split(".")[0] ?? "";
        const domain = PACK_DOMAIN[pack] ?? DOMAINS.find((d) => d === pack);
        const entity = r.entity ?? world.pov;
        if (!domain || !run || !state.entities[entity]) {
          reply("lre.view.open", { materialized: false, pending: false });
          return;
        }
        const w = new Working(this.rt.registry, world, state);
        const event = materializeIfNeeded(this.rt.registry, w, entity, domain, run.runSeed);
        if (!event) {
          reply("lre.view.open", { materialized: false, pending: false });
          return;
        }
        const result = await this.write(r.chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "materialize", events: [event] } });
        reply("lre.view.open", { materialized: true, pending: result.pending });
        return;
      }
      case "lre.fix": {
        const { state, world } = await this.head(r.chatId, userId);
        let events: LedgerEvent[];
        if ("time" in r) {
          // The clock's ✎ (DESIGN §9.2, §12): later runs the time between as an applied advance, earlier sets the clock back (L48).
          if (typeof r.time !== "string") throw new RequestError("bad_request", "a time is a date and time of day, YYYY-MM-DD HH:MM");
          const fixed = clockFix(this.rt.registry, world, state, r.time, this.runSeedOf(r.chatId));
          if ("code" in fixed) throw new RequestError("validation", fixed.reason);
          events = fixed.events;
        } else {
          const edit = resolveEdit(this.rt.registry, world, state, [{ op: "set", entity: r.entity, field: r.field, value: r.value }], { gm: false, runSeed: this.runSeedOf(r.chatId) });
          if ("rejection" in edit) throw new RequestError("validation", edit.rejection.reason);
          events = edit.events;
        }
        const result = events.length > 0 ? await this.write(r.chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "fix", events } }) : { pending: false };
        reply("lre.fix", { pending: result.pending });
        return;
      }
      case "lre.edit": {
        // The GM editor (DESIGN §7): every operation checked, all or none, one `fix` entry; locked fields too.
        const ops = parseEditOps(r.ops);
        if (!ops) throw new RequestError("bad_request", "not a list of edits");
        const { state, world } = await this.head(r.chatId, userId);
        const edit = resolveEdit(this.rt.registry, world, state, ops, { gm: true, runSeed: this.runSeedOf(r.chatId) });
        if ("rejection" in edit) throw new RequestError("validation", edit.rejection.gm ?? edit.rejection.reason);
        const result = edit.events.length > 0 ? await this.write(r.chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "fix", events: edit.events } }) : { pending: false };
        reply("lre.edit", { pending: result.pending });
        return;
      }
      case "lre.gm": {
        // Asked for when the GM view opens: everything, secrets included, never in a state push.
        await this.requireWorldChat(r.chatId, userId);
        const core = await this.rt.ledger.core(r.chatId, userId);
        const view = core ? buildGmView(core, toChain(await this.rt.host.chats.messages(r.chatId, userId)), this.rt.registry, (await this.rt.settings.get(userId)).minds) : null;
        if (!view) throw new RequestError("unavailable", "the chat's world revision is not loaded");
        reply("lre.gm", view);
        return;
      }
      case "lre.diag": {
        // GM-level, like `lre.gm`: read only when the Diagnostics page asks, never pushed.
        if (r.op === "clear") await this.rt.diag.clear(r.chatId, userId);
        if (r.op === "dismiss") this.rt.diag.dismiss(r.chatId, userId);
        reply("lre.diag", { records: r.op === "get" ? await this.rt.diag.records(r.chatId, userId) : [], activity: this.rt.diag.activityOf(r.chatId) });
        return;
      }
      case "lre.marker": {
        const body = validMarkerBody(r.kind === "resolve" ? { kind: "resolve", domain: r.domain, scope: r.scope, to: r.to } : r.kind === "time" ? { kind: "time", control: r.control, scope: r.scope, to: r.to } : r.kind === "claims" ? { kind: "claims", to: r.to } : r.kind === "adjudicate" ? { kind: "adjudicate", to: r.to } : { kind: "migrate", to: r.to, merge: r.merge });
        // A retired control (an earlier build's starting markers) stays readable in stored ledgers, but nothing sets it now.
        if (!body || (body.kind === "time" && !TIME_CONTROLS.some((c) => c === body.control))) throw new RequestError("bad_request", "not a valid settings change");
        if (body.kind === "migrate") {
          // An Upgrade target must be a revision of this chat's world.
          const run = await this.rt.runOf(r.chatId, userId);
          if (!run || !(await this.rt.worlds.hasRevision(run.worldId, body.to, userId))) throw new RequestError("not_found", "unknown world revision");
        }
        if (r.preview) {
          reply("lre.marker", { pending: false, preview: await this.preview(r.chatId, userId, body) });
          return;
        }
        const result = await this.write(r.chatId, userId, { kind: "marker", id: this.nextId(), target: "head", body });
        reply("lre.marker", { pending: result.pending });
        return;
      }
      case "lre.keep": {
        const w: HeldWrite =
          r.choice === "discard"
            ? { kind: "discard", id: this.nextId(), after: r.messageId }
            : r.choice === "keep"
              ? { kind: "keep", id: this.nextId(), messageId: r.messageId, parentPath: "", convert: [] }
              : { kind: "keep", id: this.nextId(), messageId: r.messageId, parentPath: r.parentPath, convert: r.refs };
        const result = await this.write(r.chatId, userId, w);
        reply("lre.keep", { pending: result.pending });
        return;
      }
      case "lre.settings.get":
      case "lre.settings.set": {
        if (r.type === "lre.settings.set") {
          const hid = (await this.rt.settings.get(userId)).hideJsonBlocks;
          const hides = (await this.rt.settings.set(userId, r.patch)).hideJsonBlocks;
          if (hides !== hid) await this.rt.hidingChanged(userId, hides);
        }
        const settings = await this.rt.settings.get(userId);
        const routed = helperCallOf(settings.modelUse.steps.extract, settings.helper).connectionId;
        // The connection whose learning Settings shows: extraction's (its own, else the helper model's), else the user's default.
        const active = routed ? null : await this.rt.host.connections.active(userId).catch(() => null);
        const id = routed ?? active?.id ?? ACTIVE_CONNECTION;
        reply(r.type, await this.rt.settings.result(userId, { id, name: active?.name ?? (id === ACTIVE_CONNECTION ? "Active connection" : id) }));
        return;
      }
      case "lre.settings.caveats": {
        reply("lre.settings.caveats", { caveats: await this.rt.presetCaveats(userId) });
        return;
      }
      case "lre.editor": {
        reply("lre.editor", await this.rt.worlds.edit(r, userId, noted));
        return;
      }
      case "lre.world": {
        reply("lre.world", await this.world(r, userId, session, noted));
        return;
      }
      case "lre.ui": {
        await this.rt.host.frontend.closeDrawer(userId);
        reply("lre.ui", { done: true });
        return;
      }
      case "lre.map": {
        await this.requireWorldChat(r.chatId, userId);
        if (r.op === "walk") {
          // Walk here, judged as the step will be on the real ground: under fog the page's grid
          // lacks the walls it hasn't seen, so it can't tell the way or its minutes.
          if (!Number.isInteger(r.x) || !Number.isInteger(r.y)) throw new RequestError("bad_request", "a cell is two whole numbers");
          const { state, world } = await this.head(r.chatId, userId);
          const odds = actionOdds(this.rt.registry, world, state, { action: "step", params: { x: r.x, y: r.y } });
          reply("lre.map", { walk: odds.available ? { minutes: odds.duration } : { minutes: 0, disabled: odds.failed && odds.failed.code !== "requirement" ? odds.failed.reason : "No way there from here." } });
          return;
        }
        // How the map shows this chat: presentation, kept beside the chat, never in its ledger.
        if (r.display !== "knowledge" && r.display !== "fog") throw new RequestError("bad_request", "the map shows what you know (knowledge) or fog");
        await this.rt.chatPrefs.setMapDisplay(r.chatId, userId, r.display);
        this.rt.push.changed(r.chatId, userId);
        reply("lre.map", { display: r.display });
        return;
      }
      case "lre.job": {
        if (r.op === "start") reply("lre.job", { jobId: await this.jobs.start(r.kind, r.worldId, r.input, userId, session) });
        else if (r.op === "list") reply("lre.job", { jobs: await this.jobs.list(r.worldId, userId) });
        else if (r.op === "dismiss") {
          await this.jobs.dismiss(r.jobId, userId);
          reply("lre.job", { jobId: r.jobId });
        } else {
          await this.jobs.cancel(r.jobId, userId);
          reply("lre.job", { jobId: r.jobId });
        }
        return;
      }
      case "lre.preset": {
        if (r.op === "active") this.rt.presets.useLoom(userId, typeof r.presetId === "string" ? r.presetId : null);
        const card = await this.rt.presetCard(userId, r.op === "add");
        if (!card) throw new RequestError("not_found", "There is no active preset to add the blocks to.");
        reply("lre.preset", { card });
        return;
      }
      case "lre.lore": {
        if (r.op === "save") {
          const run = await this.rt.runOf(r.chatId, userId);
          if (!run) throw new RequestError("not_world_chat", "this chat is not attached to a world");
          const saved = await saveFromChat(this.rt.host, this.rt.worlds, r.chatId, run.worldId, userId, (await this.rt.settings.get(userId)).hideJsonBlocks, typeof r.text === "string" ? r.text : undefined, noted);
          reply("lre.lore", saved);
          return;
        }
        if (r.op === "books") {
          reply("lre.lore", { books: await pinBooks(this.rt.host, r.chatId ?? null, userId) });
          return;
        }
        if (r.op === "entries") {
          if (typeof r.bookId !== "string" || r.bookId === "") throw new RequestError("bad_request", "name the book");
          reply("lre.lore", { entries: await pinEntries(this.rt.host, r.bookId, userId) });
          return;
        }
        if (r.op === "pins") {
          // The world's draft (Build), or the revision the chat plays (GM view).
          if (typeof r.worldId === "string") {
            reply("lre.lore", { pins: await pinViews(this.rt.host, await this.rt.worlds.working(r.worldId, userId), userId) });
            return;
          }
          if (typeof r.chatId !== "string") throw new RequestError("bad_request", "name the world or the chat");
          reply("lre.lore", { pins: await pinViews(this.rt.host, (await this.head(r.chatId, userId)).world, userId) });
          return;
        }
        const world = await this.rt.worlds.working(r.worldId, userId);
        if (r.id !== undefined && !(safeKey(r.id) && hasOwn(world.lore, r.id))) throw new RequestError("not_found", "no such lore entry");
        reply("lre.lore", { drift: await bookDrift(this.rt.host, world, userId, r.id) });
        return;
      }
      case "lre.minds": {
        // GM → Minds (DESIGN §24.9): sent only from behind the GM gate; its progress goes to this session.
        try {
          const run = r.op === "run" ? await this.minds.start(r.chatId, userId, session, Array.isArray(r.who) ? r.who.filter((id) => typeof id === "string") : undefined) : r.op === "cancel" ? this.minds.cancel(r.chatId, userId, r.runId) : this.minds.status(r.chatId, userId);
          reply("lre.minds", { run });
        } catch (error) {
          if (error instanceof RunError) throw new RequestError(error.code, error.message);
          throw error;
        }
        return;
      }
      case "lre.studio": {
        reply("lre.studio", await this.studio(r, userId, noted));
        return;
      }
    }
  }

  /** LumiRPEngine Studio's offer (DESIGN §15): reviewed on `offer`, installed only on the player's `install`. */
  private async studio(r: Extract<FrontendToBackend, { type: "lre.studio" }>, userId: UserId, noted: DraftNoted): Promise<ResultBodies["lre.studio"]> {
    if (r.op === "offer") {
      const read = await this.rt.studio.offer(userId);
      return read.offer ? { offer: (await this.reviewOffer(read.offer, read.hash, userId)).view } : { offer: null, message: read.reason };
    }
    // One install at a time per user, so an offer is checked and marked installed before another install reads it.
    return this.rt.studio.installing(userId, async () => {
      const read = await this.rt.studio.offer(userId);
      if (!read.offer) throw new RequestError("not_found", read.reason);
      const offer = read.offer;
      const { view, world } = await this.reviewOffer(offer, read.hash, userId);
      // The player confirmed what they reviewed: anything the Studio offered or changed since is reviewed first.
      if (offer.offerId !== r.offerId || read.hash !== r.hash) throw new RequestError("conflict", "LumiRPEngine Studio offers something else now; review it again.");
      if (view.installed) throw new RequestError("conflict", "This offer is already installed.");
      if (view.blocked !== null || world === null) throw new RequestError(view.errors > 0 ? "validation" : "conflict", view.blocked ?? `not an ${WORLD_FORMAT} document`, view.errors > 0 ? view.lint : undefined);
      if (view.headMoved && r.acceptMovedHead !== true) throw new RequestError("conflict", "The world changed in Build since LumiRPEngine Studio took it; review the offer again and confirm to install anyway.");
      const store = this.rt.worlds;
      const done = offer.mode === "revision" && offer.worldId !== undefined ? await store.commitRevision(offer.worldId, world, userId, noted) : await store.create(world.name, world, userId, "studio").then((created) => ({ ...created, lint: macroReview(created.world) }));
      // Marked before anything else can fail: the world is written, so the offer is installed.
      await this.rt.studio.markInstalled(userId, { offerId: offer.offerId, worldId: done.world.id, revision: done.revision });
      await this.syncBook(done.world.id, userId);
      return { installed: { offerId: offer.offerId, mode: offer.mode, worldId: done.world.id, name: done.world.name, revision: done.revision, attachChatId: offer.attachChatId ?? null }, lint: done.lint };
    });
  }

  /** An offer as Build reviews it: the document as this engine reads it, its lint and macros, and what keeps it from installing. */
  private async reviewOffer(offer: StudioOffer, hash: string, userId: UserId): Promise<{ view: StudioOfferView; world: WorldDoc | null }> {
    const installed = await this.rt.studio.installedAs(userId, offer.offerId);
    const view: StudioOfferView = {
      offerId: offer.offerId,
      mode: offer.mode,
      name: isRecord(offer.doc) && typeof offer.doc.name === "string" ? offer.doc.name : "(unnamed)",
      createdAt: offer.createdAt,
      target: null,
      counts: {},
      lint: [],
      errors: 0,
      macros: [],
      attachChatId: offer.attachChatId ?? null,
      blocked: null,
      installed: installed ? { worldId: installed.worldId, revision: installed.revision } : null,
      headMoved: null,
      hash,
    };
    if (!isWorldDoc(offer.doc)) return { view: { ...view, blocked: `It isn't an ${WORLD_FORMAT} document.` }, world: null };
    let world: WorldDoc;
    let lint: LintIssue[];
    try {
      world = migrateWorld(structuredClone(offer.doc));
      lint = this.rt.worlds.lint(world);
    } catch (error) {
      return { view: { ...view, blocked: `This engine can't read it: ${error instanceof Error ? error.message : String(error)}` }, world: null };
    }
    const rank = { error: 0, warning: 1, info: 2 };
    view.lint = [...lint].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 50);
    view.errors = lint.filter((i) => i.severity === "error").length;
    view.macros = macroReview(world);
    for (const [collection, items] of Object.entries(world)) {
      const count = hasOwn(WORLD_COLLECTIONS, collection) && isRecord(items) ? Object.keys(items).length : 0;
      if (count > 0) view.counts[collection] = count;
    }
    if (view.errors > 0) view.blocked = `It has ${view.errors} error${view.errors === 1 ? "" : "s"}; fix ${view.errors === 1 ? "it" : "them"} in LumiRPEngine Studio first.`;
    if (offer.mode === "revision" && offer.worldId !== undefined) {
      const index = pathSafe(offer.worldId) ? await this.rt.worlds.index(offer.worldId, userId) : null;
      view.target = { worldId: offer.worldId, name: index?.name ?? null };
      if (!index) view.blocked ??= "The world it's a revision of isn't one of your worlds.";
      else if (await this.rt.worlds.hasDraft(offer.worldId, userId)) view.blocked ??= `Build has unsaved changes to “${index.name}”: commit or discard them first.`;
      if (index && offer.baseRevision !== index.head) view.headMoved = { base: offer.baseRevision ?? null, head: index.head };
    }
    return { view, world };
  }

  private async world(r: Extract<FrontendToBackend, { type: "lre.world" }>, userId: UserId, session: string | undefined, noted: DraftNoted): Promise<ResultBodies["lre.world"]> {
    const store = this.rt.worlds;
    switch (r.op) {
      case "list":
        return { worlds: await store.list(userId) };
      case "get":
        return { ...(await store.get(r.worldId, userId, r.revision)), history: await store.history(r.worldId, userId), packKinds: Object.fromEntries(this.rt.registry.kinds), packRelations: Object.fromEntries(this.rt.registry.relations), functions: formulaFunctions(this.rt.registry) };
      case "create": {
        const template = r.template && hasOwn(this.rt.templates, r.template) ? this.rt.templates[r.template] : undefined;
        if (r.template && !template) throw new RequestError("not_found", `unknown template ${r.template}`);
        const created = await store.create(r.name, template ? template("", r.name) : null, userId);
        await this.syncBook(created.world.id, userId);
        return { world: created.world, revision: created.revision };
      }
      case "delete":
        await store.remove(r.worldId, userId);
        // Its chats are no longer world chats, so their JSON-hiding scripts go (DESIGN §6.7).
        await this.rt.jsonHiding.removeWorld(r.worldId, userId).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] world ${r.worldId}: its chats' JSON-hiding regex scripts weren't removed (${error instanceof Error ? error.message : String(error)})`, userId));
        return { worlds: await store.list(userId) };
      case "commit": {
        // A session that said hello as an outside client commits as `agent` (DESIGN §23).
        const committed = await store.commit(r.worldId, r.base, userId, { source: session !== undefined && this.clients.has(`${userId}\u0000${session}`) ? "agent" : "build", ...(r.note !== undefined ? { note: r.note } : {}), ...(r.version !== undefined ? { version: r.version } : {}) }, noted);
        await this.syncBook(r.worldId, userId);
        return committed;
      }
      case "import": {
        const imported = await store.importFile(r.file, userId);
        await this.syncBook(imported.world.id, userId);
        return imported;
      }
      case "export":
        return { file: await store.exportFile(r.worldId, userId, r.revision) };
      case "lint": {
        const { world } = await store.get(r.worldId, userId);
        return { lint: store.lint(world) };
      }
      case "attach": {
        const { world, revision } = await store.get(r.worldId, userId);
        const index = await store.index(r.worldId, userId);
        if (!index) throw new RequestError("not_found", `world ${r.worldId} not found`);
        // A chat keeps its run: attaching again never resets its journal under it.
        const existing = await this.rt.runOf(r.chatId, userId);
        if (existing && existing.worldId !== r.worldId) throw new RequestError("conflict", "This chat already plays another world. Start a new chat for this one.");
        if (existing) await this.rt.book.attach(r.chatId, await this.rt.book.ensure(world, index, userId), userId);
        else {
          await this.rt.host.chats.mergeChatMetadata(r.chatId, { [LEDGER_NAMESPACE]: JSON.parse(JSON.stringify(newChatRun(r.worldId, revision))) as JsonValue }, userId);
          const bookId = await this.rt.book.ensure(world, index, userId);
          await this.rt.book.attach(r.chatId, bookId, userId);
          this.rt.forgetChat(r.chatId);
          await this.rt.ledger.open(r.chatId, userId);
        }
        // The chat's JSON blocks are hidden from now on (DESIGN §6.7); without the permission the attach still stands.
        await this.rt.jsonHiding.ensure(r.chatId, r.worldId, userId).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${r.chatId}: the JSON regex scripts weren't written (${error instanceof Error ? error.message : String(error)})`, userId));
        await this.rt.push.snapshot(r.chatId, userId);
        return { revision: existing ? existing.revision : revision };
      }
      case "upgrade": {
        const before = await this.rt.runOf(r.chatId, userId);
        if (!before || !(await this.rt.worlds.hasRevision(before.worldId, r.to, userId))) throw new RequestError("not_found", "unknown world revision");
        // With picks, the revision's definition changes come into the chat as the owner chose (DESIGN §4.3 `migrate`).
        const body = validMarkerBody({ kind: "migrate", to: r.to, merge: r.merge });
        if (!body) throw new RequestError("bad_request", "not a valid Upgrade");
        const result = await this.write(r.chatId, userId, { kind: "marker", id: this.nextId(), target: "head", body });
        await this.syncBook(before.worldId, userId);
        // Mid-turn, the marker is held and lands when the turn ends (P2).
        return { revision: r.to, pending: result.pending };
      }
      case "sheet": {
        // The Sheet Designer's live preview: the draft with the unsaved ruleset, as a chat would start.
        // The ruleset is the frontend's, read here before the sheet is built from it.
        const problem = isRecord(r.ruleset) ? sheetRulesetProblem(r.ruleset) : null;
        if (problem) throw new RequestError("bad_request", problem);
        const draft = await store.working(r.worldId, userId);
        const world = { ...draft, ruleset: isRecord(r.ruleset) ? (r.ruleset as unknown as RulesetDef) : undefined };
        const entity = typeof r.entity === "string" && hasOwn(world.entities, r.entity) ? r.entity : world.pov;
        return { sheet: previewSheet(this.rt.registry, world, entity) };
      }
      case "templates":
        return { templates: this.rt.templateInfo.filter((t) => hasOwn(this.rt.templates, t.id)) };
      case "chats": {
        // The user's chats that play one of their worlds still there (one world's, or one chat), each at the revision it plays now.
        // Each one's ledger is opened to read that: a filter keeps the cost to the chats asked about.
        const worlds = new Map((await store.list(userId)).map((index) => [index.id, index]));
        if (r.worldId !== undefined && !worlds.has(r.worldId)) throw new RequestError("not_found", `world ${r.worldId} not found`);
        const chats: WorldChatInfo[] = [];
        for (const chat of await this.rt.host.chats.list(userId)) {
          if (r.chatId !== undefined && chat.id !== r.chatId) continue;
          const run = readRun(chat.metadata);
          const index = run && (r.worldId === undefined || run.worldId === r.worldId) ? worlds.get(run.worldId) : undefined;
          if (!run || !index) continue;
          const played = await this.rt.revisionInPlay(chat.id, userId, run);
          chats.push(played.revision === null ? { chatId: chat.id, name: chat.name, worldId: run.worldId, revision: null, behind: false, reason: played.reason } : { chatId: chat.id, name: chat.name, worldId: run.worldId, revision: played.revision, behind: played.revision !== index.head });
        }
        return { chats };
      }
    }
  }

  /**
   * A hello's `client` (DESIGN §23): an outside client names itself, so its session's commits are
   * `agent`'s from now on and the user's diagnostics say who connected. A hello without one is a
   * frontend's, so the session's commits are Build's.
   */
  private meet(userId: UserId, session: string | undefined, client: unknown): void {
    const key = `${userId}\u0000${session ?? ""}`;
    this.clients.delete(key);
    if (!isRecord(client) || typeof client.name !== "string" || typeof client.version !== "string") return;
    // Both go into a log line: control characters can't start another line, and each is bounded.
    const shown = (text: string): string => text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
    const named = { name: shown(client.name), version: shown(client.version) };
    if (session !== undefined) {
      this.clients.set(key, named);
      for (const oldest of this.clients.keys()) {
        if (this.clients.size <= CLIENTS_CAP) break;
        this.clients.delete(oldest);
      }
    }
    this.rt.host.log("info", `[LumiRPEngine] outside client connected: ${named.name} ${named.version}`, userId);
  }

  /** The world's engine-managed book follows its head revision: a slot entry per section, and no leftover lore copies (DESIGN §4.2). */
  private async syncBook(worldId: WorldId, userId: UserId): Promise<void> {
    const index = await this.rt.worlds.index(worldId, userId);
    if (!index) return;
    const { world } = await this.rt.worlds.get(worldId, userId);
    await this.rt.book.ensure(world, index, userId);
  }

  /** What a marker would change (DESIGN §9.2 demotion preview). Nothing is written. */
  private async preview(chatId: ChatId, userId: UserId, body: MarkerBody): Promise<MarkerPreview> {
    const { state, world } = await this.head(chatId, userId);
    const lines: MarkerPreview["lines"] = [];
    if (body.kind === "resolve") {
      // The level the marker changes, at its own scope (a band's cap or an entity's override, else the
      // domain's), and the one it sets, as the chat plays them: never below the ruleset's minimum, which
      // a later Upgrade or profile may have raised above the stored setting.
      const domainLevel = state.realism.levels[body.domain];
      const scope = body.scope;
      const stored = "all" in scope ? domainLevel : "tier" in scope ? (state.realism.tierCaps[scope.tier]?.[body.domain] ?? domainLevel) : (state.entities[scope.entity]?.levels[body.domain] ?? domainLevel);
      const from = rulesetFloor(world, body.domain, stored);
      const to = rulesetFloor(world, body.domain, body.to);
      const who = "all" in scope ? "" : "tier" in scope ? ` for ${BAND_WHO[scope.tier]}` : ` for ${state.entities[scope.entity]?.name ?? scope.entity}`;
      const name = this.rt.registry.packs.find((p) => p.domain === body.domain)?.label ?? body.domain;
      if (to < from) lines.push({ text: `${name}${who} drops from level ${from} to ${to}: processes above level ${to} stop and their inputs freeze; detail stays stored.`, tone: "freeze" });
      else if (to > from) lines.push({ text: `${name}${who} rises from level ${from} to ${to}: detail is filled in when first shown.`, tone: "promote" });
      else lines.push({ text: `${name}${who} stays at level ${from}.`, tone: "info" });
      if (to > from && to >= 2) lines.push({ text: `People without ${name.toLowerCase()} detail get it from the pinned tables when you open them.`, tone: "materialize" });
    } else if (body.kind === "time") {
      lines.push({ text: `${body.control} changes from the next turn; earlier turns keep the setting they were planned with.`, tone: "info" });
    } else if (body.kind === "claims") {
      lines.push({ text: `What you say you have that the world doesn't: ${CLAIM_MODE_LABEL[body.to.mode]}${body.to.mode === "real" ? (body.to.capped ? ", asking above the world's claim cap" : ", at any price") : ""}, from the next turn; earlier turns keep what theirs did.`, tone: "info" });
    } else if (body.kind === "adjudicate") {
      lines.push({ text: "Checks are decided this way from the next turn; earlier turns keep how theirs were decided.", tone: "info" });
    } else {
      lines.push({ text: `The chat moves to revision ${body.to.slice(0, 8)} of ${world.name} from the next turn.`, tone: "info" });
      return { lines, upgrade: await this.upgradePreview(chatId, userId, state, body.to) };
    }
    return { lines };
  }

  /** What an Upgrade with picks would bring into the chat, from the head state: the plan the fold applies, worded. */
  private async upgradePreview(chatId: ChatId, userId: UserId, state: Working["state"], to: RevisionId): Promise<UpgradePreview> {
    const run = await this.rt.runOf(chatId, userId);
    if (!run) throw new RequestError("not_world_chat", "this chat is not attached to a world");
    const docs = new Map<RevisionId, WorldDoc>();
    for (const revision of new Set([definitionsLag(state) ?? state.revision, state.revision, to])) docs.set(revision, (await this.rt.worlds.get(run.worldId, userId, revision)).world);
    const doc = (revision: RevisionId): WorldDoc => {
      const found = docs.get(revision);
      if (!found) throw new RequestError("not_found", `revision ${revision} of the world not found`);
      return found;
    };
    const plan = planUpgrade(state, { worlds: (revision) => docs.get(revision), types: this.rt.registry }, to);
    return upgradePreview(this.rt.registry, plan, state, doc(to), doc(state.revision));
  }

  private async chip(chatId: ChatId, userId: UserId, id: string, choice: string, payload?: JsonObject): Promise<ResultBodies["lre.chip"]> {
    await this.requireWorldChat(chatId, userId);
    const observed = toChain(await this.rt.host.chats.messages(chatId, userId));
    const [kind, messageId = "", swipe = "0"] = id.split(":");
    // Chips derived from records.
    if (kind === "reread" || kind === "retry_read") {
      // One read at a time per chat, re-checked inside the lock: a double tap reads once.
      return this.locked(`${userId}\u0000${chatId}`, async () => {
        const core = await this.rt.ledger.core(chatId, userId);
        const now = toChain(await this.rt.host.chats.messages(chatId, userId));
        const m = core?.chain(now).find((x) => x.id === messageId);
        if (!core || !m) throw new RequestError("not_found", "the message is gone");
        const rec = activeRecord(m, core.journal.tombstones);
        if (!rec || (kind === "reread" ? !rec.accepted : rec.status !== "stopped")) throw new RequestError("not_found", "the chip has lapsed");
        // A read the core would refuse (paused, a rebased view, not the head) makes no model call and
        // leaves the chips as they are.
        const refused = core.readRefusal({ kind, messageId, swipeId: m.swipeId }, now);
        if (refused === "paused") throw new RequestError("paused", "an earlier message was edited: Keep or Discard first");
        if (refused) throw new RequestError("bad_request", refused);
        // Both read the whole text and replace the swipe's earlier read, so that read's chips go first.
        const context = core.readContext(messageId, now);
        if (context) await this.rt.prepareRead(chatId, userId, messageId, m.swipeId, `${kind}:${messageId}:${m.swipeId}`, m.swipes[m.swipeId] ?? "", { ...context, recent: recentLines(core, now, now.findIndex((x) => x.id === messageId), this.rt.registry) }, true, true);
        const result = await this.write(chatId, userId, { kind, id: this.nextId(), messageId, swipeId: Number(swipe) });
        return { applied: result.applied, pending: result.pending };
      });
    }
    if (kind === "overdue") {
      // `overdue:<thing>:<borrower>`: Take back (the owner) or Give back (the borrower), as a palette action.
      const thing = messageId;
      const action = choice === "reclaim" ? "reclaim" : choice === "return" ? "give" : null;
      if (!action) throw new RequestError("bad_request", `unknown choice ${choice}`);
      const { state, world } = await this.head(chatId, userId);
      const def = world.actions[action] ?? this.rt.registry.actions.get(action);
      if (!def || !hasOwn(state.entities, thing)) throw new RequestError("not_found", "the loan is gone");
      const owner = state.entities[thing]?.fields.owner;
      const params: JsonObject = action === "reclaim" ? { item: thing } : { item: thing, to: typeof owner === "string" ? owner : "" };
      const text = neutralizeMacros(`(${def.label}: ${state.entities[thing]?.name ?? thing})`);
      this.rt.bridgeOf(chatId)?.setIntent(text, { action, params, probabilities: { [action]: 1 } });
      await this.rt.host.chats.appendUserMessage(chatId, text, { [LEDGER_NAMESPACE]: { action, params, source: "chip" } }, true, userId);
      return { applied: true, pending: false };
    }
    if (kind === "swipe_option") {
      if (choice !== "renarrate" && choice !== "rerun") throw new RequestError("bad_request", `unknown swipe mode ${choice}`);
      this.rt.setSwipeChoice(chatId, choice);
      return { applied: true, pending: false };
    }
    if (kind === "pause") {
      const w: HeldWrite = choice === "discard" ? { kind: "discard", id: this.nextId(), after: messageId } : { kind: "keep", id: this.nextId(), messageId, parentPath: "", convert: [] };
      const result = await this.write(chatId, userId, w);
      return { applied: result.applied, pending: result.pending };
    }
    if (kind === "fix") {
      // Undo on a ✎ fix or GM edit (`fix:<message>:<swipe>:<seq>`): every event of its entry stops folding.
      const seq = Number(id.split(":")[3]);
      const core = await this.rt.ledger.core(chatId, userId);
      const m = core?.chain(observed).find((x) => x.id === messageId);
      const rec = m && core ? activeRecord(m, core.journal.tombstones) : null;
      const entry = rec?.post.find((p) => p.seq === seq && p.kind === "fix");
      if (!m || !rec || !entry || String(m.swipeId) !== swipe) throw new RequestError("not_found", "the correction is gone");
      const refs: EventRef[] = entry.events.flatMap((_, index) => (rec.undone.some((u) => u.in === "post" && u.seq === seq && u.index === index) ? [] : [{ in: "post" as const, seq, index }]));
      if (refs.length === 0) return { applied: false, pending: false };
      const result = await this.write(chatId, userId, { kind: "undo", id: this.nextId(), messageId: m.id, swipeId: m.swipeId, refs });
      return { applied: result.applied, pending: result.pending };
    }
    if (kind === "refused") {
      // Dismiss on the notice of a held write that didn't apply (P2).
      await this.rt.ledger.with(chatId, userId, (core) => {
        core.dismissRefused(id.slice("refused:".length));
      });
      this.rt.push.changed(chatId, userId);
      return { applied: true, pending: false };
    }
    if (kind === "keep" || kind === "retry" || kind === "change" || kind === "elapsed" || kind === "degraded") return { applied: false, pending: false };
    // Stored chips: one action at a time per chat. Inside the lock the chip is looked up again and
    // acted on; it is taken as soon as its write lands, before any learning or bookkeeping, so a
    // failed write leaves the chip (and records no learning), nothing failing after the write can
    // leave a chip that would act again, and a second tap finds it gone.
    return this.locked(`${userId}\u0000${chatId}`, async () => {
      const chip = (await this.rt.chips.list(chatId, userId)).find((c) => c.id === id);
      if (!chip) throw new RequestError("not_found", "the chip has lapsed");
      const now = toChain(await this.rt.host.chats.messages(chatId, userId));
      // A swipe's chip acts only while that swipe is shown, as the view shows it: a tap from a view of
      // another swipe would apply what that swipe's reply said to the one shown.
      if (chip.swipeId !== undefined && now.find((m) => m.id === chip.messageId)?.swipeId !== chip.swipeId) throw new RequestError("not_found", "the chip belongs to a swipe that isn't shown");
      const result = await this.storedChip(chatId, userId, id, choice, chip, now, payload);
      await this.rt.takeChip(chatId, userId, id);
      return result;
    });
  }

  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.chipLocks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => mine);
    this.chipLocks.set(key, tail);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.chipLocks.get(key) === tail) this.chipLocks.delete(key);
    }
  }

  private async storedChip(chatId: ChatId, userId: UserId, id: string, choice: string, chip: StoredChip, observed: ChainMessage[], payload?: JsonObject): Promise<ResultBodies["lre.chip"]> {
    const settings = await this.rt.settings.get(userId);
    const learning = await this.rt.settings.learningOf(userId);
    const type = EXTRACTION_TYPES.find((t) => t === chip.payload.type);
    const connection = typeof chip.payload.connection === "string" ? chip.payload.connection : ACTIVE_CONNECTION;
    // The chip's action is done: take it, then learn. A learning failure is logged and never undoes the take.
    const settle = async (outcome: "accepted" | "rejected"): Promise<void> => {
      await this.rt.takeChip(chatId, userId, id);
      if (!type) return;
      try {
        const change = recordOutcome(settings, learning, connection, type, outcome, Date.now());
        await this.rt.settings.saveLearning(userId);
        if (change) await this.rt.addModeChip(chatId, userId, change.type, change.from, change.to, change.connectionId);
      } catch (error) {
        this.rt.host.log("warn", `[LumiRPEngine] ${type} learning wasn't recorded: ${error instanceof Error ? error.message : String(error)}`, userId);
      }
    };
    switch (chip.kind) {
      case "confirm": {
        if (choice !== "confirm" && choice !== "amount") {
          await settle("rejected");
          this.rt.push.changed(chatId, userId);
          return { applied: false, pending: false };
        }
        const proposal = isRecord(chip.payload.proposal) ? (JSON.parse(JSON.stringify(chip.payload.proposal)) as JsonObject) : null;
        if (!proposal) throw new RequestError("bad_request", "the chip has no proposal");
        // Edit amount: the purchase is charged what the player set, as set.
        if (choice === "amount") {
          const cents = chipValue(chip, choice, payload);
          if (typeof cents !== "number") throw new RequestError("bad_request", "the amount isn't a positive amount of money");
          proposal.playerPrice = cents;
        }
        const { state, world } = await this.head(chatId, userId);
        const w = new Working(this.rt.registry, world, state);
        let events: LedgerEvent[];
        if (proposal.type === "time_advance") {
          // A narrated time skip applies as it would have automatically (DESIGN §9.4): whole, with its
          // catch-up, from the clock the head stands at now, or not at all; never while a fight holds
          // the clock, which may have started since the chip was offered.
          const advance = applyTimeAdvance(this.rt.registry, w, typeof proposal.minutes === "number" ? Math.round(proposal.minutes) : 0, { runSeed: this.runSeedOf(chatId), capMinutes: TIME_ADVANCE_CAP, unitCap: w.state.time.unitCap });
          if (!advance.applied) throw new RequestError("validation", advance.reason === "unit_cap" ? "too much happens in between to run it inside the turn" : advance.reason === "in_fight" ? `${IN_FIGHT}, and its rounds take no clock time` : "the time skip no longer applies");
          events = [...w.events];
        } else {
          // The seed the chip's check used, so a purchase charges the amount its label shows.
          const [outcome] = applyProposals(this.rt.registry, w, [proposal], typeof chip.payload.seed === "string" ? chip.payload.seed : `${id}:confirm`, this.runSeedOf(chatId));
          if (!outcome || outcome.rejection) throw new RequestError("validation", outcome?.rejection?.reason ?? "the change no longer applies");
          events = [...outcome.materialized, ...outcome.events];
        }
        const result = await this.write(chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "confirm", events } });
        await settle("accepted");
        return { applied: result.applied, pending: result.pending };
      }
      case "undo": {
        const core = await this.rt.ledger.core(chatId, userId);
        const m = core?.chain(observed).find((x) => x.id === chip.messageId);
        const rec = m?.ledger?.swipes[String(m.swipeId)];
        const events = Array.isArray(chip.payload.events) ? chip.payload.events : [];
        if (!m || !rec) throw new RequestError("not_found", "the turn is gone");
        if (choice === "amount") {
          // Edit amount on a purchase that applied by itself: the difference to what it charged moves
          // between the same two accounts, as a correction beside it.
          const cents = chipValue(chip, choice, payload);
          if (typeof cents !== "number") throw new RequestError("bad_request", "the amount isn't a positive amount of money");
          const { state, world } = await this.head(chatId, userId);
          const w = new Working(this.rt.registry, world, state);
          const postings = events.flatMap((e): LedgerEvent[] => (isRecord(e) && e.type === "post" && typeof e.memo === "string" && Array.isArray(e.lines) ? [{ type: "post", memo: e.memo, lines: e.lines.flatMap((l) => (isRecord(l) && typeof l.account === "string" && typeof l.amount === "number" ? [{ account: l.account, amount: l.amount }] : [])) }] : []));
          const repriced = optionalService(w.ctx, "economy.reprice")?.(w.ctx, postings, cents);
          if (!repriced) throw new RequestError("bad_request", "there's no purchase to reprice");
          if (!Array.isArray(repriced)) throw new RequestError("validation", repriced.reason);
          for (const e of repriced) {
            const rejection = w.apply(e);
            if (rejection) throw new RequestError("validation", rejection.reason);
          }
          const result = repriced.length > 0 ? await this.write(chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "confirm", events: repriced } }) : { applied: false, pending: false };
          await settle("accepted");
          return { applied: result.applied, pending: result.pending };
        }
        const refs = Runtime.refsOf(rec, events);
        if (refs.length === 0) return { applied: false, pending: false };
        const result = await this.write(chatId, userId, { kind: "undo", id: this.nextId(), messageId: m.id, swipeId: m.swipeId, refs });
        await settle("rejected");
        return { applied: result.applied, pending: result.pending };
      }
      case "mode_change": {
        const raw = chip.payload.change;
        if (isRecord(raw) && typeof raw.connectionId === "string" && (raw.from === "auto" || raw.from === "confirm" || raw.from === "never") && (raw.to === "auto" || raw.to === "confirm" || raw.to === "never")) {
          const changeType = EXTRACTION_TYPES.find((t) => t === raw.type);
          if (changeType) {
            const change: ModeChange = { connectionId: raw.connectionId, type: changeType, from: raw.from, to: raw.to };
            undoModeChange(learning, change);
            await this.rt.settings.saveLearning(userId);
          }
        }
        this.rt.push.changed(chatId, userId);
        return { applied: true, pending: false };
      }
      case "timelapse_offer":
      case "continue_timelapse": {
        const target = parseTarget(chip.payload.target);
        if (!target) throw new RequestError("bad_request", "the chip has no target");
        const text = neutralizeMacros(`(Timelapse: ${targetLabel(target)})`);
        const overrides = chip.payload.allNote === true ? { invitation: "note", bill: "note", decline: "note", incident: "note", quest: "note", rule: "note", arrival: "note", overdue: "note", needs: "note", weather: "note" } : undefined;
        this.rt.bridgeOf(chatId)?.setIntent(text, timelapseIntent(target, overrides));
        await this.rt.host.chats.appendUserMessage(chatId, text, { [LEDGER_NAMESPACE]: { action: TIMELAPSE_ACTION, params: JSON.parse(JSON.stringify({ target, ...(overrides ? { overrides } : {}) })) as JsonValue, source: "chip" } }, true, userId);
        return { applied: true, pending: false };
      }
      case "not_action": {
        const core = await this.rt.ledger.core(chatId, userId);
        const m = core?.chain(observed).find((x) => x.id === chip.messageId);
        const rec = m?.ledger?.swipes[String(m.swipeId)];
        if (!m || !rec) throw new RequestError("not_found", "the turn is gone");
        // A Re-run of this turn plays the text as plain roleplay from now on.
        if (typeof chip.payload.text === "string") this.rt.bridgeOf(chatId)?.setIntent(chip.payload.text, null);
        const refs = Runtime.refsOf(rec, Array.isArray(chip.payload.events) ? chip.payload.events : [], 0);
        if (refs.length === 0) return { applied: false, pending: false };
        const result = await this.write(chatId, userId, { kind: "undo", id: this.nextId(), messageId: m.id, swipeId: m.swipeId, refs });
        return { applied: result.applied, pending: result.pending };
      }
      case "claim": {
        // The answer to a claim's question (DESIGN §9.4): kept with the read; the frontend's Regenerate then resumes the turn.
        if (choice !== "add" && choice !== "drop") throw new RequestError("bad_request", `unknown choice ${choice}`);
        const text = typeof chip.payload.text === "string" ? chip.payload.text : "";
        const index = typeof chip.payload.index === "number" ? chip.payload.index : -1;
        return { applied: this.rt.answerClaim(chatId, text, index, choice === "add"), pending: false };
      }
      case "claimed": {
        // Undo of a thing the player said they had: it goes, with what its action did (DESIGN §9.4).
        const core = await this.rt.ledger.core(chatId, userId);
        const m = core?.chain(observed).find((x) => x.id === chip.messageId);
        const rec = m?.ledger?.swipes[String(m.swipeId)];
        if (!m || !rec) throw new RequestError("not_found", "the turn is gone");
        const refs = Runtime.refsOf(rec, Array.isArray(chip.payload.events) ? chip.payload.events : [], 0);
        if (refs.length === 0) return { applied: false, pending: false };
        const result = await this.write(chatId, userId, { kind: "undo", id: this.nextId(), messageId: m.id, swipeId: m.swipeId, refs });
        return { applied: result.applied, pending: result.pending };
      }
      case "decline": {
        const proposal = isRecord(chip.payload.proposal) ? (JSON.parse(JSON.stringify(chip.payload.proposal)) as JsonObject) : null;
        const reason = typeof chip.payload.reason === "string" ? chip.payload.reason : "declined";
        // A typed action that named nothing in the world has no proposal (DESIGN §9.4): its chip holds the note each choice leaves.
        const note = !proposal && isRecord(chip.payload.notes) && hasOwn(chip.payload.notes, choice) ? chip.payload.notes[choice] : undefined;
        if (typeof note === "string") {
          await this.rt.setOutcomeNote(chatId, userId, chip.id, note);
          this.rt.push.changed(chatId, userId);
          return { applied: true, pending: false };
        }
        if (!proposal || choice === "dismiss") {
          await this.rt.setOutcomeNote(chatId, userId, chip.id, null);
          this.rt.push.changed(chatId, userId);
          return { applied: false, pending: false };
        }
        const { state, world } = await this.head(chatId, userId);
        if (choice === "remove" || choice === "accept") {
          await this.rt.setOutcomeNote(chatId, userId, chip.id, declineNote(proposal, reason, choice, state, world));
          this.rt.push.changed(chatId, userId);
          return { applied: true, pending: false };
        }
        if (choice === "price" || choice === "item") {
          // A purchase nothing priced (DESIGN §9.5): at the price the player set, or as the catalog
          // item they picked, at its price.
          const value = chipValue(chip, choice, payload);
          if (value === null) throw new RequestError("bad_request", choice === "price" ? "the price isn't a positive amount of money" : "pick one of the chip's items");
          const { price: _price, name: _name, ...rest } = proposal;
          const priced: JsonObject = choice === "price" ? { ...proposal, playerPrice: value } : { ...rest, item: value };
          const w = new Working(this.rt.registry, world, state);
          const [outcome] = applyProposals(this.rt.registry, w, [priced], typeof chip.payload.seed === "string" ? chip.payload.seed : `${id}:${choice}`, this.runSeedOf(chatId));
          if (!outcome || outcome.rejection || outcome.events.length === 0) throw new RequestError("validation", outcome?.rejection?.reason ?? "the purchase no longer applies");
          await this.rt.setOutcomeNote(chatId, userId, chip.id, null);
          const result = await this.write(chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "confirm", events: [...outcome.materialized, ...outcome.events] } });
          return { applied: result.applied, pending: result.pending };
        }
        if (choice !== "other") throw new RequestError("bad_request", `unknown choice ${choice}`);
        // Pay another way (DESIGN §9.5): the first payment method that covers it.
        for (const method of ["savings", "card", "checking", "cash"]) {
          const w = new Working(this.rt.registry, world, state);
          const [outcome] = applyProposals(this.rt.registry, w, [{ ...proposal, method }], `${id}:${method}`, this.runSeedOf(chatId));
          if (!outcome || outcome.rejection || outcome.events.length === 0) continue;
          await this.rt.setOutcomeNote(chatId, userId, chip.id, null);
          const result = await this.write(chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "confirm", events: [...outcome.materialized, ...outcome.events] } });
          return { applied: result.applied, pending: result.pending };
        }
        // Nothing covers it: the chip stays for Remove or Accept.
        throw new RequestError("validation", "No other way to pay covers it.");
      }
      case "read_failed": {
        // Retry: the next swipe re-runs the turn, reading the typed text afresh; the UI swipes.
        if (choice !== "rerun") throw new RequestError("bad_request", `unknown choice ${choice}`);
        this.rt.setSwipeChoice(chatId, "rerun");
        return { applied: true, pending: false };
      }
      case "choice": {
        // A suggestion is model text: it goes in as the player's message with its braces neutralized.
        const text = typeof chip.payload.text === "string" ? neutralizeMacros(chip.payload.text).trim() : "";
        if (choice !== "send" || text === "") return { applied: false, pending: false };
        await this.rt.host.chats.appendUserMessage(chatId, text, {}, true, userId);
        return { applied: true, pending: false };
      }
      case "contradiction": {
        if (choice === "renarrate") {
          // The next swipe re-narrates this turn (same outcome, new prose); the UI swipes.
          this.rt.setSwipeChoice(chatId, "renarrate");
          return { applied: true, pending: false };
        }
        await this.rt.setOutcomeNote(chatId, userId, chip.id, null);
        this.rt.push.changed(chatId, userId);
        return { applied: true, pending: false };
      }
      default:
        this.rt.push.changed(chatId, userId);
        return { applied: false, pending: false };
    }
  }
}

/**
 * What a chip action's input sent (`ChipAction.input`): a positive whole amount in minor units, or
 * one of the action's own options. Null when the action takes no input or the value doesn't fit.
 */
function chipValue(chip: StoredChip, choice: string, payload: JsonObject | undefined): number | string | null {
  const input = chip.actions.find((a) => a.id === choice)?.input;
  if (!input || !payload) return null;
  if (input.type === "money") return typeof payload.cents === "number" && Number.isSafeInteger(payload.cents) && payload.cents > 0 ? payload.cents : null;
  return typeof payload.value === "string" && input.options.some((o) => o.value === payload.value) ? payload.value : null;
}

function stringRecord(o: Record<string, string> | Partial<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
}

function targetLabel(t: TimelapseTarget): string {
  switch (t.type) {
    case "duration":
      return t.minutes >= 60 ? `${Math.round((t.minutes / 60) * 10) / 10} h` : `${t.minutes} min`;
    case "day_part":
      return `until ${t.dayPart}`;
    case "at":
      return "until the set time";
    case "stage":
      return `until ${t.track} reaches ${t.stage}`;
    default:
      return `until the next ${t.type}`;
  }
}
