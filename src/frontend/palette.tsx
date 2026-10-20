// The action sheet (DESIGN §11, §12): actions with targets and exact odds, Buy, Pay,
// Transfer, Drive, Lend and Combat, and the Timelapse sheet (duration chips, until targets, interrupt
// overrides), plus Pause/Resume clock. Each option shows its price, its time and one odds bar with
// the chances in words; why it can't be taken now shows inline. Everything comes from
// `StateView.palette`; a choice sends one `lre.action`.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { InterruptClass, InterruptPolicy } from "../shared/ids";
import type { TimelapseTarget } from "../shared/ledger";
import { parseMoneyInput } from "../shared/money";
import type { OutcomeOdds, PaletteEncounter, PaletteEntry, PaletteOption, PaletteView, StateView, TimelapseView } from "../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney } from "../shared/world";
import type { PaletteTab } from "./app";
import { useApp, useView } from "./app";
import { Badge, Banner, Button, Disclosure, Empty, IconButton, oddsSeries, Section, Seg, Tabs, tabPanel, useBusy } from "./components";
import type { TabPanelProps } from "./components";
import { formatCents, formatMinutes, formatOdds, humanize } from "./format";
import { Icon } from "./icons";
import { MoneyInput } from "./money-input";
import { paletteRequest, timelapseRequest, timeMarker } from "./requests";

// Combat leads while it's there: in a fight its actions are what the player wants first.
const GROUP_LABEL: Record<PaletteEntry["group"], string> = { combat: "Combat", action: "Actions", buy: "Buy", pay: "Pay", transfer: "Transfer", drive: "Drive", lend: "Lend" };
const GROUP_TAB: Record<PaletteEntry["group"], PaletteTab> = { combat: "combat", action: "actions", buy: "buy", pay: "pay", transfer: "transfer", drive: "drive", lend: "lend" };

/** The tabs a palette view offers, in a fixed order; Timelapse last. */
export function paletteTabs(palette: PaletteView): { id: PaletteTab; label: string }[] {
  const tabs: { id: PaletteTab; label: string }[] = [];
  for (const group of Object.keys(GROUP_LABEL) as PaletteEntry["group"][]) {
    if (palette.entries.some((entry) => entry.group === group)) tabs.push({ id: GROUP_TAB[group], label: GROUP_LABEL[group] });
  }
  if (palette.timelapse) tabs.push({ id: "timelapse", label: "Timelapse" });
  return tabs;
}

export function PaletteSheet(props: { tab: PaletteTab; desk: boolean; onClose(): void }) {
  const view = useView();
  // Asked for the actions in a fight on the POV's turn, the palette opens on Combat.
  const [tab, setTab] = useState<PaletteTab>(props.tab === "actions" && view?.palette?.encounter?.yours ? "combat" : props.tab);
  const panelId = useId();
  const palette = view?.palette ?? null;
  const tabs = palette ? paletteTabs(palette) : [];
  const active = tabs.some((entry) => entry.id === tab) ? tab : tabs[0]?.id ?? tab;
  return (
    <div
      class={props.desk ? "lre lre-sheet desk" : "lre lre-sheet"}
      data-lre-sheet="palette"
      role="dialog"
      aria-label="Actions"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <header>
        <Icon name={active === "timelapse" ? "fast-forward" : "bolt"} />
        <h2 class="title">{active === "timelapse" ? "Timelapse" : "Actions"}</h2>
        <ClockToggle view={view} />
        <IconButton icon="close" label="Close actions" onClick={props.onClose} />
      </header>
      {!view || view.status === "not_world" ? (
        <div class="body">
          <Empty icon="globe" title="Not a world chat">
            Open a world chat to use actions.
          </Empty>
        </div>
      ) : !palette || tabs.length === 0 ? (
        <div class="body">
          <Empty icon="bolt" title="Nothing to do here">
            No actions are available here right now.
          </Empty>
        </div>
      ) : (
        <>
          <div class="lre-chat-tabs">
            <Tabs<PaletteTab> label="Action groups" panelId={panelId} value={active} tabs={tabs} onChange={(id) => setTab(id)} />
          </div>
          {active === "timelapse" && palette.timelapse ? (
            <TimelapsePanel view={view} timelapse={palette.timelapse} panel={tabPanel(panelId, active)} onSent={props.onClose} />
          ) : (
            <ActionList
              key={active}
              view={view}
              head={active === "combat" && palette.encounter ? <EncounterHead encounter={palette.encounter} /> : null}
              entries={palette.entries.filter((entry) => GROUP_TAB[entry.group] === active)}
              panel={tabPanel(panelId, active)}
              onSent={props.onClose}
            />
          )}
        </>
      )}
    </div>
  );
}

function ClockToggle(props: { view: StateView | null }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const hud = props.view?.hud;
  const chatId = props.view?.chatId;
  if (!hud || !chatId) return null;
  return (
    <Button
      size="sm"
      icon={hud.clock.paused ? "play" : "pause"}
      busy={busy}
      onClick={() =>
        run(async () => {
          await app.request(timeMarker(chatId, "pause", { all: true }, !hud.clock.paused));
        })
      }
    >
      {hud.clock.paused ? "Resume clock" : "Pause clock"}
    </Button>
  );
}

/** The Combat tab's head in a fight: the round, whose turn it is, and what the POV has left of each budget. */
export function EncounterHead(props: { encounter: PaletteEncounter }) {
  const { encounter } = props;
  return (
    <div class="lre-chat-encounter" data-lre-encounter-head>
      <div class="lre-chat-encounter-head">
        <Icon name="sword" size={16} />
        <strong>Round {encounter.round}</strong>
        <Badge tone={encounter.yours ? "accent" : "neutral"}>{encounter.yours ? "Your turn" : `${encounter.turn.charAt(0).toUpperCase()}${encounter.turn.slice(1)}'s turn`}</Badge>
      </div>
      {encounter.economy.length > 0 ? (
        <div class="lre-chat-encounter-left" role="group" aria-label="What you have left this turn">
          {encounter.economy.map((b) => (
            <span key={b.id} title={`${b.left} of ${b.of} ${b.label} left`}>
              <Badge tone={b.left > 0 ? "pos" : "neutral"}>
                {b.label} {b.left}/{b.of}
              </Badge>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A palette option's second step (`PaletteOption.next`): Drive picks a destination after the vehicle, Lend a person after the item. */
type NextStepView = NonNullable<PaletteOption["next"]>;

/** The chosen action and its chain of picks: the first option, then one choice per `next` step. */
interface Selection {
  entry: PaletteEntry;
  picks: PaletteOption[];
}

/**
 * One odds bar, and the chances in words in the bar's order, with a check's success in bold. The
 * words are what assistive tech reads; the bar repeats them for the eye.
 */
function OptionOdds(props: { odds: readonly OutcomeOdds[] }) {
  const series = oddsSeries(props.odds);
  return (
    <span class="lre-chat-odds">
      <span class="lre-chat-oddsbar" aria-hidden="true">
        {props.odds.map((o, i) => (
          <span key={o.outcome} style={{ width: `${Math.max(0, o.p) * 100}%`, background: `var(--lre-series-${series[i]})` }} />
        ))}
      </span>
      <span class="lre-chat-oddswords">
        {props.odds.map((o, i) => (
          <span key={o.outcome}>
            {i > 0 ? " · " : ""}
            {o.outcome.toLowerCase() === "success" ? <strong>{`${formatOdds(o.p)} ${o.outcome}`}</strong> : `${formatOdds(o.p)} ${o.outcome}`}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * An option: its label, its time and what the check reads, one odds bar, the price, and why it
 * can't be taken now. One that can't stays readable, so its reason does too: it is marked
 * unavailable rather than disabled, and a tap does nothing.
 */
function OptionRow(props: { option: PaletteOption; current: boolean; onPick(): void }) {
  const { option } = props;
  const blocked = option.disabled !== undefined;
  return (
    <button type="button" class="lre-item lre-chat-option" aria-current={props.current} aria-disabled={blocked || undefined} onClick={() => (blocked ? undefined : props.onPick())}>
      <span class="grow">
        <span class="title">{option.label}</span>
        {option.minutes !== undefined || option.detail ? (
          <span class="lre-chat-meta">
            {option.minutes !== undefined ? (
              <span class="lre-chat-time">
                <Icon name="clock" size={14} />
                {formatMinutes(option.minutes)}
              </span>
            ) : null}
            {option.detail ? <span>{option.detail}</span> : null}
          </span>
        ) : null}
        {option.odds && option.odds.length > 0 ? <OptionOdds odds={option.odds} /> : null}
        {blocked ? (
          <span class="lre-chat-whynot">
            <Icon name="lock" size={14} />
            <span>{option.disabled}</span>
          </span>
        ) : null}
      </span>
      {option.cents !== undefined ? <span class="lre-chat-price lre-num">{formatCents(option.cents)}</span> : null}
      {option.next ? <Icon name="chevron-right" size={16} class="lre-chat-chev" /> : null}
    </button>
  );
}

/** Picks match by params: a state push rebuilds the palette, so option objects aren't stable. */
function samePick(a: PaletteOption | undefined, b: PaletteOption | undefined): boolean {
  return a !== undefined && b !== undefined && JSON.stringify(a.params) === JSON.stringify(b.params);
}

/** One `next` step under the pick it follows; scrolls itself into view when it opens. */
function NextStep(props: { after: PaletteOption; step: NextStepView; chosen: PaletteOption | undefined; onPick(option: PaletteOption): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const after = JSON.stringify(props.after.params);
  useEffect(() => ref.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), [after]);
  return (
    <div ref={ref} class="lre-chat-next" data-lre-palette-step={props.step.param}>
      <div class="lre-chat-next-head">
        <Icon name="chevron-right" size={16} />
        <span>
          {props.step.label} <span class="lre-muted">for {props.after.label}</span>
        </span>
      </div>
      {props.step.options.length === 0 ? (
        <Empty>No {props.step.label.toLowerCase()} available.</Empty>
      ) : (
        <div class="lre-list">
          {props.step.options.map((option) => (
            <OptionRow key={JSON.stringify(option.params)} option={option} current={samePick(props.chosen, option)} onPick={() => props.onPick(option)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionList(props: { view: StateView; head: ComponentChildren; entries: PaletteEntry[]; panel: TabPanelProps; onSent(): void }) {
  const app = useApp();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [amount, setAmount] = useState("");
  // The entry's required number (Lend's days); null shows and sends its default.
  const [count, setCount] = useState<string | null>(null);
  const [busy, run] = useBusy();
  // Amounts are typed in the world's currency, with its own decimals (5 is 5 bits, or $5.00).
  const currency = props.view.currency ?? DEFAULT_CURRENCY;
  const amountCents = parseMoneyInput(amount, currency);
  const range = selected?.entry.amount;
  const amountOk = !range || (amountCents !== null && amountCents >= range.min && (range.max === null || amountCents <= range.max));
  const number = selected?.entry.number;
  const countValue = !number ? null : count === null ? number.default : /^\d+$/.test(count.trim()) ? Number(count) : null;
  const countOk = !number || (countValue !== null && countValue >= number.min && (number.max === null || countValue <= number.max));
  const last = selected?.picks.at(-1);
  const pending = last?.next;
  // Picking at a depth replaces that pick and drops the ones after it; picking the current one again clears it.
  const pick = (entry: PaletteEntry, depth: number, option: PaletteOption) => {
    const same = selected?.entry.action === entry.action;
    const picks = same ? selected.picks.slice(0, depth) : [];
    const again = same && samePick(selected.picks[depth], option);
    if (!same) setCount(null);
    setSelected(again ? (depth === 0 ? null : { entry, picks }) : { entry, picks: [...picks, option] });
  };
  const go = () => {
    if (!selected || pending || !amountOk || !countOk) return;
    run(async () => {
      const result = await app.request(paletteRequest(selected.entry, selected.picks, props.view.chatId, range ? amountCents ?? undefined : undefined, countValue ?? undefined));
      if (result) props.onSent();
    });
  };
  const chain = selected ? selected.picks.map((p) => p.label).filter((part) => part !== selected.entry.label) : [];
  const label = !selected ? "Choose an action" : pending ? `Choose ${pending.label.toLowerCase()}` : chain.length > 0 ? `${selected.entry.label}: ${chain.join(" → ")}` : selected.entry.label;
  const span = range ? `${formatMoney(range.min, currency)}${range.max !== null ? `–${formatMoney(range.max, currency)}` : " or more"}` : "";
  return (
    <>
      <div {...props.panel} class="body" data-lre-palette-list>
        {props.head}
        {props.entries.map((entry) => (
          <section key={entry.action} class="lre-chat-entry">
            <div class="lre-chat-entry-head">
              <h3>{entry.label}</h3>
              {entry.amount ? <Badge>Amount</Badge> : null}
            </div>
            <div class="lre-list">
              {entry.options.map((option) => (
                <OptionRow key={JSON.stringify(option.params)} option={option} current={selected?.entry.action === entry.action && samePick(selected.picks[0], option)} onPick={() => pick(entry, 0, option)} />
              ))}
            </div>
            {selected?.entry.action === entry.action
              ? selected.picks.map((chosen, depth) => (chosen.next ? <NextStep key={`${depth}:${JSON.stringify(chosen.params)}`} after={chosen} step={chosen.next} chosen={selected.picks[depth + 1]} onPick={(option) => pick(entry, depth + 1, option)} /> : null))
              : null}
          </section>
        ))}
      </div>
      <footer>
        {range && amount.trim() !== "" && !amountOk ? (
          <span class="lre-chat-hint" role="status">
            <Icon name="alert" size={14} />
            Enter an amount of {span}.
          </span>
        ) : null}
        {number && !countOk ? (
          <span class="lre-chat-hint" role="status">
            <Icon name="alert" size={14} />
            Enter {number.min}
            {number.max !== null ? `–${number.max}` : " or more"} {number.label}.
          </span>
        ) : null}
        {range ? <MoneyInput currency={currency} value={amount} onInput={setAmount} label="Amount" invalid={amount.trim() !== "" && !amountOk} placeholder={`Amount (${span})`} /> : null}
        {number ? (
          <label class="lre-chat-count">
            <input
              class={countOk ? "lre-input" : "lre-input invalid"}
              inputMode="numeric"
              aria-label={`Number of ${number.label}`}
              aria-invalid={!countOk || undefined}
              value={count ?? String(number.default)}
              onInput={(event) => setCount(event.currentTarget.value)}
            />
            <span>{number.label}</span>
          </label>
        ) : null}
        <button type="button" class="lre-btn primary lre-chat-go" disabled={!selected || pending !== undefined || !amountOk || !countOk || busy} aria-busy={busy || undefined} onClick={go} data-lre-go>
          {selected && !pending ? <Icon name="check" /> : null}
          {label}
        </button>
      </footer>
    </>
  );
}

const UNIT_MINUTES: Record<"min" | "h" | "d" | "w", number> = { min: 1, h: 60, d: 1440, w: 10080 };
const POLICY_OPTIONS = [
  { value: "stop", label: "Stop" },
  { value: "note", label: "Note" },
  { value: "ignore", label: "Ignore" },
] as const;

function TimelapsePanel(props: { view: StateView; timelapse: TimelapseView; panel: TabPanelProps; onSent(): void }) {
  const app = useApp();
  const { timelapse } = props;
  const [target, setTarget] = useState<TimelapseTarget | null>(null);
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<"min" | "h" | "d" | "w">("h");
  const [overrides, setOverrides] = useState<Partial<Record<InterruptClass, InterruptPolicy>>>({});
  const [busy, run] = useBusy();
  const customMinutes = /^\d+(\.\d+)?$/.test(custom.trim()) ? Number(custom) * UNIT_MINUTES[unit] : null;
  const chosen: TimelapseTarget | null = customMinutes !== null && customMinutes > 0 ? { type: "duration", minutes: customMinutes } : target;
  const sameTarget = (a: TimelapseTarget | null, b: TimelapseTarget) => a !== null && JSON.stringify(a) === JSON.stringify(b);
  const changed = Object.entries(overrides).filter(([cls, policy]) => timelapse.interrupts[cls as InterruptClass] !== policy).length;
  return (
    <>
      <div {...props.panel} class="body" data-lre-timelapse>
        {timelapse.blocked ? (
          <Banner tone="warn" icon="pause">
            {timelapse.blocked}
          </Banner>
        ) : null}
        <Section title="For">
          <div class="lre-chat-durations" role="group" aria-label="How long">
            {timelapse.durations.map((minutes) => {
              const t: TimelapseTarget = { type: "duration", minutes };
              return (
                <button
                  key={minutes}
                  type="button"
                  class="lre-chat-pill"
                  aria-pressed={sameTarget(chosen, t)}
                  onClick={() => {
                    setCustom("");
                    setTarget(t);
                  }}
                >
                  {formatMinutes(minutes)}
                </button>
              );
            })}
          </div>
          <div class="lre-chat-custom">
            <input class="lre-input" inputMode="decimal" placeholder="Custom" aria-label="Custom duration" value={custom} onInput={(event) => setCustom(event.currentTarget.value)} />
            <Seg<"min" | "h" | "d" | "w">
              label="Unit"
              value={unit}
              options={[
                { value: "min", label: "min" },
                { value: "h", label: "hours" },
                { value: "d", label: "days" },
                { value: "w", label: "weeks" },
              ]}
              onChange={(next) => setUnit(next)}
            />
          </div>
          {timelapse.dayParts ? (
            <span class="lre-chat-hint">
              <Icon name="info" size={14} />
              Calendar is at Narrative: times round to day parts.
            </span>
          ) : null}
        </Section>
        {timelapse.until.length > 0 ? (
          <Section title="Until">
            <div class="lre-list">
              {timelapse.until.map((entry) => (
                <button
                  key={JSON.stringify(entry.target)}
                  type="button"
                  class="lre-item"
                  aria-current={customMinutes === null && sameTarget(target, entry.target)}
                  onClick={() => {
                    setCustom("");
                    setTarget(entry.target);
                  }}
                >
                  <Icon name="flag" size={16} class="lre-chat-lead" />
                  <span class="grow">
                    <span class="title">{entry.label}</span>
                    {entry.detail ? <span class="sub">{entry.detail}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        ) : null}
        <Section>
          <Disclosure summary={`Interrupts for this run${changed > 0 ? ` · ${changed} changed` : ""}`}>
            {INTERRUPT_CLASSES.map((cls) => (
              <div key={cls} class="lre-field">
                <span class="label">{humanize(cls)}</span>
                <Seg label={humanize(cls)} value={overrides[cls] ?? timelapse.interrupts[cls]} options={POLICY_OPTIONS} onChange={(policy) => setOverrides((prev) => ({ ...prev, [cls]: policy }))} />
              </div>
            ))}
          </Disclosure>
        </Section>
      </div>
      <footer>
        <button
          type="button"
          class="lre-btn primary block"
          data-lre-go
          disabled={!chosen || timelapse.blocked !== null || busy}
          aria-busy={busy || undefined}
          onClick={() => {
            if (!chosen) return;
            run(async () => {
              const result = await app.request(timelapseRequest(timelapse, chosen, overrides, props.view.chatId));
              if (result) props.onSent();
            });
          }}
        >
          <Icon name="fast-forward" />
          {chosen ? `Timelapse ${chosen.type === "duration" ? formatMinutes(chosen.minutes) : (timelapse.until.find((entry) => sameTarget(chosen, entry.target))?.label ?? "").toLowerCase()}` : "Choose how long"}
        </button>
      </footer>
    </>
  );
}
