// The runner (PlanScenarios-1 item 6) with invented scenarios on a fake host: `rig --wave 2` plays
// only the wave-2 one and writes its bundle and report; a live run never starts without the cheap gate
// and the bed's lock, takes the lock before the bed's host is opened and gives it back after, and plays
// an "as shipped" scenario the set number of times, each play on a fresh footing; a play that stops
// leaves what it never reached broken, never passed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LiveGuard } from "../../../scripts/proof/route/host";
import { main } from "../../../scripts/proof/run";
import { fakeHost } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");

let root = "";
let out = "";

const PAGES = {
  World: "Time: dusk. Place: the mill. Coin: 40 silver. Lantern: Oskar",
  Files: "notes/watch.md: the night watch begins at the bell",
  Turn: "Briefing: replies 14 to 15 were made on another connection",
  Story: "Recorded: Oskar paid the ferryman",
  terminal: "$ rpe migrate --rehearse\nreport: 0 writes to disk",
};

/** A scenario file whose parts each look for one text, and whose forms look at every part. */
function scenarioFile(number: number, wave: number, line: number, parts: { id: string; words: string; mark: string; page: string; text: string }[], throwAfter?: string): string {
  const list = parts.map((p) => `{ id: ${JSON.stringify(p.id)}, words: ${JSON.stringify(p.words)}, mark: ${JSON.stringify(p.mark)}, on: [{ page: ${JSON.stringify(p.page)}, check: sees(${JSON.stringify(p.text)}) }] }`).join(", ");
  const looks = parts.map((p) => `await play.see(${JSON.stringify(p.id)});${throwAfter === p.id ? ' throw new Error("the stand-in dropped the chat");' : ""}`).join(" ");
  return `import { scenario } from ${JSON.stringify(FORM)};
const sees = (text: string) => async (look: { read(): Promise<string> }) => ((await look.read()).includes(text) ? { found: true as const, shows: [text] } : { found: false as const, what: "not there: " + text });
export default scenario({ number: ${number}, wave: ${wave}, line: ${line}, parts: [${list}], fixtures: [], bed: [], rig: async (play) => { ${looks} }, live: async (play) => { ${looks} } });
`;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "proof-runner-"));
  out = mkdtempSync(join(tmpdir(), "proof-runner-out-"));
  mkdirSync(join(root, "scenarios"));
  writeFileSync(join(root, "settings.json"), JSON.stringify({ repeats: 10 }));
  writeFileSync(
    join(root, "scenarios/22-delete-two.ts"),
    scenarioFile(22, 2, 1836, [
      { id: "four-values", words: "The four values are as before those turns", mark: "code", page: "World", text: "Coin: 40 silver" },
      { id: "note", words: "a note written in them is back to its earlier text", mark: "code", page: "Files", text: "begins at the bell" },
    ]),
  );
  writeFileSync(
    join(root, "scenarios/38-rehearsal.ts"),
    scenarioFile(38, 1, 1855, [
      {
        id: "unchanged",
        words: "The report. The read-only stand-in logged no write to disk, the two cases where today's own reader would have written included, and RPE's database is unchanged. Run again with today's build stopped: checksums of today's storage are the same before and after",
        mark: "code",
        page: "terminal",
        text: "0 writes to disk",
      },
    ]),
  );
  writeFileSync(
    join(root, "scenarios/26-other-connection.ts"),
    scenarioFile(
      26,
      3,
      1840,
      [
        { id: "range", words: "The briefing gives the range", mark: "code", page: "Turn", text: "replies 14 to 15" },
        { id: "records", words: "the Author records what matters", mark: "as shipped", page: "Story", text: "paid the ferryman" },
      ],
      "range",
    ),
  );
});

afterAll(() => {
  for (const dir of [root, out]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

function bundles(at: string): string[] {
  return existsSync(at) ? readdirSync(at).filter((name) => existsSync(join(at, name, "run.json"))) : [];
}

test("rig --wave 2 plays only the wave-2 scenario and writes its bundle and report", async () => {
  const host = fakeHost("rig", { pages: PAGES });
  const printed: string[] = [];
  const where = join(out, "wave2");
  const code = await main(["rig", "--wave", "2", "--root", root, "--out", where, "--by", "a test"], { openHost: async () => host, out: (text) => printed.push(text) });
  expect(code).toBe(0);
  expect(host.begun.map((b) => [b.form.id, b.play, b.plays])).toEqual([["22", 1, 1]]);
  expect(host.closed).toBe(1);
  const [name] = bundles(where);
  const dir = join(where, name ?? "");
  expect(readdirSync(dir).sort()).toEqual(["22", "report.md", "run.json"]);
  expect(readdirSync(join(dir, "22/play-01")).sort()).toEqual(["files-1440-note.png", "files-390-note.png", "world-1440-four-values.png", "world-390-four-values.png"]);
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  expect(run.asked).toEqual(["02", "04", "05", "12", "16", "17", "18", "19", "20", "21", "22", "23", "34", "59", "67"]);
  expect(run.unplayed).toHaveLength(14);
  expect(run.unplayed[0]).toEqual({ id: "02", why: "no file plays it" });
  expect(run.ended).not.toBeNull();
  const report = readFileSync(join(dir, "report.md"), "utf8");
  expect(report).toContain("- 22. Delete two turns: passed");
  expect(report).toContain("- Not played (no file plays it): 2, 4, 5, 12, 16, 17, 18, 19, 20, 21, 23, 34, 59, 67");
  expect(report).toContain("All 68: played 1 of 68, not played 67, passed 1, failed 0, not seen 0.");
  expect(printed.join("")).toContain(`The bundle: ${dir}`);
});

test("a live run never starts without the gate and the lock, and leaves no bundle when refused", async () => {
  let opened = 0;
  const where = join(out, "refused");
  const printed: string[] = [];
  const openHost = async () => {
    opened++;
    return fakeHost("live", { pages: PAGES });
  };
  expect(await main(["live", "22", "--root", root, "--out", where, "--by", "a test"], { openHost, out: (text) => printed.push(text) })).toBe(1);
  expect(printed.join("")).toContain("Refused: no live run starts without the cheap gate and the bed's lock");
  const held: LiveGuard = { lock: async () => ({ held: true, by: "live-20261115T020000Z" }), admit: async () => ({ ok: true }) };
  expect(await main(["live", "22", "--root", root, "--out", where, "--by", "a test"], { openHost, guard: held, out: (text) => printed.push(text) })).toBe(1);
  expect(printed.join("")).toContain("Refused: the bed is taken by live-20261115T020000Z: one run at a time.");
  let released = 0;
  const unadmitted: LiveGuard = { lock: async () => ({ held: false, release: async () => void released++ }), admit: async () => ({ ok: false, why: "no passing gate is recorded for RPE 0f1e2d3c" }) };
  expect(await main(["live", "22", "--root", root, "--out", where, "--by", "a test"], { openHost, guard: unadmitted, out: (text) => printed.push(text) })).toBe(1);
  expect(printed.join("")).toContain("Refused: the cheap gate does not admit this build: no passing gate is recorded for RPE 0f1e2d3c.");
  expect(released).toBe(1);
  expect(opened).toBe(1);
  expect(bundles(where)).toEqual([]);
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
  const where = join(out, "live");
  const openHost = async () => {
    events.push("open");
    return host;
  };
  const code = await main(["live", "26", "--repeats", "3", "--root", root, "--out", where, "--by", "a test"], { openHost, guard, out: () => {} });
  expect(code).toBe(1);
  expect(events).toEqual(["lock live", "open", "admit 0f1e2d3c", "release"]);
  expect(host.begun.map((b) => [b.form.id, b.play, b.plays])).toEqual([
    ["26", 1, 3],
    ["26", 2, 3],
    ["26", 3, 3],
  ]);
  const [name] = bundles(where);
  const record = JSON.parse(readFileSync(join(where, name ?? "", "26/result.json"), "utf8"));
  expect(record.stops.map((s: { play: number }) => s.play)).toEqual([1, 2, 3]);
  const records = record.parts.find((p: { id: string }) => p.id === "records");
  expect(records.instances.map((i: { outcome: string }) => i.outcome)).toEqual(["broken", "broken", "broken"]);
  expect(records.instances[0].why).toBe("its form stopped: the stand-in dropped the chat, before it was looked for on the Story page");
  const report = readFileSync(join(where, name ?? "", "report.md"), "utf8");
  expect(report).toContain("- 26. Two replies made on another connection, then back: failed");
  expect(report).toContain("  - Play 1 stopped: its form stopped: the stand-in dropped the chat");
  expect(report).toContain('"the Author records what matters": As shipped: 0 of 0 (0 misses); 3 kept out of the rate');
});
