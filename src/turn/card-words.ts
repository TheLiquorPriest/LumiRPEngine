// What the turn's card says of a change in words, from the functions that already word them and never a second copy: the change as the GM view
// words it (`changeLine`, which the due list's changes use), a report in the words the engine's answers give it (the line named by its code, as the
// tools say it of an operation they recorded), and what an Undo would do in the play answers' words (`.prompts/play-answers.md`). The route
// gives the words beside the record, which the page keeps in a disclosed line for whoever is finding a fault.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { ANSWERS_PART } from "../iface/kit";
import { Lines } from "../iface/texts";
import { changeLine } from "../play/due";
import { answerWords } from "../play/service";
import type { JsonValue } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import type { Part, Report } from "../store";

/** The engine's answers as the guidance folder `guidance` holds them now (`.prompts/engine-answers.md`). */
export async function engineAnswers(guidance: string): Promise<Lines> {
  return Lines.parse(await readFile(join(guidance, ".prompts", `${ANSWERS_PART}.md`), "utf8"), `.prompts/${ANSWERS_PART}.md`);
}

/**
 * A change in words: as the GM view words it where it is an event of the world (with the names the world has at `state`); else, or where
 * that is bookkeeping only, the kind of change it is, in the play answers' words for kinds.
 */
export function changeWords(part: Part, registry: Registry, world: WorldDoc | undefined, state: WorldState | undefined, change: { op: string; value: JsonValue }): string {
  const line = world === undefined || state === undefined ? undefined : changeLine(registry, world, state, change.op, change.value);
  if (line !== undefined) return line;
  const kind = own(part.keys, change.op) ?? answerWords(part, "card_change_unknown");
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A report in words. One the engine's tools made while they recorded the change (its values hold the operation's number) is said as they said
 * it: the line its code names, else their general line for advice. Any other (the fold's own) is said by the play answers' lines for a
 * change that applied or one that did not.
 */
export function reportWords(engine: Lines, part: Part, applied: boolean, report: Report): string {
  const fields = report.values ?? {};
  if (typeof fields.n === "number") {
    const said = engine.line(report.code, fields) ?? engine.line("advised", fields);
    if (said !== undefined) return said;
  }
  return answerWords(part, applied ? "card_report_advised" : "card_report_refused", { code: report.code });
}

/** What an Undo of the change would do, in a sentence: it takes the change back, or it has nothing to take back (what stays follows, in the words of `leftLines`). */
export function undoWords(part: Part, ops: readonly string[]): string {
  return answerWords(part, ops.length === 0 ? "card_undo_none" : "card_undo_whole");
}
