// The web shell (plan §14): RPE's pages in any browser, served by RPE at `/ui/`, always on the direct
// road. Its own navigation: a bar across the top with every page, which at phone width gives way to a
// bar at the bottom of the screen with the pages used most and More for the rest (frame.tsx). The route
// lives in the address's fragment (`#/chats/<chat>/live`), so the back button and a reload keep the
// page. RPE takes the web UI's token (`rpe key web`), asked for once in the sign-in field and kept by
// this browser until the player signs out. It never goes in an address: the token does not expire, and
// an address is kept in the history, bookmarked and shared.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { createStore, useSelect } from "./store";
import { AppContext, chatOf, type Route, type UiApp, useApp } from "./app";
import { Banner, Button, PageHeader } from "./atoms";
import { createClient, type TokenStore, webConnector } from "./client";
import { type NavId, type NavItem, navOf, Notices, PageFor, PagesBar, routeFor } from "./frame";
import { webHost } from "./kept/host";
import { createGate } from "./gate";
import { browserDeps, type RoadDeps } from "./roads";
import { UI_CSS } from "./styles";
import { createUiSettings, UiSettingsContext } from "./ui-settings";

/** Where this browser keeps the web UI's token. */
export const TOKEN_KEY = "rpe:web-token";

/** The route a fragment names; the chats for one that names none. */
export function routeOfHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [head, chat, page, turn] = parts;
  if ((head === "build" || head === "connections" || head === "migration") && parts.length === 1) return { page: head };
  if ((head === "files" || head === "settings" || head === "storage") && parts.length === 1) return { page: head, chat: null };
  if (head !== "chats" || chat === undefined) return { page: "chats" };
  if (page === "turns" && turn !== undefined && parts.length === 4) return { page: "turn", chat, turn };
  if ((page === "turns" || page === "world" || page === "cast" || page === "story" || page === "play" || page === "files" || page === "settings" || page === "storage") && parts.length === 3) return { page, chat };
  return { page: "live", chat };
}

/** The fragment that names a route. */
export function hashOf(route: Route): string {
  if (route.page === "chats" || route.page === "build" || route.page === "connections" || route.page === "migration") return `#/${route.page}`;
  if (route.chat === null) return route.page === "files" || route.page === "settings" || route.page === "storage" ? `#/${route.page}` : "#/chats";
  const at = `#/chats/${encodeURIComponent(route.chat)}`;
  if (route.page === "turn") return `${at}/turns/${encodeURIComponent(route.turn)}`;
  return `${at}/${route.page}`;
}

/** The token kept in `storage`; in memory alone where the browser keeps nothing (a private window may refuse). */
export function storedTokens(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): TokenStore {
  let held: string | null = null;
  try {
    held = storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    held = null;
  }
  return {
    get: () => held,
    set(token) {
      held = token;
      try {
        if (token === null) storage?.removeItem(TOKEN_KEY);
        else storage?.setItem(TOKEN_KEY, token);
      } catch {
        // Kept for this page only.
      }
    },
  };
}

function SignIn(props: { error: string | null; onToken: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      class="lre-stack rpe-signin"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "") props.onToken(value.trim());
      }}
    >
      <PageHeader title="Sign in to RPE" sub="With the web UI's token." />
      {props.error === null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not take that token">
          <span>{props.error}</span>
        </Banner>
      )}
      <div class="lre-field">
        <label for="rpe-token">Token</label>
        <input id="rpe-token" class="lre-input" type="password" autoComplete="off" spellcheck={false} value={value} onInput={(event) => setValue(event.currentTarget.value)} />
        <span class="lre-field-help">
          Make one on the machine RPE runs on with <code>rpe key web</code>. This browser keeps it until you sign out.
        </span>
      </div>
      <button type="submit" class="lre-btn primary" disabled={value.trim() === ""}>
        Sign in
      </button>
    </form>
  );
}

/** The name of the chat the page is on, read from RPE's list of chats once per chat. */
function useChatName(chat: string | null, signedIn: boolean): string | null {
  const app = useApp();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (chat === null || !signedIn || names.has(chat)) return;
    let alive = true;
    app.client.call("GET /api/v1/chats", {}).then(
      (list) => {
        if (alive) setNames(new Map(list.chats.map((c) => [c.id, c.name])));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [chat, signedIn]);
  return chat === null ? null : (names.get(chat) ?? null);
}

function WebShell(props: { tokens: TokenStore }) {
  const app = useApp();
  const route = useSelect(app.route, (r) => r);
  const state = useSelect(app.client.state, (s) => s);
  const chat = chatOf(route);
  const [lastChat, setLastChat] = useState(chat);
  useEffect(() => {
    if (chat !== null) setLastChat(chat);
  }, [chat]);
  const signedIn = state.phase !== "signed-out";
  const name = useChatName(chat, state.phase === "direct");
  const current = navOf(route);
  const target = chat ?? lastChat;
  const disabled = (item: NavItem): boolean => !signedIn || (item.needsChat && target === null);
  const go = (id: NavId): void => app.go(routeFor(id, target));
  return (
    <div class="lre rpe rpe-web">
      <header class="rpe-web-top">
        <span class="rpe-web-brand">RPE</span>
        <PagesBar place="top" current={current} disabled={disabled} go={go} />
        <span class="rpe-web-chat">{name ?? ""}</span>
        {signedIn ? (
          <Button
            small
            kind="ghost"
            onClick={() => {
              props.tokens.set(null);
              app.client.reconnect();
            }}
          >
            Sign out
          </Button>
        ) : null}
      </header>
      <main class="rpe-web-main">
        {state.phase === "signed-out" ? (
          <SignIn
            error={state.error}
            onToken={(token) => {
              props.tokens.set(token);
              app.client.reconnect();
            }}
          />
        ) : (
          <>
            <Notices />
            <PageFor route={route} />
          </>
        )}
      </main>
      {signedIn ? <PagesBar place="foot" current={current} disabled={disabled} go={go} /> : null}
    </div>
  );
}

export interface WebOptions {
  /** RPE's address: the page's own origin, since RPE served the page. */
  base: string;
  /** Where the web UI's token is kept between visits; null to keep it for this page alone. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  deps?: RoadDeps;
}

/** Starts the web shell in `root`; the returned function stops it. */
export function startWeb(root: HTMLElement, options: WebOptions): () => void {
  const deps = options.deps ?? browserDeps();
  const tokens = storedTokens(options.storage);
  const settings = createUiSettings(options.storage);
  const client = createClient(webConnector(options.base, tokens, deps, settings));
  const stopSettings = settings.follow(client);
  client.connect();
  const gate = createGate();
  const route = createStore<Route>(routeOfHash(location.hash));
  const onHash = (): void => {
    const next = routeOfHash(location.hash);
    // The spoiler gate holds for the chat the player is on, and shuts when they leave it.
    if (chatOf(next) !== chatOf(route.get())) gate.closeAll();
    route.set(next);
  };
  window.addEventListener("hashchange", onHash);
  const app: UiApp = {
    shell: "web",
    client,
    gate,
    route,
    timers: deps.timers,
    keptHost: webHost,
    go(next) {
      const hash = hashOf(next);
      if (location.hash === hash) onHash();
      else location.hash = hash;
    },
  };
  const style = document.createElement("style");
  style.textContent = UI_CSS;
  document.head.append(style);
  render(
    <UiSettingsContext.Provider value={settings}>
      <AppContext.Provider value={app}>
        <WebShell tokens={tokens} />
      </AppContext.Provider>
    </UiSettingsContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    window.removeEventListener("hashchange", onHash);
    stopSettings();
    client.close();
    style.remove();
  };
}
