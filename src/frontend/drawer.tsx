// The drawer tab "LumiRPEngine": a sticky mode bar (Play · GM · Build · Settings, and Harness while
// the open chat plays on the harness: `harness/mode.ts`) over the chosen mode. GM mode wears the GM
// frame (`data-lre-mode="gm"`: a rule at the top and a faint tint). Content keeps clear of the host's
// chat heads only while they overlap the drawer, by as much as they do. The drawer publishes three
// measures for the modes' sticky parts: `--lre-modebar-h`, the mode bar's height (bars that stick
// under it); `--lre-stick-top`, the top that keeps a sticky bar at the very top of the host's
// scrolling panel (a sticky top keeps clear of the panel's padding, and what scrolls through that
// padding would show above the bar); and `--lre-fill-h`, the height the panel shows (the drawer
// fills it, so a bottom bar sits at the drawer's bottom). `ModeBar` and `ModeBody` are hook-free, so
// tests walk them without a DOM.

import type { ComponentChildren, Ref } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import type { Mode } from "./app";
import { useApp, useUi } from "./app";
import { IdsSurface } from "./components";
import { Build } from "./build/build";
import { headGutters, watchChatHeads } from "./chat-heads";
import { ActivityBanner } from "./diagnostics";
import { UpdateNotice } from "./agents";
import { GmMode } from "./gm/mode";
import { HARNESS_MODE, harnessChat, harnessOffered, shownMode } from "./harness/mode";
import { type HarnessPages, HarnessReach, HarnessTab, useWaiting } from "./harness/pages";
import type { IconName } from "./icons";
import { Icon } from "./icons";
import type { Rect } from "./layout";
import { Play } from "./play/play";
import { scrollParent } from "./scroll";
import { Settings } from "./settings/settings";
import { AcceptanceBanner } from "./settings/agents";
import { useSelect } from "./store";

/** A mode as the bar shows it. */
export interface ModeEntry {
  id: Mode;
  label: string;
  icon: IconName;
}

const MODES: readonly ModeEntry[] = [
  { id: "play", label: "Play", icon: "dice" },
  { id: "gm", label: "GM", icon: "eye" },
  { id: "build", label: "Build", icon: "hammer" },
  { id: "settings", label: "Settings", icon: "gear" },
];

/** The modes the bar offers, in order: the harness's tab last, and only where it is offered (`harnessOffered`). */
export function drawerModes(harness: boolean): readonly ModeEntry[] {
  return harness ? [...MODES, HARNESS_MODE] : MODES;
}

/**
 * The mode bar, without hooks: a tab for each mode offered, the one shown selected. `waiting`: how
 * many things of the harness's wait for the user, marked on its tab so they are found from any mode.
 */
export function ModeBar(props: { modes: readonly ModeEntry[]; mode: Mode; bodyId: string; waiting: number; listRef?: Ref<HTMLDivElement>; onSelect(mode: Mode): void; onKeyDown?(event: KeyboardEvent, index: number): void }) {
  const onKeyDown = props.onKeyDown;
  return (
    <div ref={props.listRef} class="lre-modeseg" role="tablist" aria-label="LumiRPEngine modes" data-lre-modes={props.modes.length}>
      {props.modes.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          id={`${props.bodyId}-tab-${entry.id}`}
          data-mode={entry.id}
          aria-selected={entry.id === props.mode}
          aria-controls={entry.id === props.mode ? props.bodyId : undefined}
          tabIndex={entry.id === props.mode ? 0 : -1}
          onClick={() => props.onSelect(entry.id)}
          onKeyDown={onKeyDown ? (event) => onKeyDown(event, index) : undefined}
        >
          <Icon name={entry.icon} />
          <span>{entry.label}</span>
          {entry.id === HARNESS_MODE.id && props.waiting > 0 ? <span class="lre-dot" role="img" aria-label={props.waiting === 1 ? "1 thing needs you" : `${props.waiting} things need you`} /> : null}
        </button>
      ))}
    </div>
  );
}

/** The body of the mode shown, without hooks. `harness`: the Harness tab, which the drawer makes where it has the harness's pages. */
export function ModeBody(props: { mode: Mode; harness?: ComponentChildren }) {
  switch (props.mode) {
    case "play":
      return <Play />;
    case "gm":
    case "build":
      // Show ids applies in Build and GM only: in Play an id can name what its label hides.
      return <IdsSurface.Provider value={true}>{props.mode === "gm" ? <GmMode /> : <Build />}</IdsSurface.Provider>;
    case "settings":
      return <Settings />;
    case "harness":
      return <>{props.harness}</>;
  }
}

export function Drawer(props: { measure(el: Element): Rect; harness?: HarnessPages }) {
  const app = useApp();
  const chosen = useUi((ui) => ui.mode);
  const pages = props.harness ?? null;
  const harness = useSelect(app.sync, harnessChat);
  const offered = pages !== null && harnessOffered(harness, chosen);
  // The harness's tab shows only for a chat on the harness: chosen for one and left open, it gives way to Play at once.
  const mode = shownMode(chosen, offered);
  const modes = drawerModes(offered);
  const waiting = useWaiting(pages);
  // Play is then where the drawer is: a later chat on the harness offers the tab again, and doesn't open it by itself.
  useEffect(() => {
    if (chosen === HARNESS_MODE.id && !offered) app.ui.update((ui) => (ui.mode === HARNESS_MODE.id ? { ...ui, mode: "play" } : ui));
  }, [chosen, offered]);
  const open = useSelect(app.host.drawer, (drawer) => drawer.open);
  const root = useRef<HTMLDivElement>(null);
  const modebar = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  /** The chat heads as last measured; none while the drawer is closed. */
  const heads = useRef<readonly Rect[]>([]);
  /** Re-measures the gutters and the published heights. */
  const relayout = useRef<() => void>(() => {});
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // A percentage min-height can't fill the host's panel: our root's height is its content's. The
    // panel that scrolls us is found again once the host moves the tab elsewhere.
    let scroller: HTMLElement | null = null;
    const observer = new ResizeObserver(() => apply());
    const apply = () => {
      const gutters = headGutters(props.measure(el), heads.current);
      el.style.setProperty("--lre-gutter-l", `${gutters.left}px`);
      el.style.setProperty("--lre-gutter-r", `${gutters.right}px`);
      if (modebar.current) el.style.setProperty("--lre-modebar-h", `${modebar.current.offsetHeight}px`);
      if (!scroller?.contains(el)) {
        if (scroller) observer.unobserve(scroller);
        scroller = scrollParent(el);
        if (scroller) observer.observe(scroller);
      }
      if (scroller) {
        const style = getComputedStyle(scroller);
        const top = parseFloat(style.paddingTop) || 0;
        const fill = scroller.clientHeight - top - (parseFloat(style.paddingBottom) || 0);
        el.style.setProperty("--lre-stick-top", `${-top}px`);
        el.style.setProperty("--lre-fill-h", `${Math.max(0, Math.floor(fill))}px`);
      }
    };
    relayout.current = apply;
    apply();
    observer.observe(el);
    if (modebar.current) observer.observe(modebar.current);
    // The host slides the drawer in with a transform, which no ResizeObserver sees: re-measure when it settles.
    document.addEventListener("transitionend", apply, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("transitionend", apply, true);
    };
  }, []);
  // The heads are watched only while the drawer is open: the watcher observes the whole page, and a
  // closed drawer has nothing to keep clear of them.
  useEffect(() => {
    if (!open) return;
    const watch = watchChatHeads(props.measure);
    const sync = () => {
      heads.current = watch.get();
      relayout.current();
    };
    sync();
    const off = watch.subscribe(sync);
    return () => {
      off();
      watch.dispose();
      heads.current = [];
    };
  }, [open]);
  const select = (next: Mode) => app.ui.update((ui) => ({ ...ui, mode: next }));
  // WAI-ARIA tabs: Left/Right/Home/End move between modes and focus the new one.
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = modes.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const target = modes[next];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={root} class="lre lre-drawer" data-lre-panel="drawer" data-lre-mode={mode}>
      <div ref={modebar} class="lre-modebar">
        <ModeBar modes={modes} mode={mode} bodyId={bodyId} waiting={waiting} listRef={bar} onSelect={select} onKeyDown={onKeyDown} />
      </div>
      <ActivityBanner />
      <UpdateNotice />
      <AcceptanceBanner />
      <div class="lre-mode-body" id={bodyId} role="tabpanel" aria-labelledby={`${bodyId}-tab-${mode}`}>
        {/* The runtime's connections as LumiAH's pages know them, for the pages that offer or name one (the Harness tab's Cast, Settings → Story → Models, Play). */}
        <HarnessReach pages={pages}>
          <ModeBody mode={mode} harness={pages !== null ? <HarnessTab pages={pages} /> : null} />
        </HarnessReach>
      </div>
    </div>
  );
}
