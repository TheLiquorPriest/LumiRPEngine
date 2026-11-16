// What the story made, as the projection book holds it (plan §9.5): the canon records the story kept about someone (under the names it
// names), and the people it brought into the chat that its world did not hold (each under its name, with where it was last). Read from the
// store's folded state at the chat's head, so what a swipe back, a delete or a branch took off the path is not there. Nothing is written.

import { placeOfEntity } from "../engine/scope";
import { hasOwn } from "../shared/json";
import { storySliceOf } from "../story/fold";
import type { Store } from "../store";
import type { Lore } from "./lore";
import { peopleOf } from "./secrets/holders";
import type { MadeThing } from "./projection";

/** The names a canon record names: a list of texts, or one text, each trimmed, none empty. */
function namesOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list.flatMap((n): string[] => (typeof n === "string" && n.trim() !== "" ? [n.trim()] : []));
}

/** `MadeThing`s of a chat at its head: canon records that name someone, then people the story made. */
export function madeOf(deps: { store: Store; lore: Lore }): (user: string, chat: string) => Promise<MadeThing[]> {
  return async (user, chat) => {
    const s = deps.store.user(user);
    if (s.chat(chat) === null) return [];
    const out: MadeThing[] = [];
    // A canon record about no one has no name for activation to find it by: it stays in the story so far.
    for (const item of Object.values(storySliceOf(s.headState(chat).state).items)) {
      if (item.part !== "canon" || item.dropped) continue;
      const text = typeof item.fields.text === "string" ? item.fields.text.trim() : "";
      const who = namesOf(item.fields.who);
      if (text !== "" && who.length > 0) out.push({ kind: "canon", title: who.join(", "), keys: who, facts: { text, who: who.join(", ") } });
    }
    const at = deps.lore.worldAt({ user, chat });
    if (at === null) return out;
    for (const id of peopleOf(at)) {
      if (hasOwn(at.world.entities, id)) continue;
      const person = at.state.entities[id];
      const place = placeOfEntity(at.state, id);
      const where = place === null ? undefined : (at.world.places[place]?.name ?? at.state.entities[place]?.name ?? place);
      if (person !== undefined && person.name.trim() !== "") out.push({ kind: "person", title: person.name, keys: [person.name], facts: { name: person.name, tier: person.tier, ...(where === undefined ? {} : { place: where }) } });
    }
    return out;
  };
}
