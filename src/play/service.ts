// A chat's play panels, served by RPE (plan §14: today's panels kept, re-pointed to RPE): the chat's
// state view, read from RPE's store; what a turn's time brought due; and the taps that manage (money, a
// group, gear, with no words), each ✎ correction, an edit of operations ("Make this a property"), the
// World page's edit of values and facts and the HUD's time controls (Pause clock, Resume clock), each
// recorded as his own edit through the one owner's-edit path (`owner-edits.ts`) on its typed route. A tap
// records what he did and nothing code made up (plan §6.1, §6.4): nothing is drawn from the world's
// tables, and the clock's ✎ moves the clock without deciding what the time between did. The world's rules
// advise rather than refuse (plan §6.1): a requirement the world's action does not meet, or a payee who is
// not there, is applied with what does not add up kept beside it and answered. What is still refused
// (§6.1: an id that does not exist or that his character cannot know of, input that cannot be parsed)
// says its true reason, case by case (`unfit.ts`). An Undo, by the edit's own id, records the reversal of
// all of an edit's changes, the world's defaults given with it included (`UserStore.undo`), or of none and
// says why. A tap that is no tap that manages is a request of his to the Author (plan §10.10): from the
// palette, the map or a panel with no words it waits for his next message (`requests.ts`), and the same
// tap again takes it back; with words, a chip, Send now or a Timelapse with words it plays now, its line
// put in the chat as his message and a reply started through Lumiverse's own routes as him, nothing
// written into the message's or the chat's metadata. The chat's own choices are its settings, read and
// written through the settings routes. Every word is a line of `.prompts/play-answers.md`. After each
// change the chat's followers are told its state changed.

import type { Database } from "bun:sqlite";
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
import { applyMarker, TIME_CONTROLS, validMarkerBody } from "../engine/events";
import { clockFix, pauseBookkeeping } from "../engine/time";
import { currentStage } from "../engine/tracks";
import { canSeeEntity, canSeePlace, playerTrack, shownTrackId, unrevealedSecrets } from "../engine/visibility";
import { Working } from "../engine/working";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import type { Writes as LumiverseWrites } from "../adapter/lumiverse/writes";
import { hasLedger } from "../packs/economy/core/model";
import { hashParts } from "../shared/hash";
import { isRecord, type JsonObject, type JsonValue, safeKey } from "../shared/json";
import type { FixOp, LedgerEvent, MarkerBody } from "../shared/ledger";
import { OFFSTAGE_ORIGIN, ORIGIN_FIELD, playsOffstage } from "../shared/offstage";
import type { ErrorCode } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import type { MapConfig } from "../shared/map-config";
import { type ItemFix, parseItemFix } from "../shared/things";
import { formatMoney, type ParamDef, type WorldDoc } from "../shared/world";
import { type ChangeRow, factStore, JoinedTurnError, type Part, readPart, type Report, type Store } from "../store";
import { FACT_ABOUT } from "../store/facts";
import { STORE_OPS } from "../store/types";
import { type DueRead, type Say, turnDue } from "./due";
import { RunEnds, stateChanged } from "./live";
import type { PanelAsk, RequestRecord, Requests, TapFrom } from "../turn/requests";
import { editId, type Head, headOf, PLAYER, recordOwnerEdit, Refused, type Resolved } from "./owner-edits";
import { type GuidanceFiles, withHistoryLines } from "../iface";
import { journalNotes } from "./journal";
import { chipsOf, meterOf, pendingOf } from "./panel-reads";
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

/** What one answer says in more than one line of this area's words, those lines joined by this. */
const SENTENCES = " ";

/** The settings a chat's taps read, as the chat's levels set them. */
export interface PlaySettings {
  /** The most things falling due a list gives (`engine.maxDueItems`). */
  dueItems: number;
  /** The most operations one edit of operations carries (`engine.maxEditOps`). */
  editOps: number;
  taps: TapSettings;
  /** The chat's map settings (`map:` in its config), which the map panel is drawn at. */
  map: MapConfig;
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
  /** The guidance files in force for a chat, whose history lines (`.prompts/history-*.md`, each the nearest level's) the engine's lines of the chat are worded in. */
  texts(user: string, chat: string): Pick<GuidanceFiles, "read">;
  /** Whether a turn of the user's chat runs now. */
  turning(user: string, chat: string): boolean;
  /** The chat's settings the taps and reads take. */
  settings(user: string, chat: string): Promise<PlaySettings>;
  /** What he asks for beside his words: a panel's tap held for his next message, or kept as played now with the message it was sent as. */
  requests: Requests;
  /** Lumiverse's own routes as him, which put a tap's line in the chat as his message and start the reply. */
  lumiverse(): Pick<LumiverseWrites, "appendMessage" | "startGeneration">;
  /** Writes one setting at the chat's level of his config (null takes the key away there), as the Settings page writes it. */
  writeChatSetting(chat: string, key: string, value: JsonValue): Promise<void>;
  /** The application's database: the runs' usage, the questions waiting on his word and the carried chips (`panel-reads.ts`). */
  db: Database;
  log: Log;
}

/** The status a refusal of a tap's own route is answered with, by its code. */
const REFUSED_STATUS: Readonly<Record<ErrorCode, number>> = { bad_request: 400, not_found: 404, not_world_chat: 404, conflict: 409, paused: 409, validation: 422, forbidden: 403, unavailable: 409, internal: 500 };

/** A panel's tap that is no tap that manages: its action, its values, and where it was made. */
export interface PanelTap {
  action: string;
  values: JsonObject;
  from: TapFrom;
}

/** What a tap played now came to: the message his line went into the chat as, the generation that answers it, and the request kept with it. */
export interface Played {
  message: string;
  generation: string;
  request: string;
}

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

/** Where a tap was made, as a request keeps it; a source of no such place (an older page's) is a chip's, a tap that plays now. */
function tapFrom(source: string): TapFrom {
  return source === "palette" || source === "map" || source === "panel" || source === "send-now" || source === "command" ? source : "chip";
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

  /**
   * The chat's state view at its head, or at `turn`, one of its turns: its controls preset by the chat's out-of-play settings, its
   * knowledge choices and tidy-up switch, its map drawn at the chat's map settings, the Journal's notes of its newest turns
   * (`journal.ts`, a report's code in this area's words), and the chips, meter, reply clocks and pending marks (`panel-reads.ts`).
   */
  async state(user: string, chat: string, turn: string | null): Promise<StateView> {
    const s = this.deps.store.user(user);
    const row = turn === null ? null : s.turn(turn);
    if (turn !== null && row?.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    // A turn joined to another is answered as a fact, naming the turn it joined, whatever kind of chat this is.
    if (turn !== null && row?.joined != null) throw new JoinedTurnError(turn, row.joined);
    const { taps, map } = await this.deps.settings(user, chat);
    const keys = (await this.part()).keys;
    const journal = await withHistoryLines(this.deps.texts(user, chat), () => journalNotes(this.deps.store, user, chat, taps.journalMost, (code) => own(keys, code) ?? code));
    const turning = this.deps.turning(user, chat);
    const { db } = this.deps;
    const knowledge = { ...taps.choices, chat: { ...taps.choices.chat, ...(taps.tidy.on === null ? {} : { tidy: taps.tidy.on }) } };
    // From now on, a run of the chat that ends tells the page to read it again.
    this.runEnds.follow(chat);
    return chatView({
      store: this.deps.store,
      user,
      chat,
      turn,
      turning,
      offstage: taps.tell,
      map,
      knowledge,
      journal,
      chips: chipsOf(db, s, user, chat),
      meter: meterOf(db, user, chat, taps.meterTurns),
      pending: turning ? pendingOf(db, s, user, chat) : [],
      clocksMost: taps.clocksMost,
    });
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
    const part = await this.part();
    const say: Say = (line, fields = {}) => part.lines.get(line)?.render(part.header, fields) ?? "";
    return turnDue(this.deps.store, user, at, (await this.deps.settings(user, chat)).dueItems, say);
  }

  /** A tap on the typed route, recorded as his own edit; a refusal answered in words with nothing changed. */
  async tap(user: string, chat: string, ask: TapAsk): Promise<TapAnswer> {
    try {
      // A tap of an action that does not manage is a request of his to the Author: held, taken back, or played now.
      if (ask.kind === "action" && (await this.requested(user, chat, ask)) !== undefined) return { applied: true, reports: [], undo: null, words: "" };
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

  /** The Undo of an edit of his by its own id, on the typed route: at once, whatever runs. */
  async undoEdit(user: string, chat: string, edit: string): Promise<TapAnswer> {
    try {
      const { done, left } = await this.undone(user, chat, edit);
      if (done) stateChanged(this.deps.live, chat);
      return { applied: done, reports: [], undo: null, words: left.length > 0 ? await this.leftWords(left, done) : "" };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return { applied: false, reports: [], undo: null, words: await this.refusalWords(error) };
    }
  }

  /**
   * The HUD's time controls on their typed route (Pause clock, Resume clock, and the other controls today's time marker carries), each
   * his own edit at once; a refusal is answered in words with nothing changed.
   */
  async time(user: string, chat: string, ask: { control: string; scope: JsonValue; to: JsonValue }): Promise<TapAnswer> {
    try {
      const body = validMarkerBody({ kind: "time", control: ask.control, scope: ask.scope, to: ask.to });
      if (body === null || body.kind !== "time" || !TIME_CONTROLS.some((c) => c === body.control)) throw new Refused("bad_request", { line: "bad_marker" });
      const { undo } = await recordOwnerEdit(this.deps, user, chat, { kind: "time", ...ask } as unknown as JsonObject, null, (head) => this.timeMarker(head, body));
      return { applied: undo !== null, reports: [], undo, words: undo === null ? await this.words("changes_nothing") : "" };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return { applied: false, reports: [], undo: null, words: await this.refusalWords(error) };
    }
  }

  /**
   * A tap of one of the world's actions that is no tap that manages (plan §10.10), as a request of his to the Author: from the palette,
   * the map or a panel with no words and no Send now, held for his next message (`held` null: the same tap again took it back); with
   * words, a chip, a command or Send now, played now. Undefined for a tap that manages, which is recorded as his edit.
   */
  private async requested(user: string, chat: string, r: ActionAsk & { offstage?: boolean }): Promise<{ held: RequestRecord | null } | Played | undefined> {
    const { registry, world } = headOf(this.deps.store, user, chat);
    const action = r.action === TIMELAPSE_ACTION ? undefined : (own(world.actions, r.action) ?? registry.actions.get(r.action));
    if (action !== undefined && playsOffstage(r.action, r, action.mechanical === true)) return undefined;
    const from = tapFrom(r.source);
    const tap: PanelTap = { action: r.action, values: r.params, from };
    const words = r.text?.trim() ?? "";
    if ((from === "palette" || from === "map" || from === "panel") && words === "" && r.now !== true) return { held: await this.hold(user, chat, tap) };
    return await this.playNow(user, chat, { tap, words });
  }

  /** A panel's tap for his next message, on its own route: held, or taken back (null); a refusal is answered with its status and words. */
  async holdTap(user: string, chat: string, tap: PanelTap): Promise<{ request: RequestRecord | null }> {
    return { request: await this.routed(() => this.hold(user, chat, tap)) };
  }

  /** A tap that plays now, or a request that waits sent now, on its own route; a refusal is answered with its status and words. */
  async playTap(user: string, chat: string, ask: { tap: PanelTap; words: string } | { request: string }): Promise<Played> {
    return await this.routed(() => this.playNow(user, chat, ask));
  }

  private async routed<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      throw new RouteError(REFUSED_STATUS[error.code], await this.refusalWords(error));
    }
  }

  /** A panel's tap held for his next message, in place of one that waited; the same tap again takes it back, and the answer is null. */
  private async hold(user: string, chat: string, tap: PanelTap): Promise<RequestRecord | null> {
    const asked = await this.pressed(user, chat, tap, "");
    const same = this.deps.requests.waiting(user, chat).find((w) => w.kind === "panel" && (w.asked as PanelAsk).action === asked.action && JSON.stringify((w.asked as PanelAsk).values) === JSON.stringify(asked.values));
    if (same !== undefined) {
      await this.deps.requests.withdraw(user, chat, same.id);
      return null;
    }
    return await this.deps.requests.hold(user, chat, { kind: "panel", asked }, Date.now());
  }

  /**
   * A tap played now (plan §10.10, §4.2): its line, the words typed or else what was pressed, put in the chat as his message, text only,
   * and the reply started, both through Lumiverse's own routes as him; nothing is written into the message's or the chat's metadata. The
   * request is kept as played now with that message, so the turn that answers it is told what was pressed and its values. A request that
   * waits (Send now) is played so, and waits no more.
   */
  private async playNow(user: string, chat: string, ask: { tap: PanelTap; words: string } | { request: string }): Promise<Played> {
    let asked: PanelAsk;
    let words = "";
    if ("request" in ask) {
      const waits = this.deps.requests.waiting(user, chat).find((w) => w.id === ask.request && w.kind === "panel");
      if (waits === undefined) throw new Refused("not_found", { line: "no_request", fields: { request: ask.request } });
      asked = waits.asked as PanelAsk;
    } else {
      asked = await this.pressed(user, chat, ask.tap, ask.words);
      words = ask.words.trim();
    }
    const lumiverse = this.deps.lumiverse();
    const message = await lumiverse.appendMessage(user, chat, words !== "" ? words : asked.what);
    const sent = "request" in ask ? await this.deps.requests.played(user, chat, ask.request, message.id) : null;
    const kept = sent ?? (await this.deps.requests.hold(user, chat, { kind: "panel", asked, played: true, message: message.id }, Date.now()));
    const generation = await lumiverse.startGeneration(user, chat, {});
    return { message: message.id, generation, request: kept.id };
  }

  /**
   * What was pressed and on what, in the world's own words: the action's label, and the names of what was picked (an amount of money as
   * the world prints it; a square of the grid with the place whose grid it is); a Timelapse by the label it was sent with among its values.
   * An unknown action is not there, and an id his character cannot know of names no one (`unfit.ts`).
   */
  private async pressed(user: string, chat: string, tap: PanelTap, text: string): Promise<PanelAsk> {
    const { registry, world, state } = headOf(this.deps.store, user, chat);
    const ask = (what: string, on: string[], values: JsonObject = tap.values): PanelAsk => ({ action: tap.action, values, from: tap.from, what, on: on.length > 0 ? on.join(", ") : null });
    if (tap.action === TIMELAPSE_ACTION) {
      const label = tap.values.label;
      return ask(typeof label === "string" && label.trim() !== "" ? label.trim() : tap.action, []);
    }
    const action = own(world.actions, tap.action) ?? registry.actions.get(tap.action);
    if (action === undefined) throw new Refused("not_found", { line: "unknown_action", fields: { action: tap.action } });
    // A request plays no id the player character can't know of, so a guessed id of someone hidden reads as one that names no one.
    const mayKnow = (id: string): boolean => id === world.pov || canSeeEntity(registry, world, state, world.pov, id);
    const unfit = unfitRef(registry, action, tap.values, world, state, mayKnow, undefined, false);
    if (unfit !== null) {
      const why = unfitWords(registry, world, state, unfit, text, unrevealedSecrets(registry, world, state), mayKnow, (await this.deps.settings(user, chat)).taps.nameMost);
      throw new Refused("validation", { line: why.line, fields: { action: action.label, ...why.fields } });
    }
    const nameOf = (id: string): string => own(state.entities, id)?.name ?? own(world.places, id)?.name ?? id;
    // A square of the grid he stands on is named with the place whose grid it is.
    const square = action.params.x?.type === "number" && action.params.y?.type === "number" && typeof tap.values.x === "number" && typeof tap.values.y === "number";
    const here = square ? placeOfEntity(state, world.pov) : null;
    const picked = Object.entries(tap.values).flatMap(([key, v]) => {
      if (typeof v === "number") return [own(action.params, key)?.type === "money" ? formatMoney(v, world.currency) : String(v)];
      return typeof v === "string" && v !== "" ? [nameOf(v)] : [];
    });
    // An amount of money is kept as the world prints it, so the Author, who carries the press out with `act`, reads it as the world's own coin and not as the smallest unit.
    const values = Object.fromEntries(Object.entries(tap.values).map(([key, v]) => [key, own(action.params, key)?.type === "money" && typeof v === "number" ? formatMoney(v, world.currency) : v]));
    return ask(action.label, here === null ? picked : [nameOf(here), ...picked], values);
  }

  /**
   * One of the world's actions that manages, done at once on the head (a tap that does not manage is a request: `requested`). The
   * world's rules advise (plan §6.1): a requirement the action does not meet, or a payee who is not there, is applied all the same and
   * given back to be kept and answered. What is still refused is a pick that names nothing he may know of, or no one fit to pay, each
   * with its true reason (`unfit.ts`).
   */
  private action({ registry, world, state, seed }: Head, r: ActionAsk, settings: PlaySettings): Resolved {
    const action = own(world.actions, r.action) ?? registry.actions.get(r.action);
    if (action === undefined) throw new Refused("not_found", { line: "unknown_action", fields: { action: r.action } });
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
      // Belongings' changes to his things: all or none, as many as the setting `taps.maxThingsPerFix` allows, with one Undo. Each thing's change
      // is resolved on the state the one before left and is a unit of its own, so an Undo that cannot take one back (something changed it
      // since) still takes back the others and says which stayed.
      const most = settings.taps.thingsMost;
      const changes = Array.isArray(r.things) ? r.things.map(parseItemFix) : [];
      if (changes.length === 0 || changes.length > most || changes.some((c) => c === null) || typeof r.label !== "string") throw new Refused("bad_request", { line: "things_count", fields: { most } });
      const w = new Working(registry, world, state);
      const events: LedgerEvent[] = [];
      for (const [i, change] of (changes as ItemFix[]).entries()) {
        const made = edited([{ op: "fix_item", change }], w.state);
        const bad = made.map((e) => w.apply(e)).find((rejected) => rejected !== null);
        if (bad) throw new Refused("validation", { words: bad.reason });
        const group = `thing:${hashParts(seed, String(i)).slice(0, 12)}`;
        events.push(...made.map((e): LedgerEvent => ({ ...e, group })));
      }
      return played(events);
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
    // Cash set on someone is measured from what the world gave them, which opens first as the world's own, not inside his edit.
    const opened: LedgerEvent[] = [];
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
        if (op.key === "cash") opened.push(...openGiven(registry, w, [op.at.slice(7)], seed));
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
    return { opened, events: w.events.filter((e) => !opened.includes(e)), store };
  }

  /** An edit of operations, as the economy's "Make this a property" sends it: all or none, locked fields writable, as many as `engine.maxEditOps` allows. */
  private ops({ registry, world, state, seed }: Head, ops: readonly JsonValue[], settings: PlaySettings): Resolved {
    if (ops.length === 0 || ops.length > settings.editOps) throw new Refused("bad_request", { line: "edit_ops_count", fields: { most: settings.editOps } });
    // Each holder whose cash an op sets has what the world gave them opened first, as the world's own, so the sum starts from it.
    const w = new Working(registry, world, state);
    const holders = ops.flatMap((o) => (isRecord(o) && o.op === "set" && o.field === "cash" && typeof o.entity === "string" ? [o.entity] : []));
    const opened = openGiven(registry, w, holders, seed);
    const edit = resolveEdit(registry, world, w.state, ops as unknown as FixOp[], { gm: true, runSeed: seed, opened: true });
    if ("rejection" in edit) throw new Refused("validation", { words: edit.rejection.reason });
    return { opened, events: edit.events };
  }

  /**
   * A time control of his, recorded as today's time marker (the HUD's Pause clock and Resume clock among them): a pause holds the
   * clock in the scene it is pressed in and is lifted by a change of scene (DESIGN §9.2), so it is pinned to that scene at once, as
   * today's turn pinned it, and a resume clears the pin.
   */
  private timeMarker({ world, state }: Head, body: Extract<MarkerBody, { kind: "time" }>): Resolved {
    const after = structuredClone(state) as WorldState;
    applyMarker(after, body);
    const pin = pauseBookkeeping(world, after).map((e) => ({ op: e.type, value: e as unknown as JsonValue }));
    return { opened: [], events: [], store: [{ op: STORE_OPS.marker, value: body as unknown as JsonValue }, ...pin] };
  }

  /**
   * Records the reversal of every change of an edit (his own, and what the world's defaults gave with it), each unit the last first,
   * in one write. What is taken back is taken back; a part a later change has written since, and a part the store keeps no reverse
   * for, are left as they are and said by name (`left`), never the reason to refuse the rest. Only when nothing at all can be
   * taken back is nothing recorded, and the answer says what stayed and why. A reversal the world does not take is a fault, and the write fails with
   * it, taking back what the units before recorded. Whether anything was recorded: nothing, for an edit undone already. It finds the
   * edit among his own changes of the chat, which keep their place whatever turns left the path since, and waits for no run.
   */
  private undone(user: string, chat: string, undo: string): Promise<{ done: boolean; left: readonly Report[] }> {
    const s = this.deps.store.user(user);
    const edit = editId(undo);
    return this.deps.writes.run(() => {
      const own = s.ownerChanges(chat);
      const all = own.filter((c) => isRecord(c.cite) && c.cite.tap === edit);
      if (all.length === 0) throw new Refused("not_found", { line: "no_undo" });
      // Undone already: a change of his cites one of the edit's as the one it undoes.
      const ids = new Set(all.map((c) => c.id));
      if (own.some((c) => isRecord(c.cite) && typeof c.cite.undoes === "number" && ids.has(c.cite.undoes))) return { done: false, left: [] };
      // The store undoes a change with the rest of its unit: one change of each unit is enough.
      const units = new Map<string, number>();
      for (const c of all) if (!units.has(unitOf(c))) units.set(unitOf(c), c.id);
      const { changes, left } = s.undo([...units.values()].reverse(), PLAYER);
      if (changes.some((c) => !c.applied)) throw new Refused("conflict", { line: "undo_not_applied" });
      // What stayed is named by what it was done to, as the world calls it now.
      const entities = s.headState(chat).state.world.entities;
      const named = left.map((l): Report => {
        const value = own.find((c) => c.id === l.values?.change)?.value;
        const data = isRecord(value) && isRecord(value.data) ? value.data : {};
        const about = isRecord(value) ? [value.entity, value.from, data.entity] : [];
        const id = about.find((x): x is string => typeof x === "string");
        const name = id === undefined ? undefined : entities[id]?.name;
        return name === undefined ? l : { ...l, values: { ...l.values, on: name } };
      });
      return { done: changes.length > 0, left: named };
    }, "undoing an edit of yours");
  }

  /**
   * What an Undo that left something says: whether it took back none or took back some, and each part that stayed, by its kind and what it
   * was done to, with why (each in this area's words).
   */
  private async leftWords(left: readonly Report[], took: boolean): Promise<string> {
    const lines = [await this.words(took ? "undone_some" : "undone_none")];
    for (const l of left) {
      const said = await this.words(l.code === "changed_since" ? "undone_left_changed" : "undone_left_kept", typeof l.values?.on === "string" ? { on: l.values.on } : {}, { parts: [String(l.values?.op ?? "")] });
      lines.push(said.charAt(0).toUpperCase() + said.slice(1));
    }
    return [...new Set(lines)].filter((line) => line !== "").join(SENTENCES);
  }

  private async refusalWords(error: Refused): Promise<string> {
    return "words" in error.why ? error.why.words : await this.words(error.why.line, error.why.fields, error.why.codes);
  }

  /** This area's words as the guidance folder holds them now (`.prompts/play-answers.md`). */
  private async part(): Promise<Part> {
    return readPart(await readFile(join(this.deps.guidance, ".prompts", `${PLAY_ANSWERS}.md`), "utf8"), `.prompts/${PLAY_ANSWERS}.md`);
  }

  /** A line of this area's words, filled with `fields` and with `codes` in the file's words for them (`keys`), each once; none when the user deleted the line. */
  private async words(line: string, fields: Record<string, unknown> = {}, codes: Readonly<Record<string, readonly string[]>> = {}): Promise<string> {
    const part = await this.part();
    const said = Object.fromEntries(Object.entries(codes).map(([name, list]) => [name, [...new Set(list.map((code) => own(part.keys, code) ?? code))]]));
    return part.lines.get(line)?.render(part.header, { ...fields, ...said }) ?? "";
  }
}
