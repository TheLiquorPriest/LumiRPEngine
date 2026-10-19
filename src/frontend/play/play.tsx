// Play: the running chat (contract §4.2–4.4). A bottom bar holds the destinations (Now, Me, People,
// Places, Story); each shows the visible panels whose home it is, with sub-tabs when there are
// several. Now is a hub (scene.tsx) rather than tabs: it holds the status banners, what needs you, the
// fight while one is on and the packs' glances. Details open as sheets stacked over the destination;
// each sheet draws its own header, and the shell keeps the frame, Escape and focus return. A chat
// that isn't a world chat offers to attach a world, with no bottom bar.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { PanelId } from "../../shared/ids";
import type { WorldIndex } from "../../shared/world";
import type { StateView } from "../../shared/state-view";
import type { Dest, SheetKind, SheetRoute } from "../app";
import { playAt, popSheet, pushSheet, useApp, useUi } from "../app";
import { BottomNav, Button, Empty, List, ListRow, PageHeader, Section, Tabs, tabPanel, useBusy } from "../components";
import type { IconName } from "../icons";
import type { PanelDef } from "../registry";
import { useSelect } from "../store";
import type { UiCatalog } from "../ui-registry";

/** Core panels always show; a pack's panel shows once its view model is in the state (a null one is none, as the Encounter's between fights). */
export function visiblePanels(catalog: UiCatalog, view: StateView): PanelDef[] {
  return catalog.panels.filter((panel) => panel.id.startsWith("core.") || (view.panels[panel.id] !== undefined && view.panels[panel.id] !== null));
}

const DESTS: readonly { id: Dest; label: string; icon: IconName }[] = [
  { id: "now", label: "Now", icon: "compass" },
  { id: "me", label: "Me", icon: "user" },
  { id: "people", label: "People", icon: "users" },
  { id: "places", label: "Places", icon: "map" },
  { id: "story", label: "Story", icon: "book" },
];

export interface Destination {
  id: Dest;
  label: string;
  icon: IconName;
  /** Its visible panels in order: the sub-tabs when there are several. */
  panels: PanelDef[];
  /** One of its panels has a pending mark. */
  dot: boolean;
}

/** The destinations that have a visible panel, in bar order (contract §4.2): Now and Story always do, as Scene and Journal are core. */
export function destinations(catalog: UiCatalog, view: StateView): Destination[] {
  const visible = visiblePanels(catalog, view);
  return DESTS.flatMap((dest) => {
    const panels = visible.filter((panel) => panel.home === dest.id);
    return panels.length === 0 ? [] : [{ ...dest, panels, dot: view.pending.some((mark) => panels.some((panel) => panel.id === mark.panel)) }];
  });
}

const SHEET_TITLE: Record<SheetKind, string> = { person: "Person", place: "Place", item: "Item", account: "Account", quest: "Quest" };

export function Play() {
  const app = useApp();
  const sync = useSelect(app.sync, (state) => state);
  const play = useUi((ui) => ui.play);
  const panelId = useId();
  const shell = useRef<HTMLDivElement>(null);
  const view = sync.view;
  const world = view !== null && view.status !== "not_world" ? view : null;
  const dests = world ? destinations(app.catalog, world) : [];
  // The chosen destination while it shows; else Now, which always does in a world chat.
  const dest = dests.find((d) => d.id === play.dest) ?? dests[0];
  // Now is one hub, its Scene panel, which draws Now's other panels inside it.
  const hub = dest?.id === "now";
  const panel = dest ? (hub ? (dest.panels.find((p) => p.id === "core.scene") ?? dest.panels[0]) : (dest.panels.find((p) => p.id === play.tab[dest.id]) ?? dest.panels[0])) : undefined;
  const current = panel?.id ?? null;
  const chatId = world?.chatId ?? null;
  // Showing a pack's panel is a player-facing observation of the POV (DESIGN §9.2): it may
  // materialize the POV's detail in that pack's domain. Until it lands (or while a reply holds the
  // write), the panel shows the representation, so nothing waits on the answer and a refusal says
  // nothing. Context sends its own on opening; Now's hub sends for the panels it shows.
  useEffect(() => {
    if (chatId !== null && current !== null && !current.startsWith("core.")) void app.send({ type: "lre.view.open", chatId, panel: current, entity: null });
  }, [chatId, current]);
  // Back returns focus to the control that opened the sheet (contract §5.7): the one last focused in
  // Play, kept as it was focused, since an opener may lose focus while its request runs (disabled
  // while busy) or as the sheet hides the destination under it.
  const lastFocus = useRef<HTMLElement | null>(null);
  const openers = useRef<(HTMLElement | null)[]>([]);
  const depth = play.stack.length;
  const shownDepth = useRef(depth);
  useEffect(() => {
    const was = shownDepth.current;
    shownDepth.current = depth;
    if (depth > was) {
      while (openers.current.length < depth) openers.current.push(lastFocus.current);
      // Into the new sheet: its Back, or the sheet itself when it draws no header.
      const top = shell.current?.querySelector<HTMLElement>(".lre-play-sheet:not([hidden])");
      (top?.querySelector<HTMLElement>(".lre-page-header button") ?? top)?.focus();
      return;
    }
    // Back one level returns to the opener; leaving the destination drops the stack with no focus move.
    const back = openers.current.splice(depth);
    if (depth === was - 1) back[0]?.focus();
  }, [depth]);
  // Which way the stack last moved, kept until it moves again so a re-render doesn't cut the motion:
  // a pushed sheet slides in from the end side, and Back slides the level under it back in.
  const motion = useRef<{ depth: number; dest: Dest; kind: "push" | "pop" | null }>({ depth, dest: play.dest, kind: null });
  if (motion.current.depth !== depth || motion.current.dest !== play.dest) {
    const was = motion.current;
    motion.current = { depth, dest: play.dest, kind: was.dest !== play.dest ? null : depth > was.depth ? "push" : depth === was.depth - 1 ? "pop" : null };
  }
  if (sync.chatId === null) {
    return (
      <div class="lre-play" data-lre-section="play">
        <div class="lre-play-main lre-play-away">
          <Empty icon="message" title="Open a chat to play">
            The world of the chat you open shows here.
          </Empty>
        </div>
      </div>
    );
  }
  if (!world) {
    return (
      <div class="lre-play" data-lre-section="play">
        <div class="lre-play-main lre-play-away">{view === null && sync.status !== "closed" ? <Empty icon="hourglass" title="Connecting to the engine…" /> : <NotWorld chatId={view?.chatId ?? sync.chatId} />}</div>
      </div>
    );
  }
  const tabs = dest !== undefined && !hub && dest.panels.length > 1;
  return (
    <div
      ref={shell}
      class="lre-play"
      data-lre-section="play"
      data-lre-motion={motion.current.kind ?? undefined}
      onFocusIn={(event) => {
        if (event.target instanceof HTMLElement) lastFocus.current = event.target;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || play.stack.length === 0 || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        app.ui.update(popSheet);
      }}
    >
      <div class="lre-play-main" data-lre-dest={dest?.id} hidden={play.stack.length > 0}>
        {dest && tabs ? (
          <div class="lre-play-tabs">
            <Tabs<PanelId> label={`${dest.label} sections`} panelId={panelId} value={current} tabs={dest.panels.map((p) => ({ id: p.id, label: p.label, dot: world.pending.some((mark) => mark.panel === p.id) }))} onChange={(id) => app.ui.update((ui) => playAt(ui, dest.id, id))} />
          </div>
        ) : null}
        {panel ? (
          <div {...(tabs ? tabPanel(panelId, current) : {})} class={dest?.id === "places" ? "lre-play-host lre-play-fill" : "lre-play-host"} data-lre-panel-host={panel.id}>
            <panel.component chatId={world.chatId} view={world.panels[panel.id] ?? null} state={world} send={app.send} />
          </div>
        ) : (
          <Empty icon="info" title="Nothing to show here" />
        )}
      </div>
      {play.stack.map((route, index) => (
        <SheetFrame key={`${index}:${route.kind}:${route.id}`} route={route} state={world} hidden={index !== play.stack.length - 1} />
      ))}
      {dest ? <BottomNav<Dest> label="Play" items={dests.map((d) => ({ id: d.id, label: d.label, icon: d.icon, dot: d.dot }))} value={dest.id} onChange={(id) => app.ui.update((ui) => playAt(ui, id))} /> : null}
    </div>
  );
}

/** One sheet of the stack: its kind's registered sheet, which draws its own header (contract §9.2), or a note with Back where no pack draws that kind. */
function SheetFrame(props: { route: SheetRoute; state: StateView; hidden: boolean }) {
  const app = useApp();
  const Sheet = app.catalog.sheets.get(props.route.kind);
  const close = () => app.ui.update(popSheet);
  return (
    <section class="lre-play-sheet" data-lre-sheet={props.route.kind} aria-label={`${SHEET_TITLE[props.route.kind]} details`} tabIndex={-1} hidden={props.hidden}>
      {Sheet ? (
        <Sheet chatId={props.state.chatId} id={props.route.id} state={props.state} send={app.send} open={(route) => app.ui.update((ui) => pushSheet(ui, route))} close={close} />
      ) : (
        <>
          <PageHeader title={SHEET_TITLE[props.route.kind]} onBack={close} />
          <Empty icon="info" title="Nothing to show here">
            This world has no details for it.
          </Empty>
        </>
      )}
    </section>
  );
}

function NotWorld(props: { chatId: string }) {
  const app = useApp();
  const [worlds, setWorlds] = useState<WorldIndex[] | null>(null);
  const [busy, run] = useBusy();
  useEffect(() => {
    void app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  }, []);
  const attach = (world: WorldIndex) =>
    run(async () => {
      const ok = await app.host.confirm("Attach world", `Attach “${world.name}” to this chat? The world starts at its current revision.`, "info", "Attach");
      if (!ok) return;
      const result = await app.request({ type: "lre.world", op: "attach", worldId: world.id, chatId: props.chatId });
      if (result) void app.client.open(props.chatId);
    });
  return (
    <div class="lre-play-notworld" data-lre-section="play-not-world">
      <Empty icon="globe" title="Not a world chat">
        Attach a world to this chat to track time, places, money and everyone in it.
      </Empty>
      {worlds === null ? (
        <p class="lre-play-none">Loading worlds…</p>
      ) : worlds.length === 0 ? (
        <p class="lre-play-none">No worlds yet. Create one in Build.</p>
      ) : (
        <Section title="Your worlds" flush>
          <List>
            {worlds.map((world) => (
              <ListRow
                key={world.id}
                icon="globe"
                title={world.name}
                subtitle={`${world.revisions.length} revision${world.revisions.length === 1 ? "" : "s"}`}
                id={world.id}
                badge={
                  <Button size="sm" label={`Attach ${world.name}`} disabled={busy} onClick={() => attach(world)}>
                    Attach
                  </Button>
                }
              />
            ))}
          </List>
        </Section>
      )}
      <Button icon="hammer" block onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "worlds" } }))}>
        Open Build
      </Button>
    </div>
  );
}
