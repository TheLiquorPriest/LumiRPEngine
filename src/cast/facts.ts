// The neutral counts (plan §7.3, §7.4, §5.4 "Facts"), given to the turn lane's facts registry the way its own are (`src/turn/facts.ts`,
// `FactSource`). For a turn, who was on stage and has no perception of it recorded: `stage.unperceived`, this turn; `path.unperceived`,
// the earlier turns on the path. And what waits for a character's own agent (`waiting.ts`): who on stage this turn holds perceptions its
// own agent has not taken in (`stage.untaken`); who holds such perceptions of earlier turns (`path.untaken`), and for how many turns
// (`path.untaken.turns`); who still holds any of a scene that has closed (`scene.untaken`); and for whom story time has passed a sleep, or
// the setting's hours, since it last dreamt (`dream.due`). All count only turns RPE played: a turn a migration carried owes none of this
// (§15.2). A perception waits from the turn it was written in, and none waits that a job of the character's own agent has in hand
// (`waiting.ts`; the jobs are the host's to say). Each counts everyone, grouped by casting, with the names it counts (`names`, and per
// casting `namesBy`), so a rule's header picks the castings it cares about. Who was on stage, and in which scene each turn was played,
// is the caller's to say. Code decides nothing about whose perceptions or memories matter, and holds nothing back for any of it: it counts.

import type { FactDef, FactValue, JobState, JsonValue, Scope } from "rp-harness/contract";
import type { Store } from "../store";
import { type CastSettings, castClock } from "./kit";
import { castAt, type CastAt } from "./path";
import { perceivedTurn } from "./perceive";
import type { JsonObject } from "../shared/json";
import { baseOf, bindingsOf, type Character, castingInForce, CASTINGS, CastRecord, charactersOf, chatLine, findCharacter, nameKey } from "./record";
import { personOfCharacter, worldAt } from "./secrets";
import { type SourceReader, sourcesNow } from "./sources";
import { type InHand, turnsSince, type Untaken, type Waiting, waitingOf } from "./waiting";

/** The groups a count breaks down into: each casting, and those on stage the cast has not cast on this path (or does not hold). */
export const UNPERCEIVED_GROUPS = [...CASTINGS, "uncast"] as const;
type Group = (typeof UNPERCEIVED_GROUPS)[number];

/** The fields of a count of who is missing a perception: `missing` and what each of its items carries, each turn among them. */
const MISSING_FIELDS = ["missing", "missing.name", "missing.casting", "missing.turns", "missing.turns.message", "missing.turns.time", "missing.turns.place"];
/** The fields of a count of who holds perceptions not taken in: `held` and what each of its items carries. */
const HELD_FIELDS = ["held", "held.name", "held.casting", "held.perceptions", "held.since", "held.turns"];

/** How a stage was read: the open scene the Author recorded, where the owner's character stands (no scene recorded), or not recorded at all. */
export type StageHow = "scene" | "owner" | "none";

/** Who was on stage in one turn, by name or cast id, how that was read, and the moment: the place in words and the story's date and time there. */
export interface StageRead {
  who: readonly string[];
  how: StageHow;
  place: string | null;
  /** As the world's calendar writes it; null where nobody set the clock. */
  time: string | null;
}

/**
 * Who was on stage in each of `turns`, and how that was read: the host's to say (the turn lane, from the scene the turn was played in
 * and the state it left, R-56). A turn it holds no stage for is left out of the map.
 */
export type OnStage = (scope: { user: string; chat: string }, turns: readonly string[]) => Promise<ReadonlyMap<string, StageRead>>;

/** A scene by its id, with its title as the Author wrote it. */
export interface SceneNamed {
  id: string;
  title: string | null;
}

/**
 * The scene each of `turns` was played in (null: none), and the scenes the story record holds closed at the reading `at` (a turn, with
 * what it has recorded; the chat's head for null): the host's to say, from the story record.
 */
export type ScenesOf = (scope: { user: string; chat: string }, turns: readonly string[], at: string | null) => Promise<{ of: ReadonlyMap<string, SceneNamed | null>; closed: ReadonlyMap<string, SceneNamed> }>;

/** A job of the chat, as the facts read it: whom its agent plays (by name; null: no one), its state, when it started and ended, and the turn that started it (null: none). */
export interface JobRead {
  plays: string | null;
  state: JobState;
  started: number;
  ended: number | null;
  turn: string | null;
}

/** The chat's jobs that may have a character's perceptions in hand: those going on or waiting to, and those ended since `since` (milliseconds). The host's to say. */
export type JobsOf = (scope: { user: string; chat: string }, since: number) => Promise<readonly JobRead[]>;

/** The states of a job not yet ended: its agent is at work, or will be. */
const GOING: Readonly<Partial<Record<JobState, true>>> = { queued: true, held: true, running: true, asking: true };

/** The engine's word for a person's activity while asleep (the Cast life pack's `sleep`). */
const ASLEEP = "sleep";

/** The cast's facts as the Rules page lists them. */
export const CAST_FACT_DEFS: readonly FactDef[] = [
  {
    name: "stage.unperceived",
    counts: "Characters on stage this turn with no perception of it recorded, by casting; read: how the stage was read (scene: the open scene's own list of who is in it, as the Author recorded it; owner: no scene recorded, who the state places where the owner's character is; none: not recorded); missing: each with its casting and the turn (message: its reply; time: the story's date and time as it left them, null where nobody set the clock; place). A perception of the same moment (the same story time and place) under another turn counts as one of it. A turn a migration carried counts no one: the previous build played it, and what its characters took from it was carried with their minds.",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["read", ...MISSING_FIELDS],
  },
  {
    name: "path.unperceived",
    counts: "Characters on stage in earlier turns RPE played on the chat's path with no perception of that turn recorded, each counted once, by casting, the stage read as stage.unperceived reads it; messages: those turns' replies; read: how many of those turns' stages were read each way (scene, owner, none); missing: each with its casting and the turns it has none of (message: the turn's reply; time: the story's date and time as the turn left them, null where nobody set the clock; place). A perception of the same moment (the same story time and place) under another turn counts as one of it, and one with reach none (nothing reached them) settles the turn. The turns a migration carried are not counted: the previous build played them, and what their characters took from them was carried with their minds.",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["messages", "read", "read.scene", "read.owner", "read.none", ...MISSING_FIELDS],
  },
  {
    name: "stage.untaken",
    counts: "Characters on stage this turn (read as stage.unperceived reads it) who hold perceptions their own agent has not taken in, of this turn or any earlier one RPE played, each counted once, by casting. A perception is taken in once a memory, a mind entry or a relationship of the character's own names it as where it came from, or the character says it was taken in with nothing to remember. A perception waits from the turn it was written in, whatever turn it is of, and none waits that a job of the character's own agent has in hand: one going on or waiting to, or ended after this turn began, started after the perception was written. held: each with its casting, how many it holds (perceptions), the reply of the turn the oldest was written in (since; null while that turn's reply is not on the path) and how many turns RPE played since that turn, this one included (turns).",
    by: [...UNPERCEIVED_GROUPS],
    fields: HELD_FIELDS,
  },
  {
    name: "path.untaken",
    counts: "Characters who hold perceptions written in earlier turns RPE played on the chat's path that their own agent has not taken in (as stage.untaken says it, a job's in hand left out), each counted once, by casting, whether or not they are on stage now. held: each with its casting, how many of those it holds (perceptions), the reply of the turn the oldest was written in (since) and how many turns RPE played since that turn, the one read included (turns).",
    by: [...UNPERCEIVED_GROUPS],
    fields: HELD_FIELDS,
  },
  {
    name: "path.untaken.turns",
    counts: "In turns, not characters: the most turns RPE has played since the turn a perception was written in, of those written in earlier turns that a character still holds without its own agent having taken it in and no job of its agent has in hand, the turn read included (one written in the turn just before reads 1). Each group is the most of the characters of that casting; picking several adds them, so pick one. Perceptions of a scene that has closed are left out: scene.untaken counts those. names: the characters it measures, those of each casting under namesBy.",
    by: [...UNPERCEIVED_GROUPS],
  },
  {
    name: "scene.untaken",
    counts: "Characters who hold perceptions their own agent has not taken in from turns RPE played in a scene the story record now holds closed, each counted once, by casting. held: each with its casting, how many of those it holds (perceptions), the reply of the turn of the oldest (since) and the scenes they are of (scenes, by title or id).",
    by: [...UNPERCEIVED_GROUPS],
    fields: [...HELD_FIELDS, "held.scenes"],
  },
  {
    name: "dream.due",
    counts: "Characters for whom, since they last dreamt (or since their first perception on a turn RPE played, if they never have), a sleep has begun (a turn RPE played whose world state has their person's activity at sleep, after one that did not) or story time has passed the hours the setting cast.dreamAfterHours gives, each counted once, by casting. A chat that keeps no story time counts the sleeps alone. One whose own agent has a job in hand (going on or waiting to, or ended after this turn began) is not counted until that job's writes count: one run of its agent at a time. due: each with its casting, the story hours since then (hours; null with no story time), whether a sleep began since (slept), and the reply of the turn it last dreamt in (dreamt; null for none, or a turn whose reply is not on the path).",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["due", "due.name", "due.casting", "due.hours", "due.slept", "due.dreamt"],
  },
  {
    name: "cast.base.older",
    counts: "Characters whose base is older than a source bound to them (a card, a persona, a lore entry or a memory entity that changed or went since the base was drawn); sources: each with the character, the source and the aspect of the character it defines.",
    fields: ["sources", "sources.who", "sources.kind", "sources.id", "sources.defines", "sources.title", "sources.gone"],
  },
  { name: "cast.growth.proposed", counts: "Characters with growth a reflection proposed that the Author has not accepted." },
  {
    name: "cast.growth.waiting",
    counts: "In turns, not characters: the most turns RPE has played since a growth a reflection proposed, and the Author has neither accepted nor struck, was written, the turn read included (one written in the turn just before reads 1); one written in the turn read is not counted. Each group is the most of the characters of that casting; picking several adds them, so pick one. names: the characters whose proposals wait so, those of each casting under namesBy. proposed: each such proposal, with who, its casting, its id, its words (text), what caused it (cause), the reply of the turn it was written in (since) and the turns since (turns).",
    by: [...UNPERCEIVED_GROUPS],
    fields: ["proposed", "proposed.who", "proposed.casting", "proposed.id", "proposed.text", "proposed.cause", "proposed.since", "proposed.turns"],
  },
  { name: "cast.playerMind", counts: "1 when the owner has switched on a mind of his own for his character (the setting cast.playerMind), so his persona is cast with an agent and memory work as any principal is; 0 when it has none." },
];

/** The names of the facts of what waits for a character's own agent. */
const WAITING_FACTS = ["stage.untaken", "path.untaken", "path.untaken.turns", "scene.untaken", "dream.due"] as const;

/** Each character whose base is older than a source bound to it, with the source and the aspect it defines, as the sources stand now in Lumiverse. */
async function baseOlder(deps: { store: Store; sources: SourceReader }, scope: Scope, chats: readonly string[]): Promise<FactValue> {
  const { db } = deps.store;
  const who: string[] = [];
  const sources: JsonObject[] = [];
  for (const character of charactersOf(db, scope.user, chats)) {
    const bindings = bindingsOf(db, scope.user, character.id);
    if (bindings.length === 0) continue;
    const states = await sourcesNow(deps.sources, { user: scope.user, chat: scope.chat }, bindings, baseOf(db, scope.user, character.id, scope.chat).values());
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

/** Growth proposed and not decided, written in an earlier turn of the reading's path: `cast.growth.waiting`. */
function growthWaiting(record: CastRecord, characters: readonly Character[], at: CastAt, played: ReadonlySet<string>, turn: string | null, groupOf: (c: Character) => Group): FactValue {
  const rows = characters.flatMap((c) =>
    record
      .of(c.id, "growth")
      .filter((g) => g.fields.proposed === true && g.opened !== turn && at.order.has(g.opened))
      .map((g) => ({ name: c.name, group: groupOf(c), id: g.id, text: g.fields.text ?? null, cause: g.fields.cause ?? null, since: at.replyOf(g.opened), turns: turnsSince(at, played, at.order.get(g.opened) ?? 0) })),
  );
  const counted = valueOf([...new Map(rows.map((r) => [r.name, r])).values()]);
  for (const group of UNPERCEIVED_GROUPS) (counted.by as Record<string, number>)[group] = Math.max(0, ...rows.filter((r) => r.group === group).map((r) => r.turns));
  return { ...counted, count: Math.max(0, ...rows.map((r) => r.turns)), fields: { proposed: rows.map((r) => ({ who: r.name, casting: r.group, id: r.id, text: r.text, cause: r.cause, since: r.since, turns: r.turns })) } };
}

/** The cast's facts, in the shape the turn lane's facts registry takes an area's (`FactSource`). */
export interface CastFacts {
  area: "cast";
  defs: readonly FactDef[];
  read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>>;
}

/** Who on a stage has no perception of a turn, each once: the cast's character (null: one the cast does not hold), their name, casting group, and the turns. */
interface Gap {
  character: string | null;
  name: string;
  group: Group;
  turns: string[];
}

/** A moment, as a stage reads it: the story's date and time and the place; none where either is not known. */
function momentOf(stage: StageRead | undefined): string | null {
  return stage?.time == null || stage.place == null ? null : `${stage.time}\n${nameKey(stage.place)}`;
}

function valueOf(gaps: readonly Pick<Gap, "name" | "group">[], fields?: FactValue["fields"]): FactValue {
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

/** One character's perceptions a count holds, as its `held` field says them: its casting, how many, the reply of the oldest's turn, and the turns RPE played since it. */
function heldOf(at: CastAt, played: ReadonlySet<string>, name: string, group: Group, untaken: readonly Untaken[]): JsonObject {
  const oldest = untaken[0] as Untaken;
  return { name, casting: group, perceptions: untaken.length, since: at.order.has(oldest.turn) ? at.replyOf(oldest.turn) : null, turns: turnsSince(at, played, oldest.index) };
}

/** A count of characters who hold what it counts: each with its group and what its field says of it. */
function heldValue(rows: readonly { name: string; group: Group; held: JsonObject }[], field: string): FactValue {
  return valueOf(rows, { [field]: rows.map((r) => r.held) });
}

/** `stage.unperceived`, `path.unperceived` and what waits for the characters' own agents, counted from the cast, from who `onStage` says was there, and from the chat's jobs `jobs` gives. */
export function castFacts(deps: { store: Store; onStage: OnStage; scenes: ScenesOf; jobs: JobsOf; sources: SourceReader; playerMind(scope: Scope): Promise<boolean>; settings(scope: Scope): Promise<Pick<CastSettings, "dreamAfterHours">> }): CastFacts {
  return {
    area: "cast",
    defs: CAST_FACT_DEFS,
    async read(scope, names) {
      const user = deps.store.user(scope.user);
      const wanted = { stage: names.includes("stage.unperceived"), path: names.includes("path.unperceived"), older: names.includes("cast.base.older"), proposed: names.includes("cast.growth.proposed"), growthWaits: names.includes("cast.growth.waiting"), mind: names.includes("cast.playerMind") };
      const waits = new Set(WAITING_FACTS.filter((n) => names.includes(n)));
      // His own setting for the chat, whether or not RPE has met it: 1 when his character has a mind.
      const mind: Record<string, FactValue> = wanted.mind ? { "cast.playerMind": await deps.playerMind(scope).then((on): FactValue => ({ count: on ? 1 : 0, names: [on ? "on" : "off"] })) } : {};
      // A chat RPE has not met yet has no one on stage and no character: every count is 0.
      if (user.chat(scope.chat) === null) {
        return {
          ...(wanted.stage ? { "stage.unperceived": valueOf([], { read: "none", missing: [] }) } : {}),
          ...(wanted.path ? { "path.unperceived": valueOf([], { messages: [], read: readsOf([]), missing: [] }) } : {}),
          ...Object.fromEntries([...waits].map((n) => [n, n === "path.untaken.turns" ? valueOf([]) : valueOf([], { [n === "dream.due" ? "due" : "held"]: [] })])),
          ...(wanted.older ? { "cast.base.older": { count: 0, names: [], fields: { sources: [] } } } : {}),
          ...(wanted.proposed ? { "cast.growth.proposed": { count: 0, names: [] } } : {}),
          ...(wanted.growthWaits ? { "cast.growth.waiting": valueOf([], { proposed: [] }) } : {}),
          ...mind,
        };
      }
      const at = castAt(user, scope.chat, scope.turn ?? null);
      const record = CastRecord.read(deps.store, scope.user, at);
      // Only the turns RPE played are counted (`playedOf`, plan §7.3): a turn a migration carried was the previous build's to play, owes
      // no perception of RPE's, and its stage is not asked; what its characters took from it is in the mind files carried with them (§15.2).
      const played = user.playedOf([...at.turns, ...(scope.turn === undefined ? [] : [scope.turn])]);
      const turn = scope.turn !== undefined && played.has(scope.turn) ? scope.turn : null;
      const earlier = at.turns.filter((t) => t !== scope.turn && played.has(t));
      const chats = chatLine(user, scope.chat);
      const characters = charactersOf(deps.store.db, scope.user, chats);
      // The jobs of a character's own agent that have its perceptions in hand at the reading: going on or waiting to, or ended once the
      // turn read began (what a job writes counts from the turn after it ended); one a turn after the reading started is none of them.
      const began = scope.turn === undefined ? Number.POSITIVE_INFINITY : (user.turn(scope.turn)?.created ?? Number.POSITIVE_INFINITY);
      const jobs = waits.size === 0 ? [] : await deps.jobs({ user: scope.user, chat: scope.chat }, began);
      const playing = new Map<string, string | null>();
      const playedBy = (plays: string): string | null => {
        if (!playing.has(plays)) playing.set(plays, findCharacter(deps.store.db, scope.user, chats, plays)?.id ?? null);
        return playing.get(plays) ?? null;
      };
      const inHand = (character: Character): InHand[] =>
        jobs.flatMap((j) =>
          j.plays !== null && playedBy(j.plays) === character.id && (GOING[j.state] === true || (j.state === "done" && j.ended !== null && j.ended >= began)) && (j.turn === null || at.order.has(j.turn))
            ? [{ started: j.started, turn: j.turn }]
            : [],
        );
      const waiting = waits.size === 0 ? [] : waitingOf(record, characters, played, inHand).filter((w) => w.untaken.length > 0 || waits.has("dream.due"));
      const groupOf = (character: Character): Group => castingInForce(record, character)?.as ?? "uncast";
      const asked = [...(turn !== null && (wanted.stage || waits.has("stage.untaken")) ? [turn] : []), ...(wanted.path ? earlier : [])];
      const stage = asked.length === 0 ? new Map<string, StageRead>() : await deps.onStage({ user: scope.user, chat: scope.chat }, asked);

      // The turns each character holds a perception of: a turn is theirs, and so is any turn of the same moment (the story's date and
      // time as it left them, and the place), for a perception of that moment written under another turn is one of it.
      const perceivedIn = new Map<string, Set<string>>();
      for (const item of record.items.values()) {
        if (item.part !== "perception" || item.dropped) continue;
        const turns = perceivedIn.get(item.character) ?? new Set<string>();
        turns.add(perceivedTurn(item));
        perceivedIn.set(item.character, turns);
      }
      const known = new Map<string, Character | null>();
      const characterNamed = (said: string): Character | null => {
        if (!known.has(said)) known.set(said, findCharacter(deps.store.db, scope.user, chats, said));
        return known.get(said) ?? null;
      };
      const gapsIn = async (turns: readonly string[]): Promise<Gap[]> => {
        const out = new Map<string, Gap>();
        for (const t of turns) {
          for (const said of stage.get(t)?.who ?? []) {
            const character = characterNamed(said);
            if (character !== null && perceivedIn.get(character.id)?.has(t) === true) continue;
            const key = character?.id ?? `name:${nameKey(said)}`;
            const gap = out.get(key) ?? { character: character?.id ?? null, name: character?.name ?? said.trim(), group: character === null ? "uncast" : groupOf(character), turns: [] };
            if (!gap.turns.includes(t)) gap.turns.push(t);
            out.set(key, gap);
          }
        }
        // The moments of the other turns on the path they hold perceptions of, read once.
        const others = [...new Set([...out.values()].flatMap((g) => [...(g.character === null ? [] : (perceivedIn.get(g.character) ?? []))].filter((t) => !stage.has(t) && at.order.has(t))))];
        const more = others.length === 0 ? new Map<string, StageRead>() : await deps.onStage({ user: scope.user, chat: scope.chat }, others);
        const moment = (t: string): string | null => momentOf(stage.get(t) ?? more.get(t));
        return [...out.values()].flatMap((g) => {
          const theirs = [...(g.character === null ? [] : (perceivedIn.get(g.character) ?? []))].map(moment).filter((m): m is string => m !== null);
          const turns = g.turns.filter((t) => {
            const m = moment(t);
            return m === null || !theirs.includes(m);
          });
          return turns.length === 0 ? [] : [{ ...g, turns }];
        });
      };
      /** Each one's turns with no perception: the reply's number, the story's date and time, the place. */
      const missingOf = (gaps: readonly Gap[]): JsonObject[] =>
        gaps.map((g) => ({ name: g.name, casting: g.group, turns: g.turns.map((t) => ({ message: at.replyOf(t), time: stage.get(t)?.time ?? null, place: stage.get(t)?.place ?? null })) }));

      const values: Record<string, FactValue> = {};
      if (wanted.stage) {
        const gaps = turn === null ? [] : await gapsIn([turn]);
        values["stage.unperceived"] = valueOf(gaps, { read: (turn === null ? null : stage.get(turn)?.how) ?? "none", missing: missingOf(gaps) });
      }
      if (wanted.path) {
        const gaps = await gapsIn(earlier);
        const messages = [...new Set(gaps.flatMap((g) => g.turns.map((t) => at.replyOf(t)).filter((m): m is number => m !== null)))].sort((a, b) => a - b);
        values["path.unperceived"] = valueOf(gaps, { messages, read: readsOf(earlier.map((t) => stage.get(t)?.how ?? "none")), missing: missingOf(gaps) });
      }
      if (waits.size > 0) Object.assign(values, await waitingValues({ deps, scope, at, played, record, waiting, groupOf, waits, busy: (character) => inHand(character).length > 0, onStage: turn === null ? [] : (stage.get(turn)?.who ?? []).flatMap((said) => characterNamed(said) ?? []) }));
      if (wanted.older) {
        try {
          values["cast.base.older"] = await baseOlder(deps, scope, chats);
        } catch {
          // Lumiverse cannot be read now: this fact is left out, as a fact the host cannot give is.
        }
      }
      if (wanted.proposed) values["cast.growth.proposed"] = growthProposed(record, characters);
      if (wanted.growthWaits) values["cast.growth.waiting"] = growthWaiting(record, characters, at, played, scope.turn ?? null, groupOf);
      Object.assign(values, mind);
      return values;
    },
  };
}

/** What `waitingValues` counts from. */
interface WaitingInput {
  deps: { store: Store; scenes: ScenesOf; settings(scope: Scope): Promise<Pick<CastSettings, "dreamAfterHours">> };
  scope: Scope;
  at: CastAt;
  played: ReadonlySet<string>;
  record: CastRecord;
  waiting: readonly Waiting[];
  groupOf(character: Character): Group;
  waits: ReadonlySet<(typeof WAITING_FACTS)[number]>;
  /** The characters on stage at the turn read. */
  onStage: readonly Character[];
  /** Whether a job of the character's own agent has its perceptions in hand at the reading (`InHand`). */
  busy(character: Character): boolean;
}

/** The facts of what waits for the characters' own agents, those of `waits` alone. */
async function waitingValues(input: WaitingInput): Promise<Record<string, FactValue>> {
  const { at, played, waiting, groupOf, waits, scope } = input;
  const out: Record<string, FactValue> = {};
  const rowOf = (w: Waiting, untaken: readonly Untaken[], more: JsonObject = {}) => ({ name: w.character.name, group: groupOf(w.character), held: { ...heldOf(at, played, w.character.name, groupOf(w.character), untaken), ...more } });

  if (waits.has("stage.untaken")) {
    const here = new Set(input.onStage.map((c) => c.id));
    out["stage.untaken"] = heldValue(
      waiting.filter((w) => here.has(w.character.id) && w.untaken.length > 0).map((w) => rowOf(w, w.untaken)),
      "held",
    );
  }
  // Of earlier turns: those of the path before the turn read (a job's, placed on the path, among them).
  const earlierOf = (w: Waiting): Untaken[] => w.untaken.filter((u) => u.turn !== scope.turn);
  if (waits.has("path.untaken")) out["path.untaken"] = heldValue(waiting.flatMap((w) => (earlierOf(w).length > 0 ? [rowOf(w, earlierOf(w))] : [])), "held");

  if (waits.has("path.untaken.turns") || waits.has("scene.untaken")) {
    // The scene a perception is of is the scene of the turn it is of, whenever it was written.
    const turns = [...new Set(waiting.flatMap((w) => w.untaken.map((u) => u.of)))].filter((t) => at.order.has(t));
    const scenes = await input.deps.scenes({ user: scope.user, chat: scope.chat }, turns, scope.turn ?? null);
    const closedOf = (u: Untaken): string | null => {
      const scene = scenes.of.get(u.of) ?? null;
      return scene !== null && scenes.closed.has(scene.id) ? scene.id : null;
    };
    if (waits.has("path.untaken.turns")) {
      const measured = waiting.flatMap((w) => {
        const open = earlierOf(w).filter((u) => closedOf(u) === null);
        return open.length === 0 ? [] : [{ name: w.character.name, group: groupOf(w.character), turns: turnsSince(at, played, (open[0] as Untaken).index) }];
      });
      const counted = valueOf(measured);
      for (const group of UNPERCEIVED_GROUPS) (counted.by as Record<string, number>)[group] = Math.max(0, ...measured.filter((m) => m.group === group).map((m) => m.turns));
      out["path.untaken.turns"] = { ...counted, count: Math.max(0, ...measured.map((m) => m.turns)) };
    }
    if (waits.has("scene.untaken")) {
      const rows = waiting.flatMap((w) => {
        const of = w.untaken.filter((u) => closedOf(u) !== null);
        if (of.length === 0) return [];
        const named = [...new Set(of.map((u) => closedOf(u) as string))].map((id) => scenes.closed.get(id)?.title ?? id);
        return [rowOf(w, of, { scenes: named })];
      });
      out["scene.untaken"] = heldValue(rows, "held");
    }
  }

  if (waits.has("dream.due")) out["dream.due"] = await dreamDue(input);
  return out;
}

/**
 * `dream.due`: each character for whom, since it last dreamt (or its first perception RPE recorded, if it never has), a sleep began or
 * the setting's story hours passed. A sleep begins at a turn RPE played whose world state has its person asleep, after the turn before it
 * on the path did not; a dream had while asleep is not asked for again until it wakes and sleeps again.
 */
async function dreamDue(input: WaitingInput): Promise<FactValue> {
  const { deps, scope, at, played, waiting, groupOf } = input;
  const u = deps.store.user(scope.user);
  const hours = (await deps.settings(scope)).dreamAfterHours;
  const now = castClock(deps.store, scope.user, scope.chat, scope.turn ?? null)?.now ?? null;
  const ctx = worldAt(deps.store, scope.user, scope.turn ?? null, null, scope.chat);
  const asleepAt = (person: string, t: string): boolean => u.stateAt(t).state.world.entities[person]?.fields.activity === ASLEEP;
  const rows: { name: string; group: Group; held: JsonObject }[] = [];
  for (const w of waiting) {
    // Where it is counted from: its last dream, else its first perception on a turn RPE played; a character that has perceived nothing has lived nothing to dream of.
    const from = w.dreamt ?? firstPerceived(input.record, w.character, played);
    if (from === undefined) continue;
    // One run of its agent at a time: a job of its own agent going on, or not yet counted, has what it has lived in hand; the dream waits for it.
    if (input.busy(w.character)) continue;
    // A dream of a job's that is placed on no turn of the path came after every turn but the one read.
    const index = at.order.get(from.turn) ?? at.turns.length - 2;
    const passed = now === null || from.at === null ? null : (now - from.at) / 60;
    let slept = false;
    const found = ctx === null ? null : personOfCharacter(ctx, w.character);
    if (found !== null && "id" in found) {
      const person = found.id;
      for (let i = Math.max(0, index + 1); i < at.turns.length && !slept; i++) {
        const t = at.turns[i] as string;
        if (!played.has(t) || !asleepAt(person, t)) continue;
        const before = i === 0 ? undefined : at.turns[i - 1];
        slept = before === undefined || !asleepAt(person, before);
      }
    }
    if (!slept && (passed === null || passed < hours)) continue;
    const dreamt = w.dreamt !== null && at.order.has(w.dreamt.turn) ? at.replyOf(w.dreamt.turn) : null;
    rows.push({ name: w.character.name, group: groupOf(w.character), held: { name: w.character.name, casting: groupOf(w.character), hours: passed === null ? null : Math.round(passed * 10) / 10, slept, dreamt } satisfies Record<string, JsonValue> });
  }
  return heldValue(rows, "due");
}

/** A character's first perception standing on the record of a turn RPE played (or of a job's, placed on the path): its turn and story time. */
function firstPerceived(record: CastRecord, character: Character, played: ReadonlySet<string>): { turn: string; at: number | null } | undefined {
  const { order, turns } = record.at;
  const all = record
    .of(character.id, "perception")
    .map((item) => ({ turn: perceivedTurn(item), at: item.at }))
    .filter((p) => !order.has(p.turn) || played.has(p.turn))
    .sort((a, b) => (order.get(a.turn) ?? turns.length) - (order.get(b.turn) ?? turns.length));
  return all[0];
}
