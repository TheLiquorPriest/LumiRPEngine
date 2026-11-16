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
import type { JsonObject } from "../shared/json";
import { baseOf, bindingsOf, type Character, castingInForce, CASTINGS, CastRecord, charactersOf, chatLine, findCharacter, nameKey } from "./record";
import { type SourceReader, sourcesNow } from "./sources";

/** The groups a count breaks down into: each casting, and those on stage the cast has not cast on this path (or does not hold). */
export const UNPERCEIVED_GROUPS = [...CASTINGS, "uncast"] as const;

/** How a stage was read: the open scene the Author recorded, where the owner's character stands (no scene recorded), or not recorded at all. */
export type StageHow = "scene" | "owner" | "none";

/** Who was on stage in one turn, by name or cast id, and how that was read. */
export interface StageRead {
  who: readonly string[];
  how: StageHow;
}

/**
 * Who was on stage in each of `turns`, and how that was read: the host's to say (the turn lane, from the scene the turn was played in
 * and the state it left, R-56). A turn it holds no stage for is left out of the map.
 */
export type OnStage = (scope: { user: string; chat: string }, turns: readonly string[]) => Promise<ReadonlyMap<string, StageRead>>;

/** The cast's facts as the Rules page lists them. */
export const CAST_FACT_DEFS: readonly FactDef[] = [
  {
    name: "stage.unperceived",
    counts: "Characters on stage this turn with no perception of it recorded, by casting; read: how the stage was read (scene: the open scene and who the state places in its place; owner: no scene recorded, who the state places where the owner's character is; none: not recorded).",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["read"],
  },
  {
    name: "path.unperceived",
    counts: "Characters on stage in earlier turns on the chat's path with no perception of that turn recorded, each counted once, by casting; messages: those turns' replies; read: how many of those turns' stages were read each way (scene, owner, none).",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["messages", "read"],
  },
  {
    name: "cast.base.older",
    counts: "Characters whose base is older than a source bound to them (a card, a persona, a lore entry or a memory entity that changed or went since the base was drawn); sources: each with the character, the source and the aspect of the character it defines.",
    fields: ["sources"],
  },
  { name: "cast.growth.proposed", counts: "Characters with growth a reflection proposed that the Author has not accepted." },
];

/** Each character whose base is older than a source bound to it, with the source and the aspect it defines, as the sources stand now in Lumiverse. */
async function baseOlder(deps: { store: Store; sources: SourceReader }, scope: Scope, chats: readonly string[]): Promise<FactValue> {
  const { db } = deps.store;
  const who: string[] = [];
  const sources: JsonObject[] = [];
  for (const character of charactersOf(db, scope.user, chats)) {
    const bindings = bindingsOf(db, scope.user, character.id);
    if (bindings.length === 0) continue;
    const states = await sourcesNow(deps.sources, { user: scope.user, chat: scope.chat }, bindings, baseOf(db, scope.user, character.id).values());
    const older = states.filter((s) => s.newer);
    if (older.length === 0) continue;
    who.push(character.name);
    for (const s of older) sources.push({ who: character.name, kind: s.kind, id: s.ref, ...(s.defines !== null ? { defines: s.defines } : {}), ...(s.title !== null ? { title: s.title } : { gone: true }) });
  }
  return { count: who.length, names: who, fields: { sources } };
}

/** The characters with growth proposed and not accepted on the reading. */
function growthProposed(record: CastRecord, characters: readonly Character[]): FactValue {
  const names = characters.filter((c) => record.of(c.id, "growth").some((g) => g.fields.proposed === true)).map((c) => c.name);
  return { count: names.length, names };
}

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

/** How many of the turns counted had their stage read each way. */
function readsOf(hows: readonly StageHow[]): Record<StageHow, number> {
  return { scene: hows.filter((h) => h === "scene").length, owner: hows.filter((h) => h === "owner").length, none: hows.filter((h) => h === "none").length };
}

/** `stage.unperceived` and `path.unperceived`, counted from the cast and from who `onStage` says was there. */
export function castFacts(deps: { store: Store; onStage: OnStage; sources: SourceReader }): CastFacts {
  return {
    area: "cast",
    defs: CAST_FACT_DEFS,
    async read(scope, names) {
      const user = deps.store.user(scope.user);
      const wanted = { stage: names.includes("stage.unperceived"), path: names.includes("path.unperceived"), older: names.includes("cast.base.older"), proposed: names.includes("cast.growth.proposed") };
      // A chat RPE has not met yet has no one on stage and no character: every count is 0.
      if (user.chat(scope.chat) === null) {
        return {
          ...(wanted.stage ? { "stage.unperceived": valueOf([], { read: "none" }) } : {}),
          ...(wanted.path ? { "path.unperceived": valueOf([], { messages: [], read: readsOf([]) }) } : {}),
          ...(wanted.older ? { "cast.base.older": { count: 0, names: [], fields: { sources: [] } } } : {}),
          ...(wanted.proposed ? { "cast.growth.proposed": { count: 0, names: [] } } : {}),
        };
      }
      const turn = scope.turn ?? null;
      const at = castAt(user, scope.chat, turn);
      const record = CastRecord.read(deps.store, scope.user, at);
      const earlier = at.turns.filter((t) => t !== turn);
      const asked = [...(wanted.stage && turn !== null ? [turn] : []), ...(wanted.path ? earlier : [])];
      const stage = asked.length === 0 ? new Map<string, StageRead>() : await deps.onStage({ user: scope.user, chat: scope.chat }, asked);

      const perceived = new Set<string>();
      for (const item of record.items.values()) if (item.part === "perception" && !item.dropped) perceived.add(`${perceivedTurn(item)}\n${item.character}`);
      const chats = chatLine(user, scope.chat);
      const known = new Map<string, Character | null>();
      const gapsIn = (turns: readonly string[]): Gap[] => {
        const out = new Map<string, Gap>();
        for (const t of turns) {
          for (const said of stage.get(t)?.who ?? []) {
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
      if (wanted.stage) values["stage.unperceived"] = valueOf(turn === null ? [] : gapsIn([turn]), { read: (turn === null ? null : stage.get(turn)?.how) ?? "none" });
      if (wanted.path) {
        const gaps = gapsIn(earlier);
        const messages = [...new Set(gaps.flatMap((g) => g.turns.map((t) => at.replyOf(t)).filter((m): m is number => m !== null)))].sort((a, b) => a - b);
        values["path.unperceived"] = valueOf(gaps, { messages, read: readsOf(earlier.map((t) => stage.get(t)?.how ?? "none")) });
      }
      if (wanted.older) {
        try {
          values["cast.base.older"] = await baseOlder(deps, scope, chats);
        } catch {
          // Lumiverse cannot be read now: this fact is left out, as a fact the host cannot give is.
        }
      }
      if (wanted.proposed) values["cast.growth.proposed"] = growthProposed(record, charactersOf(deps.store.db, scope.user, chats));
      return values;
    },
  };
}
