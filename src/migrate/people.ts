// The cast's character a person of today's build is (STANDALONE-PLAN §7.1, §15.2). Today's build names
// a person by its entity's id; the cast keeps characters by name, per chat, a branch knowing those of
// the chat it was made from (`chatLine`), and finds the world's person a character is by that name
// (`src/cast/secrets.ts`). So one person is one character, found again by every run through the
// migration's table of who became whom (`migration_person`) before any name, and named as the world
// names the person at the head of the chat the character is in: a run after a rename renames it. Where
// the world gives that name to another person too, or another character of the chat's line holds it,
// the character is named by the entity's id, which the cast matches to the world's person as it
// matches a name.

import type { Database } from "bun:sqlite";
import { addCharacter, chatLine, findCharacter } from "../cast";
import { renameCharacter } from "../cast/record";
import { personNamed, worldAt } from "../cast/secrets";
import type { ReadContext } from "../engine/registry";
import type { Store, TurnRow, UserStore } from "../store";
import { isPerson, keepPerson, personOf } from "./tables";

export interface Person {
  /** The cast's character. */
  id: string;
  name: string;
}

export class People {
  /** Each person met in this run, by chat and entity. */
  private readonly met = new Map<string, Person>();
  /** The world at each chat's head, read once. */
  private readonly heads = new Map<string, ReadContext | null>();

  constructor(
    private readonly db: Database,
    private readonly store: Store,
    private readonly s: UserStore,
    private readonly now: number,
  ) {}

  /** The world as a chat's head plays it; null where its state can't be folded or its world read. */
  private head(chat: string): ReadContext | null {
    if (!this.heads.has(chat)) {
      let ctx: ReadContext | null = null;
      try {
        const state = this.s.headState(chat).state.world;
        const doc = this.store.env.worlds(state.revision);
        ctx = doc === undefined ? null : this.store.env.registry.context(doc, state);
      } catch {
        ctx = null;
      }
      this.heads.set(chat, ctx);
    }
    return this.heads.get(chat) ?? null;
  }

  /** The name a world gives a person; null where it gives none, or gives it to another person as well. */
  private static nameIn(ctx: ReadContext | null, entity: string): string | null {
    const name = ctx?.state.entities[entity]?.name;
    if (ctx === null || typeof name !== "string" || name.trim() === "") return null;
    const found = personNamed(ctx, name);
    return "many" in found || ("id" in found && found.id !== entity) ? null : name.trim();
  }

  /** The name the world gives a person in `chat`: at the chat's head, else at the turn it is met at; null where it gives none, or gives it to another person as well. */
  private said(chat: string, turn: TurnRow, entity: string): string | null {
    const named = People.nameIn(this.head(chat), entity);
    if (named !== null) return named;
    try {
      return People.nameIn(worldAt(this.store, this.s.id, turn.id), entity);
    } catch {
      return null;
    }
  }

  /** The character `entity` is in the chat of `turn`, made in that chat the first time any run meets it on the chat's line. Inside the caller's write. */
  of(turn: TurnRow, entity: string): Person {
    const key = `${turn.chat}\u0000${entity}`;
    const known = this.met.get(key);
    if (known !== undefined) return known;
    const line = chatLine(this.s, turn.chat);
    let person: Person | null = null;
    // The character a run made of this person on the chat's line, nearest first: named as the world names the person now.
    for (const chat of line) {
      const id = personOf(this.db, this.s.id, chat, entity);
      const found = id === null ? null : findCharacter(this.db, this.s.id, line, id);
      if (found === null || found.id !== id) continue;
      const said = this.said(chat, turn, entity);
      const holder = said === null ? null : findCharacter(this.db, this.s.id, line, said);
      // A character of a chat played on RPE is RPE's now, and keeps its name.
      const name = this.s.isPlayed(chat) ? found.name : said !== null && (holder === null || holder.id === id) ? said : entity;
      if (name !== found.name) renameCharacter(this.db, this.s.id, id, name);
      person = { id, name };
      break;
    }
    if (person === null) {
      const said = this.said(turn.chat, turn, entity);
      const holder = said === null ? null : findCharacter(this.db, this.s.id, line, said);
      // A character of that name no run made of a person (one a run of an earlier build made, or the player's): the same person, as the cast ties a character to the world's person by name.
      const adopt = holder !== null && holder.id !== said && !isPerson(this.db, this.s.id, holder.id);
      const made = adopt ? holder : addCharacter(this.db, this.s.id, turn.chat, said !== null && holder === null ? said : entity, this.now);
      keepPerson(this.db, this.s.id, made.chat, entity, made.id);
      person = { id: made.id, name: made.name };
    }
    this.met.set(key, person);
    return person;
  }
}
