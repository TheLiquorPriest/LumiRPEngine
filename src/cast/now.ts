// The cast at a chat's head as a count reads it (the bootstrap's facts): who the chat knows and as what, and for each principal
// the documents of its base written and its memories, each with who wrote it and whether it came from perceptions. Read through
// the cast's own readers, so what a branch keeps of its source's base and pins is what is counted.

import type { Store } from "../store";
import { castAt } from "./path";
import { type BasePart, baseOf, type Casting, castingInForce, CastRecord, type Character, charactersOf, chatLine } from "./record";

/** One memory of a principal: who wrote it, and whether it names perceptions it came from. */
export interface CastNowMemory {
  id: string;
  /** `own`: written by an agent run (the principal's own agent, which is the only one that writes a memory); `other`: the player's own, or carried by a migration. */
  by: "own" | "other";
  fromPerceptions: boolean;
}

/** A principal with what its record holds at the head. */
export interface CastNowPrincipal {
  character: Character;
  /** The documents of its base that are written. */
  base: BasePart[];
  memories: CastNowMemory[];
}

export interface CastNow {
  /** Every character the chat knows, each with the casting in force at the head (null: none). */
  cast: { character: Character; as: Casting | null }[];
  principals: CastNowPrincipal[];
}

/** The cast at the chat's head, for a chat the store holds or not (a chat it has not met has no rows, so a casting in force is the player's pin alone). */
export function castNow(store: Store, user: string, chat: string): CastNow {
  const u = store.user(user);
  const record = u.chat(chat) === null ? null : CastRecord.read(store, user, castAt(u, chat, null));
  const cast = charactersOf(store.db, user, chatLine(u, chat)).map((character) => ({ character, as: record === null ? character.pinned : (castingInForce(record, character)?.as ?? null) }));
  const principals = cast
    .filter((c) => c.as === "principal")
    .map(({ character }): CastNowPrincipal => ({
      character,
      base: [...baseOf(store.db, user, character.id, chat).keys()],
      memories: (record?.of(character.id, "memory") ?? []).map((m) => ({ id: m.id, by: m.rows[0]?.agent == null ? "other" : "own", fromPerceptions: Array.isArray(m.fields.from) && m.fields.from.length > 0 })),
    }));
  return { cast, principals };
}
