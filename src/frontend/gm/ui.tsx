// GM mode's own building blocks on the shared atoms: a page opened over a section's list (as Play
// opens sheets), rows that carry their own actions (✎, remove, add or take), titled cards for
// tracks and people's money, and the way to Build for what belongs to the world.

import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../app";
import { Button, IdText, PageHeader } from "../components";

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

/** Kinds, places and tracks are the world's definitions; GM mode edits this chat, Build edits the world. */
export function BuildLink() {
  const app = useApp();
  return (
    <Button variant="ghost" icon="hammer" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build" }))}>
      Kinds and places are the world's: edit them in Build
    </Button>
  );
}
