// A chat's play panels, served by RPE (plan §14: today's panels kept, re-pointed to RPE): the chat's
// state view, read from RPE's store, and today's panel actions as a page sends them (plan §10.10). A
// tap that manages (money, a group, gear, with no words: today's `lre.action` done off screen, and
// each `lre.fix`) is resolved with today's pure resolvers and recorded in RPE's store as the player's
// own changes on the chat's newest turn, the turn the next one follows: the next turn's world state
// shows their values and lists them among what the turn before changed. A tap records what the player
// did and nothing code made up (plan §6.1, §6.4): nothing is drawn from the world's tables; what the
// world's defaults give with it is recorded apart from the player's own changes, from those defaults
// and as assumed, as the engine's own tools record it: the accounts the world gave those it names,
// opened first, each a change of its own, and the economy's bookkeeping for someone it keeps no
// accounts for, in the unit it came in; and the clock's ✎ moves the clock without deciding what the
// time between did. While a turn of the chat runs, a tap and an Undo wait for it to be over (plan
// §10.9: no turn has its starting state changed under it). An Undo records the reversal of all of the
// player's changes of a tap (`UserStore.undo`), or of none and says what has no undo; what the world's
// defaults gave with it that the store keeps no reverse for stays, and its answer says so. A chat's own
// choices (today's `lre.chat.knowledge`) read as RPE has them: it keeps none. A tap that goes with the
// next message, a tap that plays now, setting a chat's own choice, the things browser and the map's
// walk and display are not served here, and say so in words from `.prompts/play-answers.md`. After
// each change the chat's followers are told its state changed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { type LiveHub, RouteError, type WriteQueue } from "../app";
import { playerReason } from "../backend/requirement-words";
import { unfitRef } from "../backend/turn-steps";
import { TIMELAPSE_ACTION } from "../backend/view";
import { calendarOf, clockOfStamp, placeOffset } from "../engine/calendar";
import { resolveEdit } from "../engine/edits";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { materializeIfNeeded } from "../engine/materialize";
import { optionalQuery, own } from "../engine/pack-kit";
import { playedWorld } from "../engine/places-in-play";
import type { Registry } from "../engine/registry-impl";
import { resolveAction } from "../engine/resolve";
import { createRng } from "../engine/rng";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { clockFix } from "../engine/time";
import { currentStage } from "../engine/tracks";
import { canSeeEntity, canSeePlace, findLeaks, playerTrack, shownTrackId, unrevealedSecrets } from "../engine/visibility";
import { Working } from "../engine/working";
import { FILLED_IN } from "../iface/source";
import { bookkeeping } from "../iface/writing";
import { hasLedger } from "../packs/economy/core/model";
import { hashParts } from "../shared/hash";
import { FINANCE_EVENTS } from "../shared/finance";
import { isRecord, type JsonObject, type JsonValue } from "../shared/json";
import type { FixOp, LedgerEvent } from "../shared/ledger";
import { OFFSTAGE_ORIGIN, ORIGIN_FIELD, playsOffstage } from "../shared/offstage";
import { type ErrorCode, type ErrorMessage, FIX_THINGS_MAX, type FrontendToBackend, PROTOCOL_VERSION, type ResultBodies, type ResultMessage } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import { type ItemFix, parseItemFix } from "../shared/things";
import type { ParamDef, WorldDoc } from "../shared/world";
import { type ChangeInput, type ChangeRow, JoinedTurnError, readPart, type Report, type Store } from "../store";
import { RunEnds, stateChanged } from "./live";
import { chatView, headTurn } from "./view";

/** The prompt part this area's words are in, under the guidance folder's `.prompts/`. */
export const PLAY_ANSWERS = "play-answers";

/** Who a change from a panel is by, and where it came from. */
const PLAYER = "player";

/** What every draw of a tap is seeded from, with the chat and the tap: each tap draws on its own. */
const SEED = "rpe.play";

/** The id a tap's Undo takes: `tap:<turn>:<tap>`. */
const UNDO_ID = /^tap:([^:]+):([^:]+)$/;

/** The economy's domain, whose materializer opens the accounts the world gave a party that holds some. */
const MONEY = "money";

/** How what the world's defaults give with a tap is recorded: as the engine's own tools record what they fill in. */
const DEFAULTS: Pick<ChangeInput, "source" | "standing" | "precision"> = { source: FILLED_IN.source?.from ?? null, standing: FILLED_IN.standing, precision: FILLED_IN.precision };

/**
 * The line of this area's words that says a change of the world's stays after an Undo, by its operation: the accounts the world
 * gave, opened, and what the economy takes someone it keeps no accounts for to be worth (the rest of its bookkeeping, the band a
 * payment moved them to, is reversed with the payment).
 */
const STAYS: Readonly<Record<string, string>> = { materialize: "opened_stay", [FINANCE_EVENTS.anchor]: "worth_stays" };

/** What one answer says in more than one line of this area's words, those lines joined by this. */
const SENTENCES = " ";

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
  log: Log;
}

type Request<T extends FrontendToBackend["type"]> = Extract<FrontendToBackend, { type: T }>;

/**
 * Why a request is not done: today's error code, with the line of this area's words that says so, or the words today's own code
 * gives. `codes` are fields given as codes, each said in the words the file has for it (`keys`).
 */
class Refused extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly why: { line: string; fields?: Record<string, unknown>; codes?: Record<string, readonly string[]> } | { words: string },
  ) {
    super("line" in why ? why.line : why.words);
  }
}

/** The chat's head as a tap is resolved on it: the world as its state plays it, and the seed of the tap's draws. */
interface Head {
  registry: Registry;
  world: WorldDoc;
  state: WorldState;
  seed: string;
}

/** What a tap comes to: what the player did, and the accounts the world gave that opened for it first. */
interface Tapped {
  /** Each account's authored opening (`openGiven`): the world's, not the player's. */
  opened: LedgerEvent[];
  /** What the player did. */
  events: LedgerEvent[];
}

function reply<K extends keyof ResultBodies>(r: FrontendToBackend, request: K, body: ResultBodies[K]): ResultMessage {
  return { lre: PROTOCOL_VERSION, type: "lre.result", reqId: r.reqId, request, body } as ResultMessage;
}

/** A tap of the player's alone, which opens nothing of the world's. */
function played(events: LedgerEvent[]): Tapped {
  return { opened: [], events };
}

/** The unit a recorded change is undone with, as the store takes it: its group's, or its own when it has none. */
function unitOf(c: ChangeRow): string {
  return isRecord(c.value) && typeof c.value.group === "string" ? `group:${c.value.group}` : `change:${c.id}`;
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

  /** Answers one of today's requests from a play page, as today's dispatcher answers it, or says it is not served. */
  async act(user: string, chat: string, r: FrontendToBackend): Promise<ResultMessage | ErrorMessage> {
    try {
      switch (r.type) {
        case "lre.action": {
          const undo = await this.action(user, chat, r);
          return reply(r, "lre.action", { applied: true, pending: false, undo });
        }
        case "lre.fix":
          return reply(r, "lre.fix", { pending: false, undo: await this.fix(user, chat, r) });
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
      // Each kind of the world's change that stays, once, in the words of its own line.
      const said = (await Promise.all([...new Set(stays.flatMap((c) => own(STAYS, c.op) ?? []))].map((line) => this.words(line)))).filter((s) => s !== "").join(SENTENCES);
      return reply(r, "lre.chip", { applied, pending: false, ...(said === "" ? {} : { said }) });
    } catch (error) {
      return this.failed(r, error);
    }
  }

  private action(user: string, chat: string, r: Request<"lre.action">): Promise<string | null> {
    return this.tap(user, chat, r, ({ registry, world, state, seed }) => {
      // From the palette, a panel or the map with no words, a tap goes with the next message; with words, Send now, a chip or a command, it plays at once.
      const later = (r.source === "palette" || r.source === "map") && (r.text?.trim() ?? "") === "" && r.now !== true;
      if (r.action === TIMELAPSE_ACTION) throw new Refused("unavailable", { line: later ? "next_message" : "plays_now" });
      const action = own(world.actions, r.action) ?? registry.actions.get(r.action);
      if (action === undefined) throw new Refused("not_found", { line: "unknown_action", fields: { action: r.action } });
      if (!playsOffstage(r.action, r, action.mechanical === true)) throw new Refused("unavailable", { line: later ? "next_message" : "plays_now" });
      // A request plays no id the player character can't know of (today's `requestRefusal` for the player's own surfaces), so a
      // guessed id of someone hidden reads as one that names no one; a payment that pays no one for another reason says that reason.
      const mayKnow = (id: string): boolean => id === world.pov || canSeeEntity(registry, world, state, world.pov, id);
      const unfit = unfitRef(registry, action, r.params, world, state, mayKnow, undefined, false);
      if (unfit !== null) {
        const why = unfit.reason !== undefined && findLeaks(unfit.reason, unrevealedSecrets(registry, world, state)).length === 0 ? unfit.reason : null;
        throw new Refused("validation", why === null ? { line: "not_known", fields: { action: action.label } } : { line: "not_payable", fields: { action: action.label, why } });
      }
      const w = new Working(registry, world, state);
      const absent = optionalQuery(w.ctx, "economy.offstage_refusal")?.(w.ctx, r.action, r.params, world.pov) ?? optionalQuery(w.ctx, "gear.offstage_refusal")?.(w.ctx, r.action, r.params, world.pov) ?? null;
      if (absent !== null) throw new Refused("validation", { words: absent });
      // What the world gave those the action names opens first, so a sum starts from it. Nothing is drawn for anyone from the
      // world's tables (filling in detail is the GM's and the Author's, plan §6.4), so the resolver is given no seed to draw with.
      const opened = openGiven(registry, w, partiesOf(action.params, world.pov, r.params), seed);
      const res = resolveAction(registry, w, { action, actor: world.pov, params: r.params }, createRng(hashParts(seed, r.action, JSON.stringify(r.params))));
      if (!res.ok && res.failed) throw new Refused("validation", { words: playerReason(res.failed) });
      const rejected = res.rejected[0];
      if (rejected !== undefined) throw new Refused("validation", { words: rejected.rejection.reason });
      if (res.events.length === 0) throw new Refused("validation", { line: "changes_nothing" });
      // A standing payment set up here says, when it pays, that it was set up off screen.
      return { opened, events: res.events.map((e) => (e.type === "spawn" && e.entity.kind === "flow" ? { ...e, entity: { ...e.entity, fields: { ...e.entity.fields, [ORIGIN_FIELD]: OFFSTAGE_ORIGIN } } } : e)) };
    });
  }

  private fix(user: string, chat: string, r: Request<"lre.fix">): Promise<string | null> {
    return this.tap(user, chat, r, ({ registry, world, state, seed }) => {
      // Under the player's rules: a locked field is refused, as on today's ✎. A cash ✎ opens only what the world gave, here
      // (`openGiven`), never drawing money for a holder it gave none.
      const edited = (ops: FixOp[], on: Readonly<WorldState> = state): LedgerEvent[] => {
        const edit = resolveEdit(registry, world, on, ops, { gm: false, runSeed: seed, opened: true });
        if ("rejection" in edit) throw new Refused("validation", { words: edit.rejection.reason });
        return edit.events;
      };
      if ("hint" in r) {
        // The next hint the player has earned at a quest log row, opened: the player's own doing.
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
        // Belongings' changes to the player's things: all or none, one unit with one Undo.
        const changes = Array.isArray(r.things) ? r.things.map(parseItemFix) : [];
        if (changes.length === 0 || changes.length > FIX_THINGS_MAX || changes.some((c) => c === null) || typeof r.label !== "string") throw new Refused("bad_request", { line: "things_count", fields: { most: FIX_THINGS_MAX } });
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
      // Cash corrected is measured from what the world gave them, which opens first as the world's own, not inside the player's correction.
      const w = new Working(registry, world, state);
      const opened = openGiven(registry, w, [r.entity], seed);
      return { opened, events: edited(ops, w.state) };
    });
  }

  /**
   * Records what a tap comes to on the chat's newest turn, in one write, so the state it is resolved on is the one it lands on:
   * the accounts the world gave that opened for it, each a change of its own, then what the player did, in which the economy's
   * bookkeeping for someone it keeps no accounts for (`bookkeeping`, `src/iface/writing.ts`) stays in the unit it came in. What
   * the world's defaults gave is recorded from them and as assumed (`DEFAULTS`), and cites only the tap, so its Undo can tell it
   * from the player's own changes. `resolve` gives both from the chat's head; when the player did nothing, nothing is recorded.
   * Nothing is while a turn of the chat runs: that turn works on the state it started from, and a continue that saves nothing
   * takes back what lands on its turn. The id its Undo takes; null when nothing was recorded.
   */
  private async tap(user: string, chat: string, r: Request<"lre.action"> | Request<"lre.fix">, resolve: (head: Head) => Tapped): Promise<string | null> {
    const s = this.deps.store.user(user);
    const { env } = this.deps.store;
    const tap = crypto.randomUUID();
    const turn = await this.deps.writes.run(() => {
      const row = s.chat(chat);
      if (row === null || row.world === null) throw new Refused("not_world_chat", { line: "not_world" });
      if (this.deps.turning(user, chat)) throw new Refused("conflict", { line: "turn_running" });
      const state = s.headState(chat).state.world;
      const doc = env.worlds(state.revision);
      if (doc === undefined) throw new Refused("unavailable", { line: "no_revision" });
      const { opened, events } = resolve({ registry: env.registry, world: playedWorld(doc, state), state, seed: hashParts(SEED, chat, tap) });
      if (events.length === 0) return null;
      const on = headTurn(s, chat);
      if (on === null) throw new Refused("unavailable", { line: "no_turn" });
      // A branch's newest turn may be the chat it was branched from's, whose state that chat shares (plan §6.3): kept there, the
      // tap would change that chat too, and its Undo would not be this chat's.
      if (s.turn(on)?.chat !== chat) throw new Refused("unavailable", { line: "branch_no_turn" });
      // Events that came with no unit of their own are one unit, so the tap lands and is undone whole, as an operation of the engine's tools is.
      const group = events.length > 1 && events.every((e) => e.group === undefined) ? `tap:${tap}` : undefined;
      const { lre: _lre, reqId: _reqId, chatId: _chatId, ...request } = r;
      const cite = { tap, request } as unknown as JsonValue;
      s.addChanges(on, [
        ...opened.map((e): ChangeInput => ({ lane: "engine", op: e.type, value: e as unknown as JsonValue, by: PLAYER, ...DEFAULTS, cite: { tap } })),
        ...events.map((e, i): ChangeInput => ({ lane: "engine", op: e.type, value: (group === undefined ? e : { ...e, group }) as unknown as JsonValue, by: PLAYER, ...(bookkeeping(events, i) ? { ...DEFAULTS, cite: { tap } } : { source: PLAYER, cite }) })),
      ]);
      return on;
    }, "recording a tap on a panel");
    if (turn === null) return null;
    stateChanged(this.deps.live, chat);
    return `tap:${turn}:${tap}`;
  }

  /**
   * Records the reversal of the player's changes of a tap, each unit the last first, in one write: all of them or none, so an
   * Undo never leaves half of what the player did. A unit that would leave a part of the player's (one written since, or one
   * the store keeps no reverse for) takes the whole write back, and the answer says which. What the world's defaults gave with
   * the tap is reversed with the player's unit it is in, where the store keeps a reverse for it, and else stays: the accounts it
   * gave, opened, which are in no unit of the player's, and the economy's bookkeeping for someone it keeps no accounts for.
   * Whether anything was recorded (nothing once the tap is undone), and the world's changes that stay. Nothing is recorded while
   * a turn of the chat runs.
   */
  private undone(user: string, chat: string, chip: string): Promise<{ applied: boolean; stays: ChangeRow[] }> {
    const s = this.deps.store.user(user);
    return this.deps.writes.run(() => {
      const [, turn = "", tap = ""] = UNDO_ID.exec(chip) ?? [];
      // A tap of a turn joined to another is answered as a fact, naming the turn it joined.
      const held = s.turn(turn);
      if (held?.chat === chat && held.joined !== null) throw new JoinedTurnError(turn, held.joined);
      const all = s.turn(turn)?.chat === chat ? s.changes(turn).filter((c) => isRecord(c.cite) && c.cite.tap === tap) : [];
      const mine = all.filter((c) => c.source === PLAYER);
      if (mine.length === 0) throw new Refused("not_found", { line: "no_undo" });
      if (this.deps.turning(user, chat)) throw new Refused("conflict", { line: "turn_running" });
      const path = s.path(chat);
      const from = path.findIndex((e) => e.turn === turn);
      if (from < 0) throw new Refused("conflict", { line: "off_path" });
      // Undone already where the chat's story now goes: a change from its turn on cites one of the tap's as the one it undoes.
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
    }, "undoing a tap on a panel");
  }

  private async failed(r: FrontendToBackend, error: unknown): Promise<ErrorMessage> {
    // A turn joined to another is a fact the server answers in its one place, not a failure of this page's request.
    if (error instanceof JoinedTurnError) throw error;
    const fail = (code: ErrorCode, message: string): ErrorMessage => ({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: r.reqId, code, message });
    if (error instanceof Refused) return fail(error.code, "words" in error.why ? error.why.words : await this.words(error.why.line, error.why.fields, error.why.codes));
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
