// Data-table editor (DESIGN §13, ARCHITECTURE §6): a world's copy of a pinned table. Rows are
// edited through their column contract (bands keep min ≤ typical ≤ max, refs pick rows of the
// referenced table); saving writes the table to the draft and the backend computes its revision.

import { useEffect, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { ColumnDef, DataTable, TableRow } from "../../shared/tables";
import { useApp } from "../app";
import { Card, Empty, Row, useBusy } from "../components";
import type { EditorProps } from "../registry";

const PAGE = 40;

/** Why a cell value breaks its column contract, or null. */
export function cellProblem(column: ColumnDef, value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return column.optional ? null : "Required";
  switch (column.type) {
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : "Whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "Number";
    case "text":
      return typeof value === "string" ? null : "Text";
    case "bool":
      return typeof value === "boolean" ? null : "Yes or no";
    case "enum":
      return typeof value === "string" && (column.values ?? []).includes(value) ? null : `One of ${(column.values ?? []).join(", ")}`;
    case "ref":
      return typeof value === "string" ? null : "Row id";
    case "band":
      if (!isRecord(value) || typeof value.min !== "number" || typeof value.typical !== "number" || typeof value.max !== "number") return "min, typical and max";
      return value.min <= value.typical && value.typical <= value.max ? null : "min ≤ typical ≤ max";
    case "list":
      return Array.isArray(value) ? null : "List";
    case "json":
      return null;
  }
}

function CellInput(props: { name: string; column: ColumnDef; value: JsonValue | undefined; refRows: string[]; onChange(value: JsonValue | undefined): void }) {
  const { column } = props;
  const label = `${props.name}${column.unit ? ` (${column.unit})` : ""}${column.optional ? " (optional)" : ""}`;
  const problem = cellProblem(column, props.value);
  const numberText = (v: JsonValue | undefined) => (typeof v === "number" ? String(v) : "");
  const toNumber = (text: string): JsonValue | undefined => (text.trim() === "" ? undefined : Number.isFinite(Number(text)) ? (column.type === "int" ? Math.round(Number(text)) : Number(text)) : undefined);
  let input;
  switch (column.type) {
    case "int":
    case "number":
      input = <input class="lre-input" inputMode="decimal" value={numberText(props.value)} onChange={(event) => props.onChange(toNumber(event.currentTarget.value))} />;
      break;
    case "bool":
      input = (
        <span class="lre-check">
          <input type="checkbox" checked={props.value === true} onChange={(event) => props.onChange(event.currentTarget.checked)} />
        </span>
      );
      break;
    case "enum":
    case "ref": {
      const options = column.type === "enum" ? column.values ?? [] : props.refRows;
      input = (
        <select class="lre-input" value={typeof props.value === "string" ? props.value : ""} onChange={(event) => props.onChange(event.currentTarget.value || undefined)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "band": {
      const band = isRecord(props.value) ? props.value : {};
      const part = (key: "min" | "typical" | "max") => (
        <input
          class="lre-input"
          inputMode="decimal"
          aria-label={`${props.name} ${key}`}
          placeholder={key}
          value={typeof band[key] === "number" ? String(band[key]) : ""}
          onChange={(event) => {
            const n = Number(event.currentTarget.value);
            props.onChange({ min: typeof band.min === "number" ? band.min : 0, typical: typeof band.typical === "number" ? band.typical : 0, max: typeof band.max === "number" ? band.max : 0, [key]: Number.isFinite(n) ? n : 0 });
          }}
        />
      );
      input = (
        <div class="lre-inline" style={{ flexWrap: "nowrap" }}>
          {part("min")}
          {part("typical")}
          {part("max")}
        </div>
      );
      break;
    }
    case "list":
      input = (
        <input
          class="lre-input"
          value={Array.isArray(props.value) ? props.value.join(", ") : ""}
          onChange={(event) => {
            const parts = event.currentTarget.value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
            const numeric = column.of === "int" || column.of === "number";
            props.onChange(parts.length === 0 ? (column.optional ? undefined : []) : parts.map((p) => (numeric && Number.isFinite(Number(p)) ? Number(p) : p)));
          }}
        />
      );
      break;
    case "json":
      input = (
        <textarea
          class="lre-input"
          rows={3}
          value={props.value === undefined ? "" : JSON.stringify(props.value)}
          onChange={(event) => {
            try {
              props.onChange(event.currentTarget.value.trim() === "" ? undefined : (JSON.parse(event.currentTarget.value) as JsonValue));
            } catch {
              // keep the last valid value; the border shows the problem
            }
          }}
        />
      );
      break;
    default:
      input = <input class="lre-input" value={typeof props.value === "string" ? props.value : ""} onChange={(event) => props.onChange(event.currentTarget.value === "" && column.optional ? undefined : event.currentTarget.value)} />;
  }
  return (
    <label class="lre-field">
      <span class="label">{label}</span>
      {input}
      {column.doc ? <span class="lre-small lre-dim">{column.doc}</span> : null}
      {problem ? <span class="lre-small lre-neg">{problem}</span> : null}
    </label>
  );
}

function TableList(props: EditorProps) {
  const app = useApp();
  const tables = Object.values(props.world.tables);
  if (tables.length === 0) return <Empty>No data tables. Packs copy theirs in when a world is created.</Empty>;
  return (
    <div class="lre-list">
      {tables.map((t) => (
        <button key={t.id} type="button" class="lre-item" onClick={() => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "tables", id: t.id } }))}>
          <span class="grow">
            <span class="title">{t.label}</span>
            <span class="sub">
              {t.pack} · {Object.keys(t.rows).length} rows · {t.source?.approximate ? "approximate" : "authored"}
            </span>
          </span>
          <code class="lre-small lre-dim">{t.revision.slice(0, 6)}</code>
        </button>
      ))}
    </div>
  );
}

export function TableEditor(props: EditorProps) {
  const app = useApp();
  const id = props.id?.startsWith("new:") ? props.id.slice(4) : props.id;
  const stored = id ? props.world.tables[id] : undefined;
  const [table, setTable] = useState<DataTable | null>(stored ? structuredClone(stored) : null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [newRow, setNewRow] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => setTable(stored ? structuredClone(stored) : null), [stored?.revision, id]);
  if (!id) return <TableList {...props} />;
  if (!table) return <Empty>New tables come from packs; edit an existing table's copy instead.</Empty>;
  const columns = Object.entries(table.columns);
  const q = query.trim().toLowerCase();
  const rows = Object.entries(table.rows).filter(([rid, r]) => !q || rid.toLowerCase().includes(q) || Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const changed = JSON.stringify(table) !== JSON.stringify(stored);
  const problems = Object.values(table.rows).reduce((n, r) => n + columns.filter(([name, c]) => cellProblem(c, r[name]) !== null).length, 0);
  const setRow = (rid: string, next: TableRow) => setTable({ ...table, rows: { ...table.rows, [rid]: next } });
  const editing = rowId ? table.rows[rowId] : undefined;
  return (
    <div class="lre-stack" data-lre-editor="tables">
      <Card title={table.label} aside={<span class="lre-badge">{table.pack}</span>}>
        <Row k="Schema" v={<code>{table.schema}</code>} />
        <Row k="Revision" v={<code>{table.revision.slice(0, 12)}</code>} sub={changed ? "A new revision is computed when you save" : undefined} />
        {table.source ? <Row k="Source" v={table.source.dataPack} sub={`${table.source.file} · ${table.source.reflectsPeriod}${table.source.approximate ? " · approximate" : ""}`} /> : null}
      </Card>
      {editing && rowId ? (
        <Card
          title={<code>{rowId}</code>}
          aside={
            <button type="button" class="lre-btn small" onClick={() => setRowId(null)}>
              Done
            </button>
          }
        >
          <div class="lre-stack">
            {columns.map(([name, column]) => (
              <CellInput
                key={name}
                name={name}
                column={column}
                value={editing[name]}
                refRows={column.ref ? Object.keys(props.world.tables[column.ref]?.rows ?? {}) : []}
                onChange={(value) => {
                  const next = { ...editing };
                  if (value === undefined) delete next[name];
                  else next[name] = value;
                  setRow(rowId, next);
                }}
              />
            ))}
            <button
              type="button"
              class="lre-btn danger"
              onClick={() => {
                const next = { ...table.rows };
                delete next[rowId];
                setTable({ ...table, rows: next });
                setRowId(null);
              }}
            >
              Delete row
            </button>
          </div>
        </Card>
      ) : (
        <Card title="Rows" aside={<span class="lre-badge">{rows.length}</span>}>
          <input
            class="lre-input"
            placeholder="Search rows"
            aria-label="Search rows"
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
          />
          <div class="lre-list" style={{ marginTop: "8px" }}>
            {pageRows.map(([rid, r]) => {
              const bad = columns.filter(([name, c]) => cellProblem(c, r[name]) !== null).length;
              const label = typeof r.label === "string" ? r.label : typeof r.name === "string" ? r.name : rid;
              return (
                <button key={rid} type="button" class="lre-item" onClick={() => setRowId(rid)}>
                  <span class="grow">
                    <span class="title">{label}</span>
                    <span class="sub">
                      <code>{rid}</code>
                    </span>
                  </span>
                  {bad > 0 ? <span class="lre-badge neg">{bad}</span> : null}
                </button>
              );
            })}
          </div>
          {rows.length > PAGE ? (
            <div class="lre-spread" style={{ marginTop: "8px" }}>
              <button type="button" class="lre-btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <span aria-hidden="true">‹</span> Prev
              </button>
              <span class="lre-small lre-muted">
                {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}
              </span>
              <button type="button" class="lre-btn small" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>
                Next <span aria-hidden="true">›</span>
              </button>
            </div>
          ) : null}
          <form
            class="lre-inline"
            style={{ marginTop: "8px" }}
            onSubmit={(event) => {
              event.preventDefault();
              const rid = newRow.trim();
              if (!rid || rid in table.rows) return;
              setRow(rid, {});
              setRowId(rid);
              setNewRow("");
            }}
          >
            <input class="lre-input" style={{ flex: 1 }} placeholder="New row id" aria-label="New row id" value={newRow} onInput={(event) => setNewRow(event.currentTarget.value.replace(/\s+/g, "_"))} />
            <button type="submit" class="lre-btn small" disabled={!newRow.trim() || newRow.trim() in table.rows}>
              + Row
            </button>
          </form>
        </Card>
      )}
      <div class="lre-inline">
        <button
          type="button"
          class="lre-btn primary"
          disabled={!changed || busy}
          title={problems > 0 ? `${problems} cell(s) break the column contract` : undefined}
          aria-label={problems > 0 ? `Save table, ${problems} cell(s) break the column contract` : undefined}
          onClick={() =>
            run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tables", id, value: table as unknown as JsonValue });
              if (message.type === "lre.result") app.toast("Table saved to the draft.", "info");
            })
          }
        >
          Save table{problems > 0 ? ` (${problems}⚠)` : ""}
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setTable(stored ? structuredClone(stored) : null)}>
          Revert
        </button>
      </div>
    </div>
  );
}
