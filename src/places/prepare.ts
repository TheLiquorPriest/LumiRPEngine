// What a base written in a call is drawn against (plan §7.1): the revision of each lore entry bound to the place as Lumiverse holds it
// now. An operation works out inside the store's own write, which cannot wait for Lumiverse, so the entries are read first, once for the
// call, for each place a call names to write a base of; the operation then takes them from here.

import type { Call } from "../iface/kit";
import type { Asked } from "../iface/apply";
import { Reading, isFound } from "../iface/reading";
import { drawnFrom, sourcesNow } from "./sources";

/** The words of an operation that name a place's base: `base`, or today's `description` (one part, one home). */
export const BASE_KEYS: readonly string[] = ["base", "description"];

const DRAWN = new WeakMap<object, Map<string, Record<string, string>>>();

/** Whether a call's operation writes a place's base: a `set` of one of the base's keys. */
function writesBase(a: Asked): boolean {
  return a.def.name === "set" && typeof a.args.key === "string" && BASE_KEYS.includes(a.args.key.trim()) && typeof a.args.at === "string";
}

/** Reads the entries bound to each place the call writes a base of, as they stand now, and keeps them for the call's operations. */
export async function prepareBases(call: Call, asked: readonly Asked[]): Promise<void> {
  const read = call.deps.placeSources;
  const wanted = asked.filter(writesBase);
  if (read === undefined || wanted.length === 0) return;
  const reading = Reading.of(call);
  if (!(reading instanceof Reading)) return;
  const drawn = new Map<string, Record<string, string>>();
  for (const a of wanted) {
    const found = reading.find(String(a.args.at), "point");
    if (!isFound(found) || !found.ref.startsWith("place:") || drawn.has(found.id)) continue;
    const sources = await sourcesNow(read, { user: call.scope.user, chat: call.scope.chat }, found.id, null);
    drawn.set(found.id, drawnFrom(sources.sources));
  }
  DRAWN.set(call, drawn);
}

/** The revision of each entry bound to `place` as the call's operations are to draw its base against; none where nothing is bound or the call kept none. */
export function drawnAgainst(call: object, place: string): Record<string, string> {
  return DRAWN.get(call)?.get(place) ?? {};
}
