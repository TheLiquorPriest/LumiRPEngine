// The cast's character a person of today's build is (STANDALONE-PLAN §7.1, §15.2). Today's build names
// a person by its entity's id; the cast keeps characters by name, per chat, a branch knowing those of
// the chat it was made from (`chatLine`). A person's character is the one named as the world state
// names the entity at the turn the person is first met; where the state names no such entity, or
// another person met in the run holds that name, it is named by the entity's id, which the cast
// matches to the world's person as it matches a name (`src/cast/secrets.ts`). A later run finds it
// again by the same name, so no run makes a second one.

import type { Database } from "bun:sqlite";
import { addCharacter, chatLine, findCharacter } from "../cast";
import type { TurnRow, UserStore } from "../store";

export interface Person {
  /** The cast's character. */
  id: string;
  name: string;
}

export class People {
  private readonly byEntity = new Map<string, Person>();
  /** Which entity each character met in this run stands for: a name two people share goes to the first. */
  private readonly stands = new Map<string, string>();

  constructor(
    private readonly db: Database,
    private readonly s: UserStore,
    private readonly now: number,
  ) {}

  /** The name the world state gives an entity at a turn; null where it names no such entity, or the turn's state can't be folded. */
  private stateName(turn: TurnRow, entity: string): string | null {
    try {
      const name = this.s.stateAt(turn.id).state.world.entities[entity]?.name;
      return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
    } catch {
      return null;
    }
  }

  /** The character `entity` is in the chat of `turn`, made in that chat the first time it is met. Inside the caller's write. */
  of(turn: TurnRow, entity: string): Person {
    const key = `${turn.chat}\u0000${entity}`;
    const known = this.byEntity.get(key);
    if (known !== undefined) return known;
    const line = chatLine(this.s, turn.chat);
    const free = (name: string): Person | null => {
      const found = findCharacter(this.db, this.s.id, line, name);
      if (found === null) return null;
      const holder = this.stands.get(found.id);
      return holder === undefined || holder === entity ? { id: found.id, name: found.name } : null;
    };
    const named = this.stateName(turn, entity);
    let person = (named === null ? null : free(named)) ?? free(entity);
    if (person === null) {
      // Not met before on this chat's line: named as the state names it, unless that name is another person's.
      const taken = named !== null && findCharacter(this.db, this.s.id, line, named) !== null;
      const made = addCharacter(this.db, this.s.id, turn.chat, named !== null && !taken ? named : entity, this.now);
      person = { id: made.id, name: made.name };
    }
    this.stands.set(person.id, entity);
    this.byEntity.set(key, person);
    return person;
  }
}
