// GM mode's own building blocks on the shared atoms: a page opened over a section's list (as Play
// opens sheets), rows that carry their own actions (✎, remove, add or take), titled cards for
// tracks and people's money, the notice an edit leaves with its Undo, and the way to Build for what
// belongs to the world.

import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useUi } from "../app";
import { focusTaken, gmOpen } from "./gate";
import type { EditNotice } from "./editor";
import { Button, IconButton, IdText, PageHeader } from "../components";
import { Icon } from "../icons";

export interface Pages<T> {
  /** The page over the list, or null for the list itself. */
  page: T | null;
  open(page: T): void;
  back(): void;
  /** For the element holding the list and its page: focus moves within it, and Escape there goes back. */
  host: { ref: RefObject<HTMLDivElement | null>; onKeyDown(event: KeyboardEvent): void };
}

/**
 * One page at a time over a list. The list stays mounted, hidden, under the page,
 * so Back or Escape returns focus to the row that opened it; opening moves focus to the page's Back.
 */
export function usePages<T>(): Pages<T> {
  const [page, setPage] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = page !== null;
  const shown = useRef(open);
  useEffect(() => {
    if (open === shown.current) return;
    shown.current = open;
    if (open) {
      ref.current?.querySelector<HTMLElement>(":scope > .lre-gm-page .lre-page-header button")?.focus();
      return;
    }
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, [open]);
  return {
    page,
    open: (next) => {
      if (page === null) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPage(next);
    },
    back: () => setPage(null),
    host: {
      ref,
      onKeyDown: (event) => {
        if (event.key !== "Escape" || page === null || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        setPage(null);
      },
    },
  };
}

/**
 * Opens the character page a link from another GM page asked for (`gmOpen`) once the section
 * shows, then takes the ask, so going back and forth doesn't open it again.
 */
export function useGmFocus(open: (entity: string) => void): void {
  const app = useApp();
  const focus = useUi((ui) => ui.gm.focus);
  useEffect(() => {
    if (focus === undefined) return;
    open(focus);
    app.ui.update(focusTaken);
  }, [focus]);
}

/** A link from one of a character's GM pages (their mind, their routine) to their character sheet in World. */
export function SheetLink(props: { entity: string }) {
  const app = useApp();
  return (
    <Button size="sm" variant="secondary" icon="user" onClick={() => app.ui.update((ui) => gmOpen(ui, "world", props.entity))}>
      Character sheet
    </Button>
  );
}

/** A page over a section's list: a header with Back, then its content. */
export function GmPage(props: { name: string; title: ComponentChildren; subtitle?: ComponentChildren; backLabel: string; onBack(): void; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="lre-gm-page" data-lre-gm-page={props.name}>
      <PageHeader title={props.title} subtitle={props.subtitle} onBack={props.onBack} backLabel={props.backLabel} actions={props.actions} />
      {props.children}
    </div>
  );
}

/** Rows divided by hairlines, inside a card or a section. */
export function ActionRows(props: { label?: string; children: ComponentChildren }) {
  return (
    <div class="lre-gm-rows" role="list" aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** One row: a title with its note (and the id under Show ids), a value, and the row's own actions; `children` open under it (an inline editor). */
export function ActionRow(props: { title: ComponentChildren; subtitle?: ComponentChildren; id?: string; value?: ComponentChildren; tone?: "pos" | "neg" | "warn" | "muted"; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="lre-gm-row" role="listitem">
      <div class="lre-gm-row-main">
        <span class="lre-gm-row-text">
          <span class="lre-gm-row-title">{props.title}</span>
          {props.subtitle !== undefined ? <span class="lre-gm-row-sub">{props.subtitle}</span> : null}
          {props.id !== undefined ? <IdText id={props.id} /> : null}
        </span>
        {props.value !== undefined ? <span class={props.tone ? `lre-gm-row-value lre-${props.tone}` : "lre-gm-row-value"}>{props.value}</span> : null}
        {props.actions !== undefined ? <span class="lre-gm-row-actions">{props.actions}</span> : null}
      </div>
      {props.children}
    </div>
  );
}

/** A card titled by what it shows (a track, a person's money), with its badges beside the title; `name` marks it for finding (`data-lre-gm-card`). */
export function GmCard(props: { name?: string; title: ComponentChildren; subtitle?: ComponentChildren; id?: string; badges?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="lre-card lre-gm-card" data-lre-gm-card={props.name}>
      <div class="lre-gm-card-head">
        <div class="lre-gm-card-titles">
          <h3 class="lre-gm-card-title">{props.title}</h3>
          {props.subtitle !== undefined ? <span class="lre-gm-card-sub">{props.subtitle}</span> : null}
          {props.id !== undefined ? <IdText id={props.id} /> : null}
        </div>
        {props.badges !== undefined ? <span class="lre-gm-badges">{props.badges}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

/**
 * What the latest GM edit did, with its Undo, pinned over GM mode's tab bar until it is dismissed,
 * replaced or no longer undoable. Its height is published on GM mode (`--lre-gm-notice-h`) so a
 * list's selection bar pinned there sits above it.
 */
export function EditNoticeBar(props: { notice: EditNotice; busy: boolean; onUndo(): void; onDismiss(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const mode = el?.closest<HTMLElement>(".lre-gm");
    if (!el || !mode) return;
    const publish = () => mode.style.setProperty("--lre-gm-notice-h", `${el.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      mode.style.removeProperty("--lre-gm-notice-h");
    };
  }, []);
  return (
    <div ref={ref} class="lre-gm-notice" role="status" data-lre-gm-notice="">
      <Icon name="check" size={16} />
      <span class="lre-gm-notice-text">{props.notice.text}</span>
      {props.notice.undo.length > 0 ? (
        <Button size="sm" icon="undo" disabled={props.busy} onClick={props.onUndo}>
          Undo
        </Button>
      ) : null}
      <IconButton icon="close" label="Dismiss" onClick={props.onDismiss} />
    </div>
  );
}

/** Kinds, places and tracks are the world's definitions; GM mode edits this chat, Build edits the world. */
export function BuildLink() {
  const app = useApp();
  return (
    <Button variant="ghost" icon="hammer" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build" }))}>
      Kinds and places are the world's: edit them in Build
    </Button>
  );
}
