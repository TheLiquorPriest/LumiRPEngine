// Build → Packs → gear: the gear pack's own config fields, in the Build forms' idiom, above its
// config as JSON. Everyday carry (ITEMS-SPEC §4.4, §11): who carries which catalog types from the
// start, each rule a row that opens as a sheet (who, by selector, and the types, picked from the
// world's gear items, containers and price catalog). With no rules of the world's own the shipped
// default applies (people carry a wallet, keys and a phone); an empty list carries nothing. Also
// the Gear section's Not with you lines (§5.5), which Build → Sections → Gear sets too; the
// put-away process (§4.3: on, after how many hours, from which Gear level); and whether an older
// chat's impossible holds are tidied once, automatically (§9). A setting left at its default keeps
// no entry of its own.

import { useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { DEFAULT_THINGS_CONFIG, thingsConfigOf, type ThingsConfig } from "../../../shared/things";
import type { Selector, WorldDoc } from "../../../shared/world";
import { Button, IconButton } from "../../../frontend/components";
import { AddPicker, CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, type RefOption } from "../../../frontend/build/form-kit";
import { lintAt, LintBadge, NumberInput } from "../../../frontend/build/schema-form";
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

const PUT_AWAY_NOTE = "Off screen, a thing someone else or their household owns, left lying away from where it's kept, goes back there once it has lain out of your character's sight this long. Your character's own things never move, nor anything lent, lost or too big to carry.";
const TIDY_NOTE = "Once, on an older chat's first turn, a thing too big to carry that someone has on them is put down: at the buyer's home when it was bought, else where they are. It's recorded with Undo; anything else waits in GM → Things → Tidy up.";

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
      <FormGroup title="Gear section">
        <NotWithYouField value={read.notWithYou} issues={lintAt(props.lint, NOT_WITH_YOU_PATH)} onChange={(next) => props.onChange(next === DEFAULT_THINGS_CONFIG.notWithYou ? rest : { ...rest, notWithYou: next })} />
      </FormGroup>
      <PutAway {...props} read={read.putAway} />
      <FormGroup title="Tidy up">
        <CheckField label="Tidy impossible holds automatically" help={TIDY_NOTE} checked={read.tidy.auto} issues={lintAt(props.lint, `${CONFIG}.tidy.auto`)} onChange={(auto) => props.onChange(withPart(props.config, "tidy", { auto }, DEFAULT_THINGS_CONFIG.tidy))} />
      </FormGroup>
    </div>
  );
}
