// The words an inferred check is told in (DESIGN §11): the Outcome line, as detailed as the chat's
// policy says and ending with its Narrate line; the receipt's roll chip, the player's own roll as any
// check shows it; and the question a suggestion chip asks. Someone else's numbers (an opponent's roll
// or score, the difficulty it set, and the odds, margin and DC that would give it away; a companion's
// dice and modifier) appear in none of them unless the policy shows others' numbers.

import type { EntityId } from "../shared/ids";
import type { InferredResult, InferredVerdict } from "../engine/inferred";
import type { Resolution } from "../engine/resolve";

/** Names as a sentence lists them: "Ana", "Ana and Ben", "Ana, Ben and Cal". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** A modifier as a roll shows it: " + 5", " − 2", or nothing for 0. */
function signed(n: number): string {
  return n === 0 ? "" : ` ${n > 0 ? "+" : "−"} ${Math.abs(n)}`;
}

/** Whether an opponent set the difficulty and their numbers stay hidden: then neither the DC, nor the odds or margin that would tell it, is said. */
function hiddenDc(info: InferredResult): boolean {
  return info.against.length > 0 && info.others === "hidden";
}

/** The POV's own numbers: the dice as rolled, their modifier and total without the difficulty folded in, and what they were read against. */
function ownRoll(res: Resolution, info: InferredResult): { notation: string; modifier: number; total: number; dc: number } | null {
  const c = res.check;
  if (!c) return null;
  const modifier = c.modifier - info.share;
  return { notation: c.roll.notation, modifier, total: c.roll.total + modifier, dc: c.dc ?? info.dc };
}

/** The people it opposes, with their numbers when the policy shows them. */
function againstWords(info: InferredResult): string {
  if (info.against.length === 0) return ` (${info.band.label.toLowerCase()})`;
  const named = info.against.map((a) => (info.others === "shown" ? `${a.name} (${a.rolled ? `rolled ${a.score}` : `${a.score} without a roll`})` : a.name));
  return ` against ${listed(named)}`;
}

/** How the POV's attempt went, as detailed as the policy says. */
function ownResult(res: Resolution, info: InferredResult, passed: boolean): string {
  const a = res.adjudged;
  const outcome = res.outcome ?? "";
  const roll = ownRoll(res, info);
  if (roll) {
    const hidden = hiddenDc(info);
    const close = a?.close ? (passed !== a.pass.includes(a.close.outcome) ? ", only just" : `, close to ${a.close.outcome}`) : "";
    const margin = roll.total - roll.dc;
    const detail = info.detail === "roll" ? ` (rolled ${roll.total} on ${roll.notation}${signed(roll.modifier)}${hidden ? "" : ` against ${roll.dc}`})` : info.detail === "margin" && !hidden ? ` by ${Math.abs(margin)}` : "";
    return `${outcome}${detail}${close}`;
  }
  switch (a?.why) {
    case "impossible":
      return `${outcome} (too hard to pull off, so no roll)`;
    case "retry":
      return `${outcome} again (nothing has changed since the last try, so no roll)`;
    case "story":
      return `${outcome}, as the story decides from the player's approach (no roll)`;
    default:
      return `${outcome} (no roll needed)`;
  }
}

/** A companion's result: the outcome, and their numbers only when the policy shows others'. */
function companionResult(c: InferredResult["companions"][number], info: InferredResult): string {
  if (info.others !== "shown") return c.outcome;
  const margin = c.total - info.dc;
  if (info.detail === "roll") return `${c.outcome} (rolled ${c.total} on ${c.notation}${signed(c.modifier)} against ${info.dc})`;
  return info.detail === "margin" ? `${c.outcome} by ${Math.abs(margin)}` : c.outcome;
}

/** A guidance line with its placeholders read as the check's. */
function guided(line: string, info: InferredResult): string {
  const fill: Record<string, string> = { who: info.pov, skill: info.label.replace(/ check$/, ""), attempt: info.attempt, against: listed(info.against.map((a) => a.name)) };
  return line.replace(/\{(who|skill|attempt|against)\}/g, (_, key: string) => fill[key] ?? "");
}

/**
 * The Outcome slot's line for an inferred check (DESIGN §6.2, §11): the skill, what was attempted in
 * the player's words, who rolled and against whom, each roller's result as detailed as the policy
 * says (a close call or a check nothing rolled worded as for any check), then the policy's guidance
 * line for the POV's result: "Persuasion check for "talk my way in", Jordan against the bouncer:
 * success. Narrate it succeeding."
 */
export function inferredOutcome(res: Resolution, info: InferredResult): string {
  const passed = info.pass.includes(res.outcome ?? "");
  const who = info.companions.length > 0 ? `${info.pov} with ${listed(info.companions.map((c) => c.name))}` : info.pov;
  const head = `${info.label}${info.attempt !== "" ? ` for "${info.attempt}"` : ""}, ${who}${againstWords(info)}`;
  const own = ownResult(res, info, passed);
  const results = info.companions.length > 0 ? [`${info.pov} ${own}`, ...info.companions.map((c) => `${c.name} ${companionResult(c, info)}`)].join("; ") : own;
  const line = guided(passed ? info.guidance.pass : info.guidance.fail, info);
  const close = res.adjudged?.close ? `; it may ${passed ? "come at a cost" : "leave partial progress"}` : "";
  const narrate = close !== "" ? `${line.replace(/[.!\s]+$/, "")}${close}.` : line;
  return `${head}: ${results}. ${narrate}${info.companions.length > 0 ? " Narrate the others as their rolls fell." : ""}`;
}

/** Why the policy rolled nothing, as the receipt says it; the chance only when it gives no one's number away. */
function noRollWhy(res: Resolution, info: InferredResult): string {
  const a = res.adjudged;
  const chance = a?.chance == null || hiddenDc(info) ? "" : ` (${Math.round(a.chance * 100)}% to succeed)`;
  switch (a?.why) {
    case "trivial":
      return `a sure thing${chance}`;
    case "impossible":
      return `too hard to try${chance}`;
    case "safe":
      return `only risky checks roll${chance}`;
    case "unmarked":
      return "checks roll only for marked actions, places and quests";
    case "never":
      return "this chat doesn't roll checks";
    case "story":
      return `the story decides, judged from your approach${chance}`;
    case "retry":
      return a?.retry === "once" ? "you already failed this here; it takes a new scene" : "you already failed this; it takes a change (time, another way, or better odds)";
    default:
      return "the policy settled it";
  }
}

/**
 * The receipt's roll chip for an inferred check (DESIGN §11, §12): the player's own roll as any
 * check shows it (the dice, their modifier, the total, and the DC and exact odds unless an
 * opponent's hidden number set them), or why nothing was rolled; the judged approach and a close
 * call; then each companion's result, and the opponents' numbers when the policy shows them.
 */
export function inferredChip(res: Resolution, info: InferredResult): { label: string; detail: string } {
  const a = res.adjudged;
  const c = res.check;
  const roll = ownRoll(res, info);
  const hidden = hiddenDc(info);
  const approach = a?.approach ? ` Your approach: ${a.approach.rating} of ${a.approach.max}${a.approach.reason ? ` (${a.approach.reason})` : ""}.` : "";
  let own: string;
  if (c && roll) {
    const natural = c.natural !== null && (c.check.bands ?? []).some((b) => b.natural) ? ` (natural ${c.natural})` : "";
    const against = hidden ? ` against ${listed(info.against.map((x) => x.name))}` : ` against ${roll.dc}`;
    const odds = hidden ? "" : ` Odds: ${Object.entries(c.odds).map(([band, p]) => `${band} ${Math.round(p * 100)}%`).join(" · ")}.`;
    const close = a?.close ? (hidden ? " Close: it nearly went the other way." : ` Close: ${Math.abs(a.close.points)} ${Math.abs(a.close.points) === 1 ? "point" : "points"} ${a.close.points < 0 ? "lower" : "higher"} would have been ${a.close.outcome}.`) : "";
    const undecided = a?.authority === "narrative" ? " Nothing judged your approach, so the dice decided." : "";
    own = `Rolled ${roll.notation}${signed(roll.modifier)} = ${roll.total}${natural}${against}.${odds}${approach}${close}${undecided}`;
  } else own = `No roll: ${noRollWhy(res, info)}.${approach}`;
  const companions = info.companions.map((x) => ` ${x.name}: ${x.outcome}${info.others === "shown" ? ` (rolled ${x.total} on ${x.notation}${signed(x.modifier)})` : ""}.`).join("");
  const opponents = info.others === "shown" ? info.against.map((x) => ` ${x.name} ${x.rolled ? `rolled ${x.score}` : `set it at ${x.score} without a roll`}.`).join("") : "";
  return { label: `${info.label}: ${res.outcome ?? ""}`, detail: `${own}${companions}${opponents}` };
}

/** What a suggestion chip asks before an inferred check rolls (DESIGN §11): "Roll Persuasion?", with what it is about and how hard it looks. */
export function checkQuestion(verdict: Extract<InferredVerdict, { ok: true }>, nameOf: (id: EntityId) => string): { question: string; detail: string } {
  const { skill, band, read } = verdict;
  const against = read.against.length > 0 ? ` against ${listed(read.against.map((a) => nameOf(a.who)))}` : "";
  const joined = read.with.length > 0 ? ` with ${listed(read.with.map(nameOf))}` : "";
  const what = read.attempt !== "" ? `, to "${read.attempt}"` : "";
  return { question: `Roll ${skill.label}?`, detail: `${skill.label}${joined}${against}, looking ${band.label.toLowerCase()}${what}. Roll plays your message with the roll; No roll plays it as written.` };
}
