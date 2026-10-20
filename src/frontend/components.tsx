// Shared UI atoms. Host components (range slider, switch, number stepper, select,
// model picker) are mounted through `ctx.components` into a div Preact never renders children
// into; their latest callbacks are read through refs so the host mount is created once. Every atom
// meets the accessibility floor: 40 px targets (44 in the bottom bar), labelled icon
// buttons, the shared focus ring.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { OutcomeOdds } from "../shared/state-view";
import { useApp, useUi } from "./app";
import { formatOdds } from "./format";
import type { IconName } from "./icons";
import { Icon } from "./icons";
import { isMobile } from "./layout";
import { useSelect } from "./store";

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
}

export function Seg<T extends string | number>(props: { value: T | null; options: readonly SegOption<T>[]; onChange(value: T): void; label: string; disabled?: boolean }) {
  return (
    <div class="lre-seg" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === props.value} title={option.title} disabled={props.disabled} onClick={() => props.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * WAI-ARIA tabs: roving tabIndex, Left/Right/Home/End select and focus. The caller renders the
 * active panel with `tabPanel(panelId, value)` so the tab and its panel reference each other.
 */
export function Tabs<T extends string>(props: { value: T | null; tabs: readonly { id: T; label: string; dot?: boolean }[]; onChange(id: T): void; label: string; panelId: string }) {
  const list = useRef<HTMLDivElement>(null);
  const selected = Math.max(0, props.tabs.findIndex((tab) => tab.id === props.value));
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = props.tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const tab = props.tabs[next];
    if (!tab) return;
    event.preventDefault();
    props.onChange(tab.id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  // A strip wider than the drawer scrolls sideways: keep the selected tab in sight when it changes
  // or the strip resizes (a phone rotating, the drawer opening narrower than it closed).
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const reveal = () => {
      const tab = el.querySelectorAll<HTMLElement>('[role="tab"]')[selected];
      if (!tab) return;
      // The strip is positioned, so a tab's offsetLeft is measured from the strip's start.
      const left = tab.offsetLeft;
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (left + tab.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + tab.offsetWidth - el.clientWidth + 8;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selected, props.tabs.length]);
  return (
    <div ref={list} class="lre-tabs" role="tablist" aria-label={props.label}>
      {props.tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${props.panelId}-tab-${tab.id}`}
          aria-selected={tab.id === props.value}
          aria-controls={tab.id === props.value ? props.panelId : undefined}
          tabIndex={index === selected ? 0 : -1}
          onClick={() => props.onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          {tab.dot ? <span class="lre-dot" role="img" aria-label="pending" /> : null}
        </button>
      ))}
    </div>
  );
}

/** The attributes of the panel a `Tabs` strip controls. */
export interface TabPanelProps {
  id: string;
  role: "tabpanel";
  "aria-labelledby": string | undefined;
}

export function tabPanel(panelId: string, tab: string | null): TabPanelProps {
  return { id: panelId, role: "tabpanel", "aria-labelledby": tab === null ? undefined : `${panelId}-tab-${tab}` };
}

export function Card(props: { title?: ComponentChildren; aside?: ComponentChildren; preview?: boolean; children?: ComponentChildren }) {
  return (
    <section class={props.preview ? "lre-card preview" : "lre-card"}>
      {props.title !== undefined || props.aside !== undefined ? (
        <div class="lre-h">
          <span>{props.title}</span>
          {props.aside}
        </div>
      ) : null}
      {props.preview ? <div class="lre-preview-label">Preview — not recorded</div> : null}
      {props.children}
    </section>
  );
}

export function Row(props: { k: ComponentChildren; v?: ComponentChildren; sub?: ComponentChildren; tone?: "neg" | "pos" | "warn" | "muted" }) {
  return (
    <div class="lre-row">
      <span class="k">
        {props.k}
        {props.sub !== undefined ? <span class="sub">{props.sub}</span> : null}
      </span>
      {props.v !== undefined ? <span class={props.tone ? `v lre-${props.tone}` : "v"}>{props.v}</span> : null}
    </div>
  );
}

/** A note where content would be: an optional icon, a title, a line of help and an action. */
export function Empty(props: { icon?: IconName; title?: ComponentChildren; action?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="lre-empty">
      {props.icon ? (
        <span class="lre-empty-icon">
          <Icon name={props.icon} />
        </span>
      ) : null}
      {props.title !== undefined ? <div class="lre-empty-title">{props.title}</div> : null}
      {props.children}
      {props.action !== undefined ? <div class="lre-empty-action">{props.action}</div> : null}
    </div>
  );
}

/**
 * The series each outcome is painted in: the engine's default outcomes (a DC's `success` and
 * `failure`) take the success and danger series, so no bar paints a failure green; other outcomes
 * take the remaining series in order.
 */
export function oddsSeries(odds: readonly OutcomeOdds[]): number[] {
  let other = 0;
  return odds.map((o) => OUTCOME_SERIES[o.outcome.toLowerCase()] ?? OTHER_SERIES[other++ % OTHER_SERIES.length] ?? 6);
}

const OUTCOME_SERIES: Partial<Record<string, number>> = { success: 1, failure: 4, fail: 4 };
const OTHER_SERIES = [2, 3, 5, 6] as const;

/** Exact outcome odds as a stacked bar with a legend, coloured by what each outcome means. */
export function OddsBar(props: { odds: readonly OutcomeOdds[] }) {
  const series = oddsSeries(props.odds);
  return (
    <div>
      <div class="lre-odds" role="img" aria-label={props.odds.map((o) => `${o.outcome} ${formatOdds(o.p)}`).join(", ")}>
        {props.odds.map((o, i) => (
          <span key={o.outcome} style={{ width: `${Math.max(0, o.p) * 100}%`, background: `var(--lre-series-${series[i]})` }} />
        ))}
      </div>
      <div class="lre-odds-legend">
        {props.odds.map((o, i) => (
          <span key={o.outcome}>
            <i style={{ background: `var(--lre-series-${series[i]})` }} />
            {o.outcome} {formatOdds(o.p)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Any JSON view model: the fallback for a panel whose view doesn't decode. */
export function JsonView(props: { value: JsonValue | unknown; depth?: number }) {
  const depth = props.depth ?? 0;
  const value = props.value;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span class="lre-dim">none</span>;
    return (
      <div class={depth > 0 ? "lre-tree" : undefined}>
        {value.map((entry, i) => (
          <div key={i} class="lre-row">
            <span class="k">
              <JsonView value={entry} depth={depth + 1} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (isRecord(value)) {
    return (
      <div class={depth > 0 ? "lre-tree" : undefined}>
        {Object.entries(value).map(([key, entry]) =>
          isRecord(entry) || Array.isArray(entry) ? (
            <div key={key}>
              <div class="lre-h">{key}</div>
              <JsonView value={entry} depth={depth + 1} />
            </div>
          ) : (
            <Row key={key} k={key} v={<JsonView value={entry} depth={depth + 1} />} />
          ),
        )}
      </div>
    );
  }
  if (value === null || value === undefined) return <span class="lre-dim">—</span>;
  return <span>{String(value)}</span>;
}

export type ToastSurface = "map" | "palette" | "world" | "drawer" | "chat";

/**
 * Toasts render on the topmost visible surface only: an open overlay, else the open drawer, else
 * the chat toolbar (inline, above the composer). A phone's drawer fills the screen, so its toasts
 * sit centred above its bottom bar; a desktop's drawer is a column beside the chat, so its toasts
 * sit over that column, never over the composer and its buttons.
 */
export function Toasts(props: { surface: ToastSurface }) {
  const app = useApp();
  const list = useSelect(app.toasts, (all) => all);
  const overlay = useSelect(app.ui, (ui) => ui.overlay);
  const drawerOpen = useSelect(app.host.drawer, (drawer) => drawer.open);
  const docked = useSelect(app.host.viewport, (viewport) => props.surface === "drawer" && !isMobile(viewport));
  const box = useRef<HTMLDivElement>(null);
  const active: ToastSurface = overlay ?? (drawerOpen ? "drawer" : "chat");
  const shown = list.length > 0 && active === props.surface;
  useLayoutEffect(() => {
    const el = box.current;
    // The drawer's tab root, which spans its column.
    const column = el?.parentElement;
    if (!shown || !docked || !el || !column) return undefined;
    // Rendered pixels; the stylesheet turns them into the host's layout pixels by its UI scale.
    const place = () => {
      const rect = column.getBoundingClientRect();
      el.style.setProperty("--lre-toasts-x", `${rect.left + rect.width / 2}px`);
      el.style.setProperty("--lre-toasts-w", `${rect.width}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    window.addEventListener("resize", place);
    // The host slides the drawer with a transform, which no ResizeObserver sees.
    document.addEventListener("transitionend", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("transitionend", place, true);
    };
  }, [shown, docked]);
  if (!shown) return null;
  const toasts = app.toasts;
  return (
    <div ref={box} class={props.surface === "chat" ? "lre lre-toasts inline" : docked ? "lre lre-toasts docked" : "lre lre-toasts"} aria-live="polite" data-lre-toasts={props.surface}>
      {list.map((toast) => (
        <div key={toast.id} class={toast.tone === "error" ? "lre-toast error" : "lre-toast"} role={toast.tone === "error" ? "alert" : "status"}>
          <Icon name={toast.tone === "error" ? "alert" : "info"} size={16} />
          <span style={{ flex: 1 }}>{toast.text}</span>
          <IconButton icon="close" label="Dismiss" onClick={() => toasts.update((all) => all.filter((entry) => entry.id !== toast.id))} />
        </div>
      ))}
    </div>
  );
}

/** Runs an async action with a busy flag; repeated taps while busy are ignored. */
export function useBusy(): [boolean, (run: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  return [
    busy,
    (run) => {
      if (busy) return;
      setBusy(true);
      void run().finally(() => {
        if (live.current) setBusy(false);
      });
    },
  ];
}

// ---------------------------------------------------------------- shared UI atoms

/** A button on the shared look: 40 px tall at least, an optional icon either side. `label` names it when its text alone doesn't. */
export function Button(props: { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "sm"; icon?: IconName; iconAfter?: IconName; block?: boolean; disabled?: boolean; busy?: boolean; label?: string; title?: string; type?: "button" | "submit"; onClick?(event: MouseEvent): void; children?: ComponentChildren }) {
  const variant = props.variant ?? "secondary";
  const iconSize = props.size === "sm" ? 16 : 20;
  const classes = ["lre-btn", variant === "secondary" ? null : variant, props.size === "sm" ? "small" : null, props.block ? "block" : null].filter((c) => c !== null).join(" ");
  return (
    <button type={props.type ?? "button"} class={classes} disabled={props.disabled || props.busy} aria-busy={props.busy || undefined} aria-label={props.label} title={props.title} onClick={props.onClick}>
      {props.icon ? <Icon name={props.icon} size={iconSize} /> : null}
      {props.children}
      {props.iconAfter ? <Icon name={props.iconAfter} size={iconSize} /> : null}
    </button>
  );
}

/** A 40 px icon-only button, named by `label` (also its tooltip); `pressed` makes it a toggle. */
export function IconButton(props: { icon: IconName; label: string; variant?: "ghost" | "secondary" | "primary"; pressed?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" class={`lre-iconbtn ${props.variant ?? "ghost"}`} aria-label={props.label} title={props.label} aria-pressed={props.pressed} disabled={props.disabled} onClick={() => props.onClick()}>
      <Icon name={props.icon} />
    </button>
  );
}

/** A titled group: a quiet section label above a card. `flush` drops the card's padding, for a List of rows. */
export function Section(props: { title?: ComponentChildren; aside?: ComponentChildren; flush?: boolean; children: ComponentChildren }) {
  return (
    <section class={props.flush ? "lre-section flush" : "lre-section"}>
      {props.title !== undefined || props.aside !== undefined ? (
        <div class="lre-section-head">
          {props.title !== undefined ? <h3 class="lre-section-title">{props.title}</h3> : <span />}
          {props.aside}
        </div>
      ) : null}
      <div class="lre-section-body">{props.children}</div>
    </section>
  );
}

/** Grouped rows divided by hairlines; inside a `Section flush` they make a list card. */
export function List(props: { children: ComponentChildren }) {
  return (
    <div class="lre-rowlist" role="list">
      {props.children}
    </div>
  );
}

/** One row of a List, 44 px tall at least: a button when it has `onClick`. With `id`, the id shows under the title while Show ids is on. */
export function ListRow(props: { title: ComponentChildren; subtitle?: ComponentChildren; icon?: IconName; leading?: ComponentChildren; value?: ComponentChildren; valueTone?: "pos" | "neg" | "warn" | "muted"; badge?: ComponentChildren; chevron?: boolean; current?: boolean; disabled?: boolean; id?: string; onClick?(): void }) {
  const lead = props.leading ?? (props.icon ? <Icon name={props.icon} /> : null);
  const inner = (
    <>
      {lead !== null ? <span class="lre-listrow-lead">{lead}</span> : null}
      <span class="lre-listrow-content">
        <span class="lre-listrow-text">
          <span class="lre-listrow-title">{props.title}</span>
          {props.subtitle !== undefined ? <span class="lre-listrow-sub">{props.subtitle}</span> : null}
          {props.id !== undefined ? <IdText id={props.id} /> : null}
        </span>
        {props.badge}
        {props.value !== undefined ? <span class={props.valueTone ? `lre-listrow-value lre-${props.valueTone}` : "lre-listrow-value"}>{props.value}</span> : null}
        {props.chevron ? <Icon name="chevron-right" size={16} class="lre-listrow-chev" /> : null}
      </span>
    </>
  );
  const onClick = props.onClick;
  return (
    <div class="lre-listrow" role="listitem">
      {onClick ? (
        <button type="button" class="lre-listrow-hit" aria-current={props.current || undefined} disabled={props.disabled} onClick={() => onClick()}>
          {inner}
        </button>
      ) : (
        <div class="lre-listrow-hit" aria-current={props.current || undefined} aria-disabled={props.disabled || undefined}>
          {inner}
        </div>
      )}
    </div>
  );
}

/** A labelled figure: the value large, in tabular numbers. */
export function Stat(props: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: "pos" | "neg" | "warn" }) {
  return (
    <div class="lre-stat">
      <span class="lre-stat-label">{props.label}</span>
      <span class={props.tone ? `lre-stat-value lre-${props.tone}` : "lre-stat-value"}>{props.value}</span>
      {props.sub !== undefined ? <span class="lre-stat-sub">{props.sub}</span> : null}
    </div>
  );
}

/** A labelled bar for a value in a range (fuel, health, a need), with its value in words for assistive tech. */
export function Meter(props: { label: string; value: number; max: number; min?: number; tone?: "accent" | "pos" | "neg" | "warn"; showValue?: boolean }) {
  const min = props.min ?? 0;
  const span = props.max - min;
  const share = span > 0 ? Math.min(1, Math.max(0, (props.value - min) / span)) : 0;
  return (
    <div class={`lre-gauge ${props.tone ?? "accent"}`} role="meter" aria-label={props.label} aria-valuemin={min} aria-valuemax={props.max} aria-valuenow={props.value}>
      <div class="lre-gauge-head" aria-hidden="true">
        <span class="lre-gauge-label">{props.label}</span>
        {props.showValue ? (
          <span class="lre-gauge-value">
            {props.value} / {props.max}
          </span>
        ) : null}
      </div>
      <div class="lre-gauge-track">
        <span style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function Badge(props: { tone?: "neutral" | "accent" | "pos" | "neg" | "warn" | "gm"; children: ComponentChildren }) {
  return <span class={props.tone && props.tone !== "neutral" ? `lre-badge ${props.tone}` : "lre-badge"}>{props.children}</span>;
}

/** Each tone's icon, so a banner never says what it means by colour alone. */
const BANNER_ICON: Record<"info" | "warn" | "neg" | "gm", IconName> = { info: "info", warn: "alert", neg: "alert", gm: "eye" };

/** A status message across the content: an icon, a title, the details and actions. */
export function Banner(props: { tone: "info" | "warn" | "neg" | "gm"; icon?: IconName; title?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class={`lre-banner ${props.tone}`} role="status">
      <div class="lre-banner-main">
        <Icon name={props.icon ?? BANNER_ICON[props.tone]} class="lre-banner-icon" />
        <div class="lre-banner-text">
          {props.title !== undefined ? <strong class="lre-banner-title">{props.title}</strong> : null}
          {props.children !== undefined ? <div class="lre-banner-body">{props.children}</div> : null}
        </div>
      </div>
      {props.actions !== undefined ? <div class="lre-banner-actions">{props.actions}</div> : null}
    </div>
  );
}

/** Details on request: a native disclosure, so keyboard and screen readers work as they expect. */
export function Disclosure(props: { summary: ComponentChildren; defaultOpen?: boolean; children: ComponentChildren }) {
  return (
    <details class="lre-disclosure" open={props.defaultOpen}>
      <summary>
        <span class="lre-disclosure-label">{props.summary}</span>
        <Icon name="chevron-down" size={16} />
      </summary>
      <div class="lre-disclosure-body">{props.children}</div>
    </details>
  );
}

/** A labelled control with optional help and an error; `for` ties the label to the control's id. */
export function Field(props: { label: ComponentChildren; help?: ComponentChildren; error?: string | null; for?: string; children: ComponentChildren }) {
  return (
    <div class="lre-field">
      {props.for !== undefined ? <label for={props.for}>{props.label}</label> : <span class="label">{props.label}</span>}
      {props.children}
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      {props.error ? (
        <span class="lre-field-error">
          <Icon name="alert" size={16} />
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

/** A person's initials in a neutral circle; decorative, as the name shows beside it. */
export function Avatar(props: { name: string; size?: number }) {
  const size = props.size ?? 32;
  const initials = props.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span class="lre-avatar" aria-hidden="true" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }}>
      {initials}
    </span>
  );
}

/** A page's title row: Back, the title and subtitle, and actions. */
export function PageHeader(props: { title: ComponentChildren; subtitle?: ComponentChildren; onBack?(): void; backLabel?: string; actions?: ComponentChildren }) {
  const onBack = props.onBack;
  return (
    <div class="lre-page-header">
      {onBack ? <IconButton icon="chevron-left" label={props.backLabel ? `Back to ${props.backLabel}` : "Back"} onClick={() => onBack()} /> : null}
      <div class="lre-page-titles">
        <h2 class="lre-page-title">{props.title}</h2>
        {props.subtitle !== undefined ? <div class="lre-page-sub">{props.subtitle}</div> : null}
      </div>
      {props.actions !== undefined ? <div class="lre-page-actions">{props.actions}</div> : null}
    </div>
  );
}

/** Bottom-bar navigation: icon and label per item, 44 px tall, the current one marked `aria-current="page"`; a dot marks one that has something pending. */
export function BottomNav<T extends string>(props: { label: string; items: readonly { id: T; label: string; icon: IconName; dot?: boolean }[]; value: T; onChange(id: T): void; tone?: "accent" | "gm" }) {
  return (
    <nav class="lre-bottomnav" aria-label={props.label} data-tone={props.tone ?? "accent"}>
      {props.items.map((item) => (
        <button key={item.id} type="button" aria-current={item.id === props.value ? "page" : undefined} onClick={() => props.onChange(item.id)}>
          <Icon name={item.icon} />
          <span class="lre-bottomnav-label">{item.label}</span>
          {item.dot ? <span class="lre-dot" role="img" aria-label="pending" /> : null}
        </button>
      ))}
    </nav>
  );
}

/** Actions kept in reach at the bottom of a long form while it scrolls. */
export function SaveBar(props: { children: ComponentChildren }) {
  return <div class="lre-savebar">{props.children}</div>;
}

/** Whether ids show beside names (Settings → Display → Show ids). */
export function useShowIds(): boolean {
  return useUi((ui) => ui.showIds);
}

/** An id in small mono type, shown only while Show ids is on. */
export function IdText(props: { id: string }) {
  return useShowIds() ? <code class="lre-id">{props.id}</code> : null;
}

// ---------------------------------------------------------------- host components

export function HostSlider(props: { min: number; max: number; step?: number; integer?: boolean; value: number; label?: string; hint?: string; suffix?: string; disabled?: boolean; onCommit(value: number): void; onDrag?(value: number | null): void }) {
  const { host } = useApp();
  const slot = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const handle = useRef<{ update(patch: Record<string, unknown>): void; destroy(): void } | null>(null);
  // The host keeps the position a gesture committed; `held` mirrors it, and `dragging` marks a gesture in progress.
  const held = useRef(props.value);
  const dragging = useRef(false);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    handle.current = host.components.mountRangeSlider(el, {
      min: props.min,
      max: props.max,
      step: props.step,
      integer: props.integer,
      value: props.value,
      label: props.label,
      hint: props.hint,
      format: props.suffix ? { suffix: props.suffix } : undefined,
      disabled: props.disabled,
      onCommit: (value) => {
        dragging.current = false;
        held.current = value;
        callbacks.current.onCommit(value);
      },
      onDragValue: (value) => {
        dragging.current = value !== null;
        callbacks.current.onDrag?.(value);
      },
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    handle.current?.update({ disabled: props.disabled, min: props.min, max: props.max, label: props.label, hint: props.hint });
  }, [props.disabled, props.min, props.max, props.label, props.hint]);
  // Outside a gesture the knob shows `value`: the parent may not take a committed position (a
  // cancelled preview, a refused change), so any render puts it back.
  useEffect(() => {
    if (dragging.current || held.current === props.value) return;
    held.current = props.value;
    handle.current?.update({ value: props.value });
  });
  return <div ref={slot} class="lre-host-slot" />;
}

export function HostSwitch(props: { checked: boolean; label: string; disabled?: boolean; onChange(checked: boolean): void }) {
  const { host } = useApp();
  const slot = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const handle = useRef<{ update(patch: Record<string, unknown>): void; destroy(): void } | null>(null);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    handle.current = host.components.mountSwitch(el, { checked: props.checked, ariaLabel: props.label, disabled: props.disabled, onChange: (checked) => callbacks.current.onChange(checked) });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    handle.current?.update({ checked: props.checked, disabled: props.disabled });
  }, [props.checked, props.disabled]);
  return (
    <label class="lre-row">
      <span class="k">{props.label}</span>
      <span ref={slot} />
    </label>
  );
}

/**
 * A labelled number with named − and + buttons (40 px targets) and a typed value committed on blur
 * or Enter. Ours rather than the host's stepper, whose arrows are 21×13 px and have no names.
 */
export function NumberStepper(props: { value: number | null; min?: number; max?: number; step?: number; integer?: boolean; label: string; disabled?: boolean; onChange(value: number): void }) {
  const id = useId();
  const shown = props.value === null ? "" : String(props.value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const step = props.step ?? 1;
  const current = props.value ?? props.min ?? 0;
  const commit = (raw: number) => {
    const rounded = props.integer ? Math.round(raw) : Number(raw.toFixed(6));
    const next = Math.min(props.max ?? Number.POSITIVE_INFINITY, Math.max(props.min ?? Number.NEGATIVE_INFINITY, rounded));
    setText(String(next));
    if (next !== props.value) props.onChange(next);
  };
  return (
    <div class="lre-row">
      <label class="k" for={id}>
        {props.label}
      </label>
      <span class="lre-stepper" role="group" aria-label={props.label}>
        <button type="button" class="lre-btn" aria-label={`Decrease ${props.label}`} disabled={props.disabled || (props.min !== undefined && current <= props.min)} onClick={() => commit(current - step)}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          class="lre-input"
          inputMode={props.integer ? "numeric" : "decimal"}
          value={text}
          disabled={props.disabled}
          onInput={(event) => setText(event.currentTarget.value)}
          onBlur={() => {
            const parsed = Number(text);
            if (text.trim() !== "" && Number.isFinite(parsed)) commit(parsed);
            else setText(shown);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button type="button" class="lre-btn" aria-label={`Increase ${props.label}`} disabled={props.disabled || (props.max !== undefined && current >= props.max)} onClick={() => commit(current + step)}>
          <span aria-hidden="true">+</span>
        </button>
      </span>
    </div>
  );
}

export function HostSelect(props: { value: string; options: readonly { value: string; label: string; sublabel?: string }[]; placeholder?: string; label: string; disabled?: boolean; onChange(value: string): void }) {
  const { host } = useApp();
  const slot = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const handle = useRef<{ update(patch: Record<string, unknown>): void; destroy(): void } | null>(null);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    handle.current = host.components.mountSelect(el, {
      value: props.value,
      options: props.options.map((option) => ({ ...option })),
      placeholder: props.placeholder,
      // `ariaLabel` names the trigger; `triggerLabel` would replace the picked value's text on the host.
      ariaLabel: props.label,
      disabled: props.disabled,
      onChange: (value) => callbacks.current.onChange(value),
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    handle.current?.update({ value: props.value, options: props.options.map((option) => ({ ...option })), disabled: props.disabled });
  }, [props.value, props.options, props.disabled]);
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div ref={slot} class="lre-host-slot" />
    </div>
  );
}

export function HostModelPicker(props: { connectionId: string; value: string; label: string; onChange(model: string): void }) {
  const { host } = useApp();
  const slot = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const handle = host.components.mountModelCombobox(el, {
      value: props.value,
      connection: { kind: "llm", id: props.connectionId },
      onChange: (model) => callbacks.current.onChange(model),
    });
    return () => handle.destroy();
  }, [props.connectionId]);
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div ref={slot} class="lre-host-slot" role="group" aria-label={props.label} />
    </div>
  );
}
