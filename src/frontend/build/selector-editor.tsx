// Build's selector editor (DESIGN §4.1, §13): one widget for every place a world picks entities by
// rule (a schedule owned by a selector, an action parameter's candidates, visibility grants). A
// selector lists constraints that must all hold, each one any of its values: kinds (with
// inheritance), tiers, classification values (nested values included), tags, groups (members,
// through member groups too) and ids. Also the chip-style tag list, used for entity tags.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { facetsInOrder, facetTree } from "../../shared/classes";
import { isRecord } from "../../shared/json";
import { tiersInOrder } from "../../shared/tiers";
import type { EntityId } from "../../shared/ids";
import type { Selector, WorldDoc } from "../../shared/world";

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

/** Free-form tags as removable chips, with an input that suggests tags already in use. Enter or a comma adds. */
export function TagListInput(props: { label: string; value: readonly string[]; suggestions: readonly string[]; children?: ComponentChildren; onChange(next: string[]): void }) {
  const [text, setText] = useState("");
  const list = useId();
  const add = () => {
    const more = text
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "" && !props.value.includes(t));
    if (more.length > 0) props.onChange([...props.value, ...new Set(more)]);
    setText("");
  };
  return (
    <div class="lre-field" data-lre-tags>
      <span class="label">{props.label}</span>
      {props.value.length > 0 ? (
        <div class="lre-inline">
          {props.value.map((tag) => (
            <button key={tag} type="button" class="lre-btn small" aria-label={`Remove tag ${tag}`} onClick={() => props.onChange(props.value.filter((t) => t !== tag))}>
              {tag} ✕
            </button>
          ))}
        </div>
      ) : null}
      <div class="lre-inline">
        <input
          class="lre-input"
          style={{ flex: 1 }}
          list={list}
          placeholder="Add a tag"
          aria-label={`Add to ${props.label}`}
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button type="button" class="lre-btn small" disabled={text.trim() === ""} onClick={add}>
          + Add
        </button>
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

/** A constraint list as removable chips plus a picker for one more. */
function PickList(props: { label: string; value: readonly string[]; options: readonly { value: string; label: string }[]; onChange(next: string[]): void }) {
  const name = (id: string) => props.options.find((o) => o.value === id)?.label ?? id;
  const left = props.options.filter((o) => !props.value.includes(o.value));
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      {props.value.length > 0 ? (
        <div class="lre-inline">
          {props.value.map((id) => (
            <button key={id} type="button" class="lre-btn small" aria-label={`Remove ${name(id)}`} onClick={() => props.onChange(props.value.filter((other) => other !== id))}>
              {name(id)} ✕
            </button>
          ))}
        </div>
      ) : null}
      {left.length > 0 ? (
        <select class="lre-input" value="" aria-label={`Add to ${props.label}`} onChange={(event) => (event.currentTarget.value ? props.onChange([...props.value, event.currentTarget.value]) : undefined)}>
          <option value="">+ Add…</option>
          {left.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** Toggle buttons, one per option, pressed when the value lists it. */
function Toggles(props: { label: string; value: readonly string[]; options: readonly { value: string; label: string }[]; onChange(next: string[]): void }) {
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div class="lre-inline" role="group" aria-label={props.label}>
        {props.options.map((o) => {
          const on = props.value.includes(o.value);
          return (
            <button key={o.value} type="button" class={on ? "lre-btn small primary" : "lre-btn small"} aria-pressed={on} onClick={() => props.onChange(on ? props.value.filter((v) => v !== o.value) : [...props.value, o.value])}>
              {o.label}
            </button>
          );
        })}
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
      <div class="lre-spread" data-lre-selector>
        <span class="lre-muted">{props.label}</span>
        <button type="button" class="lre-btn small" onClick={() => props.onChange({})}>
          + Add a selector
        </button>
      </div>
    );
  }
  const value = props.value;
  const set = (patch: Partial<Selector>) => props.onChange(tidy({ ...value, ...patch }));
  const kinds = Object.entries(doc.kinds)
    .map(([id, k]) => ({ value: id, label: k.label && k.label !== id ? `${k.label} (${id})` : id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const entities = Object.values(doc.entities)
    .map((e) => ({ value: e.id, label: e.name && e.name !== e.id ? `${e.name} (${e.id})` : e.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const empty = Object.keys(tidy(value)).length === 0;
  return (
    <section class="lre-card lre-stack" data-lre-selector>
      <div class="lre-spread">
        <span class="lre-small lre-muted">{props.label}</span>
        {props.optional ? (
          <button type="button" class="lre-btn small ghost" onClick={() => props.onChange(undefined)}>
            Remove
          </button>
        ) : null}
      </div>
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        {empty ? "No constraint yet: this matches every entity." : "An entity must pass every constraint below; within one, any value will do."}
      </p>
      <PickList label="Kind (or one inheriting from it)" value={value.kind ?? []} options={kinds} onChange={(kind) => set({ kind })} />
      <Toggles label="Tier" value={value.tier ?? []} options={tiersInOrder(doc).map(([id, t]) => ({ value: id, label: t.label }))} onChange={(tier) => set({ tier })} />
      {facetsInOrder(doc).map(([facet, f]) => (
        <Toggles
          key={facet}
          label={`${f.label} (a value, or one nested under it)`}
          value={value.class?.[facet] ?? []}
          options={facetTree(f.values).map((v) => ({ value: v.id, label: `${"› ".repeat(v.depth)}${v.value.label}` }))}
          onChange={(values) => set({ class: { ...value.class, [facet]: values } })}
        />
      ))}
      <TagListInput label="Tag" value={value.tag ?? []} suggestions={worldTags(doc)} onChange={(tag) => set({ tag })} />
      <PickList label="Member of (directly or through a member group)" value={value.memberOf ?? []} options={groupOptions(doc)} onChange={(memberOf) => set({ memberOf })} />
      <PickList label="Only these entities" value={value.ids ?? []} options={entities} onChange={(ids) => set({ ids })} />
    </section>
  );
}
