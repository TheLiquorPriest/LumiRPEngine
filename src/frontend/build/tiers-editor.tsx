// Build → Tiers (DESIGN §9.1, §13): a world's own tiers, each in one of the three detail bands whose
// caps limit how deeply its people are simulated. Add, rename, reorder, pick a band, say whether its
// people live their own day (agendas and plans) by default, describe it; and choose the tier new people join.

import { useState } from "preact/hooks";
import type { Band, TierId } from "../../shared/ids";
import { BANDS } from "../../shared/ids";
import type { JsonValue } from "../../shared/json";
import { useHeld } from "./held";
import { safeKey } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import { BAND_LABEL, spawnTierOf, tiersInOrder } from "../../shared/tiers";
import type { TierDef, WorldDoc } from "../../shared/world";
import { useBusy } from "../components";
import { lintAt } from "./schema-form";

export interface TiersValue {
  tiers: Record<TierId, TierDef>;
  spawnTier?: TierId;
}

/** The tiers renumbered 0…n-1 in their current order, with `id` moved one place up or down. */
export function moveTier(value: TiersValue, id: TierId, by: -1 | 1): TiersValue {
  const ids = tiersInOrder(value).map(([tid]) => tid);
  const at = ids.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return value;
  [ids[at], ids[to]] = [ids[to] ?? id, id];
  const tiers: Record<TierId, TierDef> = {};
  ids.forEach((tid, order) => {
    const t = value.tiers[tid];
    if (t) tiers[tid] = { ...t, order };
  });
  return { ...value, tiers };
}

/** A new tier at the end of the list, in the Background band; null when the id is unusable or taken. */
export function addTier(value: TiersValue, id: string): TiersValue | null {
  if (!safeKey(id) || id in value.tiers) return null;
  const last = tiersInOrder(value).at(-1)?.[1].order ?? -1;
  return { ...value, tiers: { ...value.tiers, [id]: { label: id.replace(/_/g, " "), band: "background", order: last + 1 } } };
}

/** The value without a tier; a spawn tier that named it falls back to the default. */
export function removeTier(value: TiersValue, id: TierId): TiersValue {
  const { [id]: _gone, ...tiers } = value.tiers;
  return value.spawnTier === id ? { tiers } : { ...value, tiers };
}

function Issues(props: { issues: readonly LintIssue[] }) {
  return (
    <>
      {props.issues.map((issue) => (
        <span key={`${issue.path}:${issue.code}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
          {issue.message}
        </span>
      ))}
    </>
  );
}

export function TiersEditor(props: { doc: WorldDoc; lint: readonly LintIssue[]; save(value: JsonValue): Promise<unknown> }) {
  const initial: TiersValue = { tiers: props.doc.tiers, ...(props.doc.spawnTier !== undefined ? { spawnTier: props.doc.spawnTier } : {}) };
  const [value, setValue] = useState<TiersValue>(initial);
  const [newId, setNewId] = useState("");
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.doc.id}/tiers`);
  const ordered = tiersInOrder(value);
  const uses = (id: TierId): number => Object.values(props.doc.entities).filter((e) => e.tier === id).length;
  const edit = (id: TierId, patch: Partial<TierDef>) => setValue({ ...value, tiers: { ...value.tiers, [id]: { ...(value.tiers[id] as TierDef), ...patch } } });
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const fallback = spawnTierOf({ tiers: value.tiers });
  return (
    <div class="lre-stack" data-lre-editor="part:tiers">
      <div class="lre-h2">Tiers</div>
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Every entity has a tier. Each tier belongs to a band (Leads, Supporting or Background), and the band's caps in Realism limit how deeply its people are simulated. The point of view is never capped.
      </p>
      <Issues issues={lintAt(props.lint, "tiers").filter((issue) => !ordered.some(([id]) => issue.path.startsWith(`tiers.${id}.`)))} />
      {ordered.map(([id, t], index) => {
        const used = uses(id);
        return (
          <section key={id} class="lre-card" data-lre-tier={id}>
            <div class="lre-spread">
              <span class="lre-small lre-muted">
                <code>{id}</code> · {used === 1 ? "1 entity" : `${used} entities`}
              </span>
              <span class="lre-inline">
                <button type="button" class="lre-btn small" aria-label={`Move ${t.label} up`} disabled={index === 0} onClick={() => setValue(moveTier(value, id, -1))}>
                  ↑
                </button>
                <button type="button" class="lre-btn small" aria-label={`Move ${t.label} down`} disabled={index === ordered.length - 1} onClick={() => setValue(moveTier(value, id, 1))}>
                  ↓
                </button>
                <button type="button" class="lre-btn small danger" aria-label={`Remove ${t.label}`} disabled={used > 0} title={used > 0 ? "Move its entities to another tier first" : undefined} onClick={() => setValue(removeTier(value, id))}>
                  Remove
                </button>
              </span>
            </div>
            <label class="lre-field">
              <span class="label">Label</span>
              <input class="lre-input" value={t.label} onInput={(event) => edit(id, { label: event.currentTarget.value })} />
            </label>
            <label class="lre-field">
              <span class="label">Band</span>
              <select class="lre-input" value={t.band} onChange={(event) => edit(id, { band: event.currentTarget.value as Band })}>
                {BANDS.map((band) => (
                  <option key={band} value={band}>
                    {BAND_LABEL[band]}
                  </option>
                ))}
              </select>
            </label>
            <label class="lre-row">
              <span class="k">Its people live their own day (agendas and plans) unless they say otherwise</span>
              <span class="lre-check">
                <input type="checkbox" checked={t.agentDefault === true} onChange={(event) => edit(id, { agentDefault: event.currentTarget.checked })} />
              </span>
            </label>
            <label class="lre-field">
              <span class="label">Description (optional)</span>
              <textarea class="lre-input" rows={2} value={t.description ?? ""} onInput={(event) => edit(id, { description: event.currentTarget.value === "" ? undefined : event.currentTarget.value })} />
            </label>
            <Issues issues={lintAt(props.lint, `tiers.${id}`)} />
          </section>
        );
      })}
      <label class="lre-field">
        <span class="label">New people join</span>
        <select
          class="lre-input"
          value={value.spawnTier ?? ""}
          onChange={(event) => {
            const picked = event.currentTarget.value;
            setValue(picked === "" ? { tiers: value.tiers } : { ...value, spawnTier: picked });
          }}
        >
          <option value="">The first Background tier ({value.tiers[fallback]?.label ?? fallback})</option>
          {ordered.map(([id, t]) => (
            <option key={id} value={id}>
              {t.label}
            </option>
          ))}
        </select>
        <Issues issues={lintAt(props.lint, "spawnTier")} />
      </label>
      <form
        class="lre-inline"
        onSubmit={(event) => {
          event.preventDefault();
          const next = addTier(value, newId.trim());
          if (next) {
            setValue(next);
            setNewId("");
          }
        }}
      >
        <input class="lre-input" style={{ flex: 1 }} placeholder="New tier id (letters, digits, _)" aria-label="New tier id" value={newId} onInput={(event) => setNewId(event.currentTarget.value.replace(/[^\w-]/g, "_"))} />
        <button type="submit" class="lre-btn primary" disabled={!newId.trim() || newId.trim() in value.tiers}>
          + Add tier
        </button>
      </form>
      <div class="lre-inline">
        <button type="button" class="lre-btn primary" disabled={!changed || busy} onClick={() => run(() => props.save(value as unknown as JsonValue))}>
          Save to draft
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </button>
      </div>
    </div>
  );
}
