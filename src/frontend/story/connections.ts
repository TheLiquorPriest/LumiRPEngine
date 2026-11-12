// Which connections an agent of the story may run on (DEPTH2-PLAN §6.3): the user's Lumiverse
// connections, less every loopback one. A loopback connection is the runtime's own way in, so an
// agent set to it would call back into the runtime. Which connections are loopbacks is LumiAH's to
// say: its backend, built into ours, lists the user's connections with that mark, and the drawer
// hands the list down (`ConnectionsContext`, filled in `harness/pages.tsx`), so nothing here imports
// LumiAH or reads anything into a name. A page that offers connections asks LumiAH for its list when
// it opens, if nothing has yet. A saved choice of a loopback is shown as a problem to fix.

import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import type { ModelPick } from "../../shared/settings";
import { type Connection, useConnections } from "../settings/steps";
import { type Readable, useSelect } from "../store";

/** LumiAH's state as far as these pages read it: the user's connections, each with whether it is a loopback. */
export interface KnownConnections {
  connections: readonly { id: string; loopback: boolean }[];
}

/** LumiAH's state (null until it has answered), whether it can't answer, and the way to ask it, once. */
export interface ConnectionsPort {
  state: Readable<KnownConnections | null>;
  failed: Readable<boolean>;
  start(): void;
}

export const ConnectionsContext = createContext<ConnectionsPort | null>(null);

/** The connections an agent may be set to. */
export interface AgentConnections {
  /** Every connection Lumiverse lists: what a saved choice is named by. */
  all: readonly Connection[];
  /** Those an agent may run on; null until LumiAH has said which are loopbacks. */
  choices: readonly Connection[] | null;
  /** The loopback connections' ids, as LumiAH marks them. */
  loopback: ReadonlySet<string>;
  /** Why none can be chosen yet, in words; null once they can. */
  waiting: string | null;
}

/** What an agent with no connection set runs on. */
export const UNSET_CONNECTION = "With no connection set, an agent runs on the connection its chat was on before it moved to the runtime, or on Lumiverse's default connection if it had none.";

/** What a saved choice of a loopback connection says. */
export const LOOPBACK_PROBLEM = "This is the runtime's own connection, so an agent set to it would call back into the runtime. Choose another connection, or Not set.";

/** The connections an agent may run on: every one Lumiverse lists but the loopbacks; none while LumiAH hasn't said which those are. */
export function agentConnections(all: readonly Connection[], loopbackIds: readonly string[] | null, failed: boolean): AgentConnections {
  const loopback = new Set(loopbackIds ?? []);
  if (loopbackIds === null) return { all, choices: null, loopback, waiting: failed ? "LumiAH couldn't say which connections are the runtime's own, so none can be chosen now. Reload the page to try again." : "Reading which connections are the runtime's own…" };
  return { all, choices: all.filter((c) => !loopback.has(c.id)), loopback, waiting: null };
}

/** Whether a level's connection is a loopback. */
export function onLoopback(pick: ModelPick | undefined, loopback: ReadonlySet<string>): boolean {
  return pick?.connectionId !== undefined && loopback.has(pick.connectionId);
}

const NONE: Readable<KnownConnections | null> = { get: () => null, subscribe: () => () => undefined };
const FINE: Readable<boolean> = { get: () => false, subscribe: () => () => undefined };

/** `agentConnections` as Lumiverse and LumiAH say now; asks LumiAH for its state where nothing has yet. */
export function useAgentConnections(): AgentConnections {
  const port = useContext(ConnectionsContext);
  const all = useConnections();
  // As one string, so a push that leaves the loopbacks as they were draws nothing anew.
  const ids = useSelect(port?.state ?? NONE, (state) => (state === null ? null : state.connections.filter((c) => c.loopback).map((c) => c.id).join("\n")));
  const failed = useSelect(port?.failed ?? FINE, (value) => value);
  useEffect(() => {
    port?.start();
  }, [port]);
  return agentConnections(all, ids === null ? null : ids.split("\n").filter((id) => id !== ""), failed || port === null);
}
