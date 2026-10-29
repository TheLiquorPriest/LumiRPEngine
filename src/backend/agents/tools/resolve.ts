// Names to ids for the agent tools (INC1-SPEC C6): a person, a thing, a place or a track as a model
// wrote it, resolved only among what the view may name (`ToolReadView.sees*`), so one the agent's
// knowledge can't see reads exactly as one that doesn't exist: "No such person here", never a hidden
// name. What a model may write, tried in order, the first that names exactly one winning:
// 1. its id, then its id in any case (a secret track's stand-in id under `pov`);
// 2. its whole name in any case, spaces aside (a place's also as `placeKey` reads it: no article,
//    no punctuation);
// 3. its whole name followed by a mark or a note, as an answer under `everyone` writes it
//    ("Vex Morrow [secret; kept from everyone]");
// 4. words that are all words of one name only ("Danny", "Marcus Delgado's").
// A name that fits several is answered with each of them the view may name, by name and id.

import { placeKey } from "../../../engine/place-names";
import { own } from "../../../engine/pack-kit";
import { TOOL_NOTE } from "../../../shared/agent-tools";
import type { ToolOutcome } from "../runtime";
import type { ToolReadView } from "./read-view";

/** A name resolved to the id it names, or the note the model is answered with. */
export type Resolved = { id: string } | { refused: ToolOutcome };

interface Candidate {
  id: string;
  /** The ids a model may write for it: its own, and under `pov` a secret track's stand-in. */
  ids: readonly string[];
  /** Its names: an entity's or place's name, a track's label (the quest log's under `pov`). */
  names: readonly string[];
  /** How a note lists it: its name as the view gives it, with its id. */
  shown: string;
}

const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
/** A name's words, a possessive's 's aside ("Okafor's" is Okafor). */
const wordsOf = (s: string): string[] => spaced(s).replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");

/** The candidates `said` names, by the first rule that names any (see the header). */
function matches(said: string, candidates: readonly Candidate[], place: boolean): Candidate[] {
  const trimmed = said.trim();
  const lower = trimmed.toLowerCase();
  const rules: ((c: Candidate) => boolean)[] = [
    (c) => c.ids.includes(trimmed),
    (c) => c.ids.some((id) => id.toLowerCase() === lower),
    (c) => c.names.some((n) => spaced(n) === spaced(trimmed) || (place && placeKey(n) !== "" && placeKey(n) === placeKey(trimmed))),
    (c) => c.names.some((n) => spaced(n) !== "" && spaced(trimmed).startsWith(spaced(n)) && /^[\s[({:;,·—-]/.test(spaced(trimmed).slice(spaced(n).length))),
    (c) => {
      const said = wordsOf(trimmed);
      return said.length > 0 && c.names.some((n) => {
        const own = wordsOf(n);
        return said.every((w) => own.includes(w));
      });
    },
  ];
  for (const rule of rules) {
    const found = candidates.filter(rule);
    if (found.length > 0) return found;
  }
  return [];
}

function resolveAmong(view: ToolReadView, said: string, candidates: readonly Candidate[], missing: string, place = false): Resolved {
  const found = matches(said, candidates, place);
  const [one] = found;
  if (one && found.length === 1) return { id: one.id };
  if (found.length > 1) return { refused: view.refuse(TOOL_NOTE.ambiguous, { name: said, matches: found.map((c) => c.shown).join("; ") }) };
  return { refused: view.refuse(missing, { name: said }) };
}

/** The entities the view may name, those `keep` keeps, as candidates. */
function entities(view: ToolReadView, keep: (id: string) => boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const id of Object.keys(view.state.entities)) {
    if (!keep(id)) continue;
    const ref = view.entity(id);
    if (ref) out.push({ id, ids: [id], names: [own(view.state.entities, id)?.name ?? id], shown: `${ref.name} (${id})` });
  }
  return out;
}

/** A person (an entity whose kind is or extends `person`) the view may name. */
export function resolvePerson(view: ToolReadView, said: string): Resolved {
  return resolveAmong(view, said, entities(view, (id) => view.isPerson(id)), TOOL_NOTE.noPerson);
}

/** A thing (any entity that isn't a person: an item, a vehicle, an account, a business) the view may name. */
export function resolveThing(view: ToolReadView, said: string): Resolved {
  return resolveAmong(view, said, entities(view, (id) => !view.isPerson(id)), TOOL_NOTE.noThing);
}

/** Any entity the view may name: a person, or a thing; one that isn't found is told as a thing not found. */
export function resolveEntity(view: ToolReadView, said: string): Resolved {
  return resolveAmong(view, said, entities(view, () => true), TOOL_NOTE.noThing);
}

/** A place the view may name. */
export function resolvePlace(view: ToolReadView, said: string): Resolved {
  const candidates: Candidate[] = [];
  for (const id of Object.keys(view.world.places)) {
    const ref = view.place(id);
    if (ref) candidates.push({ id, ids: [id], names: [own(view.world.places, id)?.name ?? id], shown: `${ref.name} (${id})` });
  }
  return resolveAmong(view, said, candidates, TOOL_NOTE.noPlace, true);
}

/** A track the view may name, by its id (under `pov` the stand-in the quest log knows it by) or its label; resolved to its own id. */
export function resolveTrack(view: ToolReadView, said: string): Resolved {
  const candidates: Candidate[] = [];
  for (const [id, t] of Object.entries(view.world.tracks)) {
    const ref = view.track(id);
    if (!ref) continue;
    // Under `pov` a track goes by the id and the label the quest log gives it, never its own.
    const shown = view.knowledge === "pov";
    candidates.push({ id, ids: shown ? [ref.id] : [id], names: [shown ? ref.name : t.label], shown: `${ref.name} (${ref.id})` });
  }
  return resolveAmong(view, said, candidates, TOOL_NOTE.noTrack);
}
