// Shared UI atoms. Host components (range slider, switch, number stepper, select, model picker)
// are mounted through `ctx.components` into a div Preact never renders children into; their
// latest callbacks are read through refs so the host mount is created once.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { OutcomeOdds } from "../shared/state-view";
import { useApp } from "./app";
import { formatOdds } from "./format";
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

export function Empty(props: { children: ComponentChildren }) {
  return <div class="lre-empty">{props.children}</div>;
}

const ODDS_COLORS = ["#7fe0a0", "#7c6cff", "#f2c46b", "#ff8a8a", "#6bc5f2", "#c58af2"];

/** Exact outcome odds as a stacked bar with a legend. */
export function OddsBar(props: { odds: readonly OutcomeOdds[] }) {
  return (
    <div>
      <div class="lre-odds" role="img" aria-label={props.odds.map((o) => `${o.outcome} ${formatOdds(o.p)}`).join(", ")}>
        {props.odds.map((o, i) => (
          <span key={o.outcome} style={{ width: `${Math.max(0, o.p) * 100}%`, background: ODDS_COLORS[i % ODDS_COLORS.length] }} />
        ))}
      </div>
      <div class="lre-odds-legend">
        {props.odds.map((o, i) => (
          <span key={o.outcome}>
            <i style={{ background: ODDS_COLORS[i % ODDS_COLORS.length] }} />
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

export type ToastSurface = "map" | "palette" | "drawer" | "chat";

/**
 * Toasts render on the topmost visible surface only: an open overlay, else the open drawer, else
 * the chat toolbar (inline, above the composer).
 */
export function Toasts(props: { surface: ToastSurface }) {
  const app = useApp();
  const list = useSelect(app.toasts, (all) => all);
  const overlay = useSelect(app.ui, (ui) => ui.overlay);
  const drawerOpen = useSelect(app.host.drawer, (drawer) => drawer.open);
  const active: ToastSurface = overlay ?? (drawerOpen ? "drawer" : "chat");
  if (list.length === 0 || active !== props.surface) return null;
  const toasts = app.toasts;
  return (
    <div class={props.surface === "chat" ? "lre lre-toasts inline" : "lre lre-toasts"} aria-live="polite" data-lre-toasts={props.surface}>
      {list.map((toast) => (
        <div key={toast.id} class={toast.tone === "error" ? "lre-toast error" : "lre-toast"} role={toast.tone === "error" ? "alert" : "status"}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button type="button" class="lre-btn ghost small" aria-label="Dismiss" onClick={() => toasts.update((all) => all.filter((entry) => entry.id !== toast.id))}>
            ✕
          </button>
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

// ---------------------------------------------------------------- host components

export function HostSlider(props: { min: number; max: number; step?: number; integer?: boolean; value: number; label?: string; hint?: string; suffix?: string; disabled?: boolean; onCommit(value: number): void; onDrag?(value: number | null): void }) {
  const { host } = useApp();
  const slot = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const handle = useRef<{ update(patch: Record<string, unknown>): void; destroy(): void } | null>(null);
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
      onCommit: (value) => callbacks.current.onCommit(value),
      onDragValue: (value) => callbacks.current.onDrag?.(value),
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    handle.current?.update({ value: props.value, disabled: props.disabled, min: props.min, max: props.max, label: props.label, hint: props.hint });
  }, [props.value, props.disabled, props.min, props.max, props.label, props.hint]);
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

export function HostSelect(props: { value: string; options: readonly { value: string; label: string; sublabel?: string }[]; placeholder?: string; label: string; onChange(value: string): void }) {
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
      triggerLabel: props.label,
      onChange: (value) => callbacks.current.onChange(value),
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    handle.current?.update({ value: props.value, options: props.options.map((option) => ({ ...option })) });
  }, [props.value, props.options]);
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
