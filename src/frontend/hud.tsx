// The HUD (DESIGN §12; contract §4.8, D-UI3). On a phone, the status line docked above the message
// input (`chat_composer_above`): time · place · cash, the engine working or paused, and Act; tapping it
// opens the World sheet. On wider screens, and on a phone whose host has no such mount, the floating
// pill in a chromeless float widget the player docks anywhere (host drag, edge snap, persisted
// geometry); below 760 px it collapses to the time, and a tap opens its details. The World sheet and
// the pill's details share one content: time, place, scene, weather and cash with ✎ fixes, this
// turn's calls, the clock toggle, Map and Actions.

import { useEffect, useRef, useState } from "preact/hooks";
import type { FixTarget, HudView, StateView } from "../shared/state-view";
import { useApp, useView } from "./app";
import { Badge, Button, Empty, IconButton, List, ListRow, useBusy } from "./components";
import { FixEditor } from "./fix-editor";
import { formatCents, formatMinutes, humanize } from "./format";
import { Icon } from "./icons";
import { hudMode, isMobile } from "./layout";
import { timeMarker } from "./requests";
import { useSelect } from "./store";

type FixKey = "place" | "weather" | "cash" | "scene";

const FIX_LABEL: Record<FixKey, string> = { place: "Place", weather: "Weather", cash: "Cash", scene: "Scene type" };

export function cashText(cash: HudView["cash"]): string | null {
  if (!cash) return null;
  return "cents" in cash ? formatCents(cash.cents) : cash.band;
}

/** The clock as it reads: the time, and the scale when it isn't 1×. A paused clock shows beside it, as an icon and in words. */
export function clockText(hud: HudView): string {
  return hud.clock.scale !== 1 ? `${hud.clock.label} ${hud.clock.scale}×` : hud.clock.label;
}

export interface HudSize {
  width: number;
  height: number;
}

export function Hud(props: { resize(size: HudSize): void }) {
  const app = useApp();
  const view = useView();
  const viewport = useSelect(app.host.viewport, (vp) => vp);
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  /** What opens once the details have made way for it (Map or Actions), with the pill as its opener. */
  const then = useRef<(() => void) | null>(null);
  const hud = view?.hud ?? null;
  const mode = hudMode(viewport);

  useEffect(() => {
    const target = open ? pop.current : pill.current;
    if (!target) return;
    const measure = () => {
      const width = open ? Math.min(360, viewport.width - 24) : Math.ceil(target.scrollWidth) + 2;
      const height = open ? Math.min(Math.ceil(target.scrollHeight) + 2, viewport.height - 80) : 44;
      props.resize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, mode, viewport.width, viewport.height, hud]);

  // Closing the details hands focus back to the pill instead of dropping it on the page. When they
  // closed for Map or Actions, that opens now, from the pill, so closing it returns focus there.
  useEffect(() => {
    if (open || !(refocus.current || then.current)) return;
    refocus.current = false;
    pill.current?.querySelector("button")?.focus();
    const next = then.current;
    then.current = null;
    next?.();
  }, [open]);

  if (!view || !hud || view.status === "not_world") return null;
  if (open)
    return (
      <HudDetails
        view={view}
        hud={hud}
        popRef={pop}
        onClose={() => {
          refocus.current = true;
          setOpen(false);
        }}
        onLeave={(next) => {
          then.current = next;
          setOpen(false);
        }}
      />
    );
  const cash = cashText(hud.cash);
  const show = () => setOpen(true);
  return (
    <div ref={pill} class="lre-hud" data-lre-hud={mode} role="toolbar" aria-label="World status">
      <button type="button" aria-haspopup="dialog" onClick={show} aria-label={`Time ${clockText(hud)}${hud.clock.paused ? ", clock paused" : ""}`}>
        <Icon name={hud.clock.paused ? "pause" : "clock"} size={16} />
        <span class="lre-num">{clockText(hud)}</span>
      </button>
      {mode === "full" ? (
        <>
          {hud.place ? (
            <>
              <span class="sep" />
              <button type="button" aria-haspopup="dialog" onClick={show}>
                <Icon name="pin" size={16} />
                {hud.place.name}
              </button>
            </>
          ) : null}
          {hud.weather ? (
            <>
              <span class="sep" />
              <button type="button" aria-haspopup="dialog" aria-label={`Weather ${hud.weather}`} onClick={show}>
                <Icon name="cloud" size={16} />
                {hud.weather}
              </button>
            </>
          ) : null}
          {cash ? (
            <>
              <span class="sep" />
              <button type="button" class="lre-num" aria-haspopup="dialog" aria-label={`Cash ${cash}`} onClick={show}>
                <Icon name="wallet" size={16} />
                {cash}
              </button>
            </>
          ) : null}
          {Object.keys(hud.fixes).length > 0 ? (
            <button type="button" aria-haspopup="dialog" aria-label="Fix a value" title="Fix a value" onClick={show}>
              <Icon name="edit" size={16} />
            </button>
          ) : null}
        </>
      ) : (
        <button type="button" aria-haspopup="dialog" aria-label="Show place, weather and cash" title="Show place, weather and cash" onClick={show}>
          <Icon name="chevron-down" size={16} />
        </button>
      )}
      {view.status === "in_flight" ? <span class="lre-chat-pulse" role="img" aria-label="A turn is in progress" title="A turn is in progress" /> : null}
      {view.status === "paused" ? <Badge tone="warn">Paused</Badge> : null}
    </div>
  );
}

function HudDetails(props: { view: StateView; hud: HudView; popRef: { current: HTMLDivElement | null }; onClose(): void; onLeave(next: () => void): void }) {
  // The pill that opened this is gone: take focus so Escape and the tab order reach the details.
  useEffect(() => props.popRef.current?.focus(), []);
  return (
    <div
      ref={props.popRef}
      class="lre-hud-pop"
      data-lre-hud="details"
      role="dialog"
      aria-label="World details"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div class="lre-chat-pophead">
        <Icon name="globe" />
        <strong class="lre-chat-poptitle">World</strong>
        <IconButton icon="close" label="Close world details" onClick={props.onClose} />
      </div>
      <WorldDetails view={props.view} hud={props.hud} onLeave={props.onLeave} />
    </div>
  );
}

/**
 * The world's details (contract §4.8), the World sheet's and the pill pop-over's content: time and
 * day part, place, scene and last turn, weather and cash, each with a ✎ fix where the view offers
 * one; this turn's calls; the clock toggle, Map and Actions. A fix swaps the list for its editor.
 * `onLeave` runs as Map or Actions opens: a host the overlay controller doesn't replace (the pill's
 * pop-over) makes way first, then runs the opening.
 */
function WorldDetails(props: { view: StateView; hud: HudView; onLeave(next: () => void): void }) {
  const app = useApp();
  const { view, hud } = props;
  const [fixing, setFixing] = useState<FixKey | null>(null);
  const [busy, run] = useBusy();
  const root = useRef<HTMLDivElement>(null);
  // The field whose fix is open: closing it hands focus back to that field's ✎.
  const opened = useRef<FixKey | null>(null);
  useEffect(() => {
    const key = opened.current;
    if (fixing !== null || key === null) return;
    opened.current = null;
    root.current?.querySelector<HTMLElement>(`button[aria-label="Fix ${FIX_LABEL[key].toLowerCase()}"]`)?.focus();
  }, [fixing]);
  const fixes: Partial<Record<FixKey, FixTarget>> = hud.fixes;
  const target = fixing ? fixes[fixing] : undefined;
  if (fixing && target) return <FixEditor label={FIX_LABEL[fixing]} target={target} onDone={() => setFixing(null)} />;
  const fix = (key: FixKey) =>
    fixes[key] ? (
      <IconButton
        icon="edit"
        label={`Fix ${FIX_LABEL[key].toLowerCase()}`}
        onClick={() => {
          opened.current = key;
          setFixing(key);
        }}
      />
    ) : undefined;
  const turn = view.meter?.turn;
  const paused = hud.clock.paused;
  return (
    <div ref={root} class="lre-chat-world" data-lre-world>
      <div class="lre-chat-worldlist">
        <List>
          <ListRow icon={paused ? "pause" : "clock"} title={<span class="lre-num">{clockText(hud)}</span>} subtitle={paused ? `${hud.clock.dayPart} · clock paused` : hud.clock.dayPart} />
          <ListRow icon="pin" title={hud.place?.name ?? "—"} subtitle="Place" value={fix("place")} />
          {view.scene ? <ListRow icon="layers" title={humanize(view.scene.sceneType)} subtitle={view.scene.elapsed > 0 ? `Scene · last turn ${formatMinutes(view.scene.elapsed)}` : "Scene"} value={fix("scene")} /> : null}
          <ListRow icon="cloud" title={hud.weather ?? "—"} subtitle="Weather" value={fix("weather")} />
          <ListRow icon="wallet" title={<span class="lre-num">{cashText(hud.cash) ?? "—"}</span>} subtitle="Cash" value={fix("cash")} />
          {turn ? (
            <ListRow
              icon="pulse"
              title={`${turn.calls} call${turn.calls === 1 ? "" : "s"} · ${(turn.ms / 1000).toFixed(1)} s`}
              subtitle={`This turn · ${turn.tokens} tokens${turn.lookups > 0 ? ` · ${turn.lookups} lore lookup${turn.lookups === 1 ? "" : "s"}` : ""}`}
            />
          ) : null}
        </List>
      </div>
      <div class="lre-chat-worldactions">
        <Button
          icon={paused ? "play" : "pause"}
          busy={busy}
          onClick={() =>
            run(async () => {
              await app.request(timeMarker(view.chatId, "pause", { all: true }, !paused));
            })
          }
        >
          {paused ? "Resume clock" : "Pause clock"}
        </Button>
        {view.panels["space.map"] !== undefined ? (
          <Button icon="map" onClick={() => props.onLeave(() => void app.overlays.openMap())}>
            Map
          </Button>
        ) : null}
        <Button variant="primary" icon="bolt" onClick={() => props.onLeave(() => void app.overlays.openPalette("actions"))}>
          Actions
        </Button>
      </div>
    </div>
  );
}

/**
 * The World sheet (contract §4.8): a bottom sheet over the chat with the world's details. It reports
 * the height that shows its content without scrolling, so the sheet hugs it as a fix opens and closes.
 */
export function WorldSheet(props: { desk: boolean; onClose(): void; onHeight(height: number): void }) {
  const view = useView();
  const sheet = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hud = view?.hud ?? null;
  useEffect(() => {
    const el = sheet.current;
    const inner = content.current;
    const body = inner?.parentElement;
    if (!el || !inner || !body) return;
    const measure = () => {
      const pad = getComputedStyle(body);
      // The header and borders (all but the body's inner box), plus the body's padding around its content.
      props.onHeight(Math.ceil(el.offsetHeight - body.clientHeight + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom) + inner.offsetHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={sheet}
      class={props.desk ? "lre lre-sheet desk" : "lre lre-sheet"}
      data-lre-sheet="world"
      role="dialog"
      aria-label="World"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <header>
        <Icon name="globe" />
        <h2 class="title">World</h2>
        <IconButton icon="close" label="Close world details" onClick={props.onClose} />
      </header>
      <div class="body">
        <div ref={content} class="lre-chat-sheetcontent">
          {!view || !hud || view.status === "not_world" ? (
            <Empty icon="globe" title="Not a world chat">
              Open a world chat to see where you are.
            </Empty>
          ) : (
            <WorldDetails view={view} hud={hud} onLeave={(next) => next()} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The phone's status line (D-UI3), docked above the message input: time · place · cash, the engine
 * working or paused, and Act for the action sheet. Tapping the line opens the World sheet. It shows
 * in world chats on mobile only; on wider screens the floating pill does this job.
 */
export function StatusLine() {
  const app = useApp();
  const view = useView();
  const mobile = useSelect(app.host.viewport, (vp) => isMobile(vp));
  const hud = view?.hud ?? null;
  if (!mobile || !view || !hud || view.status === "not_world") return null;
  const cash = cashText(hud.cash);
  const said = [clockText(hud), hud.clock.paused ? "clock paused" : null, hud.place?.name ?? null, cash, view.status === "paused" ? "paused" : view.status === "in_flight" ? "a turn is in progress" : null].filter((part) => part !== null);
  return (
    <div class="lre-chat-status" data-lre-status role="group" aria-label="World status">
      <button type="button" class="lre-chat-status-line" aria-haspopup="dialog" aria-label={`World details: ${said.join(", ")}`} onClick={() => void app.overlays.openWorld()}>
        <Icon name={hud.clock.paused ? "pause" : "clock"} size={16} />
        <span class="lre-chat-status-text">
          <span class="lre-num">{clockText(hud)}</span>
          {hud.place ? (
            <>
              <span class="lre-chat-dot" aria-hidden="true">
                ·
              </span>
              <span class="lre-chat-status-place">{hud.place.name}</span>
            </>
          ) : null}
          {cash ? (
            <>
              <span class="lre-chat-dot" aria-hidden="true">
                ·
              </span>
              <span class="lre-num">{cash}</span>
            </>
          ) : null}
        </span>
        {view.status === "in_flight" ? <span class="lre-chat-pulse" role="img" aria-label="A turn is in progress" title="A turn is in progress" /> : null}
        {view.status === "paused" ? <Badge tone="warn">Paused</Badge> : null}
      </button>
      <Button variant="primary" size="sm" icon="bolt" title="Actions" onClick={() => void app.overlays.openPalette("actions")}>
        Act
      </Button>
    </div>
  );
}
