// Which connections an agent of the story may run on (DEPTH2-PLAN §6.3; PI-BUILD-PLAN §4.3): the
// runtime's own. The agents call their providers from the runtime, on the connections it keeps
// with their keys and sign-ins (Harness → System → Runtime → Connections), not on Lumiverse's.
// Which those are is LumiAH's to say: its pages' app, built into ours, reads the list of the
// runtime that plays the chat (a chat's view names it), else of the user's runtime heard from last,
// and the drawer hands it down (`ConnectionsContext`, filled in `harness/pages.tsx`), so nothing
// here imports LumiAH. A page that offers connections asks LumiAH for its state when it opens, if
// nothing has yet.
//
// A choice saved before the runtime kept its own connections names one of Lumiverse's: it stays as
// saved and is shown as such, named from Lumiverse's own list, with what the agent runs on instead
// (the runtime's default) and the way to choose again. "Copy from Lumiverse" copies a connection
// into the runtime under the same id, so such a choice works again once its connection is copied.

import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import type { ModelPick } from "../../shared/settings";
import { useApp } from "../app";
import { HARNESS_MODE, harnessChat } from "../harness/mode";
import { type Connection, useConnections } from "../settings/steps";
import { useSelect } from "../store";

/** One of the runtime's connections, as a picker names and offers it. */
export interface RuntimeConnection {
  id: string;
  name: string;
  /** The connection in one line, as LumiAH's pickers list it: "Claude · Anthropic · claude-sonnet-4-5". */
  label: string;
  /** Its own model, for an agent that names none; null where it names none. */
  model: string | null;
}

/** The runtime's connections as LumiAH's pages know them for a chat. */
export interface KnownConnections {
  /** As last read; null before a read answered. Kept while the runtime is away, for the names it gives. */
  list: readonly RuntimeConnection[] | null;
  /** The default's id: what an agent that names no connection, or one the runtime doesn't have, runs on; null for none. */
  default: string | null;
  /** The runtime the list is of (its relay), once read. */
  runtime: { id: string; name: string } | null;
  /** Whether the runtime the list is asked of is linked now. */
  linked: boolean;
  /** How many of the user's runtimes are linked: each keeps connections of its own. */
  runtimes: number;
  /** Whether it is the runtime that plays the chat (else the one heard from last). */
  chat: boolean;
  /** Why the last read failed; null when it didn't. */
  failed: string | null;
}

/** What a page asks of LumiAH about the runtime's connections. */
export interface ConnectionsPort {
  /**
   * The runtime's connections for a chat (null: the chat open in Lumiverse), read while a page shows
   * them and kept current. A hook: the drawer's port is the same for its whole life, so a page calls
   * the same hooks every time.
   */
  useKnown(chatId: string | null): KnownConnections;
  /** The models a connection of `runtime` offers (null: the default's), as the runtime lists them. */
  models(runtime: string | null, connectionId: string | null): Promise<readonly { id: string; name: string }[]>;
  /** Opens LumiAH's Runtime page at its Connections section (the Harness tab shows it once it is opened). */
  open(): void;
  /** Says hello to LumiAH's backend, the first time it is called. */
  start(): void;
}

export const ConnectionsContext = createContext<ConnectionsPort | null>(null);

/** The connections an agent may be set to, and what a picker says of them. */
export interface AgentConnections {
  /** The runtime's connections; null while they aren't known. */
  choices: readonly RuntimeConnection[] | null;
  /** The runtime's default connection; null where it has none, or while that isn't known. */
  fallback: RuntimeConnection | null;
  /** Lumiverse's own connections: only to name a choice saved before the runtime kept its own. */
  lumiverse: readonly Connection[];
  /** The runtime the list is of, whose models a model picker lists; null while it isn't known. */
  runtime: string | null;
  /** Why none can be chosen now, in words; null once they can. */
  waiting: string | null;
  /** Whose connections these are, where several runtimes are linked; null where one is. */
  whose: string | null;
  /** The runtime is linked and keeps no connection at all: no agent can run. */
  none: boolean;
}

/** What an agent with no connection set runs on: the runtime's default, named where it is known. */
export function unsetText(connections: Pick<AgentConnections, "choices" | "fallback">): string {
  if (connections.choices !== null && connections.fallback === null) return "With no connection set, an agent runs on the runtime's default connection, and the runtime has none now, so its calls are refused. Make one of its connections the default in Harness → System → Runtime → Connections.";
  return `With no connection set, an agent runs on the runtime's default connection${connections.fallback !== null ? ` (now ${connections.fallback.name})` : ""}.`;
}

/** What a page says while the runtime keeps no connection, and what to do: its title and its words. */
export const NO_CONNECTION = {
  title: "Your runtime has no connection yet",
  text: "The harness's agents call your providers from the runtime, on connections the runtime keeps itself, and yours has none yet, so no turn can be played. Open Harness → System → Runtime → Connections and add one (the provider, and your key or a sign-in to your account), or press Copy from Lumiverse there to bring over the connections you use in Lumiverse: you type each one's key again.",
  /** The same in a line, under a picker of connections. */
  line: "The runtime has no connection yet: add one in Harness → System → Runtime → Connections, or bring yours over with Copy from Lumiverse there.",
} as const;

/** Why the runtime's connections can't be listed now, in a line; null where they are known. */
function waitingText(known: KnownConnections | null): string | null {
  if (known === null) return "The harness's pages aren't loaded in this LumiRPEngine, so the runtime's connections can't be read. Reload the page to try again.";
  if (known.list !== null) return null;
  if (known.failed !== null) return `The runtime's connections couldn't be read: ${known.failed}`;
  if (!known.linked) return "The agents' connections are kept in the runtime, so they show once it is linked. Harness → System → Runtime shows how to start it.";
  return "Reading the runtime's connections…";
}

/** The connections an agent may be set to, as LumiAH says now (null: there is no LumiAH to ask); `lumiverse`, Lumiverse's own, to name an old choice. */
export function agentConnections(known: KnownConnections | null, lumiverse: readonly Connection[]): AgentConnections {
  const list = known?.list ?? null;
  return {
    choices: list,
    fallback: list?.find((c) => c.id === known?.default) ?? null,
    lumiverse,
    runtime: known?.runtime?.id ?? null,
    waiting: waitingText(known),
    whose: known !== null && known.runtime !== null && known.runtimes > 1 ? `These are the connections of ${known.runtime.name}, ${known.chat ? "the runtime that plays this chat" : "the runtime heard from last"}. Each runtime keeps its own, and an agent runs on those of the runtime its chat runs in.` : null,
    none: known !== null && known.linked && list !== null && list.length === 0,
  };
}

/** Whether a level names a connection the runtime doesn't have: one of Lumiverse's saved before this build, or one removed since. False while the runtime's list isn't known. */
export function notTheRuntimes(pick: ModelPick | undefined, connections: Pick<AgentConnections, "choices">): boolean {
  const id = pick?.connectionId;
  return id !== undefined && connections.choices !== null && !connections.choices.some((c) => c.id === id);
}

/** A connection a choice names, by its name: the runtime's, else Lumiverse's for a choice saved before, else its id. */
export function connectionName(id: string, connections: Pick<AgentConnections, "choices" | "lumiverse">): string {
  return connections.choices?.find((c) => c.id === id)?.name ?? connections.lumiverse.find((c) => c.id === id)?.name ?? id;
}

/** What a choice of a connection the runtime doesn't have says beside its name: what its agent runs on instead, the runtime's default, or nothing where the runtime has none. */
export function notTheRuntimesMark(connections: Pick<AgentConnections, "fallback">): string {
  return connections.fallback !== null ? "not one of the runtime's connections: runs on its default" : "not one of the runtime's connections, and the runtime has no default: refused";
}

/** What a choice of a connection the runtime doesn't have says: what the agent runs on instead, and how to choose again (`where`: "here", or where the picker is). */
export function notTheRuntimesText(id: string, connections: Pick<AgentConnections, "fallback" | "lumiverse">, where = "here"): string {
  const lumiverse = connections.lumiverse.find((c) => c.id === id) ?? null;
  const which = lumiverse !== null ? `${lumiverse.name} is one of Lumiverse's connections, not one of the runtime's` : "This isn't one of the runtime's connections";
  const instead = connections.fallback !== null ? `, so it runs on the runtime's default, ${connections.fallback.name}.` : ", and the runtime has no default connection, so its calls are refused.";
  const again = lumiverse !== null ? ` Pick another ${where}, or copy it into the runtime (Harness → System → Runtime → Connections → Copy from Lumiverse): the copy keeps its id, so this choice works again.` : ` Pick another ${where} to choose again.`;
  return `${which}${instead}${again}`;
}

const NOTHING_KNOWN: KnownConnections = { list: null, default: null, runtime: null, linked: false, runtimes: 0, chat: false, failed: null };
const NO_PORT: ConnectionsPort = { useKnown: () => NOTHING_KNOWN, models: () => Promise.resolve([]), open: () => undefined, start: () => undefined };

/** `agentConnections` as LumiAH and Lumiverse say now, for a chat (null: the open one); asks LumiAH for its state where nothing has yet. */
export function useAgentConnections(chatId: string | null = null): AgentConnections {
  const port = useContext(ConnectionsContext);
  // The drawer's port is fixed for its life (it has LumiAH's pages or not), so the hooks called here are always the same ones.
  const known = (port ?? NO_PORT).useKnown(chatId);
  const lumiverse = useConnections();
  useEffect(() => {
    port?.start();
  }, [port]);
  return agentConnections(port === null ? null : known, lumiverse);
}

/**
 * The way to Harness → System → Runtime → Connections from a page of ours: LumiAH's Runtime page
 * at that section, in the drawer's Harness tab (behind its curtain until that is opened). Null
 * where the drawer has no LumiAH pages, or the tab isn't offered (the open chat doesn't play on the
 * harness).
 */
export function useOpenConnections(): (() => void) | null {
  const port = useContext(ConnectionsContext);
  const app = useApp();
  const offered = useSelect(app.sync, harnessChat) === true;
  if (port === null || !offered) return null;
  return () => {
    port.open();
    app.ui.update((ui) => ({ ...ui, mode: HARNESS_MODE.id, harness: { page: "agents" } }));
  };
}
