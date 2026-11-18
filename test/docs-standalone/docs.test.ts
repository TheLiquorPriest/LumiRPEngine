// The docs of the standalone build (README.md and docs/), held to what they name: every `rpe` command
// and flag they show is one the command line's own usage text has; every setting they name or write
// in a YAML example is one a reader of the code takes; every shipped file they name is in `guidance/`
// or, under `files/defaults/`, among the harness's own shipped files;
// every link between them reaches a page and a heading that exist. A name renamed or removed in the
// code fails here, where a reader would otherwise copy a line that no longer works. The settings page
// is the generator's own writing of the registry, and each default Appendix D.1 gives is held here.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import type { JsonValue } from "rp-harness/contract";
import { configFacts, renderSettingsDoc, settingsRegistry } from "../../scripts/settings/generate";
import { runCli } from "../../src/app/cli";
import { CONNECTION_PART } from "../../src/app/setting-list";
import { CHAT_DEFAULTS } from "../../src/tree/shipped";

const ROOT = join(import.meta.dir, "../..");
const DOCS = ["README.md", "docs/install.md", "docs/migration.md", "docs/behaviour.md", "docs/settings.md", "docs/security.md", "docs/troubleshooting.md"];
/** Every setting RPE and RPH read, as the app composes its areas' lists. */
const SETTINGS = settingsRegistry();
/** The shipped config file: settings, the files layer's keys (`off`, `layered`, `added`) among them. */
const SHIPPED_CONFIG = Bun.YAML.parse(readFileSync(join(ROOT, "guidance/RPE-global.yml"), "utf8")) as Record<string, unknown>;

/** A key the shipped config file has: a list or a value as it is, or one entry of a mapping (any situation of `added`, whose entries are lists). */
function treeKey(key: string): boolean {
  const [top, entry, ...more] = key.split(".");
  if (top === undefined || !Object.hasOwn(SHIPPED_CONFIG, top) || more.length > 0) return false;
  const value = SHIPPED_CONFIG[top];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return entry === undefined;
  return entry !== undefined && (Object.hasOwn(value, entry) || Object.values(value).every(Array.isArray));
}

/** A page's prose and its fenced blocks, apart, each block with its language. */
function parts(text: string): { prose: string; blocks: { lang: string; body: string }[] } {
  const blocks: { lang: string; body: string }[] = [];
  const prose = text.replace(/^([ \t]*)```(\w*)\n([\s\S]*?)^\1```$/gm, (_all, _indent: string, lang: string, body: string) => {
    blocks.push({ lang, body });
    return "";
  });
  return { prose, blocks };
}

const PAGES = DOCS.map((path) => ({ path, ...parts(readFileSync(join(ROOT, path), "utf8")) }));

/** Every inline code span of every page, with the page it is on. */
const SPANS = PAGES.flatMap((page) => [...page.prose.matchAll(/`([^`\n]+)`/g)].map(([, span]) => ({ path: page.path, span: span ?? "" })));

/** What the command line prints for a line: its output and its errors together. */
async function printed(argv: string[]): Promise<string> {
  const lines: string[] = [];
  const io = {
    out: (line: string) => lines.push(line),
    err: (line: string) => lines.push(line),
    env: {},
    home: "/nonexistent-home",
    now: () => 0,
    secret: async () => null,
    ask: async () => null,
    stopped: () => new Promise<void>(() => {}),
    fetch: async () => {
      throw new Error("no network in this test");
    },
  };
  await runCli(argv, io, { version: "test" });
  return lines.join("\n");
}

/** The usage text, cut into each command's part: from its `rpe <command>` line to the next command's. */
function sections(usage: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of usage.split("\n")) {
    const command = /^\s{0,2}rpe ([a-z]+)/.exec(line)?.[1];
    if (command !== undefined) current = command;
    if (current !== null) out.set(current, `${out.get(current) ?? ""}${line}\n`);
  }
  return out;
}

/** A command line as a page writes it, with `bun <…>/rpe.js` read as `rpe` and each placeholder as one word; null when it is not one of RPE's. */
function rpeLine(text: string): string[] | null {
  const line = text
    .trim()
    .replace(/<[^>]*>/g, "X")
    .replace(/^bun \S*\/rpe\.js(?= |$)/, "rpe");
  return line.startsWith("rpe ") || line === "rpe" ? line.split(/\s+/) : null;
}

/** Every command line the pages show: in inline spans and in their shell blocks. */
function commandLines(): { path: string; line: string; words: string[] }[] {
  const fromSpans = SPANS.flatMap(({ path, span }) => {
    const words = rpeLine(span);
    return words === null ? [] : [{ path, line: span, words }];
  });
  const fromBlocks = PAGES.flatMap((page) =>
    page.blocks
      .filter((b) => b.lang === "sh")
      .flatMap((b) => b.body.split("\n"))
      .flatMap((line) => {
        const words = rpeLine(line);
        return words === null ? [] : [{ path: page.path, line, words }];
      }),
  );
  return [...fromSpans, ...fromBlocks];
}

/** A setting's key as a page may write it: a per-connection key with any connection's name in its place, or one entry of a table. */
function settingMatches(key: string): boolean {
  const parts = key.split(".");
  return SETTINGS.some((def) => {
    const wanted = def.key.split(".");
    const entry = def.takes.type === "table" && parts.length === wanted.length + 1;
    return (wanted.length === parts.length || entry) && wanted.every((w, i) => w === CONNECTION_PART || w === parts[i]);
  });
}

/** config.json's keys: the install's facts. */
const CONFIG_KEYS = new Set(configFacts().map((fact) => fact.key));

/** Every leaf of a YAML mapping, as a dotted key. */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix === "" ? k : `${prefix}.${k}`));
}

/** A heading as a link names it: GitHub's rule. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

describe("the standalone docs", () => {
  test("every command they show is one the command line has, with flags its usage gives that command", async () => {
    const usage = await printed(["--help"]);
    const migrateUsage = await printed(["migrate", "--data", "/nonexistent-home/rpe"]);
    const byCommand = sections(usage);
    byCommand.set("migrate", `${byCommand.get("migrate") ?? ""}${migrateUsage}`);
    const lines = commandLines();
    expect(lines.length).toBeGreaterThan(10);
    const wrong: string[] = [];
    for (const { path, line, words } of lines) {
      const command = words[1];
      if (command === undefined) continue;
      const part = byCommand.get(command);
      if (part === undefined) {
        wrong.push(`${path}: "${line}": no command ${command}`);
        continue;
      }
      // A word after the command (`connection add`, `key web`) is one the usage gives it.
      const sub = words[2];
      if (sub !== undefined && !sub.startsWith("-") && sub !== "X" && !new RegExp(`\\b${sub}\\b`).test(part)) wrong.push(`${path}: "${line}": rpe ${command} has no ${sub}`);
      for (const word of words.slice(2)) {
        const flag = /^--[a-z-]+/.exec(word)?.[0];
        if (flag === undefined || flag === "--data") continue;
        if (!new RegExp(`${flag}(?![a-z-])`).test(part)) wrong.push(`${path}: "${line}": rpe ${command} does not take ${flag}`);
      }
    }
    // A flag named on its own is one some command takes.
    for (const { path, span } of SPANS) {
      const flag = /^--[a-z-]+/.exec(span)?.[0];
      if (flag !== undefined && !new RegExp(`${flag}(?![a-z-])`).test(`${usage}\n${migrateUsage}`)) wrong.push(`${path}: ${flag} is no flag of rpe`);
    }
    expect(wrong).toEqual([]);
  });

  test("the install page names every command the command line has", async () => {
    const commands = [...sections(await printed(["--help"])).keys()];
    expect(commands.length).toBeGreaterThan(10);
    const named = new Set(commandLines().filter((l) => l.path === "docs/install.md").map((l) => l.words[1]));
    expect(commands.filter((c) => !named.has(c))).toEqual([]);
  });

  test("every setting they name is one RPE or its harness reads, or a key of RPE's config file", () => {
    const wrong: string[] = [];
    // A dotted name in code is a setting, unless it is a file's name.
    for (const { path, span } of SPANS) {
      const key = span.replace(/:.*$/, "").trim();
      if (!/^[a-z][A-Za-z]*(\.([A-Za-z]+|<connection>))+$/.test(key) || /\.(json|db|js|md|yml|yaml|ts|service)$/.test(key)) continue;
      if (!settingMatches(key) && !CONFIG_KEYS.has(key) && !treeKey(key)) wrong.push(`${path}: ${key}`);
    }
    // A YAML example sets only settings a reader takes, each to a value it takes.
    for (const page of PAGES) {
      for (const block of page.blocks.filter((b) => b.lang === "yaml")) {
        for (const key of leaves(Bun.YAML.parse(block.body))) if (!settingMatches(key) && !treeKey(key)) wrong.push(`${page.path}: the example sets ${key}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("every shipped file they name is in guidance/, or in the harness's own shipped files under files/defaults/", () => {
    // Named as in the repository (`guidance/…`) or as laid out in a data folder (`files/defaults/…`: RPH's own shipped files, with
    // RPE's laid over them and the chat defaults at its root, as `layShipped` lays them).
    const named = SPANS.filter(({ span }) => span.startsWith("guidance/") || span.startsWith("files/defaults/"));
    const places = (span: string): string[] => {
      const path = span.replace(/[#:].*$/, "");
      if (path.startsWith("guidance/")) return [join(ROOT, path)];
      const below = path.slice("files/defaults/".length);
      return [join(ROOT, "guidance", below), join(ROOT, "guidance", CHAT_DEFAULTS, below), join(SHIPPED_GUIDANCE, below)];
    };
    const missing = named.filter(({ span }) => !places(span).some((at) => existsSync(at)));
    expect(missing.map(({ path, span }) => `${path}: ${span}`)).toEqual([]);
  });

  test("every link between the pages reaches a page and a heading that exist", () => {
    const wrong: string[] = [];
    for (const page of PAGES) {
      for (const [, target] of page.prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (target === undefined || /^[a-z]+:/.test(target)) continue;
        const [file, anchor] = target.split("#");
        const at = file === "" || file === undefined ? join(ROOT, page.path) : resolve(join(ROOT, dirname(page.path)), file);
        if (!existsSync(at)) {
          wrong.push(`${page.path}: ${target}: no such file`);
          continue;
        }
        if (anchor === undefined) continue;
        const headings = [...parts(readFileSync(at, "utf8")).prose.matchAll(/^#+ (.+)$/gm)].map(([, h]) => anchorOf(h ?? ""));
        if (!headings.includes(anchor)) wrong.push(`${page.path}: ${target}: no such heading`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("docs/settings.md is what the generator writes now, and every key the shipped config file sets is a listed setting", () => {
    expect(readFileSync(join(ROOT, "docs/settings.md"), "utf8")).toBe(renderSettingsDoc(SETTINGS, configFacts()));
    expect(leaves(SHIPPED_CONFIG).filter((key) => !settingMatches(key))).toEqual([]);
  });

  test("each setting marked with a D.1 row has the default D.1 gives", () => {
    // Appendix D.1's defaults (plan l.2390-2433), each as the value its setting holds it.
    const D1: Readonly<Record<string, readonly [string, JsonValue]>> = {
      "history.window": ["History window", 40],
      "history.step": ["The window's step", null],
      "history.hold.on": ["Hold a message in the prompt until the record covers it", false],
      "history.hold.maxMessages": ["Hold a message in the prompt until the record covers it", 40],
      "story.soFar.share": ["The story so far, in the briefing", 0.05],
      "story.soFar.minTokens": ["The story so far, in the briefing", 6000],
      "worldState.tokens": ["World state: everything else", 4000],
      "map.laidFeet": ["A grid laid in play", 5],
      "map.roundSeconds": ["A grid laid in play", 6],
      "map.diagonal": ["A grid laid in play", "one"],
      "map.printColumns": ["World state: the map", 40],
      "map.printRows": ["World state: the map", 30],
      "lore.index.bound": ["Lore map, bound entries not in the prompt", 12],
      "lore.index.entriesPerCall": ["Lore indexing, entries per call", 20],
      "limits.turn.calls": ["Calls in a turn across all agents", 40],
      "limits.previousRunSeconds": ["Wait for the previous turn's run", 20],
      "reply.heldSentences": ["Reply held back when a rule that interrupts covers it", 1],
      "rules.judge": ["The model that answers a `question:` rule", null],
      "reply.form": ["How a connection marks its reply", "tags"],
      "reply.lastText": ["When the Author ends with no reply", false],
      "progress.silenceSeconds": ["Thinking block in the chat", 60],
      "reply.tailSentences": ["Sentences shown again to an agent that goes on after a rule stopped it", 3],
      "calls.retries": ["A model call that failed before any answer arrived", 2],
      "calls.silentAfterSeconds": ["A model's answer that goes silent", 300],
      "reply.leadSampling": ["The Author's sampling", "own"],
      "sessions.carry": ["How context is carried in a session", "continuing"],
      "compaction.reserveTokens": ["Compaction starts", 16_384],
      "compaction.keepTurns": ["Compaction starts", 3],
      "compaction.recordsTokens": ["Carried records before folding (records mode)", 6000],
      "cast.comesToMindTokens": ["What comes to mind", 2000],
      "cast.topOfMind": ["Top of mind", 9],
      "cast.shortTermDays": ["Short-term memory", 3],
      "store.snapshotEvery": ["Snapshot", 25],
      "retention.turnFolders": ["Turn folders kept whole", 50],
      "bootstrap.askAtTokens": ["Bootstrap asks before", 200_000],
      "history.hiddenReadable": ["Hidden messages readable by agents", false],
      "server.address": ["RPE listens on", "127.0.0.1"],
      "lumiverse.extension.questionWaitSeconds": ["How long the extension waits for RPE's answer before a generation", 3],
    };
    const marked = SETTINGS.filter((def) => def.row !== undefined).map((def) => [def.key, def.row, def.default]);
    expect(marked.sort()).toEqual(Object.entries(D1).map(([key, [row, value]]) => [key, row, value]).sort());
  });
});
