// A character's game side (plan §7.1): not kept in the cast, but by reference to the world state,
// which holds where the person is, what they have on them, their coin and their condition. The world's
// person a cast character is, is the one its stored reference names (`Character.person`, set at casting,
// by the migration, or by the owner), and the one its name finds where it has none (`secrets.ts`). Where
// the store holds no such person, or the name is several people's, there is no game side to give. What
// is shown is the world state's own tree (`store/view.ts`): the level's reference, the places it sits
// in, what is in it, each value the tree gives it, by key, and what the person owns that is kept
// elsewhere, by the engine's own record of ownership (`thingIndex`), with where each of those is.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { thingIndex } from "../engine/thing-index";
import type { Store, TreeView } from "../store";
import type { Character } from "./record";
import { personOfCharacter } from "./secrets";

/** The names of the levels above `ref` that are places or people or things, nearest first. */
function whereOf(view: TreeView, ref: string): string[] {
  const where: string[] = [];
  for (let at = view.parentOf(ref); at !== null && (at.startsWith("place:") || at.startsWith("entity:")); at = view.parentOf(at)) {
    const named = view.nameOf(at);
    if (named !== null) where.push(named);
  }
  return where;
}

/** Whether `ref` sits somewhere inside `of` in the tree. */
function inside(view: TreeView, ref: string, of: string): boolean {
  for (let at = view.parentOf(ref); at !== null; at = view.parentOf(at)) if (at === of) return true;
  return false;
}

/** The game side of the world's person a character is, at a turn (null: the chat's head), as layout fields; null when the store holds no one it is, or several. */
export function gameSide(store: Store, user: string, chat: string, turn: string | null, character: Pick<Character, "name" | "person">): Record<string, JsonValue> | null {
  const u = store.user(user);
  const state = (turn === null ? u.headState(chat) : u.stateAt(turn)).state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) return null;
  const ctx = store.env.registry.context(doc, state);
  const found = personOfCharacter(ctx, character);
  if (!("id" in found)) return null;
  const view = turn === null ? u.view(chat) : u.viewAt(turn);
  const node = view.node(`entity:${found.id}`);
  if (node === null) return null;
  // The places, and anyone or anything, they are in, nearest first.
  const where = whereOf(view, node.ref);
  const holds: JsonObject[] = node.children.flatMap((ref) => {
    const child = view.node(ref);
    return child === null || child.name === null ? [] : [{ name: child.name, ...(child.what !== null ? { what: child.what } : {}) }];
  });
  const values: JsonObject[] = node.values.flatMap((v) => (v.value === null ? [] : [{ key: v.key, value: v.value }]));
  // What they own that is not on them or in what they carry: a chest left at the inn, with where it is.
  const owns: JsonObject[] = (thingIndex(ctx).owned.get(found.id) ?? []).flatMap((id) => {
    const ref = `entity:${id}`;
    const thing = view.node(ref);
    if (thing === null || thing.name === null || inside(view, ref, node.ref)) return [];
    const at = whereOf(view, ref);
    return [{ name: thing.name, ...(thing.what !== null ? { what: thing.what } : {}), ...(at.length > 0 ? { where: { ".": at } } : {}) }];
  });
  return {
    ref: node.ref,
    // A list given as an object's own value (`.`): a block on it shows once, and `{{where}}` puts it in joined.
    ...(where.length > 0 ? { where: { ".": where } } : {}),
    ...(holds.length > 0 ? { holds: { items: holds } } : {}),
    ...(owns.length > 0 ? { owns: { items: owns } } : {}),
    ...(values.length > 0 ? { values: { items: values } } : {}),
  };
}
