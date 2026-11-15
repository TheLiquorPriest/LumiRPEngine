// Today's settings into RPE's config (STANDALONE-PLAN §15.2, "Your settings" and "The runtime's own
// settings"): each of today's settings that RPE has a setting of the same meaning for is in
// `RPE-global.yml`, its value converted where the unit differs; one whose like setting in RPE means
// something else, or takes no such value, is listed as not carried, with why; every other one is
// listed by name as having no setting of the same meaning in RPE yet. None is dropped silently.
// Every name and value is invented.

import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataPaths } from "../../src/app/config";
import { withKeyAt } from "../../src/app/yaml";
import { migrate } from "../../src/migrate/migrate";
import { type MigrationReport, reportText } from "../../src/migrate/report";
import { buildFixture, CHAT, type Fixture, STRAY } from "./fixture";
import { TREE as tree } from "./tree";

/** LumiAH's settings as a user changed them: values put whole at a path of its sections, a deeper one standing over a group put above it. */
const LUMIAH_OWN = [
  { path: ["core", "agents", "main", "effort"], value: "high" },
  { path: ["core", "story", "hidden"], value: "include" },
  { path: ["core", "turn"], value: { tokensIn: 300_000, tokensOut: 20_000, toolTurns: 30, wallMs: 180_000 } },
  { path: ["core", "delegation", "depth"], value: 1 },
  { path: ["core", "delegation", "perRun"], value: null },
  { path: ["core", "delegation", "atOnce"], value: 2 },
  { path: ["core", "loop", "clipChars"], value: 9_000 },
  { path: ["core", "session", "keepTurns"], value: 5 },
  { path: ["core", "session", "summarizeAtTokens"], value: 50_000 },
  { path: ["core", "jobs", "atOnce"], value: 3 },
  { path: ["core", "jobs", "perRun"], value: 4 },
  { path: ["core", "jobs", "tokensPerDay"], value: 5_000_000 },
  { path: ["core", "jobs", "budget"], value: { tokensIn: 400_000, tokensOut: 40_000, toolTurns: 50, wallMs: 90_500 } },
  { path: ["core", "spend", "cachedWeight"], value: 0.2 },
  { path: ["core", "reply", "progress"], value: false },
  { path: ["transport", "history"], value: { keep: "last", count: 30 } },
  { path: ["transport", "history", "keep"], value: "all" },
  { path: ["transport", "connections", "oneToolAtATime"], value: ["conn-1"] },
  { path: ["transport", "mcp", "callMs"], value: 60_000 },
];

/** Today's settings files in the fixture, as a user who changed `own` of LumiAH's left them: and the engine's Settings → Time with its conversation tick at one minute. */
async function changeToday(fixture: Fixture, own: readonly { path: string[]; value: unknown }[] = LUMIAH_OWN): Promise<void> {
  const lumiah = join(fixture.userFolder, "harness/settings.json");
  await writeFile(lumiah, JSON.stringify({ ...(JSON.parse(await readFile(lumiah, "utf8")) as object), own }));
  const engine = join(fixture.userFolder, "settings.json");
  await writeFile(engine, JSON.stringify({ ...(JSON.parse(await readFile(engine, "utf8")) as object), time: { sceneTicks: { conversation: 1, travel: 30 }, scale: 1 } }));
}

async function run(fixture: Fixture, data: string, hour: number): Promise<MigrationReport> {
  const done = await migrate(fixture.sources, { data, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
  expect(done.ran).toBe(true);
  return done.report;
}

/** The value at a dotted key of the user's RPE-global.yml; undefined where the file sets none. */
async function setIn(data: string, key: string): Promise<unknown> {
  let at: unknown = Bun.YAML.parse(await readFile(dataPaths(data).globalConfig, "utf8"));
  for (const part of key.split(".")) at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[part] : undefined;
  return at;
}

const lumiah = (path: string): string => `harness/settings.json: ${path}`;
const global = (key: string): string => `RPE-global.yml: ${key}`;

describe("today's settings into RPE's config", () => {
  test("each of today's settings is carried, converted where the unit differs, or named as not carried, with why where RPE's like setting means something else", async () => {
    const fixture = await buildFixture("operator");
    try {
      await rm(join(fixture.userFolder, STRAY));
      await changeToday(fixture);
      const data = join(fixture.root, "rpe-data");
      const report = await run(fixture, data, 9);

      // In RPE-global.yml: each value as RPE's setting takes it; milliseconds as seconds; every message kept as ~; today's update choice as RPE's.
      const carriedKeys = { "chat.hiddenReadable": true, "limits.turn.tokensOut": 20_000, "limits.turn.time": 180, "limits.turn.depth": 1, "limits.turn.agents": null, "results.clip": 9_000, "compaction.keepTurns": 5, "jobs.atOnce": 3, "jobs.perRun": 4, "jobs.run.tokensOut": 40_000, "history.window": null, "update.restart": true };
      for (const [key, value] of Object.entries(carriedKeys)) expect({ key, value: await setIn(data, key) }).toEqual({ key, value });
      for (const key of ["limits.turn.tokensIn", "limits.turn.calls", "jobs.run.tokensIn", "jobs.run.calls", "jobs.run.time", "jobs.tokensPerDay", "jobs.cachedWeight", "progress"]) expect({ key, value: await setIn(data, key) }).toEqual({ key, value: undefined });

      const settings = report.carried?.settings;
      if (settings === undefined) throw new Error("a real run carries the settings");
      expect([...settings.carried].sort((a, b) => a.from.localeCompare(b.from))).toEqual([
        { from: lumiah("core.delegation.depth"), to: global("limits.turn.depth") },
        { from: lumiah("core.delegation.perRun"), to: global("limits.turn.agents") },
        { from: lumiah("core.jobs.atOnce"), to: global("jobs.atOnce") },
        { from: lumiah("core.jobs.budget.tokensOut"), to: global("jobs.run.tokensOut") },
        { from: lumiah("core.jobs.perRun"), to: global("jobs.perRun") },
        { from: lumiah("core.loop.clipChars"), to: global("results.clip") },
        { from: lumiah("core.session.keepTurns"), to: global("compaction.keepTurns") },
        { from: lumiah("core.story.hidden"), to: global("chat.hiddenReadable") },
        { from: lumiah("core.turn.tokensOut"), to: global("limits.turn.tokensOut") },
        { from: lumiah("core.turn.wallMs"), to: global("limits.turn.time") },
        { from: lumiah("transport.connections.oneToolAtATime"), to: global("models, serialTools on each connection named") },
        { from: lumiah("transport.history.count"), to: global("history.window") },
        { from: lumiah("transport.history.keep"), to: global("history.window") },
        { from: "runtime home: autoUpdate", to: global("update.restart") },
      ]);
      const cached = "today's counted a token read again from a provider's cache as a share of one (core.spend.cachedWeight); RPE's counts every token sent in full";
      const rounds = "today's counted the answers that called tools; RPE's counts every model call";
      expect([...(settings.notCarried ?? [])].sort((a, b) => a.from.localeCompare(b.from))).toEqual([
        { from: lumiah("core.jobs.budget.tokensIn"), to: "jobs.run.tokensIn", why: cached },
        { from: lumiah("core.jobs.budget.toolTurns"), to: "jobs.run.calls", why: rounds },
        { from: lumiah("core.jobs.budget.wallMs"), to: "jobs.run.time", why: "jobs.run.time takes a whole number, at least 1, or ~ for no limit, not 90.5." },
        { from: lumiah("core.jobs.tokensPerDay"), to: "jobs.tokensPerDay", why: "today's counted the tokens of any 24 hours; RPE's counts those of the user's day" },
        { from: lumiah("core.reply.progress"), to: "progress.show", why: "today's, off, showed no progress line; RPE's least still shows the one that keeps a silent turn alive" },
        { from: lumiah("core.spend.cachedWeight"), to: "jobs.cachedWeight", why: "today's weighed every limit on tokens sent by it; RPE's weighs only the jobs' tokens of the user's day" },
        { from: lumiah("core.turn.tokensIn"), to: "limits.turn.tokensIn", why: cached },
        { from: lumiah("core.turn.toolTurns"), to: "limits.turn.calls", why: rounds },
      ]);

      // The whole list of today's settings, each named once: carried, not carried with why, or with no setting of the same meaning in RPE yet.
      const named = [...settings.carried.map((s) => s.from), ...(settings.keptInRpe ?? []).map((s) => s.from), ...(settings.notCarried ?? []).map((s) => s.from), ...settings.noHome];
      expect(named.length).toBe(new Set(named).size);
      expect(new Set(named)).toEqual(
        new Set([
          ...["core.agents.main.effort", "core.story.hidden", "core.turn.tokensIn", "core.turn.tokensOut", "core.turn.toolTurns", "core.turn.wallMs", "core.delegation.depth", "core.delegation.perRun", "core.delegation.atOnce", "core.loop.clipChars", "core.session.keepTurns", "core.session.summarizeAtTokens", "core.jobs.atOnce", "core.jobs.perRun", "core.jobs.tokensPerDay", "core.jobs.budget.tokensIn", "core.jobs.budget.tokensOut", "core.jobs.budget.toolTurns", "core.jobs.budget.wallMs", "core.spend.cachedWeight", "core.reply.progress", "transport.history.keep", "transport.history.count", "transport.connections.oneToolAtATime", "transport.mcp.callMs"].map(lumiah),
          ...["defaults", "helper", "agents", "story", "prompts", "time"].map((key) => `settings.json: ${key}`),
          `runs/${CHAT.classic}/prefs.json: mapDisplay`,
          `runs/${CHAT.classic}/prefs.json: tidyLeft`,
          "harness/story.json: jobs",
          ...["knowledge", "narrator"].map((key) => `chat ${CHAT.classic}'s own choice: ${key}`),
          `chat ${CHAT.branch}'s own choice: knowledge`,
          "runtime home: tuning",
          "runtime home: memory",
          "runtime home: autoUpdate",
        ]),
      );
      // The round's own example: today's conversation tick seeds chats started from now on; RPE has no setting for it, so it is named, not carried.
      expect(settings.noHome).toContain("settings.json: time");

      const text = reportText(report);
      expect(text).toContain("  harness/settings.json: core.turn.wallMs → RPE-global.yml: limits.turn.time");
      expect(text).toContain("\nSettings RPE has a like setting for that means something else or takes no such value, not carried (kept in the backup):\n");
      expect(text).toContain(`\n  harness/settings.json: core.jobs.budget.tokensIn (RPE's jobs.run.tokensIn: ${cached})\n`);
      expect(text).toContain("Your settings: RPE-global.yml: 14 setting(s) carried; 8 not carried, as RPE's like setting means something else or takes no such value; ");
    } finally {
      await fixture.remove();
    }
  });

  test("a later run takes today's changes into a carried setting only while RPE's value is still the one a run put there; a limit lifted today is lifted in RPE", async () => {
    const fixture = await buildFixture("operator");
    try {
      await rm(join(fixture.userFolder, STRAY));
      await changeToday(fixture);
      const data = join(fixture.root, "rpe-data");
      await run(fixture, data, 9);
      // In RPE since: the tool answers clipped shorter.
      const config = dataPaths(data).globalConfig;
      await writeFile(config, withKeyAt(await readFile(config, "utf8"), ["results", "clip"], 5_000, config));
      // On today's side since: the clip, the summaries' kept turns and the turn's time, each changed; the turn's time lifted.
      await changeToday(fixture, [
        ...LUMIAH_OWN.filter((p) => !["core.loop.clipChars", "core.session.keepTurns", "core.turn"].includes(p.path.join("."))),
        { path: ["core", "loop", "clipChars"], value: 8_000 },
        { path: ["core", "session", "keepTurns"], value: 4 },
        { path: ["core", "turn"], value: { tokensIn: 300_000, tokensOut: 20_000, toolTurns: 30, wallMs: null } },
      ]);
      const second = await run(fixture, data, 10);

      // RPH's limits.turn.time takes `~`, so the turn's time lifted today is written as `~`.
      expect({ clip: await setIn(data, "results.clip"), keepTurns: await setIn(data, "compaction.keepTurns"), time: await setIn(data, "limits.turn.time") }).toEqual({ clip: 5_000, keepTurns: 4, time: null });
      const settings = second.carried?.settings;
      expect(settings?.keptInRpe).toEqual([{ from: lumiah("core.loop.clipChars"), to: global("results.clip") }]);
      expect(settings?.carried).toEqual(expect.arrayContaining([{ from: lumiah("core.session.keepTurns"), to: global("compaction.keepTurns") }, { from: lumiah("core.turn.wallMs"), to: global("limits.turn.time") }]));
      expect(reportText(second)).toContain("  RPE-global.yml: results.clip (today's harness/settings.json: core.loop.clipChars)");
    } finally {
      await fixture.remove();
    }
  });
});
