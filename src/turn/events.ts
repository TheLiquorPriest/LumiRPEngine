// What RPH tells RPE as a turn goes (`TurnEvents` in `rp-harness/contract`). None of it returns a
// decision: RPE records it with the turn and shows it. The intent record is kept on the turn as text and
// never read by code (plan §10.3). A sub-agent's writes the lead drops are taken back from the turn's
// staged changes, from the cast's and the story's rows beside them, and from the notes it wrote. Consents,
// gap checks and rules that fired are each a row of their own table (App. B), a turn's, or a job's the
// user started; suggestions and the attachments an agent was given are kept with the turn (`turn_told`)
// for the Turn page; a suggestion of a file is filed for the Files page too.
//
// Of RPE's own spaces an agent is given by name, each at the turn it runs in (at the chat's head, for an
// agent of no turn) and laid out as the briefing lays it out: the story brief (`story:brief`); the scene
// in full, which is the world state's horizon, with each place's map when `map` is named too
// (`world:scene(full)`, `world:scene(full, map)`); what is due (`world:due`), the world state's due
// section, within the share of its budget the briefing gives it; the world's ruleset (`ruleset`), as
// `world_query` gives it; the turn's reply as saved (`turn:reply(saved)`), laid out by its own part; the
// next batch of the chat's lore no run has indexed (`index:batch`), worded by the lore's lines in force;
// the lore index's bindings as the character the agent plays may know them (`index:known-to-self`); then
// any view the host adds (`views`); then the cast's views of the character the agent plays
// (`cast:self(…)`), with who the open scene has on stage and its place as what is present. A view with
// nothing in it is given all the same, in its own file's words for that: the layout's `none` part, the
// world state's `horizon_none` and `due_none` lines, the lore's `known_none` and `batch_none`. Only a
// name none of these spaces gives is left out, and RPH says it could not be found.
//
// A job's every change of state is kept (`jobs.ts`); its end is recorded in the store in the same write,
// so what it recorded takes effect before the next turn to begin, and the sessions of the turn that
// started it are brought up to date, since its writes may have opened or closed a scene (plan §11). A
// job the user started belongs to no turn, so what its agents are told of is kept with none: its trace
// holds it.

import type { Database } from "bun:sqlite";
import { type Fields, type Guidance, loadGuidance, type TemplatePart } from "rp-harness";
import type { AgentRef, ConsentGrant, ContextBlock, FilesPort, GapCheck, Log, RuleFiring, Scope, TurnEvents } from "rp-harness/contract";
import { castViews, type SourceReader } from "../cast";
import { placeOfEntity } from "../engine/scope";
import { mapView, mapWording, rulesetData } from "../iface";
import { LORE_BATCH, LORE_KNOWN, type LoreIndex, type LoreProposals, loreBatchBlock, loreKnownBlock, loreLines } from "../lore";
import { type DueSource, type Part, readPart, type Store, type ViewLine, wordLine, worldState, type WorldStateBlock } from "../store";
import { storyBrief } from "../story";
import type { TreeNotes, TreeSuggestions } from "../tree";
import { keepJob } from "./jobs";
import type { Writes } from "./kv";
import type { Runs } from "./runs";
import { turnSettings } from "./settings";
import { stageAt } from "./stage";
import { guidanceTexts } from "./texts";
import { castLayouts, PARTS, tokenCount } from "./turns";

export interface EventsDeps {
  db: Database;
  writes: Writes;
  store: Store;
  runs: Runs;
  /** The agents' files, for the parts the cast's views are laid out by. */
  files: FilesPort;
  /** A character's sources read live, shown with its base. */
  sources: SourceReader;
  /** The lore index, whose next batch an indexing run is given by name. */
  loreIndex: LoreIndex;
  /** The notes agents wrote, which follow the turn: a dropped sub-agent's are taken back. */
  notes: TreeNotes;
  /** The suggestions agents filed of the tree's files, for the Files page. */
  suggestions: TreeSuggestions;
  /** The lore's proposals, where an agent's suggestion about lore is kept for his approval. */
  proposals: () => Pick<LoreProposals, "suggested">;
  now(): number;
  /** After a job of a turn ended: the sessions of the turn that started it brought up to date. */
  jobEnded(user: string, chat: string, turn: string): Promise<void>;
  /** What time brings due, for what is due an agent is given by name (`world:due`). */
  due: DueSource;
  /** A view the host adds by name: its text; null for a name that is none of its own. Asked after the turn's own views, before the cast's. */
  views?: (scope: Scope, agent: AgentRef, ref: string) => Promise<string | null>;
  log: Log;
}

/** The turn's own views an agent can be given by name (plan §5.4, §10.4, Appendix C), but the scene's. */
const VIEWS = { storyBrief: "story:brief", due: "world:due", ruleset: "ruleset", reply: "turn:reply(saved)", mapDrawn: "map:drawn" } as const;

/** The field a view's layout shows its part for nothing by: set only when an agent is given that view by name with nothing in it. */
const NONE = "none";

/** The line of the world state's layout that says a section an agent is given by name has nothing in it. */
const SECTION_NONE = { horizon: "horizon_none", due: "due_none" } as const;

/** A view's layout with nothing in the view: its part for nothing, filled with `fields`. */
function nothing(layout: TemplatePart, fields: Fields = {}): string {
  return layout.render({ ...fields, [NONE]: true }).text.trim();
}

/** The scene's state in full, with each place's map where `map` is named too: `world:scene(full)`, `world:scene(full, map)`. */
const WORLD_SCENE = /^world:scene\(([^)]*)\)$/;

/** Whether `ref` names the scene's state, and with its maps; null for any other name. */
function sceneOf(ref: string): { maps: boolean } | null {
  const words = WORLD_SCENE.exec(ref)?.[1]?.split(",").map((word) => word.trim());
  if (words === undefined || !words.includes("full") || words.some((word) => word !== "full" && word !== "map")) return null;
  return { maps: words.includes("map") };
}

/** The world state as the briefing compiles it, and the layout it is laid out by. */
interface Compiled {
  part: Part;
  state: WorldStateBlock;
  /** The minutes of story time ahead that the due section lists, as the chat's settings have them. */
  ahead: number;
}

/**
 * The world state (plan §6.9) at the scope's turn, or at the chat's head for a scope of no turn, compiled as the briefing's is on the
 * chat's settings, with each place's map where `maps`; null where the chat has no turn or its layout is switched off.
 */
async function compiledWorld(deps: EventsDeps, scope: Scope, guidance: Guidance, maps: boolean): Promise<Compiled | null> {
  const store = deps.store.user(scope.user);
  const turn = scope.turn ?? store.path(scope.chat).findLast((e) => e.turn !== null)?.turn ?? null;
  const statePart = await guidance.part(PARTS.worldState);
  if (turn === null || statePart === undefined) return null;
  const layout = await deps.files.read(scope, statePart.source.path);
  if (layout.status !== "read") return null;
  const part = readPart(layout.text, "world-state");
  const settings = await turnSettings(deps.files, scope, deps.log);
  const map = maps ? mapView(await mapWording(guidanceTexts(deps.files, scope, deps.log)), settings.map) : undefined;
  return { part, ahead: settings.worldState.dueAhead, state: worldState(store, { chat: scope.chat, turn, layout: part, ...(map !== undefined ? { map } : {}), due: deps.due, settings: settings.worldState, charsPerToken: settings.charsPerToken }) };
}

/**
 * One section of a compiled world state, laid out by its layout with that section alone in it; with nothing in it, the layout's line that
 * says so. Null where the world state is not compiled, or its layout places no such section.
 */
function sectionOf(world: Compiled | null, section: keyof typeof SECTION_NONE): string | null {
  const lines = world?.state.sections[section];
  if (world === null || lines === undefined) return null;
  const { part } = world;
  const said: ViewLine[] = lines.length > 0 ? lines : [{ kind: SECTION_NONE[section], depth: 0, fields: section === "due" ? { minutes: world.ahead } : {} }];
  const text = said.flatMap((line) => wordLine(part, line) ?? []).join("\n");
  return text === "" ? "" : part.body.render(part.header, { [section]: text }).trim();
}

/** The world's ruleset as `world_query` gives it, at the scope's turn or the chat's head; null where the store has no such chat, turn or world. */
function rulesetView(deps: EventsDeps, scope: Scope): string | null {
  const store = deps.store.user(scope.user);
  if (store.chat(scope.chat) === null) return null;
  const turn = scope.turn === undefined ? null : store.turn(scope.turn);
  if (scope.turn !== undefined && turn?.chat !== scope.chat) return null;
  const state = turn === null ? store.headState(scope.chat).state : store.stateAt(turn.id).state;
  const doc = deps.store.env.worlds(state.world.revision);
  return doc === undefined ? null : JSON.stringify({ ruleset: rulesetData(doc) });
}

/**
 * The drawn layer of the map the player's character stands on (`map:drawn`), at the scope's turn or the chat's head: what the Author's
 * opening block gives once a session (plan §10.2). Null where the chat has no world, or no map is drawn where he stands.
 */
async function drawnMap(deps: EventsDeps, scope: Scope): Promise<string | null> {
  const store = deps.store.user(scope.user);
  if (store.chat(scope.chat) === null) return null;
  const turn = scope.turn === undefined ? null : store.turn(scope.turn);
  const { state } = turn === null || turn.chat !== scope.chat ? store.headState(scope.chat) : store.stateAt(turn.id);
  const doc = deps.store.env.worlds(state.world.revision);
  const place = doc === undefined ? null : placeOfEntity(state.world, doc.pov);
  if (place === null) return null;
  const settings = await turnSettings(deps.files, scope, deps.log);
  const map = mapView(await mapWording(guidanceTexts(deps.files, scope, deps.log)), settings.map);
  return map.text({ state, env: deps.store.env, place, layer: "drawn" })?.text ?? null;
}

/** A turn's reply as saved, by its latest run that wrote into the chat; null before it has gone out. */
function savedReply(deps: EventsDeps, user: string, turn: string): string | null {
  const run = deps.runs.ofTurn(user, turn).findLast((r) => r.kind !== "settle");
  return run === undefined || run.released === null ? null : (run.saved ?? run.base + run.reply);
}

/** What one call for an agent's views reads once, whichever views it names. */
interface Reading {
  deps: EventsDeps;
  scope: Scope;
  guidance(): Guidance;
  /** The world state, compiled once for each of with and without maps. */
  world(maps: boolean): Promise<Compiled | null>;
  /** Whether a name in the call asks for the scene with its maps: what is due is read from that same compilation. */
  maps: boolean;
}

/** The text of the turn's own view that `ref` names, null when nothing lays it out; undefined for a name that is none of the turn's own. */
async function turnView(r: Reading, ref: string): Promise<string | null | undefined> {
  switch (ref) {
    case VIEWS.storyBrief: {
      const layout = await r.guidance().part(PARTS.storyBrief);
      if (layout?.format !== "template") return null;
      const { text } = storyBrief({ store: r.deps.store, user: r.scope.user, chat: r.scope.chat, turn: r.scope.turn ?? null, layout });
      return text !== "" ? text : nothing(layout);
    }
    case VIEWS.due:
      return sectionOf(await r.world(r.maps), "due");
    case VIEWS.ruleset:
      return rulesetView(r.deps, r.scope);
    case VIEWS.reply: {
      // An agent of no turn has no turn's reply to be given.
      const { turn } = r.scope;
      const layout = turn === undefined ? undefined : await r.guidance().part(PARTS.turnReply);
      if (turn === undefined || layout?.format !== "template") return null;
      const reply = savedReply(r.deps, r.scope.user, turn);
      return reply === null ? nothing(layout) : layout.render({ reply }).text.trim();
    }
    case VIEWS.mapDrawn:
      return await drawnMap(r.deps, r.scope);
  }
  const scene = sceneOf(ref);
  return scene === null ? undefined : sectionOf(await r.world(scene.maps), "horizon");
}

/**
 * The lore a character's agent may know as its own (`index:known-to-self`). The lore gives nothing at all for an agent that plays no
 * person of the chat's world, to whom nothing is bound either: that agent is told so in the lore's own line for none.
 */
async function knownView(deps: EventsDeps, scope: Scope, agent: AgentRef, guidance: Guidance): Promise<string> {
  const text = await loreKnownBlock(deps.loreIndex, scope, agent, guidance);
  if (text !== "" || (agent.plays !== undefined && (await deps.loreIndex.knownTo(scope, agent.plays)) !== null)) return text;
  return (await loreLines(guidance))?.line("known_none") ?? "";
}

/** `cast:self(base, mind, …)`: views of the character the agent plays, by name. */
const CAST_SELF = /^cast:self\((.*)\)$/;

/**
 * The cast's views that `ref` names of the character `agent` plays, each laid out by its part in force for the chat, one after
 * another; with nothing in any of them (the cast holds no record of the character yet), each one's part for nothing. Null when the
 * ref is not the cast's, the agent plays nobody, or no part lays out a view it names. A name among them that is not the cast's is
 * left out.
 */
async function castSelf(deps: EventsDeps, scope: Scope, agent: AgentRef, ref: string): Promise<string | null> {
  const inner = CAST_SELF.exec(ref)?.[1];
  const { plays } = agent;
  if (inner === undefined || plays === undefined) return null;
  const names = inner
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const [layouts, settings] = await Promise.all([castLayouts(loadGuidance(deps.files, scope), names), turnSettings(deps.files, scope, deps.log)]);
  const turn = scope.turn ?? null;
  const stage = stageAt(deps.store, scope.user, scope.chat, turn);
  const views = await castViews(names, {
    store: deps.store,
    user: scope.user,
    chat: scope.chat,
    turn,
    job: agent.job ?? null,
    character: plays,
    present: stage?.who ?? [],
    ...(stage?.place != null ? { cues: [stage.place] } : {}),
    sources: deps.sources,
    layouts,
    tokens: tokenCount(settings.charsPerToken),
    settings: settings.cast,
  });
  const text = views
    .map((view) => view.text)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
  if (text !== "") return text;
  const none = views.flatMap((view) => {
    const layout = layouts[view.name];
    return layout === undefined ? [] : [nothing(layout, { name: plays })];
  });
  return none.length === 0 ? null : none.filter((said) => said !== "").join("\n\n");
}

/** One thing told, kept with its turn. */
export interface Told {
  kind: string;
  body: unknown;
  at: number;
}

/** What else RPH told of a turn (`turn_told`): suggestions, attachments asked for, drops, the release and the end. */
export function toldOf(db: Database, user: string, turn: string): Told[] {
  return db
    .query<{ kind: string; body: string; at: number }, [string, string]>("SELECT kind, body, at FROM turn_told WHERE user = ? AND turn = ? ORDER BY id")
    .all(user, turn)
    .map((r) => ({ kind: r.kind, body: JSON.parse(r.body) as unknown, at: r.at }));
}

/** The tables of App. B that each hold one kind of told item, by the kind RPE tells it as. */
const TOLD_TABLES = { consent: "consent", "gap-check": "gap_check", rule: "rule_firing" } as const;

/** One consent, gap check or rule fired as kept: whole as RPH gave it, with the turn it was told in, or the job of the user's it belongs to. */
export interface ToldRow<T> {
  body: T;
  turn: string | null;
  job: string | null;
  at: number;
}

/** A turn's, or a user's job's, consents, gap checks or rules fired, in the order they were told. */
export function toldRows<K extends keyof typeof TOLD_TABLES>(db: Database, user: string, kind: K, of: { turn: string } | { job: string }): ToldRow<K extends "consent" ? ConsentGrant : K extends "gap-check" ? GapCheck : RuleFiring>[] {
  const [column, id] = "turn" in of ? ["turn", of.turn] : ["job", of.job];
  return db
    .query<{ body: string; turn: string | null; job: string | null; at: number }, [string, string]>(`SELECT body, turn, job, at FROM ${TOLD_TABLES[kind]} WHERE user = ? AND ${column} = ? ORDER BY seq`)
    .all(user, id)
    .map((r) => ({ body: JSON.parse(r.body), turn: r.turn, job: r.job, at: r.at }));
}

export function turnEvents(deps: EventsDeps): TurnEvents {
  const turnOf = (scope: Scope): string => {
    if (scope.turn === undefined) throw new Error("RPH told RPE of a turn's work with no turn named.");
    return scope.turn;
  };
  /** Keeps what RPH told of a turn, with it; the row's id, or null for a scope of no turn, which has nowhere to keep it. */
  const tell = async (scope: Scope, kind: string, body: unknown): Promise<number | null> => {
    if (scope.turn === undefined) return null;
    const { turn } = scope;
    return await deps.writes.run((db) => Number(db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [scope.user, turn, kind, JSON.stringify(body), deps.now()]).lastInsertRowid), "keeping what RPH told of a turn");
  };
  /**
   * A consent, a gap check or a rule fired, a row of its own table (App. B): with its turn, or, told of a call in a job the user started
   * (no turn, the agent's `job` set), with that job (R-27). One told with neither has nowhere to be kept; its trace holds it.
   */
  const keep = async (scope: Scope, kind: keyof typeof TOLD_TABLES, agent: AgentRef, name: string, body: ConsentGrant | GapCheck | RuleFiring): Promise<void> => {
    const turn = scope.turn ?? null;
    const job = agent.job ?? null;
    if (turn === null && job === null) return;
    const named = kind === "rule" ? "rule" : "id, topic";
    const values = kind === "rule" ? [name] : [(body as ConsentGrant | GapCheck).id, name];
    await deps.writes.run(
      (db) =>
        db.run(`INSERT INTO ${TOLD_TABLES[kind]} (user, chat, turn, job, ${named}, body, at) VALUES (?, ?, ?, ?, ${values.map(() => "?").join(", ")}, ?, ?)`, [scope.user, scope.chat, turn, job, ...values, JSON.stringify(body), deps.now()]),
      "keeping what RPH told of a turn",
    );
  };
  return {
    async intent(scope, text) {
      const turn = turnOf(scope);
      await deps.writes.run(() => deps.store.user(scope.user).updateTurn(turn, { intent: text }), "keeping the intent record");
    },
    async attachments(scope, agent, refs, moment) {
      await tell(scope, "attachments", { agent, refs, moment });
      // A view RPE gives is given even with nothing in it, in its file's words for that. Every name none of RPE's spaces gives is left
      // out, and RPH says so. What cannot be read leaves out its name alone.
      let guidance: Guidance | undefined;
      const inForce = (): Guidance => (guidance ??= loadGuidance(deps.files, scope));
      const compiled = new Map<boolean, Promise<Compiled | null>>();
      const reading: Reading = {
        deps,
        scope,
        guidance: inForce,
        world: (maps) => {
          const world = compiled.get(maps) ?? compiledWorld(deps, scope, inForce(), maps);
          compiled.set(maps, world);
          return world;
        },
        maps: refs.some(({ ref, own }) => !own && sceneOf(ref)?.maps === true),
      };
      const blocks: ContextBlock[] = [];
      for (const { ref, own } of refs) {
        if (own) continue;
        try {
          const mine = ref === LORE_BATCH ? await loreBatchBlock(deps.loreIndex, scope, inForce(), agent) : ref === LORE_KNOWN ? await knownView(deps, scope, agent, inForce()) : await turnView(reading, ref);
          const text = mine !== undefined ? mine : ((await deps.views?.(scope, agent, ref)) ?? (await castSelf(deps, scope, agent, ref)));
          if (text !== null) blocks.push({ name: ref, text });
        } catch (error) {
          deps.log.warn("What an agent was to be given by name could not be read.", { agent: agent.id, ref, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return blocks;
    },
    consent: (scope, grant) => keep(scope, "consent", grant.by, grant.topic, grant),
    gapCheck: (scope, check) => keep(scope, "gap-check", check.by, check.topic, check),
    async dropStaged(scope, agent) {
      const turn = turnOf(scope);
      await deps.writes.run(() => {
        deps.store.user(scope.user).dropStaged(turn, agent.id);
      }, "dropping a sub-agent's staged changes");
      // The notes queue writes of their own, so they are taken back after the block above, never inside it.
      await deps.notes.drop(scope.user, scope.chat, turn, agent.id);
      await tell(scope, "dropped", { agent });
    },
    ruleFired: (scope, firing) => keep(scope, "rule", firing.agent, firing.rule, firing),
    async suggestion(scope, agent, suggestion) {
      await tell(scope, "suggestion", { agent, suggestion });
      // A file's is kept by the tree, under its own id, unless the chat's open ones are at their most; one of lore by the lore, as a
      // proposal for his approval, under its own.
      const filed = await deps.suggestions.file(scope, agent, suggestion);
      if (filed !== null) return filed.kept ? { kept: true, id: String(filed.id) } : filed;
      const proposal = await deps.proposals().suggested(scope, agent, suggestion);
      return proposal === null ? { kept: false, openMost: 0 } : { kept: true, id: `lore-${proposal.id}` };
    },
    // The run was marked released the moment its reply reached RPE's sink, which the harness finishes before it tells this.
    async released(scope, release) {
      await tell(scope, "released", release);
    },
    async ended(scope, outcome) {
      const turn = turnOf(scope);
      const run = deps.runs.running(scope.user, turn);
      if (run !== undefined) {
        run.status = outcome.status;
        run.ended = deps.now();
        run.usage = outcome.usage;
        if (outcome.error !== undefined) run.error = outcome.error;
      }
      await tell(scope, "ended", outcome);
    },
    async job(scope, job) {
      const ended = job.ended !== undefined;
      try {
        await deps.writes.run((db) => {
          keepJob(db, job);
          if (ended) deps.store.user(scope.user).endJob(job.id);
        }, "keeping what RPH told of a job");
      } catch (error) {
        const words = error instanceof Error ? error.message : String(error);
        if (ended) deps.log.error("A job's end could not be recorded, so what it changed does not take effect.", { job: job.id, error: words });
        else deps.log.error("A job's new state could not be kept.", { job: job.id, state: job.state, error: words });
        return;
      }
      // What the lore handed the job that it never wrote is given back once it ended.
      if (ended) deps.loreIndex.release(job.id);
      if (!ended || scope.turn === undefined) return;
      await deps.jobEnded(scope.user, scope.chat, scope.turn).catch((error: unknown) => deps.log.error("The sessions of a job's scene could not be brought up to date.", { turn: scope.turn ?? null, error: error instanceof Error ? error.message : String(error) }));
    },
  };
}
