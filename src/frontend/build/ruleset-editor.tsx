// Build → World → Ruleset (DESIGN §11, §13): the world's rules as parts, each opening
// as its own page (a sheet): Start from a profile…, how checks are decided (the adjudication
// policy, and beside it the world's default for inferred checks), the level floors, the
// progressions, the Sheet Designer with its live preview, and the
// Combat card, saved together as the `ruleset` part. The preview is `lre.world sheet` on the POV as
// a chat would start, with the ruleset as edited (saved or not). Keys this editor doesn't know are
// kept as they are, so other ruleset parts survive a save. A profile is applied to the draft in its
// own write (`profile-picker`), with the edits here saved or reverted first.

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ADJUDICATION_PRESET_LABEL, presetAdjudication, readAdjudication } from "../../shared/adjudication";
import { INFER_MODE_LABEL, inferredDefaults, readInferred, type InferredChecks, type SheetSkill } from "../../shared/inferred";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import { profileOf } from "../../shared/profiles/index";
import type { SheetSectionView } from "../../shared/state-view";
import { playedKinds, type FieldDef, type ProgressionDef, type RulesetDef, type SheetLayoutDef, type SheetRowDef, type SheetSectionDef, type WorldDoc } from "../../shared/world";
import { SheetSectionCards } from "../../packs/sheets/ui/panel";
import { useApp } from "../app";
import type { Draft } from "../app";
import { AdjudicationForm } from "../adjudication-form";
import { InferredForm } from "../inferred-form";
import { Badge, Button, Empty, Field, HostSwitch, IconButton, IdText, List, ListRow, PageHeader, SaveBar, Section, Seg, useBusy } from "../components";
import type { IconName } from "../icons";
import { sheetPreviewRequest } from "../requests";
import { DOMAIN_LABEL } from "../../shared/ids";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { ExprEditor } from "./expr-editor";
import { AddPicker, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "./form-kit";
import { useHeld } from "./held";
import { ProfilePicker } from "./profile-picker";
import { deriveId, EFFECT, type FieldSpec } from "./schema";
import type { FormCtx } from "./schema-form";
import { FieldInput, kindFields, refOptions, worldIdentifiers } from "./schema-form";

export type RowKind = "field" | "formula" | "pool" | "progression";

export interface Choice {
  value: string;
  label: string;
}

/** What a sheet row may show on the POV: its kind's fields (inherited and derived ones too), its pools, and the progressions. */
export interface RowChoices {
  fields: Choice[];
  pools: Choice[];
  progressions: Choice[];
}

export function rowKind(row: SheetRowDef): RowKind {
  if ("formula" in row) return "formula";
  if ("pool" in row) return "pool";
  if ("progression" in row) return "progression";
  return "field";
}

/** The one thing a row shows: its field, pool or progression id, or its formula. */
function rowTarget(row: SheetRowDef): string {
  if ("formula" in row) return row.formula;
  if ("pool" in row) return row.pool;
  if ("progression" in row) return row.progression;
  return row.field;
}

/** The list with one item moved a place up (-1) or down (1); unchanged at either end. */
export function moved<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const out = [...items];
  const [item] = out.splice(index, 1);
  if (item !== undefined) out.splice(to, 0, item);
  return out;
}

/** A section id from its label, made unique among the ids taken ("Skills", then "skills_2"). */
export function sectionId(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "section";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** A field by its label (its id when it has none); a derived one says so. */
function fieldLabel(id: string, def: FieldDef): string {
  const name = def.label || id;
  return def.derived !== undefined ? `${name} · derived` : name;
}

/**
 * The rows the designer offers for the POV: every field of the POV's kind (packs' kinds included,
 * as `doc.kinds` holds them), the pool fields among them, and the progressions as edited.
 */
export function rowChoices(doc: WorldDoc, progression: Readonly<Record<string, ProgressionDef>>): RowChoices {
  const kind = doc.entities[doc.pov]?.kind;
  const defs = kind ? kindFields(doc, kind) : {};
  const fields = Object.entries(defs)
    .map(([id, def]) => ({ value: id, label: fieldLabel(id, def) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pools = Object.entries(defs)
    .filter(([, def]) => def.pool !== undefined)
    .map(([id, def]) => ({ value: id, label: def.label || id }));
  const progressions = Object.entries(progression).map(([id, p]) => ({ value: id, label: p.label || id }));
  return { fields, pools, progressions };
}

/**
 * The ruleset as it saves and previews: an empty sheet, progression or floor set is no such part,
 * so a ruleset with nothing left is `{}`, which the backend stores as no ruleset at all.
 */
export function tidyRuleset(ruleset: RulesetDef): JsonObject {
  const out: Record<string, unknown> = { ...ruleset };
  if (!ruleset.sheet || ruleset.sheet.sections.length === 0) delete out.sheet;
  if (!ruleset.progression || Object.keys(ruleset.progression).length === 0) delete out.progression;
  if (!ruleset.minLevels || Object.keys(ruleset.minLevels).length === 0) delete out.minLevels;
  // RulesetDef is plain JSON data; the cast only restates it as JSON.
  return out as JsonObject;
}

/**
 * The fields a progression may keep XP or the level in: number fields the engine can set (not
 * derived), of its kind with inherited ones, or of every kind when it names none.
 */
export function progressionFields(doc: WorldDoc, kind: string | undefined): Choice[] {
  const out: Record<string, Choice> = {};
  for (const k of kind ? [kind] : Object.keys(doc.kinds)) {
    for (const [id, def] of Object.entries(kindFields(doc, k))) {
      if (def.type === "number" && def.derived === undefined && !(id in out)) out[id] = { value: id, label: def.label || id };
    }
  }
  return Object.values(out).sort((a, b) => a.label.localeCompare(b.label));
}

/** Thresholds as typed ("0, 300, 900" or one per line): the numbers, or null while any part isn't one. */
export function parseThresholds(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== "");
  const numbers = parts.map(Number);
  return numbers.every((n) => Number.isFinite(n)) ? numbers : null;
}

/** A data table column's numbers in row order, as the engine reads thresholds from it (`thresholdsOf`). */
export function tableThresholds(doc: WorldDoc, ref: { table: string; column: string }): number[] {
  const rows = hasOwn(doc.tables, ref.table) ? doc.tables[ref.table]?.rows : undefined;
  if (!rows) return [];
  const out: number[] = [];
  for (const row of Object.values(rows)) {
    const v = hasOwn(row, ref.column) ? row[ref.column] : undefined;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

const ROW_NOUN: Record<RowKind, string> = { field: "Field", formula: "Formula", pool: "Pool", progression: "Progression" };

/** What a row shows, by name: its label, else its field's, pool's or progression's name. */
function rowTitle(row: SheetRowDef, choices: RowChoices): string {
  const kind = rowKind(row);
  if (row.label) return row.label;
  if (kind === "formula") return "A formula without a label";
  const list = kind === "pool" ? choices.pools : kind === "progression" ? choices.progressions : choices.fields;
  const target = rowTarget(row);
  return list.find((c) => c.value === target)?.label ?? (target || "Nothing picked");
}

/** One sheet row as a page: what it shows (a field, pool or progression of the POV, or a formula) and its label. */
function RowSheet(props: { row: SheetRowDef; choices: RowChoices; identifiers: readonly string[]; functions: readonly string[]; doc: WorldDoc; lint: readonly LintIssue[]; path: string; onChange(row: SheetRowDef): void; onRemove(): void; onClose(): void }) {
  const { row } = props;
  const kind = rowKind(row);
  const own = props.lint.filter((issue) => issue.path === props.path || issue.path === `${props.path}.label`);
  const setLabel = (text: string) => {
    if (kind === "formula") props.onChange({ formula: rowTarget(row), label: text });
    else {
      const next: Record<string, string> = { [kind]: rowTarget(row) };
      if (text !== "") next.label = text;
      // A field, pool or progression row is its one key and an optional label.
      props.onChange(next as unknown as SheetRowDef);
    }
  };
  return (
    <FormSheet title={rowTitle(row, props.choices)} subtitle={`${ROW_NOUN[kind]} row`} backLabel="Section" onClose={props.onClose}>
      <Issues issues={own} />
      {kind === "formula" ? (
        <ExprEditor label="Formula" hint="The POV is self." value={rowTarget(row)} identifiers={props.identifiers} functions={props.functions} doc={props.doc} lint={props.lint.filter((issue) => issue.path.startsWith(`${props.path}.formula`))} onChange={(formula) => props.onChange({ formula, label: row.label ?? "" })} />
      ) : (
        <RefPicker
          label={ROW_NOUN[kind]}
          value={rowTarget(row)}
          options={kind === "pool" ? props.choices.pools : kind === "progression" ? props.choices.progressions : props.choices.fields}
          onChange={(id) => {
            const extra = row.label ? { label: row.label } : {};
            props.onChange(kind === "pool" ? { pool: id, ...extra } : kind === "progression" ? { progression: id, ...extra } : { field: id, ...extra });
          }}
        />
      )}
      <Field label={kind === "formula" ? "Label" : "Label (optional)"} help={kind === "formula" ? "Shown beside the result." : "Leave it empty to use the field's own label."}>
        <input class={kind === "formula" && !row.label?.trim() ? "lre-input invalid" : "lre-input"} value={row.label ?? ""} onInput={(event) => setLabel(event.currentTarget.value)} />
      </Field>
      <div class="lre-inline">
        <Button variant="danger" icon="trash" onClick={props.onRemove}>
          Remove row
        </Button>
      </div>
    </FormSheet>
  );
}

/** The rows a section may add, as one picker: a formula, the POV's pools, progressions and fields. */
function rowOptions(choices: RowChoices): RefOption[] {
  return [
    { value: "formula:", label: "A formula with a label" },
    ...choices.pools.map((c) => ({ value: `pool:${c.value}`, label: c.label, sublabel: "Pool: a bar of current over max" })),
    ...choices.progressions.map((c) => ({ value: `progression:${c.value}`, label: c.label, sublabel: "Progression: level and XP" })),
    ...choices.fields.map((c) => ({ value: `field:${c.value}`, label: c.label, sublabel: "Field" })),
  ];
}

function rowOf(option: string): SheetRowDef | null {
  const [kind, id] = option.split(":", 2);
  if (kind === "formula") return { formula: "", label: "" };
  if (!id) return null;
  return kind === "pool" ? { pool: id } : kind === "progression" ? { progression: id } : kind === "field" ? { field: id } : null;
}

/** The Sheet Designer: sections (add, rename, reorder, remove) of rows (add, open, reorder, remove), with the preview under them. */
function SheetDesigner(props: { sheet: SheetLayoutDef | undefined; choices: RowChoices; identifiers: readonly string[]; functions: readonly string[]; doc: WorldDoc; lint: readonly LintIssue[]; preview: { draft: Draft; ruleset: JsonObject }; onChange(sheet: SheetLayoutDef): void }) {
  const sections = Array.isArray(props.sheet?.sections) ? props.sheet.sections : [];
  const [open, setOpen] = useState<{ section: number; row: number } | null>(null);
  const set = (next: SheetSectionDef[]) => props.onChange({ ...props.sheet, sections: next });
  const setSection = (index: number, section: SheetSectionDef) => set(sections.map((s, i) => (i === index ? section : s)));
  const openSection = open ? sections[open.section] : undefined;
  const openRow = open && openSection ? openSection.rows[open.row] : undefined;
  return (
    <div class="lre-stack" data-lre-sheet-designer>
      <span class="lre-small lre-muted">The sheet lays out Play → You for the POV: sections of rows, each a field, a pool, a progression or a formula.</span>
      {sections.length === 0 ? <Empty icon="layers">No sections yet: Play → You shows the Sheets pack's own sheet.</Empty> : null}
      {sections.map((section, index) => {
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const path = `ruleset.sheet.sections.${index}`;
        const name = section.label || section.id;
        return (
          <FormGroup
            key={`${section.id}:${index}`}
            title={name}
            aside={
              <span class="lre-inline">
                <IconButton icon="chevron-up" label={`Move section ${name} up`} disabled={index === 0} onClick={() => set(moved(sections, index, -1))} />
                <IconButton icon="chevron-down" label={`Move section ${name} down`} disabled={index === sections.length - 1} onClick={() => set(moved(sections, index, 1))} />
                <IconButton icon="trash" label={`Remove section ${name}`} onClick={() => set(sections.filter((_, i) => i !== index))} />
              </span>
            }
          >
            <div class="lre-stack" data-lre-sheet-section={section.id}>
              <Field label="Section title">
                <input class={section.label.trim() ? "lre-input" : "lre-input invalid"} value={section.label} onInput={(event) => setSection(index, { ...section, label: event.currentTarget.value })} />
              </Field>
              <IdText id={section.id} />
              <Issues issues={props.lint.filter((issue) => issue.path === path || issue.path === `${path}.id` || issue.path === `${path}.label`)} />
              {rows.length > 0 ? (
                <div class="lre-form-items">
                  {rows.map((row, r) => {
                    const issues = props.lint.filter((issue) => issue.path.startsWith(`${path}.rows.${r}`)).length;
                    const kind = rowKind(row);
                    return (
                      <div key={r} data-lre-sheet-row={kind}>
                        <ItemRow
                          title={rowTitle(row, props.choices)}
                          subtitle={kind === "formula" ? <span class="lre-ve-row-target">{rowTarget(row) || "no formula yet"}</span> : ROW_NOUN[kind]}
                          badge={issues > 0 ? <Badge tone="warn">{issues}</Badge> : undefined}
                          openLabel={`Edit the row ${rowTitle(row, props.choices)}`}
                          onOpen={() => setOpen({ section: index, row: r })}
                          actions={
                            <>
                              <IconButton icon="chevron-up" label={`Move ${rowTitle(row, props.choices)} up`} disabled={r === 0} onClick={() => setSection(index, { ...section, rows: moved(rows, r, -1) })} />
                              <IconButton icon="chevron-down" label={`Move ${rowTitle(row, props.choices)} down`} disabled={r === rows.length - 1} onClick={() => setSection(index, { ...section, rows: moved(rows, r, 1) })} />
                            </>
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span class="lre-small lre-muted">No rows yet.</span>
              )}
              <AddPicker
                label={`Add a row to ${name}`}
                placeholder="+ Add a row…"
                options={rowOptions(props.choices)}
                onAdd={(option) => {
                  const row = rowOf(option);
                  if (!row) return;
                  setSection(index, { ...section, rows: [...rows, row] });
                  if ("formula" in row) setOpen({ section: index, row: rows.length });
                }}
              />
            </div>
          </FormGroup>
        );
      })}
      <div class="lre-inline">
        <Button
          icon="plus"
          onClick={() => {
            const label = "New section";
            set([...sections, { id: sectionId(label, sections.map((s) => s.id)), label, rows: [] }]);
          }}
        >
          Section
        </Button>
      </div>
      <FormGroup title="Preview">
        <SheetPreview draft={props.preview.draft} ruleset={props.preview.ruleset} />
      </FormGroup>
      {open && openSection && openRow ? (
        <RowSheet
          row={openRow}
          choices={props.choices}
          identifiers={props.identifiers}
          functions={props.functions}
          doc={props.doc}
          lint={props.lint}
          path={`ruleset.sheet.sections.${open.section}.rows.${open.row}`}
          onChange={(next) => setSection(open.section, { ...openSection, rows: openSection.rows.map((x, i) => (i === open.row ? next : x)) })}
          onRemove={() => {
            setSection(open.section, { ...openSection, rows: openSection.rows.filter((_, i) => i !== open.row) });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The live preview: the sheet as the POV would see it in a new chat, asked for a moment after the
 * last change. `send` (not `request`) so a half-typed ruleset never raises an error toast.
 */
function SheetPreview(props: { draft: Draft; ruleset: JsonObject }) {
  const app = useApp();
  const [sheet, setSheet] = useState<SheetSectionView[] | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(props.ruleset);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void app.send(sheetPreviewRequest(props.draft.worldId, props.ruleset)).then((message) => {
        if (!live) return;
        if (message.type === "lre.result" && message.request === "lre.world") {
          setSheet(message.body.sheet ?? null);
          setFailed(false);
        } else setFailed(true);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, props.draft.worldId]);
  const pov = props.draft.doc.entities[props.draft.doc.pov]?.name ?? props.draft.doc.pov;
  return (
    <div class="lre-stack" data-lre-sheet-preview>
      <span class="lre-small lre-muted">{pov}, as a new chat starts.</span>
      {failed ? <Empty icon="alert">The preview isn't available right now.</Empty> : sheet === undefined ? <Empty icon="hourglass">Building the preview…</Empty> : sheet === null ? <Empty icon="layers">No designed sheet: Play → You shows the Sheets pack's own.</Empty> : <SheetSectionCards sections={sheet} />}
    </div>
  );
}

/**
 * The world's default for inferred checks (DESIGN §11), on or off. Off, a new chat takes the
 * player's own setting, else plays by its realism preset at its Sheets level; on starts from `start`,
 * what the world's realism defaults would play. A default set but unreadable shows as `start`, so
 * the first edit saves a readable one.
 */
export function InferredWorld(props: { value: unknown; start: InferredChecks; skills: readonly SheetSkill[]; skillsHelp: string; disabled: boolean; onChange(next: JsonObject | undefined): void }) {
  return (
    <div class="lre-stack" data-lre-inferred="world">
      <div class="lre-gm-subtitle">Inferred checks</div>
      <HostSwitch label="This world sets how typed attempts are read as checks" checked={props.value !== undefined} disabled={props.disabled} onChange={(on) => props.onChange(on ? (props.start as unknown as JsonObject) : undefined)} />
      {props.value === undefined ? (
        <p class="lre-small lre-muted" style={{ margin: 0 }}>
          Not set: new chats take the player's own Settings → Checks, else play by their realism preset and Sheets level.
        </p>
      ) : (
        <InferredForm value={readInferred(props.value) ?? props.start} skills={props.skills} skillsHelp={props.skillsHelp} disabled={props.disabled} onChange={(next) => props.onChange(next as unknown as JsonObject)} />
      )}
    </div>
  );
}

/**
 * Build's inferred-checks card, its skills those of the draft's sheet with the ruleset as edited
 * (saved or not), read through the Sheet Designer's preview request a moment after a change to
 * anything but the check rules themselves, which don't change what the sheet has.
 */
function InferredCard(props: { draft: Draft; ruleset: RulesetDef; disabled: boolean; onChange(next: JsonObject | undefined): void }) {
  const app = useApp();
  const [skills, setSkills] = useState<SheetSkill[] | null>(null);
  const [failed, setFailed] = useState(false);
  const ruleset = tidyRuleset(props.ruleset);
  const { inferred: _inferred, adjudication: _adjudication, ...sheetParts } = ruleset;
  const key = JSON.stringify(sheetParts);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void app.send(sheetPreviewRequest(props.draft.worldId, ruleset)).then((message) => {
        if (!live) return;
        if (message.type === "lre.result" && message.request === "lre.world") {
          setSkills(message.body.skills ?? []);
          setFailed(false);
        } else setFailed(true);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, props.draft.worldId, props.draft.version]);
  const help = failed ? "This world's skills aren't available right now." : skills === null ? "Reading this world's sheet…" : skills.length === 0 ? "This world's sheet has no skill an attempt can roll: one comes from an action with a check, a skill and a difficulty." : "The skills this world's sheet has, as edited.";
  const realism = props.draft.doc.realism;
  return <InferredWorld value={props.ruleset.inferred} start={inferredDefaults(realism.preset, realism.levels.sheets)} skills={skills ?? []} skillsHelp={help} disabled={props.disabled} onChange={props.onChange} />;
}

function ThresholdList(props: { value: number[]; onChange(value: number[]): void }) {
  const [text, setText] = useState(props.value.join(", "));
  useEffect(() => {
    if (JSON.stringify(parseThresholds(text)) !== JSON.stringify(props.value)) setText(props.value.join(", "));
  }, [JSON.stringify(props.value)]);
  const parsed = parseThresholds(text);
  return (
    <Field label="XP each level needs, from level 1" help={parsed ? (parsed.length === 0 ? "No levels yet." : `${parsed.length} level${parsed.length === 1 ? "" : "s"}; level 1 at ${parsed[0]} XP.`) : undefined} error={parsed ? null : "Numbers only, separated by commas."}>
      <input
        class={parsed ? "lre-input" : "lre-input invalid"}
        inputMode="numeric"
        value={text}
        placeholder="0, 300, 900, 2700"
        onInput={(event) => {
          setText(event.currentTarget.value);
          const next = parseThresholds(event.currentTarget.value);
          if (next) props.onChange(next);
        }}
      />
    </Field>
  );
}

/** One progression as a page: its label and kind, the XP and level fields, the thresholds (a list or a table column), the top level and what each level does. */
function ProgressionSheet(props: { id: string; value: ProgressionDef; doc: WorldDoc; ctx: FormCtx; onChange(value: ProgressionDef): void; onRemove(): void; onClose(): void }) {
  const { value, doc } = props;
  const path = `ruleset.progression.${props.id}`;
  // ProgressionDef is plain JSON data; the cast only restates it as JSON for the schema fields.
  const json = value as unknown as JsonObject;
  const set = (key: keyof ProgressionDef, next: JsonValue | undefined) => {
    const out: Record<string, unknown> = { ...value };
    if (next === undefined) delete out[key];
    else out[key] = next;
    props.onChange(out as unknown as ProgressionDef);
  };
  const fields = progressionFields(doc, value.kind);
  const fromTable = !Array.isArray(value.thresholds);
  const table = isRecord(value.thresholds) && !Array.isArray(value.thresholds) ? value.thresholds : null;
  // The source the author switched away from, so switching back doesn't start over.
  const [earlier, setEarlier] = useState<{ list?: number[]; table?: { table: string; column: string } }>({});
  const switchTo = (mode: "list" | "table") => {
    if (mode === (fromTable ? "table" : "list")) return;
    if (Array.isArray(value.thresholds)) {
      setEarlier({ ...earlier, list: value.thresholds });
      set("thresholds", earlier.table ?? { table: "", column: "" });
      return;
    }
    if (table) setEarlier({ ...earlier, table });
    const read = table ? tableThresholds(doc, table) : [];
    set("thresholds", read.length > 0 ? read : (earlier.list ?? []));
  };
  const tableDef = table ? doc.tables[table.table] : undefined;
  const columns = tableDef ? Object.entries(tableDef.columns).filter(([, c]) => c.type === "number" || c.type === "int").map(([id]) => ({ value: id, label: id })) : [];
  // onLevel effects read the entity as `self`, the level reached as `level` and the one before as `from`.
  const ctx: FormCtx = { ...props.ctx, path, identifiers: [...new Set([...props.ctx.identifiers, "level", "from"])].sort() };
  return (
    <FormSheet title={value.label || props.id} subtitle="Progression" backLabel="Progression" onClose={props.onClose}>
      <div class="lre-stack" data-lre-progression={props.id}>
        <IdText id={props.id} />
        <Issues issues={props.ctx.lint.filter((issue) => issue.path === path || issue.path === `${path}.xpField` || issue.path === `${path}.levelField` || issue.path.startsWith(`${path}.thresholds`))} />
        <FieldInput spec={{ kind: "text", key: "label", label: "Label", hint: "The sheet and the Journal show it: “You reached Level 3.”" }} value={json.label} ctx={ctx} path={path} parent={json} onChange={(next) => set("label", typeof next === "string" ? next : "")} />
        <RefPicker label="Applies to kind" value={value.kind ?? ""} none="Any kind with both fields" options={refOptions(doc, "kinds")} onChange={(next) => set("kind", next || undefined)} />
        <RefPicker label="XP field" value={value.xpField} options={fields} onChange={(next) => set("xpField", next)} />
        <RefPicker label="Level field (set from XP)" value={value.levelField} options={fields} onChange={(next) => set("levelField", next)} />
        <Field label="Thresholds from">
          <Seg<"list" | "table">
            label="Thresholds from"
            value={fromTable ? "table" : "list"}
            options={[
              { value: "list", label: "A list" },
              { value: "table", label: "A data table" },
            ]}
            onChange={switchTo}
          />
        </Field>
        {fromTable ? (
          <>
            <RefPicker label="Data table (rows in order, level 1 first)" value={table?.table ?? ""} options={refOptions(doc, "tables")} onChange={(next) => set("thresholds", { table: next, column: "" })} />
            <RefPicker label="Column" value={table?.column ?? ""} options={columns} onChange={(next) => set("thresholds", { table: table?.table ?? "", column: next })} />
          </>
        ) : (
          <ThresholdList value={Array.isArray(value.thresholds) ? value.thresholds : []} onChange={(next) => set("thresholds", next)} />
        )}
        <FieldInput spec={{ kind: "number", key: "maxLevel", label: "Top level", min: 1, step: 1, optional: true, hint: "XP beyond its threshold raises nothing" }} value={json.maxLevel} ctx={ctx} path={path} parent={json} onChange={(next) => set("maxLevel", next)} />
        <FieldInput spec={{ kind: "list", key: "onLevel", label: "On each level gained", item: EFFECT, title: "type" }} value={json.onLevel} ctx={ctx} path={path} parent={json} onChange={(next) => set("onLevel", Array.isArray(next) && next.length > 0 ? next : undefined)} />
        <div class="lre-inline">
          <Button variant="danger" icon="trash" onClick={props.onRemove}>
            Remove progression
          </Button>
        </div>
      </div>
    </FormSheet>
  );
}

/** The progressions: open one to edit it, or add one by name. */
function ProgressionEditor(props: { value: Record<string, ProgressionDef>; doc: WorldDoc; ctx: FormCtx; onChange(value: Record<string, ProgressionDef>): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const id = deriveId(name || "progression", new Set(Object.keys(props.value)));
  const prog = open !== null ? props.value[open] : undefined;
  return (
    <div class="lre-stack" data-lre-progressions>
      <span class="lre-small lre-muted">A progression's level follows its XP, both ways: after each change, an entity whose XP reached the next threshold goes up a level at a time, each level gained running its effects, and one whose XP fell below its level's threshold goes straight down, any pool above its lower max coming down to it. Change XP to change a level.</span>
      {Object.keys(props.value).length === 0 ? (
        <span class="lre-small lre-muted">No progressions: levels never change on their own.</span>
      ) : (
        <div class="lre-form-items">
          {Object.entries(props.value).map(([key, p]) => {
            const issues = props.ctx.lint.filter((issue) => issue.path.startsWith(`ruleset.progression.${key}`)).length;
            const levels = Array.isArray(p.thresholds) ? `${p.thresholds.length} level${p.thresholds.length === 1 ? "" : "s"}` : "levels from a data table";
            return <ItemRow key={key} title={p.label || key} subtitle={`${levels}${p.xpField ? ` · XP in ${p.xpField}` : ""}`} badge={issues > 0 ? <Badge tone="warn">{issues}</Badge> : undefined} openLabel={`Edit the progression ${p.label || key}`} onOpen={() => setOpen(key)} />;
          })}
        </div>
      )}
      <form
        class="lre-form-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          props.onChange({ ...props.value, [id]: { label: name.trim(), xpField: "", levelField: "", thresholds: [0] } });
          setOpen(id);
          setName("");
        }}
      >
        <Field label="New progression">
          <input class="lre-input" placeholder="Character level" value={name} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Button type="submit" icon="plus" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {open !== null && prog ? (
        <ProgressionSheet
          key={open}
          id={open}
          value={prog}
          doc={props.doc}
          ctx={props.ctx}
          onChange={(next) => props.onChange({ ...props.value, [open]: next })}
          onRemove={() => {
            const next = { ...props.value };
            delete next[open];
            props.onChange(next);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** The combat part (DESIGN §11), schema-driven: initiative, the action economy, HP, who is down, the sides, when a fight is over and when it peters out. */
const COMBAT: FieldSpec = {
  kind: "object",
  key: "combat",
  label: "Fights (leave it out and this world has no combat)",
  optional: true,
  fields: [
    { kind: "ref", key: "initiative", label: "Initiative check (everyone rolls it when a fight starts; highest first)", collection: "checks", inline: true },
    { kind: "expr", key: "tieBreak", label: "Tie-break, higher first (default: the initiative modifier)", optional: true },
    {
      kind: "record",
      key: "economy",
      label: "Action economy",
      keyLabel: "Budget id (action, bonus, move, reaction)",
      item: {
        kind: "object",
        key: "",
        label: "Budget",
        fields: [
          { kind: "text", key: "label", label: "Label" },
          { kind: "json", key: "count", label: "How many (a number, or a formula with the fighter as self; default 1)", optional: true },
          { kind: "enum", key: "per", label: "Refills each", values: ["turn", "round"], optional: true },
          { kind: "bool", key: "offTurn", label: "Spent off one's own turn (a reaction): never keeps a turn open" },
        ],
      },
    },
    { kind: "text", key: "hp", label: "HP field", hint: "A pool field on the kind of those who fight" },
    { kind: "object", key: "down", label: "Down", optional: true, fields: [{ kind: "expr", key: "when", label: "When (default: no HP left)", optional: true }, { kind: "text", key: "condition", label: "Condition it applies (default down)", optional: true }] },
    { kind: "object", key: "sides", label: "Sides", optional: true, fields: [{ kind: "expr", key: "hostile", label: "Hostile, with self and other (default: a hostile relation)", optional: true }, { kind: "expr", key: "ally", label: "Fights beside, with self and other", optional: true }] },
    { kind: "expr", key: "end", label: "Over when (default: one side has no one standing)", optional: true },
    { kind: "number", key: "stalemate", label: "Peters out after this many rounds in a row with no attack and no one hurt (default 3; 0: never)", min: 0, step: 1, optional: true },
    { kind: "enum", key: "endTurn", label: "The player's turn ends (default: once it's spent; manual: only on End turn)", values: ["spent", "manual"], optional: true },
    { kind: "enum", key: "adjudicate", label: "Attacks and other fight checks are settled by (default: dice, always rolled; policy: the adjudication policy for the player's own, while everyone else's always roll)", values: ["dice", "policy"], optional: true },
    { kind: "object", key: "tactics", label: "Everyone else's tactics", optional: true, fields: [{ kind: "expr", key: "threat", label: "A target's threat, with self and target (default its HP)", optional: true }, { kind: "expr", key: "lowHp", label: "Defends when (default a quarter of its HP or less)", optional: true }] },
    { kind: "enum", key: "showHp", label: "Others' HP shows as (default: wounds, a band with no number; exact: the numbers)", values: ["wounds", "exact"], optional: true },
    { kind: "json", key: "wounds", label: "Wound bands over the HP left in percent", optional: true, hint: '[{"label": "hurt", "min": 50, "max": 100}, …]' },
  ],
};

type Part = "profile" | "checks" | "floors" | "progression" | "sheet" | "combat" | "json";

export function RulesetEditor() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const stored: RulesetDef = draft && isRecord(draft.doc.ruleset) ? structuredClone(draft.doc.ruleset) : {};
  const storedKey = JSON.stringify(stored);
  const [value, setValue] = useState<RulesetDef>(stored);
  const [busy, run] = useBusy();
  const [part, setPart] = useState<Part | null>(null);
  useHeld(value, setValue, stored, `${draft?.worldId ?? ""}/ruleset`, storedKey);
  // Pickers see the packs' kinds too (DESIGN §13); the world's own win.
  const formDoc = useMemo(() => (draft ? { ...draft.doc, kinds: playedKinds(draft.packKinds, draft.doc.kinds), relations: { ...draft.packRelations, ...draft.doc.relations } } : null), [draft?.doc, draft?.packKinds, draft?.packRelations]);
  const identifiers = useMemo(() => (draft ? worldIdentifiers(draft.doc) : []), [draft?.doc]);
  if (!draft || !formDoc) return null;
  const tidy = tidyRuleset(value);
  const changed = JSON.stringify(tidy) !== JSON.stringify(tidyRuleset(stored));
  const progression = isRecord(value.progression) ? value.progression : {};
  const choices = rowChoices(formDoc, progression);
  // RulesetDef is plain JSON data; the cast only restates it as JSON for the schema fields.
  const json = value as unknown as JsonObject;
  const update = (key: keyof RulesetDef, next: JsonValue | undefined) => {
    const out: Record<string, unknown> = { ...value };
    if (next === undefined) delete out[key];
    else out[key] = next;
    setValue(out as RulesetDef);
  };
  const ctx: FormCtx = { doc: formDoc, lint: draft.lint, path: "ruleset", identifiers, functions: draft.functions };
  const lintOf = (prefix: string) => draft.lint.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`));
  const checksLint = draft.lint.filter((issue) => issue.code.startsWith("adjudication") || issue.path.startsWith("ruleset.adjudication") || issue.path.startsWith("ruleset.inferred"));
  const adjudication = value.adjudication === undefined ? null : readAdjudication(value.adjudication);
  const inferred = value.inferred === undefined ? null : readInferred(value.inferred);
  // The floors in the world's words, in the order Settings lists the domains.
  const minLevels: Record<string, unknown> = isRecord(value.minLevels) ? value.minLevels : {};
  const floors = Object.entries(DOMAIN_LABEL).flatMap(([domain, label]) => {
    const level = minLevels[domain];
    return typeof level === "number" && level > 0 ? [`${label} ${level}`] : [];
  });
  const sections = value.sheet?.sections ?? [];
  const rows = sections.reduce((n, s) => n + (Array.isArray(s.rows) ? s.rows.length : 0), 0);
  const combat = isRecord(value.combat) ? value.combat : null;
  const saveBar = (
    <SaveBar>
      <Button
        variant="primary"
        disabled={!changed}
        busy={busy}
        onClick={() =>
          run(async () => {
            await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "ruleset", value: tidy });
          })
        }
      >
        Save to draft
      </Button>
      <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(stored)}>
        Revert
      </Button>
    </SaveBar>
  );
  const row = (id: Part, icon: IconName, title: string, subtitle: string, issues: readonly LintIssue[]) => (
    <ListRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      badge={issues.length > 0 ? <Badge tone={issues.some((i) => i.severity === "error") ? "neg" : "warn"}>{issues.length}</Badge> : undefined}
      chevron
      onClick={() => setPart(id)}
    />
  );
  const sheet = (title: string, children: ComponentChildren) => (
    <FormSheet title={title} backLabel="Ruleset" onClose={() => setPart(null)}>
      {children}
      {saveBar}
    </FormSheet>
  );
  return (
    <div class="lre-build-page" data-lre-editor="part:ruleset">
      <PageHeader title="Ruleset" subtitle={typeof value.profile === "string" ? `Started from the ${profileOf(value.profile)?.label ?? value.profile} profile` : "How this world's rules play"} />
      <Section flush>
        <List>
          {row("profile", "wand", "Start from a profile…", changed ? "Save or revert your edits first" : "A ready-made ruleset: Modern, Classic, Fifth or Custom", [])}
          {row("checks", "dice", "How checks are decided", `${adjudication ? ADJUDICATION_PRESET_LABEL[adjudication.preset] : value.adjudication !== undefined ? "Set, but not readable: open it" : "Not set: every check rolls"}${inferred ? ` · inferred checks: ${INFER_MODE_LABEL[inferred.mode].toLowerCase()}` : ""}`, checksLint)}
          {row("floors", "sliders", "Level floors", floors.length > 0 ? floors.join(", ") : "None", lintOf("ruleset.minLevels"))}
          {row("progression", "star", "Progression", Object.keys(progression).length > 0 ? Object.values(progression).map((p) => p.label).join(", ") : "None: levels never change on their own", lintOf("ruleset.progression"))}
          {row("sheet", "layers", "Sheet Designer", sections.length > 0 ? `${sections.length} section${sections.length === 1 ? "" : "s"}, ${rows} row${rows === 1 ? "" : "s"}` : "Not designed: the Sheets pack's own sheet", lintOf("ruleset.sheet"))}
          {row("combat", "sword", "Combat", combat ? "On: fights use its initiative, budgets and HP" : "Off: this world has no fights", lintOf("ruleset.combat"))}
          {row("json", "code", "JSON (Advanced)", "The whole ruleset as the world file keeps it", [])}
        </List>
      </Section>
      {part === "profile"
        ? sheet("Start from a profile", <ProfilePicker draft={draft} blocked={changed ? "Save or revert your ruleset edits first: a profile is applied to the draft as it is stored." : null} onDone={() => setPart(null)} />)
        : null}
      {part === "checks"
        ? sheet(
            "How checks are decided",
            <div class="lre-stack" data-lre-adjudication="world">
              <HostSwitch label="This world sets how its checks are decided" checked={value.adjudication !== undefined} disabled={busy} onChange={(on) => update("adjudication", on ? (presetAdjudication("crunchy") as unknown as JsonObject) : undefined)} />
              {value.adjudication === undefined ? (
                <p class="lre-small lre-muted" style={{ margin: 0 }}>
                  Not set: every check rolls and the roll settles it, unless a player's own settings decide otherwise for their new chats.
                </p>
              ) : (
                <AdjudicationForm value={adjudication ?? presetAdjudication("crunchy")} disabled={busy} onChange={(next) => update("adjudication", next as unknown as JsonObject)} />
              )}
              <InferredCard draft={draft} ruleset={value} disabled={busy} onChange={(next) => update("inferred", next)} />
              <Issues issues={checksLint} />
            </div>,
          )
        : null}
      {part === "floors"
        ? sheet(
            "Level floors",
            <>
              <span class="lre-small lre-muted">The lowest level this ruleset plays each domain at, whatever a chat's realism says: stat modifiers, for one, count only from Sheets 3.</span>
              <FieldInput spec={{ kind: "levels", key: "minLevels", label: "Level floors" }} value={json.minLevels} ctx={ctx} path="ruleset" parent={json} onChange={(next) => update("minLevels", next)} />
            </>,
          )
        : null}
      {part === "progression" ? sheet("Progression", <ProgressionEditor value={progression} doc={formDoc} ctx={ctx} onChange={(next) => setValue({ ...value, progression: next })} />) : null}
      {part === "sheet"
        ? sheet(
            "Sheet Designer",
            <SheetDesigner sheet={value.sheet} choices={choices} identifiers={identifiers} functions={draft.functions} doc={formDoc} lint={draft.lint} preview={{ draft, ruleset: tidy }} onChange={(next) => setValue({ ...value, sheet: next })} />,
          )
        : null}
      {part === "combat"
        ? sheet(
            "Combat",
            <>
              <span class="lre-small lre-muted">Combat is data over the checks, pools and conditions the world has: leave it out and this world has no fights.</span>
              <FieldInput spec={COMBAT} value={json.combat} ctx={ctx} path="ruleset" parent={json} onChange={(next) => update("combat", next)} />
            </>,
          )
        : null}
      {part === "json"
        ? sheet(
            "Ruleset as JSON",
            <FieldInput
              spec={{ kind: "json", key: "", label: "The ruleset", hint: "Every part, its unknown keys included. A change applies when you leave the box; parts left empty save as no part." }}
              value={json}
              ctx={{ ...ctx, lint: [] }}
              path="ruleset"
              parent={{}}
              onChange={(next) => {
                // A ruleset is any JSON object: the backend reads each part for itself and lints what it can't.
                if (isRecord(next)) setValue(next as unknown as RulesetDef);
              }}
            />,
          )
        : null}
      {saveBar}
    </div>
  );
}
