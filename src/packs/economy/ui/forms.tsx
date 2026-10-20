// The money hub's form pieces (contract D-UI9): labelled fields on the shared atoms (40 px targets,
// the one money input for every typed amount), and the action page every control opens: its fields,
// then one primary button that sends the request and, once it's accepted, goes back to the page
// the action was opened from.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { MoneyUnit } from "../../../shared/money";
import type { WorldCurrency } from "../../../shared/world";
import { Button, Field } from "../../../frontend/components";
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

/** A whole number or a decimal typed as text; empty is null, and what isn't a number marks the box. */
export function NumberField(props: { label: string; value: number | null; onChange(value: number | null): void; min?: number; max?: number; step?: number; placeholder?: string; help?: ComponentChildren }) {
  const id = useId();
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  const parsed = text.trim() === "" ? null : Number(text);
  const bad = parsed !== null && (!Number.isFinite(parsed) || (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max));
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
 * An action's own page (D-UI9): its fields, then one primary button that sends it, busy while the
 * request runs. Accepted, it goes back to the page it was opened from (`nav.back` does nothing once
 * the page has been left, so a Back tapped while the request ran isn't doubled); declined, it
 * stays, and the toast says why. `problem` says in words what's missing and holds the button back;
 * a one-tap action's page states what it does in its children, which is its confirmation.
 */
export function ActionPage(props: { nav: HubNav; controls: HubControls; name: string; title: ComponentChildren; subtitle?: ComponentChildren; go: ComponentChildren; danger?: boolean; disabled?: boolean; problem?: string | null; submit(): Promise<boolean>; children?: ComponentChildren }) {
  const { nav, controls } = props;
  const blocked = props.disabled === true || (props.problem !== undefined && props.problem !== null);
  return (
    <MoneyPage nav={nav} name={props.name} title={props.title} subtitle={props.subtitle}>
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
        {props.problem ? <p class="lre-money-problem">{props.problem}</p> : null}
        <Button type="submit" variant={props.danger ? "danger" : "primary"} block busy={controls.busy} disabled={blocked}>
          {props.go}
        </Button>
      </form>
    </MoneyPage>
  );
}

/** An action page whose field is an amount: required, or empty only with `optional`, the words for what an empty amount means ("The whole balance"). */
export function AmountPage(props: { nav: HubNav; controls: HubControls; name: string; title: ComponentChildren; subtitle?: ComponentChildren; label: string; go: ComponentChildren; danger?: boolean; optional?: string; initial?: string; help?: ComponentChildren; submit(cents: number | null): Promise<boolean>; children?: ComponentChildren }) {
  const { controls } = props;
  const [text, setText] = useState(props.initial ?? "");
  const empty = text.trim() === "";
  const cents = empty ? null : amountOf(text, controls.currency);
  const ok = empty ? props.optional !== undefined : cents !== null;
  return (
    <ActionPage nav={props.nav} controls={controls} name={props.name} title={props.title} subtitle={props.subtitle} go={props.go} danger={props.danger} disabled={!ok} submit={() => props.submit(cents)}>
      {props.children}
      <AmountField label={props.label} value={text} currency={controls.currency} onInput={setText} invalid={!empty && cents === null} placeholder={props.optional} help={props.help} />
    </ActionPage>
  );
}

/** The weekday names a calendar uses, Sunday first, as choices. */
export const WEEKDAY_CHOICES: readonly Choice[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ value: String(i), label }));

export const MONTH_CHOICES: readonly Choice[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, i) => ({ value: String(i + 1), label }));
