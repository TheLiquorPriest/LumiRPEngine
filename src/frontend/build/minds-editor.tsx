// Build → World → Minds (DESIGN §24.2): what the narrator gets of a mind (secrecy),
// the fidelity ladder's thresholds and focus weights, who is always Live and who never gets a mind,
// the memory defaults, and the world's own step templates for the minds steps, written in the
// step-template editor. Saved whole as `lre.editor set part minds` from the sticky bar; a world left
// at the defaults keeps no config. Each group shows the lint under its own path. Styles:
// styles/minds.ts and styles/forms.ts.

import { useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { FidelityWeights, MindPurpose, MindsSecrecy, WorldMindsConfig } from "../../shared/minds";
import { DEFAULT_WORLD_MINDS, MIND_PROMPT_DEFAULTS, MIND_PURPOSES, MINDS_RANGES, worldMindsOf } from "../../shared/minds";
import type { LintIssue } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Button, Disclosure, IconButton, IdText, NumberStepper, PageHeader, SaveBar, useBusy } from "../components";
import { Icon } from "../icons";
import { STEP_LABEL } from "../settings/steps";
import { MEMORY_FIELDS, memoryValue } from "../settings/minds-patch";
import { useSelect } from "../store";
import { itemLabel, PART_INFO } from "./chrome";
import { draftSend } from "./draft";
import { AddPicker, CheckField, FormGroup, Issues, ItemRow } from "./form-kit";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";
import { SelectorEditor } from "./selector-editor";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

export const SECRECY_EXPLAINED: Record<MindsSecrecy, { label: string; text: string }> = {
  brief: {
    label: "Brief",
    text: "The narrator gets only a short description of how each character comes across: what they do, how they look and sound. It is checked first, and left out if it would give away a secret or someone you haven't met. Their private thoughts and what they mean to do stay in GM mode. Safest against spoilers; the narrator has less to work with.",
  },
  full: {
    label: "Full",
    text: "The narrator also gets each character's inner monologue and what they mean to do, told to show them through behaviour and never say them outright. Richer, more consistent characters; a careless narrator could let a thought or a secret slip.",
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

/** The config's parts with a group of their own here; lint under any other path shows at the top. */
const GROUPED = ["minds.secrecy", "minds.thresholds", "minds.weights", "minds.always", "minds.never", "minds.memory"] as const;

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

/** Role weights by classification value: each by name with its points and Remove; a picker adds one at 20 points. */
function Roles(props: { doc: WorldDoc; roles: Record<string, number>; lint: readonly LintIssue[]; disabled: boolean; onChange(next: Record<string, number>): void }) {
  const options = roleOptions(props.doc);
  const left = options.filter((o) => props.roles[o.value] === undefined);
  return (
    <div class="lre-minds-roles" data-lre-minds-roles>
      <span class="lre-minds-subhead">Roles</span>
      <p class="lre-minds-note">Role values (a value nested under one counts as it), such as an antagonist.</p>
      {Object.entries(props.roles).map(([id, pts]) => {
        const name = options.find((o) => o.value === id)?.label ?? id;
        return (
          <div key={id} class="lre-minds-role">
            <div class="lre-minds-role-field">
              <Weight label={name} value={pts} disabled={props.disabled} onChange={(v) => props.onChange({ ...props.roles, [id]: v })} />
              <IdText id={id} />
              <Issues issues={lintAt(props.lint, `minds.weights.roles.${id}`)} />
            </div>
            <IconButton icon="trash" label={`Remove ${name}`} disabled={props.disabled} onClick={() => props.onChange(Object.fromEntries(Object.entries(props.roles).filter(([k]) => k !== id)))} />
          </div>
        );
      })}
      {left.length > 0 ? (
        <AddPicker label="Add a role value" placeholder="Add a role value…" options={left} disabled={props.disabled} onAdd={(value) => props.onChange({ ...props.roles, [value]: 20 })} />
      ) : options.length === 0 ? (
        <p class="lre-minds-note">This world has no classifications yet.</p>
      ) : null}
    </div>
  );
}

/** The world's step templates for the minds steps: each opens in the step-template editor; a new one starts from the built-in prompt. */
function MindTemplates(props: { doc: WorldDoc; worldId: string; unsaved: boolean }) {
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
    <FormGroup title="Step templates">
      <p class="lre-minds-note">A world's template for a step wins over the player's own prompt and the built-in one; only a step's first template (by id) is used, and its signals are ignored. A new template starts from the built-in prompt and goes into the draft straight away, as its own item in Step templates.</p>
      {/* A new template opens its own page, which would drop the edits above. */}
      {props.unsaved && MIND_PURPOSES.some((purpose) => !Object.values(props.doc.steps).some((t) => t.purpose === purpose)) ? <p class="lre-minds-note">Save or revert your changes first.</p> : null}
      {MIND_PURPOSES.map((purpose) => {
        const templates = Object.values(props.doc.steps)
          .filter((t) => t.purpose === purpose)
          .sort((a, b) => a.id.localeCompare(b.id));
        return (
          <div key={purpose} class="lre-minds-tpl" data-lre-minds-templates={purpose}>
            <div class="lre-minds-tpl-head">
              <span class="lre-minds-tpl-text">
                <span class="lre-minds-subhead">{STEP_LABEL[purpose]}</span>
                {templates.length === 0 ? <span class="lre-minds-note">None: the player's prompt, else the built-in</span> : null}
              </span>
              {templates.length === 0 ? (
                <Button size="sm" icon="plus" disabled={props.unsaved} busy={busy} onClick={() => add(purpose)}>
                  New template
                </Button>
              ) : null}
            </div>
            {templates.length > 0 ? (
              <div class="lre-form-items">
                {templates.map((t, i) => {
                  const name = itemLabel("steps", t.id, t);
                  return <ItemRow key={t.id} title={name} subtitle={<IdText id={t.id} />} badge={i > 0 ? <Badge tone="warn">Not used</Badge> : undefined} openLabel={`Open the template ${name}`} onOpen={() => open(t.id)} />;
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </FormGroup>
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
  const loose = lintAt(draft.lint, "minds").filter((issue) => !GROUPED.some((path) => issue.path === path || issue.path.startsWith(`${path}.`)));
  return (
    <div class="lre-build-page lre-minds-build" data-lre-editor="part:minds">
      <PageHeader title={PART_INFO.minds.label} subtitle={PART_INFO.minds.hint} />
      <Issues issues={loose} />
      <FormGroup title="What the narrator gets of a mind">
        <div class="lre-minds-choices" role="radiogroup" aria-label="Secrecy">
          {(["brief", "full"] as const).map((s) => {
            const checked = value.secrecy === s;
            return (
              <button key={s} type="button" role="radio" aria-checked={checked} class="lre-minds-choice" data-lre-secrecy={s} disabled={busy} onClick={() => (checked ? undefined : setValue({ ...value, secrecy: s }))}>
                <span class="lre-minds-choice-head">
                  <span class="lre-minds-choice-name">{SECRECY_EXPLAINED[s].label}</span>
                  {checked ? (
                    <span class="lre-minds-choice-mark">
                      <Icon name="check" size={16} />
                      In use
                    </span>
                  ) : null}
                </span>
                <span class="lre-minds-choice-text">{SECRECY_EXPLAINED[s].text}</span>
              </button>
            );
          })}
        </div>
        <p class="lre-minds-note">Either way, the player never sees a mind; GM mode shows them all.</p>
        <Issues issues={lintAt(draft.lint, "minds.secrecy")} />
      </FormGroup>
      <FormGroup title="Thresholds">
        <p class="lre-minds-note">The lowest focus score for each level. Live characters think every turn; Near ones when something calls for it; Far ones now and then; under Far, Background characters follow their routine.</p>
        <div class="lre-minds-fields">
          {(["live", "near", "far"] as const).map((key) => (
            <NumberStepper key={key} label={FIDELITY_LABEL[key]} value={t[key]} min={MINDS_RANGES.threshold[0]} max={MINDS_RANGES.threshold[1]} step={5} integer disabled={busy} onChange={(v) => setValue({ ...value, thresholds: { ...t, [key]: v } })} />
          ))}
        </div>
        {ordered ? null : (
          <span class="lre-form-issue warn" role="note">
            <Icon name="alert" size={16} />
            <span>Live should be at least Near, and Near at least Far; out of order, the lower ones are raised to match.</span>
          </span>
        )}
        <Issues issues={lintAt(draft.lint, "minds.thresholds")} />
      </FormGroup>
      <FormGroup title="Focus weights">
        <p class="lre-minds-note">Points each thing adds to a character's focus score; the score decides how closely they are simulated. Negative points push them away.</p>
        <Disclosure summary="What counts toward the score">
          <div class="lre-minds-fields">
            {(Object.keys(WEIGHT_LABEL) as FlatWeight[]).map((key) => (
              <Weight key={key} label={WEIGHT_LABEL[key]} value={w[key]} disabled={busy} onChange={(v) => setWeights({ [key]: v })} />
            ))}
          </div>
        </Disclosure>
        <Disclosure summary="Tier bands">
          <div class="lre-minds-fields">
            {(Object.keys(BAND_LABEL) as (keyof FidelityWeights["band"])[]).map((key) => (
              <Weight key={key} label={BAND_LABEL[key]} value={w.band[key]} disabled={busy} onChange={(v) => setWeights({ band: { ...w.band, [key]: v } })} />
            ))}
          </div>
        </Disclosure>
        <Roles doc={draft.doc} roles={w.roles} lint={draft.lint} disabled={busy} onChange={(roles) => setWeights({ roles })} />
        <Issues issues={lintAt(draft.lint, "minds.weights").filter((issue) => !issue.path.startsWith("minds.weights.roles."))} />
      </FormGroup>
      <FormGroup title="Who always, and who never">
        <SelectorEditor label="Always Live" value={value.always ?? undefined} doc={draft.doc} optional onChange={(next) => setValue({ ...value, always: next ?? null })} />
        <Issues issues={lintAt(draft.lint, "minds.always")} />
        <SelectorEditor label="Never a mind (wins over Always Live)" value={value.never ?? undefined} doc={draft.doc} optional onChange={(next) => setValue({ ...value, never: next ?? null })} />
        <Issues issues={lintAt(draft.lint, "minds.never")} />
        <p class="lre-minds-note">A selector with nothing in it picks no one. The player's own character never gets a mind.</p>
      </FormGroup>
      <FormGroup title="Memory defaults">
        <p class="lre-minds-note">How this world's characters remember. A player's own Settings → Minds → Memory wins.</p>
        <div class="lre-minds-fields">
          {MEMORY_FIELDS.map((field) => {
            const current = memoryValue(value.memory, field);
            const set = (v: number | boolean) => setValue({ ...value, memory: { ...value.memory, [field.part]: { ...(value.memory[field.part] as unknown as JsonObject), [field.key]: v } } });
            return field.range ? (
              <NumberStepper key={`${field.part}.${field.key}`} label={field.label} value={typeof current === "number" ? current : null} min={field.range[0]} max={field.range[1]} step={field.step ?? 1} integer={field.integer === true} disabled={busy} onChange={set} />
            ) : (
              <CheckField key={`${field.part}.${field.key}`} label={field.label} checked={current === true} disabled={busy} onChange={set} />
            );
          })}
        </div>
        <Issues issues={lintAt(draft.lint, "minds.memory")} />
      </FormGroup>
      <MindTemplates doc={draft.doc} worldId={draft.worldId} unsaved={changed} />
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={() => save(mindsPartValue(value))}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
        <Button variant="ghost" disabled={busy || draft.doc.minds === undefined} onClick={() => save({})}>
          Use the defaults
        </Button>
      </SaveBar>
    </div>
  );
}
