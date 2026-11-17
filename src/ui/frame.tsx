// The frame both shells put the pages in: the bars that offer the pages (`PagesBar`, made from the pages'
// own entries, `page-list.ts`), which page a route shows (`PageFor`), and what stands above and in front
// of the page: the line that says which road the page reaches RPE by, what the extension lacks and what
// went wrong (`Frame`). A page is offered by both shells by its own entry, with no edit here.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";
import { useSelect } from "./store";
import { LIVE_USER, type ExtensionStatusReply, type MissingPermissionShown } from "../shared/api";
import { type Route, useApp } from "./app";
import { Badge, Banner, Button, Disclosure, Empty } from "../frontend/components";
import type { ClientState, RpeClient } from "./client";
import type { PageEntry } from "./page-entry";
import { PAGES } from "./page-list";
import { errorWords } from "./words";

/** Where a page's navigation entry goes, for the chat the page is on: a page that is about a chat, or can show one's own levels, takes it. */
export function routeFor(id: string, chat: string | null, pages: readonly PageEntry[] = PAGES): Route {
  const page = pages.find((entry) => entry.id === id);
  return page?.needsChat === true || page?.withChat === true ? { page: id, chat } : { page: id };
}

/** Where a bar of pages is: across the top of the web shell, at its foot at phone width, or atop the drawer. */
export type BarPlace = "top" | "foot" | "drawer";

export interface PagesBarProps {
  place: BarPlace;
  /** The id of the page shown. */
  current: string;
  /** The pages the bar offers; every page of the shells when left out. */
  pages?: readonly PageEntry[];
  disabled(item: PageEntry): boolean;
  go(id: string): void;
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
  const items = (props.pages ?? PAGES).filter((item) => item.shells.includes(place === "drawer" ? "drawer" : "web"));
  const rest = items.filter((item) => !item.often);
  const go = (id: string): void => {
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

/** The page a route shows, by its entry: with a chat where the page needs one and none is open, a way to one. */
export function PageFor(props: { route: Route; pages?: readonly PageEntry[] }) {
  const app = useApp();
  const { route } = props;
  const entry = (props.pages ?? PAGES).find((page) => page.id === route.page);
  if (entry === undefined) {
    return (
      <Empty icon="alert" title="No such page">
        <span>RPE has no page called {route.page}.</span>
      </Empty>
    );
  }
  if (!entry.needsChat) return <>{entry.render(route)}</>;
  const chat = route.chat ?? null;
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
  return <>{entry.render({ ...route, chat })}</>;
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
          <Disclosure summary={<span class="lre-inline"><Badge tone="warn">Through Lumiverse</Badge><span>RPE is reached by way of its extension</span></span>}>
            <span class="rpe-line">{state.why}</span>
          </Disclosure>
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
  rpe: ExtensionStatusReply | null;
  /** The extension's own word on what it lacks, fresher than RPE's, where the page has one (the drawer); null where it has none. */
  own: readonly MissingPermissionShown[] | null;
  /** Why RPE's word could not be read; null when it was. */
  problem: string | null;
}

/**
 * How RPE's extension in Lumiverse stands, until it is put right (plan §4.2): it does not hold RPE's
 * registration, so chats on RPE's connection are not played, in RPE's words; or it lacks permissions,
 * each named with the extension's own reason for it. Nothing while all is well.
 */
export function ExtensionNotice(props: { word: ExtensionWord; onCheck: () => void }) {
  const { rpe, problem } = props.word;
  const missing = lackedBy(props.word);
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
 * afresh (following began, or updates were lost on the way), on `check()`, and the moment RPE publishes
 * a change of it on the user's own channel (`LIVE_USER`: the registration lost, a permission granted or
 * withdrawn, the extension stopped or started), which the page follows while it watches. Only the latest
 * read's answer is told.
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
  const offUser = client.follow(LIVE_USER, { events: read, reset: () => undefined, refused: () => undefined });
  read();
  return {
    check: read,
    stop() {
      alive = false;
      offState();
      offReset();
      offUser();
    },
  };
}

/** The permissions the extension lacks, by its own word where the page has one (the drawer, where it is fresher), else by RPE's. */
export function lackedBy(word: ExtensionWord): readonly MissingPermissionShown[] {
  return word.own ?? word.rpe?.missing ?? [];
}

/**
 * What both shells put the pages in: the road line, how RPE's extension stands, and the page. While the
 * extension lacks a permission no page is shown: the notice stands in front of them (the page behind it
 * stays as it was, out of reach and out of sight), it cannot be dismissed, and it goes only when the
 * permission is granted, the moment RPE or the extension says so.
 */
export function Frame(props: { route: Route; pages?: readonly PageEntry[] }) {
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
  const word: ExtensionWord = { rpe: reached ? heard.rpe : null, own, problem: reached ? heard.problem : null };
  const notice = <ExtensionNotice word={word} onCheck={() => watcher.current?.check()} />;
  const blocked = lackedBy(word).length > 0;
  return (
    <>
      <div class="lre-stack rpe-notices">
        <RoadLine state={state} onRetry={() => app.client.reconnect()} />
        {blocked ? null : notice}
      </div>
      <div class="rpe-frame" data-blocked={blocked ? "yes" : "no"}>
        <div class="rpe-frame-page" aria-hidden={blocked ? "true" : undefined} {...(blocked ? { inert: true } : {})}>
          <PageFor route={props.route} {...(props.pages === undefined ? {} : { pages: props.pages })} />
        </div>
        {blocked ? (
          <div class="rpe-frame-block" role="alert">
            {notice}
          </div>
        ) : null}
      </div>
    </>
  );
}
