// The golden copy's last row and every restore of it (PlanScenarios-3 item 8; plan §15.2; `scripts/testbed/golden.sh`, `scripts/testbed/lib/instance/readback.ts`).
//
// The row: the browser preferences of §15.2 are kept in a browser's own storage, which no read of today's build reaches, so this driver's browser sets the keys today's
// panels keep and records them in the instance's own record under `browser:prefs` (`{key, value}[]`), where the instance's report reads them as the row. The golden copy is then
// taken again (`golden.sh take`, the lead's), with its record beside it (`<archive>.record.json`: `ReportRecord`, the read-back's checksum, the rows still waiting, whether the
// rest passed).
//
// The restore: `restoreGolden` refuses a copy whose record still lists a row as waiting for the live driver, or that did not pass, runs the restore, and then reads the restored
// instance back (`report.ts --expect`): a checksum other than the kept one refuses the copy as one that gave back another instance. Every command runs through the bed's terminal
// (`LRE_BED_SHELL`, `terminal.ts`); what they are, and where the copy is, come from the environment, so nothing here names a machine:
//   LRE_GOLDEN_COPY     the archive's path on the bed's server; its record is `<archive>.record.json` beside it
//   LRE_GOLDEN_RESTORE  the whole command line that restores it (`bash …/golden.sh restore <archive>`, with the BED_* variables it reads)
//   LRE_GOLDEN_REPORT   the whole command line that reads the restored instance back and exits 0 only when its checksum is the one given as its last word (`bun …/report.ts --expect`)

import type { Json, RunLog } from "../../testbed/lib/record";
import type { Shell } from "./terminal";

/** What a golden copy keeps beside it (`ReportRecord`, `scripts/testbed/lib/instance/readback.ts`). */
export interface GoldenRecord {
  checksum: string;
  waiting: string[];
  passes: boolean;
}

/** A refused restore: the copy is not the retaken one, or gave back another instance. Nothing was restored where it says so. */
export class GoldenRefused extends Error {}

/** The record text as a record, or why it is none. */
export function goldenRecord(text: string): GoldenRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GoldenRefused("the golden copy's record is not JSON, so it is not the copy's record");
  }
  if (typeof raw !== "object" || raw === null) throw new GoldenRefused("the golden copy's record is not an object");
  const checksum = "checksum" in raw ? raw.checksum : undefined;
  const waiting = "waiting" in raw ? raw.waiting : undefined;
  const passes = "passes" in raw ? raw.passes : undefined;
  if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) throw new GoldenRefused("the golden copy's record holds no 64-digit checksum");
  if (!Array.isArray(waiting) || !waiting.every((row): row is string => typeof row === "string")) throw new GoldenRefused("the golden copy's record does not list the rows that wait as a list of names");
  if (typeof passes !== "boolean") throw new GoldenRefused("the golden copy's record does not say whether its read-back passed");
  return { checksum, waiting, passes };
}

/** Why a copy is not the retaken one, from its record; null when it is. */
export function notRetaken(record: GoldenRecord): string | null {
  if (record.waiting.length > 0) return `its record still lists ${record.waiting.join(", ")} as waiting for the live driver: the copy is to be taken again with that row (PlanScenarios-3 item 8) before anything restores from it`;
  if (!record.passes) return "its record says the read-back did not pass";
  return null;
}

/** A word as one word of a shell command line. */
const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

export interface GoldenEnv {
  copy: string;
  restore: string;
  report: string;
}

/** The environment's account of where the copy is and how it is restored and read back; names the first variable that is not set. */
export function readGoldenEnv(env: Record<string, string | undefined> = process.env): GoldenEnv {
  const need = (name: string): string => {
    const value = env[name]?.trim();
    if (value === undefined || value === "") throw new Error(`set ${name} (see scripts/proof/live/golden.ts)`);
    return value;
  };
  return { copy: need("LRE_GOLDEN_COPY"), restore: need("LRE_GOLDEN_RESTORE"), report: need("LRE_GOLDEN_REPORT") };
}

/**
 * Puts the bed back to its golden copy: refuses a copy whose record lists a waiting row or did not pass, restores it, and reads the restored instance back: its checksum
 * must be the one kept beside the copy. Gives the record the copy was restored by.
 */
export async function restoreGolden(shell: Shell, env: GoldenEnv): Promise<GoldenRecord> {
  const read = await shell.run(`cat ${quoted(`${env.copy}.record.json`)}`);
  if (read.exit !== 0) throw new GoldenRefused(`the golden copy ${env.copy} has no record beside it (${read.lines.join(" ").slice(0, 200)}), so it is not known to be the retaken one`);
  const record = goldenRecord(read.lines.join("\n"));
  const why = notRetaken(record);
  if (why !== null) throw new GoldenRefused(`the golden copy ${env.copy} is refused: ${why}`);
  const restored = await shell.run(env.restore);
  if (restored.exit !== 0) throw new Error(`restoring the golden copy failed (exit ${restored.exit}): ${restored.lines.slice(-8).join(" | ")}`);
  const checked = await shell.run(`${env.report} ${record.checksum}`);
  if (checked.exit !== 0) throw new GoldenRefused(`the restored instance does not read back as the kept checksum ${record.checksum.slice(0, 12)}: ${checked.lines.slice(-8).join(" | ")}`);
  return record;
}

/** One preference as the browser holds it: its key and the text stored under it. */
export interface Preference {
  key: string;
  value: string;
}

/**
 * The keys today's panels keep on a device, each with a value as the panel writes it, for a chat of the instance's and a target in it (today's build:
 * `src/frontend/app.ts:131` show ids, `src/frontend/story/prepare-live.tsx:363` and `:577` the preparation's open or closed, `src/frontend/things/play-where.ts:95` and `:109` a
 * chat's recent targets, the LumiAH extension's `src/extension/frontend/app.tsx:238` its switches).
 */
export function panelPreferences(chat: string, target: string): Preference[] {
  return [
    { key: "lre:ui:show-ids", value: "true" },
    { key: `lre:prepare-live:${chat}`, value: "open" },
    { key: `lre:things:recent:${chat}`, value: JSON.stringify([target]) },
    { key: "lumi_ah.prefs", value: JSON.stringify({ follow: false, thinkingOpen: true, toolsOpen: true }) },
  ];
}

/**
 * Sets today's panels' preferences in the driver's own browser, on a page of the instance's Lumiverse (where today's panels run and keep them), reads each back from
 * the page, and records the keys in the instance's record under `browser:prefs`. A key the page does not hold afterwards stops the step, naming it.
 */
export async function recordBrowserPreferences(tab: { evaluate<T>(expression: string): Promise<T> }, log: RunLog, prefs: readonly Preference[]): Promise<Preference[]> {
  for (const pref of prefs) await tab.evaluate(`localStorage.setItem(${JSON.stringify(pref.key)}, ${JSON.stringify(pref.value)})`);
  const held: Preference[] = [];
  for (const pref of prefs) {
    const back = await tab.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(pref.key)})`);
    if (back !== pref.value) throw new Error(`the browser does not hold the preference ${pref.key} after it was set (it holds ${back === null ? "nothing" : JSON.stringify(back)})`);
    held.push({ key: pref.key, value: back });
  }
  log.set("browser:prefs", held as unknown as Json);
  return held;
}
