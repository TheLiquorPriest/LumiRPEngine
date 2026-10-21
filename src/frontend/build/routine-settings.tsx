// Build → World → Routines and the story (DESIGN §8): what someone's routine is to the engine at each
// level of closeness (Informative, Enforced or Off), whether the narrator hears the present characters'
// usual routines, whether a Timelapse from the Actions sheet follows the player's routine unless asked
// otherwise, how aware of the story and its lore enforced routines are (Story first, Balanced,
// Routine first), whom routine blocks may invite, how social people are, and which story plans may
// move their work or school. Saved whole as `lre.editor set part routineSettings`; the defaults remove
// it, so a world left as it was keeps no settings. Whatever is picked, the story leads for anyone on
// screen: no setting lets a routine move someone out of a scene with the player's character,
// contradict the narration or interrupt play. Routines' own list links here. Styles: the choice cards
// of styles/minds.ts, styles/forms.ts.

import { useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import type { Fidelity } from "../../shared/minds";
import { FIDELITIES } from "../../shared/minds";
import type { RoutineAwareness, RoutineInvitations, RoutinePlanBend, RoutineRole, RoutineSettings, RoutineSociability, SkipLife } from "../../shared/routines";
import { AWARENESS_LABEL, DEFAULT_ROUTINE_SETTINGS, INVITATIONS_LABEL, PLAN_BEND_LABEL, ROUTINE_AWARENESS, ROUTINE_INVITATIONS, ROUTINE_PLAN_BEND, ROUTINE_ROLE_LABEL, ROUTINE_ROLES, ROUTINE_SOCIABILITY, routineSettingsOf, SKIP_LIFE_LABEL, SKIP_LIVES, SOCIABILITY_LABEL } from "../../shared/routines";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";
import { SKIP_NOTE } from "../../packs/castlife/ui/routines-ops";
import { useApp } from "../app";
import { Button, Field, HostSwitch, PageHeader, SaveBar, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import type { Req } from "../requests";
import { useSelect } from "../store";
import { PART_INFO } from "./chrome";
import { draftSend } from "./draft";
import { FormGroup, Issues } from "./form-kit";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";

/** Each role in one plain line: what someone's routine and their own schedules are to the engine. */
export const ROLE_EXPLAINED: Record<RoutineRole, string> = {
  informative: "The story and planning decide what they do; their routine is only context their mind and the narrator may weigh.",
  enforced: "Their routine and schedules run their day when the story doesn't, and never pull them out of a scene with you.",
  off: "Their routine isn't used at all, not even as context.",
};

/** Each level of closeness as this page names it: who the level is, in a few words. */
const LEVEL_NAME: Record<Fidelity, string> = {
  live: `${FIDELITY_LABEL.live}: in the scene with you`,
  near: `${FIDELITY_LABEL.near}: close to the story`,
  far: `${FIDELITY_LABEL.far}: off screen, still followed`,
  background: `${FIDELITY_LABEL.background}: everyone else`,
};

/** Each awareness in one plain line; it shapes only the days of those whose routine is enforced. */
export const AWARENESS_EXPLAINED: Record<RoutineAwareness, string> = {
  story_first: "Enforced routines bend for the story's plans and the GM's, and what the story sets holds until it's released.",
  balanced: "Background characters keep their enforced routine, others bend it for the story's plans, and what the story sets holds for the rest of that day.",
  routine_first: "Enforced routines hold, bending only as the plans setting below allows, and what the story sets holds until their next block.",
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

/** The settings this page saves with the rest that say what a routine is to the engine: each level's role, the narrator's context and the Timelapse default. */
export function RoutineRoleSettings(props: { value: RoutineSettings; lint: readonly LintIssue[]; disabled: boolean; onChange(next: RoutineSettings): void }) {
  const { value, lint, disabled } = props;
  return (
    <>
      <FormGroup title="What a routine is, by closeness">
        <p class="lre-minds-note">For each level of closeness on the minds ladder. Informative is the default for everyone but Background: routines and schedules tell, they don't dictate.</p>
        {FIDELITIES.map((level) => (
          <Field key={level} label={LEVEL_NAME[level]} help={ROLE_EXPLAINED[value.roles[level]]}>
            <Seg<RoutineRole> label={`${FIDELITY_LABEL[level]} characters' routine`} value={value.roles[level]} options={ROUTINE_ROLES.map((r) => ({ value: r, label: ROUTINE_ROLE_LABEL[r] }))} disabled={disabled} onChange={(role) => props.onChange({ ...value, roles: { ...value.roles, [level]: role } })} />
          </Field>
        ))}
        <p class="lre-minds-note">The GM can set it apart for one character in a chat. A world's schedules (weather, prices, bills, paydays, opening hours) and pay run whatever you pick.</p>
        <Issues issues={lintAt(lint, "routineSettings.roles")} />
      </FormGroup>
      <FormGroup title="In a time skip">
        <p class="lre-minds-note">How each level spends a time skip while their routine is informative. An enforced routine is always lived through a skip, and an off one never.</p>
        {FIDELITIES.map((level) => (
          <Field key={level} label={LEVEL_NAME[level]} help={value.roles[level] === "informative" ? SKIP_NOTE[value.skips[level]] : `Their routine is ${ROUTINE_ROLE_LABEL[value.roles[level]].toLowerCase()} here, so this applies only to characters the GM makes informative.`}>
            <Seg<SkipLife> label={`${FIDELITY_LABEL[level]} characters in a time skip`} value={value.skips[level]} options={SKIP_LIVES.map((s) => ({ value: s, label: SKIP_LIFE_LABEL[s] }))} disabled={disabled} onChange={(skip) => props.onChange({ ...value, skips: { ...value.skips, [level]: skip } })} />
          </Field>
        ))}
        <p class="lre-minds-note">The GM can set it apart for one character in a chat. Planned by the model makes one helper call at the skip's start for everyone it plans.</p>
        <Issues issues={lintAt(lint, "routineSettings.skips")} />
      </FormGroup>
      <FormGroup title="The narrator">
        <HostSwitch label="Tell the narrator people's usual routines" checked={value.narrator} disabled={disabled} onChange={(narrator) => props.onChange({ ...value, narrator })} />
        <p class="lre-minds-note">For the characters in the scene whose routine isn't off: what they usually do, as context the narrator may use, never what they must do.</p>
        <Issues issues={lintAt(lint, "routineSettings.narrator")} />
      </FormGroup>
      <FormGroup title="Timelapse from the Actions sheet">
        <HostSwitch label="Follow my routine by default" checked={value.paletteFollowsRoutine} disabled={disabled} onChange={(paletteFollowsRoutine) => props.onChange({ ...value, paletteFollowsRoutine })} />
        <p class="lre-minds-note">Where the sheet's Follow my routine starts. On, your character goes about their usual day through a Timelapse; off, they stay where the story left them. Each Timelapse can change it.</p>
        <Issues issues={lintAt(lint, "routineSettings.paletteFollowsRoutine")} />
      </FormGroup>
    </>
  );
}

/** Build → World → Routines and the story: every setting, saved together from the sticky bar. */
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
        Whatever you pick, the story comes first for anyone in a scene with the player's character: a routine never moves them out of it, contradicts what's been told or interrupts play. These settings tune what routines are to the engine, and how far everyone else's days follow the story and its lore.
      </p>
      <Issues issues={lint.filter((issue) => !["awareness", "invitations", "sociability", "planBend", "roles", "skips", "narrator", "paletteFollowsRoutine"].some((key) => issue.path === `routineSettings.${key}` || issue.path.startsWith(`routineSettings.${key}.`)))} />
      <RoutineRoleSettings value={value} lint={lint} disabled={busy} onChange={setValue} />
      <FormGroup title="Story and lore awareness">
        <p class="lre-minds-note">How strictly an enforced routine keeps to itself against what the story and its lore establish.</p>
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
