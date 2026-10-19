// Small form pieces the money dashboards and Build's money editors share, in the drawer's style
// (40 px targets, labelled inputs, the one money input for every typed amount).

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { WorldCurrency } from "../../../shared/world";
import { MoneyInput } from "../../../frontend/money-input";
import type { MoneyUnit } from "../../../shared/money";

export interface Choice {
  value: string;
  label: string;
}

export function SelectField(props: { label: string; value: string; options: readonly Choice[]; onChange(value: string): void; empty?: string; disabled?: boolean }) {
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <select class="lre-input" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)}>
        {props.empty !== undefined ? <option value="">{props.empty}</option> : null}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField(props: { label: string; value: string; onInput(value: string): void; placeholder?: string; list?: string; type?: "text" | "date" | "time"; hint?: string }) {
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      {props.type === "date" ? (
        <input class="lre-input" type="date" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : props.type === "time" ? (
        <input class="lre-input" type="time" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : props.list ? (
        <input class="lre-input" type="text" list={props.list} placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : (
        <input class="lre-input" type="text" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      )}
      {props.hint ? <span class="lre-small lre-muted">{props.hint}</span> : null}
    </label>
  );
}

/** A whole number or a decimal typed as text; empty is null, and what isn't a number marks the box. */
export function NumberField(props: { label: string; value: number | null; onChange(value: number | null): void; min?: number; max?: number; step?: number; placeholder?: string }) {
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  const parsed = text.trim() === "" ? null : Number(text);
  const bad = parsed !== null && (!Number.isFinite(parsed) || (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max));
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <input
        class={bad ? "lre-input invalid" : "lre-input"}
        inputMode="decimal"
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
    </label>
  );
}

export function AmountField(props: { label: string; value: string; currency: WorldCurrency; onInput(value: string): void; invalid?: boolean; placeholder?: string; unit?: MoneyUnit }) {
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <MoneyInput currency={props.currency} value={props.value} onInput={props.onInput} label={props.label} invalid={props.invalid} placeholder={props.placeholder} unit={props.unit} />
    </div>
  );
}

/** A button that opens a small form under it, and the form; the form closes itself through `close`. */
export function Reveal(props: { label: string; children: (close: () => void) => ComponentChildren; primary?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" class={props.primary ? "lre-btn small primary" : "lre-btn small"} disabled={props.disabled} onClick={() => setOpen(true)}>
        {props.label}
      </button>
    );
  }
  return (
    <div class="lre-card lre-stack" data-lre-form={props.label}>
      <div class="lre-spread">
        <span class="lre-small lre-muted">{props.label}</span>
        <button type="button" class="lre-btn small ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {props.children(() => setOpen(false))}
    </div>
  );
}

/** The weekday names a calendar uses, Sunday first, as choices. */
export const WEEKDAY_CHOICES: readonly Choice[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ value: String(i), label }));

export const MONTH_CHOICES: readonly Choice[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, i) => ({ value: String(i + 1), label }));
