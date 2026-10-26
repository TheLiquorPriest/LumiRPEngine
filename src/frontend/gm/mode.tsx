// GM mode, inside the drawer's GM frame: a bottom bar in GM gold (World, Places,
// Story, each pack's tab in its order, This chat) over the GM panels. The truth (World, Places,
// Story, the packs' tabs, the Fight and the Edits log) is the `core.gm` panel, behind the gate in UI
// state; This chat's rules and the Inspector (`core.context` and any other GM panel) aren't behind
// it. Leaving GM mode, or moving to another chat, closes the gate again. The bar's height is
// published (`--lre-gm-nav-h`) so what a list pins at the bottom (its selection bar, an edit's
// notice) sits above the bar, never under it.

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { GmSection } from "../app";
import { useApp, useUi } from "../app";
import { BottomNav, Button, Empty, NoView } from "../components";
import type { IconName } from "../icons";
import { useSelect } from "../store";
import { ThisChat } from "./chat";
import { gmAt, hideTruth } from "./gate";

/** The engine's own sections; the packs' tabs go between Story and This chat. */
const ENGINE: readonly { id: GmSection; label: string; icon: IconName }[] = [
  { id: "world", label: "World", icon: "globe" },
  { id: "places", label: "Places", icon: "pin" },
  { id: "story", label: "Story", icon: "flag" },
];

export function GmMode() {
  const app = useApp();
  const sync = useSelect(app.sync, (state) => state);
  const section = useUi((ui) => ui.gm.section);
  // Unmounting is leaving GM mode: the next visit asks again before showing the truth.
  useEffect(() => () => app.ui.update(hideTruth), []);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const nav = root.current?.querySelector<HTMLElement>(":scope > .lre-bottomnav");
    const el = root.current;
    if (!nav || !el) return;
    const publish = () => el.style.setProperty("--lre-gm-nav-h", `${nav.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(nav);
    return () => observer?.disconnect();
  });
  // The gate was opened for one chat's truth, not the next one's.
  const chat = useRef(sync.chatId);
  useEffect(() => {
    if (chat.current === sync.chatId) return;
    chat.current = sync.chatId;
    app.ui.update(hideTruth);
  }, [sync.chatId]);
  const view = sync.view;
  const toPlay = (
    <Button icon="dice" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "play" }))}>
      Go to Play
    </Button>
  );
  if (sync.chatId === null) return <Empty icon="eye">Open a chat to see what's behind the curtain.</Empty>;
  if (!view && sync.failed !== null) return <NoView failed={sync.failed} />;
  if (!view && sync.status !== "closed") return <Empty icon="hourglass">Connecting to the engine…</Empty>;
  if (!view || view.status === "not_world") {
    return (
      <Empty icon="globe" title="Not a world chat" action={toPlay}>
        Attach a world to this chat in Play to see behind its curtain.
      </Empty>
    );
  }
  const panels = app.catalog.panels.filter((panel) => panel.home === "gm");
  const truth = panels.find((panel) => panel.id === "core.gm");
  const others = panels.filter((panel) => panel !== truth);
  const dot = others.some((panel) => view.pending.some((mark) => mark.panel === panel.id));
  return (
    <div ref={root} class="lre-gm" data-lre-section="gm" data-lre-gm-section={section}>
      <div class="lre-gm-body">
        {section === "chat" ? (
          <ThisChat view={view} truth={truth} panels={others} />
        ) : truth ? (
          <truth.component chatId={view.chatId} view={view.panels[truth.id] ?? null} state={view} send={app.send} />
        ) : (
          <Empty>Nothing to show here.</Empty>
        )}
      </div>
      <BottomNav<GmSection>
        label="GM"
        tone="gm"
        items={[...ENGINE, ...app.catalog.gmSections.map((def) => ({ id: def.id, label: def.label, icon: def.icon })), { id: "chat" as const, label: "This chat", icon: "sliders" as const, dot }]}
        value={section}
        onChange={(id) => app.ui.update((ui) => gmAt(ui, id))}
      />
    </div>
  );
}
