// His own connections in Lumiverse, read for the Connections page's "Copy from Lumiverse" (STANDALONE-PLAN
// §4.1 l.205; READINGS R-2): Lumiverse's own list of his connections (`GET /api/v1/connections`, every
// page of it), read through the door's session as RPE's user, so only his, and only when called: the
// page calls it on his press. Each is given as what it is, its name, provider, address and model. Its
// key is never read: Lumiverse's list says only whether it has one, and that is left too.

import { everyConnection } from "./install-calls";
import type { LumiverseSession } from "./session";

/** One of his connections in Lumiverse, to copy into RPE's. */
export interface LumiverseConnection {
  name: string;
  /** Lumiverse's id for its provider (`custom` for an OpenAI-compatible one). */
  provider: string;
  /** Its address (`api_url`); empty where the provider gives its own. */
  address: string;
  model: string;
}

/** His connections in Lumiverse, the most recently changed first, as Lumiverse lists them. */
export async function lumiverseConnections(session: Pick<LumiverseSession, "request">): Promise<LumiverseConnection[]> {
  const connections = await everyConnection((method, path, body) => session.request(method, path, body));
  return connections.map((c) => ({ name: c.name, provider: c.provider, address: c.api_url, model: c.model }));
}
