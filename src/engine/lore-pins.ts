// Lore pinned to characters, places and steps (DESIGN §24.5, §5.4): which pins a call reads, nearest
// first, and how pinned text is given within the call's lore tokens. Pure: the backend reads a book's
// text from the host and hands it in. Who may read a world entry is the lore search's rule
// (`loreReadable`), so a pin never widens it: a secret or Known by entry reaches a call only when its
// reader may read it, and an AI-written entry still waiting for review reaches none.

import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { loreIsSecret, lorePinKey, lorePinsOf } from "../shared/lore";
import type { LoreEntryDef, LoreKeep, LorePin, StepPurpose, WorldDoc } from "../shared/world";
import { loreSnippet, type LoreReader } from "./lore";
import { own } from "./pack-kit";
import { loreGateReader } from "./visibility";

/** How far up the places holding a place its pins are looked for. */
const CHAIN_MAX = 16;

/** A place and the places holding it, nearest first; a loop of parents stops where it closes. */
export function placeChain(world: Pick<WorldDoc, "places">, place: PlaceId | null): PlaceId[] {
  const out: PlaceId[] = [];
  for (let at = place ?? undefined; at !== undefined && hasOwn(world.places, at) && !out.includes(at) && out.length < CHAIN_MAX; at = world.places[at]?.parent) out.push(at);
  return out;
}

/** A pin and where it is pinned: to a character, to a place a call is at or inside, or to the call's step. */
export interface PinRef {
  key: string;
  pin: LorePin;
  on: { character: EntityId } | { place: PlaceId } | { step: StepPurpose };
}

/**
 * The pins a call reads (DESIGN §24.5): `who`'s own first (a mind's), then each of `steps`' in
 * order (every call of that step), then those of `place` and of each place holding it, nearest
 * first; an entry or book pinned twice is read once, where it comes first.
 */
export function pinsFor(world: WorldDoc, place: PlaceId | null, who?: EntityId, steps: readonly StepPurpose[] = []): PinRef[] {
  const pins = lorePinsOf(world);
  const out: PinRef[] = [];
  const seen = new Set<string>();
  const add = (list: readonly LorePin[] | undefined, on: PinRef["on"]): void => {
    for (const pin of list ?? []) {
      const key = lorePinKey(pin);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, pin, on });
    }
  };
  if (who !== undefined) add(own(pins.characters, who), { character: who });
  for (const step of steps) add(pins.steps[step], { step });
  for (const at of placeChain(world, place)) add(own(pins.places, at), { place: at });
  return out;
}

/** A pinned entry with its text as read now: one of the world's (`entry`, whose secrecy applies), or a book's (`entry` null), and the part of it a cut keeps. */
export interface PinnedText {
  key: string;
  on: PinRef["on"];
  title: string;
  content: string;
  entry: LoreEntryDef | null;
  keep: LoreKeep;
}

/** A pinned world entry as text; null for a book's pin, or one naming an entry the world doesn't have (lint names it). */
export function worldPinText(world: WorldDoc, ref: PinRef): PinnedText | null {
  if (!("lore" in ref.pin)) return null;
  const entry = own(world.lore, ref.pin.lore);
  return entry ? { key: ref.key, on: ref.on, title: typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : ref.pin.lore, content: typeof entry.content === "string" ? entry.content : "", entry, keep: ref.pin.keep ?? "start" } : null;
}

/** A pinned entry as a call was given it (`snippet`), or left out over its lore tokens (`snippet` null). */
export interface PinGiven {
  key: string;
  title: string;
  entry: LoreEntryDef | null;
  snippet: string | null;
  tokens: number;
  cut: boolean;
  /** A secret world entry whose gate doesn't hold: it stays off every player surface. */
  secret: boolean;
}

/**
 * Pinned entries within `budget` tokens, in order (DESIGN §24.5): each as `Title: text`, cut at a
 * word to what is left, or left out once not even its title and a few words fit. `readable` says
 * whether the call's reader may read a world entry: one it may not read isn't given, nor listed.
 */
export function fitPins(r: LoreReader, texts: readonly PinnedText[], budget: number, readable: (entry: LoreEntryDef) => boolean): PinGiven[] {
  const open = loreGateReader(r.reg, r.world, r.state);
  const out: PinGiven[] = [];
  let left = Math.max(0, Math.floor(budget));
  for (const t of texts) {
    if (t.entry !== null && !readable(t.entry)) continue;
    const secret = t.entry !== null && loreIsSecret(t.entry) && !open(t.entry);
    const snippet = loreSnippet((text) => r.tokens(text), { title: t.title, content: t.content }, left, t.keep);
    if (!snippet) {
      out.push({ key: t.key, title: t.title, entry: t.entry, snippet: null, tokens: 0, cut: false, secret });
      continue;
    }
    left -= snippet.tokens;
    out.push({ key: t.key, title: t.title, entry: t.entry, snippet: snippet.text, tokens: snippet.tokens, cut: snippet.cut, secret });
  }
  return out;
}
