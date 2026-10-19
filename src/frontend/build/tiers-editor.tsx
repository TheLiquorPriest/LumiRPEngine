// Build → Tiers (DESIGN §9.1, §13): a world's own tiers, each in one of the three detail bands whose
// caps limit how deeply its people are simulated. Add (by name, the id derived from it: D-UI6),
// rename, reorder, pick a band, say whether its people live their own day (agendas and plans) by
// default, describe it; and choose the tier new people join. One card per tier, so it works at
// phone width. Styles: styles/forms.ts.

import { useId, useState } from "preact/hooks";
import type { TierId } from "../../shared/ids";
import { BANDS } from "../../shared/ids";
import type { JsonValue } from "../../shared/json";
import { safeKey } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import { BAND_LABEL, spawnTierOf, tiersInOrder } from "../../shared/tiers";
import type { TierDef, WorldDoc } from "../../shared/world";
import { Button, Disclosure, Field, IconButton, IdText, PageHeader, SaveBar, Seg, useBusy, useShowIds } from "../components";
import { CheckField, FormGroup, Issues, RefPicker } from "./form-kit";
import { useHeld } from "./held";
import { deriveId } from "./schema";
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

/** A new tier at the end of the list, in the Background band, named `label` (else after its id); null when the id is unusable or taken. */
export function addTier(value: TiersValue, id: string, label?: string): TiersValue | null {
  if (!safeKey(id) || id in value.tiers) return null;
  const last = tiersInOrder(value).at(-1)?.[1].order ?? -1;
  return { ...value, tiers: { ...value.tiers, [id]: { label: label ?? id.replace(/_/g, " "), band: "background", order: last + 1 } } };
}

/** The value without a tier; a spawn tier that named it falls back to the default. */
export function removeTier(value: TiersValue, id: TierId): TiersValue {
  const { [id]: _gone, ...tiers } = value.tiers;
  return value.spawnTier === id ? { tiers } : { ...value, tiers };
}

/** Why a typed tier id can't be used, or null: it must be new and a safe key. */
function idProblem(id: string, taken: ReadonlySet<string>): string | null {
  if (!id) return "Give it an id.";
  if (taken.has(id)) return "There's already a tier with this id.";
  return safeKey(id) ? null : "This id is reserved. Choose another.";
}

export function TiersEditor(props: { doc: WorldDoc; lint: readonly LintIssue[]; save(value: JsonValue): Promise<unknown> }) {
  const initial: TiersValue = { tiers: props.doc.tiers, ...(props.doc.spawnTier !== undefined ? { spawnTier: props.doc.spawnTier } : {}) };
  const [value, setValue] = useState<TiersValue>(initial);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const showIds = useShowIds();
  const idId = useId();
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.doc.id}/tiers`);
  const ordered = tiersInOrder(value);
  const uses = (id: TierId): number => Object.values(props.doc.entities).filter((e) => e.tier === id).length;
  const edit = (id: TierId, patch: Partial<TierDef>) => setValue({ ...value, tiers: { ...value.tiers, [id]: { ...(value.tiers[id] as TierDef), ...patch } } });
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const fallback = spawnTierOf({ tiers: value.tiers });
  const taken = new Set(Object.keys(value.tiers));
  const newId = typed ?? (name.trim() ? deriveId(name.trim(), taken) : "");
  const problem = typed === null ? null : idProblem(typed, taken);
  const ready = name.trim() !== "" && newId !== "" && problem === null;
  const add = () => {
    const next = ready ? addTier(value, newId, name.trim()) : null;
    if (!next) return;
    setValue(next);
    setName("");
    setTyped(null);
  };
  const idField = (
    <Field label="Id" for={idId} help="How rules and entities refer to it. It follows the name until you change it." error={problem}>
      <input id={idId} class="lre-input lre-build-mono" value={newId} autoComplete="off" spellcheck={false} aria-invalid={problem !== null || undefined} onInput={(event) => setTyped(event.currentTarget.value.replace(/[^\w-]/g, "_"))} />
    </Field>
  );
  return (
    <div class="lre-form-tiers" data-lre-editor="part:tiers">
      <PageHeader title="Tiers" />
      <p class="lre-form-tier-intro">
        Every entity has a tier. Each tier belongs to a band (Leads, Supporting or Background), and the band's caps in Realism limit how deeply its people are simulated. The point of view is never capped.
      </p>
      <Issues issues={lintAt(props.lint, "tiers").filter((issue) => !ordered.some(([id]) => issue.path.startsWith(`tiers.${id}.`)))} />
      {ordered.map(([id, t], index) => {
        const used = uses(id);
        const title = t.label || id;
        return (
          <div key={id} class="lre-form-tier" data-lre-tier={id}>
            <FormGroup
              title={title}
              aside={
                <span class="lre-form-tier-actions">
                  <IconButton icon="chevron-up" label={`Move ${title} up`} disabled={index === 0} onClick={() => setValue(moveTier(value, id, -1))} />
                  <IconButton icon="chevron-down" label={`Move ${title} down`} disabled={index === ordered.length - 1} onClick={() => setValue(moveTier(value, id, 1))} />
                  <IconButton icon="trash" label={`Remove ${title}`} disabled={used > 0} onClick={() => setValue(removeTier(value, id))} />
                </span>
              }
            >
              <div class="lre-form-tier-uses">
                <span>{used === 1 ? "1 entity" : `${used} entities`}</span>
                {used > 0 ? <span class="lre-field-help">Move its entities to another tier first to remove it.</span> : null}
              </div>
              <label class="lre-field">
                <span class="label">Label</span>
                <input class="lre-input" value={t.label} onInput={(event) => edit(id, { label: event.currentTarget.value })} />
              </label>
              <div class="lre-field">
                <span class="label">Band</span>
                <Seg label={`Band of ${title}`} value={t.band} options={BANDS.map((band) => ({ value: band, label: BAND_LABEL[band] }))} onChange={(band) => edit(id, { band })} />
              </div>
              <CheckField label="Its people live their own day (agendas and plans) unless they say otherwise" checked={t.agentDefault === true} onChange={(agentDefault) => edit(id, { agentDefault })} />
              <label class="lre-field">
                <span class="label">
                  Description<span class="lre-form-optional"> · optional</span>
                </span>
                <textarea class="lre-input" rows={2} value={t.description ?? ""} onInput={(event) => edit(id, { description: event.currentTarget.value === "" ? undefined : event.currentTarget.value })} />
              </label>
              <IdText id={id} />
              <Issues issues={lintAt(props.lint, `tiers.${id}`)} />
            </FormGroup>
          </div>
        );
      })}
      <div class="lre-form-tier-spawn">
        <RefPicker
          label="New people join"
          value={value.spawnTier ?? ""}
          options={ordered.map(([id, t]) => ({ value: id, label: t.label || id }))}
          none={`The first Background tier (${value.tiers[fallback]?.label ?? fallback})`}
          onChange={(picked) => setValue(picked === "" ? { tiers: value.tiers } : { ...value, spawnTier: picked })}
        />
        <Issues issues={lintAt(props.lint, "spawnTier")} />
      </div>
      <div class="lre-form-tier-new">
        <div class="lre-form-add">
          <input
            class="lre-input"
            placeholder="New tier's name"
            aria-label="New tier's name"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <Button size="sm" icon="plus" disabled={!ready} onClick={add}>
            Add tier
          </Button>
        </div>
        {name.trim() !== "" || typed !== null ? showIds ? idField : <Disclosure summary="Advanced">{idField}</Disclosure> : null}
      </div>
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={() => run(() => props.save(value as unknown as JsonValue))}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
