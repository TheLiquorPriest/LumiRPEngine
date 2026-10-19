// Settings → Minds (DESIGN §24.6): whether characters get minds, how many Live minds run a turn, what
// refreshes a Near mind and how often a Far one thinks, which levels write memory notes, the Minds
// section's own budget, a time skip's caps, the user's memory overrides of the world's settings, and
// the four minds prompts, each beside its built-in default with Reset.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { Limit, MindPurpose, MindsSettings } from "../../shared/minds";
import { DEFAULT_MINDS_MEMORY, FIDELITIES, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MIND_PURPOSES, MINDS_DEFAULTS } from "../../shared/minds";
import { HostSwitch, NumberStepper, Row } from "../components";
import { MEMORY_FIELDS, memoryOverride, memoryOverridePatch, memoryValue, mindsPolicyPatch, mindsPromptPatch, withMemoryLevel } from "./minds-patch";
import { STEP_LABEL } from "./steps";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const PROMPT_NOTE: Record<MindPurpose, string> = {
  mind: "One call per character, as that character: what they think, how they come across, what they mean to do.",
  memory: "After the reply, per character at the levels you pick: the notes, commitments and plans they take from it.",
  skip: "Before a time skip: further moments in it worth stopping at.",
  consolidate: "Folds a character's faded and surplus notes into their summary.",
};

/** A count or period that may have no limit: a switch, and the number while there is one. */
function LimitField(props: { label: string; noneLabel: string; value: Limit; min: number; max: number; step?: number; fallback: Limit; disabled: boolean; onChange(next: Limit): void }) {
  const fallback = props.fallback === "none" ? props.min : props.fallback;
  return (
    <div class="lre-stack" style={{ gap: "2px" }}>
      <HostSwitch label={`${props.label}: ${props.noneLabel}`} checked={props.value === "none"} disabled={props.disabled} onChange={(none) => props.onChange(none ? "none" : fallback)} />
      {props.value === "none" ? null : <NumberStepper label={props.label} value={props.value} min={props.min} max={props.max} step={props.step ?? 1} integer disabled={props.disabled} onChange={props.onChange} />}
    </div>
  );
}

function PromptEditor(props: { purpose: MindPurpose; value: string | undefined; busy: boolean; patch(patch: JsonObject): void }) {
  const builtIn = MIND_PROMPT_DEFAULTS[props.purpose];
  const saved = props.value ?? builtIn;
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = mindsPromptPatch(props.purpose, text);
  return (
    <div class="lre-card" data-lre-minds-prompt={props.purpose}>
      <div class="lre-spread">
        <span class="title">{STEP_LABEL[props.purpose]}</span>
        <span class={props.value === undefined ? "lre-badge" : "lre-badge accent"}>{props.value === undefined ? "Built-in" : "Your own"}</span>
      </div>
      <div class="lre-small lre-muted">{PROMPT_NOTE[props.purpose]}</div>
      <textarea class="lre-input" rows={8} aria-label={`${STEP_LABEL[props.purpose]} prompt`} value={text} disabled={props.busy} onInput={(event) => setText(event.currentTarget.value)} />
      {text.length > MIND_PROMPT_MAX ? <div class="lre-small lre-warn">Too long: at most {MIND_PROMPT_MAX.toLocaleString()} characters.</div> : null}
      <details>
        <summary class="lre-small">The built-in default</summary>
        <pre class="lre-code" style={{ whiteSpace: "pre-wrap" }}>{builtIn}</pre>
      </details>
      <div class="lre-inline">
        <button type="button" class="lre-btn primary small" disabled={props.busy || save === null || text === saved} onClick={() => save && props.patch(save)}>
          Save
        </button>
        <button type="button" class="lre-btn ghost small" disabled={props.busy || text === saved} onClick={() => setText(saved)}>
          Revert
        </button>
        <button type="button" class="lre-btn small" disabled={props.busy || props.value === undefined} onClick={() => props.patch(mindsPromptPatch(props.purpose, null) ?? {})}>
          Reset to the default
        </button>
      </div>
    </div>
  );
}

export function MindsSection(props: { minds: MindsSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { minds, busy } = props;
  const policy = (change: Parameters<typeof mindsPolicyPatch>[0]) => props.patch(mindsPolicyPatch(change));
  return (
    <div class="lre-stack">
      <HostSwitch label="Character minds" checked={minds.enabled} disabled={busy} onChange={(enabled) => policy({ enabled })} />
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Each character near the story thinks for themselves in their own model call, scoped to what they know. Picking a Model use preset sets everything here but your prompts and memory overrides; changing any of these makes it Custom.
      </p>
      {minds.enabled ? (
        <>
          <div class="lre-h2">How many think</div>
          <LimitField label="Live minds a turn" noneLabel="no limit" value={minds.liveLimit} min={0} max={64} fallback={MINDS_DEFAULTS.liveLimit} disabled={busy} onChange={(liveLimit) => policy({ liveLimit })} />
          <div class="lre-small lre-muted">Live characters think every turn, best score first; past the limit they wait for a Near refresh.</div>
          <div class="lre-h2">Near refresh</div>
          <HostSwitch label="When they come into the scene, or it changes" checked={minds.nearRefresh.scene} disabled={busy} onChange={(scene) => policy({ nearRefresh: { scene } })} />
          <HostSwitch label="When the latest message or reply names them" checked={minds.nearRefresh.mention} disabled={busy} onChange={(mention) => policy({ nearRefresh: { mention } })} />
          <LimitField label="Every so many turns" noneLabel="never by turns" value={minds.nearRefresh.turns} min={1} max={1000} fallback={MINDS_DEFAULTS.nearRefresh.turns} disabled={busy} onChange={(turns) => policy({ nearRefresh: { turns } })} />
          <LimitField label="When their mind is this old (game minutes)" noneLabel="never by age" value={minds.nearRefresh.minutes} min={1} max={525_600} step={30} fallback={MINDS_DEFAULTS.nearRefresh.minutes} disabled={busy} onChange={(minutes) => policy({ nearRefresh: { minutes } })} />
          <div class="lre-h2">Far refresh</div>
          <LimitField label="Every (game minutes)" noneLabel="never" value={minds.farRefreshMinutes} min={1} max={525_600} step={60} fallback={MINDS_DEFAULTS.farRefreshMinutes} disabled={busy} onChange={(farRefreshMinutes) => policy({ farRefreshMinutes })} />
          <LimitField label="Near and Far refreshes a turn" noneLabel="no limit" value={minds.refreshLimit} min={0} max={64} fallback={MINDS_DEFAULTS.refreshLimit} disabled={busy} onChange={(refreshLimit) => policy({ refreshLimit })} />
          <div class="lre-small lre-muted">Besides the Live minds, the most pressing first. A refresh you ask for in the GM view always runs.</div>
          <div class="lre-small lre-muted">Background characters never get a mind; they follow their routine.</div>
          <div class="lre-h2">Memory notes after the reply</div>
          {FIDELITIES.filter((f) => f !== "background").map((level) => (
            <HostSwitch key={level} label={`${FIDELITY_LABEL[level]} characters in the scene`} checked={minds.memoryLevels.includes(level)} disabled={busy} onChange={(on) => policy({ memoryLevels: withMemoryLevel(minds.memoryLevels, level, on) })} />
          ))}
          <NumberStepper label="Minds section budget (tokens)" value={minds.tokens} min={0} max={100_000} step={100} integer disabled={busy} onChange={(tokens) => policy({ tokens })} />
          <div class="lre-small lre-muted">The narrator's Minds section has its own budget, apart from the engine's section budget, so minds never crowd out Scene or People.</div>
          <div class="lre-h2">Time skips</div>
          <LimitField label="Beats a skip may stop at" noneLabel="no limit" value={minds.skip.maxBeats} min={0} max={200} fallback={MINDS_DEFAULTS.skip.maxBeats} disabled={busy} onChange={(maxBeats) => policy({ skip: { maxBeats } })} />
          <LimitField label="Minds at each beat" noneLabel="no limit" value={minds.skip.maxMindsPerBeat} min={0} max={64} fallback={MINDS_DEFAULTS.skip.maxMindsPerBeat} disabled={busy} onChange={(maxMindsPerBeat) => policy({ skip: { maxMindsPerBeat } })} />
        </>
      ) : null}
      <div class="lre-h2">Memory</div>
      <div class="lre-small lre-muted">Each world sets these for its characters (Build → World → Minds); what you set here wins in every world.</div>
      {MEMORY_FIELDS.map((field) => {
        const own = memoryOverride(minds.memory, field);
        const id = `${field.part}.${field.key}`;
        const reset =
          own === undefined ? (
            <span class="lre-small lre-muted">the world's (built in: {String(memoryValue(DEFAULT_MINDS_MEMORY, field))})</span>
          ) : (
            <button type="button" class="lre-btn small ghost" disabled={busy} onClick={() => props.patch(memoryOverridePatch(field, null) ?? {})}>
              Use the world's
            </button>
          );
        if (!field.range) {
          return (
            <div key={id} data-lre-minds-memory={id}>
              <HostSwitch label={field.label} checked={typeof own === "boolean" ? own : memoryValue(DEFAULT_MINDS_MEMORY, field) === true} disabled={busy} onChange={(on) => props.patch(memoryOverridePatch(field, on) ?? {})} />
              {reset}
            </div>
          );
        }
        return (
          <div key={id} data-lre-minds-memory={id}>
            <NumberStepper label={field.label} value={typeof own === "number" ? own : null} min={field.range[0]} max={field.range[1]} step={field.step ?? 1} integer={field.integer === true} disabled={busy} onChange={(value) => { const p = memoryOverridePatch(field, value); if (p) props.patch(p); }} />
            {reset}
          </div>
        );
      })}
      <div class="lre-h2">Prompts</div>
      <Row k="Your prompt wins over the world's own step template for a purpose (Build → Step templates), and that over the built-in." />
      {MIND_PURPOSES.map((purpose) => (
        <PromptEditor key={purpose} purpose={purpose} value={minds.prompts[purpose]} busy={busy} patch={props.patch} />
      ))}
    </div>
  );
}
