// Build → World → Ruleset (DESIGN §11, §13): the level floors, the progressions and the Sheet
// Designer, saved together as the `ruleset` part. The designer previews the sheet live through
// `lre.world sheet`, on the POV as a chat would start, with the ruleset as edited (saved or not).
// Keys this editor doesn't know are kept as they are, so other ruleset parts survive a save.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import type { SheetSectionView } from "../../shared/state-view";
import type { FieldDef, ProgressionDef, RulesetDef, SheetLayoutDef, SheetRowDef, SheetSectionDef, WorldDoc } from "../../shared/world";
import { SheetSectionCards } from "../../packs/sheets/ui/panel";
import { useApp } from "../app";
import { Card, Empty, useBusy } from "../components";
import type { Draft } from "../app";
import { sheetPreviewRequest } from "../requests";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { ExprEditor } from "./expr-editor";
import { FieldInput, kindFields, lintAt, worldIdentifiers } from "./schema-form";

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

function fieldLabel(id: string, def: FieldDef): string {
  const name = def.label && def.label !== id ? `${def.label} (${id})` : id;
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
    .map(([id, def]) => ({ value: id, label: def.label && def.label !== id ? `${def.label} (${id})` : id }));
  const progressions = Object.entries(progression).map(([id, p]) => ({ value: id, label: p.label && p.label !== id ? `${p.label} (${id})` : id }));
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

function Issues(props: { issues: readonly LintIssue[] }) {
  return (
    <>
      {props.issues.map((issue) => (
        <span key={`${issue.path}:${issue.code}:${issue.message}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
          {issue.message}
        </span>
      ))}
    </>
  );
}

/** A select over choices; a value no choice holds shows as missing rather than vanishing. */
export function Picker(props: { label: string; value: string | undefined; choices: readonly Choice[]; none?: string; onChange(value: string | undefined): void }) {
  const current = props.value ?? "";
  const choices = current && !props.choices.some((c) => c.value === current) ? [...props.choices, { value: current, label: `${current} (missing)` }] : props.choices;
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <select class="lre-input" value={current} onChange={(event) => props.onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.value)}>
        <option value="">{props.none ?? "— choose —"}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const ROW_NOUN: Record<RowKind, string> = { field: "Field", formula: "Formula", pool: "Pool", progression: "Progression" };

function RowEditor(props: { row: SheetRowDef; index: number; count: number; choices: RowChoices; identifiers: readonly string[]; lint: readonly LintIssue[]; path: string; onChange(row: SheetRowDef): void; onMove(delta: -1 | 1): void; onRemove(): void }) {
  const { row } = props;
  const kind = rowKind(row);
  const title = `${ROW_NOUN[kind]} ${kind === "formula" ? row.label || `row ${props.index + 1}` : rowTarget(row) || `row ${props.index + 1}`}`;
  const own = props.lint.filter((issue) => issue.path === props.path || issue.path === `${props.path}.label`);
  const label = (
    <label class="lre-field">
      <span class="label">{kind === "formula" ? "Label" : "Label (optional)"}</span>
      <input
        class={kind === "formula" && !row.label?.trim() ? "lre-input invalid" : "lre-input"}
        value={row.label ?? ""}
        placeholder={kind === "formula" ? "Shown beside the result" : "The field's own label"}
        onInput={(event) => {
          const text = event.currentTarget.value;
          if (kind === "formula") props.onChange({ ...row, label: text } as SheetRowDef);
          else {
            const next: Record<string, string> = { ...(row as Record<string, string>) };
            if (text === "") delete next.label;
            else next.label = text;
            props.onChange(next as unknown as SheetRowDef);
          }
        }}
      />
    </label>
  );
  return (
    <div class="lre-card" style={{ padding: "6px 8px" }} data-lre-sheet-row={kind}>
      <div class="lre-spread">
        <span class="lre-small lre-muted" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {title}
        </span>
        <span class="lre-inline">
          <button type="button" class="lre-btn small ghost" aria-label={`Move ${title} up`} disabled={props.index === 0} onClick={() => props.onMove(-1)}>
            ↑
          </button>
          <button type="button" class="lre-btn small ghost" aria-label={`Move ${title} down`} disabled={props.index === props.count - 1} onClick={() => props.onMove(1)}>
            ↓
          </button>
          <button type="button" class="lre-btn small ghost" aria-label={`Remove ${title}`} onClick={props.onRemove}>
            ✕
          </button>
        </span>
      </div>
      {kind === "formula" ? (
        <>
          {label}
          <ExprEditor label="Formula (the POV is self)" value={rowTarget(row)} identifiers={props.identifiers} lint={lintAt(props.lint, `${props.path}.formula`)} onChange={(formula) => props.onChange({ formula, label: row.label ?? "" })} />
        </>
      ) : (
        <>
          <Picker
            label={ROW_NOUN[kind]}
            value={rowTarget(row)}
            choices={kind === "pool" ? props.choices.pools : kind === "progression" ? props.choices.progressions : props.choices.fields}
            onChange={(id) => {
              const extra = row.label ? { label: row.label } : {};
              props.onChange(kind === "pool" ? { pool: id ?? "", ...extra } : kind === "progression" ? { progression: id ?? "", ...extra } : { field: id ?? "", ...extra });
            }}
          />
          {label}
        </>
      )}
      <Issues issues={own} />
    </div>
  );
}

/** "+ Add row" as one select: a field, pool or progression of the POV adds that row; Formula adds an empty one. */
function AddRow(props: { choices: RowChoices; onAdd(row: SheetRowDef): void }) {
  return (
    <select
      class="lre-input"
      value=""
      aria-label="Add a row"
      onChange={(event) => {
        const [kind, id] = event.currentTarget.value.split(":", 2);
        event.currentTarget.value = "";
        if (kind === "formula") props.onAdd({ formula: "", label: "" });
        else if (id && kind === "field") props.onAdd({ field: id });
        else if (id && kind === "pool") props.onAdd({ pool: id });
        else if (id && kind === "progression") props.onAdd({ progression: id });
      }}
    >
      <option value="">+ Add row…</option>
      <option value="formula:">Formula with a label</option>
      {props.choices.pools.length > 0 ? (
        <optgroup label="Pools (a bar of current over max)">
          {props.choices.pools.map((c) => (
            <option key={c.value} value={`pool:${c.value}`}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      {props.choices.progressions.length > 0 ? (
        <optgroup label="Progressions (level and XP)">
          {props.choices.progressions.map((c) => (
            <option key={c.value} value={`progression:${c.value}`}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Fields of the POV's kind">
        {props.choices.fields.map((c) => (
          <option key={c.value} value={`field:${c.value}`}>
            {c.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** The Sheet Designer: sections (add, rename, reorder, remove) of rows (add, reorder, remove). */
function SheetDesigner(props: { sheet: SheetLayoutDef | undefined; choices: RowChoices; identifiers: readonly string[]; lint: readonly LintIssue[]; onChange(sheet: SheetLayoutDef): void }) {
  const sections = Array.isArray(props.sheet?.sections) ? props.sheet.sections : [];
  const set = (next: SheetSectionDef[]) => props.onChange({ ...props.sheet, sections: next });
  const setSection = (index: number, section: SheetSectionDef) => set(sections.map((s, i) => (i === index ? section : s)));
  return (
    <div class="lre-stack" data-lre-sheet-designer>
      {sections.length === 0 ? <span class="lre-muted">No sections yet: Play → You shows the Sheets pack's own sheet.</span> : null}
      {sections.map((section, index) => {
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const path = `ruleset.sheet.sections.${index}`;
        const name = section.label || section.id;
        return (
          <div key={`${section.id}:${index}`} class="lre-card lre-stack" style={{ padding: "8px" }} data-lre-sheet-section={section.id}>
            <div class="lre-spread">
              <code class="lre-small">{section.id}</code>
              <span class="lre-inline">
                <button type="button" class="lre-btn small ghost" aria-label={`Move section ${name} up`} disabled={index === 0} onClick={() => set(moved(sections, index, -1))}>
                  ↑
                </button>
                <button type="button" class="lre-btn small ghost" aria-label={`Move section ${name} down`} disabled={index === sections.length - 1} onClick={() => set(moved(sections, index, 1))}>
                  ↓
                </button>
                <button type="button" class="lre-btn small danger" aria-label={`Remove section ${name}`} onClick={() => set(sections.filter((_, i) => i !== index))}>
                  ✕
                </button>
              </span>
            </div>
            <label class="lre-field">
              <span class="label">Section title</span>
              <input class={section.label.trim() ? "lre-input" : "lre-input invalid"} value={section.label} onInput={(event) => setSection(index, { ...section, label: event.currentTarget.value })} />
            </label>
            <Issues issues={props.lint.filter((issue) => issue.path === path || issue.path === `${path}.id` || issue.path === `${path}.label`)} />
            {rows.map((row, r) => (
              <RowEditor
                key={r}
                row={row}
                index={r}
                count={rows.length}
                choices={props.choices}
                identifiers={props.identifiers}
                lint={props.lint}
                path={`${path}.rows.${r}`}
                onChange={(next) => setSection(index, { ...section, rows: rows.map((x, i) => (i === r ? next : x)) })}
                onMove={(delta) => setSection(index, { ...section, rows: moved(rows, r, delta) })}
                onRemove={() => setSection(index, { ...section, rows: rows.filter((_, i) => i !== r) })}
              />
            ))}
            <AddRow choices={props.choices} onAdd={(row) => setSection(index, { ...section, rows: [...rows, row] })} />
          </div>
        );
      })}
      <div>
        <button
          type="button"
          class="lre-btn small"
          onClick={() => {
            const label = "New section";
            set([...sections, { id: sectionId(label, sections.map((s) => s.id)), label, rows: [] }]);
          }}
        >
          + Add section
        </button>
      </div>
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
      <span class="lre-small lre-muted">Preview: {pov}, as a new chat starts</span>
      {failed ? <Empty>The preview isn't available right now.</Empty> : sheet === undefined ? <Empty>Building the preview…</Empty> : sheet === null ? <Empty>No designed sheet: Play → You shows the Sheets pack's own.</Empty> : <SheetSectionCards sections={sheet} />}
    </div>
  );
}

export function RulesetEditor() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const stored: RulesetDef = draft && isRecord(draft.doc.ruleset) ? structuredClone(draft.doc.ruleset) : {};
  const storedKey = JSON.stringify(stored);
  const [value, setValue] = useState<RulesetDef>(stored);
  const [busy, run] = useBusy();
  useEffect(() => setValue(stored), [storedKey]);
  // Pickers see the packs' kinds too (DESIGN §13); the world's own win.
  const formDoc = useMemo(() => (draft ? { ...draft.doc, kinds: { ...draft.packKinds, ...draft.doc.kinds }, relations: { ...draft.packRelations, ...draft.doc.relations } } : null), [draft?.doc, draft?.packKinds, draft?.packRelations]);
  const identifiers = useMemo(() => (draft ? [...new Set([...worldIdentifiers(draft.doc), "self"])].sort() : []), [draft?.doc]);
  if (!draft || !formDoc) return null;
  const tidy = tidyRuleset(value);
  const changed = JSON.stringify(tidy) !== JSON.stringify(tidyRuleset(stored));
  const progression = isRecord(value.progression) ? value.progression : {};
  const choices = rowChoices(formDoc, progression);
  const json = value as unknown as JsonObject;
  const update = (key: keyof RulesetDef, next: JsonValue | undefined) => {
    const out: Record<string, unknown> = { ...value };
    if (next === undefined) delete out[key];
    else out[key] = next;
    setValue(out as RulesetDef);
  };
  const ctx = { doc: formDoc, lint: draft.lint, path: "ruleset", identifiers };
  return (
    <div class="lre-stack" data-lre-editor="part:ruleset">
      <div class="lre-h2">Ruleset</div>
      <FieldInput spec={{ kind: "levels", key: "minLevels", label: "Level floors (the lowest level this ruleset plays each domain at)" }} value={json.minLevels} ctx={ctx} path="ruleset" parent={json} onChange={(next) => update("minLevels", next)} />
      <FieldInput spec={{ kind: "json", key: "progression", label: "Progression", optional: true }} value={json.progression} ctx={ctx} path="ruleset" parent={json} onChange={(next) => update("progression", next)} />
      <Card title="Sheet Designer">
        <SheetDesigner sheet={value.sheet} choices={choices} identifiers={identifiers} lint={draft.lint} onChange={(sheet) => setValue({ ...value, sheet })} />
      </Card>
      <Card title="Sheet preview">
        <SheetPreview draft={draft} ruleset={tidy} />
      </Card>
      <div class="lre-inline" style={{ position: "sticky", bottom: 0, padding: "8px 0", background: "var(--lre-fill)" }}>
        <button
          type="button"
          class="lre-btn primary"
          disabled={!changed || busy}
          onClick={() =>
            run(async () => {
              await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "ruleset", value: tidy });
            })
          }
        >
          Save to draft
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setValue(stored)}>
          Revert
        </button>
      </div>
    </div>
  );
}
