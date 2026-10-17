// Build's classification widgets (DESIGN §4.1, §13): a facet's values as a tree (each with a label,
// the value it nests under and a description), and an entity's classification, one picker per
// facet: a single choice or several, as the facet says. Lint is shown by the form around them
// (`issues`), so a stale value an entity still holds stays visible and removable here.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { facetsInOrder, facetTree } from "../../shared/classes";
import { isRecord, safeKey } from "../../shared/json";
import type { FacetId, FacetValueDef, FacetValueId, WorldDoc } from "../../shared/world";

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

/** A facet's values as a tree, each editable; `issues(path)` renders the lint at a value's path. */
export function FacetValuesInput(props: { label: string; value: Record<FacetValueId, FacetValueDef> | undefined; path: string; issues(path: string): ComponentChildren; onChange(next: Record<FacetValueId, FacetValueDef>): void }) {
  const values = props.value ?? {};
  const [newId, setNewId] = useState("");
  const edit = (id: FacetValueId, patch: Partial<FacetValueDef>) => {
    const next = { ...(values[id] ?? { label: id }), ...patch };
    if (patch.parent === undefined && "parent" in patch) delete next.parent;
    if (patch.description === undefined && "description" in patch) delete next.description;
    props.onChange({ ...values, [id]: next });
  };
  const add = () => {
    const id = newId.trim();
    if (!safeKey(id) || id in values) return;
    props.onChange({ ...values, [id]: { label: id.replace(/_/g, " ") } });
    setNewId("");
  };
  const tree = facetTree(values);
  return (
    <div class="lre-field" data-lre-facet-values>
      <span class="label">{props.label}</span>
      {tree.length === 0 ? <span class="lre-small lre-muted">No values yet.</span> : null}
      {tree.map(({ id, value, depth }) => {
        const blocked = subtree(values, id);
        return (
          <section key={id} class="lre-card lre-stack" style={{ marginLeft: `${Math.min(depth, 4) * 14}px` }} data-lre-facet-value={id}>
            <div class="lre-spread">
              <span class="lre-small lre-muted">
                {depth > 0 ? "› ".repeat(depth) : ""}
                <code>{id}</code>
              </span>
              <button type="button" class="lre-btn small danger" aria-label={`Remove ${value.label}`} onClick={() => props.onChange(removeValue(values, id))}>
                Remove
              </button>
            </div>
            <label class="lre-field">
              <span class="label">Label</span>
              <input class="lre-input" value={value.label} onInput={(event) => edit(id, { label: event.currentTarget.value })} />
            </label>
            <label class="lre-field">
              <span class="label">Nested under</span>
              <select class="lre-input" value={value.parent ?? ""} onChange={(event) => edit(id, { parent: event.currentTarget.value === "" ? undefined : event.currentTarget.value })}>
                <option value="">— (a top-level value)</option>
                {tree
                  .filter((other) => !blocked.has(other.id))
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {`${"› ".repeat(other.depth)}${other.value.label}`}
                    </option>
                  ))}
                {value.parent !== undefined && !(value.parent in values) ? <option value={value.parent}>{value.parent} (not a value)</option> : null}
              </select>
            </label>
            <label class="lre-field">
              <span class="label">Description (optional)</span>
              <textarea class="lre-input" rows={2} value={value.description ?? ""} onInput={(event) => edit(id, { description: event.currentTarget.value === "" ? undefined : event.currentTarget.value })} />
            </label>
            {props.issues(`${props.path}.${id}`)}
          </section>
        );
      })}
      <div class="lre-inline">
        <input
          class="lre-input"
          style={{ flex: 1 }}
          placeholder="New value id (letters, digits, _)"
          aria-label="New value id"
          value={newId}
          onInput={(event) => setNewId(event.currentTarget.value.replace(/[^\w-]/g, "_"))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button type="button" class="lre-btn primary" disabled={!newId.trim() || newId.trim() in values} onClick={add}>
          + Add value
        </button>
      </div>
    </div>
  );
}

/**
 * An entity's classification: per facet, in the world's order, one select (single-valued) or a
 * toggle per value (several). A facet or value the world no longer defines stays listed until removed.
 */
export function ClassesInput(props: { label: string; value: Record<FacetId, FacetValueId[]> | undefined; doc: WorldDoc; onChange(next: Record<FacetId, FacetValueId[]> | undefined): void }) {
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
    <div class="lre-field" data-lre-classes>
      <span class="label">{props.label}</span>
      {facets.length === 0 ? <span class="lre-small lre-muted">No classifications yet: add facets in Build → Classifications.</span> : null}
      {facets.map(([facet, f]) => {
        const held = value[facet] ?? [];
        const options = facetTree(f.values);
        const unknown = held.filter((v) => !options.some((o) => o.id === v));
        return (
          <div key={facet} class="lre-field" data-lre-class-facet={facet}>
            <span class="label">
              {f.label}
              {f.multiple ? " (any number)" : ""}
            </span>
            {f.multiple ? (
              <div class="lre-inline" role="group" aria-label={f.label}>
                {options.map((o) => {
                  const on = held.includes(o.id);
                  return (
                    <button key={o.id} type="button" class={on ? "lre-btn small primary" : "lre-btn small"} aria-pressed={on} onClick={() => set(facet, on ? held.filter((v) => v !== o.id) : [...held, o.id])}>
                      {`${"› ".repeat(o.depth)}${o.value.label}`}
                    </button>
                  );
                })}
              </div>
            ) : (
              <select class="lre-input" aria-label={f.label} value={held[0] ?? ""} onChange={(event) => set(facet, event.currentTarget.value === "" ? [] : [event.currentTarget.value])}>
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {`${"› ".repeat(o.depth)}${o.value.label}`}
                  </option>
                ))}
              </select>
            )}
            {unknown.length > 0 || (!f.multiple && held.length > 1) ? (
              <div class="lre-inline">
                {(unknown.length > 0 ? unknown : held.slice(1)).map((v) => (
                  <button key={v} type="button" class="lre-btn small danger" aria-label={`Remove ${v}`} onClick={() => set(facet, held.filter((x) => x !== v))}>
                    {v} ✕
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {stale.map((facet) => (
        <div key={facet} class="lre-inline">
          <span class="lre-small lre-warn">
            {facet}: {(value[facet] ?? []).join(", ")}
          </span>
          <button type="button" class="lre-btn small danger" aria-label={`Remove ${facet}`} onClick={() => set(facet, [])}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
