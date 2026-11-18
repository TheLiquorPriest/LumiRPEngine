// The one way an edit of his is recorded (plan §6.3, §10.10 "A panel action", R-22), from a panel's tap or
// a correction made on any page (a token dragged on the map, squares edited, a value or a fact set on the
// World page): resolved on the chat's head, recorded as his own changes in one write, cited by the edit's
// id and the request that made it, with his "Tell the story" choice and what the world's rules advised
// against it kept beside, and answered with the edit's id, which its Undo takes. What the world's defaults
// gave with it (the accounts the world gave those it names, opened first; the economy's bookkeeping for
// someone it keeps no accounts for) is recorded from those defaults and as assumed, citing only the edit,
// so its Undo tells it from his own changes.
//
// Where his change lands is the store's one call for it (`writeTarget`, `record`): of no turn, kept with the
// chat, applied at once and shown at its head, taking effect before the next turn that begins and never
// under a run going on; in a branch that has played no turn of its own, on the branch's own line; before a
// chat's first turn, the same. Nothing about where the chat stands refuses it.

import type { LiveHub, WriteQueue } from "../app";
import { playedWorld } from "../engine/places-in-play";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { FILLED_IN } from "../iface/source";
import { bookkeeping } from "../iface/writing";
import { hashParts } from "../shared/hash";
import type { JsonObject, JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { ErrorCode } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import type { ChangeInput, Report, Store } from "../store";
import { stateChanged } from "./live";

/** Who an edit of his is by, and where it came from. */
export const PLAYER = "player";

/** What every draw of an edit is seeded from, with the chat and the edit: each edit draws on its own. */
const SEED = "rpe.play";

/** How what the world's defaults give with an edit is recorded: as the engine's own tools record what they fill in. */
const DEFAULTS: Pick<ChangeInput, "source" | "standing" | "precision"> = { source: FILLED_IN.source?.from ?? null, standing: FILLED_IN.standing, precision: FILLED_IN.precision };

/**
 * Why an edit is not done: an error code, with the line of the play answers that says so, or the words the engine's own code gives.
 * `codes` are fields given as codes, each said in the words the file has for it (`keys`).
 */
export class Refused extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly why: { line: string; fields?: Record<string, unknown>; codes?: Record<string, readonly string[]> } | { words: string },
  ) {
    super("line" in why ? why.line : why.words);
  }
}

/** The chat's head as an edit is resolved on it: the world as its state plays it, and the seed of the edit's draws. */
export interface Head {
  registry: Registry;
  world: WorldDoc;
  state: WorldState;
  seed: string;
}

/** What an edit comes to on the head. */
export interface Resolved {
  /** The accounts the world gave that opened for it first, each its authored opening: the world's, not his. */
  opened: LedgerEvent[];
  /** What he did, as engine events. */
  events: LedgerEvent[];
  /** What he did as store operations beside them (a fact set, say), each with how exact and how sure he said it is. */
  store?: { op: string; value: JsonValue; precision?: ChangeInput["precision"]; standing?: ChangeInput["standing"] }[];
  /** What the world's rules advise against it, which it is applied past (plan §6.1): kept with it and answered. */
  advised?: Report[];
}

export interface OwnerEditDeps {
  store: Store;
  writes: WriteQueue;
  live: Pick<LiveHub, "publish">;
}

/** What recording an edit came to: the edit's id, which its Undo takes (null when it changed nothing), and what the world's rules advised. */
export interface OwnerEdited {
  undo: string | null;
  advised: Report[];
}

/** The edit an Undo names: its own id, or the `tap:<turn>:<edit>` an edit recorded on a turn before his changes were his own was given. */
export function editId(undo: string): string {
  return /^tap:[^:]+:([^:]+)$/.exec(undo)?.[1] ?? undo;
}

/** The chat's head as a tap that records nothing reads it: the world as its state plays it; refused for a chat that plays none, or one whose revision is not held. */
export function headOf(store: Store, user: string, chat: string): Omit<Head, "seed"> {
  const s = store.user(user);
  const row = s.chat(chat);
  if (row === null || row.world === null) throw new Refused("not_world_chat", { line: "not_world" });
  const state = s.headState(chat).state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) throw new Refused("unavailable", { line: "no_revision" });
  return { registry: store.env.registry, world: playedWorld(doc, state), state };
}

/**
 * Records an edit of his on the chat in one write, so the state it is resolved on is the one it lands on: the accounts the world gave
 * that opened for it, each a change of its own, then what he did, in which the economy's bookkeeping for someone it keeps no accounts
 * for stays in the unit it came in; events that came with no unit of their own are one unit, so the edit lands and is undone whole.
 * `request` is what asked for it (a panel's tap, a page's correction), kept as its cite with `tell` (null: the tap's group decides) and
 * what was advised. Nothing is recorded when he did nothing.
 */
export async function recordOwnerEdit(deps: OwnerEditDeps, user: string, chat: string, request: JsonObject, tell: boolean | null, resolve: (head: Head) => Resolved): Promise<OwnerEdited> {
  const s = deps.store.user(user);
  const { env } = deps.store;
  const edit = crypto.randomUUID();
  const out = await deps.writes.run((): OwnerEdited => {
    const row = s.chat(chat);
    if (row === null || row.world === null) throw new Refused("not_world_chat", { line: "not_world" });
    const state = s.headState(chat).state.world;
    const doc = env.worlds(state.revision);
    if (doc === undefined) throw new Refused("unavailable", { line: "no_revision" });
    const { opened, events, store = [], advised = [] } = resolve({ registry: env.registry, world: playedWorld(doc, state), state, seed: hashParts(SEED, chat, edit) });
    if (events.length === 0 && store.length === 0) return { undo: null, advised };
    const group = events.length > 1 && events.every((e) => e.group === undefined) ? `tap:${edit}` : undefined;
    const cite = { tap: edit, request, ...(tell !== null ? { tell } : {}), ...(advised.length > 0 ? { advised } : {}) } as unknown as JsonValue;
    s.record(s.writeTarget({ chat }), [
      // What the world gave, opened: the owner set it in his world, so it stands established, from him (as the tools' `AUTHORED`, plan §6.6).
      ...opened.map((e): ChangeInput => ({ lane: "engine", op: e.type, value: e as unknown as JsonValue, by: PLAYER, source: PLAYER, standing: "established", precision: null, cite: { tap: edit } })),
      ...events.map((e, i): ChangeInput => ({ lane: "engine", op: e.type, value: (group === undefined ? e : { ...e, group }) as unknown as JsonValue, by: PLAYER, ...(bookkeeping(events, i) ? { ...DEFAULTS, cite: { tap: edit } } : { source: PLAYER, cite }) })),
      ...store.map((c): ChangeInput => ({ lane: "engine", op: c.op, value: c.value, by: PLAYER, source: PLAYER, cite, precision: c.precision ?? null, standing: c.standing ?? null })),
    ]);
    return { undo: edit, advised };
  }, "recording an edit of yours");
  if (out.undo !== null) stateChanged(deps.live, chat);
  return out;
}
