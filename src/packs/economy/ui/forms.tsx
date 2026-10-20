// The money hub's form pieces: labelled fields on the shared atoms (40 px targets,
// the one money input for every typed amount), and the action page every control opens: its fields,
// then one primary button that sends the request and, once it's accepted, goes back to the page
// the action was opened from. Whenever the button is held, the page says why.

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useId, useState } from "preact/hooks";
import type { MoneyUnit } from "../../../shared/money";
import type { WorldCurrency } from "../../../shared/world";
import { Button, Field } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { MoneyInput } from "../../../frontend/money-input";
import type { HubControls } from "./hub";
import { MoneyPage, type HubNav } from "./nav";
import { amountOf } from "./requests";

export interface Choice {
  value: string;
  label: string;
}

/** A choice with a second line under its label (an amount, what it means). */
export interface ChoiceOption extends Choice {
  detail?: ComponentChildren;
}

export function SelectField(props: { label: string; value: string; options: readonly Choice[]; onChange(value: string): void; empty?: string; disabled?: boolean; help?: ComponentChildren }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} for={id}>
      <select id={id} class="lre-input" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)}>
        {props.empty !== undefined ? <option value="">{props.empty}</option> : null}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextField(props: { label: string; value: string; onInput(value: string): void; placeholder?: string; list?: string; type?: "text" | "date" | "time"; help?: ComponentChildren }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} for={id}>
      {props.type === "date" || props.type === "time" ? (
        <input id={id} class="lre-input" type={props.type} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : (
        <input id={id} class="lre-input" type="text" list={props.list} placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      )}
    </Field>
  );
}

/**
 * How a field on an action page says its text isn't a value it can send (a number out of range,
 * say), in words naming the field: the page's button waits until no field says so, and the page
 * shows what each says, so the reason is in sight though the field is folded away.
 */
const FieldValidity = createContext<((field: string, reason: string | null) => void) | null>(null);

/** Why a number field's text can't be sent, naming the field and the numbers it takes. */
export function numberProblem(label: string, min?: number, max?: number): string {
  // A label's closing aside ("(days)", "(1–28)") helps fill the box; it isn't the field's name.
  const name = label.replace(/\s*\([^()]*\)$/, "");
  const range = min !== undefined && max !== undefined ? ` from ${min} to ${max}` : min !== undefined ? ` of ${min} or more` : max !== undefined ? ` of ${max} or less` : "";
  return `“${name}” takes a number${range}.`;
}

/** A whole number or a decimal typed as text; empty is null, and what isn't a number in range marks the box and holds the page's button with the reason. */
export function NumberField(props: { label: string; value: number | null; onChange(value: number | null): void; min?: number; max?: number; step?: number; placeholder?: string; help?: ComponentChildren }) {
  const id = useId();
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  const parsed = text.trim() === "" ? null : Number(text);
  const bad = parsed !== null && (!Number.isFinite(parsed) || (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max));
  const reason = bad ? numberProblem(props.label, props.min, props.max) : null;
  const mark = useContext(FieldValidity);
  useEffect(() => {
    mark?.(id, reason);
    return () => mark?.(id, null);
  }, [mark, id, reason]);
  return (
    <Field label={props.label} help={props.help} for={id}>
      <input
        id={id}
        class={bad ? "lre-input invalid" : "lre-input"}
        inputMode="decimal"
        aria-invalid={bad || undefined}
        placeholder={props.placeholder}
        value={text}
        onInput={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const n = next.trim() === "" ? null : Number(next);
          if (n === null) props.onChange(null);
          else if (Number.isFinite(n) && (props.min === undefined || n >= props.min) && (props.max === undefined || n <= props.max)) props.onChange(n);
        }}
      />
    </Field>
  );
}

/** An amount in the world's currency (its symbol inside the box), kept as typed. */
export function AmountField(props: { label: string; value: string; currency: WorldCurrency; onInput(value: string): void; invalid?: boolean; placeholder?: string; unit?: MoneyUnit; help?: ComponentChildren }) {
  return (
    <Field label={props.label} help={props.help}>
      <MoneyInput currency={props.currency} value={props.value} onInput={props.onInput} label={props.label} invalid={props.invalid} placeholder={props.placeholder} unit={props.unit} />
    </Field>
  );
}

/** One of a few choices as radio rows, each a 44 px target with an optional second line. */
export function ChoiceField(props: { label: string; value: string; options: readonly ChoiceOption[]; onChange(value: string): void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset class="lre-money-choices" disabled={props.disabled}>
      <legend class="lre-money-choices-label">{props.label}</legend>
      <div class="lre-money-choice-list">
        {props.options.map((o) => (
          <label key={o.value} class="lre-money-choice">
            <input type="radio" name={name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
            <span class="lre-money-choice-text">
              <span class="lre-money-choice-label">{o.label}</span>
              {o.detail !== undefined ? <span class="lre-money-choice-detail">{o.detail}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A yes-or-no field: its label and help beside a checkbox, the whole row the tap target. */
export function ToggleField(props: { label: ComponentChildren; help?: ComponentChildren; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }) {
  return (
    <label class="lre-money-toggle">
      <span class="lre-money-toggle-text">
        <span>{props.label}</span>
        {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      </span>
      <span class="lre-check">
        <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      </span>
    </label>
  );
}

/**
 * An action's own page: its fields, then one primary button that sends it, busy while the
 * request runs. Accepted, it goes back to the page it was opened from (`nav.back` does nothing once
 * the page has been left, so a Back tapped while the request ran isn't doubled); declined, it
 * stays, and the toast says why. The button is held only for a reason the page shows above it:
 * `problem`, what the page says is missing, and each number field's text it can't send, which
 * names the field, so the reason is in sight though the field is folded away. A one-tap action's
 * page states what it does in its children, which is its confirmation.
 */
export function ActionPage(props: { nav: HubNav; controls: HubControls; name: string; title: ComponentChildren; subtitle?: ComponentChildren; go: ComponentChildren; danger?: boolean; problem?: string | null; submit(): Promise<boolean>; children?: ComponentChildren }) {
  const { nav, controls } = props;
  const [fields, setFields] = useState<ReadonlyMap<string, string>>(() => new Map());
  const mark = useCallback((field: string, reason: string | null) => {
    setFields((was) => {
      if ((was.get(field) ?? null) === reason) return was;
      const next = new Map(was);
      if (reason === null) next.delete(field);
      else next.set(field, reason);
      return next;
    });
  }, []);
  const reasons = [...new Set([...fields.values(), ...(props.problem ? [props.problem] : [])])];
  const blocked = reasons.length > 0;
  return (
    <MoneyPage nav={nav} name={props.name} title={props.title} subtitle={props.subtitle}>
      <FieldValidity.Provider value={mark}>
        <form
          class="lre-money-form"
          data-lre-money-action={props.name}
          onSubmit={(event) => {
            event.preventDefault();
            if (controls.busy || blocked) return;
            void props.submit().then((ok) => ok && nav.back());
          }}
        >
          {props.children}
          {reasons.map((r) => (
            <p key={r} class="lre-money-problem">
              {r}
            </p>
          ))}
          <Button type="submit" variant={props.danger ? "danger" : "primary"} block busy={controls.busy} disabled={blocked}>
            {props.go}
          </Button>
        </form>
      </FieldValidity.Provider>
    </MoneyPage>
  );
}

/** Why the amount typed for `what` ("the rent") can't be sent, or null: none typed where one is needed, or text that isn't an amount above zero. */
export function amountProblem(text: string, currency: WorldCurrency, what: string, needed = true): string | null {
  if (text.trim() === "") return needed ? `Type ${what}.` : null;
  return amountOf(text, currency) === null ? "Type an amount above zero." : null;
}

/** Why a GM's state page holds its button: the state picked is the one in force, `now`. */
export function unchangedProblem(now: string, what: string): string {
  return `It's ${humanize(now).toLowerCase()} now: pick another ${what}.`;
}

/** An action page whose field is an amount: required, or empty only with `optional`, the words for what an empty amount means ("The whole balance"). */
export function AmountPage(props: { nav: HubNav; controls: HubControls; name: string; title: ComponentChildren; subtitle?: ComponentChildren; label: string; go: ComponentChildren; danger?: boolean; optional?: string; initial?: string; help?: ComponentChildren; submit(cents: number | null): Promise<boolean>; children?: ComponentChildren }) {
  const { controls } = props;
  const [text, setText] = useState(props.initial ?? "");
  const empty = text.trim() === "";
  const cents = empty ? null : amountOf(text, controls.currency);
  return (
    <ActionPage nav={props.nav} controls={controls} name={props.name} title={props.title} subtitle={props.subtitle} go={props.go} danger={props.danger} problem={amountProblem(text, controls.currency, "an amount", props.optional === undefined)} submit={() => props.submit(cents)}>
      {props.children}
      <AmountField label={props.label} value={text} currency={controls.currency} onInput={setText} invalid={!empty && cents === null} placeholder={props.optional} help={props.help} />
    </ActionPage>
  );
}

/** The weekday names a calendar uses, Sunday first, as choices. */
export const WEEKDAY_CHOICES: readonly Choice[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ value: String(i), label }));

export const MONTH_CHOICES: readonly Choice[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, i) => ({ value: String(i + 1), label }));
