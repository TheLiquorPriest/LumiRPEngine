// Who holds a secret at a point of the path (plan §9.6; R-189): the people a mark names as holding it, and every person whose holding of it
// counts there (today's `heldSecrets`: told, found out, revealed, believed true and sure enough, while the chat tracks knowledge, by the
// threshold the state records). Read at the state the reader's point shows, in place: nothing is copied.

import { isGone, kindIs } from "../../engine/scope";
import { holdingsOf } from "../../packs/minds/core/knowledge";
import { readSlice } from "../../packs/minds/core/state";
import { bookLoreId, bookMarkLoreId } from "../../secrecy/book-lore";
import type { EntityId } from "../../shared/ids";
import { type Holding, heldSecrets, liveLoreIdOfWiFact, parseFactId } from "../../shared/minds";
import { resolveMarkNames, type SecretMark } from "../../shared/secret-marks";
import type { WorldAt } from "../sources";

/** The world's people: those whose kind is a person's and who are still in the world, as today's knowers are (`backend/agents/tools/read-view.ts:223-233`). */
export function peopleOf(at: WorldAt): EntityId[] {
  return Object.keys(at.state.entities).filter((id) => {
    const e = at.state.entities[id];
    return e !== undefined && kindIs(at.registry, at.world, e.kind, "person") && !isGone(at.state, id);
  });
}

/** Who holds what at one state of a chat: each person's counted holdings, read once. */
export class HoldersAt {
  readonly #at: WorldAt;
  readonly #held = new Map<EntityId, ReadonlyMap<string, Holding>>();
  #people: EntityId[] | null = null;

  constructor(at: WorldAt) {
    this.#at = at;
  }

  /** A person's name in the chat, as the world and its state have it. */
  name(id: EntityId): string {
    return this.#at.state.entities[id]?.name ?? this.#at.world.entities[id]?.name ?? id;
  }

  /** The people whose holding of the lore entry `loreId` counts (a world entry's key, or a book entry's or mark's live lore id), by name, in the world's order. */
  holding(loreId: string): string[] {
    this.#people ??= peopleOf(this.#at);
    return this.#people.filter((who) => this.counted(who).has(loreId)).map((who) => this.name(who));
  }

  /** Whether `who`'s holding of the lore entry `loreId` counts at this point. */
  holds(who: EntityId, loreId: string): boolean {
    return this.counted(who).has(loreId);
  }

  /**
   * Who holds a mark of a book entry: the people it names as knowing it (a name that names no one, or several, as written), then
   * everyone whose holding of the mark counts. `n` is the mark's place from 1; null for a whole-entry secret.
   */
  ofMark(mark: Pick<SecretMark, "knownTo" | "keptFrom">, book: string, entry: string, n: number | null): string[] {
    const resolved = resolveMarkNames(this.#at.world, this.#at.state, mark);
    const named = [...resolved.knownTo.map((id) => this.name(id)), ...mark.knownTo.filter((name) => resolved.unresolved.includes(name))];
    return [...new Set([...named, ...this.holding(n === null ? bookLoreId(book, entry) : bookMarkLoreId(book, entry, n))])];
  }

  /**
   * What `who` holds that counts here (today's `heldSecrets`: believed true and sure enough, never an author's own seeding, only while the
   * chat tracks knowledge, by the threshold the state records), each by its live lore id with the holding behind it: how they came by it.
   */
  counted(who: EntityId): ReadonlyMap<string, Holding> {
    let held = this.#held.get(who);
    if (held === undefined) {
      const counts = new Set(heldSecrets(this.#at.state.packs.minds, who).lore);
      const mine = new Map<string, Holding>();
      if (counts.size > 0) {
        for (const [fact, holding] of Object.entries(holdingsOf(readSlice(this.#at.state), who))) {
          const ref = parseFactId(fact);
          const id = ref?.kind === "lore" ? ref.lore : ref?.kind === "wi" ? (liveLoreIdOfWiFact(fact) ?? fact) : null;
          if (id !== null && counts.has(id)) mine.set(id, holding);
        }
      }
      held = mine;
      this.#held.set(who, held);
    }
    return held;
  }
}
