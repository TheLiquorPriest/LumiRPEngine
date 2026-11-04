// Build → Packs → gear: the gear pack's own config fields, in the Build forms' idiom, above its
// config as JSON. Everyday carry (ITEMS-SPEC §4.4, §11): who carries which catalog types from the
// start, each rule a row that opens as a sheet (who, by selector, and the types, picked from the
// world's gear items, containers and price catalog). With no rules of the world's own the shipped
// default applies (people carry a wallet, keys and a phone); an empty list carries nothing. Sizes by
// name (§4.1): what a thing's head noun makes it when its type and volume say nothing, each name a
// row that opens as a sheet (its size, its other names, what it holds and whether clothing rests in
// it), the shipped ones marked, each change with its reset. Also the Gear section's Not with you
// lines (§5.5), which Build → Sections → Gear sets too; the put-away process (§4.3: on, after how
// many hours, from which Gear level); and whether impossible holds are tidied every turn (§9). A
// setting left at its default keeps no entry of its own.

import { useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { DEFAULT_THINGS_CONFIG, isSize, SIZE_LABELS, SIZES, thingsConfigOf, type NameSize, type Size, type ThingsConfig } from "../../../shared/things";
import type { Selector, WorldDoc } from "../../../shared/world";
import { Button, IconButton } from "../../../frontend/components";
import { AddPicker, CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, type RefOption } from "../../../frontend/build/form-kit";
import { ChoiceInput, lintAt, LintBadge, NumberInput, TextInput } from "../../../frontend/build/schema-form";
import { NOT_WITH_YOU_PATH, NotWithYouField } from "../../../frontend/build/section-template";
import { SelectorEditor, selectorOf } from "../../../frontend/build/selector-editor";
import type { PackConfigProps } from "../../../frontend/registry";

const CONFIG = "packs.gear.config";

/** The tables a carry type is picked from, each with the name its choices say they come from. */
const TYPE_TABLES: readonly { id: string; label: string }[] = [
  { id: "gear.items", label: "gear item" },
  { id: "gear.containers", label: "container" },
  { id: "economy.catalog", label: "price catalog" },
];

/** Every type a carry rule can name: each row of the world's catalogs by name, the gear tables first, an id once. */
export function carryTypeChoices(world: Pick<WorldDoc, "tables">): RefOption[] {
  const out: RefOption[] = [];
  const seen = new Set<string>();
  for (const table of TYPE_TABLES) {
    for (const [id, row] of Object.entries(world.tables[table.id]?.rows ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ value: id, label: typeof row.name === "string" && row.name !== "" ? row.name : id, sublabel: table.label });
    }
  }
  return out;
}

/** A carry rule as Build edits it: who (a selector) and its types. */
interface Rule {
  who: Selector | undefined;
  types: string[];
}

function rulesOf(config: Readonly<JsonObject>): Rule[] | null {
  if (!Array.isArray(config.carry)) return null;
  return config.carry.map((r) => ({ who: isRecord(r) ? selectorOf(r.who) : undefined, types: isRecord(r) && Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === "string") : [] }));
}

/** The config with these carry rules, or (null) with none of the world's own, so the default applies. */
export function withCarry(config: Readonly<JsonObject>, rules: readonly Rule[] | null): JsonObject {
  const { carry: _old, ...rest } = config;
  if (rules === null) return { ...rest };
  return { ...rest, carry: rules.map((r) => ({ ...(r.who !== undefined ? { who: r.who as unknown as JsonValue } : {}), types: [...r.types] })) };
}

/** Who a rule picks, in a line: its kinds, tiers, tags, groups and ids, or anyone. */
function whoText(world: WorldDoc, who: Selector | undefined): string {
  if (who === undefined) return "No one yet: pick who";
  const named = (ids: readonly string[] | undefined, nameOf: (id: string) => string | undefined): string[] => (ids ?? []).map((id) => nameOf(id) ?? id);
  const parts = [
    ...named(who.kind, (k) => world.kinds[k]?.label),
    ...named(who.tier, (t) => world.tiers[t]?.label),
    ...(who.tag ?? []).map((t) => `#${t}`),
    ...named(who.memberOf, (g) => (world.entities[g] ? `members of ${world.entities[g]?.name}` : undefined)),
    ...named(who.ids, (id) => world.entities[id]?.name),
    ...(who.class && Object.keys(who.class).length > 0 ? ["by classification"] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "Anyone";
}

const CARRY_NOTE = "What people have on them from the start. The first time someone a rule picks is seen, at Gear 1 and above, they're made a thing of each of its types they don't have yet, theirs and on them; a type they own or carry already, by its catalog row or its name, is skipped.";

/** Everyday carry: the world's own rules as rows, or the shipped default until it has some. */
function EverydayCarry(props: PackConfigProps) {
  const [open, setOpen] = useState<number | null>(null);
  const rules = rulesOf(props.config);
  const choices = carryTypeChoices(props.world);
  const nameOf = (type: string): string => choices.find((c) => c.value === type)?.label ?? `${type} (in no catalog)`;
  const shown = rules ?? DEFAULT_THINGS_CONFIG.carry.map((r) => ({ who: r.who, types: [...r.types] }));
  const put = (next: readonly Rule[]) => props.onChange(withCarry(props.config, next));
  const rule = open !== null ? rules?.[open] : undefined;
  const path = `${CONFIG}.carry`;
  return (
    <FormGroup title="Everyday carry">
      <span class="lre-field-help">{CARRY_NOTE}</span>
      <div class="lre-form-items" data-lre-gear-carry>
        {shown.length === 0 ? <span class="lre-form-items-none">Nobody carries anything by default.</span> : null}
        {shown.map((r, i) => (
          <ItemRow
            key={i}
            title={r.types.length > 0 ? r.types.map(nameOf).join(", ") : "No types yet"}
            subtitle={rules === null ? `${whoText(props.world, r.who)} · the default` : whoText(props.world, r.who)}
            badge={<LintBadge issues={lintAt(props.lint, `${path}.${i}`)} />}
            onOpen={rules === null ? undefined : () => setOpen(i)}
            openLabel={`Edit the carry rule for ${whoText(props.world, r.who)}`}
            actions={rules === null ? undefined : <IconButton icon="trash" label={`Remove the carry rule for ${whoText(props.world, r.who)}`} onClick={() => put(rules.filter((_, j) => j !== i))} />}
          />
        ))}
      </div>
      <Issues issues={props.lint.filter((issue) => issue.path === path)} />
      <div class="lre-inline">
        {rules === null ? (
          <Button size="sm" icon="edit" onClick={() => put(shown)}>
            Change the default
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              icon="plus"
              onClick={() => {
                put([...rules, { who: { kind: ["person"] }, types: [] }]);
                setOpen(rules.length);
              }}
            >
              Add a rule
            </Button>
            <Button size="sm" variant="ghost" icon="undo" onClick={() => props.onChange(withCarry(props.config, null))}>
              Use the default
            </Button>
          </>
        )}
      </div>
      {open !== null && rules !== null && rule !== undefined ? (
        <FormSheet title="Carry rule" subtitle={whoText(props.world, rule.who)} backLabel="Gear" onClose={() => setOpen(null)}>
          <SelectorEditor label="Who carries them" value={rule.who} doc={props.world} onChange={(who) => put(rules.map((r, j) => (j === open ? { ...r, who } : r)))} />
          <div class="lre-field">
            <span class="label">What they carry</span>
            <div class="lre-form-chips">
              {rule.types.map((type) => (
                <Chip key={type} removeLabel={`Remove ${nameOf(type)}`} onRemove={() => put(rules.map((r, j) => (j === open ? { ...r, types: r.types.filter((t) => t !== type) } : r)))}>
                  {nameOf(type)}
                </Chip>
              ))}
            </div>
            <AddPicker label="Add a type" placeholder="Add a type…" options={choices.filter((c) => !rule.types.includes(c.value))} onAdd={(type) => put(rules.map((r, j) => (j === open ? { ...r, types: [...r.types, type] } : r)))} />
            <Issues issues={lintAt(props.lint, `${path}.${open}`)} />
          </div>
          <div class="lre-form-sheet-actions">
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                setOpen(null);
                put(rules.filter((_, j) => j !== open));
              }}
            >
              Remove rule
            </Button>
            <Button variant="primary" onClick={() => setOpen(null)}>
              Done
            </Button>
          </div>
        </FormSheet>
      ) : null}
    </FormGroup>
  );
}

/** The config with one group of settings (the put-away process's, Tidy up's) as given, or without it when that is the shipped default. */
export function withPart(config: Readonly<JsonObject>, key: "putAway" | "tidy", value: JsonObject, shipped: Readonly<JsonObject>): JsonObject {
  const { [key]: _old, ...rest } = config;
  return Object.keys(shipped).every((k) => value[k] === shipped[k]) ? rest : { ...rest, [key]: value };
}

/** A name entry as the world's config stores it. */
function nameJson(entry: NameSize): JsonObject {
  return { size: entry.size, also: [...entry.also], ...(entry.holds !== undefined ? { holds: entry.holds } : {}), ...(entry.keeps !== undefined ? { keeps: [...entry.keeps] } : {}) };
}

/**
 * The config with the world's own sizes by name (`sizes.byName`), each a name's entry or null for a
 * shipped name taken out; the part left out when it holds none, so the shipped ones apply.
 */
export function withNames(config: Readonly<JsonObject>, names: Readonly<Record<string, JsonValue>>): JsonObject {
  const { sizes, ...rest } = config;
  const { byName: _old, ...others } = isRecord(sizes) ? sizes : {};
  const next: JsonObject = Object.keys(names).length > 0 ? { ...others, byName: { ...names } } : others;
  return Object.keys(next).length > 0 ? { ...rest, sizes: next } : rest;
}

/**
 * The config with `name` sized as `entry` (null: taken out): a shipped name changed back to how it
 * ships keeps no entry, one taken out is null, and a world's own name taken out is gone.
 */
export function withName(config: Readonly<JsonObject>, name: string, entry: NameSize | null): JsonObject {
  const sizes = isRecord(config.sizes) ? config.sizes : {};
  const own: Record<string, JsonValue> = isRecord(sizes.byName) ? { ...sizes.byName } : {};
  const shipped = hasOwn(DEFAULT_THINGS_CONFIG.sizes.byName, name) ? DEFAULT_THINGS_CONFIG.sizes.byName[name] : undefined;
  if (entry === null) {
    if (shipped) own[name] = null;
    else delete own[name];
  } else if (shipped && JSON.stringify(nameJson(shipped)) === JSON.stringify(nameJson(entry))) delete own[name];
  else own[name] = nameJson(entry);
  return withNames(config, own);
}

const SIZE_CHOICES: readonly RefOption[] = SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] }));
const NAMES_NOTE = "What a thing's name makes it when its own size, its type's and its volume say nothing, before its category. The noun the name ends in decides: a TV is Heavy, a TV remote is a remote. Its other names are heard as names of it too, where the world's rows give it none (\"the fridge\" finds a refrigerator). Storage furniture can hold things, and clothing at home rests in what keeps it.";

/** A name entry's line: its size, what it holds and keeps. */
function nameLine(entry: NameSize): string {
  return [SIZE_LABELS[entry.size], ...(entry.holds !== undefined ? [`holds up to ${SIZE_LABELS[entry.holds]}`] : []), ...(entry.keeps?.includes("clothing") ? ["keeps clothing"] : [])].join(" · ");
}

/** Sizes by name (ITEMS-SPEC §4.1): the shipped names and the world's, each row a sheet; `onChange` gets the whole config. */
function SizesByName(props: PackConfigProps & { read: Readonly<ThingsConfig["sizes"]["byName"]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const sizes = isRecord(props.config.sizes) ? props.config.sizes : {};
  const own = isRecord(sizes.byName) ? sizes.byName : {};
  const shipped = DEFAULT_THINGS_CONFIG.sizes.byName;
  const names = Object.keys(props.read).sort();
  const removed = Object.keys(shipped).filter((name) => !hasOwn(props.read, name)).sort();
  const put = (name: string, entry: NameSize | null) => props.onChange(withName(props.config, name, entry));
  const reset = (name: string) => {
    const next: Record<string, JsonValue> = { ...own };
    delete next[name];
    props.onChange(withNames(props.config, next));
  };
  const status = (name: string): string => (!hasOwn(shipped, name) ? "the world's own" : hasOwn(own, name) ? "changed" : "as shipped");
  const entry = open !== null && hasOwn(props.read, open) ? props.read[open] : undefined;
  const path = `${CONFIG}.sizes.byName`;
  const add = () => {
    const name = adding.trim().toLowerCase().replace(/\s+/g, " ");
    if (name === "") return;
    if (!hasOwn(props.read, name)) put(name, hasOwn(shipped, name) ? (shipped[name] ?? { size: "furniture", also: [] }) : { size: "furniture", also: [] });
    setAdding("");
    setOpen(name);
  };
  return (
    <FormGroup title="Sizes by name">
      <span class="lre-field-help">{NAMES_NOTE}</span>
      <div class="lre-form-items" data-lre-gear-names>
        {names.length === 0 ? <span class="lre-form-items-none">No name gives a size.</span> : null}
        {names.map((name) => {
          const e = props.read[name];
          if (!e) return null;
          return (
            <ItemRow
              key={name}
              title={e.also.length > 0 ? `${name} · ${e.also.join(", ")}` : name}
              subtitle={`${nameLine(e)} · ${status(name)}`}
              badge={<LintBadge issues={lintAt(props.lint, `${path}.${name}`)} />}
              onOpen={() => setOpen(name)}
              openLabel={`Edit what "${name}" sizes`}
              actions={
                <>
                  {hasOwn(shipped, name) && hasOwn(own, name) ? <IconButton icon="undo" label={`Put "${name}" back as shipped`} onClick={() => reset(name)} /> : null}
                  <IconButton icon="trash" label={`Take "${name}" out`} onClick={() => put(name, null)} />
                </>
              }
            />
          );
        })}
      </div>
      <Issues issues={props.lint.filter((issue) => issue.path === path)} />
      <div class="lre-inline">
        <TextInput label="Add a name" value={adding} placeholder="A noun, such as piano" issues={[]} onChange={(v) => setAdding(typeof v === "string" ? v : "")} />
        <Button size="sm" icon="plus" disabled={adding.trim() === ""} onClick={add}>
          Add
        </Button>
        {Object.keys(own).length > 0 ? (
          <Button size="sm" variant="ghost" icon="undo" onClick={() => props.onChange(withNames(props.config, {}))}>
            Use the shipped names
          </Button>
        ) : null}
      </div>
      {removed.length > 0 ? (
        <div class="lre-field">
          <span class="label">Shipped names taken out</span>
          <div class="lre-form-chips">
            {removed.map((name) => (
              <Chip key={name} label={`Bring back "${name}"`} onPress={() => reset(name)}>
                {name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {open !== null && entry !== undefined ? (
        <FormSheet title={open} subtitle={status(open)} backLabel="Gear" onClose={() => setOpen(null)}>
          <ChoiceInput label="Size" value={entry.size} options={SIZE_CHOICES} issues={lintAt(props.lint, `${path}.${open}.size`)} onChange={(v) => (isSize(v) ? put(open, { ...entry, size: v }) : undefined)} />
          <div class="lre-field">
            <span class="label">Other names for it</span>
            <div class="lre-form-chips">
              {entry.also.map((other) => (
                <Chip key={other} removeLabel={`Remove ${other}`} onRemove={() => put(open, { ...entry, also: entry.also.filter((a) => a !== other) })}>
                  {other}
                </Chip>
              ))}
            </div>
            <TextInput
              label="Add another name"
              value=""
              placeholder="Another word for it"
              commitOnBlur
              issues={[]}
              onChange={(v) => {
                const other = typeof v === "string" ? v.trim().toLowerCase() : "";
                if (other !== "" && !entry.also.includes(other)) put(open, { ...entry, also: [...entry.also, other] });
              }}
            />
          </div>
          <ChoiceInput
            label="Holds things up to"
            value={entry.holds}
            options={SIZE_CHOICES}
            optional
            hint="Left empty, it holds nothing"
            issues={lintAt(props.lint, `${path}.${open}.holds`)}
            onChange={(v) => {
              const { holds: _was, ...rest } = entry;
              put(open, isSize(v) ? { ...rest, holds: v as Size } : rest);
            }}
          />
          <CheckField
            label="Clothing at home rests in it"
            help="Put away, and the put-away process, take clothing back to one of these at its owner's home."
            checked={entry.keeps?.includes("clothing") === true}
            onChange={(on) => {
              const keeps = (entry.keeps ?? []).filter((k) => k !== "clothing");
              const { keeps: _was, ...rest } = entry;
              const next = on ? [...keeps, "clothing"] : keeps;
              put(open, next.length > 0 ? { ...rest, keeps: next } : rest);
            }}
          />
          <div class="lre-form-sheet-actions">
            {hasOwn(shipped, open) && hasOwn(own, open) ? (
              <Button variant="ghost" icon="undo" onClick={() => reset(open)}>
                Put back as shipped
              </Button>
            ) : null}
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                setOpen(null);
                put(open, null);
              }}
            >
              Take it out
            </Button>
            <Button variant="primary" onClick={() => setOpen(null)}>
              Done
            </Button>
          </div>
        </FormSheet>
      ) : null}
    </FormGroup>
  );
}

const PUT_AWAY_NOTE = "Off screen, a thing someone else or their household owns, left lying away from where it's kept, goes back there once it has lain out of your character's sight this long. Your character's own things never move, nor anything lent, lost or too big to carry.";
const TIDY_NOTE = "Every turn, before it's read: a thing too big to carry that someone has on them is put down at the buyer's home when it was bought, else where they are, and a thing worn but lying elsewhere is taken off. Each is recorded with Undo, and one the player undid stays as it is while it stays where it was; anything else waits in GM → Things → Tidy up.";

/** The put-away process (ITEMS-SPEC §4.3): on or off, after how many hours out of sight, from which Gear level; `onChange` gets the whole config. */
function PutAway(props: PackConfigProps & { read: Readonly<ThingsConfig["putAway"]> }) {
  const path = `${CONFIG}.putAway`;
  const put = (next: Partial<ThingsConfig["putAway"]>) => props.onChange(withPart(props.config, "putAway", { ...props.read, ...next }, DEFAULT_THINGS_CONFIG.putAway));
  return (
    <FormGroup title="Put away">
      <span class="lre-field-help">{PUT_AWAY_NOTE}</span>
      <CheckField label="Put things away" checked={props.read.on} issues={lintAt(props.lint, `${path}.on`)} onChange={(on) => put({ on })} />
      <NumberInput
        label="After, in hours out of sight"
        value={props.read.hours}
        min={1}
        step={1}
        hint={`Default ${DEFAULT_THINGS_CONFIG.putAway.hours}`}
        issues={lintAt(props.lint, `${path}.hours`)}
        onChange={(hours) => {
          if (typeof hours === "number" && hours > 0) put({ hours });
        }}
      />
      <NumberInput
        label="From Gear level"
        value={props.read.minLevel}
        min={1}
        max={4}
        step={1}
        hint={`Default ${DEFAULT_THINGS_CONFIG.putAway.minLevel}: it runs while Gear is at this level or above`}
        issues={lintAt(props.lint, `${path}.minLevel`)}
        onChange={(level) => {
          if (level === 1 || level === 2 || level === 3 || level === 4) put({ minLevel: level });
        }}
      />
    </FormGroup>
  );
}

export function GearConfig(props: PackConfigProps) {
  const { notWithYou: _old, ...rest } = props.config;
  // The config as edited, read as the engine reads it: a value it can't use shows as the default.
  const read = thingsConfigOf({ packs: { gear: { version: 1, config: props.config } } });
  return (
    <div class="lre-form-fields" data-lre-gear-config>
      <EverydayCarry {...props} />
      <SizesByName {...props} read={read.sizes.byName} />
      <FormGroup title="Gear section">
        <NotWithYouField value={read.notWithYou} issues={lintAt(props.lint, NOT_WITH_YOU_PATH)} onChange={(next) => props.onChange(next === DEFAULT_THINGS_CONFIG.notWithYou ? rest : { ...rest, notWithYou: next })} />
      </FormGroup>
      <PutAway {...props} read={read.putAway} />
      <FormGroup title="Tidy up">
        <CheckField label="Tidy impossible holds every turn" help={TIDY_NOTE} checked={read.tidy.auto} issues={lintAt(props.lint, `${CONFIG}.tidy.auto`)} onChange={(auto) => props.onChange(withPart(props.config, "tidy", { auto }, DEFAULT_THINGS_CONFIG.tidy))} />
      </FormGroup>
    </div>
  );
}
