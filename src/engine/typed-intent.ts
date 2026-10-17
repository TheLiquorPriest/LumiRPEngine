// Typed text → an action without a model, for Playtest (engine-only): the action whose lexicon phrase
// the text says (its words in order, with only filler words such as "down" or "back" between them,
// so "walk down to" says "walk to"), with its ref params filled from names said in the text, its first
// required text param from what follows the phrase, and amounts from the first number. Of the
// phrases said, one whose action's required params are all filled wins, then one said exactly, then
// the longest.

import type { JsonObject } from "../shared/json";
import type { ActionDef, WorldDoc } from "../shared/world";
import type { Registry } from "./registry-impl";
import { kindIs } from "./scope";
import type { WorldState } from "./state";
import type { InterpretOutput } from "./steps";
import { canSeeEntity, canSeePlace } from "./visibility";

const STOP = new Set(["the", "a", "an", "to", "of", "at", "my", "your", "and", "with", "about", "for", "in", "on", "some", "over", "up", "down"]);

/** Words a typed line may put inside a lexicon phrase ("walk down to", "head back over to"). */
const FILLER = new Set(["down", "up", "over", "back", "out", "across", "along", "around", "right", "straight", "on", "off", "just"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The candidate whose name shares the most words with what was said (none when nothing is shared). */
function byName(said: ReadonlySet<string>, pool: readonly { id: string; name: string }[]): string | null {
  let best: { id: string; n: number } | null = null;
  for (const c of pool) {
    const n = words(c.name).filter((w) => said.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: c.id, n };
  }
  return best?.id ?? null;
}

/**
 * Where `phrase` is said in `tokens` (the text's lowercase words): its words in order, from some
 * start, with only filler words between them. The token index just past it and how many fillers it
 * skipped, or null.
 */
function phraseAt(tokens: readonly string[], phrase: readonly string[]): { end: number; skipped: number } | null {
  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start] !== phrase[0]) continue;
    let at = start + 1;
    let skipped = 0;
    let k = 1;
    for (; k < phrase.length; k++) {
      while (at < tokens.length && tokens[at] !== phrase[k] && FILLER.has(tokens[at] ?? "")) {
        at++;
        skipped++;
      }
      if (tokens[at] !== phrase[k]) break;
      at++;
    }
    if (k === phrase.length) return { end: at, skipped };
  }
  return null;
}

export function typedIntent(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string): InterpretOutput | null {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "");
  const actions = new Map<string, ActionDef>();
  for (const [id, a] of reg.actions) actions.set(id, a);
  for (const [id, a] of Object.entries(world.actions)) actions.set(id, a);
  const named = new Set(words(text));
  const pov = world.pov;
  let best: { action: ActionDef; params: JsonObject; filled: boolean; skipped: number; length: number } | null = null;
  for (const action of actions.values()) {
    for (const raw of action.lexicon ?? []) {
      const phrase = raw.trim().toLowerCase();
      if (phrase.length <= 2) continue;
      const at = phraseAt(tokens, phrase.split(/[^a-z0-9]+/).filter((w) => w !== ""));
      if (!at) continue;
      const rest = words(tokens.slice(at.end).join(" ")).join(" ");
      const params: JsonObject = {};
      let textFilled = false;
      const ordered = Object.entries(action.params).sort(([, a], [, b]) => Number(a.optional === true) - Number(b.optional === true));
      for (const [name, def] of ordered) {
        if (def.type === "ref") {
          const pool =
            def.ref === "place"
              ? Object.values(world.places).filter((p) => canSeePlace(world, state, pov, p.id))
              : Object.entries(state.entities)
                  .filter(([id, e]) => id !== pov && canSeeEntity(world, state, pov, id) && (!def.ref || kindIs(reg, world, e.kind, def.ref)))
                  .map(([id, e]) => ({ id, name: e.name }));
          const id = byName(named, pool);
          if (id) params[name] = id;
        } else if (def.type === "text" && !textFilled && def.optional !== true && rest !== "") {
          params[name] = rest;
          textFilled = true;
        } else if (def.type === "money" || def.type === "number" || def.type === "duration") {
          const m = /(\d+(?:\.\d+)?)/.exec(text);
          if (m) params[name] = def.type === "money" ? Math.round(Number(m[1]) * 100) : Number(m[1]);
        }
      }
      const filled = Object.entries(action.params).every(([name, def]) => def.optional === true || params[name] !== undefined);
      const better = !best || (filled !== best.filled ? filled : at.skipped !== best.skipped ? at.skipped < best.skipped : phrase.length > best.length);
      if (better) best = { action, params, filled, skipped: at.skipped, length: phrase.length };
    }
  }
  return best ? { action: best.action.id, params: best.params, probabilities: { [best.action.id]: 1 } } : null;
}
