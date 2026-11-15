// `bun scripts/proof/live/prefs.ts`: the golden copy's last row (PlanScenarios-3 item 8). Run once by the lead on the instance with today's build installed, before the golden copy is taken
// again: the driver's browser sets today's panels' preferences on the instance's classic chat and records their keys in the instance's record (`browser:prefs`), which the instance's report
// reads as its browser row. It needs the bed's host's environment (`scripts/proof/live/env.ts`) and changes nothing of Lumiverse.

import { resolve } from "node:path";
import { openHost } from "./host";

const host = await openHost({ root: resolve(import.meta.dir, ".."), run: "browser-preferences" });
try {
  const play = await host.begin({ form: { id: "browser-preferences", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: async () => undefined });
  try {
    for (const pref of await play.acts.panelPreferences()) console.log(`set ${pref.key}`);
  } finally {
    await play.close();
  }
} catch (error) {
  console.error(`prefs.ts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await host.close();
}
