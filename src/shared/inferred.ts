// Inferred checks (DESIGN §11): a typed attempt whose outcome is uncertain, that no catalog action
// with its own check covers, read by `interpret` as a check of the world's sheet (the built-in Try
// something), and how it plays: rolled, offered on a chip, or not read at all; for which attempts;
// who rolls; with which skills and how hard; what the narrator is told; and how many rolls a turn
// makes. Layered like the adjudication policy: the world ruleset's default, then the user's
// Settings → Checks for new chats, then the chat's own `infer` marker (GM → This chat → Checks). A
// chat nobody set one for, or one older than the policy, plays by its realism preset and Sheets level.

import { isRecord } from "./json";
import type { Level, RealismPresetId } from "./ids";

/** Off reads no attempt as a check; suggest offers the roll on a chip first; auto rolls it. */
export type InferMode = "off" | "suggest" | "auto";
/** Which attempts are read as checks: every uncertain one, only a risky one (below the adjudication policy's `riskyAt`), or only one the message says the player character tries. */
export type InferWhen = "uncertain" | "risky" | "tries";
/** Who rolls: the player character only; companions who join in too, each their own; or everyone involved, the people it opposes rolling against it. */
export type InferWho = "pov" | "companions" | "everyone";
/** How much the narrator is told of each roll: the result, the result and its margin, or the whole roll. */
export type InferDetail = "result" | "margin" | "roll";
/** Whether others' numbers (an opponent's or a companion's dice, modifier, total or score) reach the narrator and the receipt. */
export type InferOthers = "hidden" | "shown";
/** A difficulty band: the words a sheet's `difficulty_of` reads, easiest first. */
export type DifficultyId = "trivial" | "easy" | "moderate" | "tricky" | "hard" | "very_hard" | "heroic" | "nearly_impossible";

export const INFER_MODES: readonly InferMode[] = ["off", "suggest", "auto"];
export const INFER_WHENS: readonly InferWhen[] = ["uncertain", "risky", "tries"];
export const INFER_WHOS: readonly InferWho[] = ["pov", "companions", "everyone"];
export const INFER_DETAILS: readonly InferDetail[] = ["result", "margin", "roll"];
export const INFER_OTHERS: readonly InferOthers[] = ["hidden", "shown"];

export const INFER_MODE_LABEL: Readonly<Record<InferMode, string>> = { off: "Off", suggest: "Suggest a roll", auto: "Roll automatically" };
export const INFER_WHEN_LABEL: Readonly<Record<InferWhen, string>> = { uncertain: "Every uncertain attempt", risky: "Only risky attempts", tries: "Only when the message says it tries" };
export const INFER_WHO_LABEL: Readonly<Record<InferWho, string>> = { pov: "The player character only", companions: "With companions", everyone: "Everyone involved" };
export const INFER_DETAIL_LABEL: Readonly<Record<InferDetail, string>> = { result: "The result", margin: "The result and margin", roll: "The whole roll" };
export const INFER_OTHERS_LABEL: Readonly<Record<InferOthers, string>> = { hidden: "Hidden", shown: "Shown" };

export interface DifficultyBand {
  id: DifficultyId;
  label: string;
  /** The DC it sets: what `difficulty_of` reads its word as. */
  dc: number;
}

/** The world's difficulty bands, easiest first: every shipped sheet reads a check's difficulty through `difficulty_of`, which takes these words. */
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = [
  { id: "trivial", label: "Trivial", dc: 5 },
  { id: "easy", label: "Easy", dc: 8 },
  { id: "moderate", label: "Moderate", dc: 10 },
  { id: "tricky", label: "Tricky", dc: 12 },
  { id: "hard", label: "Hard", dc: 15 },
  { id: "very_hard", label: "Very hard", dc: 20 },
  { id: "heroic", label: "Heroic", dc: 25 },
  { id: "nearly_impossible", label: "Nearly impossible", dc: 30 },
];

/** What the narrator is told to do with a result, after it: `{who}`, `{skill}`, `{attempt}` and `{against}` read as the check's. */
export interface InferredGuidance {
  pass: string;
  fail: string;
}

export interface InferredChecks {
  mode: InferMode;
  when: InferWhen;
  who: InferWho;
  /** The skills a check may be inferred for, by the sheet's ids (a skill table's rows, or the Sheets pack's stats); null: every one the world's sheet has. */
  skills: string[] | null;
  /** The bands `interpret` may read a difficulty from, easiest and hardest; one outside them is clamped into them. */
  difficulty: { lowest: DifficultyId; highest: DifficultyId };
  detail: InferDetail;
  others: InferOthers;
  guidance: InferredGuidance;
  /** The most rolls one turn's inferred check makes: the player character's, then companions', then opponents' (one past it sets the difficulty without a roll). */
  most: number;
}

/** A skill the world's sheet has, as the Checks screens list it. */
export interface SheetSkill {
  id: string;
  label: string;
}

/** The ranges the open values are kept in: rolls a turn, a guidance line's length, and how many skills a list names. */
export const INFERRED_BOUNDS = {
  most: [1, 12],
  guidance: 240,
  skills: 64,
  skillId: 64,
} as const;

export const DEFAULT_GUIDANCE: Readonly<InferredGuidance> = { pass: "Narrate it succeeding.", fail: "Narrate it failing." };

/**
 * What each realism preset plays inferred checks by. Story keeps the story the player's: it only
 * offers a roll, and only for an attempt the message says it tries, the player character alone.
 * Grounded rolls risky attempts on its own, with companions each rolling theirs, and tells the
 * narrator the result. Simulation rolls every uncertain attempt for everyone involved, the people
 * it opposes rolling against it, and tells the narrator the margin too. Others' numbers stay hidden
 * in all three: a hidden stat is the world's to keep.
 */
export const INFERRED_PRESETS: Readonly<Record<Exclude<RealismPresetId, "custom">, Readonly<InferredChecks>>> = {
  story: { mode: "suggest", when: "tries", who: "pov", skills: null, difficulty: { lowest: "easy", highest: "hard" }, detail: "result", others: "hidden", guidance: { ...DEFAULT_GUIDANCE }, most: 1 },
  grounded: { mode: "auto", when: "risky", who: "companions", skills: null, difficulty: { lowest: "easy", highest: "very_hard" }, detail: "result", others: "hidden", guidance: { ...DEFAULT_GUIDANCE }, most: 3 },
  simulation: { mode: "auto", when: "uncertain", who: "everyone", skills: null, difficulty: { lowest: "easy", highest: "heroic" }, detail: "margin", others: "hidden", guidance: { ...DEFAULT_GUIDANCE }, most: 6 },
};

/**
 * The policy a chat plays by when nothing set one: its realism preset's (Custom takes the preset its
 * Sheets level matches: 1 Story, 2 Grounded, 3 and up Simulation), at its Sheets level. At Sheets 0
 * there is no sheet to roll with, so it is off; at Sheets 1 stats are words only, so the narrator is
 * told the result alone; at Sheets 2, at most the margin.
 */
export function inferredDefaults(preset: RealismPresetId, sheets: Level): InferredChecks {
  const named = preset !== "custom" ? preset : sheets <= 1 ? "story" : sheets === 2 ? "grounded" : "simulation";
  const out = structuredClone(INFERRED_PRESETS[named]) as InferredChecks;
  if (sheets === 0) out.mode = "off";
  if (sheets <= 1) out.detail = "result";
  else if (sheets === 2 && out.detail === "roll") out.detail = "margin";
  return out;
}

function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return values.find((x) => x === v) ?? fallback;
}

/** A guidance line as kept: trimmed and within its length; one left empty is the default's. */
function line(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s === "" ? fallback : s.slice(0, INFERRED_BOUNDS.guidance);
}

/** A skills list as kept: null for every skill; else each id once, trimmed, within the bounds. */
function skillList(v: unknown, fallback: string[] | null): string[] | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return fallback;
  const ids = v.flatMap((s) => (typeof s === "string" && s.trim() !== "" && s.trim().length <= INFERRED_BOUNDS.skillId ? [s.trim()] : []));
  return [...new Set(ids)].slice(0, INFERRED_BOUNDS.skills);
}

const bandAt = (id: DifficultyId): number => DIFFICULTY_BANDS.findIndex((b) => b.id === id);

/**
 * A policy from outside data (a world document, settings, a marker), or null when it isn't one: it
 * must name its mode. Every other value it can't hold takes Grounded's, the middle ground for
 * whatever mode it names; a number is clamped into its range, and difficulty bounds given the
 * wrong way round are swapped.
 */
export function readInferred(raw: unknown): InferredChecks | null {
  if (!isRecord(raw)) return null;
  const mode = INFER_MODES.find((m) => m === raw.mode);
  if (!mode) return null;
  const base = INFERRED_PRESETS.grounded;
  const d = isRecord(raw.difficulty) ? raw.difficulty : {};
  const ids = DIFFICULTY_BANDS.map((b) => b.id);
  const a = oneOf(d.lowest, ids, base.difficulty.lowest);
  const b = oneOf(d.highest, ids, base.difficulty.highest);
  const g = isRecord(raw.guidance) ? raw.guidance : {};
  const [lo, hi] = INFERRED_BOUNDS.most;
  return {
    mode,
    when: oneOf(raw.when, INFER_WHENS, base.when),
    who: oneOf(raw.who, INFER_WHOS, base.who),
    skills: skillList(raw.skills, base.skills),
    difficulty: bandAt(a) <= bandAt(b) ? { lowest: a, highest: b } : { lowest: b, highest: a },
    detail: oneOf(raw.detail, INFER_DETAILS, base.detail),
    others: oneOf(raw.others, INFER_OTHERS, base.others),
    guidance: { pass: line(g.pass, DEFAULT_GUIDANCE.pass), fail: line(g.fail, DEFAULT_GUIDANCE.fail) },
    most: typeof raw.most === "number" && Number.isFinite(raw.most) ? Math.min(hi, Math.max(lo, Math.round(raw.most))) : base.most,
  };
}

/** The bands a policy lets `interpret` read a difficulty from, easiest first. */
export function bandsWithin(policy: Pick<InferredChecks, "difficulty">): DifficultyBand[] {
  return DIFFICULTY_BANDS.slice(bandAt(policy.difficulty.lowest), bandAt(policy.difficulty.highest) + 1);
}

/**
 * The band a read names, clamped into the policy's: a band's id or label in any case, else a number
 * as the hardest band whose DC it reaches; anything else reads as moderate, then is clamped.
 */
export function clampBand(policy: Pick<InferredChecks, "difficulty">, said: unknown): DifficultyBand {
  const text = typeof said === "string" ? said.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const n = typeof said === "number" ? said : text !== "" && Number.isFinite(Number(text)) ? Number(text) : null;
  const named = n !== null ? DIFFICULTY_BANDS.findLastIndex((b) => b.dc <= n) : DIFFICULTY_BANDS.findIndex((b) => b.id === text);
  const index = Math.min(bandAt(policy.difficulty.highest), Math.max(bandAt(policy.difficulty.lowest), n !== null ? Math.max(0, named) : named < 0 ? bandAt("moderate") : named));
  return DIFFICULTY_BANDS[index] ?? { id: "moderate", label: "Moderate", dc: 10 };
}
