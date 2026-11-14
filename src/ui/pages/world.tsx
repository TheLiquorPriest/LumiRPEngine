// World (plan §14): the chat's world as one tree (plan §6.4), opened at any level and to any depth, at
// the chat's head or as it stood at one of its turns. Each level shows what is beneath it, and its values,
// each with where it comes from (its own, inherited from a level above, or kept by a game system) and the
// change that last wrote it; beside each value stand the facts recorded on the level with the same key,
// which never overwrite it (plan §6.6). Everything shown is what RPE's world route answers.

import { useEffect, useState } from "preact/hooks";
import type { TurnSummary, ValueLine, ValueMark, ValuesShown, ValueSource, WorldAnswer, WorldFact, WorldNode, WorldNodeKind } from "../api";
import { useApp } from "../app";
import { Badge, Banner, Button, PageHeader, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { TURN_KIND_WORDS } from "../trace-view";
import { counted, errorWords, when } from "../words";
import { readTurns } from "./turns";

/** Where the page looks: a level by its ref, how many levels below it, which values each carries, and the turn the world stood at (null: the chat's head). */
export interface WorldQuery {
  at: string;
  depth: number;
  values: ValuesShown;
  turn: string | null;
}

/** Where the page starts: the whole world, one level in, each level with what it inherits too. */
export const WORLD_START: WorldQuery = { at: "world", depth: 1, values: "all", turn: null };

/** A read of the tree: RPE's answer, or its refusal in its own words. */
export type WorldResult = { answer: WorldAnswer; problem: null } | { answer: null; problem: string };

/** Reads the tree as `query` asks; what comes back after the returned function is called (the page asked again, or left) is let go. */
export function readWorld(client: Pick<RpeClient, "call">, chat: string, query: WorldQuery, onResult: (result: WorldResult) => void): () => void {
  let alive = true;
  const asked = { at: query.at, depth: query.depth, values: query.values, ...(query.turn === null ? {} : { turn: query.turn }) };
  client.call("GET /api/v1/chats/:chat/world", { chat }, { query: asked }).then(
    (answer) => {
      if (alive) onResult({ answer, problem: null });
    },
    (error: unknown) => {
      if (alive) onResult({ answer: null, problem: errorWords(error) });
    },
  );
  return () => {
    alive = false;
  };
}

const KIND_WORDS: Readonly<Record<WorldNodeKind, string>> = { world: "The world", place: "Place", entity: "Entity", groups: "The groups", elsewhere: "Elsewhere" };

const SOURCE_WORDS: Readonly<Record<ValueSource, string>> = {
  prose: "from the prose",
  lore: "from the lore",
  author: "by the Author",
  gm: "by the GM",
  character: "by a character",
  player: "by the player",
  import: "imported",
  default: "a default",
  invented: "invented",
};

/** How exact and how sure a recorded value is, where it came from, and the turn that wrote it. */
function markWords(mark: Pick<ValueMark, "n" | "precision" | "standing" | "source">): string {
  return [mark.precision, mark.standing, mark.source === null ? "unsourced" : SOURCE_WORDS[mark.source], `turn ${mark.n}`].filter((w) => w !== null).join(", ");
}

/** Where a value comes from, and the change that last wrote it. */
function sourceWords(line: ValueLine): string {
  const { from } = line;
  const where = from?.system !== undefined ? `kept by the ${from.system} system` : from?.ref !== undefined ? `inherited from ${from.name ?? from.ref}` : "its own";
  return line.mark === undefined ? where : `${where}; ${markWords(line.mark)}`;
}

function FactLine(props: { fact: WorldFact }) {
  const { fact } = props;
  return (
    <p class="rpe-line rpe-fact" data-fact={fact.id}>
      <Badge tone="gm">fact</Badge> {fact.key}: {fact.value} <span class="rpe-meta">({fact.by === null ? markWords(fact) : `${markWords(fact)}, by ${fact.by}`})</span>
    </p>
  );
}

/** A value, with where it comes from, and the facts recorded beside it under the same key. */
function ValueRow(props: { line: ValueLine; facts: readonly WorldFact[] }) {
  const { line } = props;
  return (
    <div class="rpe-value" data-key={line.key}>
      <Row label={line.key} value={line.value ?? "none"} sub={sourceWords(line)} />
      {props.facts.map((fact) => (
        <FactLine key={fact.id} fact={fact} />
      ))}
    </div>
  );
}

/** What is beneath a level, as recorded. */
function ReflectionLine(props: { node: WorldNode }) {
  const r = props.node.reflection;
  const counts = [
    [r.people, counted(r.people, "person", "people")],
    [r.places, counted(r.places, "place")],
    [r.things, counted(r.things, "thing")],
    [r.groups, counted(r.groups, "group")],
    [r.records, counted(r.records, "record")],
  ] as const;
  const said = [...counts.filter(([n]) => n > 0).map(([, words]) => words), ...(r.open > 0 ? [`${r.open} open`] : []), ...(r.changed === null ? [] : [`last changed on turn ${r.changed}`])];
  return (
    <>
      {said.length === 0 ? null : <p class="rpe-meta">{said.join(" · ")}</p>}
      {r.notable.length === 0 ? null : <p class="rpe-line">Of note: {r.notable.join(", ")}</p>}
      {r.note === null ? null : <p class="rpe-line rpe-note">{r.note}</p>}
    </>
  );
}

/** One level: its name and kind, what is beneath it, its values with the facts beside them, and the facts on it under no value's key. */
function NodeBox(props: { node: WorldNode; root: boolean; hidden: number; onOpen(): void; onBelow(): void }) {
  const { node } = props;
  const title = node.name ?? KIND_WORDS[node.kind];
  const apart = node.facts.filter((fact) => !node.values.some((line) => line.key === fact.key));
  return (
    <section class="lre-section" data-node={node.ref}>
      <div class="lre-section-head">
        <h3 class="lre-section-title">{title}</h3>
        <span class="lre-inline">
          <Badge>{node.what ?? KIND_WORDS[node.kind]}</Badge>
          {props.root ? null : (
            <Button small kind="ghost" onClick={props.onOpen}>
              Open
            </Button>
          )}
        </span>
      </div>
      <div class="lre-section-body">
        <code class="lre-id rpe-meta">{node.ref}</code>
        <ReflectionLine node={node} />
        {node.values.length === 0 ? null : (
          <div>
            {node.values.map((line) => (
              <ValueRow key={line.key} line={line} facts={node.facts.filter((fact) => fact.key === line.key)} />
            ))}
          </div>
        )}
        {apart.length === 0 ? null : (
          <div class="lre-stack">
            <span class="rpe-caption">Facts on it</span>
            {apart.map((fact) => (
              <FactLine key={fact.id} fact={fact} />
            ))}
          </div>
        )}
        {props.hidden === 0 ? null : (
          <Button small onClick={props.onBelow}>
            {`${counted(props.hidden, "level")} below`}
          </Button>
        )}
      </div>
    </section>
  );
}

/** A level and the levels below it the answer holds, nested; a level whose children it does not hold offers to open them. */
function NodeTree(props: { node: WorldNode; byRef: ReadonlyMap<string, WorldNode>; root: boolean; query: WorldQuery; onQuery(next: WorldQuery): void }) {
  const { node, query } = props;
  const below = node.children.flatMap((ref) => props.byRef.get(ref) ?? []);
  const open = (): void => props.onQuery({ ...query, at: node.ref });
  return (
    <div class="lre-stack" data-tree={node.ref}>
      <NodeBox node={node} root={props.root} hidden={node.children.length - below.length} onOpen={open} onBelow={props.root ? () => props.onQuery({ ...query, depth: query.depth + 1 }) : open} />
      {below.length === 0 ? null : (
        <div class="rpe-children">
          {below.map((child) => (
            <NodeTree key={child.ref} node={child} byRef={props.byRef} root={false} query={query} onQuery={props.onQuery} />
          ))}
        </div>
      )}
    </div>
  );
}

const VALUE_CHOICES: readonly { values: ValuesShown; words: string }[] = [
  { values: "all", words: "With what it inherits" },
  { values: "own", words: "Its own" },
  { values: "none", words: "None" },
];

export interface WorldViewProps {
  query: WorldQuery;
  answer: WorldAnswer | null;
  loading: boolean;
  /** RPE's refusal of the last read, in its words; null when it answered. */
  problem: string | null;
  /** The chat's turns on RPE, newest first, to see the world as it stood at one; null until read. */
  turns: readonly TurnSummary[] | null;
  onQuery(next: WorldQuery): void;
}

export function WorldView(props: WorldViewProps) {
  const { query, answer } = props;
  const byRef = new Map((answer?.nodes ?? []).map((node) => [node.ref, node]));
  const root = answer === null ? undefined : byRef.get(answer.at);
  const parent = root?.parent ?? null;
  return (
    <div class="lre-stack rpe-page" data-page="world">
      <PageHeader title="World" sub="This chat's world as one tree: any level, to any depth." />
      <div class="lre-stack rpe-controls">
        <form
          class="rpe-point"
          onSubmit={(event) => {
            event.preventDefault();
            const at = new FormData(event.currentTarget).get("at");
            if (typeof at === "string" && at.trim() !== "") props.onQuery({ ...query, at: at.trim() });
          }}
        >
          <label class="lre-field">
            <span class="label">Level</span>
            <input key={query.at} name="at" class="lre-input" defaultValue={query.at} spellcheck={false} autoComplete="off" />
          </label>
          <button type="submit" class="lre-btn">
            Open
          </button>
        </form>
        <div class="lre-inline rpe-wrap">
          {parent === null ? null : (
            <Button small onClick={() => props.onQuery({ ...query, at: parent })}>
              Up a level
            </Button>
          )}
          {query.at === "world" ? null : (
            <Button small kind="ghost" onClick={() => props.onQuery({ ...query, at: "world" })}>
              The whole world
            </Button>
          )}
          <span class="lre-inline" aria-label="Depth">
            <Button small kind="ghost" disabled={query.depth === 0} onClick={() => props.onQuery({ ...query, depth: query.depth - 1 })}>
              Fewer levels
            </Button>
            <span class="lre-num rpe-meta">{counted(query.depth, "level")} down</span>
            <Button small kind="ghost" onClick={() => props.onQuery({ ...query, depth: query.depth + 1 })}>
              More levels
            </Button>
          </span>
        </div>
        <div class="lre-seg" role="group" aria-label="Values">
          {VALUE_CHOICES.map((choice) => (
            <button key={choice.values} type="button" aria-pressed={query.values === choice.values ? "true" : "false"} onClick={() => props.onQuery({ ...query, values: choice.values })}>
              {choice.words}
            </button>
          ))}
        </div>
        {props.turns !== null && props.turns.length === 0 ? (
          <p class="rpe-meta" data-as-it-stood="none">
            No turn of this chat has been played on RPE yet, so its world is shown as it stands now.
          </p>
        ) : (
          <label class="lre-field">
            <span class="label">As it stood</span>
            <select class="lre-input" value={query.turn ?? ""} onChange={(event) => props.onQuery({ ...query, turn: event.currentTarget.value === "" ? null : event.currentTarget.value })}>
              <option value="">Now, at the chat's head</option>
              {(props.turns ?? []).map((turn) => (
                <option key={turn.id} value={turn.id}>
                  {`After the turn of ${when(turn.timings.received)} (${TURN_KIND_WORDS[turn.kind]})`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The world could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {root === undefined ? props.loading ? <p class="lre-muted rpe-line">Reading the world…</p> : null : <NodeTree node={root} byRef={byRef} root query={query} onQuery={props.onQuery} />}
      <Section id="map" title="The map of the scene's place">
        <p class="rpe-meta">This page cannot show a place's map yet.</p>
      </Section>
    </div>
  );
}

/** The World page of a chat: the tree read again whenever where it looks changes. */
export function WorldPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [query, setQuery] = useState<WorldQuery>(WORLD_START);
  const [shown, setShown] = useState<{ answer: WorldAnswer | null; loading: boolean; problem: string | null }>({ answer: null, loading: true, problem: null });
  const [turns, setTurns] = useState<readonly TurnSummary[] | null>(null);
  useEffect(() => {
    setQuery(WORLD_START);
    setShown({ answer: null, loading: true, problem: null });
    setTurns(null);
    // A read that failed leaves them unknown: the page then says nothing of whether any turn was played.
    return readTurns(app.client, chat, (read) => {
      if (!read.loading && read.problem === null) setTurns(read.turns);
    }).stop;
  }, [chat]);
  useEffect(() => {
    setShown((held) => ({ ...held, loading: true }));
    return readWorld(app.client, chat, query, (result) => setShown((held) => ({ answer: result.answer ?? held.answer, loading: false, problem: result.problem })));
  }, [chat, query]);
  return <WorldView query={query} {...shown} turns={turns} onQuery={setQuery} />;
}
