// Finding things by words in a chat's folded state (plan §6.8 `world_search`): people, things,
// places and groups, by their names, their other names, their kind, their description and the
// agents' own lines on them. Code matches words; it never judges what words mean. Whole names
// first, then names holding every word, then names holding some, then the rest of what is said of
// them. This is one `StateSearch`; the state lane's full-text index is another, behind the same face.

import type { WorldDoc } from "../shared/world";
import { placeAliases } from "../engine/place-names";
import { isGone, kindDef, kindIs } from "../engine/scope";
import type { FoldEnv } from "../store/fold";
import type { StoreState } from "../store/types";
import type { SearchKind, StateHit, StateSearch } from "./kit";

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** How well `said`'s words meet a text: 4 the whole of it, 3 every word, 2 some word; 0 none. */
function meets(said: readonly string[], text: string, whole: string): number {
  const own = wordsOf(text);
  if (own.length === 0) return 0;
  if (own.join(" ") === whole) return 4;
  if (said.every((w) => own.includes(w))) return 3;
  return said.some((w) => own.includes(w)) ? 2 : 0;
}

export const stateScan: StateSearch = {
  search(state: StoreState, env: FoldEnv, words: string, opts: { kind?: SearchKind; limit: number }): StateHit[] {
    const said = wordsOf(words);
    if (said.length === 0) return [];
    const whole = said.join(" ");
    const doc = env.worlds(state.world.revision);
    if (doc === undefined) return [];
    const ctx = env.registry.context(doc, state.world);
    const world: WorldDoc = ctx.world;
    const scored: { hit: StateHit; score: number }[] = [];
    const consider = (hit: Omit<StateHit, "matched">, names: readonly string[], said2: readonly [string, string][]): void => {
      let best = 0;
      let matched = "";
      for (const [i, n] of names.entries()) {
        const s = meets(said, n, whole);
        if (s > best) {
          best = s;
          matched = i === 0 ? "name" : "other name";
        }
      }
      // What else is said of it counts below any name.
      if (best === 0) {
        for (const [what, text] of said2) {
          if (meets(said, text, whole) > 0) {
            best = 1;
            matched = what;
            break;
          }
        }
      }
      if (best > 0) scored.push({ hit: { ...hit, matched }, score: best });
    };
    if (opts.kind === undefined || opts.kind === "place") {
      for (const [id, p] of Object.entries(world.places)) {
        const description = typeof p.fields.description === "string" ? p.fields.description : "";
        consider({ ref: `place:${id}`, name: p.name, what: "place", ...(p.parent !== undefined ? { where: `place:${p.parent}` } : {}) }, [p.name, ...placeAliases(p)], [["description", description], ["note", state.notes[`place:${id}`]?.text ?? ""]]);
      }
    }
    if (opts.kind !== "place") {
      for (const [id, e] of Object.entries(state.world.entities)) {
        if (isGone(state.world, id)) continue;
        const person = kindIs(env.registry, doc, e.kind, "person");
        const group = kindIs(env.registry, doc, e.kind, "group");
        const kind: SearchKind = person ? "person" : group ? "group" : "thing";
        if (opts.kind !== undefined && opts.kind !== kind) continue;
        const label = kindDef(env.registry, doc, e.kind)?.label ?? e.kind;
        const aliases = Array.isArray(e.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
        const holder = e.relations.find((r) => r.type === "in")?.to;
        const place = typeof e.fields.place === "string" ? e.fields.place : undefined;
        const where = holder !== undefined ? `entity:${holder}` : place !== undefined ? `place:${place}` : undefined;
        const description = typeof e.fields.description === "string" ? e.fields.description : "";
        consider({ ref: `entity:${id}`, name: e.name, what: label, ...(where !== undefined ? { where } : {}) }, [e.name, ...aliases], [["kind", label], ["description", description], ["note", state.notes[`entity:${id}`]?.text ?? ""]]);
      }
    }
    scored.sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name) || a.hit.ref.localeCompare(b.hit.ref));
    return scored.slice(0, Math.max(0, opts.limit)).map((s) => s.hit);
  },
};
