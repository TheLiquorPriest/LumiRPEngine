// The web shell (plan §14): RPE's pages in any browser, served by RPE at `/ui/`, always on the direct
// road. Its own navigation: a bar across the top with every page, which at phone width gives way to a
// bar at the bottom of the screen with the pages used most and More for the rest (frame.tsx). The route
// lives in the address's fragment (`#/chats/<chat>/live`), so the back button and a reload keep the
// page. RPE takes the token `rpe up` printed (`rpe key web` makes a new one), or a Lumiverse account's
// username and password, in the sign-in form, and trades either for a session, which this browser keeps
// until it ends or the player signs out (web-signin.ts). The printed token and the password are never
// kept, and never go in an address: an address is kept in the history, bookmarked and shared.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { createStore, useSelect } from "./store";
import { AppContext, chatOf, type Route, type UiApp, useApp } from "./app";
import { Banner, Button, PageHeader } from "./atoms";
import { createClient, type TokenStore, webConnector } from "./client";
import { Frame, PagesBar, routeFor } from "./frame";
import type { PageEntry } from "./page-entry";
import { PAGES } from "./page-list";
import { webHost } from "./kept/host";
import { createGate } from "./gate";
import { browserDeps, type RoadDeps } from "./roads";
import { createSessions, type Sessions } from "./web-signin";
import { errorWords } from "./words";
import { UI_CSS } from "./styles";
import { createUiSettings, UiSettingsContext } from "./ui-settings";

/** Where this browser keeps the web UI's token. */
export const TOKEN_KEY = "rpe:web-token";

/** The page a fragment with no page names for a chat: the chat's live view. */
const CHAT_START_PAGE = "live";

/**
 * The route a fragment names; the chats for one that names none. `#/<page>/<inner place…>` names a page
 * that is about no chat, `#/chats/<chat>/<page>/<inner place…>` a page of a chat (the live view when it
 * names none, and for a page that is not one of the shells'): the page's own inner place is part of its
 * address, so a reload and the back button return to it.
 */
export function routeOfHash(hash: string, pages: readonly PageEntry[] = PAGES): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [head, chat, page, ...at] = parts;
  const inside = (names: string[]) => (names.length === 0 ? {} : { at: names });
  if (head === "chats" && chat !== undefined) {
    const entry = pages.find((candidate) => candidate.id === page);
    return entry !== undefined && (entry.needsChat || entry.withChat === true) ? { page: entry.id, chat, ...inside(at) } : { page: CHAT_START_PAGE, chat };
  }
  const entry = head === undefined ? undefined : pages.find((candidate) => candidate.id === head);
  if (entry === undefined || entry.needsChat) return { page: "chats" };
  return { page: entry.id, ...(entry.withChat === true ? { chat: null } : {}), ...inside(parts.slice(1)) };
}

/** The fragment that names a route. */
export function hashOf(route: Route, pages: readonly PageEntry[] = PAGES): string {
  const entry = pages.find((candidate) => candidate.id === route.page);
  const inner = (route.at ?? []).map((name) => `/${encodeURIComponent(name)}`).join("");
  const chat = route.chat ?? null;
  if (chat !== null && (entry === undefined || entry.needsChat || entry.withChat === true)) return `#/chats/${encodeURIComponent(chat)}/${route.page}${inner}`;
  return entry === undefined || entry.needsChat ? "#/chats" : `#/${route.page}${inner}`;
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

type Way = "token" | "account";

/** The sign-in form: the token `rpe up` printed, or a Lumiverse account's username and password; either is traded for a session, and neither is kept. */
function SignIn(props: { error: string | null; onToken: (token: string) => Promise<void>; onAccount: (username: string, password: string) => Promise<void> }) {
  const [way, setWay] = useState<Way>("token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = way === "token" ? token.trim() !== "" : username.trim() !== "" && password !== "";
  const submit = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      if (way === "token") await props.onToken(token.trim());
      else await props.onAccount(username.trim(), password);
      setToken("");
      setPassword("");
    } catch (error) {
      setFailed(errorWords(error));
    } finally {
      setBusy(false);
    }
  };
  const shown = failed ?? props.error;
  return (
    <form
      class="lre-stack rpe-signin"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <PageHeader title="Sign in to RPE" sub={way === "token" ? "With the token RPE printed." : "With your Lumiverse account."} />
      {shown === null ? null : (
        <Banner tone="neg" icon="alert" title={way === "token" ? "RPE did not take that token" : "RPE did not take that sign-in"}>
          <span>{shown}</span>
        </Banner>
      )}
      <div class="lre-row">
        <Button small kind={way === "token" ? "primary" : "ghost"} onClick={() => setWay("token")}>
          Token
        </Button>
        <Button small kind={way === "account" ? "primary" : "ghost"} onClick={() => setWay("account")}>
          Lumiverse account
        </Button>
      </div>
      {way === "token" ? (
        <div class="lre-field">
          <label for="rpe-token">Token</label>
          <input id="rpe-token" class="lre-input" type="password" autoComplete="off" spellcheck={false} value={token} onInput={(event) => setToken(event.currentTarget.value)} />
          <span class="lre-field-help">
            The one `rpe up` printed, once. For a new one, run <code>rpe key web</code> on the machine RPE runs on. This browser keeps a session, not the token.
          </span>
        </div>
      ) : (
        <>
          <div class="lre-field">
            <label for="rpe-username">Lumiverse username</label>
            <input id="rpe-username" class="lre-input" type="text" autoComplete="username" spellcheck={false} value={username} onInput={(event) => setUsername(event.currentTarget.value)} />
          </div>
          <div class="lre-field">
            <label for="rpe-password">Lumiverse password</label>
            <input id="rpe-password" class="lre-input" type="password" autoComplete="current-password" value={password} onInput={(event) => setPassword(event.currentTarget.value)} />
            <span class="lre-field-help">RPE checks it with Lumiverse and keeps nothing of it. Only the Lumiverse user this RPE belongs to signs in.</span>
          </div>
        </>
      )}
      <button type="submit" class="lre-btn primary" disabled={!ready || busy}>
        {busy ? "Signing in…" : "Sign in"}
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

function WebShell(props: { sessions: Sessions }) {
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
  const current = route.page;
  const target = chat ?? lastChat;
  const disabled = (item: PageEntry): boolean => !signedIn || (item.needsChat && target === null);
  const go = (id: string): void => app.go(routeFor(id, target));
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
              void props.sessions.signOut().finally(() => app.client.reconnect());
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
            onToken={async (token) => {
              await props.sessions.withToken(token);
              app.client.reconnect();
            }}
            onAccount={async (username, password) => {
              await props.sessions.withAccount(username, password);
              app.client.reconnect();
            }}
          />
        ) : (
          <Frame route={route} />
        )}
      </main>
      {signedIn ? <PagesBar place="foot" current={current} disabled={disabled} go={go} /> : null}
    </div>
  );
}

export interface WebOptions {
  /** RPE's address: the page's own origin, since RPE served the page. */
  base: string;
  /** Where the web UI's session is kept between visits; null to keep it for this page alone. */
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
  // What the browser kept is looked at first: a session past its end is let go, and a key an earlier build kept is traded for one.
  const sessions = createSessions(options.base, tokens, options.storage, deps, settings, () => client.reconnect());
  void sessions.resume().finally(() => client.connect());
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
        <WebShell sessions={sessions} />
      </AppContext.Provider>
    </UiSettingsContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    window.removeEventListener("hashchange", onHash);
    stopSettings();
    sessions.stop();
    client.close();
    style.remove();
  };
}
