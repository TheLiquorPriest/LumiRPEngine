// Build → World → Routines and the story (DESIGN §8): how aware of the story and its lore people's
// routines are (Story first, Balanced, Routine first), whom routine blocks may invite, how social
// people are, and which story plans may move their work or school. Saved whole as `lre.editor set
// part routineSettings`; the defaults remove it, so a world left as it was keeps no settings. Whatever
// is picked, the story leads for anyone on screen: no setting lets a routine move someone out of a
// scene with the player's character, contradict the narration or interrupt play. Routines' own list
// links here. Styles: the choice cards of styles/minds.ts, styles/forms.ts.

import { useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import type { RoutineAwareness, RoutineInvitations, RoutinePlanBend, RoutineSettings, RoutineSociability } from "../../shared/routines";
import { AWARENESS_LABEL, DEFAULT_ROUTINE_SETTINGS, INVITATIONS_LABEL, PLAN_BEND_LABEL, ROUTINE_AWARENESS, ROUTINE_INVITATIONS, ROUTINE_PLAN_BEND, ROUTINE_SOCIABILITY, routineSettingsOf, SOCIABILITY_LABEL } from "../../shared/routines";
import { useApp } from "../app";
import { Button, Field, PageHeader, SaveBar, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import type { Req } from "../requests";
import { useSelect } from "../store";
import { PART_INFO } from "./chrome";
import { draftSend } from "./draft";
import { FormGroup, Issues } from "./form-kit";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";

/** Each awareness in one plain line. */
export const AWARENESS_EXPLAINED: Record<RoutineAwareness, string> = {
  story_first: "People off screen bend their routine for the story's plans and the GM's, what the story sets holds until it's released, and characters close to the player get no routine nudges at all.",
  balanced: "Background characters keep their routine, distant ones bend it for the story's plans, what the story sets holds for the rest of that day, and characters close to the player get it only as a soft suggestion.",
  routine_first: "Background and distant characters keep to their routine, bending only as the plans setting below allows, and what the story sets holds until their next block.",
};

/** Each invitations setting in one plain line. */
export const INVITATIONS_EXPLAINED: Record<RoutineInvitations, string> = {
  off: "Routine blocks never invite anyone. Plans from the story and the GM still can.",
  player: "A routine block that asks its company along may invite the player's character, and no one else.",
  everyone: "Routine blocks may invite anyone, and people take each other's invitations.",
};

/** Each sociability in one plain line. */
export const SOCIABILITY_EXPLAINED: Record<RoutineSociability, string> = {
  reserved: "The wish for company and fun grows half as fast.",
  usual: "The wish for company and fun grows as it usually does.",
  outgoing: "The wish for company and fun grows half again as fast.",
};

/** The draft write that saves the world's routine settings whole; the defaults leave the world without any. */
export function routineSettingsWrite(worldId: string, settings: RoutineSettings): Req<"lre.editor"> {
  return { type: "lre.editor", worldId, base: null, op: "set", part: "routineSettings", value: { ...settings } as unknown as JsonValue };
}

/** A setting's choices as cards, each with its line; the one in force is marked. */
function Choices<T extends string>(props: { label: string; value: T; options: readonly T[]; names: Record<T, string>; lines?: Record<T, string>; disabled: boolean; onChange(next: T): void }) {
  return (
    <div class="lre-minds-choices" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => {
        const checked = props.value === option;
        return (
          <button key={option} type="button" role="radio" aria-checked={checked} class="lre-minds-choice" data-lre-choice={option} disabled={props.disabled} onClick={() => (checked ? undefined : props.onChange(option))}>
            <span class="lre-minds-choice-head">
              <span class="lre-minds-choice-name">{props.names[option]}</span>
              {checked ? (
                <span class="lre-minds-choice-mark">
                  <Icon name="check" size={16} />
                  In use
                </span>
              ) : null}
            </span>
            {props.lines ? <span class="lre-minds-choice-text">{props.lines[option]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Build → World → Routines and the story: the four settings, saved together from the sticky bar. */
export function RoutineSettingsEditor() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const initial = draft ? routineSettingsOf(draft.doc) : DEFAULT_ROUTINE_SETTINGS;
  const [value, setValue] = useState<RoutineSettings>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${draft?.worldId ?? ""}/routineSettings`);
  if (!draft) return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const save = (next: RoutineSettings) => run(() => send(routineSettingsWrite(draft.worldId, next)));
  const lint = lintAt(draft.lint, "routineSettings");
  return (
    <div class="lre-build-page" data-lre-editor="part:routineSettings">
      <PageHeader title={PART_INFO.routineSettings.label} subtitle={PART_INFO.routineSettings.hint} />
      <p class="lre-build-note">
        Whatever you pick, the story comes first for anyone in a scene with the player's character: a routine never moves them out of it, contradicts what's been told or interrupts play. These settings tune how far everyone else's days follow the story and its lore, and how far they keep to routine.
      </p>
      <Issues issues={lint.filter((issue) => !["awareness", "invitations", "sociability", "planBend"].some((key) => issue.path === `routineSettings.${key}`))} />
      <FormGroup title="Story and lore awareness">
        <Choices label="Story and lore awareness" value={value.awareness} options={ROUTINE_AWARENESS} names={AWARENESS_LABEL} lines={AWARENESS_EXPLAINED} disabled={busy} onChange={(awareness) => setValue({ ...value, awareness })} />
        <p class="lre-minds-note">The GM can set it apart for one character in a chat.</p>
        <Issues issues={lintAt(lint, "routineSettings.awareness")} />
      </FormGroup>
      <FormGroup title="Invitations">
        <Field label="Routine blocks may invite" help={INVITATIONS_EXPLAINED[value.invitations]}>
          <Seg<RoutineInvitations> label="Routine blocks may invite" value={value.invitations} options={ROUTINE_INVITATIONS.map((v) => ({ value: v, label: INVITATIONS_LABEL[v] }))} disabled={busy} onChange={(invitations) => setValue({ ...value, invitations })} />
        </Field>
        <p class="lre-minds-note">A block invites only when it names its company and asks them along, so nobody is invited out of nowhere.</p>
        <Issues issues={lintAt(lint, "routineSettings.invitations")} />
      </FormGroup>
      <FormGroup title="Sociability">
        <Field label="How social people are" help={SOCIABILITY_EXPLAINED[value.sociability]}>
          <Seg<RoutineSociability> label="How social people are" value={value.sociability} options={ROUTINE_SOCIABILITY.map((v) => ({ value: v, label: SOCIABILITY_LABEL[v] }))} disabled={busy} onChange={(sociability) => setValue({ ...value, sociability })} />
        </Field>
        <Issues issues={lintAt(lint, "routineSettings.sociability")} />
      </FormGroup>
      <FormGroup title="How plans bend routine">
        <p class="lre-minds-note">Which plans a character makes in the story may move their work or school.</p>
        <Choices label="How plans bend routine" value={value.planBend} options={ROUTINE_PLAN_BEND} names={PLAN_BEND_LABEL} disabled={busy} onChange={(planBend: RoutinePlanBend) => setValue({ ...value, planBend })} />
        <Issues issues={lintAt(lint, "routineSettings.planBend")} />
      </FormGroup>
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={() => save(value)}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
        <Button variant="ghost" disabled={busy || draft.doc.routineSettings === undefined} onClick={() => save(DEFAULT_ROUTINE_SETTINGS)}>
          Use the defaults
        </Button>
      </SaveBar>
    </div>
  );
}
