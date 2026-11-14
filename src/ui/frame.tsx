// The frame both shells put the pages in: which pages the navigation offers (`NAV`), which page a route
// shows (`PageFor`), and the line that says which road the page reaches RPE by, with what the extension
// lacks and what went wrong. A new page is an entry in `NAV` and a case in `PageFor`, and both shells
// offer it.

import { useEffect, useState } from "preact/hooks";
import type { IconName } from "../frontend/icons";
import { useSelect } from "../frontend/store";
import type { ExtensionStatus, MissingPermission } from "./api";
import { chatOf, type Route, type Shell, useApp } from "./app";
import { Badge, Banner, Button, Empty, Fold } from "./atoms";
import type { ClientState } from "./client";
import { ChatsPage } from "./pages/chats";
import { LivePage } from "./pages/live";
import { TurnPage, TurnsPage } from "./pages/turns";
import { errorWords } from "./words";

export type NavId = "chats" | "live" | "turns";

export interface NavItem {
  id: NavId;
  title: string;
  icon: IconName;
  shells: readonly Shell[];
}

/** The pages the navigation offers, in order. */
export const NAV: readonly NavItem[] = [
  { id: "chats", title: "Chats", icon: "message", shells: ["web"] },
  { id: "live", title: "Live", icon: "pulse", shells: ["web", "drawer"] },
  { id: "turns", title: "Turns", icon: "list", shells: ["web", "drawer"] },
];

/** The navigation entry a route is under: one turn is under Turns. */
export function navOf(route: Route): NavId {
  return route.page === "turn" ? "turns" : route.page;
}

/** Where a navigation entry goes, for the chat the page is on. */
export function routeFor(id: NavId, chat: string | null): Route {
  return id === "chats" ? { page: "chats" } : { page: id, chat };
}

export function PageFor(props: { route: Route }) {
  const app = useApp();
  const { route } = props;
  if (route.page === "chats") return <ChatsPage />;
  const chat = chatOf(route);
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
        <Banner tone="neg" icon="alert" title="RPE could not be reached" actions={<Button onClick={props.onRetry}>Try again</Button>}>
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
 * Why chats on RPE's connection are not being played (plan §4.2), until it is put right: the extension
 * in Lumiverse does not hold RPE's registration, in RPE's words, or it lacks permissions, each named with
 * why it is needed. Nothing while all is well.
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
          <span>Until an admin grants them in Lumiverse, chats on RPE's connection are not played.</span>
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

/**
 * The road line, and how RPE's extension stands: RPE is asked each time the page reaches it, and again
 * on "Check again"; in the drawer the extension's own list of what it lacks comes as it changes.
 */
export function Notices() {
  const app = useApp();
  const state = useSelect(app.client.state, (s) => s);
  const own = useSelect(app.client.missing, (m) => m);
  const [heard, setHeard] = useState<{ rpe: ExtensionStatus | null; problem: string | null }>({ rpe: null, problem: null });
  const [checks, setChecks] = useState(0);
  const reached = state.phase === "direct" || state.phase === "relay";
  useEffect(() => {
    if (!reached) return;
    let alive = true;
    app.client.call("GET /api/v1/status/extension", {}).then(
      (rpe) => {
        if (alive) setHeard({ rpe, problem: null });
      },
      (error: unknown) => {
        if (alive) setHeard((h) => ({ rpe: h.rpe, problem: errorWords(error) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [state, checks]);
  return (
    <div class="lre-stack rpe-notices">
      <RoadLine state={state} onRetry={() => app.client.reconnect()} />
      <ExtensionNotice word={{ rpe: reached ? heard.rpe : null, own, problem: reached ? heard.problem : null }} onCheck={() => setChecks((n) => n + 1)} />
    </div>
  );
}
