// Whose arcs the brief holds (plan §8.1, §7.3; R-56): the arcs of the principals on stage. Who is on stage is read by the turn lane
// (the open scene's people and whoever the state places in the scene's place, or where the owner's character stands) and given by name;
// the cast says who of them is a principal, by the casting in force at the turn. An arc and a name on stage are one person when they name
// the same character of the cast: by its id, by its name, or by the name of the world's person it is, so "Wren" and "Wren Ashdown" of
// one cast record are one. A name the cast does not hold is taken as it is written, as the brief took it before there was a cast.
// Code compares names; it never judges what an arc says.

import { castAt } from "../cast/path";
import { castingInForce, CastRecord, type Character, charactersOf, chatLine } from "../cast/record";
import type { Store } from "../store";
import { namesOf } from "./kit";
import { nameKey, type StoryItem } from "./record";

/** The arcs of the principals on stage, in the order the record holds them. */
export function arcsOnStage(store: Store, user: string, chat: string, turn: string | null, arcs: readonly StoryItem[], stage: readonly string[]): StoryItem[] {
  const u = store.user(user);
  const named = new Set(stage.map(nameKey));
  if (u.chat(chat) === null) return arcs.filter((a) => namesOf(a).some((n) => named.has(nameKey(n))));
  const characters = charactersOf(store.db, user, chatLine(u, chat));
  const record = CastRecord.read(store, user, castAt(u, chat, turn));
  const entities = (turn === null ? u.headState(chat) : u.stateAt(turn)).state.world.entities;
  const nameOfPerson = (c: Character): string | null => (c.person !== null && Object.hasOwn(entities, c.person) ? (entities[c.person]?.name ?? null) : null);
  /** The character a name is: by id, by its name, or by the name of the world's person it is. */
  const characterOf = (name: string): Character | undefined => {
    const key = nameKey(name);
    return characters.find((c) => c.id === name.trim()) ?? characters.find((c) => nameKey(c.name) === key) ?? characters.find((c) => nameOfPerson(c) !== null && nameKey(nameOfPerson(c) ?? "") === key);
  };
  const principals = new Set(characters.filter((c) => castingInForce(record, c)?.as === "principal").map((c) => c.id));
  const stood = new Set(stage.flatMap((n) => characterOf(n)?.id ?? []));
  return arcs.filter((a) =>
    namesOf(a).some((n) => {
      const c = characterOf(n);
      // One the cast holds is briefed when it is a principal on stage; one it does not hold, when its name is on stage as written.
      return c === undefined ? named.has(nameKey(n)) : principals.has(c.id) && stood.has(c.id);
    }),
  );
}
