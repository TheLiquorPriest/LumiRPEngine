// Play → Now, the hub, registered as the core Scene panel: the status banners; the
// scene card (time and day part, place, scene type with the last turn's elapsed time, weather, cash,
// each fixable value, the time among them, with its ✎); what needs you; the fight while one is on
// (Now's other panels); who is here; the packs' glances; the quick actions. Opening someone here
// pushes their person sheet, which observes them on opening (DESIGN §9.2); where no pack draws one,
// the row observes them itself and shows People.

import { useEffect, useRef, useState } from "preact/hooks";
import type { EntityId } from "../../shared/ids";
import type { FixTarget, StateView } from "../../shared/state-view";
import { playAt, pushSheet, useApp } from "../app";
import { Avatar, Badge, Empty, IconButton, List, ListRow, Section, useBusy } from "../components";
import { FixEditor } from "../fix-editor";
import { formatMinutes, humanize } from "../format";
import { cashText } from "../hud";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import type { PanelDef, PanelProps } from "../registry";
import { NeedsYou, QuickActions, StatusBanners } from "./now";
import { visiblePanels } from "./play";

type FixKey = "time" | "place" | "weather" | "cash" | "scene";

const FIX_LABEL: Record<FixKey, string> = { time: "Time", place: "Place", weather: "Weather", cash: "Cash", scene: "Scene type" };

/** The weather's icon from its words; decorative, as the words say it. */
function weatherIcon(weather: string): IconName {
  const text = weather.toLowerCase();
  if (/snow|sleet|hail|blizzard/.test(text)) return "snow";
  if (/rain|drizzle|shower|storm|thunder/.test(text)) return "rain";
  if (/wind|gale|breez/.test(text)) return "wind";
  if (/clear|sun|fair|hot/.test(text)) return "sun";
  return "cloud";
}

export function ScenePanel(props: PanelProps) {
  const app = useApp();
  const { state } = props;
  const visible = visiblePanels(app.catalog, state);
  // Now's other panels (the Encounter while a fight is on) show inline, not as tabs.
  const inline = visible.filter((panel) => panel.home === "now" && panel.id !== "core.scene");
  const glances = app.catalog.glances.filter((glance) => visible.some((panel) => panel.id === glance.panel));
  return (
    <div class="lre-play-now" data-lre-panel="core.scene">
      <StatusBanners state={state} />
      <SceneCard state={state} />
      <NeedsYou state={state} />
      {inline.map((panel) => (
        <InlinePanel key={panel.id} panel={panel} state={state} />
      ))}
      <Here state={state} />
      {glances.map((glance) => (
        <glance.component key={glance.id} chatId={state.chatId} view={state.panels[glance.panel] ?? null} state={state} send={app.send} />
      ))}
      <QuickActions state={state} />
    </div>
  );
}

/** A pack panel shown inside Now. Showing it observes the POV there (DESIGN §9.2), as its own tab did. */
function InlinePanel(props: { panel: PanelDef; state: StateView }) {
  const app = useApp();
  const { panel, state } = props;
  useEffect(() => {
    void app.send({ type: "lre.view.open", chatId: state.chatId, panel: panel.id, entity: null });
  }, [state.chatId, panel.id]);
  return (
    <div class="lre-play-inline" data-lre-panel-host={panel.id}>
      <panel.component chatId={state.chatId} view={state.panels[panel.id] ?? null} state={state} send={app.send} />
    </div>
  );
}

/** Where the POV stands, with a ✎ on each value a fix can correct; the fix's form takes the value's place while it is open. */
function SceneCard(props: { state: StateView }) {
  const { hud, scene } = props.state;
  const [fixing, setFixing] = useState<FixKey | null>(null);
  const card = useRef<HTMLElement>(null);
  const opened = useRef<FixKey | null>(null);
  const fixes: Partial<Record<FixKey, FixTarget>> = hud?.fixes ?? {};
  const target = fixing ? fixes[fixing] : undefined;
  // The form replaces the value: focus moves into it, and back to the ✎ that opened it when it closes.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    if (fixing) el.querySelector<HTMLElement>(".lre-play-fix input, .lre-play-fix select, .lre-play-fix button")?.focus();
    else if (opened.current) el.querySelector<HTMLElement>(`[data-lre-fix-key="${opened.current}"] button`)?.focus();
    opened.current = fixing;
  }, [fixing]);
  if (!hud && !scene) {
    return (
      <section class="lre-play-scene">
        <Empty icon="compass" title="No scene yet">
          Where you are shows here once the world has a scene.
        </Empty>
      </section>
    );
  }
  // Rows without a ✎ keep its slot, so the values line up.
  const fixable = Object.keys(fixes).length > 0;
  const fixFor = (key: FixKey) =>
    fixes[key] ? (
      <span class="lre-play-fixbtn" data-lre-fix-key={key}>
        <IconButton icon="edit" label={`Fix ${FIX_LABEL[key].toLowerCase()}`} onClick={() => setFixing(key)} />
      </span>
    ) : fixable ? (
      <span class="lre-play-fixbtn" aria-hidden="true" />
    ) : null;
  const editor =
    fixing && target ? (
      <div
        class="lre-play-fix"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setFixing(null);
        }}
      >
        <FixEditor label={FIX_LABEL[fixing]} title={fixing === "place" ? "Where you are" : undefined} target={target} onDone={() => setFixing(null)} />
      </div>
    ) : null;
  const fact = (key: FixKey, icon: IconName, label: string, value: string, sub?: string) =>
    fixing === key && editor ? (
      editor
    ) : (
      <div class="lre-play-fact" data-lre-fact={key}>
        <Icon name={icon} class="lre-play-fact-icon" />
        <span class="lre-play-fact-label">{label}</span>
        <span class="lre-play-fact-value">
          {value}
          {sub ? <span class="lre-play-fact-sub">{sub}</span> : null}
        </span>
        {fixFor(key)}
      </div>
    );
  const cash = hud ? cashText(hud.cash) : null;
  return (
    <section ref={card} class="lre-play-scene" aria-label="Where you are">
      {hud && fixing === "time" && editor ? (
        editor
      ) : hud ? (
        <div class="lre-play-clock" data-lre-fact="time">
          <span class="lre-play-time lre-num">{hud.clock.label}</span>
          <span class="lre-play-daypart">{hud.clock.dayPart}</span>
          {hud.clock.scale !== 1 ? <Badge tone="accent">{`${hud.clock.scale}× time`}</Badge> : null}
          {hud.clock.paused ? (
            <Badge tone="warn">
              <Icon name="pause" size={12} />
              Clock paused
            </Badge>
          ) : null}
          {fixes.time ? fixFor("time") : null}
        </div>
      ) : null}
      {fixing === "place" && editor ? (
        editor
      ) : (
        <div class="lre-play-place" data-lre-fact="place">
          <Icon name="pin" class="lre-play-fact-icon" />
          <span class="lre-play-place-name">{hud?.place?.name ?? "—"}</span>
          {fixFor("place")}
        </div>
      )}
      <div class="lre-play-facts">
        {scene ? fact("scene", "message", "Scene", humanize(scene.sceneType), scene.elapsed > 0 ? `Last turn took ${formatMinutes(scene.elapsed)}` : "No time passed last turn") : null}
        {hud && (hud.weather || fixes.weather) ? fact("weather", hud.weather ? weatherIcon(hud.weather) : "cloud", "Weather", hud.weather ?? "—") : null}
        {cash !== null || fixes.cash ? fact("cash", "wallet", "Cash", cash ?? "—") : null}
      </div>
    </section>
  );
}

/** Who else is here: each opens their person sheet. */
function Here(props: { state: StateView }) {
  const app = useApp();
  const { state } = props;
  const [busy, run] = useBusy();
  const present = state.scene?.present ?? [];
  const open = (entity: EntityId) => {
    // The sheet observes them on opening: the row only opens it.
    if (app.catalog.sheets.has("person")) {
      app.ui.update((ui) => pushSheet(ui, { kind: "person", id: entity }));
      return;
    }
    run(async () => {
      const cast = app.catalog.panels.find((panel) => panel.id === "castlife.cast");
      const result = await app.request({ type: "lre.view.open", chatId: state.chatId, panel: cast ? cast.id : "core.scene", entity });
      if (result && cast) app.ui.update((ui) => playAt(ui, "people", cast.id));
      if (result?.pending) app.toast("Details appear when the reply finishes.", "info");
    });
  };
  return (
    <div class="lre-play-here">
      <Section title="Here" aside={present.length > 0 ? <Badge>{present.length}</Badge> : undefined} flush>
        {present.length === 0 ? (
          <p class="lre-play-none">Nobody else is here.</p>
        ) : (
          <List>
            {present.map((person) => {
              const pending = state.pending.some((mark) => mark.entity === person.id);
              return (
                <ListRow
                  key={person.id}
                  leading={<Avatar name={person.name} size={32} />}
                  title={person.name}
                  subtitle={person.label}
                  id={person.id}
                  badge={
                    person.life || pending ? (
                      <span class="lre-play-badges">
                        {person.life ? <Badge tone="neg">{person.life}</Badge> : null}
                        {pending ? <Badge tone="warn">pending</Badge> : null}
                      </span>
                    ) : undefined
                  }
                  chevron
                  disabled={busy}
                  onClick={() => open(person.id)}
                />
              );
            })}
          </List>
        )}
      </Section>
    </div>
  );
}
