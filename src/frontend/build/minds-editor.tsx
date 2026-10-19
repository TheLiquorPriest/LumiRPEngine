// Build → World → Minds (DESIGN §24.2): what the narrator gets of a mind (secrecy), the fidelity
// ladder's focus weights and thresholds, who is always Live and who never gets a mind, the memory
// defaults, and the world's own step templates for the minds steps, written in the step-template
// editor. Saved whole as `lre.editor set part minds`; a world left at the defaults keeps no config.

import { useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { FidelityWeights, MindPurpose, MindsSecrecy, WorldMindsConfig } from "../../shared/minds";
import { DEFAULT_WORLD_MINDS, MIND_PROMPT_DEFAULTS, MIND_PURPOSES, MINDS_RANGES, worldMindsOf, worldMindTemplate } from "../../shared/minds";
import type { WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Card, HostSwitch, NumberStepper, Row, Seg, useBusy } from "../components";
import { STEP_LABEL } from "../settings/steps";
import { MEMORY_FIELDS, memoryValue } from "../settings/minds-patch";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";
import { SelectorEditor } from "./selector-editor";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

export const SECRECY_EXPLAINED: Record<MindsSecrecy, { label: string; text: string }> = {
  brief: {
    label: "Brief",
    text: "The narrator gets only a short description of how each character comes across: what they do, how they look and sound. It is checked first, and left out if it would give away a secret or someone you haven't met. Their private thoughts and what they mean to do stay in the GM view. Safest against spoilers; the narrator has less to work with.",
  },
  full: {
    label: "Full",
    text: "The narrator also gets each character's inner monologue, what they mean to do, their reactions and their mood, told to show them through behaviour and never say them outright. Richer, more consistent characters; a careless narrator could let a thought or a secret slip.",
  },
};

type FlatWeight = Exclude<keyof FidelityWeights, "roles" | "band">;

const WEIGHT_LABEL: Record<FlatWeight, string> = {
  here: "In the player's scene",
  nearby: "Close by (the same building or street)",
  mentioned: "Named in the latest message or reply",
  regard: "Strong feelings toward the player, either way (at the extreme)",
  knows: "Knows the player, or is known",
  owner: "Owns a quest, secret or agenda under way",
  track: "Each track under way that names them (up to three)",
  rule: "Named by a world rule",
  pending: "Each pending thing with the player (up to three): an invitation, appointment, plan or commitment",
  recent: "Seen with the player lately",
};

const BAND_LABEL: Record<keyof FidelityWeights["band"], string> = { principal: "Tier band: leads", supporting: "Tier band: supporting", background: "Tier band: background" };

/** The value the editor saves: none at all when it is the defaults, so the world keeps no config; an unset selector is left out. */
export function mindsPartValue(config: WorldMindsConfig): JsonObject {
  if (JSON.stringify(config) === JSON.stringify(DEFAULT_WORLD_MINDS)) return {};
  const out = structuredClone(config) as unknown as JsonObject;
  if (config.always === null) delete out.always;
  if (config.never === null) delete out.never;
  return out;
}

/** The world's classification values a role weight can name, labelled with their facet. */
function roleOptions(doc: WorldDoc): { value: string; label: string }[] {
  return Object.values(doc.classifications ?? {}).flatMap((facet) => Object.entries(facet.values).map(([id, v]) => ({ value: id, label: `${facet.label}: ${v.label}` })));
}

function Weight(props: { label: string; value: number; disabled: boolean; onChange(value: number): void }) {
  return <NumberStepper label={props.label} value={props.value} min={MINDS_RANGES.weight[0]} max={MINDS_RANGES.weight[1]} step={5} disabled={props.disabled} onChange={props.onChange} />;
}

function Roles(props: { doc: WorldDoc; roles: Record<string, number>; disabled: boolean; onChange(next: Record<string, number>): void }) {
  const options = roleOptions(props.doc);
  const [pick, setPick] = useState("");
  const left = options.filter((o) => props.roles[o.value] === undefined);
  return (
    <div class="lre-stack" data-lre-minds-roles>
      <span class="lre-small lre-muted">Role values (a value nested under one counts as it), such as an antagonist</span>
      {Object.entries(props.roles).map(([id, pts]) => (
        <div key={id} class="lre-inline">
          <Weight label={options.find((o) => o.value === id)?.label ?? id} value={pts} disabled={props.disabled} onChange={(v) => props.onChange({ ...props.roles, [id]: v })} />
          <button type="button" class="lre-btn small ghost" aria-label={`Remove ${id}`} disabled={props.disabled} onClick={() => props.onChange(Object.fromEntries(Object.entries(props.roles).filter(([k]) => k !== id)))}>
            ✕
          </button>
        </div>
      ))}
      {left.length > 0 ? (
        <div class="lre-inline">
          <select class="lre-input" aria-label="Role value" value={pick} disabled={props.disabled} onChange={(event) => setPick(event.currentTarget.value)}>
            <option value="">Pick a value…</option>
            {left.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" class="lre-btn small" disabled={props.disabled || pick === ""} onClick={() => (props.onChange({ ...props.roles, [pick]: 20 }), setPick(""))}>
            Add
          </button>
        </div>
      ) : options.length === 0 ? (
        <span class="lre-small lre-muted">This world has no classifications yet.</span>
      ) : null}
    </div>
  );
}

/** The world's step templates for the minds steps: each opens in the step-template editor; a new one starts from the built-in prompt. */
function MindTemplates(props: { doc: WorldDoc; worldId: string }) {
  const app = useApp();
  const send = useMemo(() => draftSend(app), [app]);
  const [busy, run] = useBusy();
  const open = (id: string) => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.worldId, collection: "steps", id } }));
  const add = (purpose: MindPurpose) =>
    run(async () => {
      let n = 1;
      while (props.doc.steps[`${purpose}_${n}`]) n++;
      const id = `${purpose}_${n}`;
      const message = await send({ type: "lre.editor", worldId: props.worldId, base: null, op: "put", collection: "steps", id, value: { id, purpose, template: MIND_PROMPT_DEFAULTS[purpose], output: "text", signals: [] } });
      if (message.type === "lre.result") open(id);
    });
  return (
    <Card title="Step templates">
      <div class="lre-small lre-muted">A world's template for a step wins over the built-in prompt, and a player's own prompt wins over it; only a step's first template (by id) with any text is used, and its signals are ignored. A new template starts from the built-in prompt.</div>
      {MIND_PURPOSES.map((purpose) => {
        const templates = Object.values(props.doc.steps).filter((t) => t.purpose === purpose).sort((a, b) => a.id.localeCompare(b.id));
        const used = worldMindTemplate(props.doc, purpose);
        return (
          <div key={purpose} class="lre-stack" style={{ gap: "2px" }} data-lre-minds-templates={purpose}>
            <Row
              k={STEP_LABEL[purpose]}
              v={
                templates.length === 0 ? (
                  <button type="button" class="lre-btn small" disabled={busy} onClick={() => add(purpose)}>
                    New template
                  </button>
                ) : undefined
              }
              sub={templates.length === 0 ? "None: the player's prompt, else the built-in" : undefined}
            />
            {templates.map((t) => (
              <button key={t.id} type="button" class="lre-item" onClick={() => open(t.id)}>
                <span class="grow">
                  <code>{t.id}</code>
                </span>
                {t === used ? null : <span class="lre-badge warn">{t.template.trim() === "" ? "Blank: not used" : "Not used"}</span>}
                <span class="lre-dim" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

export function MindsEditor() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const initial = draft ? worldMindsOf(draft.doc) : DEFAULT_WORLD_MINDS;
  const [value, setValue] = useState<WorldMindsConfig>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${draft?.worldId ?? ""}/minds`);
  if (!draft) return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const w = value.weights;
  const setWeights = (patch: Partial<FidelityWeights>) => setValue({ ...value, weights: { ...w, ...patch } });
  const t = value.thresholds;
  const ordered = t.live >= t.near && t.near >= t.far;
  const save = (next: JsonObject) => run(() => send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "minds", value: next }));
  return (
    <div class="lre-stack" data-lre-editor="part:minds">
      <div class="lre-h2">Minds</div>
      {lintAt(draft.lint, "minds").map((issue, i) => (
        <div key={`${issue.code}:${i}`} class={issue.severity === "error" ? "lre-banner warn" : "lre-banner info"}>
          {issue.message}
        </div>
      ))}
      <Card title="What the narrator gets of a mind">
        <Seg<MindsSecrecy> label="Secrecy" value={value.secrecy} options={(["brief", "full"] as const).map((s) => ({ value: s, label: SECRECY_EXPLAINED[s].label }))} disabled={busy} onChange={(secrecy) => setValue({ ...value, secrecy })} />
        {(["brief", "full"] as const).map((s) => (
          <Row key={s} k={SECRECY_EXPLAINED[s].label} sub={SECRECY_EXPLAINED[s].text} tone={s === value.secrecy ? undefined : "muted"} />
        ))}
        <div class="lre-small lre-muted">Either way, the player never sees a mind; the GM view shows them all.</div>
      </Card>
      <Card title="Focus weights">
        <div class="lre-small lre-muted">Points each thing adds to a character's focus score; the score decides how closely they are simulated. Negative points push them away.</div>
        {(Object.keys(WEIGHT_LABEL) as FlatWeight[]).map((key) => (
          <Weight key={key} label={WEIGHT_LABEL[key]} value={w[key]} disabled={busy} onChange={(v) => setWeights({ [key]: v })} />
        ))}
        {(Object.keys(BAND_LABEL) as (keyof FidelityWeights["band"])[]).map((key) => (
          <Weight key={key} label={BAND_LABEL[key]} value={w.band[key]} disabled={busy} onChange={(v) => setWeights({ band: { ...w.band, [key]: v } })} />
        ))}
        <Roles doc={draft.doc} roles={w.roles} disabled={busy} onChange={(roles) => setWeights({ roles })} />
      </Card>
      <Card title="Thresholds">
        <div class="lre-small lre-muted">The lowest score for each level. Live characters think every turn; Near ones when something calls for it; Far ones now and then; under Far, Background characters follow their routine.</div>
        {(["live", "near", "far"] as const).map((key) => (
          <NumberStepper key={key} label={FIDELITY_LABEL[key]} value={t[key]} min={MINDS_RANGES.threshold[0]} max={MINDS_RANGES.threshold[1]} step={5} integer disabled={busy} onChange={(v) => setValue({ ...value, thresholds: { ...t, [key]: v } })} />
        ))}
        {ordered ? null : <div class="lre-small lre-warn">Live should be at least Near, and Near at least Far; out of order, the lower ones are raised to match.</div>}
      </Card>
      <Card title="Who always, and who never">
        <SelectorEditor label="Always Live" value={value.always ?? undefined} doc={draft.doc} optional onChange={(next) => setValue({ ...value, always: next ?? null })} />
        <SelectorEditor label="Never a mind (wins over Always Live)" value={value.never ?? undefined} doc={draft.doc} optional onChange={(next) => setValue({ ...value, never: next ?? null })} />
        <div class="lre-small lre-muted">A selector with nothing in it picks no one. The player's own character never gets a mind.</div>
      </Card>
      <Card title="Memory defaults">
        <div class="lre-small lre-muted">How this world's characters remember. A player's own Settings → Minds → Memory wins.</div>
        {MEMORY_FIELDS.map((field) => {
          const current = memoryValue(value.memory, field);
          const set = (v: number | boolean) => setValue({ ...value, memory: { ...value.memory, [field.part]: { ...(value.memory[field.part] as unknown as JsonObject), [field.key]: v } } });
          return field.range ? (
            <NumberStepper key={`${field.part}.${field.key}`} label={field.label} value={typeof current === "number" ? current : null} min={field.range[0]} max={field.range[1]} step={field.step ?? 1} integer={field.integer === true} disabled={busy} onChange={set} />
          ) : (
            <HostSwitch key={`${field.part}.${field.key}`} label={field.label} checked={current === true} disabled={busy} onChange={set} />
          );
        })}
      </Card>
      <div class="lre-savebar">
        <button type="button" class="lre-btn primary" disabled={!changed || busy} onClick={() => save(mindsPartValue(value))}>
          Save to draft
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </button>
        <button type="button" class="lre-btn ghost" disabled={busy || draft.doc.minds === undefined} onClick={() => save({})}>
          Use the defaults
        </button>
      </div>
      <MindTemplates doc={draft.doc} worldId={draft.worldId} />
    </div>
  );
}
