// The install's calls into Lumiverse (plan §4.6; READINGS R-2): RPE's connection there, made through
// Lumiverse's own connections API as the signed-in user (its `src/routes/connections.routes.ts`,
// mounted at `/api/v1/connections`), and the list of its extensions. They are the door's, so that
// nothing but `src/adapter/lumiverse/` names a route of Lumiverse's; the command line signs in and
// hands over its calls.
//
// RPE's connection is an OpenAI-compatible one pointed at this RPE's `/v1`, with the provider key.
// Whatever already matches is left as it is, so running `rpe up` again changes nothing. The connection
// today's build made for its runtime is never changed (§15.6: going back needs it as it is). Every
// connection RPE takes carries RPE's mark in its own metadata from the moment it is taken, so the
// extension can tell an RPE chat from Lumiverse's own record without asking RPE; Lumiverse replaces a
// connection's metadata whole on an update (`src/services/connections.service.ts:517`), so a change
// writes the metadata it read back, with RPE's one key of it added.

import { isRecord } from "../../shared/json";
import { RPE_MARK, RPE_MARK_KEY, rpeMarked } from "./pipe-wire";

/** Lumiverse's id for an OpenAI-compatible connection (its `src/llm/providers/custom.ts`). */
export const OPENAI_COMPATIBLE = "custom";
/** The name a new connection is given; a name the user gave it later is kept. */
export const CONNECTION_NAME = "RPE";
const CONNECTIONS = "/api/v1/connections";
/** The model of the connection today's build made for its runtime: LumiAH's own, or one that starts with it (LumiAH `link/contract.ts`, `loopbackModel`). */
export const TODAYS_MODEL = /^lumiah(-|$)/;

/** The most connections Lumiverse answers in one page (`src/types/pagination.ts`: `MAX_LIMIT`; 50 where none is asked for). */
const PAGE = 1000;

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
  /** What was changed on a connection that was there: the fields' names, `key` for a new key, `mark` for RPE's mark. */
  changed: string[];
  /** Whether a new provider key was made for it. */
  newKey: boolean;
  /** The connection RPE's config named, where it is the one today's build made for its runtime: left as it is, and RPE's own made beside it. */
  todays: string | null;
}

/** Lumiverse's answer as JSON, or its refusal as an error in its own words. */
export async function answer(res: Response, what: string): Promise<unknown> {
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
  metadata: Record<string, unknown>;
}

function readProfile(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.provider !== "string" || typeof value.api_url !== "string" || typeof value.model !== "string" || typeof value.has_api_key !== "boolean") return null;
  return { id: value.id, name: value.name, provider: value.provider, api_url: value.api_url, model: value.model, has_api_key: value.has_api_key, metadata: isRecord(value.metadata) ? value.metadata : {} };
}

function profileOf(value: unknown, what: string): Profile {
  const profile = readProfile(value);
  if (profile === null) throw new Error(`Lumiverse answered ${what} with something that is not a connection.`);
  return profile;
}

/** Whether a connection carries RPE's mark. */
const marked = (profile: Profile): boolean => rpeMarked(profile.metadata);

/** The metadata a connection is written with: what it had, and RPE's mark. */
const withMark = (metadata: Record<string, unknown>): Record<string, unknown> => ({ ...metadata, [RPE_MARK_KEY]: RPE_MARK });

/**
 * Every connection of the signed-in user in Lumiverse, page after page until none is left, each page
 * as large as Lumiverse allows. Lumiverse answers `{ data, total, limit, offset }`; a bare list is
 * read as it comes, as one from before it was paged.
 */
async function everyConnection(call: LumiverseCall): Promise<Profile[]> {
  const found: Profile[] = [];
  for (let offset = 0; ; ) {
    const body = await answer(await call("GET", `${CONNECTIONS}?limit=${PAGE}&offset=${offset}`), "the question about your connections");
    const rows = isRecord(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
    for (const row of rows) {
      const profile = readProfile(row);
      if (profile !== null) found.push(profile);
    }
    const total = isRecord(body) && typeof body.total === "number" ? body.total : null;
    offset += rows.length;
    if (rows.length === 0 || total === null || offset >= total) return found;
  }
}

const sameAddress = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * Makes RPE's connection in Lumiverse, or brings the one `known` names into line: Lumiverse's
 * OpenAI-compatible provider, this RPE's `/v1`, one of RPE's model names, a key RPE takes, and RPE's
 * mark, each in the call that makes or changes it. Where RPE's config names none (it was lost), the
 * one at RPE's address on one of RPE's models is taken again, and no second is made. A `known` that is
 * today's build's connection is never changed: it is RPE's as it is where RPE answers to its model
 * name, which RPE does once the swap has taken it over; else RPE makes its own instead.
 */
export async function settleConnection(call: LumiverseCall, known: string | null, wanted: WantedConnection): Promise<SettledConnection> {
  const model = wanted.models[0];
  if (model === undefined) throw new Error("lumiverse.models in RPE's config names no model, and RPE's connection needs one: name at least one.");
  let found: Profile | null = null;
  let todays: string | null = null;
  if (known !== null) {
    const what = `the connection ${known}`;
    const res = await call("GET", `${CONNECTIONS}/${encodeURIComponent(known)}`);
    // Removed in Lumiverse since: it is looked for again, then made again.
    if (res.status !== 404) found = profileOf(await answer(res, `the question about ${what}`), what);
    if (found !== null && TODAYS_MODEL.test(found.model)) {
      if (wanted.models.includes(found.model)) return { id: found.id, name: found.name, made: false, changed: [], newKey: false, todays: null };
      [todays, found] = [found.id, null];
    }
  }
  if (found === null) {
    // By its address and model: the connection RPE made, whose id its config lost. One that is today's, or another provider's, is not.
    const own = (await everyConnection(call)).find((p) => p.provider === OPENAI_COMPATIBLE && !TODAYS_MODEL.test(p.model) && wanted.models.includes(p.model) && sameAddress(p.api_url, wanted.apiUrl) && p.id !== todays);
    found = own ?? null;
  }
  if (found === null) {
    const key = wanted.makeKey();
    const made = profileOf(await answer(await call("POST", CONNECTIONS, { name: CONNECTION_NAME, provider: OPENAI_COMPATIBLE, api_url: wanted.apiUrl, model, api_key: key, metadata: withMark({}) }), "making RPE's connection"), "making RPE's connection");
    return { id: made.id, name: made.name, made: true, changed: [], newKey: true, todays };
  }
  const change: Record<string, unknown> = {};
  if (found.provider !== OPENAI_COMPATIBLE) change.provider = OPENAI_COMPATIBLE;
  if (!sameAddress(found.api_url, wanted.apiUrl)) change.api_url = wanted.apiUrl;
  if (!wanted.models.includes(found.model)) change.model = model;
  const newKey = !wanted.hasKey || !found.has_api_key;
  if (newKey) change.api_key = wanted.makeKey();
  if (!marked(found)) change.metadata = withMark(found.metadata);
  const changed = Object.keys(change).map((field) => (field === "api_key" ? "key" : field === "metadata" ? "mark" : field));
  if (changed.length > 0) await answer(await call("PUT", `${CONNECTIONS}/${encodeURIComponent(found.id)}`, change), `the change to RPE's connection ${found.id}`);
  return { id: found.id, name: found.name, made: false, changed, newKey, todays };
}

/**
 * Marks the connection `id` as RPE's, or takes the mark off: its metadata is read and written back
 * with RPE's one key of it added or taken out and nothing else changed. Says whether it was changed;
 * a connection already as asked is not written to.
 */
export async function markConnection(call: LumiverseCall, id: string, mark: boolean): Promise<boolean> {
  const what = `the connection ${id}`;
  const profile = profileOf(await answer(await call("GET", `${CONNECTIONS}/${encodeURIComponent(id)}`), `the question about ${what}`), what);
  if (marked(profile) === mark) return false;
  const metadata = mark ? withMark(profile.metadata) : Object.fromEntries(Object.entries(profile.metadata).filter(([key]) => key !== RPE_MARK_KEY));
  await answer(await call("PUT", `${CONNECTIONS}/${encodeURIComponent(id)}`, { metadata }), `the ${mark ? "mark" : "unmarking"} of ${what}`);
  return true;
}

/**
 * The user's connections in Lumiverse that `is` takes for today's loopback, newest first, read as
 * today's runtime reads them (LumiAH `connectionProfiles`, `loopbackProfile`): Lumiverse's
 * OpenAI-compatible ones, every one there is, each with the model name it names, under which RPE
 * answers it once it is RPE's (R-109).
 */
export async function connectionsWhere(call: LumiverseCall, is: (connection: { model: string; url: string }) => boolean): Promise<{ id: string; name: string; model: string }[]> {
  return (await everyConnection(call)).flatMap((p) => (p.provider === OPENAI_COMPATIBLE && is({ model: p.model, url: p.api_url }) ? [{ id: p.id, name: p.name, model: p.model }] : []));
}

/**
 * The extension `identifier` as Lumiverse lists it for the signed-in user (`GET /api/v1/spindle`):
 * whether it is switched on, and the permissions its installed manifest asks for (null where
 * Lumiverse doesn't say); null where it isn't installed.
 */
export async function installedExtension(call: LumiverseCall, identifier: string): Promise<{ on: boolean; permissions: string[] | null } | null> {
  const body = await answer(await call("GET", "/api/v1/spindle"), "the list of its extensions");
  const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === identifier) : undefined;
  if (!isRecord(found)) return null;
  return { on: found.enabled === true, permissions: Array.isArray(found.permissions) ? found.permissions.filter((p): p is string => typeof p === "string") : null };
}
