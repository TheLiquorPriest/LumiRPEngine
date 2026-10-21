// Inferred checks (DESIGN §11), one control for Build's Ruleset part, Settings → Checks and GM →
// This chat → Checks, so each reads the same: the mode, then which attempts, who rolls, the skills
// and difficulty bands they may roll with, what the narrator is told and the lines that follow a
// result, and the most rolls a turn makes. Under Off every other value keeps what it was, greyed
// out, so switching back on finds the policy as it was left.

import {
  bandsWithin,
  DEFAULT_GUIDANCE,
  DIFFICULTY_BANDS,
  INFER_DETAIL_LABEL,
  INFER_MODE_LABEL,
  INFER_MODES,
  INFER_OTHERS,
  INFER_OTHERS_LABEL,
  INFER_WHEN_LABEL,
  INFER_WHO_LABEL,
  INFERRED_BOUNDS,
  type DifficultyId,
  type InferredChecks,
  type InferredGuidance,
  type SheetSkill,
} from "../shared/inferred";
import { Choice } from "./adjudication-form";
import { Button, HostSwitch, NumberStepper, Seg } from "./components";

const MODES = INFER_MODES.map((value) => ({ value, label: INFER_MODE_LABEL[value] }));
const OTHERS = INFER_OTHERS.map((value) => ({ value, label: INFER_OTHERS_LABEL[value] }));

/** Each band with the DC it sets, easiest first (the select lists them in this order). */
const BAND_LABEL = DIFFICULTY_BANDS.reduce<Record<DifficultyId, string>>((out, b) => ({ ...out, [b.id]: `${b.label} (DC ${b.dc})` }), {} as Record<DifficultyId, string>);
const bandAt = (id: DifficultyId): number => DIFFICULTY_BANDS.findIndex((b) => b.id === id);

const MODE_HELP: Record<InferredChecks["mode"], string> = {
  off: "A typed attempt no action covers plays as roleplay, and the narrator decides how it goes. The values below are kept for when you turn it back on.",
  suggest: "A chip offers the roll; the attempt is rolled only when you take it.",
  auto: "The engine rolls it with the world's sheet, records it like any check, and tells the narrator how it went.",
};

/** The one line of guidance after a result: committed when you leave the box, as the other text settings are. Exported for the controls' tests to find. */
export function GuidanceLine(props: { label: string; value: string; disabled: boolean; onChange(value: string): void }) {
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <input class="lre-input" value={props.value} maxLength={INFERRED_BOUNDS.guidance} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  );
}

/**
 * The policy as edited. `skills` is the world's sheet's (an empty list where no world is known, as
 * in Settings with no world chat open); a picked skill the sheet doesn't have stays listed, so it
 * can be taken off. `skillsHelp` says where the list comes from.
 */
export function InferredForm(props: { value: InferredChecks; skills: readonly SheetSkill[]; skillsHelp: string; disabled?: boolean; onChange(next: InferredChecks): void }) {
  const p = props.value;
  const off = props.disabled === true || p.mode === "off";
  const set = (patch: Partial<InferredChecks>) => props.onChange({ ...p, ...patch });
  const guide = (patch: Partial<InferredGuidance>) => set({ guidance: { ...p.guidance, ...patch } });
  // A bound moved past the other carries it along, so the range is never empty.
  const lowest = (id: DifficultyId) => set({ difficulty: { lowest: id, highest: bandAt(id) > bandAt(p.difficulty.highest) ? id : p.difficulty.highest } });
  const highest = (id: DifficultyId) => set({ difficulty: { lowest: bandAt(id) < bandAt(p.difficulty.lowest) ? id : p.difficulty.lowest, highest: id } });
  const known = new Set(props.skills.map((s) => s.id));
  const listed: SheetSkill[] = [...props.skills, ...(p.skills ?? []).filter((id) => !known.has(id)).map((id) => ({ id, label: `${id} (not on this sheet)` }))];
  // Picked skills are kept in the sheet's order, so the same picks save the same list.
  const pick = (id: string, on: boolean) => {
    const picked = new Set(p.skills ?? []);
    if (on) picked.add(id);
    else picked.delete(id);
    set({ skills: listed.map((s) => s.id).filter((s) => picked.has(s)) });
  };
  const range = bandsWithin(p);
  const defaultGuidance = p.guidance.pass === DEFAULT_GUIDANCE.pass && p.guidance.fail === DEFAULT_GUIDANCE.fail;
  return (
    <div class="lre-stack" data-lre-inferred-form>
      <div class="lre-field">
        <span class="label">Read typed attempts as checks</span>
        <Seg<InferredChecks["mode"]> label="Read typed attempts as checks" value={p.mode} options={MODES} disabled={props.disabled} onChange={(mode) => set({ mode })} />
        <span class="lre-field-help">{MODE_HELP[p.mode]}</span>
      </div>
      <div class={p.mode === "off" ? "lre-stack lre-gm-dimmed" : "lre-stack"} data-lre-inferred-fields>
        <Choice label="Which attempts" help="Risky: only an attempt below the risky line of How checks are decided. Says it tries: only when the message says your character tries, attempts or wants to." value={p.when} labels={INFER_WHEN_LABEL} disabled={off} onChange={(when) => set({ when })} />
        <Choice label="Who rolls" help="Companions who join in each roll their own. Everyone involved: the people it opposes or targets roll against it too." value={p.who} labels={INFER_WHO_LABEL} disabled={off} onChange={(who) => set({ who })} />
        <div class="lre-field" data-lre-inferred-skills>
          <HostSwitch label="Every skill the sheet has" checked={p.skills === null} disabled={off || (p.skills === null && props.skills.length === 0)} onChange={(all) => set({ skills: all ? null : props.skills.map((s) => s.id) })} />
          {p.skills !== null ? (
            listed.length > 0 ? (
              listed.map((s) => <HostSwitch key={s.id} label={s.label} checked={p.skills?.includes(s.id) === true} disabled={off} onChange={(on) => pick(s.id, on)} />)
            ) : (
              <span class="lre-field-help">No skills picked: no attempt is read as a check.</span>
            )
          ) : null}
          <span class="lre-field-help">{props.skillsHelp}</span>
        </div>
        <Choice label="Easiest difficulty" help="The difficulty is read from the attempt and its scene, within these bands; one outside them is moved to the nearest." value={p.difficulty.lowest} labels={BAND_LABEL} disabled={off} onChange={lowest} />
        <Choice label="Hardest difficulty" help={`${range.length} band${range.length === 1 ? "" : "s"}: ${range.map((b) => b.label).join(", ")}.`} value={p.difficulty.highest} labels={BAND_LABEL} disabled={off} onChange={highest} />
        <Choice label="What the narrator is told" help="The result: passed or failed. The margin: by how much. The whole roll: the dice, the modifier and the total." value={p.detail} labels={INFER_DETAIL_LABEL} disabled={off} onChange={(detail) => set({ detail })} />
        <div class="lre-field">
          <span class="label">Others' numbers</span>
          <Seg<InferredChecks["others"]> label="Others' numbers" value={p.others} options={OTHERS} disabled={off} onChange={(others) => set({ others })} />
          <span class="lre-field-help">Whether an opponent's or a companion's dice, modifier, total or score reach the narrator and the roll chip. Hidden keeps a hidden stat hidden.</span>
        </div>
        <GuidanceLine label="After a success, tell the narrator" value={p.guidance.pass} disabled={off} onChange={(pass) => guide({ pass })} />
        <GuidanceLine label="After a failure, tell the narrator" value={p.guidance.fail} disabled={off} onChange={(fail) => guide({ fail })} />
        <div class="lre-field">
          <span class="lre-field-help">
            {`Up to ${INFERRED_BOUNDS.guidance} characters; a line left empty is the default's. {who} is who rolled, {skill} the skill, {attempt} what they tried, and {against} who or what it was against.`}
          </span>
          <div class="lre-inline">
            <Button size="sm" variant="ghost" disabled={off || defaultGuidance} onClick={() => set({ guidance: { ...DEFAULT_GUIDANCE } })}>
              Reset the lines
            </Button>
          </div>
        </div>
        <div class="lre-field">
          <NumberStepper label="Most rolls a turn" value={p.most} min={INFERRED_BOUNDS.most[0]} max={INFERRED_BOUNDS.most[1]} step={1} integer disabled={off} onChange={(most) => set({ most })} />
          <span class="lre-field-help">Your character's roll first, then companions', then opponents'. Past it, an opponent sets the difficulty without a roll.</span>
        </div>
      </div>
    </div>
  );
}
