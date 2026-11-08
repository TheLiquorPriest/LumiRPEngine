// The bootstrap's chips on its depth chat (DEPTH-PLAN §7 Chips, §8): while a run is under way, the
// stage it's at and how far that stage has come; while spot-check items wait for my marks, how many.
// Both sit under the chat's last message with the way to GM → Depth → Bootstrap, and both are built
// from the run's own view, never stored: each goes the moment what it says stops being so.

import type { BootstrapStage, BootstrapView } from "../../shared/bootstrap";
import { BOOTSTRAP_STAGES } from "../../shared/bootstrap";
import type { ChatId, MessageId } from "../../shared/ids";
import type { Chip } from "../../shared/state-view";

/** What the chips read of a run's view: its status and progress, and how many spot-check items wait for a mark. */
export type BootstrapChipFacts = Pick<BootstrapView, "status" | "chunks" | "progress"> & { waiting: number };

/** Each stage as a chip's sentence names it. */
const STAGE_WORDS: Readonly<Record<BootstrapStage, string>> = {
  survey: "surveying the chat",
  import: "importing the chat's memory",
  historian: "reading canon beats",
  author: "the author's chapters",
  pov: "points of view",
  minds: "forming minds",
  truthlink: "linking truths",
  reconcile: "reconciling chapters",
};

/** The stage a run is at: the first, in the run's order, that isn't through. */
function stageAt(progress: BootstrapView["progress"]): BootstrapView["progress"][number] | null {
  for (const stage of BOOTSTRAP_STAGES) {
    const p = progress.find((x) => x.stage === stage);
    if (p && p.done < p.total) return p;
  }
  return null;
}

/** The chips' facts from a run's view: the spot-check items waiting for a mark counted over every card. */
export function chipFactsOf(view: Pick<BootstrapView, "status" | "chunks" | "progress" | "spot">): BootstrapChipFacts {
  return { status: view.status, chunks: view.chunks, progress: view.progress, waiting: view.spot.reduce((n, card) => n + card.items.filter((i) => i.mark === null).length, 0) };
}

/**
 * The bootstrap's chips under message `at`: "Bootstrap: reading canon beats, 12 of 40" while it runs
 * (or is finishing the calls under way after Pause), and "3 spot checks wait for you" while any item
 * waits, whatever the run's status. None once the run stops and every item is marked. `behind`: the
 * characters a scene cast before their time in the chat's LumiBooks book was read into their mind,
 * flagged (Settings → Depth → Bootstrap → When a character returns), by name.
 */
export function bootstrapChips(chatId: ChatId, facts: BootstrapChipFacts, at: MessageId, behind: readonly string[] = []): Chip[] {
  const chips: Chip[] = [];
  const open = { id: "open", label: "Open", input: { type: "bootstrap" as const, label: "GM → Depth → Bootstrap" } };
  if (facts.status === "running" || facts.status === "pausing") {
    const p = stageAt(facts.progress);
    const where = p ? `${STAGE_WORDS[p.stage]}, ${p.done} of ${p.total}` : "finishing";
    chips.push({
      id: `bootstrap:${chatId}`,
      kind: "bootstrap",
      messageId: at,
      label: `Bootstrap${facts.status === "pausing" ? " pausing" : ""}: ${where}`,
      detail: `${facts.chunks.done} of ${facts.chunks.total} chunks of the chat read through every stage.`,
      actions: [open],
      expires: "never",
    });
  }
  if (behind.length > 0) {
    chips.push({
      id: `not_caught_up:${chatId}`,
      kind: "bootstrap",
      messageId: at,
      label: `Not caught up: ${behind.join(", ")}`,
      detail: "Back in the story before their time in the LumiBooks book was read into their mind: played from their core and the archive. Catch them up from GM → Depth → Bootstrap's LumiBooks tree.",
      actions: [{ ...open, label: "Catch up" }],
      expires: "never",
    });
  }
  const waiting = facts.waiting;
  if (waiting > 0) {
    chips.push({
      id: `spot_checks:${chatId}`,
      kind: "spot_checks",
      messageId: at,
      label: `${waiting} spot check${waiting === 1 ? "" : "s"} ${waiting === 1 ? "waits" : "wait"} for you`,
      detail: "The bootstrap's spot-check cards hold what it read for you to mark right or wrong. A wrong mark is a directive it amends from.",
      actions: [{ ...open, id: "review", label: "Review", style: "primary" }],
      expires: "never",
    });
  }
  return chips;
}
