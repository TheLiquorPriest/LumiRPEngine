// The input-bar palette (DESIGN §11, §12): actions with targets and exact odds, Buy, Pay, Transfer,
// Drive, Lend, and the Timelapse sheet (duration chips, until targets, interrupt overrides), plus
// Pause/Resume clock. Everything comes from `StateView.palette`; a choice sends one `lre.action`.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { InterruptClass, InterruptPolicy } from "../shared/ids";
import type { TimelapseTarget } from "../shared/ledger";
import { parseMoneyInput } from "../shared/money";
import type { PaletteEntry, PaletteOption, PaletteView, StateView, TimelapseView } from "../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney } from "../shared/world";
import type { PaletteTab } from "./app";
import { useApp, useView } from "./app";
import { Empty, OddsBar, Seg, Tabs, tabPanel, useBusy } from "./components";
import type { TabPanelProps } from "./components";
import { formatCents, formatMinutes, humanize } from "./format";
import { MoneyInput } from "./money-input";
import { paletteRequest, timelapseRequest, timeMarker } from "./requests";

const GROUP_LABEL: Record<PaletteEntry["group"], string> = { action: "Actions", buy: "Buy", pay: "Pay", transfer: "Transfer", drive: "Drive", lend: "Lend" };
const GROUP_TAB: Record<PaletteEntry["group"], PaletteTab> = { action: "actions", buy: "buy", pay: "pay", transfer: "transfer", drive: "drive", lend: "lend" };

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
  const [tab, setTab] = useState<PaletteTab>(props.tab);
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
        <span class="title">{active === "timelapse" ? "Timelapse" : "Actions"}</span>
        <ClockToggle view={view} />
        <button type="button" class="lre-btn ghost" aria-label="Close actions" onClick={props.onClose}>
          ✕
        </button>
      </header>
      {!view || view.status === "not_world" ? (
        <div class="body">
          <Empty>Open a world chat to use actions.</Empty>
        </div>
      ) : !palette || tabs.length === 0 ? (
        <div class="body">
          <Empty>No actions are available here right now.</Empty>
        </div>
      ) : (
        <>
          <div style={{ padding: "8px 12px 0" }}>
            <Tabs<PaletteTab> label="Action groups" panelId={panelId} value={active} tabs={tabs} onChange={(id) => setTab(id)} />
          </div>
          {active === "timelapse" && palette.timelapse ? (
            <TimelapsePanel view={view} timelapse={palette.timelapse} panel={tabPanel(panelId, active)} onSent={props.onClose} />
          ) : (
            <ActionList key={active} view={view} entries={palette.entries.filter((entry) => GROUP_TAB[entry.group] === active)} panel={tabPanel(panelId, active)} onSent={props.onClose} />
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
    <button
      type="button"
      class="lre-btn small"
      disabled={busy}
      onClick={() =>
        run(async () => {
          await app.request(timeMarker(chatId, "pause", { all: true }, !hud.clock.paused));
        })
      }
    >
      <span aria-hidden="true">{hud.clock.paused ? "▶" : "⏸"}</span> {hud.clock.paused ? "Resume clock" : "Pause clock"}
    </button>
  );
}

/** A palette option's second step (`PaletteOption.next`): Drive picks a destination after the vehicle, Lend a person after the item. */
type NextStepView = NonNullable<PaletteOption["next"]>;

/** The chosen action and its chain of picks: the first option, then one choice per `next` step. */
interface Selection {
  entry: PaletteEntry;
  picks: PaletteOption[];
}

function OptionButton(props: { option: PaletteOption; current: boolean; onPick(): void }) {
  const { option } = props;
  return (
    <button type="button" class="lre-item" aria-current={props.current} disabled={option.disabled !== undefined} title={option.disabled} onClick={props.onPick}>
      <span class="grow">
        <span class="title">{option.label}</span>
        <span class="sub">{[option.detail, option.minutes !== undefined ? formatMinutes(option.minutes) : null, option.disabled].filter((part) => part).join(" · ")}</span>
        {option.odds && option.odds.length > 0 ? <OddsBar odds={option.odds} /> : null}
      </span>
      {option.cents !== undefined ? <span class="lre-num">{formatCents(option.cents)}</span> : null}
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
    <div ref={ref} class="lre-stack" data-lre-palette-step={props.step.param} style={{ marginTop: "8px" }}>
      <div class="lre-small lre-muted">
        {props.after.label} → {props.step.label}
      </div>
      {props.step.options.length === 0 ? (
        <Empty>No {props.step.label.toLowerCase()} available.</Empty>
      ) : (
        <div class="lre-list">
          {props.step.options.map((option) => (
            <OptionButton key={JSON.stringify(option.params)} option={option} current={samePick(props.chosen, option)} onPick={() => props.onPick(option)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionList(props: { view: StateView; entries: PaletteEntry[]; panel: TabPanelProps; onSent(): void }) {
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
  return (
    <>
      <div {...props.panel} class="body" data-lre-palette-list>
        {props.entries.map((entry) => (
          <section key={entry.action} class="lre-card">
            <div class="lre-h">
              <span>{entry.label}</span>
              {entry.amount ? <span class="lre-badge">amount</span> : null}
            </div>
            <div class="lre-list">
              {entry.options.map((option) => (
                <OptionButton key={JSON.stringify(option.params)} option={option} current={selected?.entry.action === entry.action && samePick(selected.picks[0], option)} onPick={() => pick(entry, 0, option)} />
              ))}
            </div>
            {selected?.entry.action === entry.action
              ? selected.picks.map((chosen, depth) => (chosen.next ? <NextStep key={`${depth}:${JSON.stringify(chosen.params)}`} after={chosen} step={chosen.next} chosen={selected.picks[depth + 1]} onPick={(option) => pick(entry, depth + 1, option)} /> : null))
              : null}
          </section>
        ))}
      </div>
      <footer>
        {range ? (
          <MoneyInput
            currency={currency}
            value={amount}
            onInput={setAmount}
            label="Amount"
            invalid={!amountOk}
            placeholder={`Amount (${formatMoney(range.min, currency)}${range.max !== null ? `–${formatMoney(range.max, currency)}` : "+"})`}
          />
        ) : null}
        {number ? (
          <label class="lre-inline" style={{ flex: "0 0 auto", gap: "6px" }}>
            <input
              class={countOk ? "lre-input" : "lre-input invalid"}
              style={{ width: "64px" }}
              inputMode="numeric"
              aria-label={`Number of ${number.label}`}
              value={count ?? String(number.default)}
              onInput={(event) => setCount(event.currentTarget.value)}
            />
            <span class="lre-small">{number.label}</span>
          </label>
        ) : null}
        <button type="button" class="lre-btn primary" style={{ flex: range ? "0 0 auto" : 1 }} disabled={!selected || pending !== undefined || !amountOk || !countOk || busy} onClick={go} data-lre-go>
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
  const [showPolicy, setShowPolicy] = useState(false);
  const [busy, run] = useBusy();
  const customMinutes = /^\d+(\.\d+)?$/.test(custom.trim()) ? Number(custom) * UNIT_MINUTES[unit] : null;
  const chosen: TimelapseTarget | null = customMinutes !== null && customMinutes > 0 ? { type: "duration", minutes: customMinutes } : target;
  const sameTarget = (a: TimelapseTarget | null, b: TimelapseTarget) => a !== null && JSON.stringify(a) === JSON.stringify(b);
  const changed = Object.entries(overrides).filter(([cls, policy]) => timelapse.interrupts[cls as InterruptClass] !== policy).length;
  return (
    <>
      <div {...props.panel} class="body" data-lre-timelapse>
        {timelapse.blocked ? (
          <div class="lre-banner warn">
            <span>{timelapse.blocked}</span>
          </div>
        ) : null}
        <section class="lre-card">
          <div class="lre-h">For</div>
          <div class="lre-inline">
            {timelapse.durations.map((minutes) => {
              const t: TimelapseTarget = { type: "duration", minutes };
              return (
                <button
                  key={minutes}
                  type="button"
                  class={sameTarget(chosen, t) ? "lre-btn primary" : "lre-btn"}
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
          <div class="lre-inline" style={{ marginTop: "8px" }}>
            <input class="lre-input" style={{ width: "96px" }} inputMode="decimal" placeholder="Custom" aria-label="Custom duration" value={custom} onInput={(event) => setCustom(event.currentTarget.value)} />
            <div style={{ flex: 1, minWidth: "180px" }}>
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
          </div>
          {timelapse.dayParts ? <div class="lre-small lre-muted" style={{ marginTop: "6px" }}>Calendar is at Narrative: times round to day parts.</div> : null}
        </section>
        {timelapse.until.length > 0 ? (
          <section class="lre-card">
            <div class="lre-h">Until</div>
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
                  <span class="grow">
                    <span class="title">{entry.label}</span>
                    {entry.detail ? <span class="sub">{entry.detail}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section class="lre-card">
          <button type="button" class="lre-btn ghost block" aria-expanded={showPolicy} onClick={() => setShowPolicy(!showPolicy)}>
            Interrupts for this run{changed > 0 ? ` · ${changed} changed` : ""} <span aria-hidden="true">{showPolicy ? "▴" : "▾"}</span>
          </button>
          {showPolicy
            ? INTERRUPT_CLASSES.map((cls) => (
                <div key={cls} class="lre-field" style={{ marginTop: "8px" }}>
                  <span class="label">{humanize(cls)}</span>
                  <Seg label={humanize(cls)} value={overrides[cls] ?? timelapse.interrupts[cls]} options={POLICY_OPTIONS} onChange={(policy) => setOverrides((prev) => ({ ...prev, [cls]: policy }))} />
                </div>
              ))
            : null}
        </section>
      </div>
      <footer>
        <button
          type="button"
          class="lre-btn primary block"
          data-lre-go
          disabled={!chosen || timelapse.blocked !== null || busy}
          onClick={() => {
            if (!chosen) return;
            run(async () => {
              const result = await app.request(timelapseRequest(timelapse, chosen, overrides, props.view.chatId));
              if (result) props.onSent();
            });
          }}
        >
          {chosen ? `Timelapse ${chosen.type === "duration" ? formatMinutes(chosen.minutes) : (timelapse.until.find((entry) => sameTarget(chosen, entry.target))?.label ?? "").toLowerCase()}` : "Choose how long"}
        </button>
      </footer>
    </>
  );
}
