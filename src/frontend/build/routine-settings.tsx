// Build → World → Routines and the story (DESIGN §8): what everyone's routine is to the engine
// (Informative, Enforced or Off), whether a Timelapse from the Actions sheet follows the player's
// routine unless asked otherwise, how aware of the story and its lore enforced routines are (Story
// first, Balanced, Routine first), whom routine blocks may invite, how social people are, and which
// story plans may move their work or school. RPE has no ladder of how closely a character is
// followed, so every character counts as Background: only that level's role and skip life are
// drawn, and the other levels, the plan-a-skip choice and the routine context given to the narrator of the
// previous build are kept in the file and named once at the foot (`KeptUnused`). Saved whole as `lre.editor set part
// routineSettings`; the defaults remove it, so a world left as it was keeps no settings. Whatever is
// picked, the story leads for anyone on screen: no setting lets a routine move someone out of a
// scene with the player's character, contradict the narration or interrupt play. Routines' own list
// links here. Styles: the choice cards of styles/minds.ts, styles/forms.ts.

import { useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { LintIssue } from "../../shared/lint";
import { NEED_WORDS } from "../../shared/needs";
import type { RoutineAwareness, RoutineInvitations, RoutinePlanBend, RoutineRole, RoutineSettings, RoutineSociability, SkipLife } from "../../shared/routines";
import { AWARENESS_LABEL, DEFAULT_ROUTINE_SETTINGS, INVITATIONS_LABEL, PLAN_BEND_LABEL, ROUTINE_AWARENESS, ROUTINE_INVITATIONS, ROUTINE_PLAN_BEND, ROUTINE_ROLE_LABEL, ROUTINE_ROLES, ROUTINE_SOCIABILITY, routineSettingsOf, SKIP_LIFE_LABEL, SKIP_LIVES, SOCIABILITY_LABEL } from "../../shared/routines";
import { SKIP_NOTE } from "../../packs/castlife/ui/routines-ops";
import { useApp } from "../app";
import { Button, Field, HostSwitch, PageHeader, SaveBar, Seg, useBusy } from "../components";
import { Icon } from "../../ui/icons";
import type { Req } from "../requests";
import { useSelect } from "../../ui/store";
import { PART_INFO } from "./chrome";
import { draftSend } from "./draft";
import { FormGroup, Issues, KeptUnused } from "./form-kit";
import { useHeld } from "./held";
import { lintAt } from "./schema-form";

/** Each role in one plain line: what someone's routine and their own schedules are to the engine. */
export const ROLE_EXPLAINED: Record<RoutineRole, string> = {
  informative: "Their routine is only a hint of their usual day: the story and what has been planned decide what they do.",
  enforced: "Their routine and schedules run their day when the story doesn't, and never pull them out of a scene with you.",
  off: "Their routine isn't used at all, not even as a hint.",
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

/** Each sociability in one plain line, naming the needs it scales as every surface does (`NEED_WORDS`). */
export const SOCIABILITY_EXPLAINED: Record<RoutineSociability, string> = {
  reserved: `${NEED_WORDS.social.name} and ${NEED_WORDS.fun.name.toLowerCase()} needs grow half as fast.`,
  usual: `${NEED_WORDS.social.name} and ${NEED_WORDS.fun.name.toLowerCase()} needs grow as they usually do.`,
  outgoing: `${NEED_WORDS.social.name} and ${NEED_WORDS.fun.name.toLowerCase()} needs grow half again as fast.`,
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

/** What a routine is to everyone and how they spend a stretch of time that is run through; the previous build's other levels are left as the file has them. */
export function RoutineRoleSettings(props: { value: RoutineSettings; lint: readonly LintIssue[]; disabled: boolean; onChange(next: RoutineSettings): void }) {
  const { value, lint, disabled } = props;
  const role = value.roles.background;
  const skip = value.skips.background;
  return (
    <>
      <FormGroup title="What a routine is">
        <p class="lre-minds-note">Enforced is the default: routines and schedules run people's days. A chat can set it apart for one character.</p>
        <Field label="Everyone's routine" help={ROLE_EXPLAINED[role]}>
          <Seg<RoutineRole> label="Everyone's routine" value={role} options={ROUTINE_ROLES.map((r) => ({ value: r, label: ROUTINE_ROLE_LABEL[r] }))} disabled={disabled} onChange={(next) => props.onChange({ ...value, roles: { ...value.roles, background: next } })} />
        </Field>
        <p class="lre-minds-note">A world's schedules (weather, prices, bills, paydays, opening hours) and pay run whatever you pick.</p>
        <Issues issues={lintAt(lint, "routineSettings.roles")} />
      </FormGroup>
      <FormGroup title="When a stretch of time is run through">
        <p class="lre-minds-note">How people spend it while their routine is informative. An enforced routine is always lived through it, and an off one never. A chat can set it apart for one character.</p>
        <Field label="Everyone" help={role === "informative" ? SKIP_NOTE[skip] : `Their routine is ${ROUTINE_ROLE_LABEL[role].toLowerCase()} here, so this applies only to characters a chat makes informative.`}>
          <Seg<SkipLife> label="Everyone, when a stretch of time is run through" value={skip} options={SKIP_LIVES.filter((s) => s !== "model" || skip === "model").map((s) => ({ value: s, label: SKIP_LIFE_LABEL[s] }))} disabled={disabled} onChange={(next) => props.onChange({ ...value, skips: { ...value.skips, background: next } })} />
        </Field>
        <Issues issues={lintAt(lint, "routineSettings.skips")} />
      </FormGroup>
      <FormGroup title="Timelapse from the Actions sheet">
        <HostSwitch label="Follow my routine by default" checked={value.paletteFollowsRoutine} disabled={disabled} onChange={(paletteFollowsRoutine) => props.onChange({ ...value, paletteFollowsRoutine })} />
        <p class="lre-minds-note">Where the sheet's Follow my routine starts. On, your character goes about their usual day through a Timelapse; off, they stay where the story left them. Each Timelapse can change it.</p>
        <Issues issues={lintAt(lint, "routineSettings.paletteFollowsRoutine")} />
      </FormGroup>
    </>
  );
}

/** What the file holds of the previous build's settings that nothing RPE runs reads, by the key `KeptUnused` names; unset where the file holds the default. */
function keptRoutineSettings(raw: unknown): Record<string, unknown> {
  const file = isRecord(raw) ? raw : {};
  const away = DEFAULT_ROUTINE_SETTINGS;
  const levels = (key: "roles" | "skips"): boolean => {
    const set = isRecord(file[key]) ? file[key] : {};
    return (["live", "near", "far"] as const).some((level) => set[level] !== undefined && set[level] !== away[key][level]);
  };
  return {
    levels: levels("roles") || levels("skips") ? true : undefined,
    skipPlanCalls: file.skipPlanCalls !== away.skipPlanCalls ? file.skipPlanCalls : undefined,
    narrator: file.narrator !== away.narrator ? file.narrator : undefined,
  };
}

const KEPT_ROUTINE_SETTINGS = [
  { key: "levels", label: "What a routine is, and how a stretch of time is spent, for the levels of the previous build's closeness ladder above Background (Live, Near and Far)" },
  { key: "skipPlanCalls", label: "How a model plans a time skip: all in one call, or one call per person" },
  { key: "narrator", label: "Whether people's usual routines were put into what the narrator read" },
] as const;

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
      <Issues issues={lint.filter((issue) => !Object.keys(DEFAULT_ROUTINE_SETTINGS).some((key) => issue.path === `routineSettings.${key}` || issue.path.startsWith(`routineSettings.${key}.`)))} />
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
      <KeptUnused fields={KEPT_ROUTINE_SETTINGS} held={keptRoutineSettings(draft.doc.routineSettings)} />
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
