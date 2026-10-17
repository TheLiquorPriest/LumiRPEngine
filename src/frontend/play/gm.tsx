// Play → GM view (DESIGN §7): everything, secrets and removed entities included, and the GM
// editor. Behind a spoiler gate; its data is asked for (`lre.gm`) only once the gate is open, so it
// never travels with the player's state. Every change is one `lre.edit`: checked against what it
// touches, all or none, one fix with its own Undo chip. Kinds, classifications and tags are the
// world's definitions, edited in Build.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import { parseMoneyInput } from "../../shared/money";
import type { EditOp } from "../../shared/protocol";
import type { GmEntity, GmField, GmMoney, GmView } from "../../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../shared/world";
import { useApp } from "../app";
import { Card, Empty, Row, Seg, useBusy } from "../components";
import { parseFixValue } from "../fix-editor";
import type { PanelProps } from "../registry";

type Section = "entities" | "places" | "tracks" | "money" | "edits";

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
    return <Row k={`${field.label}${field.locked ? " 🔒" : ""}`} sub={field.derived ? "worked out" : field.extra ? "not in the kind" : undefined} v={<span class="lre-inline">{shown(field.value, field, editor)}{field.derived ? null : <button type="button" class="lre-btn small ghost" aria-label={`Edit ${field.label}`} onClick={() => setText(field.type === "bool" ? String(field.value === true) : textOf(field.value, field, editor.currency))}>✎</button>}</span>} />;
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
  const changed: Record<string, number | null> = Object.fromEntries(Object.entries(levels).filter(([d, v]) => entity.levels.find((l) => l.domain === d)?.override !== v));
  const op: EditOp = { op: "entity", entity: entity.id, ...(tier !== entity.tier ? { tier } : {}), ...(agent !== entity.agent ? { agent } : {}), ...(Object.keys(changed).length > 0 ? { levels: changed } : {}) };
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
          <input type="checkbox" checked={agent} onChange={(event) => setAgent(event.currentTarget.checked)} /> Lives off-screen (an agent)
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
      <button type="button" class="lre-btn primary" disabled={editor.busy || Object.keys(op).length === 2} onClick={() => void editor.edit([op])}>
        Save
      </button>
    </Card>
  );
}

function Relations(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [type, setType] = useState(editor.gm.relationTypes[0]?.id ?? "knows");
  const [to, setTo] = useState("");
  const [fields, setFields] = useState("");
  let parsed: JsonObject | null = {};
  try {
    const raw: unknown = fields.trim() === "" ? {} : JSON.parse(fields);
    parsed = isRecord(raw) ? (raw as JsonObject) : null;
  } catch {
    parsed = null;
  }
  return (
    <Card title="Relations">
      {entity.relations.length === 0 ? <Empty>None.</Empty> : null}
      {entity.relations.map((r) => (
        <Row
          key={`${r.type}:${r.to}`}
          k={`${editor.gm.relationTypes.find((t) => t.id === r.type)?.label ?? r.type} → ${r.toName}`}
          sub={[r.fields ? JSON.stringify(r.fields) : "", r.value !== undefined ? `now ${r.value}` : ""].filter((s) => s !== "").join(" · ") || undefined}
          v={
            <span class="lre-inline">
              <button type="button" class="lre-btn small ghost" onClick={() => (setType(r.type), setTo(r.to), setFields(r.fields ? JSON.stringify(r.fields) : ""))}>
                ✎
              </button>
              <button type="button" class="lre-btn small danger" disabled={editor.busy} onClick={() => void editor.edit([{ op: "unlink", rel: r.type, from: entity.id, to: r.to }])}>
                Remove
              </button>
            </span>
          }
        />
      ))}
      <div class="lre-stack">
        <select class="lre-input" aria-label="Relation" value={type} onChange={(event) => setType(event.currentTarget.value)}>
          {editor.gm.relationTypes.map((t) => (
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
        <input class={parsed === null ? "lre-input invalid" : "lre-input"} aria-label="Fields (JSON)" placeholder='Fields, e.g. {"heat": 3}' value={fields} onInput={(event) => setFields(event.currentTarget.value)} />
        <button type="button" class="lre-btn" disabled={editor.busy || to === "" || parsed === null} onClick={() => void editor.edit([{ op: "link", rel: type, from: entity.id, to, ...(parsed && Object.keys(parsed).length > 0 ? { fields: parsed } : {}) }])}>
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
  const cents = parseMoneyInput(amount, editor.currency);
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
          <input class={cents === null && amount !== "" ? "lre-input invalid" : "lre-input"} aria-label="Amount" placeholder="Amount" value={amount} onInput={(event) => setAmount(event.currentTarget.value)} />
          <div class="lre-inline">
            <button type="button" class="lre-btn" disabled={editor.busy || !cents} onClick={() => cents && void editor.edit([{ op: "adjust", account: entity.id, cents }])}>
              Add
            </button>
            <button type="button" class="lre-btn" disabled={editor.busy || !cents} onClick={() => cents && void editor.edit([{ op: "adjust", account: entity.id, cents: -cents }])}>
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
                <span class="sub"> · {editor.gm.kinds.find((k) => k.id === e.kind)?.label ?? e.kind}</span>
              </span>
              {e.pov ? <span class="lre-badge accent">You</span> : null}
              {e.gone ? <span class="lre-badge neg">Removed</span> : null}
              {e.spawned ? <span class="lre-badge">Spawned</span> : null}
              {e.agent ? <span class="lre-badge">Agent</span> : null}
              {e.visibility !== "public" ? <span class="lre-badge warn">{e.visibility.replace(/_/g, " ")}</span> : null}
            </button>
          ))}
        </div>
      </Card>
      <Spawn editor={editor} />
    </div>
  );
}

/** One person's money at their own Money level, with Add and Take on each account shown. */
function PersonMoney(props: { money: GmMoney; editor: Editor }) {
  const { money: m, editor } = props;
  const [amount, setAmount] = useState("");
  const cents = parseMoneyInput(amount, editor.currency);
  return (
    <Card title={`Money · ${m.name}`} aside={<span class="lre-badge">Money {m.level}</span>}>
      {m.band ? <Row k="Band" v={m.band} /> : null}
      {m.netWorthCents !== null ? <Row k="Net worth" v={formatMoney(m.netWorthCents, editor.currency)} /> : null}
      {!m.opened ? <div class="lre-small lre-muted">Not opened yet: these are the opening balances it will start from.</div> : null}
      {m.accounts.map((a) => (
        <Row
          key={a.id}
          k={a.name}
          sub={a.kind}
          v={
            <span class="lre-inline">
              {formatMoney(a.cents, editor.currency)}
              <button type="button" class="lre-btn small" disabled={editor.busy || !cents} onClick={() => cents && void editor.edit([{ op: "adjust", account: a.id, cents }])}>
                +
              </button>
              <button type="button" class="lre-btn small" disabled={editor.busy || !cents} onClick={() => cents && void editor.edit([{ op: "adjust", account: a.id, cents: -cents }])}>
                −
              </button>
            </span>
          }
        />
      ))}
      {m.accounts.length > 0 ? <input class="lre-input" aria-label={`Amount for ${m.name}`} placeholder="Amount to add or take" value={amount} onInput={(event) => setAmount(event.currentTarget.value)} /> : null}
      {m.recent.map((r, i) => (
        <Row key={`r${i}`} k={r.memo} sub={`${r.at} · ${r.account}`} v={formatMoney(r.cents, editor.currency)} />
      ))}
      {m.notes.map((n, i) => (
        <Row key={`n${i}`} k={n.text} sub={n.at} />
      ))}
    </Card>
  );
}

function Body(props: { editor: Editor }) {
  const { editor } = props;
  const app = useApp();
  const [section, setSection] = useState<Section>("entities");
  const { gm } = editor;
  return (
    <div class="lre-stack">
      <Seg<Section>
        label="GM view"
        value={section}
        options={[
          { value: "entities", label: "Entities" },
          { value: "places", label: "Places" },
          { value: "tracks", label: "Tracks" },
          { value: "money", label: "Money" },
          { value: "edits", label: "Edits" },
        ]}
        onChange={setSection}
      />
      {section === "entities" ? <Entities editor={editor} /> : null}
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
      {section === "money" ? (gm.money.length === 0 ? <Empty>No one else's money is tracked.</Empty> : gm.money.map((m) => <PersonMoney key={m.entity} money={m} editor={editor} />)) : null}
      {section === "edits" ? (
        <Card title="Corrections in force">
          {gm.refused.map((r) => (
            <Row key={r.id} k="Didn't apply after a reply" v={r.reason} tone="warn" />
          ))}
          {gm.edits.length === 0 ? <Empty>No corrections on this path.</Empty> : gm.edits.map((e) => <Row key={`${e.messageId}:${e.seq}`} k={e.lines.join(" · ") || "(bookkeeping)"} />)}
        </Card>
      ) : null}
      <button type="button" class="lre-btn ghost" onClick={() => app.ui.update((ui) => ({ ...ui, section: "build" }))}>
        Kinds, classifications, tags and places are the world's: edit them in Build
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
              const result = await app.request({ type: "lre.edit", chatId: props.chatId, ops });
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
      {editor ? <Body editor={editor} /> : <Empty>Loading the GM view…</Empty>}
    </div>
  );
}
