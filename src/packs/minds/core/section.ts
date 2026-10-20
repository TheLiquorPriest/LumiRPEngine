// The narrator's Minds section (DESIGN §24.3): this round's minds for the people at the POV's place
// it can see, and anyone whose mind interrupted a skip; a mind from a time skip's beat only when the
// skip ended on that beat, as the run went past any other. The world's `minds.secrecy` decides what goes:
// `full` gives each monologue and intent, to be depicted and never stated; `brief` gives only the
// depiction, written as behaviour, and only when it carries no unrevealed secret and names no one the
// POV can't see (the screens Stance uses), checked again here whatever was checked when it was
// recorded. Whoever gets a line here is left out of Stance (`minds.minded`); on the section's own
// budget the engine run keeps the best on the ladder (`fitMindLines`), and Stance tells of the rest.

import type { EntityId } from "../../../shared/ids";
import { worldMindsOf } from "../../../shared/minds";
import { acts } from "../../../engine/life";
import { own } from "../../../engine/pack-kit";
import { hiddenNameCheck, playerKnows } from "../../../engine/player-events";
import type { ReadContext } from "../../../engine/registry";
import { isGone, placeOfEntity } from "../../../engine/scope";
import { canSeeEntity, findLeaks, unrevealedSecrets } from "../../../engine/visibility";
import { readSlice } from "./state";

/** One line of the Minds section, and whose mind it tells. */
export interface MindLine {
  entity: EntityId;
  line: string;
}

/** Text as one clause: whitespace collapsed, no trailing full stop. */
function clause(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
}

/** The Minds section's lines this turn, in id order, with whose each is. */
export function mindLines(ctx: ReadContext): MindLine[] {
  const { registry: reg, world, state } = ctx;
  const slice = readSlice(state);
  if (!slice.on) return [];
  const pov = world.pov;
  const here = placeOfEntity(state, pov);
  const secrecy = worldMindsOf(world).secrecy;
  let check: ((text: string) => boolean) | null = null;
  const safe = (text: string): boolean => {
    if (!check) {
      const secrets = unrevealedSecrets(reg, world, state);
      const hidden = hiddenNameCheck(reg, world, state, pov);
      check = (t) => findLeaks(t, secrets).length === 0 && !hidden(t);
    }
    return check(text);
  };
  const out: MindLine[] = [];
  for (const id of Object.keys(slice.chars).sort()) {
    const m = own(slice.chars, id)?.mind;
    const e = own(state.entities, id);
    if (!m || !e || m.round !== slice.round || id === pov || isGone(state, id) || !acts(world, state, id)) continue;
    // An earlier beat of the skip is past: the clock ran on after it.
    if (m.moment === "beat" && m.at !== state.clock) continue;
    const present = here !== null && placeOfEntity(state, id) === here && canSeeEntity(reg, world, state, pov, id);
    if (!present && m.interrupt === null) continue;
    // Someone reaching the POV from elsewhere is named only when the POV knows them.
    const name = present || playerKnows(reg, world, state, pov, id) ? e.name : "Someone";
    if (secrecy === "full") {
      const parts = [`${name}'s mind: ${clause(m.monologue)}.`];
      if (m.intent !== "") parts.push(`Intends: ${clause(m.intent)}.`);
      if (m.reactions.length > 0) parts.push(`Reactions: ${m.reactions.map(clause).join("; ")}.`);
      if (m.mood) parts.push(`Mood: ${clause(m.mood)}.`);
      if (m.depiction !== "") parts.push(`Shows: ${clause(m.depiction)}.`);
      if (m.interrupt) parts.push(`Interrupts the skip: ${clause(m.interrupt)}.`);
      out.push({ entity: id, line: parts.join(" ") });
      continue;
    }
    if (m.withheld || m.depiction.trim() === "" || !safe(m.depiction)) continue;
    const interrupt = m.interrupt && safe(m.interrupt) ? ` Interrupts the skip: ${clause(m.interrupt)}.` : "";
    out.push({ entity: id, line: `${name}: ${clause(m.depiction)}.${interrupt}` });
  }
  return out;
}

/** Who the Minds section tells of this turn: Stance leaves them out. */
export function minded(ctx: ReadContext): EntityId[] {
  return mindLines(ctx).map((l) => l.entity);
}

/**
 * The Minds section's lines that fit its own budget (DESIGN §24.3): the lowest in `order` (best first;
 * anyone it doesn't list is lowest, the later of them first) are left out one by one until the
 * section's `cost` is within `budget`. The lines kept keep their order; none fits, none is kept.
 */
export function fitMindLines(lines: readonly MindLine[], order: readonly EntityId[], budget: number, cost: (kept: readonly MindLine[]) => number): MindLine[] {
  const rank = (id: EntityId): number => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const kept = [...lines];
  while (kept.length > 0 && cost(kept) > budget) {
    let worst = 0;
    kept.forEach((l, i) => {
      if (rank(l.entity) >= rank(kept[worst]?.entity ?? l.entity)) worst = i;
    });
    kept.splice(worst, 1);
  }
  return kept;
}
