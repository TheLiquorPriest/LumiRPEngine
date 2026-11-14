// Who holds a lore secret (plan §9.6) is state, in the shape today's build keeps it, because the
// secrecy interceptor reads it there: a `Holding` under the minds slice's `knowledge.holdings`
// (`src/shared/minds.ts:1139-1156`), read by `heldSecrets` (`:1198`) for the interceptor
// (`src/backend/wi-interceptor.ts:101`). A perception's "now knows" can name a secret by its own id;
// the holding is made by today's own minds code (`mindEdit`'s `mind_knowledge`,
// `src/packs/minds/core/edit.ts:156-183`, which words it as a `minds.learn` event) and recorded as a
// change of the turn that wrote the perception, so a swipe takes it back with the perception.
//
// The world's person a cast character is, is found by name: the cast keeps no other link to the
// world's people yet. The chat must already hold the secret as a fact (`minds.fact`), as today's
// seeding records one; code writes no claim of its own.

import type { ChangeInput, Store } from "../store";
import { kindIs } from "../engine/scope";
import type { ReadContext } from "../engine/registry";
import { mindEdit } from "../packs/minds/core/edit";
import type { EntityId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { type FactId, type Holding, parseFactId, wiFactIdOfLiveLore } from "../shared/minds";
import { nameKey } from "./record";

/**
 * The fact a secret's id names, in the forms today's code reads: a fact id of lore (`lore:<id>`, a
 * world entry) or of World Info (`wi:<book>:<entry>` for a whole entry, `wi:<book>:<entry>:<n>` for
 * its mark counted from 0), or the live lore id of a book entry or mark (`book:<book>/<entry>`,
 * `book:<book>/<entry>#<n>` counted from 1). Null for anything else.
 */
export function secretFact(said: string): FactId | null {
  const id = said.trim();
  const kind = parseFactId(id)?.kind;
  if (kind === "lore" || kind === "wi") return id;
  return wiFactIdOfLiveLore(id);
}

/** The world as the state plays it at a turn (its staged changes in), for finding people and making a holding; null when the chat plays no world the store can read. */
export function worldAt(store: Store, user: string, turn: string): ReadContext | null {
  const state = store.user(user).stateAt(turn).state.world;
  const doc = store.env.worlds(state.revision);
  return doc === undefined ? null : store.env.registry.context(doc, state);
}

/** Who in the world a name is: the one person with that id or name, none, or the several so named. */
export type PersonFound = { id: EntityId } | { none: true } | { many: EntityId[] };

/** The person in the world `said` names, by id or by name as the cast compares names. */
export function personNamed(ctx: ReadContext, said: string): PersonFound {
  const people = Object.entries(ctx.state.entities).filter(([, e]) => kindIs(ctx.registry, ctx.world, e.kind, "person"));
  if (people.some(([id]) => id === said.trim())) return { id: said.trim() };
  const named = people.filter(([, e]) => nameKey(e.name) === nameKey(said)).map(([id]) => id);
  const [one] = named;
  if (one === undefined) return { none: true };
  return named.length === 1 ? { id: one } : { many: named };
}

/** A holding as a perception gives it: whose, of which secret, told by whom (null: first hand), since when, and how sure. */
export interface SecretAsk {
  holder: EntityId;
  fact: FactId;
  teller: EntityId | null;
  /** The message of the turn it was perceived in (null while that turn has none), and the story clock then. */
  since: Holding["since"];
  confidence: number;
}

/**
 * The events that make the holding, by today's minds code: none when the holder already holds it
 * so; a rejection's code when the chat cannot hold it (`missing_fact`: the chat holds no such
 * secret; others as `mindEdit` gives them).
 */
export function holdingEvents(ctx: ReadContext, ask: SecretAsk): LedgerEvent[] | { code: string } {
  const holding: Holding = { how: ask.teller === null ? "witnessed" : "told", by: ask.teller, evidence: [], since: ask.since, belief: "true", confidence: ask.confidence };
  const out = mindEdit(ctx, { op: "mind_knowledge", entity: ask.holder, fact: ask.fact, holding });
  if (Array.isArray(out)) return out;
  return out.code === "no_change" ? [] : { code: out.code };
}

/** The changes that record a holding's events on a turn, in the cast's lane, with who made them. */
export function holdingChanges(events: readonly LedgerEvent[], lane: ChangeInput["lane"], by: string, job: string | null): ChangeInput[] {
  return events.map((e) => ({ lane, op: e.type, value: e as unknown as JsonValue, by, job }));
}
