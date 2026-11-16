// A chat's play panels, served by RPE (plan §14: today's panels kept, re-pointed to RPE): the chat's
// state view, read from RPE's store; what a turn's time brought due; and the taps that manage (money, a
// group, gear, with no words), each ✎ correction, an edit of operations ("Make this a property") and the
// World page's edit of values and facts, each recorded as his own edit through the one owner's-edit path
// (`owner-edits.ts`), on the typed route and on today's message tunnel alike. A tap records what he did
// and nothing code made up (plan §6.1, §6.4): nothing is drawn from the world's tables, and the clock's ✎
// moves the clock without deciding what the time between did. The world's rules advise rather than
// refuse (plan §6.1): a requirement the world's action does not meet, or a payee who is not there, is
// applied with what does not add up kept beside it and answered. What is still refused (§6.1: an id that
// does not exist or that his character cannot know of, input that cannot be parsed) says its true reason,
// case by case (`unfit.ts`). An Undo records the reversal of all of his changes of an edit
// (`UserStore.undo`), or of none and says what has no undo. A chat's own choices (today's
// `lre.chat.knowledge`) read as RPE has them: it keeps none. A tap that goes with the next message, a tap
// that plays now, setting a chat's own choice, the things browser and the map's walk and display are not
// served here, and say so. Every word is a line of `.prompts/play-answers.md`. After each change the
// chat's followers are told its state changed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { type LiveHub, RouteError, type WriteQueue } from "../app";
import { calendarOf, clockOfStamp, placeOffset } from "../engine/calendar";
import { resolveEdit } from "../engine/edits";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { materializeIfNeeded } from "../engine/materialize";
import { optionalQuery, own } from "../engine/pack-kit";
import { baseWorld } from "../engine/places-in-play";
import type { Registry } from "../engine/registry-impl";
import { resolveAction } from "../engine/resolve";
import { createRng } from "../engine/rng";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { clockFix } from "../engine/time";
import { currentStage } from "../engine/tracks";
import { canSeeEntity, canSeePlace, playerTrack, shownTrackId, unrevealedSecrets } from "../engine/visibility";
import { Working } from "../engine/working";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import { hasLedger } from "../packs/economy/core/model";
import { FINANCE_EVENTS } from "../shared/finance";
import { hashParts } from "../shared/hash";
import { isRecord, type JsonObject, type JsonValue, safeKey } from "../shared/json";
import type { FixOp, LedgerEvent } from "../shared/ledger";
import { OFFSTAGE_ORIGIN, ORIGIN_FIELD, playsOffstage } from "../shared/offstage";
import type { ErrorCode, ErrorMessage, FrontendToBackend, ResultBodies, ResultMessage } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import { type ItemFix, parseItemFix } from "../shared/things";
import type { ParamDef, WorldDoc } from "../shared/world";
import { type ChangeRow, factStore, JoinedTurnError, readPart, type Report, type Store } from "../store";
import { FACT_ABOUT } from "../store/facts";
import { type DueRead, turnDue } from "./due";
import { RunEnds, stateChanged } from "./live";
import { editId, type Head, PLAYER, recordOwnerEdit, Refused, type Resolved } from "./owner-edits";
import type { TapSettings } from "./settings";
import { TIMELAPSE_ACTION } from "./state/palette";
import { playerReason } from "./state/requirement-words";
import { unfitRef } from "./state/unfit-ref";
import { unfitWords } from "./unfit";
import { chatView, headTurn } from "./view";

/** The prompt part this area's words are in, under the guidance folder's `.prompts/`. */
export const PLAY_ANSWERS = "play-answers";

/** The economy's domain, whose materializer opens the accounts the world gave a party that holds some. */
const MONEY = "money";

/**
 * The line of this area's words that says a change of the world's stays after an Undo, by its operation: the accounts the world
 * gave, opened, and what the economy takes someone it keeps no accounts for to be worth (the rest of its bookkeeping, the band a
 * payment moved them to, is reversed with the payment).
 */
const STAYS: Readonly<Record<string, string>> = { materialize: "opened_stay", [FINANCE_EVENTS.anchor]: "worth_stays" };

/** What one answer says in more than one line of this area's words, those lines joined by this. */
const SENTENCES = " ";

/** The settings a chat's taps read, as the chat's levels set them. */
export interface PlaySettings {
  /** The most things falling due a list gives (`engine.dueItems`). */
  dueItems: number;
  /** The most operations one edit of operations carries (`engine.editOps`). */
  editOps: number;
  taps: TapSettings;
}

export interface PlayDeps {
  /** RPE's store, which holds each chat's state. */
  store: Store;
  /** The application's write queue: the store takes writes only through it. */
  writes: WriteQueue;
  /** The application's live hub. */
  live: Pick<LiveHub, "publish" | "follow">;
  /** The guidance folder whose `.prompts/` holds this area's words. */
  guidance: string;
  /** Whether a turn of the user's chat runs now. */
  turning(user: string, chat: string): boolean;
  /** The chat's settings the taps and reads take. */
  settings(user: string, chat: string): Promise<PlaySettings>;
  log: Log;
}

/** Where a tap was made. */
export type TapSource = "palette" | "map" | "panel" | "chip" | "send-now";

/** A tap that does one of the world's actions at once (money, a group, gear, a vehicle). */
export interface ActionAsk {
  action: string;
  params: JsonObject;
  source: string;
  /** Words typed with it, which a refusal quotes his name for something from. */
  text?: string;
  /** Asked to play now, as a message of its own. */
  now?: boolean;
}

/** One of the ✎ forms: a hint opened, the time, a thing, things, or a field (place, cash, weather, scene type, a sheet row). */
export type FixAsk = { hint: string } | { time: string } | { thing: JsonValue } | { things: JsonValue[]; label: string } | { entity: string; field: string; value: JsonValue };

/** One field of the World page's edit: a value or a fact at a level, set or removed. */
export interface EditOpAsk {
  op: "set" | "remove";
  at: string;
  key: string;
  as: "value" | "fact";
  value?: string;
  precision?: "exact" | "approximate" | "vague" | "unknown";
  standing?: "established" | "proposed" | "assumed";
}

/** A tap on the typed route, with his "Tell the story" choice. */
export type TapAsk =
  | ({ kind: "action" } & ActionAsk & { tell?: boolean })
  | { kind: "fix"; fix: FixAsk; tell?: boolean }
  | { kind: "edit"; ops: EditOpAsk[]; tell?: boolean }
  | { kind: "ops"; ops: JsonValue[]; tell?: boolean };

/** What a tap on the typed route came to: applied or not, what the world's rules reported, the id its Undo takes, and the answer's words. */
export interface TapAnswer {
  applied: boolean;
  reports: string[];
  undo: string | null;
  words: string;
}

type Request<T extends FrontendToBackend["type"]> = Extract<FrontendToBackend, { type: T }>;

function reply<K extends keyof ResultBodies>(r: FrontendToBackend, request: K, body: ResultBodies[K]): ResultMessage {
  return { lre: PROTOCOL_VERSION, type: "lre.result", reqId: r.reqId, request, body } as ResultMessage;
}

/** A tap of his alone, which opens nothing of the world's. */
function played(events: LedgerEvent[]): Resolved {
  return { opened: [], events };
}

/** The unit a recorded change is undone with, as the store takes it: its group's, or its own when it has none. */
function unitOf(c: ChangeRow): string {
  return isRecord(c.value) && typeof c.value.group === "string" ? `group:${c.value.group}` : `change:${c.id}`;
}

/** What the world's rules advised against an edit, as the answer lists them: each its words. */
function adviceWords(advised: readonly Report[]): string[] {
  return advised.flatMap((r) => (typeof r.values?.why === "string" ? [r.values.why] : []));
}

/**
 * Opens on `w` the accounts the world gave each of `parties` that nobody has opened yet, as the engine's own tools open them
 * before a sum (`openAuthored`, `src/iface/ops-values.ts`), so a sum starts from what the world gave: for a party that holds
 * accounts, the money materializer posts their authored openings and draws nothing. Someone the world gave no accounts is
 * given none. Each opening, in order.
 */
function openGiven(registry: Registry, w: Working, parties: readonly string[], seed: string): LedgerEvent[] {
  const opened: LedgerEvent[] = [];
  for (const id of new Set(parties)) {
    if (!hasLedger(w.ctx, id)) continue;
    const event = materializeIfNeeded(registry, w, id, MONEY, seed);
    if (event !== null) opened.push(event);
  }
  return opened;
}

/** Who an action names: the one acting, and whoever its references name, as today's resolver takes them in. */
function partiesOf(params: Readonly<Record<string, ParamDef>>, actor: string, given: JsonObject): string[] {
  return [
    actor,
    ...Object.entries(params).flatMap(([name, def]) => {
      const named = own(given, name);
      return def.type === "ref" && typeof named === "string" ? [named] : [];
    }),
  ];
}

/**
 * The clock's ✎ (DESIGN §12): the clock set to `local`, a date and time of day as the HUD reads it, local to the player
 * character's place. A later time is one move of the clock, as the engine's own `pass_time` records it (`setClock`,
 * `src/iface/ops-time.ts`): what the time between did to anyone is not decided here, and what fell due in it is the Author's at
 * the next turn, which its world state lists (plan §6.1, §6.4). An earlier time, one that does not read, or a world without its
 * calendar is today's ✎ (`clockFix`): its set-back, or the words it refuses with.
 */
function clockSet(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, local: string, seed: string): LedgerEvent[] {
  const at = clockOfStamp(calendarOf(world), local);
  const to = at === null ? null : at - placeOffset(world, at, placeOfEntity(state, world.pov));
  if (to !== null && to > state.clock && registry.context(world, state).levelOf(world.pov, "calendar") >= 1) return [{ type: "clock", minutes: to - state.clock, cause: "advance" }];
  const fixed = clockFix(registry, world, state, local, seed);
  if ("code" in fixed) throw new Refused("validation", { words: fixed.reason });
  return fixed.events;
}

/** A value as the World page typed it: JSON where it reads as JSON (a number, true, a list), else the text itself; removed, null. */
function typedValue(op: EditOpAsk): JsonValue {
  if (op.op === "remove" || op.value === undefined) return null;
  try {
    return JSON.parse(op.value) as JsonValue;
  } catch {
    return op.value;
  }
}

export class PlayService {
  private readonly runEnds: RunEnds;

  constructor(private readonly deps: PlayDeps) {
    this.runEnds = new RunEnds(deps.live);
  }

  /** The chat's state view at its head, or at `turn`, one of its turns. */
  state(user: string, chat: string, turn: string | null): StateView {
    const row = turn === null ? null : this.deps.store.user(user).turn(turn);
    if (turn !== null && row?.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    // A turn joined to another is answered as a fact, naming the turn it joined, whatever kind of chat this is.
    if (turn !== null && row?.joined != null) throw new JoinedTurnError(turn, row.joined);
    // From now on, a run of the chat that ends tells the page to read it again.
    this.runEnds.follow(chat);
    return chatView({ store: this.deps.store, user, chat, turn, turning: this.deps.turning(user, chat) });
  }

  /** What `turn`'s time brought due, or the chat's newest turn's where none is named (`due.ts`). */
  async due(user: string, chat: string, turn: string | null): Promise<DueRead> {
    const s = this.deps.store.user(user);
    if (s.chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat}.`);
    const at = turn ?? headTurn(s, chat);
    if (at === null) throw new RouteError(404, `Chat ${chat} has no turn yet.`);
    const row = s.turn(at);
    if (row?.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${at}.`);
    if (row.joined != null) throw new JoinedTurnError(at, row.joined);
    return turnDue(this.deps.store, user, at, (await this.deps.settings(user, chat)).dueItems);
  }

  /** A tap on the typed route, recorded as his own edit; a refusal answered in words with nothing changed. */
  async tap(user: string, chat: string, ask: TapAsk): Promise<TapAnswer> {
    try {
      const settings = await this.deps.settings(user, chat);
      const tell = ask.tell ?? null;
      const { kind: _kind, tell: _tell, ...request } = ask;
      const resolve = (head: Head): Resolved => {
        switch (ask.kind) {
          case "action":
            return this.action(head, ask, settings);
          case "fix":
            return this.fix(head, ask.fix, settings);
          case "edit":
            return this.edit(head, ask.ops);
          case "ops":
            return this.ops(head, ask.ops, settings);
        }
      };
      const { undo, advised } = await recordOwnerEdit(this.deps, user, chat, request as unknown as JsonObject, tell, resolve);
      const reports = adviceWords(advised);
      const words = undo === null ? await this.words("changes_nothing") : reports.length > 0 ? await this.words("applied_advised", { reports: reports.join(SENTENCES) }) : "";
      return { applied: undo !== null, reports, undo, words };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return { applied: false, reports: [], undo: null, words: await this.refusalWords(error) };
    }
  }

  /** The Undo of an edit of his by the id its answer gave, on the typed route. */
  async undoEdit(user: string, chat: string, undo: string): Promise<TapAnswer> {
    try {
      const { applied, stays } = await this.undone(user, chat, undo);
      if (applied) stateChanged(this.deps.live, chat);
      return { applied, reports: [], undo: null, words: await this.staysWords(stays) };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return { applied: false, reports: [], undo: null, words: await this.refusalWords(error) };
    }
  }

  /** Answers one of today's requests from a play page, as today's dispatcher answers it, or says it is not served. */
  async act(user: string, chat: string, r: FrontendToBackend): Promise<ResultMessage | ErrorMessage> {
    try {
      switch (r.type) {
        case "lre.action": {
          const settings = await this.deps.settings(user, chat);
          const { undo } = await recordOwnerEdit(this.deps, user, chat, this.cited(r), null, (head) => this.action(head, r, settings));
          return reply(r, "lre.action", { applied: true, pending: false, undo });
        }
        case "lre.fix": {
          const settings = await this.deps.settings(user, chat);
          const { reqId: _reqId, chatId: _chatId, lre: _lre, type: _type, ...fix } = r;
          const { undo } = await recordOwnerEdit(this.deps, user, chat, this.cited(r), null, (head) => this.fix(head, fix as FixAsk, settings));
          return reply(r, "lre.fix", { pending: false, undo });
        }
        case "lre.chat.knowledge": {
          // This chat's own choices, read as GM → This chat and the Engine page read them: RPE keeps none of today's, so each
          // follows what it follows, and no engine of today's is named, as the state view names none. Setting one is not served.
          if (r.knowledge !== undefined || r.narrator !== undefined || r.engine !== undefined || r.tidy !== undefined) throw new Refused("unavailable", { line: "chat_choices" });
          const row = this.deps.store.user(user).chat(chat);
          if (row === null || row.world === null) throw new Refused("not_world_chat", { line: "not_world" });
          return reply(r, "lre.chat.knowledge", { knowledge: null, narrator: null });
        }
        case "lre.chip":
          throw new Refused("unavailable", { line: "plays_now" });
        case "lre.things":
          throw new Refused("unavailable", { line: "things" });
        case "lre.map":
          throw new Refused("unavailable", { line: "map" });
        default:
          throw new Refused("unavailable", { line: "other", fields: { type: r.type } });
      }
    } catch (error) {
      return this.failed(r, error);
    }
  }

  /** Undoes a tap this area recorded, by the id its answer gave, as today's Undo chip is sent; what the world's defaults gave with it that stays, the answer says (`said`). */
  async undo(user: string, chat: string, r: Request<"lre.chip">): Promise<ResultMessage | ErrorMessage> {
    try {
      const { applied, stays } = await this.undone(user, chat, r.chip);
      if (applied) stateChanged(this.deps.live, chat);
      const said = await this.staysWords(stays);
      return reply(r, "lre.chip", { applied, pending: false, ...(said === "" ? {} : { said }) });
    } catch (error) {
      return this.failed(r, error);
    }
  }

  /** Today's message as the cite of the edit it asked for, without its envelope. */
  private cited(r: FrontendToBackend): JsonObject {
    const { lre: _lre, reqId: _reqId, chatId: _chatId, ...request } = r as FrontendToBackend & { chatId?: string };
    return request as unknown as JsonObject;
  }

  /**
   * One of the world's actions, done at once on the head. The world's rules advise (plan §6.1): a requirement the action does not
   * meet, or a payee who is not there, is applied all the same and given back to be kept and answered. What is still refused is a
   * pick that names nothing he may know of, or no one fit to pay, each with its true reason (`unfit.ts`).
   */
  private action({ registry, world, state, seed }: Head, r: ActionAsk, settings: PlaySettings): Resolved {
    // From the palette, a panel or the map with no words, a tap goes with the next message; with words, Send now, a chip or a command, it plays at once.
    const later = (r.source === "palette" || r.source === "map") && (r.text?.trim() ?? "") === "" && r.now !== true;
    if (r.action === TIMELAPSE_ACTION) throw new Refused("unavailable", { line: later ? "next_message" : "plays_now" });
    const action = own(world.actions, r.action) ?? registry.actions.get(r.action);
    if (action === undefined) throw new Refused("not_found", { line: "unknown_action", fields: { action: r.action } });
    if (!playsOffstage(r.action, r, action.mechanical === true)) throw new Refused("unavailable", { line: later ? "next_message" : "plays_now" });
    // A request plays no id the player character can't know of, so a guessed id of someone hidden reads as one that names no one.
    const mayKnow = (id: string): boolean => id === world.pov || canSeeEntity(registry, world, state, world.pov, id);
    const unfit = unfitRef(registry, action, r.params, world, state, mayKnow, undefined, false);
    if (unfit !== null) {
      const why = unfitWords(registry, world, state, unfit, r.text ?? "", unrevealedSecrets(registry, world, state), mayKnow, settings.taps.nameMost);
      throw new Refused("validation", { line: why.line, fields: { action: action.label, ...why.fields } });
    }
    const w = new Working(registry, world, state);
    const advised: Report[] = [];
    const absent = optionalQuery(w.ctx, "economy.offstage_refusal")?.(w.ctx, r.action, r.params, world.pov) ?? optionalQuery(w.ctx, "gear.offstage_refusal")?.(w.ctx, r.action, r.params, world.pov) ?? null;
    if (absent !== null) advised.push({ code: "offstage", values: { why: absent } });
    // What the world gave those the action names opens first, so a sum starts from it. Nothing is drawn for anyone from the
    // world's tables (filling in detail is the GM's and the Author's, plan §6.4), so the resolver is given no seed to draw with.
    const opened = openGiven(registry, w, partiesOf(action.params, world.pov, r.params), seed);
    const res = resolveAction(registry, w, { action, actor: world.pov, params: r.params }, createRng(hashParts(seed, r.action, JSON.stringify(r.params))), { advise: true });
    if (!res.ok && res.failed) throw new Refused("validation", { words: playerReason(res.failed) });
    for (const unmet of res.advised ?? []) advised.push({ code: "requirement", values: { why: playerReason(unmet) } });
    const rejected = res.rejected[0];
    if (rejected !== undefined) throw new Refused("validation", { words: rejected.rejection.reason });
    if (res.events.length === 0) throw new Refused("validation", { line: "changes_nothing" });
    // A standing payment set up here says, when it pays, that it was set up off screen.
    return { opened, advised, events: res.events.map((e) => (e.type === "spawn" && e.entity.kind === "flow" ? { ...e, entity: { ...e.entity, fields: { ...e.entity.fields, [ORIGIN_FIELD]: OFFSTAGE_ORIGIN } } } : e)) };
  }

  /** One of the ✎ forms, under his rules: a locked field is refused, as on today's ✎. A cash ✎ opens only what the world gave. */
  private fix({ registry, world, state, seed }: Head, r: FixAsk, settings: PlaySettings): Resolved {
    const edited = (ops: FixOp[], on: Readonly<WorldState> = state): LedgerEvent[] => {
      const edit = resolveEdit(registry, world, on, ops, { gm: false, runSeed: seed, opened: true });
      if ("rejection" in edit) throw new Refused("validation", { words: edit.rejection.reason });
      return edit.events;
    };
    if ("hint" in r) {
      // The next hint he has earned at a quest log row, opened: his own doing.
      const id = typeof r.hint === "string" ? Object.keys(world.tracks).find((t) => shownTrackId(world, t) === r.hint) : undefined;
      const shown = id === undefined ? null : playerTrack(registry, world, state, world.pov, id);
      const stage = id === undefined ? null : currentStage(world, state, id);
      if (id === undefined || shown === null || stage === null) throw new Refused("validation", { line: "no_quest" });
      if (shown.opened >= shown.hints.length) throw new Refused("validation", { line: "no_hint" });
      return played([{ type: ENGINE_EVENTS.hint, data: { track: id, stage, n: shown.opened + 1 } }]);
    }
    if ("time" in r) {
      if (typeof r.time !== "string") throw new Refused("bad_request", { line: "bad_time" });
      return played(clockSet(registry, world, state, r.time, seed));
    }
    if ("thing" in r) {
      const change = parseItemFix(r.thing);
      if (change === null) throw new Refused("bad_request", { line: "not_thing" });
      return played(edited([{ op: "fix_item", change }]));
    }
    if ("things" in r) {
      // Belongings' changes to his things: all or none, one unit with one Undo, as many as the setting `taps.thingsMost` allows.
      const most = settings.taps.thingsMost;
      const changes = Array.isArray(r.things) ? r.things.map(parseItemFix) : [];
      if (changes.length === 0 || changes.length > most || changes.some((c) => c === null) || typeof r.label !== "string") throw new Refused("bad_request", { line: "things_count", fields: { most } });
      return played(edited((changes as ItemFix[]).map((change): FixOp => ({ op: "fix_item", change }))));
    }
    // A field's ✎. A place fixed so is a real move, through the one move path, and leaves the activity behind; only a place the
    // player character may know, for someone it can see: anything else reads as no place at all, as the ✎ never offered it.
    if (r.field === "place" && (typeof r.value !== "string" || !canSeePlace(registry, world, state, world.pov, r.value) || !canSeeEntity(registry, world, state, world.pov, r.entity))) throw new Refused("validation", { line: "no_place" });
    const set: FixOp = { op: "set", entity: r.entity, field: r.field, value: r.value };
    const was = own(state.entities, r.entity);
    const doing = was?.fields.activity;
    const moved = r.field === "place" && r.value !== was?.fields.place;
    const ops: FixOp[] = moved && doing !== undefined && doing !== "idle" ? [set, { op: "set", entity: r.entity, field: "activity", value: "idle" }] : [set];
    if (r.field !== "cash") return played(edited(ops));
    // Cash corrected is measured from what the world gave them, which opens first as the world's own, not inside his correction.
    const w = new Working(registry, world, state);
    const opened = openGiven(registry, w, [r.entity], seed);
    return { opened, events: edited(ops, w.state) };
  }

  /**
   * The World page's edit, all or none: a value set or removed on someone or something (through the engine's set), on a place of the
   * chat's own world (as the chat's draft writes a place), or the world's time; a fact set at a level, with how exact and how sure he
   * says it is. A fact is replaced by a newer one, never removed, and a level that names nothing he may know of is refused.
   */
  private edit({ registry, world, state, seed }: Head, asked: readonly EditOpAsk[]): Resolved {
    const w = new Working(registry, world, state);
    const store: NonNullable<Resolved["store"]> = [];
    for (const op of asked) {
      if (op.as === "fact") {
        if (op.op === "remove") throw new Refused("validation", { line: "fact_remove", fields: { key: op.key } });
        if (!FACT_ABOUT.test(op.at) || op.value === undefined) throw new Refused("validation", { line: "edit_at", fields: { at: op.at } });
        const fact = factStore.change({ about: op.at, key: op.key, value: op.value });
        store.push({ op: fact.op, value: fact.value, ...(op.precision !== undefined ? { precision: op.precision } : {}), ...(op.standing !== undefined ? { standing: op.standing } : {}) });
        continue;
      }
      const value = typedValue(op);
      let events: LedgerEvent[];
      if (op.at === "world" && (op.key === "time" || op.key === "clock") && typeof value === "string") events = clockSet(registry, world, w.state, value, seed);
      else if (op.at.startsWith("entity:") && canSeeEntity(registry, world, w.state, world.pov, op.at.slice(7))) {
        const edit = resolveEdit(registry, world, w.state, [{ op: "set", entity: op.at.slice(7), field: op.key, value }], { gm: false, runSeed: seed, opened: true });
        if ("rejection" in edit) throw new Refused("validation", { words: edit.rejection.reason });
        events = edit.events;
      } else if (op.at.startsWith("place:") && canSeePlace(registry, world, w.state, world.pov, op.at.slice(6)) && safeKey(op.key)) {
        const id = op.at.slice(6);
        const def = own(w.ctx.world.places, id);
        if (def === undefined) throw new Refused("validation", { line: "edit_at", fields: { at: op.at } });
        const fields: JsonObject = { ...def.fields };
        if (value === null) delete fields[op.key];
        else fields[op.key] = value;
        events = [draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), { collection: "places", id, value: { ...(def as unknown as JsonObject), fields } })];
      } else throw new Refused("validation", { line: "edit_at", fields: { at: op.at } });
      const bad = events.map((e) => w.apply(e)).find((r) => r !== null);
      if (bad) throw new Refused("validation", { words: bad.reason });
    }
    return { opened: [], events: w.events, store };
  }

  /** An edit of operations, as the economy's "Make this a property" sends it: all or none, locked fields writable, as many as `engine.editOps` allows. */
  private ops({ registry, world, state, seed }: Head, ops: readonly JsonValue[], settings: PlaySettings): Resolved {
    if (ops.length === 0 || ops.length > settings.editOps) throw new Refused("bad_request", { line: "edit_ops_count", fields: { most: settings.editOps } });
    const edit = resolveEdit(registry, world, state, ops as unknown as FixOp[], { gm: true, runSeed: seed, opened: true });
    if ("rejection" in edit) throw new Refused("validation", { words: edit.rejection.reason });
    return played(edit.events);
  }

  /**
   * Records the reversal of his changes of an edit, each unit the last first, in one write: all of them or none, so an Undo never
   * leaves half of what he did. A unit that would leave a part of his (one written since, or one the store keeps no reverse for) takes
   * the whole write back, and the answer says which. What the world's defaults gave with the edit is reversed with his unit it is in,
   * where the store keeps a reverse for it, and else stays. Whether anything was recorded (nothing once the edit is undone), and the
   * world's changes that stay. Nothing is recorded while a turn of the chat runs.
   */
  private undone(user: string, chat: string, undo: string): Promise<{ applied: boolean; stays: ChangeRow[] }> {
    const s = this.deps.store.user(user);
    return this.deps.writes.run(() => {
      const { turn = "", edit = "" } = editId(undo) ?? {};
      // An edit of a turn joined to another is answered as a fact, naming the turn it joined.
      const held = s.turn(turn);
      if (held?.chat === chat && held.joined !== null) throw new JoinedTurnError(turn, held.joined);
      const all = s.turn(turn)?.chat === chat ? s.changes(turn).filter((c) => isRecord(c.cite) && c.cite.tap === edit) : [];
      const mine = all.filter((c) => c.source === PLAYER);
      if (mine.length === 0) throw new Refused("not_found", { line: "no_undo" });
      if (this.deps.turning(user, chat)) throw new Refused("conflict", { line: "turn_running" });
      const path = s.path(chat);
      const from = path.findIndex((e) => e.turn === turn);
      if (from < 0) throw new Refused("conflict", { line: "off_path" });
      // Undone already where the chat's story now goes: a change from its turn on cites one of the edit's as the one it undoes.
      const ids = new Set(mine.map((c) => c.id));
      const since = path.slice(from).flatMap((e) => (e.turn === null ? [] : s.changes(e.turn)));
      if (since.some((c) => isRecord(c.cite) && typeof c.cite.undoes === "number" && ids.has(c.cite.undoes))) return { applied: false, stays: [] };
      // The store undoes a change with the rest of its unit: one change of each unit is enough.
      const units = new Map<string, number>();
      for (const c of mine) if (!units.has(unitOf(c))) units.set(unitOf(c), c.id);
      let recorded = 0;
      const left: Report[] = [];
      for (const id of [...units.values()].reverse()) {
        const out = s.undo(id, PLAYER);
        recorded += out.changes.length;
        left.push(...out.left);
      }
      // Refused inside the write, which takes back what the units before recorded.
      if (left.some((l) => l.code === "changed_since")) throw new Refused("conflict", { line: "changed_since" });
      const leftIds = new Set(left.map((l) => l.values?.change));
      const unreversed = mine.filter((c) => leftIds.has(c.id));
      if (unreversed.length > 0) throw new Refused("conflict", { line: "no_undo_for", codes: { parts: unreversed.map((c) => c.op) } });
      const stays = all.filter((c) => !ids.has(c.id) && (!units.has(unitOf(c)) || leftIds.has(c.id)));
      return { applied: recorded > 0, stays: recorded > 0 ? stays : [] };
    }, "undoing an edit of his");
  }

  /** Each kind of the world's change that stays after an Undo, once, in the words of its own line. */
  private async staysWords(stays: readonly ChangeRow[]): Promise<string> {
    return (await Promise.all([...new Set(stays.flatMap((c) => own(STAYS, c.op) ?? []))].map((line) => this.words(line)))).filter((s) => s !== "").join(SENTENCES);
  }

  private async refusalWords(error: Refused): Promise<string> {
    return "words" in error.why ? error.why.words : await this.words(error.why.line, error.why.fields, error.why.codes);
  }

  private async failed(r: FrontendToBackend, error: unknown): Promise<ErrorMessage> {
    // A turn joined to another is a fact the server answers in its one place, not a failure of this page's request.
    if (error instanceof JoinedTurnError) throw error;
    const fail = (code: ErrorCode, message: string): ErrorMessage => ({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: r.reqId, code, message });
    if (error instanceof Refused) return fail(error.code, await this.refusalWords(error));
    const message = error instanceof Error ? error.message : String(error);
    this.deps.log.error("A play page's request failed inside RPE.", { request: r.type, error: message });
    return fail("internal", message);
  }

  /** A line of this area's words, filled with `fields` and with `codes` in the file's words for them (`keys`), each once; none when the user deleted the line. */
  private async words(line: string, fields: Record<string, unknown> = {}, codes: Readonly<Record<string, readonly string[]>> = {}): Promise<string> {
    const what = `.prompts/${PLAY_ANSWERS}.md`;
    const part = readPart(await readFile(join(this.deps.guidance, ".prompts", `${PLAY_ANSWERS}.md`), "utf8"), what);
    const said = Object.fromEntries(Object.entries(codes).map(([name, list]) => [name, [...new Set(list.map((code) => own(part.keys, code) ?? code))]]));
    return part.lines.get(line)?.render(part.header, { ...fields, ...said }) ?? "";
  }
}
