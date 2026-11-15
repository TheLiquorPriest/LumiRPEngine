// A scenario played in stages is one scenario (PlanScenarios-8). Its parts are seen in different
// states of the bed, each stage at its own place in a run, and it passes only when every stage was
// played and every part seen: a later stage never stands for an earlier one, and reading the bundle
// back alone gives the same answer. Scenario 41 is written here in two stages, as PlanScenarios-41
// will write it: `before`, today's HUD on today's build, and `after`, the classic chat played on the
// Author. The host is made up (`fake.ts`): each stage's pages are what that state of the bed shows.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readBundle } from "../../../scripts/proof/route/evidence";
import { refusals } from "../../../scripts/proof/route/form";
import type { Host, PlayStart, Session } from "../../../scripts/proof/route/host";
import { main, type Deps } from "../../../scripts/proof/run";
import { FakeBrowser, fakeFacts, withLive, type FakeOptions } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");

/** Every folder a test made, taken away at the end. */
const made: string[] = [];
let root = "";
let out = "";

/** What each state of the bed shows: today's HUD before the cutover; the classic chat on the Author after it. */
const BEFORE = { "Lumiverse chat": "HUD: dusk, the mill, 40 silver", Turn: "No turn yet" };
const AFTER = { "Lumiverse chat": "HUD: dusk, the mill, 40 silver\nAuthor: The ferry waits for no one", Turn: "Briefing: a migrated chat, carried from the classic pipeline" };

/** Row 41's words split over its two stages; each part looks for one text on one page. */
const PARTS = [
  { id: "hud-state", words: "the HUD and panels show its state", page: "Lumiverse chat", text: "HUD: dusk, the mill, 40 silver" },
  { id: "author-answers", words: "The Author answers", page: "Lumiverse chat", text: "Author: The ferry waits" },
  { id: "briefing-migrated", words: "the briefing says it is a migrated chat", page: "Turn", text: "a migrated chat" },
  { id: "carried-on", words: "carried on", page: "Lumiverse chat", text: "HUD: dusk, the mill, 40 silver" },
];

/** Scenario 41 in stages; `stages` maps each stage's name to the parts it sees, in order. */
function stagedFile(stages: Record<string, string[]>): string {
  const parts = PARTS.map((p) => `{ id: ${JSON.stringify(p.id)}, words: ${JSON.stringify(p.words)}, mark: "code", on: [{ page: ${JSON.stringify(p.page)}, check: sees(${JSON.stringify(p.text)}) }] }`).join(",\n    ");
  const list = Object.entries(stages)
    .map(([name, ids]) => {
      const looks = ids.map((id) => `await play.see(${JSON.stringify(id)});`).join(" ");
      return `{ name: ${JSON.stringify(name)}, parts: ${JSON.stringify(ids)}, rig: async (play: Seer) => { ${looks} }, live: async (play: Seer) => { ${looks} } }`;
    })
    .join(",\n    ");
  return `import { scenario } from ${JSON.stringify(FORM)};
type Seer = { see(part: string): Promise<void> };
const sees = (text: string) => async (look: { read(): Promise<string> }) => ((await look.read()).includes(text) ? { found: true as const, shows: [text] } : { found: false as const, what: "not there: " + text });
export default scenario({
  number: 41,
  wave: 4,
  line: 1858,
  parts: [
    ${parts},
  ],
  fixtures: [],
  bed: [],
  stages: [
    ${list},
  ],
});
`;
}

const TWO_STAGES = { before: ["hud-state"], after: ["author-answers", "briefing-migrated", "carried-on"] };

/** A host whose every play opens a fresh browser on the pages of the stage it plays (the stage's id, `41:before`, names it). */
function stagedHost(pages: Record<string, Record<string, string>>, options: Record<string, Partial<FakeOptions>> = {}): Host & { begun: PlayStart[] } {
  const host = {
    mode: "rig" as const,
    begun: [] as PlayStart[],
    async facts() {
      return withLive(fakeFacts());
    },
    async begin(start: PlayStart): Promise<Session> {
      host.begun.push(start);
      const stage = start.form.id.split(":")[1] ?? "";
      return { acts: {}, browser: new FakeBrowser({ pages: pages[stage] ?? {}, ...options[stage] }), guidance: async () => fakeFacts().guidance ?? null, close: async () => {} };
    },
    async close() {},
  };
  return host;
}

/** A proof folder of its own holding the runner's settings and the files given. */
function proofRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-stages-root-"));
  made.push(dir);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(dir, "scenarios"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

function bundles(at: string): string[] {
  return existsSync(at) ? readdirSync(at).filter((name) => existsSync(join(at, name, "run.json"))) : [];
}

/** Runs the command line on a proof folder; returns its exit code, what it printed, and the bundle it left (empty when none). */
async function runOn(at: string, argv: string[], deps: Deps = {}): Promise<{ code: number; printed: string; dir: string }> {
  const where = join(out, `run-${made.length}-${Math.random().toString(36).slice(2, 8)}`);
  const printed: string[] = [];
  const code = await main([...argv, "--root", at, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), ...deps });
  const [name] = bundles(where);
  return { code, printed: printed.join(""), dir: name ? join(where, name) : "" };
}

/** Scenario 42 played whole, as every scenario but 40 to 43 is. */
function wholeFile(): string {
  return `import { scenario } from ${JSON.stringify(FORM)};
const sees = (text: string) => async (look: { read(): Promise<string> }) => ((await look.read()).includes(text) ? { found: true as const, shows: [text] } : { found: false as const, what: "not there: " + text });
export default scenario({ number: 42, wave: 4, line: 1859, parts: [{ id: "nothing-doubled", words: "Nothing is duplicated", mark: "code", on: [{ page: "World", check: sees("Chats: 3") }] }], fixtures: [], bed: [], rig: async (play) => { await play.see("nothing-doubled"); }, live: async (play) => { await play.see("nothing-doubled"); } });
`;
}

/** Why the run says an id was not played. */
function why(dir: string, id: string): string | undefined {
  const run: { unplayed: { id: string; why: string }[] } = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  return run.unplayed.find((u) => u.id === id)?.why;
}

/** Every file and folder under a folder, from it; a folder ends with "/". */
function filesIn(dir: string, under = ""): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) => {
    const path = under === "" ? entry.name : `${under}/${entry.name}`;
    return entry.isDirectory() ? [`${path}/`, ...filesIn(dir, path)] : [path];
  });
}

const guard = { lock: async () => ({ held: false as const, release: async () => {} }), admit: async () => ({ ok: true as const }) };

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-stages-out-"));
  made.push(out);
  root = proofRoot({ "scenarios/41-classic-played.ts": stagedFile(TWO_STAGES), "scenarios/42-second-run.ts": wholeFile() });
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const HEAD = "- 41. A chat that was on the classic pipeline is played";

test("a scenario with two stages is passed only when both were played and seen", async () => {
  const printed: string[] = [];
  await main(["check", "--root", root], { out: (text) => printed.push(text) });
  const checked = { printed: printed.join("") };
  expect(checked.printed).toContain("41  wave 4  scenarios/41-classic-played.ts  rig and live, in stages before, after");
  expect(checked.printed).not.toContain("scenarios/41-classic-played.ts: ");

  // Both stages played, every part seen: passed, each stage in its turn.
  const host = stagedHost({ before: BEFORE, after: AFTER });
  const whole = await runOn(root, ["rig", "41"], { openHost: async () => host });
  expect(host.begun.map((b) => [b.form.id, b.play, b.plays])).toEqual([
    ["41:before", 1, 1],
    ["41:after", 1, 1],
  ]);
  expect(whole.printed).toContain(`${HEAD}: passed\n  - Stage before: passed\n    - "the HUD and panels show its state" (code): Passed\n  - Stage after: passed\n`);
  expect(whole.code).toBe(0);

  // The after stage's briefing does not say it: the scenario fails, whatever the before stage showed.
  const missed = await runOn(root, ["rig", "41"], { openHost: async () => stagedHost({ before: BEFORE, after: { ...AFTER, Turn: "Briefing: nothing carried" } }) });
  expect(missed.printed).toContain(`${HEAD}: failed\n  - Stage before: passed\n`);
  expect(missed.printed).toContain('    - "the briefing says it is a migrated chat" (code): Failed');
  expect(missed.code).toBe(1);

  // The before stage seen with no screen that shows it: not seen, never passed.
  const unseen = await runOn(root, ["rig", "41"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }, { before: { blank: true } }) });
  expect(unseen.printed).toContain(`${HEAD}: not seen\n  - Stage before: not seen\n`);
  expect(unseen.code).toBe(1);

  // Both played and seen, then the after stage's folder taken away: read back alone, it is no pass.
  rmSync(join(whole.dir, "41", "after"), { recursive: true });
  const read = readBundle(whole.dir);
  const form = read.forms.find((f) => f.id === "41");
  expect(form?.result).toBe("failed");
  expect(form?.faults).toContain("stage after was asked, and neither played nor said why not");
  expect(read.faults).toContain("41:after was asked, and neither played nor said why not");
});

test("every part is in exactly one stage, each stage has its own rig and live forms, and a scenario in stages has no forms of its own", () => {
  const part = (id: string, words: string) => ({ id, words, mark: "code", on: [{ page: "Turn", check: async () => ({ found: false, what: "-" }) }] });
  const form = async () => {};
  const base = { kind: "scenario", number: 41, wave: 4, line: 1858, fixtures: [], bed: [], parts: [part("author-answers", "The Author answers"), part("briefing-migrated", "the briefing says it is a migrated chat")] };
  const stage = (name: string, parts: unknown, more: Record<string, unknown> = {}) => ({ name, parts, rig: form, live: form, ...more });
  expect(refusals({ ...base, stages: [stage("before", ["author-answers"]), stage("after", ["briefing-migrated"])] }, "scenario")).toEqual([]);
  expect(refusals({ ...base, stages: [stage("before", ["author-answers", "briefing-migrated"]), stage("after", ["briefing-migrated"])] }, "scenario")).toEqual(["part briefing-migrated is in stages before and after: every part is in exactly one stage"]);
  expect(refusals({ ...base, stages: [stage("before", ["author-answers"]), stage("after", ["notes-kept"])] }, "scenario")).toEqual(["stage after names part notes-kept, which the scenario does not have", "part briefing-migrated is in no stage: every part is in exactly one stage"]);
  expect(refusals({ ...base, stages: [stage("before", ["author-answers", "briefing-migrated"]), stage("after", [])] }, "scenario")).toEqual(["stage after names no part: a stage shows at least one part of its scenario"]);
  expect(refusals({ ...base, stages: [stage("before", ["author-answers", "briefing-migrated"])] }, "scenario")).toEqual(["it names one stage: a scenario with one stage is written without stages, and played whole"]);
  expect(refusals({ ...base, rig: form, stages: [stage("before", ["author-answers"]), stage("after", ["briefing-migrated"])] }, "scenario")).toEqual(["it has forms of its own beside its stages: a scenario played in stages has its forms in each stage"]);
  expect(refusals({ ...base, stages: [stage("before", ["author-answers"], { live: undefined }), stage("before", ["briefing-migrated"], { rig: "later" })] }, "scenario")).toEqual(["stage before has no live form", "stage before is named twice", "stage before has no rig form"]);
  expect(refusals({ ...base, stages: [stage("Before", ["author-answers"]), stage("internal", ["briefing-migrated"])] }, "scenario")).toEqual(["stage 1 has no name of lowercase words joined by hyphens", "stage 2 is named internal, a name a form's folder keeps for its own"]);
  expect(refusals({ ...base, stages: "before, after" }, "scenario")).toEqual(["its stages are not a list of stages"]);
  // A scenario with no stages is one stage, played whole, held to its own two forms as before.
  expect(refusals({ ...base, rig: form, live: form }, "scenario")).toEqual([]);
  expect(refusals({ ...base }, "scenario")).toEqual(["it has no rig form", "it has no live form"]);
  // Only a scenario is played in stages.
  expect(refusals({ kind: "gate", id: "floor", waves: [1], fixtures: [], bed: [], parts: [part("calls", "a call")], live: form, stages: [] }, "gate")).toEqual(["it names stages, and only a scenario is played in stages"]);
});

test("a stage is asked and placed by its name, once; asked or placed twice it is refused; its screens land in its own folder inside its scenario's", async () => {
  // Placed by name in one state and with its scenario's number in another: placed twice, refused before anything plays.
  const twice = proofRoot({
    "scenarios/41-classic-played.ts": stagedFile(TWO_STAGES),
    "round/order.ts": 'export const order = [{ name: "state 1", ids: ["41:before"], restoreGolden: false }, { name: "state 2", ids: ["41"], restoreGolden: false }];\n',
  });
  const placedHost = stagedHost({ before: BEFORE, after: AFTER });
  const placed = await runOn(twice, ["round"], { openHost: async () => placedHost, guard });
  expect(placed.printed).toContain('Refused: the round\'s order places 41:before twice ("state 1", "state 2" as 41): each id is played once in a run.');
  expect(placedHost.begun).toEqual([]);
  expect(placed.dir).toBe("");
  expect(placed.code).toBe(1);

  // Asked by its number and by its name in one run: asked twice, refused.
  const askedHost = stagedHost({ before: BEFORE, after: AFTER });
  const asked = await runOn(root, ["rig", "41", "41:before"], { openHost: async () => askedHost });
  expect(asked.printed).toContain("Refused: 41:before is asked twice, as 41 and as 41:before (asked by its number, scenario 41 plays each of its stages): each stage is played once in a run, so ask it once.");
  expect(askedHost.begun).toEqual([]);
  expect(asked.dir).toBe("");

  // A name its scenario does not have, a name that is not a stage's, a stage of a scenario played whole: none is played, each with why.
  const wrong = await runOn(root, ["rig", "41:middle", "41:Before", "4:first", "42:first"], { openHost: async () => stagedHost({}) });
  expect(why(wrong.dir, "41:middle")).toBe("scenario 41 has no stage middle: its stages are before, after");
  expect(why(wrong.dir, "41:Before")).toBe("41:Before is not a stage: a stage is asked as its scenario's number and its name, lowercase words joined by hyphens (40:before)");
  expect(why(wrong.dir, "04:first")).toBe("no file plays it");
  expect(why(wrong.dir, "42:first")).toBe("scenario 42 is played whole, not in stages: ask it as 42");
  expect(wrong.printed).not.toContain("Gate 41:Before");
  expect(wrong.code).toBe(1);

  // One stage asked by its name: its screens, record and notes are in its own folder inside its scenario's, and no name in the bundle holds a colon.
  const one = await runOn(root, ["rig", "41:after"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }) });
  expect(readdirSync(join(one.dir, "41"))).toEqual(["after"]);
  expect(filesIn(join(one.dir, "41", "after")).sort()).toEqual([
    "internal/",
    "internal/supporting-evidence.txt",
    "notes.md",
    "play-01/",
    "play-01/lumiverse-chat-1440-author-answers.png",
    "play-01/lumiverse-chat-1440-carried-on.png",
    "play-01/lumiverse-chat-390-author-answers.png",
    "play-01/lumiverse-chat-390-carried-on.png",
    "play-01/turn-1440-briefing-migrated.png",
    "play-01/turn-390-briefing-migrated.png",
    "result.json",
  ]);
  expect(filesIn(one.dir).filter((path) => path.includes(":"))).toEqual([]);
  expect(JSON.parse(readFileSync(join(one.dir, "run.json"), "utf8")).asked).toEqual(["41:after"]);
  expect(JSON.parse(readFileSync(join(one.dir, "41", "after", "result.json"), "utf8")).stage).toEqual({ name: "after", of: ["before", "after"] });
});

test("a stage not played leaves its scenario not played whole, never passed, and the report names that stage and why", async () => {
  // One stage asked alone: the other was not asked in this run.
  const alone = await runOn(root, ["rig", "41:before"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }) });
  expect(alone.printed).toContain(`${HEAD}: not played whole: stage after was not played\n  - Stage before: passed\n    - "the HUD and panels show its state" (code): Passed\n  - Stage after: not played (not asked in this run)\n`);
  expect(alone.printed).toContain("Played 1 of 25, not played 24; passed 0, failed 0, not seen 0, measured as a rate 0, not played whole 1.");
  expect(alone.code).toBe(1);
  // Read back alone, the bundle gives the same: not played whole, and no fault of the evidence.
  const read = readBundle(alone.dir);
  expect(read.forms.find((f) => f.id === "41")?.result).toBe("not played whole");
  expect(read.forms.find((f) => f.id === "41")?.faults).toEqual([]);
  expect(read.faults).toEqual([]);

  // A stage that failed beside one not played: failed, and the stage not played is named too.
  const failed = await runOn(root, ["rig", "41:before"], { openHost: async () => stagedHost({ before: { ...BEFORE, "Lumiverse chat": "HUD: night" }, after: AFTER }) });
  expect(failed.printed).toContain(`${HEAD}: failed; stage after was not played\n  - Stage before: failed\n`);

  // The round's order places one stage and not the other; a scenario none of whose stages it places is not played, by stage.
  const order = proofRoot({
    "scenarios/41-classic-played.ts": stagedFile(TWO_STAGES),
    "scenarios/42-second-run.ts": wholeFile(),
    "round/order.ts": 'export const order = [{ name: "state 1", ids: ["41:before", "42"], restoreGolden: false }];\n',
  });
  const pages = { before: BEFORE, after: AFTER, "": { World: "Chats: 3" } };
  const round = await runOn(order, ["round"], { openHost: async () => stagedHost(pages), guard });
  expect(round.printed).toContain(`${HEAD}: not played whole: stage after was not played\n  - Stage before: passed\n`);
  expect(round.printed).toContain("  - Stage after: not played (the round's order does not place it)\n");
  expect(round.printed).toContain("Played 2 of 25, not played 23; passed 1, failed 0, not seen 0, measured as a rate 0, not played whole 1.");
  expect(round.code).toBe(1);
  const none = proofRoot({
    "scenarios/41-classic-played.ts": stagedFile(TWO_STAGES),
    "scenarios/42-second-run.ts": wholeFile(),
    "round/order.ts": 'export const order = [{ name: "state 1", ids: ["42"], restoreGolden: false }];\n',
  });
  const unplaced = await runOn(none, ["round"], { openHost: async () => stagedHost(pages), guard });
  expect(unplaced.printed).toContain("- Not played (the round's order does not place it: stages before, after): 41\n");
});

test("a stage asked of a scenario that has none, or a name that is no stage's, is named in the report with why and is no fault of what was played", async () => {
  // Scenario 42 played whole, with a stage asked of it beside: 42 passes, and the stage is named as not played.
  const whole = await runOn(root, ["rig", "42", "42:first"], { openHost: async () => stagedHost({ "": { World: "Chats: 3" } }) });
  const read = readBundle(whole.dir);
  expect(read.forms.find((f) => f.id === "42")).toMatchObject({ result: "passed", faults: [] });
  expect(read.faults).toEqual([]);
  expect(whole.printed).toContain("- 42. The run is made a second time: passed");
  expect(whole.printed).toContain("## Asked, and no stage of a scenario played\n\n- 42:first: scenario 42 is played whole, not in stages: ask it as 42\n");
  expect(whole.code).toBe(1);
  // A name that is no stage's beside its scenario's stages, all played and seen: the scenario passes whole, the typo is named.
  const typo = await runOn(root, ["rig", "41:before", "41:after", "41:Before", "41:middle"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }) });
  expect(readBundle(typo.dir).forms.find((f) => f.id === "41")).toMatchObject({ result: "passed", faults: [] });
  expect(typo.printed).toContain(`${HEAD}: passed\n`);
  expect(typo.printed).toContain("- 41:Before: 41:Before is not a stage: a stage is asked as its scenario's number and its name, lowercase words joined by hyphens (40:before)\n");
  expect(typo.printed).toContain("- 41:middle: scenario 41 has no stage middle: its stages are before, after\n");
  expect(typo.code).toBe(1);
});

test("two runs started in one second share a name and not a nonce: a folder moved from one bundle to the other is told", async () => {
  const now = () => new Date("2026-11-15T07:00:00.000Z");
  const one = await runOn(root, ["rig", "42"], { openHost: async () => stagedHost({ "": { World: "Chats: 3" } }), now });
  const two = await runOn(root, ["rig", "42"], { openHost: async () => stagedHost({ "": { World: "Chats: 3" } }), now });
  const names = [one.dir, two.dir].map((dir) => dir.split("/").pop());
  expect(names[0]).toBe(names[1]);
  expect(readBundle(one.dir).run.nonce).not.toBe(readBundle(two.dir).run.nonce);
  // The first run's folder stands in the second's bundle, with no edit at all.
  rmSync(join(two.dir, "42"), { recursive: true });
  cpSync(join(one.dir, "42"), join(two.dir, "42"), { recursive: true });
  const moved = readBundle(two.dir);
  expect(moved.forms.find((f) => f.id === "42")?.faults).toContain("its record carries another run's nonce: it comes from another run that has this run's name");
  expect(moved.forms.find((f) => f.id === "42")?.result).toBe("failed");
});

test("read back, a stage's folder is its own, every part is in one stage, the records agree, and a stage's record is never a whole scenario's", async () => {
  const played = async () => (await runOn(root, ["rig", "41"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }) })).dir;
  const faultsOf = (dir: string) => readBundle(dir).forms.find((f) => f.id === "41")?.faults ?? [];
  // The two stages' folders swapped: each record is of the other stage.
  const swapped = await played();
  renameSync(join(swapped, "41", "before"), join(swapped, "41", "tmp"));
  renameSync(join(swapped, "41", "after"), join(swapped, "41", "before"));
  renameSync(join(swapped, "41", "tmp"), join(swapped, "41", "after"));
  expect(faultsOf(swapped)).toEqual(expect.arrayContaining(["stage before: its record is of stage after, not of stage before", "stage after: its record is of stage before, not of stage after"]));
  expect(readBundle(swapped).forms.find((f) => f.id === "41")?.result).toBe("failed");
  // One stage's record names a part the other holds: in two stages.
  const twice = await played();
  const afterFile = join(twice, "41", "after", "result.json");
  const after = JSON.parse(readFileSync(afterFile, "utf8")) as { parts: unknown[] };
  const before = JSON.parse(readFileSync(join(twice, "41", "before", "result.json"), "utf8")) as { parts: unknown[] };
  writeFileSync(afterFile, JSON.stringify({ ...after, parts: [...after.parts, ...before.parts] }));
  expect(faultsOf(twice)).toContain("part hud-state is in stages before and after: every part is in exactly one stage");
  // Records that do not agree on the scenario's stages.
  const apart = await played();
  const file = join(apart, "41", "before", "result.json");
  const record = JSON.parse(readFileSync(file, "utf8")) as { stage: { name: string; of: string[] } };
  writeFileSync(file, JSON.stringify({ ...record, stage: { name: "before", of: ["before", "after", "third"] } }));
  expect(faultsOf(apart).some((f) => f.startsWith("its stages' records do not agree on its stages: "))).toBe(true);
  // A stage's record put where a scenario played whole keeps its own.
  const whole = await played();
  cpSync(join(whole, "41", "before", "result.json"), join(whole, "41", "result.json"));
  expect(faultsOf(whole).some((f) => f.includes("its record is of stage before, and its folder is that of a form played whole"))).toBe(true);
  expect(readBundle(whole).forms.find((f) => f.id === "41")?.result).toBe("failed");
});

test("a stage's form looking at another stage's part stops, and the part stays unseen in its own stage", async () => {
  const wrong = stagedFile(TWO_STAGES).replace('await play.see("hud-state");', 'await play.see("author-answers");');
  const own = proofRoot({ "scenarios/41-classic-played.ts": wrong });
  const result = await runOn(own, ["rig", "41:before"], { openHost: async () => stagedHost({ before: BEFORE, after: AFTER }) });
  const record = JSON.parse(readFileSync(join(result.dir, "41", "before", "result.json"), "utf8")) as { stops: { why: string }[] };
  expect(record.stops[0]?.why).toBe("its form stopped: part author-answers is seen in stage after, not in this one");
  expect(result.printed).toContain("Failed");
  expect(result.code).toBe(1);
});
