// The pages' small parts, on today's design tokens and classes (`src/frontend/styles/`), so the new
// pages look like the rest of RPE. None holds state: what is open and what is pressed belongs to the page.

import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./icons";

export type Tone = "accent" | "warn" | "neg" | "pos" | "gm";

export function Button(props: { children: ComponentChildren; onClick?: () => void; kind?: "primary" | "danger" | "ghost"; small?: boolean; disabled?: boolean; busy?: boolean; title?: string; current?: boolean }) {
  const classes = ["lre-btn", props.kind, props.small === true ? "small" : undefined].filter((c) => c !== undefined).join(" ");
  return (
    <button type="button" class={classes} onClick={props.onClick} disabled={props.disabled === true || props.busy === true} aria-busy={props.busy === true ? "true" : undefined} title={props.title} aria-current={props.current === true ? "page" : undefined}>
      {props.children}
    </button>
  );
}

export function Badge(props: { children: ComponentChildren; tone?: Tone; title?: string }) {
  return (
    <span class={props.tone === undefined ? "lre-badge" : `lre-badge ${props.tone}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function Banner(props: { tone: "info" | "warn" | "neg" | "gm"; icon: IconName; title: string; children?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class={`lre-banner ${props.tone}`} role={props.tone === "neg" ? "alert" : "status"}>
      <div class="lre-banner-main">
        <Icon name={props.icon} class="lre-banner-icon" />
        <div class="lre-banner-text">
          <span class="lre-banner-title">{props.title}</span>
          {props.children}
        </div>
      </div>
      {props.actions === undefined ? null : <div class="lre-banner-actions">{props.actions}</div>}
    </div>
  );
}

export function Section(props: { title: string; children: ComponentChildren; actions?: ComponentChildren; id?: string }) {
  return (
    <section class="lre-section" data-section={props.id}>
      <div class="lre-section-head">
        <h3 class="lre-section-title">{props.title}</h3>
        {props.actions}
      </div>
      <div class="lre-section-body">{props.children}</div>
    </section>
  );
}

/** A fold: its summary always shows, its body on a tap. `open` is where it starts. */
export function Fold(props: { summary: ComponentChildren; children: ComponentChildren; open?: boolean; class?: string }) {
  return (
    <details class={props.class === undefined ? "lre-disclosure" : `lre-disclosure ${props.class}`} open={props.open === true}>
      <summary>
        <span class="lre-disclosure-label">{props.summary}</span>
        <Icon name="chevron-down" size={16} />
      </summary>
      <div class="lre-disclosure-body">{props.children}</div>
    </details>
  );
}

export function Empty(props: { icon: IconName; title: string; children?: ComponentChildren }) {
  return (
    <div class="lre-empty">
      <span class="lre-empty-icon">
        <Icon name={props.icon} />
      </span>
      <span class="lre-empty-title">{props.title}</span>
      {props.children}
    </div>
  );
}

/** A label and its value on one line. */
export function Row(props: { label: ComponentChildren; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="lre-row">
      <span class="k">
        {props.label}
        {props.sub === undefined ? null : <span class="sub">{props.sub}</span>}
      </span>
      <span class="v">{props.value}</span>
    </div>
  );
}

export function PageHeader(props: { title: string; sub?: ComponentChildren; back?: { label: string; go: () => void }; actions?: ComponentChildren }) {
  return (
    <div class="lre-page-header">
      {props.back === undefined ? null : (
        <button type="button" class="lre-iconbtn" onClick={props.back.go} aria-label={props.back.label} title={props.back.label}>
          <Icon name="chevron-left" />
        </button>
      )}
      <div class="lre-page-titles">
        <h2 class="lre-page-title">{props.title}</h2>
        {props.sub === undefined ? null : <div class="lre-page-sub">{props.sub}</div>}
      </div>
      {props.actions === undefined ? null : <div class="lre-page-actions">{props.actions}</div>}
    </div>
  );
}

/** Text as it was written, line breaks kept, in the page's monospace when it is data. */
export function Pre(props: { text: string; mono?: boolean; live?: boolean }) {
  const classes = ["rpe-pre", props.mono === false ? "prose" : undefined, props.live === true ? "rpe-stream" : undefined].filter((c) => c !== undefined).join(" ");
  return <pre class={classes}>{props.text}</pre>;
}

/**
 * What sits behind the spoiler gate (gate.ts): while it is shut, a notice and the one button that opens
 * it, and nothing of what it holds; once open, what it holds, and a way to shut it again. `why` says what
 * it hides could give away; the Turn and Live pages' sentence when absent.
 */
export function Gated(props: { open: boolean; onOpen: () => void; onClose: () => void; why?: string; children: ComponentChildren }) {
  if (!props.open) {
    return (
      <div data-gate="shut">
        <Banner tone="gm" icon="eye-off" title="Spoilers are hidden" actions={<Button onClick={props.onOpen}>Show them for this chat</Button>}>
          <span>{props.why ?? "The intent record and what the agents planned and did can give away what comes next."}</span>
        </Banner>
      </div>
    );
  }
  return (
    <div class="lre-stack" data-gate="open">
      <div class="lre-spread rpe-gatebar">
        <Badge tone="gm">Spoilers shown for this chat</Badge>
        <Button small kind="ghost" onClick={props.onClose}>
          Hide them
        </Button>
      </div>
      {props.children}
    </div>
  );
}
