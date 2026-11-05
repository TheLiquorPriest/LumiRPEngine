// Where the player may put their things (Play → Me → Belongings' Move to…, Add's Where): the where
// picker's choices built in the page from what the player already sees, so nothing they can't know
// is named. The places the place ✎ offers, by their paths; the player character (On you) and the
// people here; and the holders they may put things in: what they carry, what is here and what is at
// their home, each nested in what holds it, with how full it is. A holder already full is held
// back, saying so. The sheet's suggestions (Recent, Kept at, On you, Here and Home) come from the
// same choices; the recent ones are kept per chat in the page's own storage, the last five, and a
// storage the page can't use keeps them for the session. Pure, but for that storage, which is passed in.

import type { PlaceRef } from "../../shared/character";
import type { EntityId, PlaceId } from "../../shared/ids";
import type { Size } from "../../shared/things";
import type { WhereChoice, WhereStep, WhoseView } from "../../shared/thing-view";
import type { WhereSuggestion } from "./where-picker";

/** A holder the player character may put things in: what it takes (null: not known, so nothing is held back), how full it is, and what it is in or where it stands. */
export interface PlayHolder {
  id: EntityId;
  name: string;
  holds: Size | null;
  /** Litres in it and the most it takes, where its capacity is known. */
  load?: { used: number; capacity: number };
  /** What it is in or on: the player character, a person here, or another holder; null when it stands at `place`. */
  in: EntityId | null;
  /** Where it stands when it is in nothing. */
  place: PlaceId | null;
}

/** What the choices are built from: the player character, the largest thing a person carries (null: not known), the places they may know, where they are, the holders and the people here. */
export interface PlayWhereInput {
  pov: { id: EntityId; name: string } | null;
  ceiling: Size | null;
  places: readonly PlaceRef[];
  here: PlaceId | null;
  holders: readonly PlayHolder[];
  people: readonly { id: EntityId; name: string }[];
}

/** Nobody stated or presumed: the player's view names no presumption. */
const NOBODY: WhoseView = { owners: [], presumed: null, at: null };

/**
 * The choices, places first, then the people and the holders: a place by its path through the
 * places the player may know; a person where the player is; a holder under what holds it. One whose
 * place or holder isn't among the choices is at the top, so nothing is lost from browsing.
 */
export function playWhere(input: PlayWhereInput): WhereChoice[] {
  const places = new Map(input.places.map((p) => [p.id, p]));
  const placePath = (id: PlaceId | null): WhereStep[] => {
    const out: WhereStep[] = [];
    const seen = new Set<string>();
    for (let at = id === null ? undefined : places.get(id); at && !seen.has(at.id); at = at.parent === null ? undefined : places.get(at.parent)) {
      seen.add(at.id);
      out.unshift({ id: at.id, name: at.name, is: "place" });
    }
    return out;
  };
  const out: WhereChoice[] = input.places.map((p) => ({ id: p.id, is: "place", name: p.name, path: placePath(p.parent), parent: p.parent, holds: null, vehicle: false, whose: null, presumes: NOBODY, secret: false }));
  const herePath = placePath(input.here);
  const person = (who: { id: EntityId; name: string }): WhereChoice => ({ id: who.id, is: "person", name: who.name, path: herePath, parent: input.here, holds: input.ceiling, vehicle: false, whose: null, presumes: NOBODY, secret: false });
  const people = [...(input.pov ? [input.pov] : []), ...input.people.filter((p) => p.id !== input.pov?.id)];
  const steps = new Map<string, WhereStep[]>(people.map((p) => [p.id, [...herePath, { id: p.id, name: p.name, is: "person" as const }]]));
  out.push(...people.map(person));
  const holders = new Map(input.holders.map((h) => [h.id, h]));
  // A holder's path: the places and holders around it, outermost first, each once however they nest.
  const pathOf = (h: PlayHolder, seen: ReadonlySet<string>): WhereStep[] => {
    if (h.in === null) return placePath(h.place);
    const around = steps.get(h.in);
    if (around) return around;
    const parent = holders.get(h.in);
    if (!parent || seen.has(parent.id)) return [];
    return [...pathOf(parent, new Set([...seen, parent.id])), { id: parent.id, name: parent.name, is: "thing" }];
  };
  const whose: WhoseView | null = input.pov ? { owners: [{ id: input.pov.id, name: input.pov.name, is: "person" }], presumed: null, at: null } : null;
  for (const h of input.holders) out.push({ id: h.id, is: "thing", name: h.name, path: pathOf(h, new Set([h.id])), parent: h.in ?? h.place, holds: h.holds, vehicle: false, whose, presumes: NOBODY, secret: false });
  return out;
}

/** Why a holder can't take more: it is full, by its load; null when it isn't, or its load isn't known. */
export function fullWhy(holder: Pick<PlayHolder, "load"> | undefined): string | null {
  const load = holder?.load;
  if (!load || load.capacity <= 0 || load.used < load.capacity) return null;
  return `Full: ${load.used} of ${load.capacity} l`;
}

/** The page's storage the recent targets are kept in. */
export interface RecentStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** How many recent targets a chat keeps. */
export const RECENT_MAX = 5;

const recentKey = (chatId: string): string => `lre:things:recent:${chatId}`;

/** A chat's recent targets, newest first. */
export function recentMoves(store: RecentStore, chatId: string): string[] {
  try {
    const raw: unknown = JSON.parse(store.get(recentKey(chatId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** A target used: first of the chat's recent ones, the oldest past `RECENT_MAX` dropped; the list kept. */
export function rememberMove(store: RecentStore, chatId: string, id: string): string[] {
  const next = [id, ...recentMoves(store, chatId).filter((x) => x !== id)].slice(0, RECENT_MAX);
  store.set(recentKey(chatId), JSON.stringify(next));
  return next;
}

const sessionRecent = new Map<string, string>();

/** The page's local storage, or, where it is blocked (a private window, a sandboxed frame), this session's. */
export const pageStore: RecentStore = {
  get(key) {
    try {
      return localStorage.getItem(key) ?? sessionRecent.get(key) ?? null;
    } catch {
      return sessionRecent.get(key) ?? null;
    }
  },
  set(key, value) {
    sessionRecent.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      // Blocked storage: the session's copy holds them.
    }
  },
};

/**
 * Move to…'s suggestions: each recent target still among the choices, then On you, Here and Home,
 * each once; a target already suggested isn't again. (Kept at is the sheet's own choice: it puts
 * each thing back where it is kept.)
 */
export function moveSuggestions(choices: readonly WhereChoice[], at: { recent: readonly string[]; pov: EntityId | null; here: PlaceId | null; home: PlaceId | null }): WhereSuggestion[] {
  const byId = new Map(choices.map((c) => [c.id, c]));
  const out: WhereSuggestion[] = [];
  const seen = new Set<string>();
  const add = (label: string, id: string | null): void => {
    const choice = id === null ? undefined : byId.get(id);
    if (!choice || seen.has(choice.id)) return;
    seen.add(choice.id);
    out.push({ label, choice });
  };
  for (const id of at.recent) add(`Recent: ${byId.get(id)?.name ?? id}`, id);
  add("On you", at.pov);
  add(`Here: ${byId.get(at.here ?? "")?.name ?? ""}`, at.here);
  add(`Home: ${byId.get(at.home ?? "")?.name ?? ""}`, at.home);
  return out;
}
