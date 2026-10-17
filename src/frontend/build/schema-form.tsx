// The schema-driven form (DESIGN §13): renders a value from `FieldSpec`s, with refs as pickers over
// the draft's collections, formulas in the expression editor, entity fields typed by their kind
// (single inheritance resolved here for display only) and the backend's lint beside each field.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { Band } from "../../shared/ids";
import { BANDS, DOMAINS } from "../../shared/ids";
import { formatMoneyInput, minorUnitPlural, parseMoneyInput } from "../../shared/money";
import { BAND_LABEL, tierOf, tiersInOrder } from "../../shared/tiers";
import type { LintIssue } from "../../shared/protocol";
import { BUILTIN_RELATIONS, formatMoney } from "../../shared/world";
import type { FieldDef, WorldCurrency, WorldDoc } from "../../shared/world";
import { MoneyInput } from "../money-input";
import { ExprEditor } from "./expr-editor";
import type { FieldSpec, RefCollection } from "./schema";

export interface FormCtx {
  doc: WorldDoc;
  lint: readonly LintIssue[];
  /** Document path of the value, e.g. `entities.npc_dev`. */
  path: string;
  identifiers: readonly string[];
}

export function lintAt(lint: readonly LintIssue[], path: string): LintIssue[] {
  return lint.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
}

/** Pickable ids of a collection with display labels; relations include the built-in types. */
export function refOptions(doc: WorldDoc, collection: RefCollection): { value: string; label: string }[] {
  const source: Record<string, unknown> = doc[collection];
  const options = Object.entries(source).map(([id, entry]) => {
    const label = isRecord(entry) ? (typeof entry.name === "string" ? entry.name : typeof entry.label === "string" ? entry.label : id) : id;
    const pack = collection === "kinds" && isRecord(entry) && typeof entry.pack === "string" ? `, ${entry.pack} pack` : "";
    return { value: id, label: label === id && pack === "" ? id : `${label} (${id}${pack})` };
  });
  if (collection === "relations") for (const id of BUILTIN_RELATIONS) if (!(id in source)) options.push({ value: id, label: `${id} (built-in)` });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** A kind's fields with inherited ones, child definitions winning; cycles stop the walk. */
export function kindFields(doc: WorldDoc, kindId: string): Record<string, FieldDef> {
  const chain: string[] = [];
  for (let id: string | undefined = kindId; id && !chain.includes(id); id = doc.kinds[id]?.extends) chain.push(id);
  const out: Record<string, FieldDef> = {};
  for (const id of chain.reverse()) Object.assign(out, doc.kinds[id]?.fields ?? {});
  return out;
}

/** True when `kindId` is `ancestor` or inherits from it. */
function kindIs(doc: WorldDoc, kindId: string, ancestor: string): boolean {
  const seen: string[] = [];
  for (let id: string | undefined = kindId; id && !seen.includes(id); id = doc.kinds[id]?.extends) {
    if (id === ancestor) return true;
    seen.push(id);
  }
  return false;
}

function Issues(props: { issues: readonly LintIssue[] }) {
  return (
    <>
      {props.issues.map((issue) => (
        <span key={`${issue.path}:${issue.code}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
          {issue.message}
        </span>
      ))}
    </>
  );
}

function JsonInput(props: { label: string; value: JsonValue | undefined; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const [text, setText] = useState(() => (props.value === undefined ? "" : JSON.stringify(props.value, null, 2)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(props.value === undefined ? "" : JSON.stringify(props.value, null, 2));
    setError(null);
  }, [JSON.stringify(props.value)]);
  return (
    <label class="lre-field">
      <span class="label">
        {props.label}
        {props.optional ? " (optional)" : ""}
      </span>
      <textarea
        class={error ? "lre-input invalid" : "lre-input"}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        spellcheck={false}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          if (text.trim() === "") {
            setError(null);
            props.onChange(props.optional ? undefined : null);
            return;
          }
          try {
            props.onChange(JSON.parse(text) as JsonValue);
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Not valid JSON");
          }
        }}
      />
      {props.hint ? <span class="lre-small lre-dim">{props.hint}</span> : null}
      {error ? <span class="lre-small lre-neg">{error}</span> : null}
      <Issues issues={props.issues} />
    </label>
  );
}

function NumberInput(props: { label: string; value: JsonValue | undefined; min?: number; max?: number; step?: number; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const [text, setText] = useState(typeof props.value === "number" ? String(props.value) : "");
  useEffect(() => setText(typeof props.value === "number" ? String(props.value) : ""), [props.value]);
  const parsed = text.trim() === "" ? null : Number(text);
  const invalid = (parsed === null && !props.optional) || (parsed !== null && (!Number.isFinite(parsed) || (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max)));
  return (
    <label class="lre-field">
      <span class="label">
        {props.label}
        {props.optional ? " (optional)" : ""}
      </span>
      <input
        class={invalid ? "lre-input invalid" : "lre-input"}
        inputMode="decimal"
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          if (invalid) return;
          props.onChange(parsed === null ? undefined : parsed);
        }}
      />
      {props.hint ? <span class="lre-small lre-dim">{props.hint}</span> : null}
      <Issues issues={props.issues} />
    </label>
  );
}

/**
 * A money field as Build stores it: whole minor units of the world's currency, which the label
 * names ("Opening balance (cents)", "(bits)", "(pennies)"), with the amount they make beside it.
 */
export function MinorMoneyInput(props: { label: string; value: JsonValue | undefined; currency: WorldCurrency; min?: number; max?: number; optional?: boolean; hint?: string; placeholder?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const asText = (v: JsonValue | undefined): string => (typeof v === "number" ? formatMoneyInput(v, props.currency, "minor") : "");
  const [text, setText] = useState(() => asText(props.value));
  useEffect(() => setText(asText(props.value)), [props.value]);
  const parsed = text.trim() === "" ? null : parseMoneyInput(text, props.currency, "minor");
  const invalid = text.trim() === "" ? !props.optional : parsed === null || (props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max);
  const label = `${props.label} (${minorUnitPlural(props.currency)})`;
  const notes = [...(parsed !== null ? [formatMoney(parsed, props.currency)] : []), ...(props.hint ? [props.hint] : [])];
  return (
    <label class="lre-field">
      <span class="label">
        {label}
        {props.optional ? " (optional)" : ""}
      </span>
      <MoneyInput
        currency={props.currency}
        unit="minor"
        value={text}
        onInput={setText}
        label={label}
        invalid={invalid}
        placeholder={props.placeholder}
        onBlur={() => {
          if (!invalid) props.onChange(parsed === null ? undefined : parsed);
        }}
      />
      {notes.length > 0 ? <span class="lre-small lre-dim">{notes.join(" · ")}</span> : null}
      <Issues issues={props.issues} />
    </label>
  );
}

function TextInput(props: { label: string; value: JsonValue | undefined; multiline?: boolean; optional?: boolean; readonly?: boolean; hint?: string; mono?: boolean; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const [text, setText] = useState(typeof props.value === "string" ? props.value : "");
  useEffect(() => setText(typeof props.value === "string" ? props.value : ""), [props.value]);
  const commit = () => props.onChange(text === "" && props.optional ? undefined : text);
  return (
    <label class="lre-field">
      <span class="label">
        {props.label}
        {props.optional ? " (optional)" : ""}
      </span>
      {props.multiline ? (
        <textarea class="lre-input" rows={6} readOnly={props.readonly} value={text} onInput={(event) => setText(event.currentTarget.value)} onBlur={commit} />
      ) : (
        <input class="lre-input" readOnly={props.readonly} style={props.mono ? { fontFamily: "ui-monospace, Menlo, monospace" } : undefined} value={text} onInput={(event) => setText(event.currentTarget.value)} onBlur={commit} />
      )}
      {props.hint ? <span class="lre-small lre-dim">{props.hint}</span> : null}
      <Issues issues={props.issues} />
    </label>
  );
}

function SelectInput(props: { label: string; value: JsonValue | undefined; options: readonly { value: string; label: string }[]; optional?: boolean; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const current = typeof props.value === "string" ? props.value : "";
  const options = current && !props.options.some((o) => o.value === current) ? [...props.options, { value: current, label: `${current} (missing)` }] : props.options;
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <select class="lre-input" value={current} onChange={(event) => props.onChange(event.currentTarget.value === "" ? (props.optional ? undefined : "") : event.currentTarget.value)}>
        <option value="">{props.optional ? "— none —" : "— choose —"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Issues issues={props.issues} />
    </label>
  );
}

function itemTitle(value: JsonValue, key: string | undefined, index: number): string {
  if (isRecord(value) && key && typeof value[key] === "string" && value[key] !== "") return String(value[key]);
  if (typeof value === "string" && value !== "") return value;
  return `#${index + 1}`;
}

function ListInput(props: { spec: Extract<FieldSpec, { kind: "list" }>; value: JsonValue | undefined; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const items = Array.isArray(props.value) ? props.value : [];
  const [open, setOpen] = useState<number | null>(null);
  const blank: JsonValue = props.spec.item.kind === "object" ? {} : props.spec.item.kind === "number" ? 0 : "";
  const scalar = props.spec.item.kind !== "object";
  return (
    <div class="lre-field">
      <span class="label lre-spread">
        <span>
          {props.spec.label} <span class="lre-badge">{items.length}</span>
        </span>
        <button
          type="button"
          class="lre-btn small"
          onClick={() => {
            props.onChange([...items, blank]);
            setOpen(items.length);
          }}
        >
          + Add
        </button>
      </span>
      {items.map((item, index) => (
        <div key={index} class="lre-card" style={{ padding: "6px 8px" }}>
          {scalar ? (
            <div class="lre-spread" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FieldInput spec={{ ...props.spec.item, label: `${props.spec.item.label} ${index + 1}` }} value={item} ctx={props.ctx} path={`${props.path}.${index}`} parent={{}} onChange={(next) => props.onChange(items.map((entry, i) => (i === index ? next ?? blank : entry)))} />
              </div>
              <button type="button" class="lre-btn small ghost" aria-label={`Remove ${props.spec.item.label} ${index + 1}`} onClick={() => props.onChange(items.filter((_, i) => i !== index))}>
                ✕
              </button>
            </div>
          ) : (
            <>
              <div class="lre-spread">
                <button type="button" class="lre-btn small ghost" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
                  <span aria-hidden="true">{open === index ? "▾" : "▸"}</span> {itemTitle(item, props.spec.title, index)}
                </button>
                <span class="lre-inline">
                  <button type="button" class="lre-btn small ghost" aria-label={`Move ${itemTitle(item, props.spec.title, index)} up`} disabled={index === 0} onClick={() => props.onChange(items.map((entry, i) => (i === index - 1 ? item : i === index ? (items[index - 1] ?? entry) : entry)))}>
                    ↑
                  </button>
                  <button type="button" class="lre-btn small ghost" aria-label={`Remove ${itemTitle(item, props.spec.title, index)}`} onClick={() => props.onChange(items.filter((_, i) => i !== index))}>
                    ✕
                  </button>
                </span>
              </div>
              {open === index ? <FieldInput spec={props.spec.item} value={item} ctx={props.ctx} path={`${props.path}.${index}`} parent={{}} onChange={(next) => props.onChange(items.map((entry, i) => (i === index ? next ?? blank : entry)))} /> : null}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function RecordInput(props: { spec: Extract<FieldSpec, { kind: "record" }>; value: JsonValue | undefined; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const record: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const [open, setOpen] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const blank: JsonValue = props.spec.item.kind === "object" ? {} : props.spec.item.kind === "number" ? 0 : "";
  const available = props.spec.keys ? props.spec.keys.filter((key) => !(key in record)) : null;
  const add = (key: string) => {
    if (!key || key in record) return;
    props.onChange({ ...record, [key]: blank });
    setOpen(key);
    setNewKey("");
  };
  return (
    <div class="lre-field">
      <span class="label">
        {props.spec.label} <span class="lre-badge">{Object.keys(record).length}</span>
      </span>
      {Object.entries(record).map(([key, entry]) => (
        <div key={key} class="lre-card" style={{ padding: "6px 8px" }}>
          <div class="lre-spread">
            <button type="button" class="lre-btn small ghost" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
              <span aria-hidden="true">{open === key ? "▾" : "▸"}</span> <code>{key}</code>
              {isRecord(entry) && typeof entry.type === "string" ? <span class="lre-dim"> · {entry.type}</span> : null}
            </button>
            <button
              type="button"
              class="lre-btn small ghost"
              aria-label={`Remove ${key}`}
              onClick={() => {
                const next = { ...record };
                delete next[key];
                props.onChange(next);
              }}
            >
              ✕
            </button>
          </div>
          {open === key ? <FieldInput spec={props.spec.item} value={entry} ctx={props.ctx} path={`${props.path}.${key}`} parent={{}} onChange={(next) => props.onChange({ ...record, [key]: next ?? blank })} /> : null}
        </div>
      ))}
      {available ? (
        available.length > 0 ? (
          <div class="lre-inline">
            {available.map((key) => (
              <button key={key} type="button" class="lre-btn small" onClick={() => add(key)}>
                + {key}
              </button>
            ))}
          </div>
        ) : null
      ) : (
        <form
          class="lre-inline"
          onSubmit={(event) => {
            event.preventDefault();
            add(newKey.trim());
          }}
        >
          <input class="lre-input" style={{ flex: 1 }} placeholder={props.spec.keyLabel} aria-label={props.spec.keyLabel} value={newKey} onInput={(event) => setNewKey(event.currentTarget.value.replace(/\s+/g, "_"))} />
          <button type="submit" class="lre-btn small" disabled={!newKey.trim() || newKey.trim() in record}>
            + Add
          </button>
        </form>
      )}
    </div>
  );
}

function KindFieldsInput(props: { value: JsonValue | undefined; kind: string; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const values: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const defs = props.kind ? kindFields(props.ctx.doc, props.kind) : {};
  const extra = Object.keys(values).filter((key) => !(key in defs));
  if (!props.kind) return <span class="lre-small lre-muted">Choose a kind to edit its fields.</span>;
  const set = (key: string, next: JsonValue | undefined) => {
    const out = { ...values };
    if (next === undefined) delete out[key];
    else out[key] = next;
    props.onChange(out);
  };
  return (
    <div class="lre-stack">
      <span class="lre-small lre-muted">Fields of {props.ctx.doc.kinds[props.kind]?.label ?? props.kind}</span>
      {Object.entries(defs).map(([key, def]) => {
        const label = `${def.label ?? key}${def.domain ? ` · ${def.domain} ≥${def.level ?? 0}` : ""}`;
        const issues = lintAt(props.ctx.lint, `${props.path}.${key}`);
        if (def.derived) return <TextInput key={key} label={`${label} (derived)`} value={def.derived} readonly mono issues={issues} onChange={() => {}} />;
        switch (def.type) {
          case "number":
          case "duration":
            return <NumberInput key={key} label={def.type === "duration" ? `${label} (min)` : label} value={values[key]} min={def.min} max={def.max} optional issues={issues} onChange={(next) => set(key, next)} />;
          case "money":
            return <MinorMoneyInput key={key} label={label} value={values[key]} currency={props.ctx.doc.currency} min={def.min} max={def.max} optional issues={issues} onChange={(next) => set(key, next)} />;
          case "bool":
            return (
              <label key={key} class="lre-row">
                <span class="k">{label}</span>
                <span class="lre-check">
                  <input type="checkbox" checked={values[key] === true} onChange={(event) => set(key, event.currentTarget.checked)} />
                </span>
              </label>
            );
          case "enum":
            return <SelectInput key={key} label={label} value={values[key]} options={(def.values ?? []).map((v) => ({ value: v, label: v }))} optional issues={issues} onChange={(next) => set(key, next)} />;
          case "ref":
            // A kinded ref names an entity of that kind; an unkinded one names any place or entity (world lint's rule), places first.
            return (
              <SelectInput
                key={key}
                label={label}
                value={values[key]}
                options={def.ref ? refOptions(props.ctx.doc, "entities").filter((o) => kindIs(props.ctx.doc, props.ctx.doc.entities[o.value]?.kind ?? "", def.ref ?? "")) : [...refOptions(props.ctx.doc, "places"), ...refOptions(props.ctx.doc, "entities")]}
                optional
                issues={issues}
                onChange={(next) => set(key, next)}
              />
            );
          case "list":
            return <JsonInput key={key} label={`${label} (list)`} value={values[key]} optional issues={issues} onChange={(next) => set(key, next)} />;
          default:
            return <TextInput key={key} label={label} value={values[key]} optional mono={def.type === "dice"} issues={issues} onChange={(next) => set(key, next)} />;
        }
      })}
      {extra.length > 0 ? <JsonInput label={`Other values (${extra.join(", ")})`} value={Object.fromEntries(extra.map((key) => [key, values[key] ?? null]))} issues={[]} onChange={(next) => props.onChange({ ...Object.fromEntries(Object.entries(values).filter(([key]) => key in defs)), ...(isRecord(next) ? (next as JsonObject) : {}) })} /> : null}
    </div>
  );
}

function LevelsInput(props: { label: string; value: JsonValue | undefined; onChange(value: JsonValue | undefined): void }) {
  const values: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div class="lre-tier-grid" style={{ gridTemplateColumns: "minmax(90px,1fr) minmax(64px,90px)" }}>
        {DOMAINS.map((domain) => (
          <>
            <span key={`${domain}:l`}>{domain}</span>
            <select
              key={`${domain}:s`}
              class="lre-input"
              aria-label={`${domain} level`}
              value={typeof values[domain] === "number" ? String(values[domain]) : ""}
              onChange={(event) => {
                const out = { ...values };
                if (event.currentTarget.value === "") delete out[domain];
                else out[domain] = Number(event.currentTarget.value);
                props.onChange(Object.keys(out).length > 0 ? out : undefined);
              }}
            >
              <option value="">—</option>
              {[0, 1, 2, 3, 4].map((level) => (
                <option key={level} value={String(level)}>
                  {level}
                </option>
              ))}
            </select>
          </>
        ))}
      </div>
    </div>
  );
}

/** A cap per domain for each detail band, under the band labels; "—" is no cap (the domain level). */
function BandCapsInput(props: { label: string; value: JsonValue | undefined; onChange(value: JsonValue | undefined): void }) {
  const caps: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const capsOf = (band: Band): JsonObject => {
    const c = caps[band];
    return isRecord(c) ? (c as JsonObject) : {};
  };
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div class="lre-tier-wrap">
        <div class="lre-tier-grid" role="table" aria-label={props.label} lang="en">
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader">
              <span class="lre-sr">Domain</span>
            </span>
            {BANDS.map((band) => (
              <span key={band} class="lre-muted" role="columnheader">
                {BAND_LABEL[band]}
              </span>
            ))}
          </div>
          {DOMAINS.map((domain) => (
            <div key={domain} role="row" style={{ display: "contents" }}>
              <span role="rowheader">{domain}</span>
              {BANDS.map((band) => {
                const cap = capsOf(band)[domain];
                return (
                  <span key={band} role="cell" style={{ display: "contents" }}>
                    <select
                      class="lre-input"
                      aria-label={`${domain} cap for ${BAND_LABEL[band]}`}
                      value={typeof cap === "number" ? String(cap) : ""}
                      onChange={(event) => {
                        // Every band keeps its record, so the document always has all three.
                        const out: JsonObject = Object.fromEntries(BANDS.map((b) => [b, { ...capsOf(b) }]));
                        const edited = out[band] as JsonObject;
                        if (event.currentTarget.value === "") delete edited[domain];
                        else edited[domain] = Number(event.currentTarget.value);
                        props.onChange(out);
                      }}
                    >
                      <option value="">—</option>
                      {[0, 1, 2, 3, 4].map((level) => (
                        <option key={level} value={String(level)}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FieldInput(props: { spec: FieldSpec; value: JsonValue | undefined; ctx: FormCtx; path: string; parent: JsonObject; onChange(value: JsonValue | undefined): void }) {
  const { spec, ctx } = props;
  const path = spec.key ? `${props.path}.${spec.key}` : props.path;
  const issues = lintAt(ctx.lint, path);
  switch (spec.kind) {
    case "text":
      return <TextInput label={spec.label} value={props.value} multiline={spec.multiline} optional={spec.optional} readonly={spec.readonly} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "dice":
      return <TextInput label={spec.label} value={props.value} optional={spec.optional} hint="Dice notation, e.g. 2d6+1" mono issues={issues} onChange={props.onChange} />;
    case "number":
      return <NumberInput label={spec.label} value={props.value} min={spec.min} max={spec.max} step={spec.step} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "bool":
      return (
        <label class="lre-row">
          <span class="k">
            {spec.label}
            {spec.hint ? <span class="sub">{spec.hint}</span> : null}
          </span>
          <span class="lre-check">
            <input type="checkbox" checked={props.value === true} onChange={(event) => props.onChange(event.currentTarget.checked)} />
          </span>
        </label>
      );
    case "enum":
      return <SelectInput label={spec.label} value={props.value} options={spec.values.map((v) => ({ value: v, label: v }))} optional={spec.optional} issues={issues} onChange={props.onChange} />;
    case "ref":
      if (spec.inline && isRecord(props.value)) return <JsonInput label={`${spec.label} (inline)`} value={props.value} optional={spec.optional} issues={issues} onChange={props.onChange} />;
      return <SelectInput label={spec.label} value={props.value} options={spec.any ? [{ value: "*", label: "* (any kind)" }, ...refOptions(ctx.doc, spec.collection)] : refOptions(ctx.doc, spec.collection)} optional={spec.optional} issues={issues} onChange={props.onChange} />;
    case "expr":
      return <ExprEditor label={spec.label} value={typeof props.value === "string" ? props.value : ""} identifiers={ctx.identifiers} lint={issues} optional={spec.optional} onChange={(next) => props.onChange(next === "" && spec.optional ? undefined : next)} />;
    case "tags": {
      const tags = Array.isArray(props.value) ? props.value.filter((t): t is string => typeof t === "string") : [];
      return (
        <TextInput
          label={`${spec.label} (comma separated)`}
          value={tags.join(", ")}
          optional
          issues={issues}
          onChange={(next) => {
            const list = typeof next === "string" ? next.split(",").map((t) => t.trim()).filter((t) => t.length > 0) : [];
            props.onChange(list.length > 0 ? list : undefined);
          }}
        />
      );
    }
    case "refs": {
      const ids = Array.isArray(props.value) ? props.value.filter((v): v is string => typeof v === "string") : [];
      const options = spec.collections.flatMap((collection) => refOptions(ctx.doc, collection));
      const name = (id: string) => options.find((o) => o.value === id)?.label ?? id;
      return (
        <div class="lre-field">
          <span class="label">{spec.label}</span>
          {ids.length > 0 ? (
            <div class="lre-inline" style={{ flexWrap: "wrap" }}>
              {ids.map((id) => (
                <button key={id} type="button" class="lre-btn small" aria-label={`Remove ${name(id)}`} onClick={() => props.onChange(ids.filter((other) => other !== id))}>
                  {name(id)} ✕
                </button>
              ))}
            </div>
          ) : null}
          <select class="lre-input" value="" aria-label={`Add to ${spec.label}`} onChange={(event) => (event.currentTarget.value ? props.onChange([...ids, event.currentTarget.value]) : undefined)}>
            <option value="">+ Add…</option>
            {options
              .filter((o) => !ids.includes(o.value))
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </div>
      );
    }
    case "json":
      return <JsonInput label={spec.label} value={props.value} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "list":
      return <ListInput spec={spec} value={props.value} ctx={ctx} path={path} onChange={props.onChange} />;
    case "record":
      return <RecordInput spec={spec} value={props.value} ctx={ctx} path={path} onChange={props.onChange} />;
    case "kindFields":
      return <KindFieldsInput value={props.value} kind={typeof props.parent.kind === "string" ? props.parent.kind : ""} ctx={ctx} path={path} onChange={props.onChange} />;
    case "levels":
      return <LevelsInput label={spec.label} value={props.value} onChange={props.onChange} />;
    case "bandCaps":
      return <BandCapsInput label={spec.label} value={props.value} onChange={props.onChange} />;
    case "tier":
      return (
        <SelectInput
          label={spec.label}
          value={props.value}
          options={tiersInOrder(ctx.doc).map(([id, t]) => ({ value: id, label: t.label === BAND_LABEL[t.band] ? t.label : `${t.label} (${BAND_LABEL[t.band]})` }))}
          issues={issues}
          onChange={props.onChange}
        />
      );
    case "agent": {
      // Unset follows the tier's default, which the POV never takes.
      const tier = typeof props.parent.tier === "string" ? tierOf(ctx.doc, props.parent.tier) : undefined;
      const inherited = props.parent.id !== ctx.doc.pov && tier?.agentDefault === true;
      return (
        <label class="lre-field">
          <span class="label">{spec.label}</span>
          <select
            class="lre-input"
            value={props.value === true ? "yes" : props.value === false ? "no" : ""}
            onChange={(event) => {
              const choice = event.currentTarget.value;
              props.onChange(choice === "yes" ? true : choice === "no" ? false : undefined);
            }}
          >
            <option value="">As its tier ({inherited ? "yes" : "no"})</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <Issues issues={issues} />
        </label>
      );
    }
    case "object": {
      if (spec.optional && !isRecord(props.value)) {
        return (
          <div class="lre-spread">
            <span class="lre-muted">{spec.label}</span>
            <button type="button" class="lre-btn small" onClick={() => props.onChange({})}>
              + Add
            </button>
          </div>
        );
      }
      const value: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
      return (
        <div class="lre-stack">
          {spec.key ? (
            <div class="lre-spread">
              <span class="lre-small lre-muted">{spec.label}</span>
              {spec.optional ? (
                <button type="button" class="lre-btn small ghost" onClick={() => props.onChange(undefined)}>
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}
          <SchemaFields specs={spec.fields} value={value} ctx={{ ...ctx, path }} onChange={props.onChange} />
        </div>
      );
    }
  }
}

export function SchemaFields(props: { specs: readonly FieldSpec[]; value: JsonObject; ctx: FormCtx; onChange(next: JsonObject): void }) {
  return (
    <div class="lre-stack">
      {props.specs.map((spec) => (
        <FieldInput
          key={spec.key}
          spec={spec}
          value={props.value[spec.key]}
          ctx={props.ctx}
          path={props.ctx.path}
          parent={props.value}
          onChange={(next) => {
            const out = { ...props.value };
            if (next === undefined) delete out[spec.key];
            else out[spec.key] = next;
            props.onChange(out);
          }}
        />
      ))}
    </div>
  );
}

/** Identifiers the expression editor suggests: entity, place, field, track and check ids. */
export function worldIdentifiers(doc: WorldDoc): string[] {
  const out = new Set<string>([...Object.keys(doc.entities), ...Object.keys(doc.places), ...Object.keys(doc.tracks), ...Object.keys(doc.checks), "pov", "scene", "now"]);
  for (const kind of Object.values(doc.kinds)) for (const field of Object.keys(kind.fields)) out.add(field);
  return [...out].sort();
}
