// The HUD pill (DESIGN §12): time (⏸ when paused, the scale when not 1×), place, weather and cash,
// in a chromeless float widget the player docks anywhere (host drag, edge snap, persisted
// geometry). Below 760 px it collapses to the time; a tap opens the details with ✎ fixes, the
// clock toggle, the call meter and shortcuts.

import { useEffect, useRef, useState } from "preact/hooks";
import type { FixTarget, HudView, StateView } from "../shared/state-view";
import { useApp, useView } from "./app";
import { Row, useBusy } from "./components";
import { FixEditor } from "./fix-editor";
import { formatCents, formatMinutes, humanize } from "./format";
import { hudMode } from "./layout";
import { timeMarker } from "./requests";
import { useSelect } from "./store";

type FixKey = "place" | "weather" | "cash" | "scene";

const FIX_LABEL: Record<FixKey, string> = { place: "Place", weather: "Weather", cash: "Cash", scene: "Scene type" };

export function cashText(cash: HudView["cash"]): string | null {
  if (!cash) return null;
  return "cents" in cash ? formatCents(cash.cents) : cash.band;
}

export function clockText(hud: HudView): string {
  const scale = hud.clock.scale !== 1 ? ` ${hud.clock.scale}×` : "";
  return `${hud.clock.paused ? "⏸ " : ""}${hud.clock.label}${scale}`;
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
  const hud = view?.hud ?? null;
  const mode = hudMode(viewport);

  useEffect(() => {
    const target = open ? pop.current : pill.current;
    if (!target) return;
    const measure = () => {
      const width = open ? Math.min(340, viewport.width - 24) : Math.ceil(target.scrollWidth) + 2;
      const height = open ? Math.min(Math.ceil(target.scrollHeight) + 2, viewport.height - 80) : 44;
      props.resize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, mode, viewport.width, viewport.height, hud]);

  // Closing the details hands focus back to the pill instead of dropping it on the page.
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    pill.current?.querySelector("button")?.focus();
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
      />
    );
  const cash = cashText(hud.cash);
  return (
    <div ref={pill} class="lre-hud" data-lre-hud={mode} role="toolbar" aria-label="World status">
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} aria-label={`Time ${hud.clock.label}${hud.clock.paused ? ", clock paused" : ""}`}>
        <span aria-hidden="true">🕐</span> <span class="lre-num">{clockText(hud)}</span>
      </button>
      {mode === "full" ? (
        <>
          {hud.place ? <span class="sep" /> : null}
          {hud.place ? (
            <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <span aria-hidden="true">📍</span> {hud.place.name}
            </button>
          ) : null}
          {hud.weather ? <span class="sep" /> : null}
          {hud.weather ? (
            <button type="button" aria-haspopup="dialog" aria-label={`Weather ${hud.weather}`} onClick={() => setOpen(true)}>
              {hud.weather}
            </button>
          ) : null}
          {cash ? <span class="sep" /> : null}
          {cash ? (
            <button type="button" class="lre-num" aria-haspopup="dialog" aria-label={`Cash ${cash}`} onClick={() => setOpen(true)}>
              {cash}
            </button>
          ) : null}
          {Object.keys(hud.fixes).length > 0 ? (
            <button type="button" aria-haspopup="dialog" aria-label="Fix a value" onClick={() => setOpen(true)}>
              ✎
            </button>
          ) : null}
        </>
      ) : (
        <button type="button" aria-haspopup="dialog" aria-label="Show place, weather and cash" onClick={() => setOpen(true)}>
          ▾
        </button>
      )}
      {view.status === "in_flight" ? (
        <span class="lre-badge accent" role="img" aria-label="A turn is in progress" title="A turn is in progress">
          ⋯
        </span>
      ) : null}
      {view.status === "paused" ? <span class="lre-badge warn">Paused</span> : null}
    </div>
  );
}

function HudDetails(props: { view: StateView; hud: HudView; popRef: { current: HTMLDivElement | null }; onClose(): void }) {
  const app = useApp();
  const { view, hud } = props;
  const [fixing, setFixing] = useState<FixKey | null>(null);
  const [busy, run] = useBusy();
  const fixes: Partial<Record<FixKey, FixTarget>> = hud.fixes;
  const fixButton = (key: FixKey) =>
    fixes[key] ? (
      <button type="button" class="lre-btn small ghost" aria-label={`Fix ${FIX_LABEL[key]}`} onClick={() => setFixing(key)}>
        ✎
      </button>
    ) : null;
  const target = fixing ? fixes[fixing] : undefined;
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
      <div class="lre-spread">
        <strong>World</strong>
        <button type="button" class="lre-btn small ghost" aria-label="Close world details" onClick={props.onClose}>
          ✕
        </button>
      </div>
      {fixing && target ? (
        <FixEditor label={FIX_LABEL[fixing]} target={target} onDone={() => setFixing(null)} />
      ) : (
        <>
          <Row k="Time" sub={hud.clock.dayPart} v={<span class="lre-num">{clockText(hud)}</span>} />
          <Row k="Place" v={<span class="lre-inline">{hud.place?.name ?? "—"}{fixButton("place")}</span>} />
          {view.scene ? <Row k="Scene" sub={view.scene.elapsed > 0 ? `last turn ${formatMinutes(view.scene.elapsed)}` : undefined} v={<span class="lre-inline">{humanize(view.scene.sceneType)}{fixButton("scene")}</span>} /> : null}
          <Row k="Weather" v={<span class="lre-inline">{hud.weather ?? "—"}{fixButton("weather")}</span>} />
          <Row k="Cash" v={<span class="lre-inline lre-num">{cashText(hud.cash) ?? "—"}{fixButton("cash")}</span>} />
          {view.meter ? <Row k="This turn" v={`${view.meter.turn.calls} calls · ${(view.meter.turn.ms / 1000).toFixed(1)} s`} sub={`${view.meter.turn.tokens} tokens`} /> : null}
          <div class="lre-inline" style={{ marginTop: "8px" }}>
            <button
              type="button"
              class="lre-btn small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await app.request(timeMarker(view.chatId, "pause", { all: true }, !hud.clock.paused));
                })
              }
            >
              <span aria-hidden="true">{hud.clock.paused ? "▶" : "⏸"}</span> {hud.clock.paused ? "Resume clock" : "Pause clock"}
            </button>
            <button type="button" class="lre-btn small" onClick={() => void app.overlays.openMap()}>
              <span aria-hidden="true">🗺</span> Map
            </button>
            <button type="button" class="lre-btn small" onClick={() => void app.overlays.openPalette("actions")}>
              <span aria-hidden="true">⚡</span> Actions
            </button>
          </div>
        </>
      )}
    </div>
  );
}
