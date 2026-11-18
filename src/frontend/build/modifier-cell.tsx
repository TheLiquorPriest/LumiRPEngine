// A cell of the tabletop rules' modifiers in Build's table editor (RULESET-DESIGN §4.3): a trait's, a condition's, a size's, a
// weapon's or an armour's list of modifiers, one card a modifier: what it changes (offered from the names this world's totals and
// the layer's procedures ask for, any other word allowed), its value (a number, or a formula with `self`), its bonus type (offered
// from the types the ruleset and its rows name, any other allowed), when it holds, and a note shown where a total's parts are told.
// What cannot work is said under the field it is about; the cell keeps what is written, as every cell of the editor does.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import { Button, Card, Field, IconButton } from "../components";
import { checkBalance } from "./expr-editor";

/** What a modifier may name in this world: the names it is offered for what it changes, and the bonus types. */
export interface ModifierWords {
  names: readonly string[];
  types: readonly string[];
}

/** One modifier as it is typed: each part as its text, and what else it holds (a limit, what passes a reduction) kept as it was. */
interface Draft {
  key: number;
  to: string;
  value: string;
  type: string;
  when: string;
  note: string;
  rest: JsonObject;
}

/** Whether a cell holds a list of modifiers this form can show: none yet, or a list of objects. */
export function isModifierList(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.every((m) => isRecord(m)));
}

let next = 0;

function draftOf(m: JsonObject): Draft {
  const { to, value, type, when, note, ...rest } = m;
  const text = (v: JsonValue | undefined): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  return { key: next++, to: text(to), value: text(value), type: text(type), when: text(when), note: text(note), rest };
}

/** A typed value as the modifier keeps it: a number where it reads as one, else the formula as written. */
function valueOf(text: string): JsonValue {
  const t = text.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

function modifierOf(d: Draft): JsonObject {
  return {
    ...d.rest,
    to: d.to.trim(),
    value: valueOf(d.value),
    ...(d.type.trim() !== "" ? { type: d.type.trim() } : {}),
    ...(d.when.trim() !== "" ? { when: d.when.trim() } : {}),
    ...(d.note.trim() !== "" ? { note: d.note.trim() } : {}),
  };
}

/** What cannot work in a modifier, by its part, in words; nothing where it can. */
function problemsOf(d: Draft, words: ModifierWords): { to: string | null; value: string | null; when: string | null } {
  const to = d.to.trim();
  const value = d.value.trim();
  const when = d.when.trim();
  const formula = (text: string): string | null => {
    const read = checkBalance(text);
    return read.ok ? null : `Its formula does not read: ${read.message}.`;
  };
  return {
    to: to === "" ? "Say what it changes: a name a total asks for, such as one offered here." : words.names.length > 0 && !words.names.includes(to) && !to.includes("{choice}") ? `Nothing in this world's rules asks for ${to} yet, so it changes nothing until a total or a formula names it.` : null,
    value: value === "" ? "Give it a value: a number, or a formula with self as the one who has it." : typeof valueOf(value) === "number" ? null : formula(value),
    when: when === "" ? null : formula(when),
  };
}

/** One part of a modifier: its label, the input, the words it is offered, and what cannot work in it. */
function Part(props: { label: string; value: string; list?: string; placeholder?: string; help?: ComponentChildren; error?: string | null; mono?: boolean; onInput(text: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} for={id} help={props.help} error={props.error ?? null}>
      <input
        id={id}
        class={["lre-input", props.mono === true ? "lre-form-mono" : "", props.error ? "invalid" : ""].filter((c) => c !== "").join(" ")}
        list={props.list}
        placeholder={props.placeholder}
        spellcheck={false}
        aria-invalid={props.error ? true : undefined}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </Field>
  );
}

/** The cell: a card for each modifier, Add a modifier, and the names and types offered as you type. */
export function ModifiersField(props: { label: ComponentChildren; help: string | undefined; value: JsonValue | undefined; words: ModifierWords; onChange(value: JsonValue | undefined): void }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => (Array.isArray(props.value) ? props.value.flatMap((m) => (isRecord(m) ? [draftOf(m)] : [])) : []));
  const names = useId();
  const types = useId();
  const commit = (list: Draft[]): void => {
    setDrafts(list);
    props.onChange(list.length === 0 ? undefined : list.map(modifierOf));
  };
  const edit = (key: number, part: Partial<Omit<Draft, "key" | "rest">>): void => commit(drafts.map((d) => (d.key === key ? { ...d, ...part } : d)));
  return (
    <Field label={props.label} help={[props.help, "Each modifier says what it changes, its value (a number, or a formula with self), its bonus type, when it counts, and a note."].filter((x) => x !== undefined && x !== "").join(" ")}>
      <div class="lre-stack">
        {drafts.map((d, i) => {
          const problems = problemsOf(d, props.words);
          return (
            <Card key={d.key} title={`Modifier ${i + 1}`} aside={<IconButton icon="trash" label={`Remove modifier ${i + 1}`} onClick={() => commit(drafts.filter((x) => x.key !== d.key))} />}>
              <Part label="What it changes" value={d.to} list={names} placeholder="ac" mono error={problems.to} onInput={(to) => edit(d.key, { to })} />
              <Part label="Value" value={d.value} placeholder="2, or mod(self, 'cha')" mono error={problems.value} onInput={(value) => edit(d.key, { value })} />
              <Part label="Bonus type" value={d.type} list={types} placeholder="dodge" help="Of bonuses of one type only the best counts, unless the ruleset stacks that type. With no type, it adds to every other." onInput={(type) => edit(d.key, { type })} />
              <Part label="When it counts" value={d.when} mono help="A formula with self that must hold. Left empty, it always counts." error={problems.when} onInput={(when) => edit(d.key, { when })} />
              <Part label="Note" value={d.note} help="Shown beside it where a total's parts are told." onInput={(note) => edit(d.key, { note })} />
            </Card>
          );
        })}
        <div>
          <Button icon="plus" onClick={() => commit([...drafts, draftOf({ to: "", value: "" })])}>
            Add a modifier
          </Button>
        </div>
        <datalist id={names}>
          {props.words.names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id={types}>
          {props.words.types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </Field>
  );
}
