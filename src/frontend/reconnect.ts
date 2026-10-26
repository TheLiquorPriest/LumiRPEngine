// When a page asks the engine again (DESIGN §5.1, ARCHITECTURE §4). Lumiverse drops what a page
// sends while its socket is down, before Lumiverse has authenticated it, and while the engine's
// worker restarts, without a word; the page learns only that the socket is back or the engine
// started again. So it asks again then:
// - when Lumiverse acknowledges the socket: its CONNECTED names the user. The CONNECTED a socket
//   emits as it opens comes before Lumiverse authenticated it, so what a page sends then is dropped
//   too (Lumiverse's own pages resync on the acknowledgement alone);
// - when its own engine started again (`SPINDLE_EXTENSION_LOADED` naming this installation): a
//   restart that doesn't reload the page leaves it a view and a running line from the old worker.

import { isRecord } from "../shared/json";

/** The host's event subscription (`ctx.events`). */
export interface HostEvents {
  on(event: string, handler: (payload: unknown) => void): () => void;
}

/** Calls `recheck` each time the page should ask again; returns the unsubscribe. `installationId` is `ctx.host.extensionInstallationId`, null where the host names none. */
export function watchReconnects(events: HostEvents, installationId: string | null, recheck: () => void): () => void {
  const offConnected = events.on("CONNECTED", (payload) => {
    if (isRecord(payload) && ((typeof payload.userId === "string" && payload.userId !== "") || (typeof payload.role === "string" && payload.role !== ""))) recheck();
  });
  const offLoaded = events.on("SPINDLE_EXTENSION_LOADED", (payload) => {
    if (installationId !== null && isRecord(payload) && payload.extensionId === installationId) recheck();
  });
  return () => {
    offConnected();
    offLoaded();
  };
}
