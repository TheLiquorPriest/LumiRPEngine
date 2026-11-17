// The World page's drawn parts: a level with what is beneath it, its values with where each comes from and
// the change that last wrote it, the facts recorded under a value's key beside it (never in its place), and
// the slots the page fills with what has state of its own (a value's history and edit, a level's systems).

import type { ComponentChildren } from "preact";
import type { LevelFact, LevelKind, LevelMark, LevelNode, LevelValue } from "../../../shared/api";
import { Badge, Button, Row } from "../../atoms";
import { marksWords } from "../../marks";
import type { WorldQuery } from "./read";
import { counted } from "../../words";

export const KIND_WORDS: Readonly<Record<LevelKind, string>> = { world: "The world", place: "Place", entity: "Entity", groups: "The groups", elsewhere: "Elsewhere" };

/** How exact and how sure a recorded value is, where it came from, and the turn that wrote it. */
export function markWords(mark: Pick<LevelMark, "n" | "precision" | "standing" | "source">): string {
  return `${marksWords(mark)}, turn ${mark.n}`;
}

/** Where a value comes from, and the change that last wrote it. */
function sourceWords(line: LevelValue): string {
  const { from } = line;
  const where = from?.system !== undefined ? `kept by the ${from.system} system` : from?.ref !== undefined ? `inherited from ${from.name ?? from.ref}` : "its own";
  return line.mark === undefined ? where : `${where}; ${markWords(line.mark)}`;
}

/** What the page fills in beside what it draws: each is drawn by a component with state of its own, so the parts stay plain. */
export interface WorldSlots {
  /** Under a level's own parts: what to add there, its typed systems, what time brought due at it. */
  node?(node: LevelNode): ComponentChildren;
  /** Under a value's row: its history, and its edit. */
  value?(node: LevelNode, line: LevelValue): ComponentChildren;
  /** Under a fact's line: its history, and its edit. */
  fact?(node: LevelNode, fact: LevelFact): ComponentChildren;
  /** Below the tree: the things browser (`kept/things-page.tsx`). */
  things?: ComponentChildren;
}

export function FactLine(props: { fact: LevelFact; below?: ComponentChildren }) {
  const { fact } = props;
  return (
    <div class="lre-stack" data-fact={fact.id}>
      <p class="rpe-line rpe-fact">
        <Badge tone="gm">fact</Badge> {fact.key}: {fact.value} <span class="rpe-meta">({fact.by === null ? markWords(fact) : `${markWords(fact)}, by ${fact.by}`})</span>
      </p>
      {props.below}
    </div>
  );
}

/** A value, with where it comes from, and the facts recorded beside it under the same key. */
function ValueRow(props: { node: LevelNode; line: LevelValue; facts: readonly LevelFact[]; slots: WorldSlots }) {
  const { node, line, slots } = props;
  return (
    <div class="rpe-value" data-key={line.key}>
      <Row label={line.key} value={line.value ?? "none"} sub={sourceWords(line)} />
      {slots.value?.(node, line)}
      {props.facts.map((fact) => (
        <FactLine key={fact.id} fact={fact} below={slots.fact?.(node, fact)} />
      ))}
    </div>
  );
}

/** What is beneath a level, as recorded. */
function ReflectionLine(props: { node: LevelNode }) {
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
function NodeBox(props: { node: LevelNode; root: boolean; hidden: number; slots: WorldSlots; onOpen(): void; onBelow(): void }) {
  const { node, slots } = props;
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
              <ValueRow key={line.key} node={node} line={line} facts={node.facts.filter((fact) => fact.key === line.key)} slots={slots} />
            ))}
          </div>
        )}
        {apart.length === 0 ? null : (
          <div class="lre-stack">
            <span class="rpe-caption">Facts on it</span>
            {apart.map((fact) => (
              <FactLine key={fact.id} fact={fact} below={slots.fact?.(node, fact)} />
            ))}
          </div>
        )}
        {props.hidden === 0 ? null : (
          <Button small onClick={props.onBelow}>
            {`${counted(props.hidden, "level")} below`}
          </Button>
        )}
        {slots.node?.(node)}
      </div>
    </section>
  );
}

/** A level and the levels below it the answer holds, nested; a level whose children it does not hold offers to open them. */
export function NodeTree(props: { node: LevelNode; byRef: ReadonlyMap<string, LevelNode>; root: boolean; query: WorldQuery; slots: WorldSlots; onQuery(next: WorldQuery): void }) {
  const { node, query } = props;
  const below = node.children.flatMap((ref) => props.byRef.get(ref) ?? []);
  const open = (): void => props.onQuery({ ...query, at: node.ref });
  return (
    <div class="lre-stack" data-tree={node.ref}>
      <NodeBox node={node} root={props.root} hidden={node.children.length - below.length} slots={props.slots} onOpen={open} onBelow={props.root ? () => props.onQuery({ ...query, depth: query.depth + 1 }) : open} />
      {below.length === 0 ? null : (
        <div class="rpe-children">
          {below.map((child) => (
            <NodeTree key={child.ref} node={child} byRef={props.byRef} root={false} query={query} slots={props.slots} onQuery={props.onQuery} />
          ))}
        </div>
      )}
    </div>
  );
}
