// A chat's play panels, served by RPE (plan §14: today's panels kept, re-pointed to RPE): the chat's
// state view, read from RPE's store, and today's panel actions as a page sends them (plan §10.10). A
// tap that manages (money, a group, gear, with no words: today's `lre.action` done off screen, and
// each `lre.fix`) is resolved with today's pure resolvers and recorded in RPE's store as the player's
// own changes on the chat's newest turn, the turn the next one follows: the next turn's world state
// shows their values and lists them among what the turn before changed. Its Undo records their
// reversal (`UserStore.undo`). A chat's own choices (today's `lre.chat.knowledge`) read as RPE has
// them: it keeps none. A tap that goes with the next message, a tap that plays now, setting a chat's
// own choice, the things browser and the map's walk and display are not served here, and say so in
// words from `.prompts/play-answers.md`. After each change the chat's followers are told its state
// changed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { type LiveHub, RouteError, type WriteQueue } from "../app";
import { playerReason } from "../backend/requirement-words";
import { unfitRef } from "../backend/turn-steps";
import { TIMELAPSE_ACTION } from "../backend/view";
import { resolveEdit } from "../engine/edits";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { optionalQuery, own } from "../engine/pack-kit";
import { playedWorld } from "../engine/places-in-play";
import type { Registry } from "../engine/registry-impl";
import { resolveAction } from "../engine/resolve";
import { createRng } from "../engine/rng";
import type { WorldState } from "../engine/state";
import { clockFix } from "../engine/time";
import { currentStage } from "../engine/tracks";
import { canSeeEntity, canSeePlace, findLeaks, playerTrack, shownTrackId, unrevealedSecrets } from "../engine/visibility";
import { Working } from "../engine/working";
import { hashParts } from "../shared/hash";
import { isRecord, type JsonValue } from "../shared/json";
import type { FixOp, LedgerEvent } from "../shared/ledger";
import { OFFSTAGE_ORIGIN, ORIGIN_FIELD, playsOffstage } from "../shared/offstage";
import { type ErrorCode, type ErrorMessage, FIX_THINGS_MAX, type FrontendToBackend, PROTOCOL_VERSION, type ResultBodies, type ResultMessage } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import { type ItemFix, parseItemFix } from "../shared/things";
import type { WorldDoc } from "../shared/world";
import { type ChangeInput, readPart, type Report, type Store } from "../store";
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

/** Why a request is not done: today's error code, with the line of this area's words that says so, or the words today's own code gives. */
class Refused extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly why: { line: string; fields?: Record<string, unknown> } | { words: string },
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

function reply<K extends keyof ResultBodies>(r: FrontendToBackend, request: K, body: ResultBodies[K]): ResultMessage {
  return { lre: PROTOCOL_VERSION, type: "lre.result", reqId: r.reqId, request, body } as ResultMessage;
}

export class PlayService {
  private readonly runEnds: RunEnds;

  constructor(private readonly deps: PlayDeps) {
    this.runEnds = new RunEnds(deps.live);
  }

  /** The chat's state view at its head, or at `turn`, one of its turns. */
  state(user: string, chat: string, turn: string | null): StateView {
    if (turn !== null && this.deps.store.user(user).turn(turn)?.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
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

  /** Undoes a tap this area recorded, by the id its answer gave, as today's Undo chip is sent. */
  async undo(user: string, chat: string, r: Request<"lre.chip">): Promise<ResultMessage | ErrorMessage> {
    try {
      const applied = await this.undone(user, chat, r.chip);
      if (applied) stateChanged(this.deps.live, chat);
      return reply(r, "lre.chip", { applied, pending: false });
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
      const res = resolveAction(registry, w, { action, actor: world.pov, params: r.params }, createRng(hashParts(seed, r.action, JSON.stringify(r.params))), { runSeed: seed });
      if (!res.ok && res.failed) throw new Refused("validation", { words: playerReason(res.failed) });
      const rejected = res.rejected[0];
      if (rejected !== undefined) throw new Refused("validation", { words: rejected.rejection.reason });
      if (res.events.length === 0) throw new Refused("validation", { line: "changes_nothing" });
      // A standing payment set up here says, when it pays, that it was set up off screen.
      return res.events.map((e) => (e.type === "spawn" && e.entity.kind === "flow" ? { ...e, entity: { ...e.entity, fields: { ...e.entity.fields, [ORIGIN_FIELD]: OFFSTAGE_ORIGIN } } } : e));
    });
  }

  private fix(user: string, chat: string, r: Request<"lre.fix">): Promise<string | null> {
    return this.tap(user, chat, r, ({ registry, world, state, seed }) => {
      // Under the player's rules: a locked field is refused, as on today's ✎.
      const edited = (ops: FixOp[]): LedgerEvent[] => {
        const edit = resolveEdit(registry, world, state, ops, { gm: false, runSeed: seed });
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
        return [{ type: ENGINE_EVENTS.hint, data: { track: id, stage, n: shown.opened + 1 } }];
      }
      if ("time" in r) {
        // The clock's ✎: a later time runs the time between as an applied advance, an earlier one sets the clock back.
        if (typeof r.time !== "string") throw new Refused("bad_request", { line: "bad_time" });
        const fixed = clockFix(registry, world, state, r.time, seed);
        if ("code" in fixed) throw new Refused("validation", { words: fixed.reason });
        return fixed.events;
      }
      if ("thing" in r) {
        const change = parseItemFix(r.thing);
        if (change === null) throw new Refused("bad_request", { line: "not_thing" });
        return edited([{ op: "fix_item", change }]);
      }
      if ("things" in r) {
        // Belongings' changes to the player's things: all or none, one unit with one Undo.
        const changes = Array.isArray(r.things) ? r.things.map(parseItemFix) : [];
        if (changes.length === 0 || changes.length > FIX_THINGS_MAX || changes.some((c) => c === null) || typeof r.label !== "string") throw new Refused("bad_request", { line: "things_count", fields: { most: FIX_THINGS_MAX } });
        return edited((changes as ItemFix[]).map((change): FixOp => ({ op: "fix_item", change })));
      }
      // A field's ✎. A place fixed so is a real move, through the one move path, and leaves the activity behind; only a place the
      // player character may know, for someone it can see: anything else reads as no place at all, as the ✎ never offered it.
      if (r.field === "place" && (typeof r.value !== "string" || !canSeePlace(registry, world, state, world.pov, r.value) || !canSeeEntity(registry, world, state, world.pov, r.entity))) throw new Refused("validation", { line: "no_place" });
      const set: FixOp = { op: "set", entity: r.entity, field: r.field, value: r.value };
      const was = own(state.entities, r.entity);
      const doing = was?.fields.activity;
      const moved = r.field === "place" && r.value !== was?.fields.place;
      return edited(moved && doing !== undefined && doing !== "idle" ? [set, { op: "set", entity: r.entity, field: "activity", value: "idle" }] : [set]);
    });
  }

  /**
   * Records what a tap comes to as the player's own changes on the chat's newest turn, in one write, so the state it is resolved
   * on is the one it lands on. `resolve` gives its events from the chat's head; with none, nothing is recorded. The id its Undo
   * takes; null when nothing was recorded.
   */
  private async tap(user: string, chat: string, r: Request<"lre.action"> | Request<"lre.fix">, resolve: (head: Head) => LedgerEvent[]): Promise<string | null> {
    const s = this.deps.store.user(user);
    const { env } = this.deps.store;
    const tap = crypto.randomUUID();
    const turn = await this.deps.writes.run(() => {
      const row = s.chat(chat);
      if (row === null || row.world === null) throw new Refused("not_world_chat", { line: "not_world" });
      const state = s.headState(chat).state.world;
      const doc = env.worlds(state.revision);
      if (doc === undefined) throw new Refused("unavailable", { line: "no_revision" });
      const events = resolve({ registry: env.registry, world: playedWorld(doc, state), state, seed: hashParts(SEED, chat, tap) });
      if (events.length === 0) return null;
      const on = headTurn(s, chat);
      if (on === null) throw new Refused("unavailable", { line: "no_turn" });
      // Events that came with no unit of their own are one unit, so the tap lands and is undone whole, as an operation of the engine's tools is.
      const group = events.length > 1 && events.every((e) => e.group === undefined) ? `tap:${tap}` : undefined;
      const { lre: _lre, reqId: _reqId, chatId: _chatId, ...request } = r;
      const cite = { tap, request } as unknown as JsonValue;
      s.addChanges(
        on,
        events.map((e): ChangeInput => ({ lane: "engine", op: e.type, value: (group === undefined ? e : { ...e, group }) as unknown as JsonValue, by: PLAYER, source: PLAYER, cite })),
      );
      return on;
    }, "recording a tap on a panel");
    if (turn === null) return null;
    stateChanged(this.deps.live, chat);
    return `tap:${turn}:${tap}`;
  }

  /** Records the reversal of each unit of a tap, the last first. Whether anything was recorded: nothing, once the tap is undone already. */
  private undone(user: string, chat: string, chip: string): Promise<boolean> {
    const s = this.deps.store.user(user);
    return this.deps.writes.run(() => {
      const [, turn = "", tap = ""] = UNDO_ID.exec(chip) ?? [];
      const mine = s.turn(turn)?.chat === chat ? s.changes(turn).filter((c) => isRecord(c.cite) && c.cite.tap === tap) : [];
      if (mine.length === 0) throw new Refused("not_found", { line: "no_undo" });
      const path = s.path(chat);
      const from = path.findIndex((e) => e.turn === turn);
      if (from < 0) throw new Refused("conflict", { line: "off_path" });
      // Undone already where the chat's story now goes: a change from its turn on cites one of the tap's as the one it undoes.
      const ids = new Set(mine.map((c) => c.id));
      const since = path.slice(from).flatMap((e) => (e.turn === null ? [] : s.changes(e.turn)));
      if (since.some((c) => isRecord(c.cite) && typeof c.cite.undoes === "number" && ids.has(c.cite.undoes))) return false;
      // The store undoes a change with the rest of its unit: one change of each unit is enough.
      const units = new Map<string, number>();
      for (const c of mine) {
        const key = isRecord(c.value) && typeof c.value.group === "string" ? `group:${c.value.group}` : `change:${c.id}`;
        if (!units.has(key)) units.set(key, c.id);
      }
      let recorded = 0;
      const left: Report[] = [];
      for (const id of [...units.values()].reverse()) {
        const out = s.undo(id, PLAYER);
        recorded += out.changes.length;
        left.push(...out.left);
      }
      if (recorded === 0 && left.some((l) => l.code === "changed_since")) throw new Refused("conflict", { line: "changed_since" });
      return recorded > 0;
    }, "undoing a tap on a panel");
  }

  private async failed(r: FrontendToBackend, error: unknown): Promise<ErrorMessage> {
    const fail = (code: ErrorCode, message: string): ErrorMessage => ({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: r.reqId, code, message });
    if (error instanceof Refused) return fail(error.code, "words" in error.why ? error.why.words : await this.words(error.why.line, error.why.fields));
    const message = error instanceof Error ? error.message : String(error);
    this.deps.log.error("A play page's request failed inside RPE.", { request: r.type, error: message });
    return fail("internal", message);
  }

  /** A line of this area's words, filled with `fields`; none when the user deleted the line. */
  private async words(line: string, fields: Record<string, unknown> = {}): Promise<string> {
    const what = `.prompts/${PLAY_ANSWERS}.md`;
    const part = readPart(await readFile(join(this.deps.guidance, ".prompts", `${PLAY_ANSWERS}.md`), "utf8"), what);
    return part.lines.get(line)?.render(part.header, fields) ?? "";
  }
}
