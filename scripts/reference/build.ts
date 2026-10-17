// The authors' reference: docs/REFERENCE.md, generated from what the engine and its packs register.
//
//   bun scripts/reference/build.ts            writes docs/REFERENCE.md
//   bun scripts/reference/build.ts --check    exits 1 when the committed file differs from a fresh build
//
// Each pack registers into a recorder, so every kind, effect, formula, event, proposal, panel, slot
// and lint code is listed under the pack that contributes it. The reference says only what the
// registry holds: names, types, bounds, defaults, formulas and arguments; descriptions it lacks are
// left out. Everything is sorted, so a change to a pack is a small diff here.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_SECTIONS } from "../../src/backend/book";
import { CORE_EFFECTS } from "../../src/engine/effects";
import { coreEventTypes } from "../../src/engine/events";
import { MATH_FUNCTIONS } from "../../src/engine/expr";
import type { CoreRegistry, EventGuardDef, MaterializerDef, PackDef, ProcessDef, ProposalChannelDef, TableDef } from "../../src/engine/registry";
import { createRegistry } from "../../src/engine/registry-impl";
import { BUILTIN_FUNCTIONS } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";
import { ADJUDICATION_PRESETS } from "../../src/shared/adjudication";
import { BANDS, DOMAINS, INTERRUPT_CLASSES } from "../../src/shared/ids";
import { STEP_OUTPUTS, STEP_PLACEHOLDERS, STEP_SIGNALS } from "../../src/shared/steps";
import { BAND_LABEL } from "../../src/shared/tiers";
import type { ActionDef, FieldDef, KindDef, RelationTypeDef, RuleDef, ScheduleDef } from "../../src/shared/world";
import { BUILTIN_RELATIONS, EFFECT_ONLY_FUNCTIONS, ENGINE_VERSION, WORLD_FORMAT } from "../../src/shared/world";

const ROOT = resolve(import.meta.dir, "../..");
export const REFERENCE_PATH = join(ROOT, "docs/REFERENCE.md");

type Formula = (...args: never[]) => unknown;

/** Everything one pack registers, as its `register` hands it over. */
interface PackRecord {
  pack: PackDef;
  kinds: KindDef[];
  relations: RelationTypeDef[];
  events: string[];
  guards: string[];
  effects: { type: string; args: readonly string[] }[];
  formulas: { name: string; fn: Formula }[];
  slots: string[];
  actions: ActionDef[];
  rules: RuleDef[];
  schedules: ScheduleDef[];
  tables: TableDef[];
  materializers: MaterializerDef[];
  processes: ProcessDef[];
  proposals: ProposalChannelDef[];
  lints: string[];
  panels: string[];
}

function record(pack: PackDef): PackRecord {
  const out: PackRecord = { pack, kinds: [], relations: [], events: [], guards: [], effects: [], formulas: [], slots: [], actions: [], rules: [], schedules: [], tables: [], materializers: [], processes: [], proposals: [], lints: [], panels: [] };
  const recorder: CoreRegistry = {
    kind: (def) => void out.kinds.push(def),
    relation: (def) => void out.relations.push(def),
    event: (def) => void out.events.push(def.type),
    guard: (def: EventGuardDef) => void out.guards.push(def.type),
    effect: (def) => void out.effects.push({ type: def.type, args: def.args }),
    service: () => undefined,
    query: () => undefined,
    formula: (name, fn) => void out.formulas.push({ name, fn }),
    renderer: (def) => void out.slots.push(def.slot),
    action: (def) => void out.actions.push(def),
    rule: (def) => void out.rules.push(def),
    schedule: (def) => void out.schedules.push(def),
    table: (def) => void out.tables.push(def),
    materializer: (def) => void out.materializers.push(def),
    process: (def) => void out.processes.push(def),
    proposal: (def) => void out.proposals.push(def),
    lint: (rule) => void out.lints.push(rule.code),
    view: (def) => void out.panels.push(def.panel),
  };
  pack.register(recorder);
  return out;
}

// ---------------------------------------------------------------- formatting

/** Code-point order, so the output never depends on the machine's locale. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => byText(key(a), key(b)));
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort(byText);
}

function code(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.includes("`") ? `\`\` ${flat} \`\`` : `\`${flat}\``;
}

function json(value: unknown): string {
  return code(JSON.stringify(value));
}

/** A Markdown table; a `|` inside a cell (a formula's `||`) is escaped. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`)];
}

function codes(items: readonly string[]): string {
  return items.length === 0 ? "none" : items.map(code).join(", ");
}

/**
 * A registered formula's parameters as its source names them, without the read context. The
 * registry keeps formulas as plain functions, so their own parameter names are what it can say.
 */
function formulaParams(fn: Formula): string[] {
  const src = fn.toString().trimStart();
  const open = src.indexOf("(");
  const arrow = src.indexOf("=>");
  if (open < 0 || (arrow >= 0 && arrow < open)) return [];
  const close = src.indexOf(")", open);
  return src
    .slice(open + 1, close)
    .split(",")
    .map((p) => p.trim().replace(/\s*[=:].*$/, ""))
    .filter((p) => p !== "")
    .slice(1);
}

// ---------------------------------------------------------------- parts

function fieldType(f: FieldDef): string {
  switch (f.type) {
    case "enum":
      return `enum: ${(f.values ?? []).join(", ")}`;
    case "ref":
      return f.ref ? `ref → ${f.ref}` : "ref";
    case "list":
      return f.of ? `list of ${f.of}` : "list";
    default:
      return f.table ? `${f.type} (row of ${f.table})` : f.type;
  }
}

function fieldBounds(f: FieldDef): string {
  const parts: string[] = [];
  if (f.min !== undefined && f.max !== undefined) parts.push(`${f.min} … ${f.max}`);
  else if (f.min !== undefined) parts.push(`≥ ${f.min}`);
  else if (f.max !== undefined) parts.push(`≤ ${f.max}`);
  if (f.pool) parts.push(`pool: max ${f.pool.max}${f.pool.min !== undefined ? `, min ${f.pool.min}` : ""}${f.pool.recover !== undefined ? `, recover ${f.pool.recover}` : ""}`);
  return parts.join("; ");
}

function fieldNotes(f: FieldDef): string {
  const notes: string[] = [];
  if (f.domain !== undefined) notes.push(`live from ${f.domain} ${f.level ?? 0}`);
  if (f.locked) notes.push("locked");
  if (f.bound) notes.push(`bound ${f.bound.mode}${f.bound.maxDelta !== undefined ? `, ±${f.bound.maxDelta} a turn` : ""}`);
  if (f.bands && f.bands.length > 0) notes.push(`bands: ${f.bands.map((b) => b.label).join(", ")}`);
  return notes.join("; ");
}

function kindSection(k: KindDef): string[] {
  const head = [`#### ${code(k.id)}: ${k.label}`, ""];
  if (k.extends) head.push(`Extends ${code(k.extends)}.`, "");
  const fields = sortedBy(Object.entries(k.fields), ([id]) => id);
  if (fields.length === 0) return [...head, "No fields of its own.", ""];
  const rows = fields.map(([id, f]) => [code(id), f.label ?? "", fieldType(f), fieldBounds(f), f.default === undefined ? "" : json(f.default), f.derived === undefined ? "" : code(f.derived), f.visibility === undefined ? "" : `${f.visibility}${f.knownBy ? ` ${json(f.knownBy)}` : ""}`, fieldNotes(f)]);
  return [...head, ...table(["Field", "Label", "Type", "Bounds", "Default", "Derived", "Visibility", "Notes"], rows), ""];
}

function relationRows(relations: readonly RelationTypeDef[]): string[] {
  const rows = sortedBy(relations, (r) => r.id).map((r) => [code(r.id), r.label, code(r.from), code(r.to), r.cardinality, r.symmetric ? "yes" : "", r.inverse ? code(r.inverse) : "", codes(Object.keys(r.fields).sort(byText))]);
  return table(["Relation", "Label", "From", "To", "Cardinality", "Symmetric", "Inverse", "Fields"], rows);
}

function effectRows(effects: readonly { type: string; args: readonly string[] }[]): string[] {
  return table(["Effect", "Arguments"], sortedBy(effects, (e) => e.type).map((e) => [code(e.type), e.args.length === 0 ? "none" : e.args.map(code).join(", ")]));
}

function formulaRows(formulas: readonly { name: string; fn: Formula }[]): string[] {
  return sortedBy(formulas, (f) => f.name).map((f) => `- ${code(`${f.name}(${formulaParams(f.fn).join(", ")})`)}`);
}

function actionRows(actions: readonly ActionDef[]): string[] {
  const rows = sortedBy(actions, (a) => a.id).map((a) => {
    const params = Object.entries(a.params).map(([name, p]) => `${name}${p.optional ? "?" : ""}: ${p.type === "ref" && p.ref ? `ref → ${p.ref}` : p.type}`);
    const check = a.check === undefined ? "" : typeof a.check === "string" ? code(a.check) : code(a.check.dice);
    return [code(a.id), a.label, params.length === 0 ? "" : params.map(code).join(", "), check, codes(Object.keys(a.outcomes).sort(byText)), code(a.duration), (a.lexicon ?? []).join(", ")];
  });
  return table(["Action", "Label", "Parameters", "Check", "Outcomes", "Minutes", "Lexicon"], rows);
}

function tableRows(tables: readonly TableDef[]): string[] {
  const rows = sortedBy(tables, (t) => t.id).map((t) => [code(t.id), t.defaults?.label ?? "", code(t.schema), Object.entries(t.columns).map(([name, c]) => `${name} (${c.type}${c.optional ? ", optional" : ""})`).join(", "), t.defaults ? String(Object.keys(t.defaults.rows).length) : "none"]);
  return table(["Table", "Label", "Schema", "Columns", "Default rows"], rows);
}

function packSection(rec: PackRecord): string[] {
  const { pack } = rec;
  const out: string[] = [`## ${pack.label} pack (${code(pack.id)})`, ""];
  out.push(`Version ${pack.version} · realism domain ${pack.domain === null ? "none" : code(pack.domain)} · requires ${codes([...pack.requires].sort(byText))}.`, "");
  if (rec.kinds.length > 0) out.push("### Kinds", "", ...sortedBy(rec.kinds, (k) => k.id).flatMap(kindSection));
  if (rec.relations.length > 0) out.push("### Relation types", "", ...relationRows(rec.relations), "");
  if (rec.effects.length > 0) out.push("### Effects", "", ...effectRows(rec.effects), "");
  if (rec.formulas.length > 0) out.push("### Formula functions", "", ...formulaRows(rec.formulas), "");
  if (rec.actions.length > 0) out.push("### Actions", "", ...actionRows(rec.actions), "");
  if (rec.rules.length > 0) out.push("### Rules", "", ...sortedBy(rec.rules, (r) => r.id).map((r) => `- ${code(r.id)}: on ${json(r.on)}`), "");
  if (rec.schedules.length > 0) out.push("### Schedules", "", ...sortedBy(rec.schedules, (s) => s.id).map((s) => `- ${code(s.id)}: sets ${code(s.target)} every ${s.recurrence.every}`), "");
  if (rec.events.length > 0 || rec.guards.length > 0) {
    out.push("### Events", "");
    if (rec.events.length > 0) out.push(`Its own: ${codes(unique(rec.events))}.`, "");
    if (rec.guards.length > 0) out.push(`Checks it adds to: ${codes(unique(rec.guards))}.`, "");
  }
  if (rec.proposals.length > 0) out.push("### Proposals", "", ...table(["Proposal", "Bound by"], sortedBy(rec.proposals, (p) => p.type).map((p) => [code(p.type), code(p.boundField)])), "");
  if (rec.panels.length > 0 || rec.slots.length > 0) out.push("### Panels and slots", "", `Panels: ${codes(unique(rec.panels))}. Slots it writes: ${codes(unique(rec.slots))}.`, "");
  if (rec.processes.length > 0 || rec.materializers.length > 0) {
    out.push("### Simulation", "");
    if (rec.processes.length > 0) out.push(...table(["Process", "Domain", "From level", "Steps"], sortedBy(rec.processes, (p) => p.id).map((p) => [code(p.id), code(p.domain), String(p.minLevel), p.scope === "agent" ? "each agent" : "the world"])), "");
    if (rec.materializers.length > 0) out.push(`Detail on demand: ${sortedBy(rec.materializers, (m) => m.domain).map((m) => `${code(m.domain)} (version ${m.version})`).join(", ")}.`, "");
  }
  if (rec.tables.length > 0) out.push("### Data tables", "", ...tableRows(rec.tables), "");
  if (rec.lints.length > 0) out.push("### Lint codes", "", `${codes(unique(rec.lints))}.`, "");
  return out;
}

function builtInSection(engine: PackRecord): string[] {
  const reg = createRegistry(ALL_PACKS);
  const coreEvents = coreEventTypes(() => reg).map((e) => e.type);
  const out: string[] = ["## Engine built-ins", ""];
  out.push("### Core effects", "", ...effectRows(Object.entries(CORE_EFFECTS).map(([type, args]) => ({ type, args }))), "");
  out.push("### Formula functions", "");
  out.push(`Math: ${codes([...MATH_FUNCTIONS].sort(byText))}. ${code("min")} and ${code("max")} take any number of arguments.`, "");
  out.push("The engine's own:", "", ...sortedBy(Object.entries(BUILTIN_FUNCTIONS), ([name]) => name).map(([name, params]) => `- ${code(`${name}(${params.join(", ")})`)}${EFFECT_ONLY_FUNCTIONS.includes(name) ? ": effect arguments only" : ""}`), "");
  out.push("Taxonomy:", "", ...formulaRows(engine.formulas), "");
  out.push("### Events", "", `Core: ${codes(unique(coreEvents))}.`, "", `Engine bookkeeping: ${codes(unique(engine.events))}.`, "");
  out.push("### Relation types", "", `Built in: ${codes([...BUILTIN_RELATIONS])}. Packs add the typed ones below.`, "");
  out.push("### Proposals", "", ...table(["Proposal", "Bound by"], sortedBy(engine.proposals, (p) => p.type).map((p) => [code(p.type), code(p.boundField)])), "");
  out.push("### Step purposes", "", ...table(["Purpose", "Outputs a world template may declare"], sortedBy(Object.entries(STEP_OUTPUTS), ([p]) => p).map(([purpose, outputs]) => [code(purpose), outputs.map(code).join(", ")])), "");
  out.push(`Signals: ${codes([...STEP_SIGNALS].sort(byText))}, and ${code("every_n:<k>")}.`, "", `Template placeholders: ${codes([...STEP_PLACEHOLDERS].sort(byText))}.`, "");
  out.push("### Sections", "", "The slots a world gets when it defines none, kept in rank order on the section budget.", "");
  out.push(...table(["Slot", "Label", "Rank"], Object.values(DEFAULT_SECTIONS).sort((a, b) => a.rank - b.rank).map((s) => [code(s.id), s.label, String(s.rank)])), "");
  out.push("### Realism", "", `Domains: ${codes([...DOMAINS])}; each at a level from 0 to 4.`, "", `Detail bands: ${BANDS.map((b) => `${code(b)} (${BAND_LABEL[b]})`).join(", ")}.`, "", `Interrupt classes: ${codes([...INTERRUPT_CLASSES])}.`, "");
  out.push("### Adjudication presets", "");
  const presets = Object.values(ADJUDICATION_PRESETS);
  const keys = ["checks", "riskyAt", "trivialAt", "impossibleAt", "description", "authority", "closeBy", "retry", "retryAfter"] as const;
  out.push(...table(["Value", ...presets.map((p) => code(p.preset))], keys.map((k) => [code(k), ...presets.map((p) => json(p[k]))])), "");
  return out;
}

export function buildReference(): string {
  const records = ALL_PACKS.map(record);
  const engine = records.find((r) => r.pack.id === "engine");
  if (!engine) throw new Error("ALL_PACKS has no engine pack");
  const packs = sortedBy(
    records.filter((r) => r !== engine),
    (r) => r.pack.id,
  );
  const lines: string[] = [
    "# LumiRPEngine reference",
    "",
    "<!-- Generated by `bun run reference` (scripts/reference/build.ts). Edit the packs, then run it again. -->",
    "",
    "What the engine and its packs register, as the registry has it: kinds and their fields, effects and the arguments they read, formula functions, actions, events, proposal channels, panels, slots, data tables and lint codes. Arguments and parameters marked `?` may be left out. The formula language is in [EXPRESSIONS.md](EXPRESSIONS.md), worked examples are in [RECIPES.md](RECIPES.md), and the [user guide](USER-GUIDE.md#authoring) shows the editors.",
    "",
    `Engine ${code(ENGINE_VERSION)} · world format ${code(WORLD_FORMAT)} · packs ${ALL_PACKS.map((p) => `${code(p.id)} ${p.version}`).join(", ")}.`,
    "",
    "## Contents",
    "",
    "- [Engine built-ins](#engine-built-ins)",
    ...packs.map((r) => `- [${r.pack.label} pack](#${`${r.pack.label} pack ${r.pack.id}`.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-")})`),
    "",
    ...builtInSection(engine),
    ...packs.flatMap(packSection),
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

if (import.meta.main) {
  const text = buildReference();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(REFERENCE_PATH, "utf8");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.log("docs/REFERENCE.md differs from a fresh build; run `bun run reference`");
      process.exit(1);
    }
    console.log("docs/REFERENCE.md is current");
  } else {
    writeFileSync(REFERENCE_PATH, text);
    console.log(`wrote ${REFERENCE_PATH} (${text.length} bytes)`);
  }
}
