// The frame both shells put the pages in: which pages the navigation offers (`NAV`), the bars that offer
// them (`PagesBar`), which page a route shows (`PageFor`), and the line that says which road the page
// reaches RPE by, with what the extension lacks and what went wrong. A new page is an entry in `NAV` and
// a case in `PageFor`, and both shells offer it.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "../frontend/icons";
import { useSelect } from "../frontend/store";
import type { ExtensionStatus, MissingPermission } from "./api";
import { chatOf, type Route, type Shell, useApp } from "./app";
import { Badge, Banner, Button, Empty, Fold } from "./atoms";
import type { ClientState, RpeClient } from "./client";
import { BuildPage } from "./kept/page";
import { PlayPage } from "./kept/play/page";
import { CastPage } from "./pages/cast";
import { ChatsPage } from "./pages/chats";
import { ConnectionsPage } from "./pages/connections";
import { FilesPage } from "./pages/files";
import { LivePage } from "./pages/live";
import { MigrationPage } from "./pages/migration";
import { SettingsPage } from "./pages/settings";
import { StoragePage } from "./pages/storage";
import { StoryPage } from "./pages/story";
import { TurnPage, TurnsPage } from "./pages/turns";
import { WorldPage } from "./pages/world";
import { errorWords } from "./words";

export type NavId = "chats" | "live" | "turns" | "world" | "cast" | "story" | "play" | "build" | "files" | "connections" | "settings" | "storage" | "migration";

export interface NavItem {
  id: NavId;
  title: string;
  icon: IconName;
  shells: readonly Shell[];
  /** It shows a chat, so there is nothing to show until one is open. */
  needsChat: boolean;
  /** It stays in a narrow bar (a phone's, the drawer's); the rest are behind its More. */
  often: boolean;
}

/** The pages the navigation offers, in order. A narrow bar keeps the chat's own pages, and the way to a chat in the web shell. */
export const NAV: readonly NavItem[] = [
  { id: "chats", title: "Chats", icon: "message", shells: ["web"], needsChat: false, often: true },
  { id: "live", title: "Live", icon: "pulse", shells: ["web", "drawer"], needsChat: true, often: true },
  { id: "turns", title: "Turns", icon: "list", shells: ["web", "drawer"], needsChat: true, often: true },
  { id: "world", title: "World", icon: "globe", shells: ["web", "drawer"], needsChat: true, often: true },
  { id: "cast", title: "Cast", icon: "users", shells: ["web", "drawer"], needsChat: true, often: false },
  { id: "story", title: "Story", icon: "book", shells: ["web", "drawer"], needsChat: true, often: false },
  { id: "play", title: "Play", icon: "dice", shells: ["web", "drawer"], needsChat: true, often: true },
  { id: "build", title: "Build", icon: "hammer", shells: ["web", "drawer"], needsChat: false, often: false },
  { id: "files", title: "Files", icon: "folder", shells: ["web", "drawer"], needsChat: false, often: false },
  { id: "connections", title: "Connections", icon: "link", shells: ["web", "drawer"], needsChat: false, often: false },
  { id: "settings", title: "Settings", icon: "sliders", shells: ["web", "drawer"], needsChat: false, often: false },
  { id: "storage", title: "Storage", icon: "box", shells: ["web", "drawer"], needsChat: false, often: false },
  { id: "migration", title: "Migration", icon: "download", shells: ["web", "drawer"], needsChat: false, often: false },
];

/** The navigation entry a route is under: one turn is under Turns. */
export function navOf(route: Route): NavId {
  return route.page === "turn" ? "turns" : route.page;
}

/** Where a navigation entry goes, for the chat the page is on. */
export function routeFor(id: NavId, chat: string | null): Route {
  return id === "chats" || id === "build" || id === "connections" || id === "migration" ? { page: id } : { page: id, chat };
}

/** Where a bar of pages is: across the top of the web shell, at its foot at phone width, or atop the drawer. */
export type BarPlace = "top" | "foot" | "drawer";

export interface PagesBarProps {
  place: BarPlace;
  current: NavId;
  disabled(item: NavItem): boolean;
  go(id: NavId): void;
}

/**
 * A shell's bar of pages. Where room is short (at the foot of the web shell at phone width, atop the
 * drawer, and across the top of the web shell where its every page would not fit) it keeps the pages
 * used most, then More, which opens a list of the rest and shows as current while one of them is. The
 * top bar holds every page, and the width rule in styles.ts decides whether the rest or More shows.
 * Choosing a page, More again, Escape (which gives More the focus back), a tap anywhere else or another
 * page coming up closes the list.
 */
export function PagesBar(props: PagesBarProps) {
  const { place, current } = props;
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useEffect(() => setOpen(false), [current]);
  const items = NAV.filter((item) => item.shells.includes(place === "drawer" ? "drawer" : "web"));
  const rest = items.filter((item) => !item.often);
  const go = (id: NavId): void => {
    setOpen(false);
    props.go(id);
  };
  /** An entry's words: its icon and title in the web shell, its title alone among the drawer's tabs. */
  const face = (icon: IconName, title: string) =>
    place === "drawer" ? (
      title
    ) : (
      <>
        <Icon name={icon} size={18} />
        <span class="lre-bottomnav-label">{title}</span>
      </>
    );
  const entries = items
    .filter((item) => place === "top" || item.often)
    .map((item) => (
      <button key={item.id} type="button" class={item.often ? undefined : "rpe-spare"} aria-current={item.id === current ? "page" : undefined} disabled={props.disabled(item)} onClick={() => go(item.id)}>
        {face(item.icon, item.title)}
      </button>
    ));
  const moreButton = (
    <button ref={more} type="button" class="rpe-more" aria-expanded={open ? "true" : "false"} aria-controls={open ? listId : undefined} aria-current={rest.some((item) => item.id === current) ? "page" : undefined} disabled={rest.every((item) => props.disabled(item))} onClick={() => setOpen(!open)}>
      {face("more", "More")}
    </button>
  );
  const list = open ? (
    <>
      <div class="rpe-more-away" onClick={() => setOpen(false)} />
      <div id={listId} class="rpe-more-list" role="group" aria-label="More pages">
        {rest.map((item) => (
          <button key={item.id} type="button" aria-current={item.id === current ? "page" : undefined} disabled={props.disabled(item)} onClick={() => go(item.id)}>
            <Icon name={item.icon} size={16} />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
    </>
  ) : null;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open || event.key !== "Escape") return;
    // Kept from the page around it (Lumiverse's drawer): Escape here closes only the list.
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    more.current?.focus();
  };
  if (place === "drawer") {
    return (
      <nav class="rpe-drawer-nav" aria-label="RPE's pages" onKeyDown={onKeyDown}>
        <div class="lre-tabs">
          {entries}
          {moreButton}
        </div>
        {list}
      </nav>
    );
  }
  return (
    <nav class={place === "top" ? "rpe-web-nav" : "lre-bottomnav rpe-web-bottom"} aria-label="Pages" onKeyDown={onKeyDown}>
      {entries}
      {moreButton}
      {list}
    </nav>
  );
}

export function PageFor(props: { route: Route }) {
  const app = useApp();
  const { route } = props;
  if (route.page === "chats") return <ChatsPage />;
  if (route.page === "build") return <BuildPage />;
  if (route.page === "connections") return <ConnectionsPage />;
  if (route.page === "migration") return <MigrationPage />;
  if (route.page === "settings") return <SettingsPage chat={route.chat} />;
  if (route.page === "files") return <FilesPage chat={route.chat} />;
  if (route.page === "storage") return <StoragePage chat={route.chat} />;
  const chat = route.chat;
  if (chat === null) {
    return app.shell === "drawer" ? (
      <Empty icon="message" title="Open a chat">
        <span>RPE's pages show the chat Lumiverse has open.</span>
      </Empty>
    ) : (
      <Empty icon="message" title="Pick a chat first">
        <Button onClick={() => app.go({ page: "chats" })}>See the chats</Button>
      </Empty>
    );
  }
  if (route.page === "turn") return <TurnPage chat={chat} turn={route.turn} />;
  if (route.page === "world") return <WorldPage chat={chat} />;
  if (route.page === "cast") return <CastPage chat={chat} />;
  if (route.page === "story") return <StoryPage chat={chat} />;
  if (route.page === "play") return <PlayPage chat={chat} />;
  return route.page === "live" ? <LivePage chat={chat} /> : <TurnsPage chat={chat} />;
}

/** Which road the page is on, in a line: straight to RPE, or through Lumiverse and why; or why it is on none. */
export function RoadLine(props: { state: ClientState; onRetry: () => void }) {
  const { state } = props;
  switch (state.phase) {
    case "idle":
      return null;
    case "connecting":
      return (
        <div class="rpe-road" data-road="none">
          <Badge>Connecting</Badge>
          <span>Reaching RPE…</span>
        </div>
      );
    case "direct":
      return (
        <div class="rpe-road" data-road="direct">
          <Badge tone="pos">Direct</Badge>
          <span>
            straight to RPE at <code class="lre-id">{state.address}</code>
          </span>
        </div>
      );
    case "relay":
      return (
        <div class="rpe-road" data-road="relay">
          <Fold summary={<span class="lre-inline"><Badge tone="warn">Through Lumiverse</Badge><span>RPE is reached by way of its extension</span></span>}>
            <span class="rpe-line">{state.why}</span>
          </Fold>
        </div>
      );
    case "failed":
      return (
        <Banner tone="neg" icon="alert" title="Not connected to RPE" actions={<Button onClick={props.onRetry}>Try again</Button>}>
          <span>{state.error}</span>
        </Banner>
      );
    case "signed-out":
      return null;
  }
}

/** What a page has heard of RPE's extension in Lumiverse. */
export interface ExtensionWord {
  /** RPE's word, from its status route; null until it has come. */
  rpe: ExtensionStatus | null;
  /** The extension's own word on what it lacks, fresher than RPE's, where the page has one (the drawer); null where it has none. */
  own: readonly MissingPermission[] | null;
  /** Why RPE's word could not be read; null when it was. */
  problem: string | null;
}

/**
 * How RPE's extension in Lumiverse stands, until it is put right (plan §4.2): it does not hold RPE's
 * registration, so chats on RPE's connection are not played, in RPE's words; or it lacks permissions,
 * each named with the extension's own reason for it. Nothing while all is well.
 */
export function ExtensionNotice(props: { word: ExtensionWord; onCheck: () => void }) {
  const { rpe, own, problem } = props.word;
  const missing = own ?? rpe?.missing ?? [];
  const check = <Button onClick={props.onCheck}>Check again</Button>;
  return (
    <>
      {rpe === null || rpe.registered ? null : (
        <Banner tone="neg" icon="alert" title="Chats on RPE's connection are not being played" actions={check}>
          <span>RPE's extension in Lumiverse does not hold RPE's registration.</span>
          {rpe.why === null ? null : <span>{rpe.why}</span>}
        </Banner>
      )}
      {missing.length === 0 ? null : (
        <Banner tone="neg" icon="lock" title="RPE's extension is missing permissions" actions={check}>
          <ul class="rpe-reports">
            {missing.map((m) => (
              <li key={m.permission}>
                <strong>{m.permission}</strong>: {m.why}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="warn" icon="alert" title="RPE did not say how its extension in Lumiverse stands" actions={check}>
          <span>{problem}</span>
        </Banner>
      )}
    </>
  );
}

/** What the page has heard from RPE of its extension. */
export type ExtensionHeard = Pick<ExtensionWord, "rpe" | "problem">;

/**
 * Reads RPE's word on its extension each time the page reaches RPE, each time the page is told to read
 * afresh (following a chat began, or updates were lost on the way), and on `check()`. The word changes
 * while a road holds (RPE loses the registration, a permission is taken back) and RPE does not push it,
 * so these are the moments it is asked again. Only the latest read's answer is told.
 */
export function watchExtension(client: RpeClient, onChange: (heard: ExtensionHeard) => void): { check(): void; stop(): void } {
  let heard: ExtensionHeard = { rpe: null, problem: null };
  let asked = 0;
  let alive = true;
  const read = (): void => {
    const { phase } = client.state.get();
    if (!alive || (phase !== "direct" && phase !== "relay")) return;
    const mine = ++asked;
    const tell = (next: ExtensionHeard): void => {
      if (!alive || mine !== asked) return;
      heard = next;
      onChange(next);
    };
    client.call("GET /api/v1/status/extension", {}).then(
      (rpe) => tell({ rpe, problem: null }),
      (error: unknown) => tell({ rpe: heard.rpe, problem: errorWords(error) }),
    );
  };
  const offState = client.state.subscribe(read);
  const offReset = client.onReset(read);
  read();
  return {
    check: read,
    stop() {
      alive = false;
      offState();
      offReset();
    },
  };
}

/** The road line, and how RPE's extension stands; in the drawer the extension's own list of what it lacks comes as it changes. */
export function Notices() {
  const app = useApp();
  const state = useSelect(app.client.state, (s) => s);
  const own = useSelect(app.client.missing, (m) => m);
  const [heard, setHeard] = useState<ExtensionHeard>({ rpe: null, problem: null });
  const watcher = useRef<{ check(): void } | null>(null);
  useEffect(() => {
    const watching = watchExtension(app.client, setHeard);
    watcher.current = watching;
    return watching.stop;
  }, []);
  const reached = state.phase === "direct" || state.phase === "relay";
  return (
    <div class="lre-stack rpe-notices">
      <RoadLine state={state} onRetry={() => app.client.reconnect()} />
      <ExtensionNotice word={{ rpe: reached ? heard.rpe : null, own, problem: reached ? heard.problem : null }} onCheck={() => watcher.current?.check()} />
    </div>
  );
}
