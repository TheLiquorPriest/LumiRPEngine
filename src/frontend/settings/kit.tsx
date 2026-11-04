// The settings kit (Settings → Agents and its pages; the pipeline's own pages build on it): one row
// per setting, each saying when it differs from its default (a Changed badge) and only then showing
// what the default is, with Default to go back; a folded row for a limit, which shows its value
// until opened; a row that opens a page, with how many of its settings are changed; an agent's own
// limit over the one it follows, and the picker that adds one; and the words a limit is said in.
// Every component is hook-free, so tests press what renders without a DOM. Styles: styles/settings.ts.

import type { ComponentChildren } from "preact";
import type { AgentBudget, AgentLimitDef, AgentLimitUnit } from "../../shared/agent-settings";
import type { Limit } from "../../shared/minds";
import { formatMs } from "../../shared/timeouts";
import { nounFor } from "../../shared/words";
import { Badge, Button, Disclosure, HostSwitch, ListRow, NumberStepper, Section } from "../components";
import type { IconName } from "../icons";

/** The −/+ step of each unit, in what the stepper shows (seconds for "ms"): a convenience, not a limit; typing takes any value. */
export const STEP: Readonly<Record<AgentLimitUnit, number>> = { tokens: 1000, ms: 5, count: 1, chars: 500 };

/** Where a limit of an agent's own starts when the one it follows is none: a number its unit commonly takes. */
const PICK_START: Readonly<Record<AgentLimitUnit, number>> = { tokens: 100_000, ms: 60_000, count: 10, chars: 4000 };

const n = (value: number): string => value.toLocaleString("en-US");

/** A limit as the pages say it: "100,000 tokens", "2 min", "4,000 characters", or "No limit". */
export function amountText(value: Limit, unit: AgentLimitUnit): string {
  if (value === "none") return "No limit";
  if (unit === "ms") return formatMs(value);
  return unit === "tokens" ? `${n(value)} ${nounFor(value, "token", "tokens")}` : unit === "chars" ? `${n(value)} ${nounFor(value, "character", "characters")}` : n(value);
}

/** A fresh cache nonce. From getRandomValues rather than randomUUID, which a page served over plain http (Lumiverse on a home network) doesn't have. */
export function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Changed", or how many are: a row's or a page's settings that differ from their defaults. */
export function ChangedBadge(props: { count?: number }) {
  return <Badge tone="accent">{props.count === undefined ? "Changed" : `${props.count} changed`}</Badge>;
}

/** A Default button for a row laid out by hand, shown while its value differs: `label` names the setting and the default it goes back to. */
export function defaultButton(label: string, busy: boolean, reset: () => void) {
  return (
    <Button size="sm" variant="ghost" icon="undo" label={label} disabled={busy} onClick={reset}>
      Default
    </Button>
  );
}

/** A setting's way back to its default: what the button says to a screen reader, the default in words, and the reset. */
export interface Reset {
  label: string;
  to: ComponentChildren;
  onClick(): void;
}

/**
 * One setting: its name, a Changed badge while it differs from its default, its control, a line of
 * help, and only while changed, its default and Default. A `bare` row's control shows its own name
 * (a switch, a select, a stepper), so the row names it only to screen readers and its Default.
 */
export function SettingRow(props: { id: string; label: string; changed: boolean; bare?: boolean; reset?: Reset; help?: ComponentChildren; busy: boolean; children?: ComponentChildren }) {
  const reset = props.changed ? props.reset : undefined;
  return (
    <div class="lre-set-row" data-lre-setting={props.id} data-lre-changed={props.changed ? "" : undefined}>
      {props.bare && !props.changed ? null : (
        <div class={props.bare ? "lre-set-row-head bare" : "lre-set-row-head"}>
          {props.bare ? null : <span class="lre-set-row-label">{props.label}</span>}
          {props.changed ? <ChangedBadge /> : null}
        </div>
      )}
      {props.children}
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      {reset ? (
        <div class="lre-set-row-default">
          <span class="lre-small lre-muted">Default: {reset.to}</span>
          <Button size="sm" variant="ghost" icon="undo" label={reset.label} disabled={props.busy} onClick={reset.onClick}>
            Default
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A setting folded to its name and value, with a Changed badge; opened, its explanation and controls. */
export function FoldRow(props: { id: string; label: string; value: ComponentChildren; changed: boolean; open?: boolean; children: ComponentChildren }) {
  return (
    <div class="lre-set-fold" data-lre-setting={props.id} data-lre-changed={props.changed ? "" : undefined}>
      <Disclosure
        defaultOpen={props.open}
        summary={
          <span class="lre-set-fold-head">
            <span class="lre-set-fold-label">{props.label}</span>
            <span class="lre-set-fold-value">{props.value}</span>
            {props.changed ? <ChangedBadge /> : null}
          </span>
        }
      >
        {props.children}
      </Disclosure>
    </div>
  );
}

/** A limit's number, and its No limit switch where it may be lifted; seconds for a time. */
function LimitControls(props: { def: AgentLimitDef; value: Limit; onValue: number; busy: boolean; set(value: Limit): void }) {
  const { def, value } = props;
  const seconds = def.unit === "ms";
  const unitLabel = seconds ? "seconds" : def.unit === "tokens" ? "tokens" : def.unit === "chars" ? "characters" : null;
  return (
    <>
      {def.none !== null ? <HostSwitch label={`${def.label}: no limit`} checked={value === "none"} disabled={props.busy} onChange={(none) => props.set(none ? "none" : props.onValue)} /> : null}
      {value === "none" ? null : (
        <NumberStepper
          label={unitLabel ? `${def.label} (${unitLabel})` : def.label}
          value={seconds ? value / 1000 : value}
          min={seconds ? def.min / 1000 : def.min}
          step={STEP[def.unit]}
          integer={!seconds}
          disabled={props.busy}
          onChange={(next) => props.set(seconds ? Math.round(next * 1000) : next)}
        />
      )}
    </>
  );
}

/** A limit's explanation: what it limits, and what happens when it's reached. */
function LimitText(props: { def: AgentLimitDef }) {
  return (
    <>
      <span class="lre-set-fold-text">{props.def.limits}</span>
      <span class="lre-small lre-muted">When it's reached: {props.def.fires}</span>
    </>
  );
}

/** One limit, folded to its value: what it limits, what happens when it's reached, No limit where it may be lifted, its number, and while changed its default and Default. */
export function LimitRow(props: { id: string; def: AgentLimitDef; value: Limit; standard: Limit; busy: boolean; open?: boolean; set(value: Limit | null): void }) {
  const { def, value, standard } = props;
  const changed = value !== standard;
  return (
    <FoldRow id={props.id} label={def.label} value={amountText(value, def.unit)} changed={changed} open={props.open}>
      <div class="lre-set-fold-body" data-lre-agent-limit={props.id}>
        <LimitText def={def} />
        <LimitControls def={def} value={value} onValue={standard === "none" ? def.min : standard} busy={props.busy} set={props.set} />
        {value === "none" && def.none ? <span class="lre-small lre-muted">No limit: {def.none}.</span> : null}
        {changed ? (
          <div class="lre-set-row-default">
            <span class="lre-small lre-muted">Default: {amountText(standard, def.unit)}</span>
            <Button size="sm" variant="ghost" icon="undo" label={`Reset ${def.label} to its default, ${amountText(standard, def.unit)}`} disabled={props.busy} onClick={() => props.set(null)}>
              Default
            </Button>
          </div>
        ) : null}
      </div>
    </FoldRow>
  );
}

/**
 * One of an agent's own limits over the one it follows (`every`: every agent's, or as `fallback`
 * names it, "the main agent's"; `owner` names whose: "The assistant's"): its number, No limit where
 * it may be lifted, and the button that drops it, so the followed limit applies again. It is changed
 * unless the agent ships with it (the Curator's tool rounds). An agent outside any turn
 * (`outsideTurn`: the GM assistant) has no turn to bound a limit lifted to none.
 */
export function OwnLimitRow(props: { id: keyof AgentBudget; owner: string; fallback?: string; def: AgentLimitDef; own: Limit; every: Limit; changed: boolean; busy: boolean; outsideTurn?: boolean; open?: boolean; set(value: Limit | null): void }) {
  const { def, own, every } = props;
  const fallback = props.fallback ?? "every agent's";
  const Fallback = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  return (
    <FoldRow id={props.id} label={def.label} value={amountText(own, def.unit)} changed={props.changed} open={props.open}>
      <div class="lre-set-fold-body" data-lre-own-limit={props.id}>
        <LimitText def={def} />
        <LimitControls def={def} value={own} onValue={every === "none" ? def.min : every} busy={props.busy} set={props.set} />
        {own === "none" && def.none ? <span class="lre-small lre-muted">{props.outsideTurn && def.turnBound ? "No limit at all: it runs outside any turn." : `No limit: ${def.none}.`}</span> : null}
        <div class="lre-set-row-default">
          <span class="lre-small lre-muted">
            {props.owner} own; {fallback} is {amountText(every, def.unit)}
          </span>
          <Button size="sm" variant="ghost" icon="undo" label={`Use ${fallback} ${def.label.toLowerCase()}, ${amountText(every, def.unit)}`} disabled={props.busy} onClick={() => props.set(null)}>
            {Fallback}
          </Button>
        </div>
      </div>
    </FoldRow>
  );
}

/** The number a limit of an agent's own starts at: the followed one's, else a common one, never below the least it takes. */
export function ownStart(def: AgentLimitDef, every: Limit): number {
  return every === "none" ? Math.max(def.min, PICK_START[def.unit]) : every;
}

/**
 * An agent's budget, its own limits only: one folded row each, changed unless it ships with it
 * (`shipped`), then a picker that adds one of the rest at the followed limit (`keys`: the limits
 * it may set), and what the rest follow.
 */
export function OwnBudget(props: { owner: string; fallback?: string; keys: readonly (keyof AgentBudget)[]; defs: Readonly<Record<keyof AgentBudget, AgentLimitDef>>; own: Readonly<Partial<AgentBudget>>; shipped?: Readonly<Partial<AgentBudget>>; every: Readonly<AgentBudget>; busy: boolean; outsideTurn?: boolean; set(key: keyof AgentBudget, value: Limit | null): void; follows: ComponentChildren }) {
  const set = props.keys.filter((key) => props.own[key] !== undefined);
  const free = props.keys.filter((key) => props.own[key] === undefined);
  const owner = props.owner.replace(/'s$/, "");
  return (
    <div class="lre-set-rows" data-lre-own-budget={owner}>
      {set.map((key) => (
        <OwnLimitRow key={key} id={key} owner={props.owner} fallback={props.fallback} def={props.defs[key]} own={props.own[key] ?? props.every[key]} every={props.every[key]} changed={props.own[key] !== props.shipped?.[key]} busy={props.busy} outsideTurn={props.outsideTurn} set={(value) => props.set(key, value)} />
      ))}
      {free.length > 0 ? (
        <label class="lre-field lre-set-picker">
          <span class="label">{set.length === 0 ? "Set a limit of its own" : "Set another limit of its own"}</span>
          <select
            class="lre-input"
            aria-label={`${owner}: set a limit of its own`}
            value=""
            disabled={props.busy}
            onChange={(event) => {
              const key = free.find((k) => k === event.currentTarget.value);
              if (key) props.set(key, ownStart(props.defs[key], props.every[key]));
            }}
          >
            <option value="">Pick a limit…</option>
            {free.map((key) => (
              <option key={key} value={key}>
                {`${props.defs[key].label} (now ${amountText(props.every[key], props.defs[key].unit).toLowerCase()})`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span class="lre-small lre-muted lre-set-follows">{props.follows}</span>
    </div>
  );
}

/** A row that opens a page: its name, a line on what it holds now, how many of its settings are changed, and a chevron. `id` is what focus returns to on Back. */
export function NavRow(props: { id: string; title: string; subtitle?: ComponentChildren; icon?: IconName; changed: number; onOpen(): void }) {
  return (
    <div class="lre-set-nav" data-lre-settings-sub={props.id}>
      <ListRow icon={props.icon} title={props.title} subtitle={props.subtitle} badge={props.changed > 0 ? <ChangedBadge count={props.changed} /> : undefined} chevron onClick={props.onOpen} />
    </div>
  );
}

/** A choice of on and off among chips: each a toggle, pressed while on. */
export function ToggleChips<T extends string>(props: { label: string; options: readonly { value: T; label: string }[]; on: readonly T[]; busy: boolean; toggle(value: T, on: boolean): void }) {
  return (
    <div class="lre-set-chips" role="group" aria-label={props.label}>
      {props.options.map((o) => {
        const on = props.on.includes(o.value);
        return (
          <button key={o.value} type="button" class="lre-set-chip" aria-pressed={on} aria-label={`${props.label}: ${o.label}`} disabled={props.busy} onClick={() => props.toggle(o.value, !on)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A group of limits under a title, with a line on what they share: one folded row each, against their defaults (`standard`). */
export function LimitGroup<K extends string>(props: { id: string; title: string; lead?: ComponentChildren; defs: Readonly<Record<K, AgentLimitDef>>; values: Readonly<Record<K, Limit>>; standard: Readonly<Record<K, Limit>>; busy: boolean; set(key: K, value: Limit | null): void }) {
  const keys = Object.keys(props.defs) as K[];
  const changed = keys.filter((key) => props.values[key] !== props.standard[key]).length;
  return (
    <Section title={props.title} aside={changed > 0 ? <ChangedBadge count={changed} /> : undefined} flush>
      <div class="lre-set-rows" data-lre-agent-group={props.id}>
        {props.lead !== undefined ? <p class="lre-set-note">{props.lead}</p> : null}
        {keys.map((key) => (
          <LimitRow key={key} id={key} def={props.defs[key]} value={props.values[key]} standard={props.standard[key]} busy={props.busy} set={(value) => props.set(key, value)} />
        ))}
      </div>
    </Section>
  );
}
