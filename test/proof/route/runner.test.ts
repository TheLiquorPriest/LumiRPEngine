// The runner (PlanScenarios-1 item 6) with invented scripts on a fake host. `rig --wave 2` plays only
// the wave-2 scenario and writes its bundle and report. A live run never starts without the cheap gate
// and the bed's lock, takes the lock before the bed's host is opened, gives it back after, and plays an
// "as shipped" scenario the set number of times, each play on a fresh footing. A play that stops
// leaves what it never reached broken, never passed. The runner never plays a script `run.ts check`
// faults, never counts a gate as a scenario, never plays one id twice, never leaves a faulty gate out
// of a wave, writes its report even when closing up fails, and exits non-zero whenever anything asked
// was not played and passed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Host, LiveGuard } from "../../../scripts/proof/route/host";
import { main, type Deps } from "../../../scripts/proof/run";
import { fakeHost } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");

/** Every folder a test made, taken away at the end. */
const made: string[] = [];
let root = "";
let out = "";

const PAGES = {
  World: "Time: dusk. Place: the mill. Coin: 40 silver. Lantern: Oskar",
  Files: "notes/watch.md: the night watch begins at the bell",
  Turn: "Briefing: replies 14 to 15 were made on another connection",
  Story: "Recorded: Oskar paid the ferryman",
  terminal: "$ rpe migrate --rehearse\nreport: 0 writes to disk",
};

type PartSpec = { id: string; words: string; mark: string; page: string; text: string };

/** A scenario file whose parts each look for one text, and whose forms look at every part. */
function scenarioFile(number: number, wave: number, line: number, parts: PartSpec[], throwAfter?: string): string {
  const list = parts.map((p) => `{ id: ${JSON.stringify(p.id)}, words: ${JSON.stringify(p.words)}, mark: ${JSON.stringify(p.mark)}, on: [{ page: ${JSON.stringify(p.page)}, check: sees(${JSON.stringify(p.text)}) }] }`).join(", ");
  const looks = parts.map((p) => `await play.see(${JSON.stringify(p.id)});${throwAfter === p.id ? ' throw new Error("the stand-in dropped the chat");' : ""}`).join(" ");
  return `import { scenario } from ${JSON.stringify(FORM)};
const sees = (text: string) => async (look: { read(): Promise<string> }) => ((await look.read()).includes(text) ? { found: true as const, shows: [text] } : { found: false as const, what: "not there: " + text });
export default scenario({ number: ${number}, wave: ${wave}, line: ${line}, parts: [${list}], fixtures: [], bed: [], rig: async (play) => { ${looks} }, live: async (play) => { ${looks} } });
`;
}

/** A gate file of one part seen on the World page; `fields` is written into the gate's definition as given, so one can be left out or made wrong. */
function gateFile(fields: Record<string, string>): string {
  const body = { id: '"gate-coin"', waves: "[2]", parts: `[{ id: "coin", words: "the coin on the World page", mark: "code", on: [{ page: "World", check: async (look: { read(): Promise<string> }) => ((await look.read()).includes("40 silver") ? { found: true as const, shows: ["40 silver"] } : { found: false as const, what: "no coin" }) }] }]`, fixtures: "[]", bed: "[]", rig: 'async (play: { see(part: string): Promise<void> }) => { await play.see("coin"); }', live: 'async (play: { see(part: string): Promise<void> }) => { await play.see("coin"); }', ...fields };
  const text = Object.entries(body)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `  ${key}: ${value},`)
    .join("\n");
  return `import { gate } from ${JSON.stringify(FORM)};\nexport default gate({\n${text}\n} as never);\n`;
}

const DELETE_TWO: PartSpec[] = [
  { id: "four-values", words: "The four values are as before those turns", mark: "code", page: "World", text: "Coin: 40 silver" },
  { id: "note", words: "a note written in them is back to its earlier text", mark: "code", page: "Files", text: "begins at the bell" },
];

/** A proof folder of its own holding the runner's settings and the files given. */
function proofRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-runner-root-"));
  made.push(dir);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(dir, "scenarios"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

/** Runs the command line on a proof folder; returns its exit code, what it printed, and the bundle it left (empty when none). */
async function runOn(at: string, argv: string[], deps: Deps = {}): Promise<{ code: number; printed: string; dir: string }> {
  const where = join(out, `run-${made.length}-${Math.random().toString(36).slice(2, 8)}`);
  const printed: string[] = [];
  const code = await main([...argv, "--root", at, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), ...deps });
  const [name] = bundles(where);
  return { code, printed: printed.join(""), dir: name ? join(where, name) : "" };
}

function json(dir: string, file: string): { [key: string]: unknown } & { asked: string[]; unplayed: { id: string; why: string }[]; faults: string[] } {
  return JSON.parse(readFileSync(join(dir, file), "utf8"));
}

function why(dir: string, id: string): string | undefined {
  return json(dir, "run.json").unplayed.find((u) => u.id === id)?.why;
}

const liveGuard = (events: string[] = []): LiveGuard => ({
  lock: async () => ({ held: false, release: async () => void events.push("release") }),
  admit: async () => ({ ok: true }),
});

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-runner-out-"));
  made.push(out);
  root = proofRoot({
    "scenarios/22-delete-two.ts": scenarioFile(22, 2, 1836, DELETE_TWO),
    "scenarios/38-rehearsal.ts": scenarioFile(38, 1, 1855, [
      {
        id: "unchanged",
        words: "The report. The read-only stand-in logged no write to disk, the two cases where today's own reader would have written included, and RPE's database is unchanged. Run again with today's build stopped: checksums of today's storage are the same before and after",
        mark: "code",
        page: "terminal",
        text: "0 writes to disk",
      },
    ]),
    "scenarios/26-other-connection.ts": scenarioFile(
      26,
      3,
      1840,
      [
        { id: "range", words: "The briefing gives the range", mark: "code", page: "Turn", text: "replies 14 to 15" },
        { id: "records", words: "the Author records what matters", mark: "as shipped", page: "Story", text: "paid the ferryman" },
      ],
      "range",
    ),
  });
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function bundles(at: string): string[] {
  return existsSync(at) ? readdirSync(at).filter((name) => existsSync(join(at, name, "run.json"))) : [];
}

test("rig --wave 2 plays only the wave-2 scenario and writes its bundle and report; the 14 with no file make the exit non-zero", async () => {
  const host = fakeHost("rig", { pages: PAGES });
  const { code, printed, dir } = await runOn(root, ["rig", "--wave", "2"], { openHost: async () => host });
  expect(code).toBe(1);
  expect(host.begun.map((b) => [b.form.id, b.play, b.plays])).toEqual([["22", 1, 1]]);
  expect(host.closed).toBe(1);
  expect(readdirSync(dir).sort()).toEqual(["22", "report.md", "run.json"]);
  expect(readdirSync(join(dir, "22/play-01")).sort()).toEqual(["files-1440-note.png", "files-390-note.png", "world-1440-four-values.png", "world-390-four-values.png"]);
  const run = json(dir, "run.json");
  expect(run.asked).toEqual(["02", "04", "05", "12", "16", "17", "18", "19", "20", "21", "22", "23", "34", "59", "67"]);
  expect(run.unplayed).toHaveLength(14);
  expect(run.unplayed[0]).toEqual({ id: "02", why: "no file plays it" });
  expect(run.ended).not.toBeNull();
  const report = readFileSync(join(dir, "report.md"), "utf8");
  expect(report).toContain("- 22. Delete two turns: passed");
  expect(report).toContain("- Not played (no file plays it): 2, 4, 5, 12, 16, 17, 18, 19, 20, 21, 23, 34, 59, 67");
  expect(report).toContain("All 68: played 1 of 68, not played 67; passed 1, failed 0, not seen 0, measured as a rate 0.");
  expect(printed).toContain(`The bundle: ${dir}`);
});

test("a live run never starts without the gate and the lock, and leaves no bundle when refused", async () => {
  let opened = 0;
  const openHost = async () => {
    opened++;
    return fakeHost("live", { pages: PAGES });
  };
  const bare = await runOn(root, ["live", "22"], { openHost });
  expect(bare.code).toBe(1);
  expect(bare.printed).toContain("Refused: no live run starts without the cheap gate and the bed's lock");
  const held: LiveGuard = { lock: async () => ({ held: true, by: "live-20261115T020000Z" }), admit: async () => ({ ok: true }) };
  const taken = await runOn(root, ["live", "22"], { openHost, guard: held });
  expect(taken.code).toBe(1);
  expect(taken.printed).toContain("Refused: the bed is taken by live-20261115T020000Z: one run at a time.");
  let released = 0;
  const unadmitted: LiveGuard = { lock: async () => ({ held: false, release: async () => void released++ }), admit: async () => ({ ok: false, why: "no passing gate is recorded for RPE 0f1e2d3c" }) };
  const refused = await runOn(root, ["live", "22"], { openHost, guard: unadmitted });
  expect(refused.code).toBe(1);
  expect(refused.printed).toContain("Refused: the cheap gate does not admit this build: no passing gate is recorded for RPE 0f1e2d3c.");
  expect(released).toBe(1);
  expect(opened).toBe(1);
  expect([bare.dir, taken.dir, refused.dir]).toEqual(["", "", ""]);
});

test("live, an as-shipped scenario is played the set number of times on fresh footing, under the lock, and a play that stops leaves the rest broken", async () => {
  const events: string[] = [];
  const host = fakeHost("live", { pages: PAGES });
  const guard: LiveGuard = {
    lock: async (run) => {
      events.push(`lock ${run.split("-")[0]}`);
      return { held: false, release: async () => void events.push("release") };
    },
    admit: async (facts) => {
      events.push(`admit ${facts.rpe.commit}`);
      return { ok: true };
    },
  };
  const openHost = async () => {
    events.push("open");
    return host;
  };
  const { code, dir } = await runOn(root, ["live", "26", "--repeats", "3"], { openHost, guard });
  expect(code).toBe(1);
  expect(events).toEqual(["lock live", "open", "admit 0f1e2d3c", "release"]);
  expect(host.begun.map((b) => [b.form.id, b.play, b.plays])).toEqual([
    ["26", 1, 3],
    ["26", 2, 3],
    ["26", 3, 3],
  ]);
  const record = JSON.parse(readFileSync(join(dir, "26/result.json"), "utf8"));
  expect(record.stops.map((s: { play: number }) => s.play)).toEqual([1, 2, 3]);
  const records = record.parts.find((p: { id: string }) => p.id === "records");
  expect(records.instances.map((i: { outcome: string; page: string }) => [i.outcome, i.page])).toEqual([
    ["broken", "Story"],
    ["broken", "Story"],
    ["broken", "Story"],
  ]);
  expect(records.instances[0].why).toBe("its form stopped: the stand-in dropped the chat, before it was looked for on the Story page");
  const report = readFileSync(join(dir, "report.md"), "utf8");
  expect(report).toContain("- 26. Two replies made on another connection, then back: failed");
  expect(report).toContain("  - Play 1 stopped: its form stopped: the stand-in dropped the chat");
  expect(report).toContain('"the Author records what matters": As shipped: 0 of 0 (0 misses); 3 kept out of the rate');
});

test("live, a scenario whose as-shipped part was missed in every play is a rate with every miss, never passed", async () => {
  const at = proofRoot({
    "scenarios/26-other-connection.ts": scenarioFile(26, 3, 1840, [
      { id: "range", words: "The briefing gives the range", mark: "code", page: "Turn", text: "replies 14 to 15" },
      { id: "records", words: "the Author records what matters", mark: "as shipped", page: "Story", text: "the boat's name" },
    ]),
  });
  const { code, dir } = await runOn(at, ["live", "26", "--repeats", "3"], { openHost: async () => fakeHost("live", { pages: PAGES }), guard: liveGuard() });
  // A miss of guidance is a finding, not a failure of the run (plan §17.0, Y23).
  expect(code).toBe(0);
  const report = readFileSync(join(dir, "report.md"), "utf8");
  expect(report).toContain("- 26. Two replies made on another connection, then back: measured as a rate: its code passed; as shipped 0 of 3, every play missed");
  expect(report).toContain("All 68: played 1 of 68, not played 67; passed 0, failed 0, not seen 0, measured as a rate 1.");
  expect(report).toContain("    - Missed in play 3: not on the Story page at 390: not there: the boat's name; not on the Story page at 1440: not there: the boat's name. Screens: play-03/story-390-records.png, play-03/story-1440-records.png");
});

test("a script run.ts check faults is never played: a scenario carrying part of its row is refused by its fault, and the exit is non-zero", async () => {
  const at = proofRoot({ "scenarios/22-delete-two.ts": scenarioFile(22, 2, 1836, DELETE_TWO.slice(0, 1)) });
  const host = fakeHost("rig", { pages: PAGES });
  const { code, dir } = await runOn(at, ["rig", "22"], { openHost: async () => host });
  expect(code).toBe(1);
  expect(host.begun).toEqual([]);
  expect(existsSync(join(dir, "22"))).toBe(false);
  expect(why(dir, "22")).toBe(`its script scenarios/22-delete-two.ts is refused: no part carries the plan's words "a note written in them is back to its earlier text"`);
  const report = readFileSync(join(dir, "report.md"), "utf8");
  expect(report).toContain(`- Not played (its script scenarios/22-delete-two.ts is refused: no part carries the plan's words "a note written in them is back to its earlier text"): 22`);
  expect(report).not.toContain("22. Delete two turns: passed");
});

test("two files for one number: neither is played, and both are named", async () => {
  const at = proofRoot({ "scenarios/22-delete-two.ts": scenarioFile(22, 2, 1836, DELETE_TWO), "scenarios/22-again.ts": scenarioFile(22, 2, 1836, DELETE_TWO) });
  const host = fakeHost("rig", { pages: PAGES });
  const { code, dir } = await runOn(at, ["rig", "22"], { openHost: async () => host });
  expect(code).toBe(1);
  expect(host.begun).toEqual([]);
  expect(why(dir, "22")).toBe("2 files play it, so neither is played: scenarios/22-again.ts, scenarios/22-delete-two.ts");
});

test("a gate whose id is a number is refused and never played or counted as that scenario", async () => {
  const at = proofRoot({ "rehearsal/gate.ts": gateFile({ id: '"38"', waves: "[1]" }) });
  const host = fakeHost("rig", { pages: PAGES });
  const byId = await runOn(at, ["rig", "38"], { openHost: async () => host });
  expect(byId.code).toBe(1);
  expect(host.begun).toEqual([]);
  expect(why(byId.dir, "38")).toBe("no file plays it");
  const wave = await runOn(at, ["rig", "--wave", "1"], { openHost: async () => host });
  expect(host.begun).toEqual([]);
  expect(json(wave.dir, "run.json").asked).toEqual(["38", "rehearsal/gate.ts"]);
  expect(why(wave.dir, "rehearsal/gate.ts")).toBe("its script rehearsal/gate.ts is refused: its id 38 has no letter, so it would read as a scenario's number: a gate's id is a name with a letter in it");
  const report = readFileSync(join(wave.dir, "report.md"), "utf8");
  expect(report).not.toContain(": passed");
  expect(report).toContain("- Not played (no file plays it): 38");
});

test("an id asked twice, or placed twice in the round's order, is refused before anything plays", async () => {
  const host = fakeHost("rig", { pages: PAGES });
  const twice = await runOn(root, ["rig", "22", "22"], { openHost: async () => host });
  expect(twice.code).toBe(1);
  expect(twice.printed).toContain("Refused: 22 is asked twice: each id is played once in a run, so ask it once.");
  expect(host.begun).toEqual([]);
  expect(twice.dir).toBe("");
  const at = proofRoot({
    "scenarios/22-delete-two.ts": scenarioFile(22, 2, 1836, DELETE_TWO),
    "round/order.ts": 'export const order = [{ name: "state 1", ids: ["22"], restoreGolden: false }, { name: "state 3", ids: ["22"], restoreGolden: false }];\n',
  });
  const round = await runOn(at, ["round"], { openHost: async () => host, guard: liveGuard() });
  expect(round.code).toBe(1);
  expect(round.printed).toContain('Refused: the round\'s order places 22 twice ("state 1", "state 3"): each id is played once in a run.');
  expect(host.begun).toEqual([]);
});

test("a faulty gate is never left out of --wave or --all: it is listed as not played with its fault, and the exit is non-zero", async () => {
  const at = proofRoot({
    "scenarios/22-delete-two.ts": scenarioFile(22, 2, 1836, DELETE_TWO),
    "zoom/gate.ts": gateFile({ id: '"gate-zoom"', live: "" }),
    "late/gate.ts": gateFile({ id: '"gate-late"', waves: "[3]", live: "" }),
    "broken/gate.ts": 'throw new Error("a reader this gate imports is missing");\n',
  });
  const host = fakeHost("rig", { pages: PAGES });
  const two = await runOn(at, ["rig", "--wave", "2"], { openHost: async () => host });
  expect(two.code).toBe(1);
  const asked = json(two.dir, "run.json").asked;
  expect(asked).toContain("gate-zoom");
  expect(asked).toContain("broken/gate.ts");
  expect(asked).not.toContain("gate-late");
  expect(why(two.dir, "gate-zoom")).toBe("its script zoom/gate.ts is refused: it has no live form");
  expect(why(two.dir, "broken/gate.ts")).toBe("it is a gate that does not load, so its id and waves cannot be read: broken/gate.ts: a reader this gate imports is missing");
  const report = readFileSync(join(two.dir, "report.md"), "utf8");
  expect(report).toContain("- Not played (its script zoom/gate.ts is refused: it has no live form): gate-zoom");
  expect(report).toContain("- Not played (it is a gate that does not load, so its id and waves cannot be read: broken/gate.ts: a reader this gate imports is missing): broken/gate.ts");
  const all = await runOn(at, ["rig", "--all"], { openHost: async () => host });
  expect(all.code).toBe(1);
  expect(json(all.dir, "run.json").asked).toEqual(expect.arrayContaining(["gate-zoom", "gate-late", "broken/gate.ts"]));
});

test("asked by its id, a gate that does not load is said to be a gate that does not load", async () => {
  const at = proofRoot({ "floor/gate.ts": 'throw new Error("no module named ./lib/record");\n' });
  const { code, dir } = await runOn(at, ["rig", "floor"], { openHost: async () => fakeHost("rig", { pages: PAGES }) });
  expect(code).toBe(1);
  expect(why(dir, "floor")).toBe("it is a gate that does not load: floor/gate.ts: no module named ./lib/record");
});

test("a report is written when the host cannot be closed or the lock cannot be given back; the run says so and exits non-zero", async () => {
  const stubborn: Host = { ...fakeHost("rig", { pages: PAGES }), close: async () => Promise.reject(new Error("the stand-in would not stop")) };
  const closing = await runOn(root, ["rig", "22"], { openHost: async () => stubborn });
  expect(closing.code).toBe(1);
  expect(existsSync(join(closing.dir, "report.md"))).toBe(true);
  expect(json(closing.dir, "run.json").faults).toEqual(["the rig could not be closed after the run: the stand-in would not stop"]);
  expect(readFileSync(join(closing.dir, "report.md"), "utf8")).toContain("- The run: the rig could not be closed after the run: the stand-in would not stop");
  const sticky: LiveGuard = { lock: async () => ({ held: false, release: async () => Promise.reject(new Error("the lock file is read-only")) }), admit: async () => ({ ok: true }) };
  const releasing = await runOn(root, ["live", "22"], { openHost: async () => fakeHost("live", { pages: PAGES }), guard: sticky });
  expect(releasing.code).toBe(1);
  expect(json(releasing.dir, "run.json").faults).toEqual(["the bed's lock could not be given back after the run: the lock file is read-only"]);
  expect(existsSync(join(releasing.dir, "report.md"))).toBe(true);
});

test("--wave with no value, an option the command does not take, and an option with no value are usage errors", async () => {
  const host = fakeHost("rig", { pages: PAGES });
  const printed: string[] = [];
  const last = await main(["rig", "--root", root, "--out", join(out, "unused"), "--by", "a test", "--wave"], { openHost: async () => host, out: (text) => printed.push(text) });
  expect(last).toBe(2);
  expect(printed.join("")).toContain("--wave needs a wave from 0 (the ground) to 5 (the formal round)");
  const between = await runOn(root, ["rig", "--wave"], { openHost: async () => host });
  expect(between.code).toBe(2);
  expect(between.printed).toContain("--wave needs a wave from 0 (the ground) to 5 (the formal round)");
  const typo = await runOn(root, ["rig", "22", "--repaets", "3"], { openHost: async () => host });
  expect(typo.code).toBe(2);
  expect(typo.printed).toContain("The command rig takes no option --repaets.");
  expect(host.begun).toEqual([]);
  expect(existsSync(join(out, "unused"))).toBe(false);
});
