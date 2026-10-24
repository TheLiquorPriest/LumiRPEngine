// Build → World → Needs (DESIGN §8): each need on or off, how fast it grows and the two points it is
// told and alerts from, every number said in words with its value, what meets the need and how long
// it takes from met to each point. The names and words are the shared set every surface uses
// (`NEED_WORDS`). Saved whole as `lre.editor set part needs`; the backend stores only what differs
// from the defaults, so a world left as it was keeps no settings. Styles: styles/minds.ts's notes.

import { useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import { NEED_DEFAULTS, NEED_IDS, NEED_WORDS, needsSettingsOf, type NeedId, type NeedTuning } from "../../shared/needs";
import { useApp } from "../app";
import { Button, NumberStepper, PageHeader, SaveBar, Seg, useBusy } from "../components";
import { formatMinutes } from "../format";
import { useSelect } from "../store";
import { PART_INFO } from "./chrome";
import { draftSend } from "./draft";
import { FormGroup, Issues } from "./form-kit";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";

type Needs = Record<NeedId, NeedTuning>;

/** How long a need takes from met to the two points at its rate, in words: what the numbers add up to. */
export function needTiming(t: NeedTuning): string {
  if (t.rate <= 0) return "At 0 points an hour it never grows, so it's never told and never alerts.";
  const after = (point: number) => formatMinutes((point / t.rate) * 60);
  return `From met, it's told after ${after(t.tell)} and alerts after ${after(t.alert)}.`;
}

/** On or off, as each need's header offers it: both choices shown, so its state never reads against its label. */
const ON_OFF = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const;

/** Each need's settings, every number in words with its value; no hooks, so its controls can be walked. */
export function NeedsFields(props: { value: Needs; lint: readonly LintIssue[]; disabled: boolean; onChange(next: Needs): void }) {
  const set = (need: NeedId, patch: Partial<NeedTuning>) => props.onChange({ ...props.value, [need]: { ...props.value[need], ...patch } });
  return (
    <>
      {NEED_IDS.map((need) => {
        const t = props.value[need];
        const words = NEED_WORDS[need];
        return (
          <FormGroup key={need} title={words.name} aside={<Seg<"on" | "off"> label={words.name} value={t.on ? "on" : "off"} options={ON_OFF} disabled={props.disabled} onChange={(v) => set(need, { on: v === "on" })} />}>
            <p class="lre-minds-note">
              Met by {words.metBy}. Once it's pressing, the narrator is told your character is {words.word}.
            </p>
            {t.on ? (
              <>
                <NumberStepper label={`Grows by ${t.rate} ${t.rate === 1 ? "point" : "points"} an hour, out of 100`} value={t.rate} min={0} max={100} step={0.5} disabled={props.disabled} onChange={(rate) => set(need, { rate })} />
                <NumberStepper label={`Told to the narrator from ${t.tell}`} value={t.tell} min={0} max={100} integer disabled={props.disabled} onChange={(tell) => set(need, { tell })} />
                <NumberStepper label={`An alert from ${t.alert}`} value={t.alert} min={0} max={100} integer disabled={props.disabled} onChange={(alert) => set(need, { alert })} />
                <p class="lre-minds-note">
                  {needTiming(t)} Play → Me marks it from the point it's told. An alert stops a time skip only if Time → Interrupts says so, which by default it doesn't.
                </p>
              </>
            ) : (
              <p class="lre-minds-note">Off: it never grows, shows, is told or alerts.</p>
            )}
            <Issues issues={lintAt(props.lint, `needs.${need}`)} />
          </FormGroup>
        );
      })}
    </>
  );
}

/** Build → World → Needs: every need, saved together from the sticky bar. */
export function NeedsEditor() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const initial = draft ? needsSettingsOf(draft.doc) : NEED_DEFAULTS;
  const [value, setValue] = useState<Needs>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${draft?.worldId ?? ""}/needs`);
  if (!draft) return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const save = (next: Needs) => run(() => send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "needs", value: next as unknown as JsonValue }));
  const lint = lintAt(draft.lint, "needs");
  return (
    <div class="lre-build-page" data-lre-editor="part:needs">
      <PageHeader title={PART_INFO.needs.label} subtitle={PART_INFO.needs.hint} />
      <p class="lre-build-note">
        Each need runs from 0, met, to 100, urgent, and grows by the hour until something meets it. Needs run from Cast life 4 (Realism), and only the player character's are told and shown.
      </p>
      <Issues issues={lint.filter((issue) => !NEED_IDS.some((need) => issue.path === `needs.${need}` || issue.path.startsWith(`needs.${need}.`)))} />
      <NeedsFields value={value} lint={lint} disabled={busy} onChange={setValue} />
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={() => save(value)}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
        <Button variant="ghost" disabled={busy || draft.doc.needs === undefined} onClick={() => save(NEED_DEFAULTS)}>
          Use the defaults
        </Button>
      </SaveBar>
    </div>
  );
}
