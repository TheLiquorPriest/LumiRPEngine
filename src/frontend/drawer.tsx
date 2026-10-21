// The drawer tab "LumiRPEngine": a sticky mode bar (Play · GM · Build · Settings)
// over the chosen mode. GM mode wears the GM frame (`data-lre-mode="gm"`: a rule at the top and a
// faint tint). Content keeps clear of the host's chat heads only while they overlap the drawer, by as
// much as they do. The drawer publishes two measures for the modes' sticky parts:
// `--lre-modebar-h`, the mode bar's height (bars that stick under it), and `--lre-fill-h`, the height
// the host's scrolling panel shows (the drawer fills it, so a bottom bar sits at the drawer's bottom).

import { useEffect, useId, useRef } from "preact/hooks";
import type { Mode } from "./app";
import { useApp, useUi } from "./app";
import { IdsSurface } from "./components";
import { Build } from "./build/build";
import { headGutters, watchChatHeads } from "./chat-heads";
import { ActivityBanner } from "./diagnostics";
import { UpdateNotice } from "./agents";
import { GmMode } from "./gm/mode";
import type { IconName } from "./icons";
import { Icon } from "./icons";
import type { Rect } from "./layout";
import { Play } from "./play/play";
import { scrollParent } from "./scroll";
import { Settings } from "./settings/settings";
import { useSelect } from "./store";

const MODES: readonly { id: Mode; label: string; icon: IconName }[] = [
  { id: "play", label: "Play", icon: "dice" },
  { id: "gm", label: "GM", icon: "eye" },
  { id: "build", label: "Build", icon: "hammer" },
  { id: "settings", label: "Settings", icon: "gear" },
];

export function Drawer(props: { measure(el: Element): Rect }) {
  const app = useApp();
  const mode = useUi((ui) => ui.mode);
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
        const fill = scroller.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
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
    const last = MODES.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const target = MODES[next];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={root} class="lre lre-drawer" data-lre-panel="drawer" data-lre-mode={mode}>
      <div ref={modebar} class="lre-modebar">
        <div ref={bar} class="lre-modeseg" role="tablist" aria-label="LumiRPEngine modes">
          {MODES.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`${bodyId}-tab-${entry.id}`}
              data-mode={entry.id}
              aria-selected={entry.id === mode}
              aria-controls={entry.id === mode ? bodyId : undefined}
              tabIndex={entry.id === mode ? 0 : -1}
              onClick={() => select(entry.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      </div>
      <ActivityBanner />
      <UpdateNotice />
      <div class="lre-mode-body" id={bodyId} role="tabpanel" aria-labelledby={`${bodyId}-tab-${mode}`}>
        {mode === "play" ? (
          <Play />
        ) : mode === "gm" || mode === "build" ? (
          // Show ids applies in Build and GM only: in Play an id can name what its label hides.
          <IdsSurface.Provider value={true}>{mode === "gm" ? <GmMode /> : <Build />}</IdsSurface.Provider>
        ) : (
          <Settings />
        )}
      </div>
    </div>
  );
}
