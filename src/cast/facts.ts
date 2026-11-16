// The neutral count (plan §7.3, §5.4 "Facts"): for a turn, who was on stage and has no perception of
// it recorded, each with their casting. Two facts, given to the turn lane's facts registry the way
// its own are (`src/turn/facts.ts`, `FactSource`): `stage.unperceived`, this turn; and
// `path.unperceived`, the earlier turns on the path. Each counts everyone, grouped by casting, with
// the names it counts (`names`, and per casting `namesBy`), so a rule's header picks the castings it
// cares about. Who was on stage is the caller's to say. Code decides nothing about whose perceptions
// matter, and holds nothing back for a missing one: it counts.

import type { FactDef, FactValue, Scope } from "rp-harness/contract";
import type { Store } from "../store";
import { castAt } from "./path";
import { perceivedTurn } from "./perceive";
import { type Character, castingInForce, CASTINGS, CastRecord, chatLine, findCharacter, nameKey } from "./record";

/** The groups a count breaks down into: each casting, and those on stage the cast has not cast on this path (or does not hold). */
export const UNPERCEIVED_GROUPS = [...CASTINGS, "uncast"] as const;

/**
 * Who was on stage in each of `turns`, by name or cast id: the host's to say (the turn lane, from
 * the scene the turn was played in). A turn it holds no stage for is left out of the map, or maps to
 * no one.
 */
export type OnStage = (scope: { user: string; chat: string }, turns: readonly string[]) => Promise<ReadonlyMap<string, readonly string[]>>;

/** The cast's facts as the Rules page lists them. */
export const CAST_FACT_DEFS: readonly FactDef[] = [
  { name: "stage.unperceived", counts: "Characters on stage this turn with no perception of it recorded, by casting.", by: [...UNPERCEIVED_GROUPS] },
  {
    name: "path.unperceived",
    counts: "Characters on stage in earlier turns on the chat's path with no perception of that turn recorded, each counted once, by casting; messages: those turns' replies.",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["messages"],
  },
];

/** The cast's facts, in the shape the turn lane's facts registry takes an area's (`FactSource`). */
export interface CastFacts {
  area: "cast";
  defs: readonly FactDef[];
  read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>>;
}

/** Who on a stage has no perception of a turn, each once: their name, casting group, and the turns. */
interface Gap {
  name: string;
  group: (typeof UNPERCEIVED_GROUPS)[number];
  turns: string[];
}

function valueOf(gaps: readonly Gap[], fields?: FactValue["fields"]): FactValue {
  const by: Record<string, number> = {};
  const namesBy: Record<string, string[]> = {};
  for (const group of UNPERCEIVED_GROUPS) {
    namesBy[group] = gaps.filter((g) => g.group === group).map((g) => g.name);
    by[group] = namesBy[group].length;
  }
  return { count: gaps.length, names: gaps.map((g) => g.name), by, namesBy, ...(fields !== undefined ? { fields } : {}) };
}

/** `stage.unperceived` and `path.unperceived`, counted from the cast and from who `onStage` says was there. */
export function castFacts(deps: { store: Store; onStage: OnStage }): CastFacts {
  return {
    area: "cast",
    defs: CAST_FACT_DEFS,
    async read(scope, names) {
      const user = deps.store.user(scope.user);
      const wanted = { stage: names.includes("stage.unperceived"), path: names.includes("path.unperceived") };
      // A chat RPE has not met yet has no one on stage: every count is 0.
      if (user.chat(scope.chat) === null) return { ...(wanted.stage ? { "stage.unperceived": valueOf([]) } : {}), ...(wanted.path ? { "path.unperceived": valueOf([], { messages: [] }) } : {}) };
      const turn = scope.turn ?? null;
      const at = castAt(user, scope.chat, turn);
      const record = CastRecord.read(deps.store, scope.user, at);
      const earlier = at.turns.filter((t) => t !== turn);
      const asked = [...(wanted.stage && turn !== null ? [turn] : []), ...(wanted.path ? earlier : [])];
      const stage = asked.length === 0 ? new Map<string, readonly string[]>() : await deps.onStage({ user: scope.user, chat: scope.chat }, asked);

      const perceived = new Set<string>();
      for (const item of record.items.values()) if (item.part === "perception" && !item.dropped) perceived.add(`${perceivedTurn(item)}\n${item.character}`);
      const chats = chatLine(user, scope.chat);
      const known = new Map<string, Character | null>();
      const gapsIn = (turns: readonly string[]): Gap[] => {
        const out = new Map<string, Gap>();
        for (const t of turns) {
          for (const said of stage.get(t) ?? []) {
            if (!known.has(said)) known.set(said, findCharacter(deps.store.db, scope.user, chats, said));
            const character = known.get(said) ?? null;
            if (character !== null && perceived.has(`${t}\n${character.id}`)) continue;
            const key = character?.id ?? `name:${nameKey(said)}`;
            const gap = out.get(key) ?? { name: character?.name ?? said.trim(), group: (character === null ? null : castingInForce(record, character)?.as) ?? "uncast", turns: [] };
            if (!gap.turns.includes(t)) gap.turns.push(t);
            out.set(key, gap);
          }
        }
        return [...out.values()];
      };

      const values: Record<string, FactValue> = {};
      if (wanted.stage) values["stage.unperceived"] = valueOf(turn === null ? [] : gapsIn([turn]));
      if (wanted.path) {
        const gaps = gapsIn(earlier);
        const messages = [...new Set(gaps.flatMap((g) => g.turns.map((t) => at.replyOf(t)).filter((m): m is number => m !== null)))].sort((a, b) => a - b);
        values["path.unperceived"] = valueOf(gaps, { messages });
      }
      return values;
    },
  };
}
