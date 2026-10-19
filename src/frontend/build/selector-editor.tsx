// Build's selector editor (DESIGN §4.1, §13): one widget for every place a world picks entities by
// rule (a schedule owned by a selector, an action parameter's candidates, visibility grants). A
// selector lists constraints that must all hold, each one any of its values: kinds (with
// inheritance), tiers, classification values (nested values included), tags, groups (members,
// through member groups too) and ids. Each constraint is a field of chips, named by label (ids stay
// hidden, D-UI6), so it wraps at phone width. Also the chip tag list, used for entity tags.
// Styles: styles/forms.ts.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { facetsInOrder } from "../../shared/classes";
import { isRecord } from "../../shared/json";
import { tiersInOrder } from "../../shared/tiers";
import type { EntityId } from "../../shared/ids";
import type { Selector, WorldDoc } from "../../shared/world";
import { Button, IdText } from "../components";
import { ChipLines, facetOptions } from "./facet-editor";
import type { RefOption } from "./form-kit";
import { AddPicker, Chip, FormGroup } from "./form-kit";

/** A selector as stored in the world document, keeping only what has the selector's shape. */
export function selectorOf(v: unknown): Selector | undefined {
  if (!isRecord(v)) return undefined;
  const out: Selector = {};
  for (const key of ["ids", "kind", "tier", "memberOf", "tag"] as const) {
    const list: unknown = v[key];
    if (Array.isArray(list)) out[key] = list.filter((x): x is string => typeof x === "string");
  }
  if (isRecord(v.class)) out.class = Object.fromEntries(Object.entries(v.class).map(([facet, values]) => [facet, Array.isArray(values) ? values.filter((x): x is string => typeof x === "string") : []]));
  return out;
}

/** The kind every group extends (the relationships pack's `group`). */
const GROUP_KIND = "group";

/** Every tag the world's entities carry, sorted: what a tag field suggests. */
export function worldTags(doc: WorldDoc): string[] {
  const out = new Set<string>();
  for (const e of Object.values(doc.entities)) for (const t of Array.isArray(e.tags) ? e.tags : []) if (typeof t === "string") out.add(t);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** True when `kind` is `ancestor` or inherits from it in `doc`'s kinds (display only; cycles stop the walk). */
export function kindIs(doc: WorldDoc, kind: string, ancestor: string): boolean {
  const seen = new Set<string>();
  for (let id: string | undefined = kind; id !== undefined && !seen.has(id); id = doc.kinds[id]?.extends) {
    if (id === ancestor) return true;
    seen.add(id);
  }
  return false;
}

/** Entities whose kind is a group (or extends one), by name: what "member of" offers. */
export function groupOptions(doc: WorldDoc): { value: EntityId; label: string }[] {
  return Object.values(doc.entities)
    .filter((e) => kindIs(doc, e.kind, GROUP_KIND))
    .map((e) => ({ value: e.id, label: e.name || e.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Free-form tags as removable chips, with an add row whose input suggests tags already in use.
 * Enter, Add or a typed comma adds; pasting "a, b" adds both; a tag already listed is skipped.
 * `noun` names an item ("alias"); `children` (the lint) show under it.
 */
export function TagListInput(props: { label: string; value: readonly string[]; suggestions: readonly string[]; noun?: string; children?: ComponentChildren; onChange(next: string[]): void }) {
  const noun = props.noun ?? "tag";
  const [text, setText] = useState("");
  const list = useId();
  // Every comma-separated piece of `raw` the list lacks, once each.
  const commit = (raw: string) => {
    const more = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "" && !props.value.includes(t));
    if (more.length > 0) props.onChange([...props.value, ...new Set(more)]);
  };
  const add = () => {
    commit(text);
    setText("");
  };
  return (
    <div class="lre-field" data-lre-tags>
      <span class="label">{props.label}</span>
      {props.value.length > 0 ? (
        <div class="lre-form-chips">
          {props.value.map((tag) => (
            <Chip key={tag} removeLabel={`Remove ${noun} ${tag}`} onRemove={() => props.onChange(props.value.filter((t) => t !== tag))}>
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}
      <div class="lre-form-add">
        <input
          class="lre-input"
          list={list}
          placeholder={`Add ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`}
          aria-label={`Add to ${props.label}`}
          value={text}
          onInput={(event) => {
            const typed = event.currentTarget.value;
            // A typed comma ends a tag: what comes before it is added, the rest stays to finish.
            const cut = typed.lastIndexOf(",");
            if (cut < 0) {
              setText(typed);
              return;
            }
            commit(typed.slice(0, cut));
            setText(typed.slice(cut + 1).trimStart());
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") ?? "";
            if (!pasted.includes(",")) return;
            event.preventDefault();
            commit(`${text},${pasted}`);
            setText("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <Button size="sm" icon="plus" disabled={text.trim() === ""} onClick={add}>
          Add
        </Button>
        <datalist id={list}>
          {props.suggestions
            .filter((t) => !props.value.includes(t))
            .map((t) => (
              <option key={t} value={t} />
            ))}
        </datalist>
      </div>
      {props.children}
    </div>
  );
}

/** A constraint as removable chips, named by label (a value no option holds shows as missing), plus a picker for one more. */
function PickList(props: { label: string; help?: string; value: readonly string[]; options: readonly RefOption[]; placeholder: string; onChange(next: string[]): void }) {
  const left = props.options.filter((o) => !props.value.includes(o.value));
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      {props.value.length > 0 ? (
        <div class="lre-form-chips">
          {props.value.map((id) => {
            const name = props.options.find((o) => o.value === id)?.label;
            return (
              <Chip key={id} tone={name === undefined ? "warn" : undefined} removeLabel={`Remove ${name ?? id}`} onRemove={() => props.onChange(props.value.filter((other) => other !== id))}>
                {name ?? `${id} (missing)`} <IdText id={id} />
              </Chip>
            );
          })}
        </div>
      ) : null}
      {left.length > 0 ? <AddPicker label={`Add to ${props.label}`} options={left} placeholder={props.placeholder} onAdd={(id) => props.onChange([...props.value, id])} /> : null}
    </div>
  );
}

/** A toggle chip per option, pressed when the value lists it; a listed value no option holds stays as a removable warning chip. */
function Toggles(props: { label: string; help?: string; value: readonly string[]; options: readonly RefOption[]; onChange(next: string[]): void }) {
  const unknown = props.value.filter((v) => !props.options.some((o) => o.value === v));
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      <div class="lre-form-chips" role="group" aria-label={props.label}>
        {props.options.map((o) => {
          const on = props.value.includes(o.value);
          return (
            <Chip key={o.value} pressed={on} onToggle={() => props.onChange(on ? props.value.filter((v) => v !== o.value) : [...props.value, o.value])}>
              <ChipLines option={o} />
            </Chip>
          );
        })}
        {unknown.map((v) => (
          <Chip key={v} tone="warn" removeLabel={`Remove ${v}`} onRemove={() => props.onChange(props.value.filter((x) => x !== v))}>
            {`${v} (missing)`}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** The selector without empty constraints (an empty list would match nothing). */
function tidy(selector: Selector): Selector {
  const out: Selector = {};
  if (selector.ids?.length) out.ids = selector.ids;
  if (selector.kind?.length) out.kind = selector.kind;
  if (selector.tier?.length) out.tier = selector.tier;
  if (selector.tag?.length) out.tag = selector.tag;
  if (selector.memberOf?.length) out.memberOf = selector.memberOf;
  const classes = Object.entries(selector.class ?? {}).filter(([, values]) => values.length > 0);
  if (classes.length > 0) out.class = Object.fromEntries(classes);
  return out;
}

/**
 * The selector editor. `doc` is the draft with the packs' kinds merged in (Build's form doc), so
 * kinds and groups of pack kinds are offered. `optional`: absent means no selector at all.
 */
export function SelectorEditor(props: { label: string; value: Selector | undefined; doc: WorldDoc; optional?: boolean; onChange(next: Selector | undefined): void }) {
  const { doc } = props;
  if (props.value === undefined) {
    return (
      <div class="lre-form-sel-absent" data-lre-selector>
        <span class="lre-form-sel-absent-label">{props.label}</span>
        <Button size="sm" icon="plus" onClick={() => props.onChange({})}>
          Add a selector
        </Button>
      </div>
    );
  }
  const value = props.value;
  const set = (patch: Partial<Selector>) => props.onChange(tidy({ ...value, ...patch }));
  const kinds = Object.entries(doc.kinds)
    .map(([id, k]) => ({ value: id, label: k.label || id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const entities = Object.values(doc.entities)
    .map((e) => ({ value: e.id, label: e.name || e.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const empty = Object.keys(tidy(value)).length === 0;
  return (
    <div class="lre-form-sel" data-lre-selector>
      <FormGroup
        title={props.label}
        aside={
          props.optional ? (
            <Button variant="ghost" size="sm" label={`Remove ${props.label}`} onClick={() => props.onChange(undefined)}>
              Remove
            </Button>
          ) : undefined
        }
      >
        <p class="lre-form-sel-lead">{empty ? "Matches every entity." : "An entity must pass every constraint below; within one, any value will do."}</p>
        <PickList label="Kind" help="Or a kind that inherits from it." value={value.kind ?? []} options={kinds} placeholder="Add a kind…" onChange={(kind) => set({ kind })} />
        <Toggles label="Tier" value={value.tier ?? []} options={tiersInOrder(doc).map(([id, t]) => ({ value: id, label: t.label }))} onChange={(tier) => set({ tier })} />
        {facetsInOrder(doc).map(([facet, f]) => (
          <Toggles key={facet} label={f.label} help="A value, or one nested under it." value={value.class?.[facet] ?? []} options={facetOptions(f.values)} onChange={(values) => set({ class: { ...value.class, [facet]: values } })} />
        ))}
        <TagListInput label="Tag" value={value.tag ?? []} suggestions={worldTags(doc)} onChange={(tag) => set({ tag })} />
        <PickList label="Member of" help="Directly, or through a member group." value={value.memberOf ?? []} options={groupOptions(doc)} placeholder="Add a group…" onChange={(memberOf) => set({ memberOf })} />
        <PickList label="Only these entities" value={value.ids ?? []} options={entities} placeholder="Add an entity…" onChange={(ids) => set({ ids })} />
      </FormGroup>
    </div>
  );
}
