// A turn on the classic or agents engine can stop on a question to the player before its reply: the
// player's words name a thing the world does not hold ("Harbor Watch logbook isn't in this world yet.
// Add it and hand it?"), and the turn waits for the answer (seen on the bed: "turn skipped: waiting
// for the player's answer"; RPE `main` `src/backend/runtime.ts:1489-1506`, the question from
// `src/backend/claims.ts:199`). A player answers it on the chip under the message and presses
// Regenerate, which runs the engine again with the read kept (runtime.ts:1490-1492). This player
// does the same while a reply is under way, answering each such question with Add, the same answer
// every run, so a run is the same each time.

import { Player } from "../play";
import { say } from "../record";
import type { HostEvent } from "../socket";

/** How often a reply under way is looked at for a question: as often as the player looks for the reply's end (`../play.ts`). */
const LOOK_MS = 4_000;

interface Chip {
  id: string;
  kind: string;
  label?: string;
  actions?: { id: string; label?: string }[];
}

function isChips(value: unknown): value is Chip[] {
  return Array.isArray(value) && value.every((c) => c !== null && typeof c === "object" && "id" in c && typeof c.id === "string");
}

export class ClaimingPlayer extends Player {
  private readonly answered = new Set<string>();

  private async answerClaims(chatId: string): Promise<void> {
    const chips = (await this.state(chatId)).view.chips;
    if (!isChips(chips)) return;
    for (const chip of chips) {
      if (!chip.id.startsWith("claim:") || this.answered.has(chip.id)) continue;
      const add = chip.actions?.find((a) => /^add/i.test(a.id) || /^add/i.test(a.label ?? ""));
      if (add === undefined) continue;
      this.answered.add(chip.id);
      await this.socket.lre("lre.chip", { chatId, chip: chip.id, choice: add.id });
      this.log.log({ step: "play", action: "changed", kind: "player claim answered Add (post entry)", id: chip.id, detail: { chatId, label: chip.label ?? null } });
      say(`  answered the question "${chip.label ?? chip.id}": ${add.id}; Regenerate`);
      await this.host.generate(chatId, "regenerate", this.connectionId);
    }
  }

  override async reply(chatId: string, start: () => Promise<unknown>, what: string): Promise<HostEvent> {
    let looking = true;
    const watcher = (async () => {
      while (looking) {
        await Bun.sleep(LOOK_MS);
        if (looking) await this.answerClaims(chatId).catch((error: unknown) => say(`  looking for a question failed: ${error instanceof Error ? error.message : String(error)}`));
      }
    })();
    try {
      return await super.reply(chatId, start, what);
    } finally {
      looking = false;
      await watcher;
    }
  }
}
