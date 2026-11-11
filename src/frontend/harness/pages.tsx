// LumiAH's pages inside the drawer's Harness tab: the one place of the frontend that imports LumiAH
// (`lumi-ah/...`). LumiAH is the agent harness built into LumiRPEngine: its backend is mounted in
// ours and answers its pages' `lah.*` messages over the channel our own `lre.*` messages use, each
// side ignoring the other's. The pages are LumiAH's own shell and views, under our mode bar; LumiAH's
// one stylesheet (`HARNESS_PAGES_CSS`) styles them, and styles/harness.ts holds what sitting in our
// drawer changes of their layout.
//
// - Which pages (`HARNESS_PAGES`). What the agents are doing comes first, then what they keep and
//   how they are set up; a runtime, its key and its connection are optional and come last.
// - The curtain. The pages show the agents' work whole: what they read of the world, secrets marked,
//   and what they think. That is GM-level, like GM → Live and Settings → Diagnostics, so the tab
//   opens behind the same kind of gate, opened for one chat and closed again on leaving the tab.
// - Hello. Nothing of LumiAH's is asked for until a chat on the harness is open (`start`).

import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { type App as PagesApp, AppContext as PagesContext, createApp, createHost, CSS, type PageId, type PrefsStorage, Shell } from "lumi-ah/extension/frontend";
import type { FrontendToBackend, UiState } from "lumi-ah/shared";
import { useState } from "preact/hooks";
import { useApp } from "../app";
import { Button } from "../components";
import { Icon } from "../icons";
import { type Readable, useSelect } from "../store";

/** LumiAH's stylesheet, added to the page once beside ours. Its every class, variable, animation and container is `lah`-named, ours `lre`-named, so neither restyles the other. */
export const HARNESS_PAGES_CSS: string = CSS;

/**
 * The pages the tab offers, in the order LumiAH's bar shows them (it keeps its own groups and order
 * and takes only which pages; a test holds the two to each other):
 * - Now: Live (the turn as the agents work it, where the tab opens), Sessions (past turns), Jobs
 *   (what runs after a reply) and Talk (a conversation with an agent outside the chat: a tool call
 *   held in one, GM → Assistant's among them, is answered on it, so leaving it out would strand
 *   that call).
 * - Story: Workspace (the agents' files) and Guidance (their standing instructions).
 * - Agents: each agent, the skills and the tools.
 * - System: Settings, Spend, Storage, and Runtime last: starting one is optional, and few need it.
 *
 * Left out, each because our drawer has the one place for it:
 * - Home: it is LumiAH's switch for the chat, and GM → This chat → Engine is the one control. What
 *   else it says (what waits for the user) LumiAH says on every other page.
 * - Lore: in a chat the engine plays, World Info is the engine's to read, through its own lore tools
 *   and under its secrets rule. LumiAH is shown no book there, so its page has none to show.
 * - Chronicle: what the story has established is the world's own record here, kept turn by turn and
 *   shown in Play and GM. One learned from the chat's text would be a second account of it.
 */
export const HARNESS_PAGES: readonly PageId[] = ["live", "sessions", "jobs", "talk", "workspace", "guidance", "agents", "skills", "tools", "settings", "spend", "upkeep", "runtime"];

/** LumiAH's pages as our frontend holds them. */
export interface HarnessPages {
  /** LumiAH's own app: its client and state, the page shown, this device's preferences. */
  app: PagesApp;
  /** Says hello to LumiAH's backend, the first time it is called: the pages hold its state from then on. */
  start(): void;
  dispose(): void;
}

/** This browser's storage for LumiAH's preferences on this device; null where the browser blocks it (a private window, a sandboxed frame). */
function deviceStorage(): PrefsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** LumiAH's pages over Spindle's messaging and what they borrow from the host. Nothing is sent until `start`. */
export function createHarnessPages(ctx: SpindleFrontendContext): HarnessPages {
  const host = createHost(ctx);
  const app = createApp({ channel: { send: (payload: FrontendToBackend) => ctx.sendToBackend(payload), subscribe: (handler) => ctx.onBackendMessage(handler) }, host, storage: deviceStorage() });
  let started = false;
  // The page may have missed pushes (its socket came back, the tab was out of view): the state is read again, once there is one to read.
  const unwatch = host.watch(() => {
    if (started) app.client.resync();
  });
  return {
    app,
    start() {
      if (started) return;
      started = true;
      void app.client.sync();
    },
    dispose() {
      unwatch();
      app.client.dispose();
      host.dispose();
    },
  };
}

/**
 * How many things of the harness's wait for the user: tool calls held for their word, and jobs that
 * failed, were cut off or need them. A job that only finished is news, not a call on them. LumiAH's
 * own tab says this with its badge; here the Harness tab's mark does, from any mode.
 */
export function waitingOf(state: { approvals: readonly unknown[]; notices: readonly { kind: string }[] } | null): number {
  if (state === null) return 0;
  return state.approvals.length + state.notices.filter((notice) => notice.kind !== "job_done").length;
}

const NO_STATE: Readable<UiState | null> = { get: () => null, subscribe: () => () => undefined };

/** `waitingOf` LumiAH's state as it changes; 0 where the drawer has no pages. */
export function useWaiting(pages: HarnessPages | null): number {
  return useSelect(pages?.app.client.state ?? NO_STATE, waitingOf);
}

/**
 * In front of the pages while the curtain is closed: what the harness is, in a line for someone who
 * has never met one, and what the pages give away. It wears the GM gate's look (its classes), since
 * it makes the same promise: nothing GM-level shows until it is asked for.
 */
export function HarnessCurtain(props: { onReveal(): void }) {
  return (
    <div class="lre-gm-gate lre-harness-curtain" data-lre-harness-curtain>
      <span class="lre-gm-gate-icon">
        <Icon name="eye-off" size={24} />
      </span>
      <h2 class="lre-gm-gate-title">Spoilers ahead</h2>
      <p class="lre-gm-gate-text">The harness is the AI author that plays this chat's turns, with the agents it starts. These pages show them at work and how they are set up: everything they read of the world and everything they think, secrets and hidden agendas among it.</p>
      <Button variant="primary" icon="eye" onClick={props.onReveal}>
        Show the agents at work
      </Button>
      <p class="lre-gm-gate-note">The pages close again when you leave this tab or open another chat.</p>
    </div>
  );
}

/** The tab's body, without hooks: the curtain while it is closed, else LumiAH's shell with the pages offered. Behind a closed curtain no page is drawn, so none asks for anything. */
export function HarnessView(props: { pages: HarnessPages; revealed: boolean; onReveal(): void }) {
  return (
    <div class="lre-harness" data-lre-section="harness">
      {props.revealed ? (
        <PagesContext.Provider value={props.pages.app}>
          <Shell pages={HARNESS_PAGES} />
        </PagesContext.Provider>
      ) : (
        <HarnessCurtain onReveal={props.onReveal} />
      )}
    </div>
  );
}

/** The Harness tab. The curtain is opened for the chat that is open: another chat's pages wait behind it again, and so does this one's once the tab is left (its state goes with it). */
export function HarnessTab(props: { pages: HarnessPages }) {
  const app = useApp();
  const chatId = useSelect(app.sync, (state) => state.chatId);
  const [shownFor, setShownFor] = useState<string | null>(null);
  return <HarnessView pages={props.pages} revealed={chatId !== null && shownFor === chatId} onReveal={() => setShownFor(chatId)} />;
}
