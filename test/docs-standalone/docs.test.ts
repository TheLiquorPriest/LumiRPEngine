// The docs of the standalone build (README.md and docs/), held to what they name: every `rpe` command
// and flag they show is one the command line's own usage text has; every setting they name or write
// in a YAML example is one a reader of the code takes; every shipped file they name is in `guidance/`;
// every link between them reaches a page and a heading that exist. A name renamed or removed in the
// code fails here, where a reader would otherwise copy a line that no longer works.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runCli } from "../../src/app/cli";
import { CONFIG_DEFAULTS } from "../../src/app/config";
import { HARNESS_SETTINGS } from "../../src/app/harness-settings";
import { CONNECTION_PART, type SettingDef } from "../../src/app/setting-list";
import { UPDATE_SETTINGS } from "../../src/app/update";
import { CAST_SETTINGS } from "../../src/cast";
import { LORE_SETTINGS } from "../../src/lore";
import { STORE_SETTINGS } from "../../src/store";
import { STORY_SETTINGS } from "../../src/story";
import { CHAT_DEFAULTS } from "../../src/tree/shipped";
import { TREE_SETTINGS } from "../../src/tree/settings";
import { TURN_SETTINGS } from "../../src/turn/settings";

const ROOT = join(import.meta.dir, "../..");
const DOCS = ["README.md", "docs/install.md", "docs/migration.md", "docs/behaviour.md", "docs/settings.md", "docs/security.md", "docs/troubleshooting.md"];
const SETTINGS: readonly SettingDef[] = [...HARNESS_SETTINGS, ...TURN_SETTINGS, ...UPDATE_SETTINGS, ...TREE_SETTINGS, ...CAST_SETTINGS, ...STORY_SETTINGS, ...LORE_SETTINGS, ...STORE_SETTINGS];
/** The shipped config file. Beside settings, it holds the keys RPH's files layer reads (`off`, `layered`, `added`), which are in no settings list. */
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

/** A setting's key as a page may write it: a per-connection key with any connection's name in its place. */
function settingMatches(key: string): boolean {
  const parts = key.split(".");
  return SETTINGS.some((def) => {
    const wanted = def.key.split(".");
    return wanted.length === parts.length && wanted.every((w, i) => w === CONNECTION_PART || w === parts[i]);
  });
}

/** The config file's keys, dotted, from its defaults. */
function configKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => configKeys(v, prefix === "" ? k : `${prefix}.${k}`));
}
const CONFIG_KEYS = new Set(configKeys(CONFIG_DEFAULTS));

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

  test("every shipped file they name is in guidance/", () => {
    // Named as in the repository (`guidance/…`) or as laid out in a data folder (`files/defaults/…`, the chat defaults at its root).
    const named = SPANS.filter(({ span }) => span.startsWith("guidance/") || span.startsWith("files/defaults/"));
    const places = (span: string): string[] => {
      const path = span.replace(/[#:].*$/, "");
      if (path.startsWith("guidance/")) return [join(ROOT, path)];
      const below = path.slice("files/defaults/".length);
      return [join(ROOT, "guidance", below), join(ROOT, "guidance", CHAT_DEFAULTS, below)];
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

  test("the settings page lists every setting, every key of the config file and of the files in force, each with the default the code holds", () => {
    // Its tables, by the section they are in: a row's first cell is a key in code, its second the default.
    const page = parts(readFileSync(join(ROOT, "docs/settings.md"), "utf8")).prose;
    const rows = page.split(/^## /m).flatMap((section) => {
      const title = section.split("\n")[0] ?? "";
      return [...section.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map(([, key, cell]) => ({ title, key: key ?? "", cell: (cell ?? "").trim() }));
    });
    // A default as the page writes it: in code, a text as it is, anything else as JSON.
    const shown = (v: unknown): string => `\`${typeof v === "string" ? v : JSON.stringify(v)}\``;
    // A dotted key's value in a nested mapping.
    const valueIn = (root: unknown, key: string): unknown => key.split(".").reduce<unknown>((at, k) => (at as Record<string, unknown>)[k], root);
    const config = rows.filter((r) => r.title.includes("config.json"));
    const tree = rows.filter((r) => r.title === "Which files are in force");
    const settings = rows.filter((r) => !config.includes(r) && !tree.includes(r));

    expect(settings.map((r) => r.key).sort()).toEqual(SETTINGS.map((d) => d.key).sort());
    for (const r of settings) {
      const def = SETTINGS.find((d) => d.key === r.key);
      const wanted = def === undefined ? "" : def.default === null ? `none (${def.none ?? ""})` : shown(def.default);
      expect({ key: r.key, default: r.cell }).toEqual({ key: r.key, default: wanted });
    }

    expect(config.map((r) => r.key).sort()).toEqual([...CONFIG_KEYS].sort());
    for (const r of config) {
      const at = valueIn(CONFIG_DEFAULTS, r.key);
      expect({ key: r.key, default: r.cell }).toEqual({ key: r.key, default: at === null ? "none" : shown(at) });
    }

    // The shipped config file's keys that are no setting, each entry of a mapping on its own row.
    expect(tree.map((r) => r.key).sort()).toEqual(leaves(SHIPPED_CONFIG).filter((key) => !settingMatches(key)).sort());
    for (const r of tree) expect({ key: r.key, default: r.cell }).toEqual({ key: r.key, default: shown(valueIn(SHIPPED_CONFIG, r.key)) });
  });
});
