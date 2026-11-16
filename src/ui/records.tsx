// What the Cast and Story pages share: an entry of a record as stored, with its fields as they were
// written, the write that made it and every write of it, whether it is struck, and the button that
// strikes it or takes its strike back. What an agent, the player or a migration wrote is shown as text.

import type { ComponentChildren } from "preact";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import { Badge, Button, Fold, Pre } from "./atoms";
import { json } from "./words";

/** One write of an entry, as both records keep it. */
export interface WriteShown {
  /** The turn that wrote it; null for his own change, of no turn. */
  turn: string | null;
  message: number | null;
  imported: boolean;
  by: string | null;
  wrote: JsonObject;
}

/** Where a write was made: its turn, that turn's reply on the path, who made it, and whether a migration carried it. */
export function writeWords(w: Omit<WriteShown, "wrote">): string {
  const at = w.turn === null ? "his own change, of no turn" : w.message === null ? `turn ${w.turn}, on no path` : `turn ${w.turn}, message ${w.message}`;
  return [at, w.by === null ? null : `by ${w.by}`, w.imported ? "carried by the migration" : null].filter((part) => part !== null).join(" · ");
}

/** An entry's fields, each by its name, its value as it was written. */
export function Fields(props: { fields: JsonObject }) {
  const names = Object.keys(props.fields);
  if (names.length === 0) return null;
  return (
    <dl class="rpe-fields">
      {names.map((name) => {
        const value = props.fields[name] as JsonValue;
        // Text as it was written; anything else as JSON.
        const text = typeof value === "string" ? value : json(value);
        return (
          <div key={name} class="rpe-field">
            <dt>{name}</dt>
            <dd>{text.includes("\n") ? <Pre text={text} mono={typeof value !== "string"} /> : text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** What a strike or its taking back is asked for: the entry, and which. */
export interface StrikeAsk {
  id: string;
  struck: boolean;
}

export interface EntryCardProps {
  id: string;
  /** Its title: what kind of entry it is, and what marks it out. */
  title: string;
  /** Beside the title: a tier, a casting, a span. */
  marks?: ComponentChildren;
  fields: JsonObject;
  first: Omit<WriteShown, "wrote">;
  struck: boolean;
  writes: readonly WriteShown[];
  /** Below the fields: a carried file's text, a perception's turn. */
  more?: ComponentChildren;
  /** A strike or its taking back for this entry is out now. */
  busy: boolean;
  onStrike(ask: StrikeAsk): void;
}

/** An entry of a record: its fields as written, struck shown as struck, its first write, every write of it on demand, and Strike or Take back. */
export function EntryCard(props: EntryCardProps) {
  return (
    <li class="rpe-entry lre-stack" data-entry={props.id} data-struck={props.struck ? "true" : undefined}>
      <div class="lre-spread rpe-wrap">
        <span class="lre-inline rpe-wrap">
          <span class={props.struck ? "rpe-strong rpe-struck" : "rpe-strong"}>{props.title}</span>
          {props.marks}
          {props.struck ? <Badge tone="neg">struck</Badge> : null}
        </span>
        <Button small kind="ghost" busy={props.busy} onClick={() => props.onStrike({ id: props.id, struck: !props.struck })}>
          {props.struck ? "Take back the strike" : "Strike"}
        </Button>
      </div>
      <div class={props.struck ? "rpe-struck" : undefined}>
        <Fields fields={props.fields} />
      </div>
      {props.more}
      <p class="rpe-meta">First written at {writeWords(props.first)}</p>
      {props.writes.length < 2 ? null : (
        <Fold summary={`Its ${props.writes.length} writes`}>
          <ol class="lre-stack rpe-plain">
            {props.writes.map((w, i) => (
              <li key={i} class="lre-stack">
                <span class="rpe-meta">{writeWords(w)}</span>
                <Pre text={json(w.wrote)} />
              </li>
            ))}
          </ol>
        </Fold>
      )}
    </li>
  );
}
