// Protocol dispatch (ARCHITECTURE §4): every frontend request gets exactly one `lre.result` or
// `lre.error` with its `reqId`. Ledger writes go through the queue and are held inside open
// windows (P2: `pending: true`).

import type { Band, ChatId, DomainId, UserId, WorldId } from "../shared/ids";
import { DOMAINS, pathSafe } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { HeldWrite, LedgerEvent, MarkerBody } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { hashParts } from "../shared/hash";
import type { RulesetDef } from "../shared/world";
import { previewSheet } from "../engine/authoring";
import { levelUps } from "../engine/effects";
import { createRng } from "../engine/rng";
import { formulaFunctions } from "../engine/scope";
import { neutralizeMacros } from "../shared/macros";
import type { ErrorCode, FrontendToBackend, LintIssue, MarkerPreview, ResultBodies } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { EXTRACTION_TYPES } from "../shared/settings";
import type { TimelapseTarget } from "../shared/ledger";
import { validMarkerBody } from "../engine/events";
import { materializeIfNeeded } from "../engine/materialize";
import { optionalService } from "../engine/pack-kit";
import { parseOverrides, parseTarget } from "../engine/time";
import { timelapseIntent } from "../engine/turn";
import { Working } from "../engine/working";
import type { ChainMessage } from "../engine/ledger/chain";
import { activeRecord } from "../engine/ledger/path";
import type { StoredChip } from "./chips";
import { toChain } from "./ledger-io";
import { JobError, type JobRunner } from "./jobs";
import { ACTIVE_CONNECTION, declineNote, Runtime } from "./runtime";
import { recordOutcome, undoModeChange, type ModeChange } from "./settings-store";
import { applyProposals } from "./turn-model";
import { TIMELAPSE_ACTION } from "./view";
import { newChatRun, WorldError } from "./worlds";

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

export class Dispatcher {
  private writeSeq = 0;
  /** Stored chip actions in flight per (user, chat): one at a time, so a double tap acts once. */
  private readonly chipLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly rt: Runtime,
    private readonly jobs: JobRunner,
  ) {}

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
    const reply = <K extends keyof ResultBodies>(request: K, body: ResultBodies[K]): void => {
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: raw.reqId, request, body } as never, userId, session);
    };
    try {
      await this.route(raw, userId, session, reply);
    } catch (error) {
      const e = error instanceof RequestError ? error : error instanceof WorldError ? new RequestError(error.code, error.message, error.lint) : error instanceof JobError ? new RequestError(error.code, error.message) : new RequestError("internal", error instanceof Error ? error.message : String(error));
      if (e.code === "internal") this.rt.host.log("error", `[LumiRPEngine] ${raw.type}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: raw.reqId, code: e.code, message: e.message, ...(e.lint ? { lint: e.lint } : {}) }, userId, session);
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

  private async route(r: FrontendToBackend, userId: UserId, session: string | undefined, reply: <K extends keyof ResultBodies>(request: K, body: ResultBodies[K]) => void): Promise<void> {
    switch (r.type) {
      case "lre.hello":
      case "lre.state.resync": {
        reply(r.type, { accepted: true });
        if (r.chatId) {
          if (await this.rt.runOf(r.chatId, userId)) await this.rt.ledger.open(r.chatId, userId);
          await this.rt.push.snapshot(r.chatId, userId, session);
        }
        return;
      }
      case "lre.action": {
        await this.requireWorldChat(r.chatId, userId);
        const bridge = this.rt.bridgeOf(r.chatId);
        let text = r.text?.trim() ?? "";
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
        const messageId = await this.rt.host.chats.appendUserMessage(r.chatId, text, { [LEDGER_NAMESPACE]: { action: r.action, params: r.params, source: r.source } }, true, userId);
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
          // Opening the inspector checks slot deliverability between generations (decision #5c).
          await this.rt.checkDelivery(r.chatId, userId);
          reply("lre.view.open", { materialized: false, pending: false });
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
        const w = new Working(this.rt.registry, world, state);
        // Cash held in cash accounts is corrected by a balanced posting against the outside
        // correction account (DESIGN §9.2), so the cash shown becomes the amount and the books still
        // balance; any other value (and cash without a cash account) is set on its field.
        const corrected = r.field === "cash" && typeof r.value === "number" ? (optionalService(w.ctx, "economy.set_cash")?.(w.ctx, r.entity, r.value) ?? null) : null;
        if (corrected !== null && !Array.isArray(corrected)) throw new RequestError("validation", corrected.reason);
        const events: LedgerEvent[] = corrected ?? [{ type: "set", entity: r.entity, field: r.field, value: r.value }];
        for (const e of events) {
          const rejection = w.apply(e);
          if (rejection) throw new RequestError("validation", rejection.reason);
        }
        // A fix to XP levels up like any other change to it (DESIGN §11); the level-ups are part of the fix.
        levelUps(this.rt.registry, w, events, { bindings: {}, rng: createRng(hashParts(this.runSeedOf(r.chatId), "fix", r.entity, r.field, JSON.stringify(r.value))) });
        const result = w.events.length > 0 ? await this.write(r.chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "fix", events: [...w.events] } }) : { pending: false };
        reply("lre.fix", { pending: result.pending });
        return;
      }
      case "lre.marker": {
        const body = validMarkerBody(r.kind === "resolve" ? { kind: "resolve", domain: r.domain, scope: r.scope, to: r.to } : r.kind === "time" ? { kind: "time", control: r.control, scope: r.scope, to: r.to } : { kind: "migrate", to: r.to });
        if (!body) throw new RequestError("bad_request", "not a valid marker");
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
        if (r.type === "lre.settings.set") await this.rt.settings.set(userId, r.patch);
        const settings = await this.rt.settings.get(userId);
        const routed = settings.modelUse.steps.extract?.route?.connectionId ?? null;
        // The connection whose learning Settings shows: extraction's route, else the user's default.
        const active = routed ? null : await this.rt.host.connections.active(userId).catch(() => null);
        const id = routed ?? active?.id ?? ACTIVE_CONNECTION;
        reply(r.type, await this.rt.settings.result(userId, { id, name: active?.name ?? (id === ACTIVE_CONNECTION ? "Active connection" : id) }, await this.rt.presetCaveats(userId)));
        return;
      }
      case "lre.editor": {
        reply("lre.editor", await this.rt.worlds.edit(r, userId));
        return;
      }
      case "lre.world": {
        reply("lre.world", await this.world(r, userId));
        return;
      }
      case "lre.ui": {
        await this.rt.host.frontend.closeDrawer(userId);
        reply("lre.ui", { done: true });
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
    }
  }

  private async world(r: Extract<FrontendToBackend, { type: "lre.world" }>, userId: UserId): Promise<ResultBodies["lre.world"]> {
    const store = this.rt.worlds;
    switch (r.op) {
      case "list":
        return { worlds: await store.list(userId) };
      case "get":
        return { ...(await store.get(r.worldId, userId, r.revision)), packKinds: Object.fromEntries(this.rt.registry.kinds), functions: formulaFunctions(this.rt.registry) };
      case "create": {
        const template = r.template && hasOwn(this.rt.templates, r.template) ? this.rt.templates[r.template] : undefined;
        if (r.template && !template) throw new RequestError("not_found", `unknown template ${r.template}`);
        const created = await store.create(r.name, template ? template("", r.name) : null, userId);
        await this.syncBook(created.world.id, userId);
        return { world: created.world, revision: created.revision };
      }
      case "delete":
        await store.remove(r.worldId, userId);
        return { worlds: await store.list(userId) };
      case "commit": {
        const committed = await store.commit(r.worldId, r.base, userId);
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
        if (existing) {
          await this.rt.book.attach(r.chatId, await this.rt.book.ensure(world, index, userId), userId);
          await this.rt.push.snapshot(r.chatId, userId);
          return { revision: existing.revision };
        }
        await this.rt.host.chats.mergeChatMetadata(r.chatId, { [LEDGER_NAMESPACE]: JSON.parse(JSON.stringify(newChatRun(r.worldId, revision))) as JsonValue }, userId);
        const bookId = await this.rt.book.ensure(world, index, userId);
        await this.rt.book.attach(r.chatId, bookId, userId);
        this.rt.forgetChat(r.chatId);
        await this.rt.ledger.open(r.chatId, userId);
        await this.rt.push.snapshot(r.chatId, userId);
        return { revision };
      }
      case "upgrade": {
        const before = await this.rt.runOf(r.chatId, userId);
        if (!before || !(await this.rt.worlds.hasRevision(before.worldId, r.to, userId))) throw new RequestError("not_found", "unknown world revision");
        await this.write(r.chatId, userId, { kind: "marker", id: this.nextId(), target: "head", body: { kind: "migrate", to: r.to } });
        await this.syncBook(before.worldId, userId);
        return { revision: r.to };
      }
      case "sheet": {
        // The Sheet Designer's live preview: the draft with the unsaved ruleset, as a chat would start.
        const draft = await store.working(r.worldId, userId);
        const world = { ...draft, ruleset: isRecord(r.ruleset) ? (r.ruleset as unknown as RulesetDef) : undefined };
        const entity = typeof r.entity === "string" && hasOwn(world.entities, r.entity) ? r.entity : world.pov;
        return { sheet: previewSheet(this.rt.registry, world, entity) };
      }
    }
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
      // The level the marker changes, at its own scope (a band's cap or an entity's override, else the domain's).
      const domainLevel = state.realism.levels[body.domain];
      const scope = body.scope;
      const from = "all" in scope ? domainLevel : "tier" in scope ? (state.realism.tierCaps[scope.tier]?.[body.domain] ?? domainLevel) : (state.entities[scope.entity]?.levels[body.domain] ?? domainLevel);
      const who = "all" in scope ? "" : "tier" in scope ? ` for ${BAND_WHO[scope.tier]}` : ` for ${state.entities[scope.entity]?.name ?? scope.entity}`;
      const name = this.rt.registry.packs.find((p) => p.domain === body.domain)?.label ?? body.domain;
      if (body.to < from) lines.push({ text: `${name}${who} drops from level ${from} to ${body.to}: processes above level ${body.to} stop and their inputs freeze; detail stays stored.`, tone: "freeze" });
      else if (body.to > from) lines.push({ text: `${name}${who} rises from level ${from} to ${body.to}: detail is materialized when first shown.`, tone: "promote" });
      else lines.push({ text: `${name}${who} stays at level ${from}.`, tone: "info" });
      if (body.to > from && body.to >= 2) lines.push({ text: `People without ${name.toLowerCase()} detail get it from the pinned tables when you open them.`, tone: "materialize" });
    } else if (body.kind === "time") {
      lines.push({ text: `${body.control} changes from the next turn; earlier turns keep the setting they were planned with.`, tone: "info" });
    } else {
      lines.push({ text: `The chat moves to revision ${body.to.slice(0, 8)} of ${world.name} from the next turn.`, tone: "info" });
    }
    return { lines };
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
        if (context) await this.rt.prepareRead(chatId, userId, messageId, m.swipeId, `${kind}:${messageId}:${m.swipeId}`, m.swipes[m.swipeId] ?? "", context, true, true);
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
    if (kind === "keep" || kind === "retry" || kind === "change" || kind === "elapsed" || kind === "degraded") return { applied: false, pending: false };
    // Stored chips: one action at a time per chat. Inside the lock the chip is looked up again and
    // acted on; it is taken as soon as its write lands, before any learning or bookkeeping, so a
    // failed write leaves the chip (and records no learning), nothing failing after the write can
    // leave a chip that would act again, and a second tap finds it gone.
    return this.locked(`${userId}\u0000${chatId}`, async () => {
      const chip = (await this.rt.chips.list(chatId, userId)).find((c) => c.id === id);
      if (!chip) throw new RequestError("not_found", "the chip has lapsed");
      const result = await this.storedChip(chatId, userId, id, choice, chip, toChain(await this.rt.host.chats.messages(chatId, userId)), payload);
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
        // The seed the chip's check used, so a purchase charges the amount its label shows.
        const [outcome] = applyProposals(this.rt.registry, w, [proposal], typeof chip.payload.seed === "string" ? chip.payload.seed : `${id}:confirm`, this.runSeedOf(chatId));
        if (!outcome || outcome.rejection) throw new RequestError("validation", outcome?.rejection?.reason ?? "the change no longer applies");
        const result = await this.write(chatId, userId, { kind: "post", id: this.nextId(), target: "head", entry: { kind: "confirm", events: [...outcome.materialized, ...outcome.events] } });
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
      case "continue_timelapse":
      case "retry_timelapse": {
        const target = parseTarget(chip.payload.target);
        if (!target) throw new RequestError("bad_request", "the chip has no target");
        const text = neutralizeMacros(`(Timelapse: ${targetLabel(target)})`);
        const recorded = chip.kind === "retry_timelapse" ? stringRecord(parseOverrides(chip.payload.overrides)) : {};
        const overrides = chip.payload.allNote === true ? { invitation: "note", bill: "note", decline: "note", incident: "note", quest: "note", rule: "note", arrival: "note", overdue: "note", needs: "note", weather: "note" } : Object.keys(recorded).length > 0 ? recorded : undefined;
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
      case "decline": {
        const proposal = isRecord(chip.payload.proposal) ? (JSON.parse(JSON.stringify(chip.payload.proposal)) as JsonObject) : null;
        const reason = typeof chip.payload.reason === "string" ? chip.payload.reason : "declined";
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
