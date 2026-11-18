// Build's form parts , shared by the schema form and every sub-editor:
// the form sheet (a sub-editor's own page), the lint under a field, a group of fields, a yes-or-no
// field, an item list's row, the by-name reference pickers and chips. A leaf module: it imports no
// editor, so the editors can share it without import cycles. Styles: styles/forms.ts.

import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import type { LintIssue } from "../../shared/lint";
import { Disclosure, HostSelect, IdText, useShowIds } from "../components";
import { Icon } from "../../ui/icons";

export { Chip, FormSheet } from "../form-sheet";

/** The lint at a field, under its control: an error says so in the danger colour, a warning in the warning colour, each with its icon. */
export function Issues(props: { issues: readonly LintIssue[] }) {
  if (props.issues.length === 0) return null;
  return (
    <div class="lre-form-issues">
      {props.issues.map((issue, i) => (
        <span key={`${issue.path}:${issue.code}:${i}`} class={`lre-form-issue ${issue.severity === "error" ? "neg" : issue.severity === "warning" ? "warn" : "info"}`}>
          <Icon name={issue.severity === "info" ? "info" : "alert"} size={16} />
          <span>{issue.message}</span>
        </span>
      ))}
    </div>
  );
}

/** A group of fields in a card, under a plain title (a sub-object, an item's part); `aside` holds its actions. */
export function FormGroup(props: { title?: ComponentChildren; aside?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="lre-form-group">
      {props.title !== undefined || props.aside !== undefined ? (
        <div class="lre-form-group-head">
          <span class="lre-form-group-title">{props.title}</span>
          {props.aside}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * The foot of a part that keeps fields nothing RPE runs reads: one closed line, naming each field the world's file still holds. They
 * stay as the file has them; saving the part leaves them alone. Nothing shows when the file holds none of them.
 */
export function KeptUnused(props: { fields: readonly { key: string; label: string }[]; held: Readonly<Record<string, unknown>> }) {
  const kept = props.fields.filter((field) => props.held[field.key] !== undefined);
  if (kept.length === 0) return null;
  return (
    <Disclosure summary="Kept in the file, not used by this build">
      <p class="lre-build-note">Your world's file still holds these, and RPE does not use them. Saving this page leaves them as they are.</p>
      <ul class="lre-build-note">
        {kept.map((field) => (
          <li key={field.key}>{field.label}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** A yes-or-no field: its label and help beside a checkbox, the whole row the tap target. */
export function CheckField(props: { label: ComponentChildren; help?: ComponentChildren; checked: boolean; disabled?: boolean; issues?: readonly LintIssue[]; onChange(checked: boolean): void }) {
  return (
    <div class="lre-field">
      <label class="lre-form-switch">
        <span class="text">
          <span>{props.label}</span>
          {props.help !== undefined ? <span class="help">{props.help}</span> : null}
        </span>
        <span class="lre-check">
          <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)} />
        </span>
      </label>
      {props.issues ? <Issues issues={props.issues} /> : null}
    </div>
  );
}

/**
 * One row of an item list (inside `.lre-form-items`): the title and second line open the item
 * (`onOpen`, named by `openLabel`), with a chevron; `actions` (move, remove) sit at the end.
 */
export function ItemRow(props: { title: ComponentChildren; subtitle?: ComponentChildren; badge?: ComponentChildren; onOpen?(): void; openLabel?: string; actions?: ComponentChildren }) {
  const onOpen = props.onOpen;
  const text = (
    <span class="lre-form-item-text">
      <span class="lre-form-item-title">{props.title}</span>
      {props.subtitle !== undefined ? <span class="lre-form-item-sub">{props.subtitle}</span> : null}
    </span>
  );
  return (
    <div class="lre-form-item">
      {onOpen ? (
        <button type="button" class="lre-form-item-open" aria-label={props.openLabel} onClick={() => onOpen()}>
          {text}
          {props.badge}
          <Icon name="chevron-right" size={16} />
        </button>
      ) : (
        <span class="lre-form-item-open">
          {text}
          {props.badge}
        </span>
      )}
      {props.actions !== undefined ? <span class="lre-form-item-actions">{props.actions}</span> : null}
    </div>
  );
}

/** One choice of a by-name picker: the id it stores, the name it shows, and a second line. */
export interface RefOption {
  value: string;
  label: string;
  sublabel?: string;
}

/**
 * A reference picker by name: the host's searchable select. While Show ids is on,
 * every choice names its id and the picked id shows under the picker. `none` offers an empty
 * choice under that name, for a reference that may be left out. A value no choice holds (a deleted
 * item) stays listed as missing, so it shows and can be replaced.
 */
export function RefPicker(props: { label: string; value: string; options: readonly RefOption[]; none?: string; placeholder?: string; disabled?: boolean; onChange(value: string): void }) {
  const showIds = useShowIds();
  const options = useMemo(() => {
    // While Show ids is on, each choice names its id on the second line.
    const listed = showIds ? props.options.map((o) => ({ ...o, sublabel: o.sublabel ? `${o.value} · ${o.sublabel}` : o.value })) : props.options;
    const missing = props.value !== "" && !props.options.some((o) => o.value === props.value) ? [{ value: props.value, label: `${props.value} (missing)` }] : [];
    return [...(props.none !== undefined ? [{ value: "", label: props.none }] : []), ...listed, ...missing];
  }, [props.options, props.value, props.none, showIds]);
  return (
    <div class="lre-form-ref">
      {/* With `none` the empty value is a choice of its own, so no placeholder stands in for it. */}
      <HostSelect label={props.label} value={props.value} options={options} placeholder={props.none !== undefined ? undefined : (props.placeholder ?? "Choose…")} disabled={props.disabled} onChange={props.onChange} />
      {props.value !== "" ? <IdText id={props.value} /> : null}
    </div>
  );
}

/**
 * A picker that adds the choice picked to a list (links, selector constraints, a term's entries);
 * it always shows `placeholder`. `label` names it for assistive tech only: the list around it
 * shows its own label.
 */
export function AddPicker(props: { label: string; options: readonly RefOption[]; placeholder: string; disabled?: boolean; onAdd(value: string): void }) {
  const showIds = useShowIds();
  const options = useMemo(() => (showIds ? props.options.map((o) => ({ ...o, sublabel: o.sublabel ? `${o.value} · ${o.sublabel}` : o.value })) : props.options), [props.options, showIds]);
  return (
    <div class="lre-form-addpick">
      <HostSelect
        label={props.label}
        value=""
        options={options}
        placeholder={props.placeholder}
        disabled={props.disabled || options.length === 0}
        onChange={(value) => {
          if (value !== "") props.onAdd(value);
        }}
      />
    </div>
  );
}
