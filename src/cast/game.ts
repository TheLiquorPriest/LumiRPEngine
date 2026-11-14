// A character's game side (plan §7.1): not kept in the cast, but by reference to the world state,
// which holds where the person is, what they have on them, their coin and their condition. The world's
// person a cast character is, is found by name, as a secret's holder is (`secrets.ts`): the cast keeps
// no other link to the world's people yet. Where the store holds no one by that name, or more than one,
// there is no game side to give. What is shown is the world state's own tree (`store/view.ts`): the
// level's reference, the places it sits in, what is in it, and each value the tree gives it, by key.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Store } from "../store";
import { personNamed } from "./secrets";

/** The game side of the world's person a character is, at a turn (null: the chat's head), as layout fields; null when the store holds no one by that name, or several. */
export function gameSide(store: Store, user: string, chat: string, turn: string | null, name: string): Record<string, JsonValue> | null {
  const u = store.user(user);
  const state = (turn === null ? u.headState(chat) : u.stateAt(turn)).state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) return null;
  const found = personNamed(store.env.registry.context(doc, state), name);
  if (!("id" in found)) return null;
  const view = turn === null ? u.view(chat) : u.viewAt(turn);
  const node = view.node(`entity:${found.id}`);
  if (node === null) return null;
  // The places, and anyone or anything, they are in, nearest first.
  const where: string[] = [];
  for (let at = node.parent; at !== null && (at.startsWith("place:") || at.startsWith("entity:")); at = view.parentOf(at)) {
    const named = view.nameOf(at);
    if (named !== null) where.push(named);
  }
  const holds: JsonObject[] = node.children.flatMap((ref) => {
    const child = view.node(ref);
    return child === null || child.name === null ? [] : [{ name: child.name, ...(child.what !== null ? { what: child.what } : {}) }];
  });
  const values: JsonObject[] = node.values.flatMap((v) => (v.value === null ? [] : [{ key: v.key, value: v.value }]));
  return {
    ref: node.ref,
    // A list given as an object's own value (`.`): a block on it shows once, and `{{where}}` puts it in joined.
    ...(where.length > 0 ? { where: { ".": where } } : {}),
    ...(holds.length > 0 ? { holds: { items: holds } } : {}),
    ...(values.length > 0 ? { values: { items: values } } : {}),
  };
}
