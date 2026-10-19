// The narrator's Minds section (DESIGN §24.3): this round's minds for the people at the POV's place
// it can see, and anyone whose mind interrupted a skip. The world's `minds.secrecy` decides what goes:
// `full` gives each monologue and intent, to be depicted and never stated; `brief` gives only the
// depiction, written as behaviour, and only when it carries no unrevealed secret and names no one the
// POV can't see (the screens Stance uses), checked again here whatever was checked when it was
// recorded. Whoever gets a line here is left out of Stance (`minds.minded`).

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
