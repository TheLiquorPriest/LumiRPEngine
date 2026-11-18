// What the Cast and Story pages share: an entry of a record as stored, with its fields as they were
// written, the write that made it and every write of it, whether it is struck, and the button that
// strikes it or takes its strike back. What an agent, the player or a migration wrote is shown as text.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import { Badge, Banner, Button, Disclosure, Pre } from "../frontend/components";
import { errorWords, json } from "./words";

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
  const at = w.turn === null ? "your own change, of no turn" : w.message === null ? `turn ${w.turn}, on no path` : `turn ${w.turn}, message ${w.message}`;
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
  /** Where he may correct it: sends the fields he set, and answers what the record said of them. */
  onCorrect?(ask: CorrectAsk): Promise<string[]>;
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
        <Button size="sm" variant="ghost" busy={props.busy} onClick={() => props.onStrike({ id: props.id, struck: !props.struck })}>
          {props.struck ? "Take back the strike" : "Strike"}
        </Button>
      </div>
      <div class={props.struck ? "rpe-struck" : undefined}>
        <Fields fields={props.fields} />
      </div>
      {props.onCorrect === undefined ? null : <Correction id={props.id} fields={props.fields} onCorrect={props.onCorrect} />}
      {props.more}
      <p class="rpe-meta">First written at {writeWords(props.first)}</p>
      {props.writes.length < 2 ? null : (
        <Disclosure summary={`Its ${props.writes.length} writes`}>
          <ol class="lre-stack rpe-plain">
            {props.writes.map((w, i) => (
              <li key={i} class="lre-stack">
                <span class="rpe-meta">{writeWords(w)}</span>
                <Pre text={json(w.wrote)} />
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
    </li>
  );
}

/** What a correction sends: the entry, and each field he changed or added, as the entry shows it. */
export interface CorrectAsk {
  id: string;
  fields: { [key: string]: JsonValue };
}

/** A field's text for editing: a word as it is, anything else as JSON. */
export function fieldText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** What he typed for a field back as a value of the kind it was: a word stays a word, a number a number, a yes or no a yes or no, the rest JSON; null where it cannot be read as that kind. */
export function fieldValue(was: JsonValue | undefined, typed: string): JsonValue | null {
  if (was === undefined || typeof was === "string") return typed;
  if (typeof was === "number") return typed.trim() !== "" && Number.isFinite(Number(typed)) ? Number(typed) : null;
  if (typeof was === "boolean") return typed.trim() === "true" ? true : typed.trim() === "false" ? false : null;
  try {
    return JSON.parse(typed) as JsonValue;
  } catch {
    return null;
  }
}

/** The fields he changed: each draft that differs from what the entry shows, read as the kind it was; the names that could not be read as that kind. */
export function changedFields(fields: JsonObject, drafts: Readonly<Record<string, string>>): { set: { [key: string]: JsonValue }; unreadable: string[] } {
  const set: { [key: string]: JsonValue } = {};
  const unreadable: string[] = [];
  for (const [name, typed] of Object.entries(drafts)) {
    const was = fields[name];
    if (was !== undefined && typed === fieldText(was)) continue;
    if (was === undefined && typed === "") continue;
    const value = fieldValue(was, typed);
    if (value === null && !(was !== undefined && was === null)) unreadable.push(name);
    else set[name] = value;
  }
  return { set, unreadable };
}

/** Correct an entry: each of its fields as text to edit, and one more to add; saved as his own change, with what the record said of it. */
export function Correction(props: { id: string; fields: JsonObject; onCorrect(ask: CorrectAsk): Promise<string[]> }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState({ name: "", value: "" });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = (name: string): string => drafts[name] ?? fieldText(props.fields[name] as JsonValue);
  const save = (): void => {
    const all = { ...Object.fromEntries(Object.keys(props.fields).map((name) => [name, shown(name)])), ...(extra.name.trim() === "" ? {} : { [extra.name.trim()]: extra.value }) };
    const { set, unreadable } = changedFields(props.fields, all);
    if (unreadable.length > 0) {
      setProblem(`Cannot read ${unreadable.join(", ")} as the kind of value it holds.`);
      return;
    }
    if (Object.keys(set).length === 0) {
      setProblem("Nothing is changed.");
      return;
    }
    setBusy(true);
    setProblem(null);
    props.onCorrect({ id: props.id, fields: set }).then(
      (lines) => {
        setBusy(false);
        setSaid(lines);
        setDrafts({});
        setExtra({ name: "", value: "" });
        setOpen(false);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <div class="lre-stack" data-correction={props.id}>
      {open ? null : (
        <div class="lre-inline">
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Correct it
          </Button>
        </div>
      )}
      {said === null || said.length === 0 ? null : (
        <ul class="rpe-reports" data-said>
          {said.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {!open ? null : (
        <div class="lre-stack rpe-open" data-correcting>
          {Object.keys(props.fields).map((name) => (
            <label key={name} class="lre-field">
              <span class="label">{name}</span>
              <textarea class="lre-input" rows={2} value={shown(name)} onInput={(e) => setDrafts((held) => ({ ...held, [name]: (e.currentTarget as HTMLTextAreaElement).value }))} />
            </label>
          ))}
          <div class="rpe-log-filters">
            <label class="lre-field">
              <span class="label">Another field</span>
              <input class="lre-input" value={extra.name} spellcheck={false} onInput={(e) => setExtra((held) => ({ ...held, name: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label class="lre-field">
              <span class="label">Its value</span>
              <input class="lre-input" value={extra.value} onInput={(e) => setExtra((held) => ({ ...held, value: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
          </div>
          {problem === null ? null : (
            <Banner tone="neg" icon="alert" title="Not saved">
              <span data-correct-problem>{problem}</span>
            </Banner>
          )}
          <div class="lre-inline">
            <Button busy={busy} onClick={save}>
              Save as my correction
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
