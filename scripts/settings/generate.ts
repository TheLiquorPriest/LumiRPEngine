// `bun scripts/settings/generate.ts` (plan Appendix D.1, §18.4 l.1997; READINGS N-9, N-10): docs/settings.md
// written from the one registry of settings, as the app composes it from its areas' lists (RPH's own
// list among them), and the install's facts config.json holds. The settings stand in the Settings
// page's sections and groups (`groupOf`), and every setting is one row: its default in its unit, where
// it is changed, when a change takes effect, its Appendix D.1 row or "beyond Appendix D.1, for the
// owner's approval", and its name, its line and the advice the page gives past what is usual. The test
// that holds the page to the registry reads it the same way (`test/docs-standalone/docs.test.ts`).

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { JsonValue, LayerLevel } from "rp-harness/contract";
import { compose } from "../../src/app/compose";
import { CONFIG_DEFAULTS, CONFIG_ENV, dataPaths, installFacts, type InstallFact } from "../../src/app/config";
import { gatherSettings } from "../../src/app/hooks";
import { EFFECT_WORDS, groupOf, SECTIONS, type Setting, unitOf } from "../../src/app/setting-list";

const ROOT = resolve(import.meta.dir, "../..");
export const SETTINGS_DOC = join(ROOT, "docs/settings.md");

/** An area that reached for Lumiverse while its list was read would stop the generator here, rather than reach a network. */
function noLumiverse(): never {
  throw new Error("The settings generator reaches no Lumiverse, and an area asked for it while its settings were listed.");
}

/** Every setting RPE and RPH read, in the order the app's areas list them. */
export function settingsRegistry(): Setting[] {
  return gatherSettings(compose({ fetch: async () => noLumiverse(), open: noLumiverse, sleep: async () => noLumiverse() }).areas);
}

/** The install's facts config.json holds, with their defaults. */
export function configFacts(): InstallFact[] {
  return installFacts(CONFIG_DEFAULTS, dataPaths("data")).filter((fact) => fact.from === "config.json");
}

/** A value as a cell writes it: in code, a text as it is, anything else as JSON. */
function shown(value: JsonValue): string {
  return `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
}

/** A setting's default as its row writes it: the value in its unit, or none with what none means. */
export function defaultCell(def: Setting): string {
  const unit = unitOf(def);
  return def.default === null ? `none (${def.none ?? ""})` : `${shown(def.default)}${unit === null ? "" : ` ${unit}`}`;
}

/** Where a setting is changed: the user's RPE-global.yml, and a chat's RPE.yml where it is read at the chat's level. */
function whereWords(levels: readonly LayerLevel[] | undefined): string {
  const read = levels ?? ["shipped", "global", "character", "chat"];
  return read.includes("chat") ? "RPE-global.yml or a chat's RPE.yml" : "RPE-global.yml";
}

/** A cell's text, its own bars kept from ending the cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function row(def: Setting): string {
  const d1 = def.row === undefined ? "beyond Appendix D.1, for the owner's approval" : `Appendix D.1: ${def.row}`;
  const advice = (def.advice ?? []).map((a) => ` ${a.below !== undefined ? `Below ${a.below}` : `Above ${a.above}`}: ${a.says}`).join("");
  return `| \`${def.key}\` | ${cell(defaultCell(def))} | ${whereWords(def.levels)} | ${EFFECT_WORDS[def.effect]} | ${cell(d1)} | ${cell(`${def.name}: ${def.about}${advice}`)} |`;
}

const INTRO = `# Settings

Every setting RPE and its harness read, with its default, where you change it, when a change to it takes effect, and what it does. This page is written from RPE's one list of settings (\`bun scripts/settings/generate.ts\`), and a test holds it to that list: a setting added, removed or given another default fails the test until the page is written again. A setting marked "beyond Appendix D.1" is a value the plan's Appendix D.1 does not give: it is listed for the owner's approval.

## Where settings are written

Settings are written in YAML, in config files under \`files/\` in RPE's data folder:

- \`files/defaults/RPE-global.yml\`: the shipped copy. Read-only.
- \`files/RPE-global.yml\`: yours, for every chat.
- \`RPE.yml\` in a chat's folder: for that chat alone, where a setting's row says it is read there.

They are read in that order, and the nearer file wins, key by key. A dotted key is written as nested keys: \`history.window\` is

\`\`\`yaml
history:
  window: 40
\`\`\`

A value a setting does not take is passed over, with a line in RPE's log naming the file, and the default holds. A bad value never stops a turn. Where a setting allows it, \`~\` means none: a limit lifted, a window that keeps every message.

Each row says when a change is in force: at the setting's next use, from the next turn, or from RPE's next start. The Settings page lists every setting with its value, its default and the file it comes from, and writes one key into a file at a level, keeping your comments.

**Per connection, per agent.** A key with \`<connection>\` in it is set for one model connection at a time, named by its name or its id; one with \`<definition>\`, for one agent definition, named by its name. The Settings page shows each as a table, a row for each connection or agent.

**No hard cap.** A setting takes any value that has a meaning. Past what is usual, its row says what such a value does, and the value is taken.
`;

const TABLE_HEAD = "| Setting | Default | Where | In force | Appendix D.1 | What it does |\n|---|---|---|---|---|---|";

function installSection(facts: readonly InstallFact[]): string {
  const env = `\`${CONFIG_ENV.port}\`, \`${CONFIG_ENV.lumiverseUrl}\` and \`${CONFIG_ENV.lumiverseUser}\``;
  const rows = facts.map((fact) => `| \`${fact.key}\` | ${fact.value === null ? "none" : shown(fact.value)} | ${cell(fact.name)} |`);
  return [
    "## The install: config.json",
    "",
    `\`config.json\` in RPE's data folder holds the install's facts, not settings: which Lumiverse RPE serves and as which user, its database file, the port RPE's connection in Lumiverse points at, and that connection with its models. The command line writes them (\`rpe up\`, \`rpe lumiverse\`); the Settings page lists them and never writes them. ${env} in the environment win over \`port\`, \`lumiverse.url\` and \`lumiverse.user\`. A \`config.json\` of an earlier build that still holds limits has them moved into \`RPE-global.yml\` at RPE's first start, each value kept.`,
    "",
    "| Key | Default | What it is |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** docs/settings.md as the registry and the install's facts give it: a section of the Settings page each, a group of it each. */
export function renderSettingsDoc(settings: readonly Setting[], facts: readonly InstallFact[]): string {
  const body = SECTIONS.flatMap((section) => {
    const groups = new Map<string, Setting[]>();
    for (const def of [...settings].sort((a, b) => groupOf(a).order - groupOf(b).order)) {
      const at = groupOf(def);
      if (at.section === section.title) groups.set(at.group, [...(groups.get(at.group) ?? []), def]);
    }
    if (groups.size === 0) return [];
    return [[`## ${section.title}`, "", section.about, "", ...[...groups].flatMap(([group, defs]) => [`### ${group}`, "", TABLE_HEAD, ...defs.map(row), ""])].join("\n")];
  });
  return [INTRO, ...body, installSection(facts)].join("\n");
}

if (import.meta.main) {
  await writeFile(SETTINGS_DOC, renderSettingsDoc(settingsRegistry(), configFacts()));
  console.log(`Wrote ${SETTINGS_DOC.slice(ROOT.length + 1)} from the registry of settings.`);
}
