// `rpe up`'s part in Lumiverse (plan §4.6): RPE's connection there, made through Lumiverse's own
// connections API as the signed-in user (Lumiverse's `src/routes/connections.routes.ts`, mounted at
// `/api/v1/connections`). It is an OpenAI-compatible connection pointed at this RPE's `/v1` with the
// provider key. Whatever already matches is left as it is, so running `rpe up` again changes nothing.
// The command line signs in and hands over its calls; this file names no other area.

import { isRecord } from "../shared/json";

/** Lumiverse's id for an OpenAI-compatible connection (its `src/llm/providers/custom.ts`). */
export const OPENAI_COMPATIBLE = "custom";
/** The name a new connection is given; a name the user gave it later is kept. */
export const CONNECTION_NAME = "RPE";
const CONNECTIONS = "/api/v1/connections";

/** One call to Lumiverse as the signed-in user: a path under its address, a JSON body. */
export type LumiverseCall = (method: string, path: string, body?: unknown) => Promise<Response>;

export interface WantedConnection {
  /** This RPE's `/v1`, as Lumiverse reaches it. */
  apiUrl: string;
  /** The model names RPE offers (`lumiverse.models`); a connection on one of them keeps it. */
  models: readonly string[];
  /** Whether this RPE has a provider key in force. Its key is kept only as a hash, so a connection without it is given a new one. */
  hasKey: boolean;
  /** Makes a new provider key (the one before it stops working) and gives it. */
  makeKey(): string;
}

export interface SettledConnection {
  id: string;
  name: string;
  made: boolean;
  /** What was changed on a connection that was there: the fields' names, and `key` for a new key. */
  changed: string[];
  /** Whether a new provider key was made for it. */
  newKey: boolean;
}

/** Lumiverse's answer as JSON, or its refusal as an error in its own words. */
async function answer(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    throw new Error(`Lumiverse answered ${what} with something that is not JSON (${res.status}).`);
  }
  if (!res.ok) throw new Error(`Lumiverse refused ${what} (${res.status})${isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : ""}.`);
  return body;
}

interface Profile {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
}

function profileOf(value: unknown, what: string): Profile {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.provider !== "string" || typeof value.api_url !== "string" || typeof value.model !== "string" || typeof value.has_api_key !== "boolean") throw new Error(`Lumiverse answered ${what} with something that is not a connection.`);
  return { id: value.id, name: value.name, provider: value.provider, api_url: value.api_url, model: value.model, has_api_key: value.has_api_key };
}

/**
 * Makes RPE's connection in Lumiverse, or brings the one `known` names into line: Lumiverse's
 * OpenAI-compatible provider, this RPE's `/v1`, one of RPE's model names, and a key RPE takes.
 */
export async function settleConnection(call: LumiverseCall, known: string | null, wanted: WantedConnection): Promise<SettledConnection> {
  const model = wanted.models[0];
  if (model === undefined) throw new Error("lumiverse.models in RPE's config names no model, and RPE's connection needs one: name at least one.");
  let found: Profile | null = null;
  if (known !== null) {
    const what = `the connection ${known}`;
    const res = await call("GET", `${CONNECTIONS}/${encodeURIComponent(known)}`);
    // Removed in Lumiverse since: it is made again.
    if (res.status !== 404) found = profileOf(await answer(res, `the question about ${what}`), what);
  }
  if (found === null) {
    const key = wanted.makeKey();
    const made = profileOf(await answer(await call("POST", CONNECTIONS, { name: CONNECTION_NAME, provider: OPENAI_COMPATIBLE, api_url: wanted.apiUrl, model, api_key: key }), "making RPE's connection"), "making RPE's connection");
    return { id: made.id, name: made.name, made: true, changed: [], newKey: true };
  }
  const change: Record<string, string> = {};
  if (found.provider !== OPENAI_COMPATIBLE) change.provider = OPENAI_COMPATIBLE;
  if (found.api_url.replace(/\/+$/, "") !== wanted.apiUrl) change.api_url = wanted.apiUrl;
  if (!wanted.models.includes(found.model)) change.model = model;
  const newKey = !wanted.hasKey || !found.has_api_key;
  if (newKey) change.api_key = wanted.makeKey();
  const changed = Object.keys(change).map((field) => (field === "api_key" ? "key" : field));
  if (changed.length > 0) await answer(await call("PUT", `${CONNECTIONS}/${encodeURIComponent(found.id)}`, change), `the change to RPE's connection ${found.id}`);
  return { id: found.id, name: found.name, made: false, changed, newKey };
}

/** Whether the extension `identifier` is installed for the signed-in user, and switched on (Lumiverse's `GET /api/v1/spindle`). */
export async function extensionState(call: LumiverseCall, identifier: string): Promise<"missing" | "off" | "on"> {
  const body = await answer(await call("GET", "/api/v1/spindle"), "the list of its extensions");
  const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === identifier) : undefined;
  if (!isRecord(found)) return "missing";
  return found.enabled === true ? "on" : "off";
}
