// G0's gate played by the proof runner itself over a recorded run: the floor's own replay (a recorded run's
// turns, a host made up for the acts and a browser that reads pages as text; `../floor/replay.ts`) with the
// gate G0's own (`scripts/proof/g0/gate.ts`) and a form that is G0's own play over the replay. The two counts
// of row 0.2 G0 reads are given by the test; what the runner wrote, and what the play printed the moment it
// found something, are read back.

import type { Play } from "../../../scripts/proof/route/form";
import { playG0With, type G0Deps } from "../../../scripts/proof/g0/run";
import type { FormsReading } from "../../../scripts/proof/g0/forms";
import { playReplay, replaying, type Played, type Replay, type ReplayGate } from "../floor/replay";
import { keepsTags } from "./recorded";

/** The gate G0 plays as, with its play over the current replay. */
export const G0_REPLAY: ReplayGate = { id: "G0", gate: "scripts/proof/g0/gate.ts", form: { module: "test/proof/g0/replay.ts", name: "replayedG0" } };

let setup: G0Deps | null = null;

/** The form the replayed G0 plays: G0's own play over the current replay. */
export async function replayedG0(play: Play): Promise<void> {
  const now = replaying();
  if (setup === null) throw new Error("no G0 replay is set");
  await playG0With(play, now.acts, now.reader, null, null, setup);
}

/** What a test gives a G0 replay besides the recorded run: the counts G0 reads, the shipped definition's effort (null: not read), and the label of a variant. */
export interface G0Replay extends Replay {
  forms?: FormsReading;
  shipped?: string | null;
  variant?: string | null;
}

/** What the runner made of a replayed G0, and what the play printed. */
export interface G0Played extends Played {
  printed: string[];
}

/** Plays G0 through the runner's own `main` over a recorded run; `scratch` names a folder to leave the bundle in (for the caller to remove). */
export async function playG0Replay(replay: G0Replay, scratch?: string): Promise<G0Played> {
  const printed: string[] = [];
  setup = { forms: () => replay.forms ?? keepsTags(), shipped: replay.shipped === undefined ? "high" : replay.shipped, variant: replay.variant ?? null, out: (text) => printed.push(text) };
  try {
    return { ...(await playReplay(replay, G0_REPLAY, scratch)), printed };
  } finally {
    setup = null;
  }
}
