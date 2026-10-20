// Settings → Minds (DESIGN §24.6): whether characters get minds, how many think a
// turn, what refreshes a Near mind and how often a Far one thinks, which levels write memory notes,
// the Minds section's own budget and a time skip's caps (under Advanced), the user's memory
// overrides of the world's settings (a disclosure, as they're long), and the four minds prompts, each
// beside its built-in default with Reset. Every patch is `minds-patch.ts`'s. Styles: styles/minds.ts.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { Limit, MindPurpose, MindsSettings } from "../../shared/minds";
import { DEFAULT_MINDS_MEMORY, FIDELITIES, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MIND_PURPOSES, MINDS_DEFAULTS } from "../../shared/minds";
import { Badge, Button, Disclosure, HostSwitch, NumberStepper, Section } from "../components";
import { Icon } from "../icons";
import type { MemoryField } from "./minds-patch";
import { MEMORY_FIELDS, memoryOverride, memoryOverridePatch, memoryValue, mindsPolicyPatch, mindsPromptPatch, withMemoryLevel } from "./minds-patch";
import { STEP_LABEL } from "./steps";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const PROMPT_NOTE: Record<MindPurpose, string> = {
  mind: "One call per character, as that character: what they think, how they come across, what they mean to do.",
  memory: "After the reply, per character who heard your message, at the levels you pick: the notes, commitments and plans they take from it.",
  skip: "Before a time skip: further moments in it worth stopping at.",
  consolidate: "Folds a character's faded and surplus notes into their summary.",
};

function Note(props: { children: string }) {
  return <p class="lre-minds-note">{props.children}</p>;
}

/** A count or period that may have no limit: a switch, and the number while there is one. */
function LimitField(props: { label: string; noneLabel: string; value: Limit; min: number; max: number; step?: number; fallback: Limit; disabled: boolean; onChange(next: Limit): void }) {
  const fallback = props.fallback === "none" ? props.min : props.fallback;
  return (
    <div class="lre-minds-limit">
      <HostSwitch label={`${props.label}: ${props.noneLabel}`} checked={props.value === "none"} disabled={props.disabled} onChange={(none) => props.onChange(none ? "none" : fallback)} />
      {props.value === "none" ? null : <NumberStepper label={props.label} value={props.value} min={props.min} max={props.max} step={props.step ?? 1} integer disabled={props.disabled} onChange={props.onChange} />}
    </div>
  );
}

/** One memory tunable as the user's override: unset, the world's applies; set, "Use the world's" deletes it. */
function MemoryOverride(props: { field: MemoryField; memory: MindsSettings["memory"]; busy: boolean; patch(patch: JsonObject): void }) {
  const { field, busy } = props;
  const own = memoryOverride(props.memory, field);
  const builtIn = memoryValue(DEFAULT_MINDS_MEMORY, field);
  const id = `${field.part}.${field.key}`;
  return (
    <div class="lre-minds-override" data-lre-minds-memory={id}>
      {field.range ? (
        <NumberStepper
          label={field.label}
          value={typeof own === "number" ? own : null}
          min={field.range[0]}
          max={field.range[1]}
          step={field.step ?? 1}
          integer={field.integer === true}
          disabled={busy}
          onChange={(value) => {
            const p = memoryOverridePatch(field, value);
            if (p) props.patch(p);
          }}
        />
      ) : (
        <HostSwitch label={field.label} checked={typeof own === "boolean" ? own : builtIn === true} disabled={busy} onChange={(on) => props.patch(memoryOverridePatch(field, on) ?? {})} />
      )}
      <div class="lre-minds-override-foot">
        {own === undefined ? (
          <span class="lre-minds-note">The world's applies (built in: {typeof builtIn === "boolean" ? (builtIn ? "on" : "off") : builtIn})</span>
        ) : (
          <>
            <Badge tone="accent">Yours</Badge>
            <Button size="sm" variant="ghost" icon="undo" label={`Use the world's ${field.label.toLowerCase()}`} disabled={busy} onClick={() => props.patch(memoryOverridePatch(field, null) ?? {})}>
              Use the world's
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PromptEditor(props: { purpose: MindPurpose; value: string | undefined; busy: boolean; patch(patch: JsonObject): void }) {
  const builtIn = MIND_PROMPT_DEFAULTS[props.purpose];
  const saved = props.value ?? builtIn;
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = mindsPromptPatch(props.purpose, text);
  const label = STEP_LABEL[props.purpose];
  return (
    <div class="lre-minds-prompt" data-lre-minds-prompt={props.purpose}>
      <Disclosure
        summary={
          <span class="lre-minds-prompt-head">
            <span class="lre-minds-prompt-text">
              <span class="lre-minds-prompt-title">{label}</span>
              <span class="lre-minds-prompt-sub">{PROMPT_NOTE[props.purpose]}</span>
            </span>
            {props.value === undefined ? <Badge>Built-in</Badge> : <Badge tone="accent">Your own</Badge>}
          </span>
        }
      >
        <textarea class="lre-input lre-minds-prompt-input" rows={10} aria-label={`${label} prompt`} value={text} disabled={props.busy} onInput={(event) => setText(event.currentTarget.value)} />
        {text.length > MIND_PROMPT_MAX ? (
          <div class="lre-set-warn" role="note">
            <Icon name="alert" size={16} />
            <span>Too long: at most {MIND_PROMPT_MAX.toLocaleString()} characters.</span>
          </div>
        ) : null}
        <div class="lre-minds-actions">
          <Button size="sm" variant="primary" disabled={props.busy || save === null || text === saved} onClick={() => save && props.patch(save)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={props.busy || text === saved} onClick={() => setText(saved)}>
            Revert
          </Button>
          <Button size="sm" icon="undo" disabled={props.busy || props.value === undefined} onClick={() => props.patch(mindsPromptPatch(props.purpose, null) ?? {})}>
            Reset to the default
          </Button>
        </div>
        <div class="lre-minds-default">
          <Disclosure summary="The built-in default">
            <pre class="lre-minds-code">{builtIn}</pre>
          </Disclosure>
        </div>
      </Disclosure>
    </div>
  );
}

export function MindsSection(props: { minds: MindsSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { minds, busy } = props;
  const policy = (change: Parameters<typeof mindsPolicyPatch>[0]) => props.patch(mindsPolicyPatch(change));
  const overrides = MEMORY_FIELDS.filter((field) => memoryOverride(minds.memory, field) !== undefined).length;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="minds">
      <p class="lre-set-lead">Each character near the story thinks for themselves in their own model call, scoped to what they know.</p>
      <Section>
        <div class="lre-minds-body">
          <HostSwitch label="Character minds" checked={minds.enabled} disabled={busy} onChange={(enabled) => policy({ enabled })} />
          <Note>Picking a Model use preset sets everything here but your prompts and memory overrides; changing any of these makes it Custom.</Note>
        </div>
      </Section>
      {minds.enabled ? (
        <>
          <Section title="How many think">
            <div class="lre-minds-body">
              <LimitField label="Live minds a turn" noneLabel="no limit" value={minds.liveLimit} min={0} max={64} fallback={MINDS_DEFAULTS.liveLimit} disabled={busy} onChange={(liveLimit) => policy({ liveLimit })} />
              <Note>Live characters think every turn, best score first; past the limit they wait for a Near refresh.</Note>
              <LimitField label="Near and Far refreshes a turn" noneLabel="no limit" value={minds.refreshLimit} min={0} max={64} fallback={MINDS_DEFAULTS.refreshLimit} disabled={busy} onChange={(refreshLimit) => policy({ refreshLimit })} />
              <Note>Besides the Live minds, the most pressing first. A refresh you ask for in GM mode always runs.</Note>
              <Note>Background characters never get a mind; they follow their routine.</Note>
            </div>
          </Section>
          <Section title="Near refresh">
            <div class="lre-minds-body">
              <Note>A Near character thinks again when one of these calls for it.</Note>
              <HostSwitch label="When they come into the scene, or it changes" checked={minds.nearRefresh.scene} disabled={busy} onChange={(scene) => policy({ nearRefresh: { scene } })} />
              <HostSwitch label="When the latest message or reply names them" checked={minds.nearRefresh.mention} disabled={busy} onChange={(mention) => policy({ nearRefresh: { mention } })} />
              <LimitField label="Every so many turns" noneLabel="never by turns" value={minds.nearRefresh.turns} min={1} max={1000} fallback={MINDS_DEFAULTS.nearRefresh.turns} disabled={busy} onChange={(turns) => policy({ nearRefresh: { turns } })} />
              <LimitField label="When their mind is this old (game minutes)" noneLabel="never by age" value={minds.nearRefresh.minutes} min={1} max={525_600} step={30} fallback={MINDS_DEFAULTS.nearRefresh.minutes} disabled={busy} onChange={(minutes) => policy({ nearRefresh: { minutes } })} />
            </div>
          </Section>
          <Section title="Far refresh">
            <div class="lre-minds-body">
              <Note>A Far character thinks now and then, on game time.</Note>
              <LimitField label="Every (game minutes)" noneLabel="never" value={minds.farRefreshMinutes} min={1} max={525_600} step={60} fallback={MINDS_DEFAULTS.farRefreshMinutes} disabled={busy} onChange={(farRefreshMinutes) => policy({ farRefreshMinutes })} />
            </div>
          </Section>
          <Section title="Memory notes after the reply">
            <div class="lre-minds-body">
              <Note>Which of the characters who heard your message take notes, commitments and plans from the reply.</Note>
              {FIDELITIES.filter((f) => f !== "background").map((level) => (
                <HostSwitch key={level} label={`${FIDELITY_LABEL[level]} characters who heard you`} checked={minds.memoryLevels.includes(level)} disabled={busy} onChange={(on) => policy({ memoryLevels: withMemoryLevel(minds.memoryLevels, level, on) })} />
              ))}
            </div>
          </Section>
          <Section>
            <Disclosure summary="Advanced: the Minds section budget and time skips">
              <div class="lre-minds-group">
                <span class="lre-minds-group-title">The narrator's Minds section</span>
                <NumberStepper label="Minds section budget (tokens)" value={minds.tokens} min={0} max={100_000} step={100} integer disabled={busy} onChange={(tokens) => policy({ tokens })} />
                <Note>The narrator's Minds section has its own budget, apart from the engine's section budget, so minds never crowd out Scene or People.</Note>
              </div>
              <div class="lre-minds-group">
                <span class="lre-minds-group-title">Time skips</span>
                <LimitField label="Beats a skip may stop at" noneLabel="no limit" value={minds.skip.maxBeats} min={0} max={200} fallback={MINDS_DEFAULTS.skip.maxBeats} disabled={busy} onChange={(maxBeats) => policy({ skip: { maxBeats } })} />
                <LimitField label="Minds at each beat" noneLabel="no limit" value={minds.skip.maxMindsPerBeat} min={0} max={64} fallback={MINDS_DEFAULTS.skip.maxMindsPerBeat} disabled={busy} onChange={(maxMindsPerBeat) => policy({ skip: { maxMindsPerBeat } })} />
              </div>
            </Disclosure>
          </Section>
        </>
      ) : null}
      <Section title="Memory">
        <div class="lre-minds-body">
          <Note>Each world sets how its characters remember (Build → World → Minds); what you set here wins in every world.</Note>
          <Disclosure
            summary={
              <span class="lre-minds-summary">
                <span>Your overrides</span>
                {overrides > 0 ? <Badge tone="accent">{overrides === 1 ? "1 set" : `${overrides} set`}</Badge> : <Badge>None</Badge>}
              </span>
            }
          >
            <div class="lre-minds-overrides">
              {MEMORY_FIELDS.map((field) => (
                <MemoryOverride key={`${field.part}.${field.key}`} field={field} memory={minds.memory} busy={busy} patch={props.patch} />
              ))}
            </div>
          </Disclosure>
        </div>
      </Section>
      <Section title="Prompts" flush>
        <div class="lre-minds-prompts">
          <p class="lre-minds-note lre-minds-prompts-lead">Your prompt wins over the world's own step template for a purpose (Build → Step templates), and that over the built-in.</p>
          {MIND_PURPOSES.map((purpose) => (
            <PromptEditor key={purpose} purpose={purpose} value={minds.prompts[purpose]} busy={busy} patch={props.patch} />
          ))}
        </div>
      </Section>
    </div>
  );
}
