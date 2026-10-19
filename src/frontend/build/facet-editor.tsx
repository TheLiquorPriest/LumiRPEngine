// Build's classification widgets (DESIGN §4.1, §13): a facet's values as an item list in tree order,
// each opening a sheet with its label, the value it nests under and a description; and an entity's
// classification, one field per facet: chips for several values or a short single choice, a picker
// for a long one. Lint is shown by the form around them (`issues`), so a stale value an entity still
// holds stays visible and removable here. Ids stay hidden (D-UI6): values show by label, and a new
// value's id is derived from its label. Styles: styles/forms.ts.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { facetsInOrder, facetTree } from "../../shared/classes";
import { hasOwn, isRecord, safeKey } from "../../shared/json";
import type { FacetId, FacetValueDef, FacetValueId, WorldDoc } from "../../shared/world";
import { Button, Disclosure, Field, IconButton, IdText, useShowIds } from "../components";
import { Icon } from "../icons";
import type { RefOption } from "./form-kit";
import { Chip, FormSheet, ItemRow, RefPicker } from "./form-kit";
import { deriveId } from "./schema";

/** Up to this many values, a single-choice facet shows them all as chips; past it, a picker keeps the field short. */
const CHIP_CHOICE_MAX = 6;

/** An entity's stored classification: facet → value ids (anything else dropped). */
export function classesOf(v: unknown): Record<FacetId, FacetValueId[]> | undefined {
  if (!isRecord(v)) return undefined;
  return Object.fromEntries(Object.entries(v).map(([facet, values]) => [facet, Array.isArray(values) ? values.filter((x): x is string => typeof x === "string") : []]));
}

/** A facet's stored values: label (else the id), parent and description when they are text. */
export function facetValuesOf(v: unknown): Record<FacetValueId, FacetValueDef> {
  const out: Record<FacetValueId, FacetValueDef> = {};
  for (const [id, raw] of Object.entries(isRecord(v) ? v : {})) {
    if (!isRecord(raw)) continue;
    out[id] = { label: typeof raw.label === "string" ? raw.label : id, ...(typeof raw.parent === "string" ? { parent: raw.parent } : {}), ...(typeof raw.description === "string" ? { description: raw.description } : {}) };
  }
  return out;
}

/** The values without `id`; values nested under it move up to its parent. */
export function removeValue(values: Record<FacetValueId, FacetValueDef>, id: FacetValueId): Record<FacetValueId, FacetValueDef> {
  const parent = values[id]?.parent;
  const out: Record<FacetValueId, FacetValueDef> = {};
  for (const [vid, v] of Object.entries(values)) {
    if (vid === id) continue;
    if (v.parent !== id) out[vid] = v;
    else {
      const { parent: _gone, ...rest } = v;
      out[vid] = parent === undefined ? rest : { ...rest, parent };
    }
  }
  return out;
}

/** `id` and every value nested under it: what can't become its parent. */
function subtree(values: Record<FacetValueId, FacetValueDef>, id: FacetValueId): Set<FacetValueId> {
  const out = new Set<FacetValueId>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [vid, v] of Object.entries(values)) {
      if (v.parent !== undefined && out.has(v.parent) && !out.has(vid)) {
        out.add(vid);
        grew = true;
      }
    }
  }
  return out;
}

/** The label of the value `v` nests under, when the facet defines that value. */
function parentLabel(values: Readonly<Record<FacetValueId, FacetValueDef>>, v: FacetValueDef): string | undefined {
  return v.parent !== undefined && hasOwn(values, v.parent) ? values[v.parent]?.label : undefined;
}

/**
 * A facet's values as choices, in tree order (each value, then those nested under it). A nested one
 * says what it is in on its second line, so nesting reads without indent glyphs or ids.
 */
export function facetOptions(values: Readonly<Record<FacetValueId, FacetValueDef>>): RefOption[] {
  return facetTree(values).map(({ id, value }) => {
    const parent = parentLabel(values, value);
    return { value: id, label: value.label, ...(parent !== undefined ? { sublabel: `in ${parent}` } : {}) };
  });
}

/** A choice's name on a chip, with its quiet second line ("in Coast") when it has one. */
export function ChipLines(props: { option: RefOption }) {
  if (props.option.sublabel === undefined) return <>{props.option.label}</>;
  return (
    <span class="lre-form-facet-lines">
      <span>{props.option.label}</span>
      <span class="lre-form-facet-in">{props.option.sublabel}</span>
    </span>
  );
}

/** Why a typed value id can't be used, or null: it must be new and a safe key. */
function idProblem(id: string, taken: ReadonlySet<string>): string | null {
  if (!id) return "Give it an id.";
  if (taken.has(id)) return "There's already a value with this id.";
  return safeKey(id) ? null : "This id is reserved. Choose another.";
}

/**
 * A facet's values as an item list in tree order, nesting shown by indent; tapping one opens its
 * sheet. `issues(path)` renders the lint at a value's path. A new value is named by its label; its
 * id follows the label (D-UI6) and is editable under Advanced, or in the open while Show ids is on.
 */
export function FacetValuesInput(props: { label: string; value: Record<FacetValueId, FacetValueDef> | undefined; path: string; issues(path: string): ComponentChildren; onChange(next: Record<FacetValueId, FacetValueDef>): void }) {
  const values = props.value ?? {};
  const showIds = useShowIds();
  const idId = useId();
  const [open, setOpen] = useState<FacetValueId | null>(null);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const edit = (id: FacetValueId, patch: Partial<FacetValueDef>) => {
    const next = { ...(values[id] ?? { label: id }), ...patch };
    if (patch.parent === undefined && "parent" in patch) delete next.parent;
    if (patch.description === undefined && "description" in patch) delete next.description;
    props.onChange({ ...values, [id]: next });
  };
  const remove = (id: FacetValueId) => {
    if (open === id) setOpen(null);
    props.onChange(removeValue(values, id));
  };
  const taken = new Set(Object.keys(values));
  const newId = typed ?? (name.trim() ? deriveId(name.trim(), taken) : "");
  const problem = typed === null ? null : idProblem(typed, taken);
  const ready = name.trim() !== "" && newId !== "" && problem === null;
  const add = () => {
    if (!ready) return;
    props.onChange({ ...values, [newId]: { label: name.trim() } });
    setName("");
    setTyped(null);
  };
  const tree = facetTree(values);
  const current = open !== null && hasOwn(values, open) ? values[open] : undefined;
  // What the open value can't nest under: itself and the values nested under it.
  const blocked = open !== null ? subtree(values, open) : null;
  const idField = (
    <Field label="Id" for={idId} help="How rules and entities refer to it. It follows the label until you change it." error={problem}>
      <input id={idId} class="lre-input lre-build-mono" value={newId} autoComplete="off" spellcheck={false} aria-invalid={problem !== null || undefined} onInput={(event) => setTyped(event.currentTarget.value.replace(/[^\w-]/g, "_"))} />
    </Field>
  );
  return (
    <div class="lre-field" data-lre-facet-values>
      <span class="label">{props.label}</span>
      {tree.length === 0 ? (
        <span class="lre-field-help">No values yet.</span>
      ) : (
        <div class="lre-form-items">
          {tree.map(({ id, value, depth }) => {
            const parent = parentLabel(values, value);
            const title = value.label || id;
            const subtitle = parent !== undefined ? `in ${parent}` : value.parent !== undefined ? `in ${value.parent} (not a value)` : value.description;
            return (
              <div key={id} class="lre-form-facet-row" data-depth={Math.min(depth, 4)} data-lre-facet-value={id}>
                <ItemRow title={title} subtitle={subtitle} onOpen={() => setOpen(id)} openLabel={`Edit ${title}`} actions={<IconButton icon="trash" label={`Remove ${title}`} onClick={() => remove(id)} />} />
                <div class="lre-form-facet-row-issues">{props.issues(`${props.path}.${id}`)}</div>
              </div>
            );
          })}
        </div>
      )}
      {open !== null && current ? (
        <FormSheet title={current.label || open} subtitle={props.label} onClose={() => setOpen(null)}>
          <label class="lre-field">
            <span class="label">Label</span>
            <input class="lre-input" value={current.label} onInput={(event) => edit(open, { label: event.currentTarget.value })} />
          </label>
          <RefPicker
            label="Nested under"
            value={current.parent ?? ""}
            options={facetOptions(values).filter((o) => !blocked?.has(o.value))}
            none="Nothing: a top-level value"
            onChange={(parent) => edit(open, { parent: parent === "" ? undefined : parent })}
          />
          <label class="lre-field">
            <span class="label">
              Description<span class="lre-form-optional"> · optional</span>
            </span>
            <input class="lre-input" value={current.description ?? ""} onInput={(event) => edit(open, { description: event.currentTarget.value === "" ? undefined : event.currentTarget.value })} />
          </label>
          {props.issues(`${props.path}.${open}`)}
          <IdText id={open} />
          <div class="lre-form-facet-actions">
            <Button variant="danger" icon="trash" onClick={() => remove(open)}>
              Remove value
            </Button>
          </div>
        </FormSheet>
      ) : null}
      <div class="lre-form-facet-new">
        <div class="lre-form-add">
          <input
            class="lre-input"
            placeholder="New value's label"
            aria-label="New value's label"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <Button size="sm" icon="plus" disabled={!ready} onClick={add}>
            Add value
          </Button>
        </div>
        {name.trim() !== "" || typed !== null ? showIds ? idField : <Disclosure summary="Advanced">{idField}</Disclosure> : null}
      </div>
    </div>
  );
}

/**
 * An entity's classification: one field per facet, in the world's order. Several values: a toggle
 * chip each. One value: chips acting as a single choice while there are few (pressing the chosen one
 * clears it), else a picker with None. A value or facet the world no longer defines stays listed,
 * in the warning tone, until removed. Build passes its draft; the GM editor passes the running chat's facets.
 */
export function ClassesInput(props: { label: string; value: Record<FacetId, FacetValueId[]> | undefined; doc: Pick<WorldDoc, "classifications">; onChange(next: Record<FacetId, FacetValueId[]> | undefined): void }) {
  const value = props.value ?? {};
  const facets = facetsInOrder(props.doc);
  const set = (facet: FacetId, values: FacetValueId[]) => {
    const next = { ...value };
    if (values.length > 0) next[facet] = values;
    else delete next[facet];
    props.onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const stale = Object.keys(value).filter((facet) => !facets.some(([id]) => id === facet));
  return (
    <div class="lre-field lre-form-facet-classes" data-lre-classes>
      <span class="label">{props.label}</span>
      {facets.length === 0 ? <span class="lre-field-help">No classifications yet: add facets in Build → Classifications.</span> : null}
      {facets.map(([facet, f]) => {
        const held = value[facet] ?? [];
        const options = facetOptions(f.values);
        const known = (v: FacetValueId) => options.some((o) => o.value === v);
        const picker = !f.multiple && options.length > CHIP_CHOICE_MAX;
        // A picker shows one value: any further one a single-choice facet still holds is listed to remove.
        const extra = picker ? held.filter(known).slice(1) : [];
        const odd = [...held.filter((v) => !known(v)).map((v) => ({ v, text: `${v} (not a value)` })), ...extra.map((v) => ({ v, text: `${options.find((o) => o.value === v)?.label ?? v} (only one allowed)` }))];
        const warn =
          odd.length > 0 ? (
            <div class="lre-form-chips">
              {odd.map(({ v, text }) => (
                <Chip key={v} tone="warn" removeLabel={`Remove ${v}`} onRemove={() => set(facet, held.filter((x) => x !== v))}>
                  {text}
                </Chip>
              ))}
            </div>
          ) : null;
        if (picker) {
          return (
            <div key={facet} class="lre-form-facet-class" data-lre-class-facet={facet}>
              <RefPicker label={f.label} value={held.find(known) ?? ""} options={options} none="None" onChange={(v) => set(facet, v === "" ? [] : [v])} />
              {warn}
            </div>
          );
        }
        return (
          <div key={facet} class="lre-form-facet-class" data-lre-class-facet={facet}>
            <span class="lre-form-facet-label">{f.label}</span>
            {f.multiple ? <span class="lre-field-help">Any number of these.</span> : null}
            {options.length === 0 ? <span class="lre-field-help">This classification has no values yet.</span> : null}
            <div class="lre-form-chips" role="group" aria-label={f.label}>
              {options.map((o) => {
                const on = held.includes(o.value);
                const next = on ? held.filter((v) => v !== o.value) : f.multiple ? [...held, o.value] : [o.value];
                return (
                  <Chip key={o.value} pressed={on} onToggle={() => set(facet, next)}>
                    <ChipLines option={o} />
                  </Chip>
                );
              })}
            </div>
            {warn}
          </div>
        );
      })}
      {stale.map((facet) => (
        <div key={facet} class="lre-form-facet-stale">
          <span class="lre-form-facet-stale-text">
            <Icon name="alert" size={16} />
            <span>{`${facet}: ${(value[facet] ?? []).join(", ")} (no longer a classification)`}</span>
          </span>
          <Button variant="ghost" size="sm" label={`Remove ${facet}`} onClick={() => set(facet, [])}>
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
