// `run.ts check` on scripts written in the form (PlanScenarios-1 items 1 and 2): a scenario missing a
// form, a wave or a mark on a part is refused, by file; a gate may lack a rig form but not a live one;
// the list of the 68 is checked against the files, by number, wave and the plan's own words.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check, wordFaults } from "../../../scripts/proof/route/check";
import { gateIdFault, type Mark } from "../../../scripts/proof/route/form";
import { LIST } from "../../../scripts/proof/route/list";

const RUN = resolve(import.meta.dir, "../../../scripts/proof/run.ts");
const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");

let root = "";
/** A proof folder holding a file for every one of the 68 but scenario 22. */
let all = "";

/** A scenario file of the form, its fields given as source text so one can be left out. */
function scenarioFile(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `  ${key}: ${value},`)
    .join("\n");
  return `import { scenario } from ${JSON.stringify(FORM)};\nconst sees = async () => ({ found: true as const, shows: ["seen"] });\nexport default scenario({\n${body}\n} as never);\n`;
}

const scenario22: Record<string, string> = {
  number: "22",
  wave: "2",
  line: "1836",
  parts: `[
    { id: "four-values", words: "The four values are as before those turns", mark: "code", on: [{ page: "World", check: sees }] },
    { id: "note", words: "a note written in them is back to its earlier text", mark: "code", on: [{ page: "Files", check: sees }] },
  ]`,
  fixtures: "[]",
  bed: "[]",
  rig: "async () => {}",
  live: "async () => {}",
};

/** A gate file of one measured part with the id given. */
function gateWithId(id: string): string {
  return `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: ${JSON.stringify(id)}, waves: [1], parts: [{ id: "time", words: "a time", mark: "code", measured: "a time" }], fixtures: [], bed: [], live: async () => {} });\n`;
}

/** The proof folders `proofWith` made, removed with the rest when the file ends. */
const made: string[] = [];

/** A proof folder of its own holding the files given. */
function proofWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-form-ids-"));
  made.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}
function runCheck(at = root): { code: number; text: string } {
  const done = Bun.spawnSync({ cmd: [process.execPath, RUN, "check", "--root", at], stdout: "pipe", stderr: "pipe" });
  return { code: done.exitCode ?? -1, text: `${done.stdout.toString()}${done.stderr.toString()}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "proof-form-"));
  mkdirSync(join(root, "scenarios"));
  writeFileSync(join(root, "scenarios/22-delete-two.ts"), scenarioFile(scenario22));
  const noRig: Record<string, string> = { ...scenario22, number: "23", line: "1837" };
  delete noRig.rig;
  writeFileSync(join(root, "scenarios/23-branch.ts"), scenarioFile(noRig));
  const noWave: Record<string, string> = { ...scenario22, number: "20", line: "1834" };
  delete noWave.wave;
  writeFileSync(join(root, "scenarios/20-swipe.ts"), scenarioFile(noWave));
  writeFileSync(
    join(root, "scenarios/21-flip-back.ts"),
    scenarioFile({ ...scenario22, number: "21", line: "1835", parts: `[{ id: "right-state", words: "The right text with the right state, by the same four values", on: [{ page: "World", check: sees }] }]` }),
  );
  mkdirSync(join(root, "floor"));
  writeFileSync(
    join(root, "floor/gate.ts"),
    `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: "floor", waves: [1, 5], parts: [{ id: "calls", words: "Exactly 1 in at least 9 of 10", mark: "as shipped", measured: "calls begun before the reply's first piece", wants: { hits: 9, of: 10 } }], fixtures: [], bed: [], live: async () => {} });\n`,
  );
  mkdirSync(join(root, "intent"));
  writeFileSync(
    join(root, "intent/gate.ts"),
    `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: "gate-17.3-intent", waves: [3], parts: [{ id: "record", words: "an intent record with a line for each lane", mark: "as shipped", on: [{ page: "Turn", check: async () => ({ found: false as const, what: "none" }) }] }], fixtures: [], bed: [], rig: async () => {} } as never);\n`,
  );
  // A wave's checkpoint items kept with the scenarios, as a gate named for its wave.
  const checkpoint = (id: string, wave: number) => `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: "${id}", waves: [${wave}], parts: [{ id: "streamed", words: "a chat on RPE's connection gets a streamed reply", mark: "code", on: [{ page: "Lumiverse chat", check: async () => ({ found: true as const, shows: ["reply"] }) }] }], fixtures: [], bed: [], rig: async () => {}, live: async () => {} });\n`;
  writeFileSync(join(root, "scenarios/w1-checkpoint.ts"), checkpoint("w1", 1));
  writeFileSync(join(root, "scenarios/w2-checkpoint.ts"), checkpoint("w3", 3));
  writeFileSync(join(root, "scenarios/notes.ts"), "export const helper = 1;\n");
  // Against the list: a wave not the table's, words not the plan's, words left out, an "as shipped" clause marked code.
  writeFileSync(join(root, "scenarios/16-unseen-preset.ts"), scenarioFile({ ...scenario22, number: "16", wave: "3", line: "1829", parts: wholeRow(16) }));
  writeFileSync(join(root, "scenarios/34-sixty-entries.ts"), scenarioFile({ ...scenario22, number: "34", line: "1849", parts: `[{ id: "calls", words: "At most four calls; then one entry redone", mark: "code", on: [{ page: "Lore", check: sees }] }]` }));
  writeFileSync(join(root, "scenarios/17-preset-changes.ts"), scenarioFile({ ...scenario22, number: "17", line: "1830", parts: `[{ id: "notices", words: "Each shows as its own notice in the next briefing and on the Prompt page", mark: "code", on: [{ page: "Prompt", check: sees }] }]` }));
  writeFileSync(
    join(root, "scenarios/26-other-connection.ts"),
    scenarioFile({
      ...scenario22,
      number: "26",
      wave: "3",
      line: "1840",
      parts: `[{ id: "range", words: "The briefing gives the range", mark: "code", on: [{ page: "Turn", check: sees }] }, { id: "records", words: "the Author records what matters", mark: "code", on: [{ page: "Story", check: sees }] }]`,
    }),
  );
  // Gate ids: a number reads as a scenario's; a "/" cannot name a folder.
  mkdirSync(join(root, "numbered"));
  writeFileSync(join(root, "numbered/gate.ts"), `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: "38", waves: [1], parts: [{ id: "report", words: "the report", mark: "code", on: [{ page: "terminal", check: async () => ({ found: true as const, shows: ["report"] }) }] }], fixtures: [], bed: [], live: async () => {} });\n`);
  mkdirSync(join(root, "phase0"));
  writeFileSync(join(root, "phase0/gate.ts"), `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({ id: "phase0/0.2-tags", waves: [0], parts: [{ id: "tags", words: "the tags kept", mark: "as shipped", measured: "turns whose tags were kept", wants: { hits: 28, of: 30 } }], fixtures: [], bed: [], live: async () => {} });\n`);
  // What keeps the folder in git, and what a Mac leaves in it, are not scripts.
  writeFileSync(join(root, "scenarios/.gitkeep"), "");
  writeFileSync(join(root, "scenarios/.DS_Store"), "\u0000\u0001");
  all = mkdtempSync(join(tmpdir(), "proof-all-"));
  mkdirSync(join(all, "scenarios"));
  for (const row of LIST) {
    if (row.number === 22) continue;
    const fields = { ...scenario22, number: String(row.number), wave: String(row.wave), line: String(row.line), parts: wholeRow(row.number) };
    writeFileSync(join(all, `scenarios/${String(row.number).padStart(2, "0")}-whole.ts`), scenarioFile(fields));
  }
});

afterAll(() => {
  for (const dir of [root, all, ...made]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** One part carrying a row's whole words, marked as the row's own "as shipped" asks. */
function wholeRow(number: number): string {
  const row = LIST.find((r) => r.number === number);
  if (!row) throw new Error(`no row ${number}`);
  return `[{ id: "whole", words: ${JSON.stringify(row.seen)}, mark: ${/as shipped/i.test(row.seen) ? '"as shipped"' : '"code"'}, on: [{ page: "World", check: sees }] }]`;
}

test("a scenario missing a form, a wave or a mark on a part is refused by run.ts check, by file", () => {
  const { code, text } = runCheck();
  expect(code).toBe(1);
  expect(text).toContain("scenarios/23-branch.ts: it has no rig form");
  expect(text).toContain("scenarios/20-swipe.ts: it has no wave");
  expect(text).toContain('scenarios/21-flip-back.ts: part right-state has no mark ("code" or "as shipped")');
  // The whole one is listed with both forms and nothing of its own refused.
  expect(text).toMatch(/22 +wave 2 +scenarios\/22-delete-two\.ts +rig and live/);
  expect(text).not.toContain("scenarios/22-delete-two.ts:");
});

test("a gate may lack a rig form, never a live one; a wave's checkpoint kept with the scenarios is a gate named for its wave", () => {
  const { text } = runCheck();
  expect(text).toMatch(/floor +waves 1, 5 +floor\/gate\.ts +live/);
  expect(text).not.toContain("floor/gate.ts:");
  expect(text).toContain("intent/gate.ts: it has no live form");
  expect(text).toMatch(/w1 +waves 1 +scenarios\/w1-checkpoint\.ts +rig and live/);
  expect(text).not.toContain("scenarios/w1-checkpoint.ts:");
  expect(text).toContain("scenarios/w2-checkpoint.ts: a wave's checkpoint named for wave 2 has the id w2 and is played at wave 2 alone");
  expect(text).toContain("scenarios/notes.ts: it is neither a scenario named <nn>-<word>.ts nor a wave's checkpoint named w<n>-checkpoint.ts");
});

test("a file missing for scenario 22 fails run.ts check by its number, and all 68 are listed with their waves", () => {
  const { code, text } = runCheck(all);
  expect(code).toBe(1);
  expect(text).toContain("The plan's 68 scenarios: 67 with a file, 1 with none.");
  expect(text).toMatch(/\n {2}22 +wave 2 +no file\n/);
  expect(text).toMatch(/\n {2}38 +wave 1 +scenarios\/38-whole\.ts +rig and live\n/);
  expect(text).toContain("scenario 22: no file plays it");
  expect(text.match(/no file plays it/g)?.length).toBe(1);
  expect(text).toContain("Faults (1):");
});

test("a list with scenario 22 missing fails the check by its number", async () => {
  const result = await check(root, LIST.filter((row) => row.number !== 22));
  expect(result.faults).toContainEqual({ where: "scenario 22", what: "the list of the 68 lacks it" });
  expect(result.faults).toContainEqual({ where: "scenarios/22-delete-two.ts", what: "the list of the 68 has no scenario 22" });
});

test("a file whose wave or words differ from the list is a fault, as is a clause under \"as shipped\" marked code", () => {
  const { text } = runCheck();
  expect(text).toContain("scenarios/16-unseen-preset.ts: its wave is 3, and §18.3's table lists scenario 16 at wave 2");
  expect(text).toContain(`scenarios/34-sixty-entries.ts: part calls's words are not in scenario 34's row as the plan writes it: "At most four calls; then one entry redone"`);
  expect(text).toContain(`scenarios/17-preset-changes.ts: no part carries the plan's words "Nothing is blocked"`);
  expect(text).toContain(`scenarios/26-other-connection.ts: part records is marked "code", and the plan's row puts "the Author records what matters" under "as shipped"`);
  expect(text).not.toContain("scenarios/26-other-connection.ts: part range");
});

test("a gate's id is a name: one that is a number, or holds a \"/\", is refused, saying why", () => {
  const { text } = runCheck();
  expect(text).toContain("numbered/gate.ts: its id 38 has no letter, so it would read as a scenario's number: a gate's id is a name with a letter in it");
  expect(text).toContain(`phase0/gate.ts: its id phase0/0.2-tags holds a "/": a gate's id names its folder in the bundle, so it is letters, digits, dots and hyphens (write it phase0-0.2-tags)`);
});

test("what keeps the scenarios folder in git, and a hidden file, are not read as scripts", () => {
  const { text } = runCheck();
  expect(text).not.toContain(".gitkeep");
  expect(text).not.toContain(".DS_Store");
});

/** The faults of one row's parts, each part given as its words and its mark. */
function marks(number: number, parts: [string, Mark][]): string[] {
  const row = LIST.find((r) => r.number === number);
  if (!row) throw new Error(`no row ${number}`);
  return wordFaults(
    row,
    parts.map(([words, mark], i) => ({ id: `p${i + 1}`, words, mark })),
  );
}

test("every clause an \"As shipped:\" opens is held to that mark, not only the first, row 62's included", () => {
  const under = (id: string, words: string) => `part ${id} is marked "code", and the plan's row puts "${words}" under "as shipped"`;
  expect(
    marks(7, [
      ["One reply", "code"],
      ["the scene sheet lists the moments", "as shipped"],
      ["the first has a perception for each", "code"],
      ["the second's perception of the missed moment is none or told", "code"],
      ["its memories and knowledge lack what happened", "code"],
      ["asked next turn, it does not know", "code"],
    ]),
  ).toEqual([under("p3", "the first has a perception for each"), under("p4", "the second's perception of the missed moment is none or told"), under("p5", "its memories and knowledge lack what happened"), under("p6", "asked next turn, it does not know")]);
  expect(
    marks(13, [
      ["the gap check and its empty result are in `queries/`", "as shipped"],
      ["the Author's consent with bounds is on the Turn page", "code"],
      ["the person is on the World page with source invented", "code"],
    ]),
  ).toEqual([under("p2", "the Author's consent with bounds is on the Turn page"), under("p3", "the person is on the World page with source invented")]);
  expect(
    marks(60, [
      ["the Author asks the GM to set the map", "as shipped"],
      ["the GM's `map_lay` and `map_place` are in the live view", "code"],
      ["the world state and the map panel show a room grid with everyone and everything on squares, marked assumed", "code"],
    ]),
  ).toEqual([under("p2", "the GM's `map_lay` and `map_place` are in the live view"), under("p3", "the world state and the map panel show a room grid with everyone and everything on squares, marked assumed")]);
  // Row 62: its outcomes appear only after the GM lays the grid as the shipped guidance asks, so every clause is "as shipped" (the lead's ruling on N6).
  expect(
    marks(62, [
      ["the GM lays a grid of 5 ft squares for it", "as shipped"],
      ["it shows on the Places page as belonging to the chat", "code"],
      ["five rounds of the fight move the clock by seconds, not minutes", "code"],
      ['"keep in the world" copies it into the world\'s draft', "code"],
    ]),
  ).toEqual([under("p2", "it shows on the Places page as belonging to the chat"), under("p3", "five rounds of the fight move the clock by seconds, not minutes"), under("p4", '"keep in the world" copies it into the world\'s draft')]);
  // Row 64: a scope stops at its own sentence ("After the swipe: …"; "With RPE stopped or late: …").
  expect(marks(64, [["After the swipe: the chat is on the swiped reply", "code"]]).some((f) => f.startsWith("part p1 is marked"))).toBe(false);
  // "as shipped," holds its own clause; the next sentence or clause is the writer's to mark.
  expect(
    marks(1, [
      ["The GM's session shows the list of what the time brought due", "code"],
      ["each item's outcome is recorded", "code"],
      ["the World page shows them", "code"],
    ]),
  ).toEqual([under("p2", "each item's outcome is recorded")]);
  expect(
    marks(12, [
      ["its session shows the search and cites the entry", "as shipped"],
      ["No question to the Author", "code"],
    ]),
  ).toEqual([]);
});

test("a gate's id never names the bundle's own files, and two gates' ids never differ only in case", async () => {
  expect(gateIdFault("report.md")).toBe("its id report.md is the name of the bundle's own report.md, so the gate's folder would take its place: give the gate a name of its own");
  expect(gateIdFault("Run.JSON")).toBe("its id Run.JSON is the name of the bundle's own run.json, so the gate's folder would take its place: give the gate a name of its own");
  const at = proofWith({ "floor/gate.ts": gateWithId("Floor"), "floor-b/gate.ts": gateWithId("floor") });
  const found = (await check(at)).found.filter((f) => f.kind === "gate");
  for (const f of found) expect(f.faults).toContain("2 gates have ids that differ only in case (Floor, floor), and one folder of the bundle would hold both: floor-b/gate.ts, floor/gate.ts");
});
