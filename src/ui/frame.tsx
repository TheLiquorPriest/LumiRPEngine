// The frame both shells put the pages in: which pages the navigation offers (`NAV`), which page a route
// shows (`PageFor`), and the line that says which road the page reaches RPE by, with what the extension
// lacks and what went wrong. A new page is an entry in `NAV` and a case in `PageFor`, and both shells
// offer it.

import type { IconName } from "../frontend/icons";
import { useSelect } from "../frontend/store";
import { chatOf, type Route, type Shell, useApp } from "./app";
import { Badge, Banner, Button, Empty, Fold } from "./atoms";
import type { ClientState } from "./client";
import { ChatsPage } from "./pages/chats";
import { LivePage } from "./pages/live";
import { TurnPage, TurnsPage } from "./pages/turns";
import type { MissingPermission } from "./roads";

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

/** What the extension lacks: until it is granted, chats on RPE's connection are not played (plan §4.2). */
export function MissingNotice(props: { missing: readonly MissingPermission[] }) {
  if (props.missing.length === 0) return null;
  return (
    <Banner tone="neg" icon="lock" title="RPE's extension is missing permissions">
      <span>Until an admin grants them in Lumiverse, chats on RPE's connection are not played.</span>
      <ul class="rpe-reports">
        {props.missing.map((m) => (
          <li key={m.permission}>
            <strong>{m.permission}</strong>: {m.why}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/** The road line and the extension's missing permissions, as the client says them now. */
export function Notices() {
  const app = useApp();
  const state = useSelect(app.client.state, (s) => s);
  const missing = useSelect(app.client.missing, (m) => m);
  return (
    <div class="lre-stack rpe-notices">
      <RoadLine state={state} onRetry={() => app.client.reconnect()} />
      <MissingNotice missing={missing} />
    </div>
  );
}
