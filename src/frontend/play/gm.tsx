// Play → GM view (DESIGN §7): everything, secrets and removed entities included, and the GM
// editor. Behind a spoiler gate; its data is asked for (`lre.gm`) only once the gate is open, so it
// never travels with the player's state. Every change is one `lre.edit`: checked against what it
// touches, all or none, one fix with its own Undo chip. An entity's classes (hidden facets too) and
// tags are set here for this chat; kinds and places are the world's definitions, edited in Build.
// Packs add their own tabs (`UiRegistry.gm`: everyone's money is the economy pack's).

import { useEffect, useId, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import type { EditOp } from "../../shared/protocol";

import type { GmEntity, GmField, GmRelation, GmView } from "../../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../shared/world";
import { useApp } from "../app";
import { Card, Empty, Row, Tabs, tabPanel, useBusy } from "../components";
import { ClassesInput } from "../build/facet-editor";
import { TagListInput } from "../build/selector-editor";
import { parseFixValue } from "../fix-editor";
import type { GmSectionProps, PanelProps } from "../registry";
import { adjustOp, classifyOp, editRequest, entityStateOp, lifeEditOp, relationFields } from "../requests";
import { decodeEncounterView, EncounterCard } from "../../packs/combat/ui/panel";

/** The engine's own tabs; a pack's tab goes by its registered id, which holds a dot. */
type Section = "entities" | "places" | "tracks" | "fight" | "edits" | (string & {});

/** What the editor's forms share: the loaded view, the currency, and one way to send an edit. */
interface Editor {
  gm: GmView;
  currency: WorldCurrency;
  busy: boolean;
  edit(ops: EditOp[]): Promise<boolean>;
}

function nameOf(gm: GmView, id: string | null): string {
  if (id === null) return "—";
  return gm.entities.find((e) => e.id === id)?.name ?? gm.places.find((p) => p.id === id)?.name ?? id;
}

function shown(value: JsonValue, field: GmField, editor: Editor): string {
  if (value === null || value === undefined) return "—";
  if (field.type === "money" && typeof value === "number") return formatMoney(value, editor.currency);
  if (field.type === "ref" && typeof value === "string") return nameOf(editor.gm, value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function textOf(value: JsonValue, field: GmField, currency: WorldCurrency): string {
  if (field.type === "money" && typeof value === "number") return (value / 10 ** currency.decimals).toFixed(currency.decimals);
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The typed value for a field's text: by its definition, or any JSON for a value the kind doesn't declare. */
function parse(entity: GmEntity, field: GmField, text: string, currency: WorldCurrency): JsonValue | null {
  if (field.extra && field.type !== "number" && field.type !== "bool" && text.trim() !== "" && /^[[{"]/.test(text.trim())) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      return null;
    }
  }
  return parseFixValue({ entity: entity.id, field: field.id, type: field.type, value: field.value, ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) }, text, currency);
}

function FieldRow(props: { entity: GmEntity; field: GmField; editor: Editor }) {
  const { entity, field, editor } = props;
  const [text, setText] = useState<string | null>(null);
  const refs = field.type === "ref" ? [...editor.gm.places.map((p) => ({ value: p.id, label: p.name })), ...editor.gm.entities.filter((e) => !field.ref || e.kind === field.ref).map((e) => ({ value: e.id, label: e.name }))] : [];
  const options = field.type === "enum" ? (field.values ?? []).map((v) => ({ value: v, label: v })) : field.type === "bool" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : refs;
  const value = text === null ? null : field.type === "ref" ? (text === "" ? null : text) : field.type === "enum" ? text : parse(entity, field, text, editor.currency);
  const bounds = field.min !== undefined || field.max !== undefined ? ` (${field.min ?? "…"}–${field.max ?? "…"})` : "";
  if (text === null) {
    const label = `${field.label}${field.locked ? " 🔒" : ""}`;
    const edit = field.derived ? null : <button type="button" class="lre-btn small ghost" aria-label={`Edit ${field.label}`} onClick={() => setText(field.type === "bool" ? String(field.value === true) : textOf(field.value, field, editor.currency))}>✎</button>;
    const note = field.derived ? "worked out" : field.extra ? "not in the kind" : null;
    // Free text runs long: it reads under the label, with ✎ beside it rather than wrapped below.
    if (field.type === "text" || field.extra) return <Row k={label} sub={[shown(field.value, field, editor), note].filter((s) => s !== null).join(" · ")} v={edit} />;
    return <Row k={label} sub={note ?? undefined} v={<span class="lre-inline">{shown(field.value, field, editor)}{edit}</span>} />;
  }
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (value === null && field.type !== "ref") return;
        void editor.edit([{ op: "set", entity: entity.id, field: field.id, value }]).then((ok) => ok && setText(null));
      }}
    >
      <label class="lre-field">
        <span class="label">
          {field.label}
          {bounds}
        </span>
        {options.length > 0 || field.type === "ref" ? (
          <select class="lre-input" value={text} onChange={(event) => setText(event.currentTarget.value)}>
            {field.type === "ref" ? <option value="">None</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input class={value === null ? "lre-input invalid" : "lre-input"} value={text} onInput={(event) => setText(event.currentTarget.value)} />
        )}
      </label>
      <div class="lre-inline">
        <button type="submit" class="lre-btn primary" disabled={editor.busy || (value === null && field.type !== "ref")}>
          Save
        </button>
        <button type="button" class="lre-btn ghost" onClick={() => setText(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Tier, agent flag and per-domain level overrides, saved together. */
function EntityState(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [tier, setTier] = useState(entity.tier);
  const [agent, setAgent] = useState(entity.agent);
  const [levels, setLevels] = useState<Record<string, number | null>>(Object.fromEntries(entity.levels.map((l) => [l.domain, l.override])));
  const op = entityStateOp(entity, tier, agent, levels);
  return (
    <Card title="Simulation">
      <label class="lre-field">
        <span class="label">Tier</span>
        <select class="lre-input" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
          {editor.gm.tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {entity.pov ? null : (
        <label class="lre-inline">
          <input type="checkbox" checked={agent} onChange={(event) => setAgent(event.currentTarget.checked)} /> Lives their own day (agendas and plans)
        </label>
      )}
      {entity.levels.map((l) => (
        <label key={l.domain} class="lre-field">
          <span class="label">
            {editor.gm.domains.find((d) => d.id === l.domain)?.label ?? l.domain} · now {l.level}
          </span>
          <select class="lre-input" value={levels[l.domain] === null || levels[l.domain] === undefined ? "" : String(levels[l.domain])} onChange={(event) => setLevels({ ...levels, [l.domain]: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) })}>
            <option value="">From the tier</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>
                Level {n}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="button" class="lre-btn primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </button>
    </Card>
  );
}

/** Classes, every facet's (the GM sees the hidden ones too), and tags, saved together for this chat. */
function Classification(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [classes, setClasses] = useState(entity.class);
  const [tags, setTags] = useState(entity.tags);
  const op = classifyOp(entity, classes, tags);
  const suggestions = [...new Set(editor.gm.entities.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b));
  return (
    <Card title="Classification">
      <ClassesInput label="Classes" value={classes} doc={editor.gm} onChange={(next) => setClasses(next ?? {})} />
      <TagListInput label="Tags" value={tags} suggestions={suggestions} onChange={setTags} />
      <button type="button" class="lre-btn primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </button>
    </Card>
  );
}

/** The life state, who knows it as it is, and who is told it with this save (DESIGN §8); everyone with them learns a change anyway. */
function Life(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [to, setTo] = useState(entity.life.state);
  const [tell, setTell] = useState<string[]>([]);
  const op = lifeEditOp(entity, to, tell);
  const name = (id: string): string => (editor.gm.entities.find((e) => e.id === id)?.pov ? "You" : (editor.gm.entities.find((e) => e.id === id)?.name ?? id));
  const others = editor.gm.entities.filter((e) => e.id !== entity.id && !e.gone && !tell.includes(e.id));
  const { everyone, aware, unaware } = entity.life;
  return (
    <Card title="Life">
      <Row k="Known to" v={everyone ? (unaware.length > 0 ? `everyone but ${unaware.map((p) => name(p.id)).join(", ")}` : "everyone") : aware.length > 0 ? aware.map((p) => name(p.id)).join(", ") : "no one"} />
      <label class="lre-field">
        <span class="label">Life state</span>
        <select class="lre-input" value={to} onChange={(event) => setTo(event.currentTarget.value)}>
          {editor.gm.lifeStates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.acts ? "" : " (doesn't act)"}
            </option>
          ))}
        </select>
      </label>
      {tell.length > 0 ? (
        <div class="lre-inline" style={{ flexWrap: "wrap" }}>
          {tell.map((id) => (
            <button key={id} type="button" class="lre-btn small" aria-label={`Don't tell ${name(id)}`} onClick={() => setTell(tell.filter((t) => t !== id))}>
              {name(id)} ✕
            </button>
          ))}
        </div>
      ) : null}
      <select class="lre-input" value="" aria-label="Tell someone" onChange={(event) => (event.currentTarget.value ? setTell([...tell, event.currentTarget.value]) : undefined)}>
        <option value="">+ Tell someone…</option>
        {others.map((e) => (
          <option key={e.id} value={e.id}>
            {e.pov ? "You" : e.name}
          </option>
        ))}
      </select>
      <button type="button" class="lre-btn primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </button>
    </Card>
  );
}

/** A relation's fields as the row shows them: by their labels, with a regard's current value. */
function relationDetail(r: GmRelation, gm: GmView): string | undefined {
  const defs = gm.relationTypes.find((t) => t.id === r.type)?.fields ?? [];
  const parts = Object.entries(r.fields ?? {}).map(([id, v]) => `${defs.find((d) => d.id === id)?.label ?? id} ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (r.value !== undefined) parts.push(`now ${r.value}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function Relations(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  // Containment is Placement's (move, put), not a relation to add here.
  const types = editor.gm.relationTypes.filter((t) => t.id !== "in");
  const [type, setType] = useState(types[0]?.id ?? "knows");
  const [to, setTo] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const defs = types.find((t) => t.id === type)?.fields ?? [];
  const fields = relationFields(defs, inputs, entity.relations.find((r) => r.type === type && r.to === to)?.fields);
  return (
    <Card title="Relations">
      {entity.relations.length === 0 ? <Empty>None.</Empty> : null}
      {entity.relations.map((r) => (
        <Row
          key={`${r.type}:${r.to}`}
          k={`${editor.gm.relationTypes.find((t) => t.id === r.type)?.label ?? r.type} → ${r.toName}`}
          sub={relationDetail(r, editor.gm)}
          v={
            <span class="lre-inline">
              {r.type === "in" ? null : (
                <button type="button" class="lre-btn small ghost" aria-label={`Edit ${r.type} ${r.toName}`} onClick={() => (setType(r.type), setTo(r.to), setInputs(Object.fromEntries(Object.entries(r.fields ?? {}).map(([id, v]) => [id, typeof v === "string" ? v : JSON.stringify(v)]))))}>
                  ✎
                </button>
              )}
              <button type="button" class="lre-btn small danger" disabled={editor.busy} onClick={() => void editor.edit([{ op: "unlink", rel: r.type, from: entity.id, to: r.to }])}>
                Remove
              </button>
            </span>
          }
        />
      ))}
      <div class="lre-stack" data-lre-gm-relation-form>
        <select class="lre-input" aria-label="Relation" value={type} onChange={(event) => (setType(event.currentTarget.value), setInputs({}))}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select class="lre-input" aria-label="To" value={to} onChange={(event) => setTo(event.currentTarget.value)}>
          <option value="">To…</option>
          {editor.gm.entities.filter((e) => e.id !== entity.id).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {defs.map((d) => (
          <label key={d.id} class="lre-field">
            <span class="label">
              {d.label}
              {d.min !== undefined || d.max !== undefined ? ` (${d.min ?? "…"}–${d.max ?? "…"})` : ""}
            </span>
            {d.type === "enum" || d.type === "bool" ? (
              <select class="lre-input" value={inputs[d.id] ?? ""} onChange={(event) => setInputs({ ...inputs, [d.id]: event.currentTarget.value })}>
                <option value="">None</option>
                {(d.type === "bool" ? ["true", "false"] : (d.values ?? [])).map((v) => (
                  <option key={v} value={v}>
                    {d.type === "bool" ? (v === "true" ? "Yes" : "No") : v}
                  </option>
                ))}
              </select>
            ) : (
              <input class={inputs[d.id] && relationFields([d], inputs) === null ? "lre-input invalid" : "lre-input"} inputMode={d.type === "number" ? "decimal" : undefined} value={inputs[d.id] ?? ""} onInput={(event) => setInputs({ ...inputs, [d.id]: event.currentTarget.value })} />
            )}
          </label>
        ))}
        <button type="button" class="lre-btn" disabled={editor.busy || to === "" || fields === null} onClick={() => fields && void editor.edit([{ op: "link", rel: type, from: entity.id, to, ...(Object.keys(fields).length > 0 ? { fields } : {}) }])}>
          Add or update
        </button>
      </div>
    </Card>
  );
}

/** Where it is: a place, inside something, or taken out; and money in or out of an account. */
function Placement(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [amount, setAmount] = useState("");
  const add = adjustOp(entity.id, amount, editor.currency, false);
  const take = adjustOp(entity.id, amount, editor.currency, true);
  return (
    <Card title="Placement">
      <Row k="At" v={nameOf(editor.gm, entity.place)} />
      {entity.holder ? <Row k="Inside" v={nameOf(editor.gm, entity.holder)} /> : null}
      <select class="lre-input" aria-label="Move to a place" value="" onChange={(event) => event.currentTarget.value !== "" && void editor.edit([{ op: "move", entity: entity.id, to: event.currentTarget.value }])}>
        <option value="">Move to a place…</option>
        {editor.gm.places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select class="lre-input" aria-label="Put inside" value="" onChange={(event) => event.currentTarget.value !== "" && void editor.edit([{ op: "put", entity: entity.id, into: event.currentTarget.value }])}>
        <option value="">Put inside…</option>
        {editor.gm.entities.filter((e) => e.id !== entity.id).map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      {entity.holder ? (
        <button type="button" class="lre-btn" disabled={editor.busy} onClick={() => void editor.edit([{ op: "put", entity: entity.id, into: null }])}>
          Take out
        </button>
      ) : null}
      {entity.balance !== undefined ? (
        <div class="lre-stack">
          <Row k="Balance" v={formatMoney(entity.balance, editor.currency)} />
          <input class={add === null && amount !== "" ? "lre-input invalid" : "lre-input"} aria-label="Amount" placeholder="Amount" value={amount} onInput={(event) => setAmount(event.currentTarget.value)} />
          <div class="lre-inline">
            <button type="button" class="lre-btn" disabled={editor.busy || add === null} onClick={() => add && void editor.edit([add])}>
              Add
            </button>
            <button type="button" class="lre-btn" disabled={editor.busy || take === null} onClick={() => take && void editor.edit([take])}>
              Take
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function EntityEditor(props: { entity: GmEntity; editor: Editor; onClose(): void }) {
  const { entity, editor } = props;
  const numbers = entity.fields.filter((f) => !f.derived && (f.type === "number" || f.type === "money" || f.type === "duration"));
  const [addField, setAddField] = useState(numbers[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const amount = Number(delta);
  return (
    <div class="lre-stack" data-lre-gm-entity={entity.id}>
      <Card
        title={entity.name}
        aside={
          <span class="lre-inline">
            {entity.gone ? <span class="lre-badge neg">Removed</span> : null}
            {entity.life.state !== "alive" ? <span class="lre-badge neg">{entity.life.label}</span> : null}
            {entity.visibility !== "public" ? <span class="lre-badge warn">{entity.visibility.replace(/_/g, " ")}</span> : null}
            <button type="button" class="lre-btn small ghost" onClick={props.onClose}>
              All
            </button>
          </span>
        }
      >
        <Row k="Kind" v={editor.gm.kinds.find((k) => k.id === entity.kind)?.label ?? entity.kind} sub={entity.spawned ? "spawned in this chat" : undefined} />
        {entity.pov ? null : entity.gone ? (
          <button type="button" class="lre-btn primary" disabled={editor.busy} onClick={() => void editor.edit([{ op: "restore", entity: entity.id }])}>
            Restore
          </button>
        ) : (
          <button type="button" class="lre-btn danger" disabled={editor.busy} onClick={() => void editor.edit([{ op: "despawn", entity: entity.id }])}>
            Remove from the world
          </button>
        )}
      </Card>
      <Card title="Fields">
        {entity.fields.map((f) => (
          <FieldRow key={f.id} entity={entity} field={f} editor={editor} />
        ))}
        {numbers.length > 0 ? (
          <div class="lre-inline">
            <select class="lre-input" aria-label="Add to" value={addField} onChange={(event) => setAddField(event.currentTarget.value)}>
              {numbers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input class="lre-input" inputMode="decimal" aria-label="Amount to add" placeholder="+/−" value={delta} onInput={(event) => setDelta(event.currentTarget.value)} />
            <button type="button" class="lre-btn" disabled={editor.busy || delta.trim() === "" || !Number.isFinite(amount) || amount === 0} onClick={() => void editor.edit([{ op: "add", entity: entity.id, field: addField, delta: amount }]).then((ok) => ok && setDelta(""))}>
              Add
            </button>
          </div>
        ) : null}
      </Card>
      {entity.sheet?.map((section) => (
        <Card key={section.title} title={section.title}>
          {section.rows.map((row) => (
            <Row key={row.label} k={row.label} v={row.value} sub={row.detail} />
          ))}
        </Card>
      ))}
      <Placement entity={entity} editor={editor} />
      <Relations entity={entity} editor={editor} />
      <EntityState key={`${entity.tier}:${entity.agent}:${JSON.stringify(entity.levels)}`} entity={entity} editor={editor} />
      <Life key={JSON.stringify(entity.life)} entity={entity} editor={editor} />
      <Classification key={JSON.stringify([entity.class, entity.tags])} entity={entity} editor={editor} />
    </div>
  );
}

function Spawn(props: { editor: Editor }) {
  const { editor } = props;
  const [kind, setKind] = useState(editor.gm.kinds.find((k) => k.id === "person")?.id ?? editor.gm.kinds[0]?.id ?? "");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [tier, setTier] = useState("");
  return (
    <Card title="Spawn">
      <select class="lre-input" aria-label="Kind" value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
        {editor.gm.kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <input class="lre-input" aria-label="Name" placeholder="Name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
      <select class="lre-input" aria-label="Place" value={place} onChange={(event) => setPlace(event.currentTarget.value)}>
        <option value="">No place</option>
        {editor.gm.places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select class="lre-input" aria-label="Tier" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
        <option value="">The world's tier for new people</option>
        {editor.gm.tiers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="button" class="lre-btn primary" disabled={editor.busy || name.trim() === "" || kind === ""} onClick={() => void editor.edit([{ op: "spawn", kind, name: name.trim(), ...(place ? { place } : {}), ...(tier ? { tier } : {}) }]).then((ok) => ok && setName(""))}>
        Spawn
      </button>
    </Card>
  );
}

function Entities(props: { editor: Editor }) {
  const { editor } = props;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const selected = editor.gm.entities.find((e) => e.id === open);
  if (selected) return <EntityEditor entity={selected} editor={editor} onClose={() => setOpen(null)} />;
  const q = query.trim().toLowerCase();
  const list = editor.gm.entities.filter((e) => (kind === "" || e.kind === kind) && (q === "" || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))).sort((a, b) => Number(a.gone) - Number(b.gone) || a.name.localeCompare(b.name));
  const kinds = editor.gm.kinds.filter((k) => editor.gm.entities.some((e) => e.kind === k.id));
  return (
    <div class="lre-stack">
      <div class="lre-inline">
        <input class="lre-input" type="search" aria-label="Search" placeholder="Search by name" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        <select class="lre-input" aria-label="Kind" value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
          <option value="">Every kind</option>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <Card title={`${list.length} of ${editor.gm.entities.length}`}>
        <div class="lre-list" data-lre-gm-list="entities">
          {list.map((e) => (
            <button key={e.id} type="button" class="lre-item" onClick={() => setOpen(e.id)}>
              <span class="grow">
                {e.name}
                <span class="sub">{editor.gm.kinds.find((k) => k.id === e.kind)?.label ?? e.kind}</span>
              </span>
              {e.pov ? <span class="lre-badge accent">You</span> : null}
              {e.gone ? <span class="lre-badge neg">Removed</span> : null}
              {e.life.state !== "alive" ? <span class="lre-badge neg">{e.life.label}</span> : null}
              {e.spawned ? <span class="lre-badge">Spawned</span> : null}
              {e.agent ? <span class="lre-badge">Own day</span> : null}
              {e.visibility !== "public" ? <span class="lre-badge warn">{e.visibility.replace(/_/g, " ")}</span> : null}
            </button>
          ))}
        </div>
      </Card>
      <Spawn editor={editor} />
    </div>
  );
}

function Body(props: { editor: Editor; section: Omit<GmSectionProps, "gm" | "busy" | "edit"> }) {
  const { editor } = props;
  const app = useApp();
  const [section, setSection] = useState<Section>("entities");
  const panelId = useId();
  const { gm } = editor;
  const packTab = app.catalog.gmSections.find((def) => def.id === section);
  // The fight under way, everyone named and HP exact (the combat pack's GM view).
  const fight = gm.encounter === null ? null : decodeEncounterView(gm.encounter);
  // A Fight tab left open when the fight ends falls back to Entities.
  const shown: Section = section === "fight" && !fight ? "entities" : section;
  return (
    <div class="lre-stack">
      <Tabs<Section>
        label="GM view"
        panelId={panelId}
        value={shown}
        tabs={[
          { id: "entities", label: "Entities" },
          { id: "places", label: "Places" },
          { id: "tracks", label: "Tracks" },
          ...app.catalog.gmSections.map((def) => ({ id: def.id, label: def.label })),
          ...(fight ? [{ id: "fight" as const, label: "Fight" }] : []),
          { id: "edits", label: "Edits" },
        ]}
        onChange={setSection}
      />
      <div class="lre-stack" {...tabPanel(panelId, shown)}>
        {shown === "fight" && fight ? <EncounterCard view={fight} /> : null}
        {shown === "entities" ? <Entities editor={editor} /> : null}
        {section === "places" ? (
          <Card title="Places">
            {gm.places.map((p) => (
              <Row key={p.id} k={p.name} sub={p.parent ? `in ${nameOf(gm, p.parent)}` : undefined} v={<span class={p.visibility === "public" ? "lre-badge" : "lre-badge warn"}>{p.visibility.replace(/_/g, " ")}</span>} />
            ))}
          </Card>
        ) : null}
        {section === "tracks"
          ? gm.tracks.map((t) => (
              <Card key={t.id} title={t.label} aside={<span class="lre-badge">{t.kind}</span>}>
                {t.owner ? <Row k="Owner" v={t.owner} /> : null}
                <select class="lre-input" aria-label={`${t.label} stage`} value={t.stage} disabled={editor.busy} onChange={(event) => void editor.edit([{ op: "stage", track: t.id, to: event.currentTarget.value }])}>
                  {t.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {t.stages.filter((s) => s.truth).map((s) => (
                  <Row key={s.id} k={s.label} v={s.truth} />
                ))}
              </Card>
            ))
          : null}
        {packTab ? <packTab.component {...props.section} gm={gm} busy={editor.busy} edit={editor.edit} /> : null}
        {section === "edits" ? (
          <Card title="Corrections in force">
            {gm.refused.map((r) => (
              <Row key={r.id} k="Didn't apply after a reply" v={r.reason} tone="warn" />
            ))}
            {gm.edits.length === 0 ? <Empty>No corrections on this path.</Empty> : gm.edits.map((e) => <Row key={`${e.messageId}:${e.seq}`} k={e.lines.join(" · ") || "(bookkeeping)"} />)}
          </Card>
        ) : null}
      </div>
      <button type="button" class="lre-btn ghost" onClick={() => app.ui.update((ui) => ({ ...ui, section: "build" }))}>
        Kinds and places are the world's: edit them in Build
      </button>
    </div>
  );
}

export function GmPanel(props: PanelProps) {
  const app = useApp();
  const [revealed, setRevealed] = useState(false);
  const [gm, setGm] = useState<GmView | null>(null);
  const [busy, run] = useBusy();
  const load = async (): Promise<void> => {
    const view = await app.request({ type: "lre.gm", chatId: props.chatId });
    if (view) setGm(view);
  };
  // Loaded when the gate opens, and again when the chat moves on (a turn, an edit, an undo).
  useEffect(() => {
    if (revealed) void load();
  }, [revealed, props.chatId, props.state.status, props.state.chips.length, props.state.journal.length]);
  if (!revealed) {
    return (
      <div class="lre-stack" data-lre-panel="core.gm">
        <div class="lre-banner warn">
          <strong>Spoilers ahead</strong>
          <span>The GM view shows and edits everything: secrets, hidden agendas, unrevealed truths, removed people and everyone's money. Each edit is a correction with its own Undo.</span>
        </div>
        <button type="button" class="lre-btn primary" onClick={() => setRevealed(true)}>
          Show the GM view
        </button>
      </div>
    );
  }
  const editor: Editor | null = gm
    ? {
        gm,
        currency: props.state.currency ?? DEFAULT_CURRENCY,
        busy,
        edit: (ops) =>
          new Promise<boolean>((resolve) =>
            run(async () => {
              const result = await app.request(editRequest(props.chatId, ops));
              if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
              if (result) await load();
              resolve(result !== null);
            }),
          ),
      }
    : null;
  return (
    <div class="lre-stack" data-lre-panel="core.gm">
      <div class="lre-spread">
        <span class="lre-preview-label">GM view</span>
        <button type="button" class="lre-btn small" onClick={() => (setRevealed(false), setGm(null))}>
          Hide
        </button>
      </div>
      {editor ? <Body editor={editor} section={{ chatId: props.chatId, currency: editor.currency, reload: load, send: props.send }} /> : <Empty>Loading the GM view…</Empty>}
    </div>
  );
}
