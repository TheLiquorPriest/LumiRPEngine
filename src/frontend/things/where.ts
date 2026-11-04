// What the where picker reads (ITEMS-SPEC §10.1, "Where is it?"): every place, person and holder
// indexed once by what it is in and by the words of its name and of where it is, so a search and a
// browse level are each one pass; a choice in words ("Toolbox (Jordan Ellis's, at Alder
// Automotive)"); and why a thing of a size can't go somewhere. Pure, so the picker's tests read it
// directly.

import type { SizeClass } from "../../shared/things";
import { SIZE_LABELS, sizeRank } from "../../shared/things";
import type { WhereChoice, WhereStep } from "../../shared/thing-view";
import { whoseWords } from "../../shared/thing-view";
import { wordsOf } from "../character/places";

/** Every choice by id, what is in each (null: at the top), and each one's words. */
export interface WhereIndex {
  byId: ReadonlyMap<string, WhereChoice>;
  children: ReadonlyMap<string | null, readonly WhereChoice[]>;
  words: ReadonlyMap<string, { name: readonly string[]; around: readonly string[] }>;
}

const ORDER: Readonly<Record<WhereChoice["is"], number>> = { place: 0, person: 1, thing: 2 };

export function whereIndex(choices: readonly WhereChoice[]): WhereIndex {
  const byId = new Map(choices.map((c) => [c.id, c]));
  const children = new Map<string | null, WhereChoice[]>();
  const words = new Map<string, { name: string[]; around: string[] }>();
  for (const c of choices) {
    // A parent the list doesn't have makes the choice a top one, so nothing is lost from browsing.
    const parent = c.parent !== null && byId.has(c.parent) ? c.parent : null;
    const list = children.get(parent);
    if (list) list.push(c);
    else children.set(parent, [c]);
    words.set(c.id, { name: wordsOf(c.name), around: c.path.flatMap((s) => wordsOf(s.name)) });
  }
  for (const list of children.values()) list.sort((a, b) => ORDER[a.is] - ORDER[b.is] || a.name.localeCompare(b.name));
  return { byId, children, words };
}

/** A search shows at most this many: past it, another word narrows faster than scrolling would. */
export const WHERE_LIMIT = 60;

/**
 * The choices whose name or whereabouts have every word of the query (each a word's beginning):
 * those with every word in their own name first, then places before people before holders, then
 * the shallower, then by name. At most `WHERE_LIMIT`.
 */
export function searchWhere(index: WhereIndex, query: string): WhereChoice[] {
  const want = wordsOf(query);
  if (want.length === 0) return [];
  const hits: { choice: WhereChoice; own: boolean }[] = [];
  for (const choice of index.byId.values()) {
    const w = index.words.get(choice.id);
    if (!w) continue;
    const inName = (q: string): boolean => w.name.some((n) => n.startsWith(q));
    if (!want.every((q) => inName(q) || w.around.some((n) => n.startsWith(q)))) continue;
    hits.push({ choice, own: want.every(inName) });
  }
  hits.sort((a, b) => Number(b.own) - Number(a.own) || ORDER[a.choice.is] - ORDER[b.choice.is] || a.choice.path.length - b.choice.path.length || a.choice.name.localeCompare(b.choice.name));
  return hits.slice(0, WHERE_LIMIT).map((h) => h.choice);
}

/** Where a step is, as "at 114 Harbor Street", "on Jordan Ellis" or "in Wallet" says it. */
export function stepWords(step: WhereStep): string {
  return `${step.is === "place" ? "at" : step.is === "person" ? "on" : "in"} ${step.name}`;
}

/** A place, holder or person with the places and holders around it, outermost first: "Port Alder › 114 Harbor Street › Jordan Ellis". */
export function pathText(steps: readonly WhereStep[]): string {
  return steps.map((s) => s.name).join(" › ");
}

/** A choice in words: a place by its name; a person with where they are; a holder with whose it is and where. */
export function whereLabel(choice: WhereChoice): string {
  const at = choice.path.at(-1);
  if (choice.is === "place") return choice.name;
  if (choice.is === "person") return at ? `${choice.name} (${stepWords(at)})` : choice.name;
  const whose = choice.whose && choice.whose.owners.length > 0 ? whoseWords(choice.whose) : null;
  const parts = [whose, at ? stepWords(at) : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? `${choice.name} (${parts.join(", ")})` : choice.name;
}

/**
 * Why a thing of `size` can't go to `choice` (ITEMS-SPEC §3.2), in words, or null when it can: a
 * place takes anything; only a vehicle takes a vehicle; a person carries up to the ceiling; a
 * holder takes up to its size. A part or a Built-in thing is part of what holds it, and a size
 * nothing gives counts as fitting.
 */
export function cannotHold(choice: WhereChoice, size: SizeClass | null): string | null {
  if (choice.is === "place" || choice.holds === null || size === null || size === "unknown" || size === "part" || size === "builtin") return null;
  if (size === "vehicle") return choice.vehicle ? null : "Only a vehicle takes a vehicle";
  if (sizeRank(size) <= sizeRank(choice.holds)) return null;
  return choice.is === "person" ? `Too big to carry: a person carries up to ${SIZE_LABELS[choice.holds]}` : `Takes things up to ${SIZE_LABELS[choice.holds]}`;
}
