// GM → World → one entity (DESIGN §7, §8): its fields as its kind types them (references picked by
// name, bounds, locks, worked-out values read-only), its designed sheet, where it is and what holds
// it, its relations, how deeply it is simulated, its life state and who knows it, its classes (hidden
// facets too) and tags, and Remove or Restore. Each Save is one edit with its own Undo. Classes and
// tags are set for this chat; kinds and places are the world's definitions, edited in Build.

import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../../shared/money";
import type { CharacterRelation } from "../../shared/character";
import type { GmEntity, GmField, GmRelation, GmView, SheetRowView } from "../../shared/state-view";
import { formatMoney, type WorldCurrency } from "../../shared/world";
import { ClassesInput } from "../build/facet-editor";
import { TagListInput } from "../build/selector-editor";
import { Badge, Banner, Button, Field, HostSwitch, IconButton, IdText, Meter, Section } from "../components";
import { parseFixValue } from "../fix-editor";
import { formatMinutes, humanize } from "../format";
import { Icon } from "../icons";
import { MoneyInput } from "../money-input";
import { adjustOp, bringOp, classifyOp, entityStateOp, lifeEditOp, partyOf, placesMatching, relationFields } from "../requests";
import { PARTY_RELATION } from "../../shared/party";
import { LEVEL_LABEL } from "../settings/realism";
import type { Editor } from "./editor";
import { nameOf } from "./editor";
import { ActionRow, ActionRows, GmPage } from "./ui";
import { relationRows } from "./character-ops";
import { BedPicker } from "./bed-picker";

const LEVELS = [0, 1, 2, 3, 4] as const;

/** What an entity is at a glance: the player's own, removed, not alive, not public, claimed by the player, living its own day, new in this chat. */
export function EntityBadges(props: { entity: GmEntity; full?: boolean }) {
  const { entity, full } = props;
  const badges = [
    entity.pov ? <Badge key="pov" tone="accent">You</Badge> : null,
    entity.gone ? <Badge key="gone" tone="neg">Removed</Badge> : null,
    entity.life.state !== "alive" ? <Badge key="life" tone="neg">{entity.life.label}</Badge> : null,
    // A discoverable thing says whether the player character has found it yet.
    entity.visibility !== "public" ? <Badge key="vis" tone="gm">{entity.visibility === "discoverable" ? (entity.found ? "Discoverable · found" : "Discoverable · not found") : humanize(entity.visibility)}</Badge> : null,
    entity.claimed ? <Badge key="claimed">Claimed</Badge> : null,
    full && entity.agent ? <Badge key="agent">Own day</Badge> : null,
    full && entity.spawned ? <Badge key="spawned">Spawned here</Badge> : null,
  ].filter((badge) => badge !== null);
  return badges.length === 0 ? null : <span class={full ? "lre-gm-badges start" : "lre-gm-badges"}>{badges}</span>;
}

function shown(field: GmField, editor: Editor): string {
  const value = field.value;
  if (value === null) return "—";
  if (field.type === "money" && typeof value === "number") return formatMoney(value, editor.currency);
  if (field.type === "duration" && typeof value === "number") return formatMinutes(value);
  if (field.type === "ref" && typeof value === "string") return nameOf(editor.gm, value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The text a field's editor starts from: money in the currency's own amounts, JSON for structured values. */
function textOf(field: GmField, currency: WorldCurrency): string {
  const value = field.value;
  if (field.type === "money" && typeof value === "number") return formatMoneyInput(value, currency);
  if (field.type === "bool") return String(value === true);
  if (value === null) return "";
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

/** A field's bounds in words ("0–100", "$0.00–…"), money in the world's currency; null when it has none. */
function boundsOf(field: GmField, currency: WorldCurrency): string | null {
  if (field.min === undefined && field.max === undefined) return null;
  const end = (n: number | undefined): string => (n === undefined ? "…" : field.type === "money" ? formatMoney(n, currency) : String(n));
  return `${end(field.min)}–${end(field.max)}`;
}

/** One field of an entity with ✎: typed by its definition, saved as one GM edit. Pack GM tabs use it for the fields they show. */
export function FieldRow(props: { entity: GmEntity; field: GmField; editor: Editor }) {
  const { entity, field, editor } = props;
  const [text, setText] = useState<string | null>(null);
  const control = useId();
  const bounds = boundsOf(field, editor.currency);
  // Free text and values the kind doesn't declare run long: they read under the label, full width.
  const long = field.type === "text" || field.type === "list" || field.extra === true;
  const label = (
    <span class="lre-gm-label">
      {field.label}
      {field.locked ? <Icon name="lock" size={16} label="Locked: never offered to a model" /> : null}
    </span>
  );
  if (text === null) {
    const note = [field.derived ? "Worked out from other values" : field.extra ? "Not in the kind" : null, bounds].filter((part) => part !== null).join(" · ");
    const edit = field.derived ? undefined : <IconButton icon="edit" label={`Edit ${field.label}`} onClick={() => setText(textOf(field, editor.currency))} />;
    return (
      <ActionRow title={label} subtitle={note === "" ? undefined : note} id={field.id} value={long ? undefined : shown(field, editor)} actions={edit}>
        {long ? <div class="lre-gm-row-long">{shown(field, editor)}</div> : null}
      </ActionRow>
    );
  }
  const refs = field.type === "ref" ? { places: editor.gm.places, entities: editor.gm.entities.filter((e) => !field.ref || e.kind === field.ref) } : null;
  const options = field.type === "enum" ? (field.values ?? []).map((v) => ({ value: v, label: v })) : field.type === "bool" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : [];
  const value = field.type === "ref" ? (text === "" ? null : text) : field.type === "enum" ? text : parse(entity, field, text, editor.currency);
  const invalid = value === null && field.type !== "ref";
  // Long text edits in a text area: prose for text, monospaced JSON for lists and undeclared values.
  const area = field.type === "text" || field.type === "list" || (field.extra === true && field.type !== "number" && field.type !== "duration");
  const json = field.type === "list" || (field.extra === true && field.type !== "text");
  return (
    <div class="lre-gm-row lre-gm-edit" role="listitem">
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          void editor.edit([{ op: "set", entity: entity.id, field: field.id, value }]).then((ok) => ok && setText(null));
        }}
      >
        <Field label={label} help={bounds ? `From ${bounds}` : undefined} error={invalid && text.trim() !== "" ? "That isn't a value this field takes." : null} for={field.type === "money" ? undefined : control}>
          {refs ? (
            <select id={control} class="lre-input" value={text} autoFocus onChange={(event) => setText(event.currentTarget.value)}>
              <option value="">None</option>
              {refs.places.length > 0 ? (
                <optgroup label="Places">
                  {refs.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="People and things">
                {refs.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </select>
          ) : options.length > 0 ? (
            <select id={control} class="lre-input" value={text} autoFocus onChange={(event) => setText(event.currentTarget.value)}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : field.type === "money" ? (
            <MoneyInput currency={editor.currency} label={field.label} value={text} invalid={invalid} autoFocus onInput={setText} />
          ) : area ? (
            <textarea id={control} class={["lre-input", json ? null : "lre-gm-prose", invalid ? "invalid" : null].filter((c) => c !== null).join(" ")} rows={3} value={text} autoFocus onInput={(event) => setText(event.currentTarget.value)} />
          ) : (
            <input id={control} class={invalid ? "lre-input invalid" : "lre-input"} inputMode={field.type === "number" || field.type === "duration" ? "decimal" : undefined} value={text} autoFocus onInput={(event) => setText(event.currentTarget.value)} />
          )}
        </Field>
        <div class="lre-inline">
          <Button type="submit" variant="primary" disabled={editor.busy || invalid}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setText(null)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Adds to a number, an amount or a duration; the engine stops it at the field's bounds. */
function AddToValue(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const numbers = entity.fields.filter((f) => !f.derived && (f.type === "number" || f.type === "money" || f.type === "duration"));
  const [fieldId, setFieldId] = useState(numbers[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const field = numbers.find((f) => f.id === fieldId) ?? numbers[0];
  if (!field) return null;
  // Money is typed in the world's currency; the field keeps minor units.
  const amount = field.type === "money" ? parseMoneyInput(delta, editor.currency) : delta.trim() === "" || !Number.isFinite(Number(delta)) ? null : Number(delta);
  return (
    <div class="lre-gm-subform" role="group" aria-label="Add to a value">
      <div class="lre-gm-subtitle">Add to a value</div>
      <div class="lre-gm-addto">
        <select class="lre-input" aria-label="Value to add to" value={field.id} onChange={(event) => (setFieldId(event.currentTarget.value), setDelta(""))}>
          {numbers.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {field.type === "money" ? (
          <MoneyInput currency={editor.currency} label={`Amount to add to ${field.label}`} placeholder="+/−" value={delta} invalid={delta.trim() !== "" && amount === null} onInput={setDelta} />
        ) : (
          <input class={delta.trim() !== "" && amount === null ? "lre-input invalid" : "lre-input"} inputMode="decimal" aria-label={`Amount to add to ${field.label}`} placeholder="+/−" value={delta} onInput={(event) => setDelta(event.currentTarget.value)} />
        )}
        <Button disabled={editor.busy || amount === null || amount === 0} onClick={() => amount !== null && void editor.edit([{ op: "add", entity: entity.id, field: field.id, delta: amount }]).then((ok) => ok && setDelta(""))}>
          Add
        </Button>
      </div>
      <span class="lre-field-help">A minus takes away{field.type === "duration" ? "; in minutes" : ""}. It stops at the value's bounds.</span>
    </div>
  );
}

/** A row of the designed sheet: pools and progress as meters, the rest as label and value. */
function SheetRow(props: { row: SheetRowView }) {
  const { row } = props;
  const meter =
    row.pool && row.pool.max !== null ? <Meter label={row.label} value={row.pool.current} min={row.pool.min} max={row.pool.max} showValue /> : row.progress && row.progress.next !== null ? <Meter label={`${row.label} ${row.value}`} value={row.progress.xp} min={row.progress.from} max={row.progress.next} showValue /> : null;
  if (!meter) return <ActionRow title={row.label} subtitle={row.detail} value={row.value} />;
  return (
    <div class="lre-gm-row lre-gm-meterrow" role="listitem">
      {meter}
      {row.detail ? <span class="lre-gm-row-sub">{row.detail}</span> : null}
    </div>
  );
}

/**
 * Where it is: a place, inside something, or taken out; and an account's money in or out. The current
 * place comes first with a one-tap Bring to the player character's place and a searchable place
 * picker (each a move through the one move path, with its own Undo), and whether a person travels
 * with the player character. `children` take their place beside the location picker (a bed).
 */
function Placement(props: { entity: GmEntity; editor: Editor; children?: ComponentChildren }) {
  const { entity, editor } = props;
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");
  const move = useId();
  const put = useId();
  const add = adjustOp(entity.id, amount, editor.currency, false);
  const take = adjustOp(entity.id, amount, editor.currency, true);
  const bring = bringOp(entity, editor.gm);
  const party = entity.person && editor.gm.relationTypes.some((t) => t.id === PARTY_RELATION) ? partyOf(entity, editor.gm) : null;
  const found = placesMatching(editor.gm.places, search);
  return (
    <Section title="Where it is">
      <ActionRows>
        <ActionRow
          title="At"
          value={nameOf(editor.gm, entity.place)}
          actions={
            bring ? (
              <Button size="sm" disabled={editor.busy} onClick={() => void editor.edit([bring])}>
                Bring to {nameOf(editor.gm, editor.gm.entities.find((e) => e.pov)?.id ?? null)}'s place
              </Button>
            ) : undefined
          }
        />
        {party ? (
          <ActionRow
            title={`Travels with ${party.pov.name}`}
            value={party.travels ? "Yes" : "No"}
            actions={
              <Button size="sm" disabled={editor.busy} onClick={() => void editor.edit([party.op])}>
                {party.travels ? "Leave the party" : "Join the party"}
              </Button>
            }
          />
        ) : null}
        {entity.holder ? (
          <ActionRow
            title="Inside"
            value={nameOf(editor.gm, entity.holder)}
            actions={
              <Button size="sm" disabled={editor.busy} onClick={() => void editor.edit([{ op: "put", entity: entity.id, into: null }])}>
                Take out
              </Button>
            }
          />
        ) : null}
        {entity.balance !== undefined ? <ActionRow title="Balance" value={formatMoney(entity.balance, editor.currency)} tone={entity.balance < 0 ? "neg" : undefined} /> : null}
      </ActionRows>
      <Field label="Move to a place" for={move} help="Type to narrow the places, then pick one.">
        <input class="lre-input" type="search" placeholder="Search places" aria-label="Search places" value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
        <select id={move} class="lre-input" value="" disabled={editor.busy} onChange={(event) => event.currentTarget.value !== "" && void editor.edit([{ op: "move", entity: entity.id, to: event.currentTarget.value }])}>
          <option value="">{found.length === 0 ? "No place matches" : "Choose a place…"}</option>
          {found.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {props.children}
      <Field label="Put inside" for={put}>
        <select id={put} class="lre-input" value="" disabled={editor.busy} onChange={(event) => event.currentTarget.value !== "" && void editor.edit([{ op: "put", entity: entity.id, into: event.currentTarget.value }])}>
          <option value="">Choose what holds it…</option>
          {editor.gm.entities
            .filter((e) => e.id !== entity.id)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </Field>
      {entity.balance !== undefined ? (
        <Field label="Correct the balance" help="Money in or out against a correction; its Undo takes it back.">
          <MoneyInput currency={editor.currency} label="Amount" placeholder="Amount" value={amount} invalid={add === null && amount !== ""} onInput={setAmount} />
          <div class="lre-inline">
            <Button icon="plus" disabled={editor.busy || add === null} onClick={() => add && void editor.edit([add])}>
              Add
            </Button>
            <Button icon="minus" disabled={editor.busy || take === null} onClick={() => take && void editor.edit([take])}>
              Take
            </Button>
          </div>
        </Field>
      ) : null}
    </Section>
  );
}

/** Relations, each with its edit and remove; `words` (a character's sheet) shows each in the world's words, its numbers on the edit form. */
export function Relations(props: { entity: GmEntity; editor: Editor; words?: readonly CharacterRelation[] }) {
  const { entity, editor } = props;
  // Containment is Placement's (move, put), not a relation to add here.
  const types = editor.gm.relationTypes.filter((t) => t.id !== "in");
  const [type, setType] = useState(types[0]?.id ?? "knows");
  const [to, setTo] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const form = useRef<HTMLDivElement>(null);
  const typeId = useId();
  const toId = useId();
  const defs = types.find((t) => t.id === type)?.fields ?? [];
  const picked = entity.relations.find((r) => r.type === type && r.to === to);
  const fields = relationFields(defs, inputs, picked?.fields);
  const label = (id: string): string => editor.gm.relationTypes.find((t) => t.id === id)?.label ?? id;
  const rows = relationRows(entity, editor.gm, props.words);
  const wordsOf = (r: GmRelation): string | undefined => props.words?.find((w) => w.type === r.type && w.to.id === r.to)?.words;
  return (
    <Section title="Relations">
      {rows.length === 0 ? (
        <p class="lre-gm-none">None yet.</p>
      ) : (
        <ActionRows label="Relations">
          {rows.map(({ relation: r, detail }) => (
            <ActionRow
              key={`${r.type}:${r.to}`}
              title={`${label(r.type)} → ${r.toName}`}
              subtitle={detail}
              id={r.to}
              actions={
                <>
                  {r.type === "in" ? null : (
                    <IconButton
                      icon="edit"
                      label={`Change ${label(r.type)} ${r.toName}`}
                      onClick={() => {
                        setType(r.type);
                        setTo(r.to);
                        setInputs(Object.fromEntries(Object.entries(r.fields ?? {}).map(([id, v]) => [id, typeof v === "string" ? v : JSON.stringify(v)])));
                        // The form below takes the relation; bring it into view for the change.
                        form.current?.querySelector<HTMLElement>("select")?.focus();
                      }}
                    />
                  )}
                  <IconButton icon="trash" label={`Remove ${label(r.type)} ${r.toName}`} disabled={editor.busy} onClick={() => void editor.edit([{ op: "unlink", rel: r.type, from: entity.id, to: r.to }])} />
                </>
              }
            />
          ))}
        </ActionRows>
      )}
      <div ref={form} class="lre-gm-subform" data-lre-gm-relation-form>
        <div class="lre-gm-subtitle">Add or change a relation</div>
        <Field label="Relation" for={typeId}>
          <select id={typeId} class="lre-input" value={type} onChange={(event) => (setType(event.currentTarget.value), setInputs({}))}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To" for={toId}>
          <select id={toId} class="lre-input" value={to} onChange={(event) => setTo(event.currentTarget.value)}>
            <option value="">Choose who or what…</option>
            {editor.gm.entities
              .filter((e) => e.id !== entity.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </Field>
        {picked?.value !== undefined ? (
          <span class="lre-small lre-muted" data-lre-relation-now>
            Now {picked.value}
            {wordsOf(picked) ? `, ${wordsOf(picked)}` : ""}
          </span>
        ) : null}
        {defs.map((d) => (
          <Field key={d.id} label={`${d.label}${d.min !== undefined || d.max !== undefined ? ` (${d.min ?? "…"}–${d.max ?? "…"})` : ""}`}>
            {d.type === "enum" || d.type === "bool" ? (
              <select class="lre-input" aria-label={d.label} value={inputs[d.id] ?? ""} onChange={(event) => setInputs({ ...inputs, [d.id]: event.currentTarget.value })}>
                <option value="">None</option>
                {(d.type === "bool" ? ["true", "false"] : (d.values ?? [])).map((v) => (
                  <option key={v} value={v}>
                    {d.type === "bool" ? (v === "true" ? "Yes" : "No") : v}
                  </option>
                ))}
              </select>
            ) : (
              <input class={inputs[d.id] && relationFields([d], inputs) === null ? "lre-input invalid" : "lre-input"} aria-label={d.label} inputMode={d.type === "number" ? "decimal" : undefined} value={inputs[d.id] ?? ""} onInput={(event) => setInputs({ ...inputs, [d.id]: event.currentTarget.value })} />
            )}
          </Field>
        ))}
        <Button disabled={editor.busy || to === "" || fields === null} onClick={() => fields && void editor.edit([{ op: "link", rel: type, from: entity.id, to, ...(Object.keys(fields).length > 0 ? { fields } : {}) }])}>
          Add or update
        </Button>
      </div>
    </Section>
  );
}

/** Tier, agent flag and per-domain level overrides, saved together. */
export function Simulation(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [tier, setTier] = useState(entity.tier);
  const [agent, setAgent] = useState(entity.agent);
  const [levels, setLevels] = useState<Record<string, number | null>>(Object.fromEntries(entity.levels.map((l) => [l.domain, l.override])));
  const tierId = useId();
  const op = entityStateOp(entity, tier, agent, levels);
  return (
    <Section title="Simulation">
      <Field label="Tier" for={tierId}>
        <select id={tierId} class="lre-input" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
          {editor.gm.tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {entity.pov ? null : <HostSwitch label="Lives their own day: agendas and plans" checked={agent} onChange={setAgent} />}
      <div class="lre-gm-levels" role="group" aria-label="Detail per domain">
        {entity.levels.map((l) => {
          const name = editor.gm.domains.find((d) => d.id === l.domain)?.label ?? l.domain;
          const override = levels[l.domain];
          return (
            <label key={l.domain} class="lre-gm-level">
              <span class="lre-gm-level-name">
                {name}
                <span class="lre-gm-level-now">now {l.level}</span>
              </span>
              <select class="lre-input" value={override === null || override === undefined ? "" : String(override)} onChange={(event) => setLevels({ ...levels, [l.domain]: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) })}>
                <option value="">From the tier</option>
                {LEVELS.map((n) => (
                  <option key={n} value={String(n)}>
                    {n} · {LEVEL_LABEL[n]}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <Button variant="primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </Button>
    </Section>
  );
}

/** The life state, who knows it as it is, and who is told it with this save (DESIGN §8); everyone with them learns a change anyway. */
export function Life(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [to, setTo] = useState(entity.life.state);
  const [tell, setTell] = useState<string[]>([]);
  const stateId = useId();
  const op = lifeEditOp(entity, to, tell);
  const name = (id: string): string => {
    const known = editor.gm.entities.find((e) => e.id === id);
    return known?.pov ? "You" : (known?.name ?? id);
  };
  const others = editor.gm.entities.filter((e) => e.id !== entity.id && !e.gone && !tell.includes(e.id));
  const { everyone, aware, unaware } = entity.life;
  const known = everyone ? (unaware.length > 0 ? `Everyone but ${unaware.map((p) => name(p.id)).join(", ")}` : "Everyone") : aware.length > 0 ? aware.map((p) => name(p.id)).join(", ") : "No one";
  return (
    <Section title="Life">
      <ActionRows>
        <ActionRow title="Known as it is to" subtitle={known} />
      </ActionRows>
      <Field label="Life state" for={stateId}>
        <select id={stateId} class="lre-input" value={to} onChange={(event) => setTo(event.currentTarget.value)}>
          {editor.gm.lifeStates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.acts ? "" : " (doesn't act)"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Also tell" help="Everyone with them learns a change anyway.">
        {tell.length > 0 ? (
          <div class="lre-inline">
            {tell.map((id) => (
              <Button key={id} size="sm" iconAfter="close" label={`Don't tell ${name(id)}`} onClick={() => setTell(tell.filter((t) => t !== id))}>
                {name(id)}
              </Button>
            ))}
          </div>
        ) : null}
        <select class="lre-input" value="" aria-label="Tell someone" onChange={(event) => (event.currentTarget.value ? setTell([...tell, event.currentTarget.value]) : undefined)}>
          <option value="">Tell someone…</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.pov ? "You" : e.name}
            </option>
          ))}
        </select>
      </Field>
      <Button variant="primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </Button>
    </Section>
  );
}

/** Classes, every facet's (the GM sees the hidden ones too), and tags, saved together for this chat. */
export function Classification(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const [classes, setClasses] = useState(entity.class);
  const [tags, setTags] = useState(entity.tags);
  const op = classifyOp(entity, classes, tags);
  const suggestions = [...new Set(editor.gm.entities.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b));
  return (
    <Section title="Classes and tags">
      <ClassesInput label="Classes" value={classes} doc={editor.gm} onChange={(next) => setClasses(next ?? {})} />
      <TagListInput label="Tags" value={tags} suggestions={suggestions} onChange={setTags} />
      <span class="lre-field-help">Set for this chat; the world's own stay as Build has them.</span>
      <Button variant="primary" disabled={editor.busy || op === null} onClick={() => op && void editor.edit([op])}>
        Save
      </Button>
    </Section>
  );
}

/** One entity as a page over World's list. */
export function EntityPage(props: { entity: GmEntity; editor: Editor; onBack(): void }) {
  const { entity, editor } = props;
  const kind = editor.gm.kinds.find((k) => k.id === entity.kind)?.label ?? entity.kind;
  const tier = editor.gm.tiers.find((t) => t.id === entity.tier)?.label ?? entity.tier;
  return (
    <GmPage
      name="entity"
      title={entity.name}
      subtitle={
        <>
          {kind} · {tier}
          <IdText id={entity.id} />
        </>
      }
      backLabel="World"
      onBack={props.onBack}
    >
      <div class="lre-gm-entity" data-lre-gm-entity={entity.id}>
        <EntityBadges entity={entity} full />
        {entity.gone && !entity.pov ? (
          <Banner
            tone="neg"
            title="Removed from the world"
            actions={
              <Button variant="primary" icon="undo" disabled={editor.busy} onClick={() => void editor.edit([{ op: "restore", entity: entity.id }])}>
                Restore
              </Button>
            }
          >
            Out of the world until restored; its relations were unlinked.
          </Banner>
        ) : null}
        <Section title="Fields">
          {entity.fields.length === 0 ? (
            <p class="lre-gm-none">None.</p>
          ) : (
            <ActionRows label="Fields">
              {entity.fields.map((f) => (
                <FieldRow key={f.id} entity={entity} field={f} editor={editor} />
              ))}
            </ActionRows>
          )}
          <AddToValue entity={entity} editor={editor} />
        </Section>
        {entity.sheet?.map((section) => (
          <Section key={section.title} title={section.title}>
            <ActionRows label={section.title}>
              {section.rows.map((row) => (
                <SheetRow key={row.label} row={row} />
              ))}
            </ActionRows>
          </Section>
        ))}
        <Placement entity={entity} editor={editor}>
          <BedPicker entity={entity} editor={editor} />
        </Placement>
        <Relations entity={entity} editor={editor} />
        <Simulation key={`${entity.tier}:${entity.agent}:${JSON.stringify(entity.levels)}`} entity={entity} editor={editor} />
        <Life key={JSON.stringify(entity.life)} entity={entity} editor={editor} />
        <Classification key={JSON.stringify([entity.class, entity.tags])} entity={entity} editor={editor} />
        {entity.pov || entity.gone ? null : (
          <Section title="Remove">
            <span class="lre-field-help">Takes {entity.name} out of the world and unlinks their relations. The edit's Undo, or Restore here, brings them back.</span>
            <Button variant="danger" icon="trash" disabled={editor.busy} onClick={() => void editor.edit([{ op: "despawn", entity: entity.id }])}>
              Remove from the world
            </Button>
          </Section>
        )}
      </div>
    </GmPage>
  );
}
