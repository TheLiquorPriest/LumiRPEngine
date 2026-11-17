// What RPE, its light extension and a Lumiverse page say to each other over the pipe (STANDALONE-PLAN
// §4.3): RPE's registration, which tells the extension where RPE is and what proves the extension to
// it; a page's start-up facts; a page's request carried to RPE and its answer carried back; and the
// live updates a page follows, which RPE sends on its relay socket for the extension to hand on. Pure,
// and free of anything Lumiverse scans an extension's backend for: the extension's bundle carries it.
//
// The roads: RPE to the extension is a `SPINDLE_BACKEND_MSG` frame on RPE's relay socket, which
// Lumiverse hands to the extension's `onFrontendMessage` with the socket's user and frontend session
// (`ws/handler.ts:440-467`). The extension to RPE's relay socket, or to a page, is `sendToFrontend`
// addressed to that frontend session alone (`spindle/worker-host.ts:2129-2160`). The extension to RPE's
// routes is HTTP through Spindle's proxy, with the registration's key as its bearer, which RPE's
// server checks on every route under `/api/v1/ext/` (`src/app/routes.ts`, the `extension` access).

import { isRecord } from "../../shared/json";

/** The extension's identifier in Lumiverse, kept from today's build (§4.1). */
export const EXTENSION_IDENTIFIER = "lumi_rp_engine";
/** The header that says which Lumiverse user a call of the extension's is for: RPE serves its own user alone. */
export const USER_HEADER = "x-rpe-user";
/** RPE's routes for the extension, under its own API. */
export const START_PATH = "/api/v1/ext/start";
export const LIVE_PATH = "/api/v1/ext/live";
/**
 * Where the extension asks RPE to confirm a registration before it keeps it: only the key in force
 * opens it (the registration's own, as the bearer), and only for the user RPE belongs to (`USER_HEADER`).
 */
export const CONFIRM_PATH = "/api/v1/ext/confirm";
/** RPE's page route that says how its extension in Lumiverse stands with it (`ExtensionStatus`). */
export const EXTENSION_STATUS_PATH = "/api/v1/status/extension";
/** Where the extension tells RPE of a generation it stopped because it could not tell whose chat it was (`CheckStopped`). */
export const STOPPED_PATH = "/api/v1/ext/stopped";
/** Where the extension tells RPE, at its start, that it carries an app file, with the hash the build stated for it (R-12): `{ hash }`, answered `{ taken, words }`. */
export const ARRIVED_PATH = "/api/v1/ext/arrived";
/** Where the extension keeps the registration of the user RPE belongs to, in that user's storage: a folder today's build never used. */
export const REGISTRATION_FILE = "rpe/registration.json";

/** The key of RPE's mark in the `metadata` of each Lumiverse connection RPE takes (at install, and at the swap): what tells a chat as RPE's when the registration is not to hand. */
export const RPE_MARK_KEY = "rpe";
export const RPE_MARK = Object.freeze({ v: 1 });

/** Whether a connection's `metadata`, as Lumiverse keeps it, carries RPE's mark. */
export function rpeMarked(metadata: unknown): boolean {
  return isRecord(metadata) && isRecord(metadata[RPE_MARK_KEY]);
}

/** What RPE tells the extension of itself each time its relay socket opens. */
export interface Registration {
  v: 1;
  /** RPE's address for the extension's road, on loopback: `http://127.0.0.1:7860`. */
  base: string;
  /** What proves the extension to RPE: its bearer on RPE's routes for it. */
  key: string;
  /** Every Lumiverse connection that is RPE's (R-109): a reply on any of them is RPE's to play. Empty before one is made. */
  connections: string[];
  /** The frontend session of RPE's relay socket: what the extension addresses RPE by. */
  relay: string;
  /** RPE's build. */
  build: string;
  /**
   * The extension's values, RPE's settings (R-1): how long it waits for RPE's answer to its question, how many characters of RPE's
   * words it writes in its log, and how long each read of whose chat a reply is waits (absent in a registration stored before RPE gave it).
   */
  values: { questionMs: number; logChars: number; whoseMs?: number };
}

/** What the extension asks RPE to confirm of a registration besides its key, which is the ask's bearer: the relay socket and the connections the extension would act on. */
export interface ConfirmAsk {
  relay: string;
  connections: string[];
}

/** RPE's confirmation of a registration: the user and the relay socket it registered for. */
export interface Confirmed {
  rpe: "confirmed";
  user: string;
  relay: string;
}

/** What a page is handed when it starts: where it may reach RPE directly, RPE's build, a page token, and the page road's values. */
export interface StartFacts {
  token: string;
  /**
   * How long the token still works, in milliseconds, as RPE answered: a page schedules its renewal
   * from when the facts reach it, so a page whose clock is not RPE's never renews too soon or too late.
   */
  expiresInMs: number;
  /** RPE's addresses a browser may try directly, best first. */
  addresses: string[];
  build: string;
  /** The page road's values, RPE's settings: how long a request through the extension waits for its answer, and how often a followed chat's follow is renewed. */
  road: { requestMs: number; renewMs: number };
  /** The page's own settings group whole, as RPE holds it at the global level (`src/shared/page-settings.ts`), by each setting's config key; the page checks each value itself. */
  pageSettings: Readonly<Record<string, number>>;
}

/** A permission the extension is missing, and why it needs it. */
export interface MissingPermission {
  permission: string;
  why: string;
}

/** How RPE's extension in Lumiverse last said it stands with RPE: what RPE's own pages show. */
export interface ExtensionStatus {
  /** Whether the extension holds RPE's registration, and so marks the replies RPE plays. */
  registered: boolean;
  /** Why it does not, in words a user is shown; null when it does. */
  why: string | null;
  /** The permissions it says it is missing, and why it needs each; null until it has said. */
  missing: MissingPermission[] | null;
  /** The generations the extension stopped because it could not tell whose chat they were: the latest, and how many since RPE started; null when none. */
  stopped: { last: CheckStopped; count: number } | null;
}

/**
 * A generation the extension stopped because neither RPE's registration nor the connection's own record
 * could be read for it (N-3): with the chat, the generation and the connection, and how each read failed.
 */
export interface CheckStopped {
  /** When, by the extension's clock. */
  at: number;
  chat: string;
  /** Null where Lumiverse had not announced it. */
  generation: string | null;
  connection: string;
  /** How the read of the registration from the extension's storage failed. */
  registration: string;
  /** How Lumiverse's record of the connection (`spindle.connections.get`) failed. */
  mark: string;
}

/** A page's request carried to RPE: one request, one whole answer (Spindle's proxy: 30 s, 25 MB). */
export interface PipeRequest {
  id: string;
  method: string;
  /** Under RPE's API: `/api/v1/…`. */
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PipeResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * A frame of live updates for one page: `data` is the JSON text of a list of the hub's batches, in
 * order (each says what it missed, when the hub dropped events for a page that fell behind); a list
 * too long for one frame comes in parts with one `seq`.
 */
export interface LiveFrame {
  page: string;
  /** Counts the page's lists from 1; a part shares its list's. */
  seq: number;
  data: string;
  part?: { index: number; count: number };
}

/** RPE to the extension, on the relay socket. */
export type FromRpe = { rpe: "register"; registration: Registration } | ({ rpe: "live"; key: string } & LiveFrame);

/** The extension to RPE's relay socket: it took RPE's registration (saying its own build), or refused it and why; and what it is missing, each time that changes. */
export type ToRpe = { rpe: "registered"; missing: MissingPermission[]; build?: string } | { rpe: "refused"; why: string; missing: MissingPermission[] } | { rpe: "permissions"; missing: MissingPermission[] };

/** A page to the extension (`ctx.sendToBackend`): among them, the page asks for Lumiverse's drawer to close, by an id it is answered by. */
export type FromPage = { rpe: "start" } | ({ rpe: "request" } & PipeRequest) | { rpe: "follow"; chat: string } | { rpe: "unfollow"; chat: string } | { rpe: "drawer"; id: string };

/** The extension to a page. */
export type ToPage =
  | { rpe: "start"; facts: StartFacts | null; error?: string; missing: MissingPermission[] }
  | ({ rpe: "response" } & PipeResponse)
  | ({ rpe: "live" } & Omit<LiveFrame, "page">)
  | { rpe: "following"; chat: string; error?: string }
  | { rpe: "permissions"; missing: MissingPermission[] }
  | { rpe: "drawer"; id: string; closed: boolean };

/** What RPE's live route is asked: a page follows a chat, stops following it, or is gone. */
export type LiveAsk = { page: string; chat: string; follow: boolean } | { page: string; gone: true };

const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function headersOf(v: unknown): Record<string, string> | null {
  if (v === undefined) return {};
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    if (typeof value !== "string") return null;
    out[k.toLowerCase()] = value;
  }
  return out;
}

/** A registration as RPE sends it and the extension keeps it, or null. */
export function readRegistration(v: unknown): Registration | null {
  if (!isRecord(v) || v.v !== 1 || !str(v.base) || !str(v.key) || !Array.isArray(v.connections) || !v.connections.every(str) || !str(v.relay) || typeof v.build !== "string") return null;
  if (!isRecord(v.values) || !count(v.values.questionMs) || !count(v.values.logChars) || (v.values.whoseMs !== undefined && !count(v.values.whoseMs))) return null;
  const { questionMs, logChars, whoseMs } = v.values;
  return { v: 1, base: v.base, key: v.key, connections: [...v.connections], relay: v.relay, build: v.build, values: { questionMs, logChars, ...(whoseMs !== undefined ? { whoseMs } : {}) } };
}

/** What the extension asks RPE to confirm, or null. */
export function readConfirmAsk(v: unknown): ConfirmAsk | null {
  return isRecord(v) && str(v.relay) && Array.isArray(v.connections) && v.connections.every(str) ? { relay: v.relay, connections: [...v.connections] } : null;
}

/** A stopped generation's record as the extension sends it, or null. */
export function readCheckStopped(v: unknown): CheckStopped | null {
  if (!isRecord(v) || !count(v.at) || !str(v.chat) || !(v.generation === null || str(v.generation)) || !str(v.connection) || typeof v.registration !== "string" || typeof v.mark !== "string") return null;
  return { at: v.at, chat: v.chat, generation: v.generation, connection: v.connection, registration: v.registration, mark: v.mark };
}

/** RPE's confirmation as its route answers it, or null when what answered is not RPE. */
export function readConfirmed(v: unknown): Confirmed | null {
  return isRecord(v) && v.rpe === "confirmed" && str(v.user) && str(v.relay) ? { rpe: "confirmed", user: v.user, relay: v.relay } : null;
}

/** A frame from RPE, or null when it is none this build reads. */
export function readFromRpe(v: unknown): FromRpe | null {
  if (!isRecord(v)) return null;
  if (v.rpe === "register") {
    const registration = readRegistration(v.registration);
    return registration === null ? null : { rpe: "register", registration };
  }
  if (v.rpe === "live") {
    const part = partOf(v.part);
    if (!str(v.key) || !str(v.page) || !count(v.seq) || typeof v.data !== "string" || part === null) return null;
    return { rpe: "live", key: v.key, page: v.page, seq: v.seq, data: v.data, ...(part !== undefined ? { part } : {}) };
  }
  return null;
}

/** A frame's part: absent, one this build reads, or null when malformed. */
function partOf(v: unknown): { index: number; count: number } | undefined | null {
  if (v === undefined) return undefined;
  if (!isRecord(v)) return null;
  const { index, count: total } = v;
  return count(index) && count(total) && index < total ? { index, count: total } : null;
}

/** A list of missing permissions as sent, or null when it is not one. */
function missingOf(m: unknown): MissingPermission[] | null {
  return Array.isArray(m) && m.every((x) => isRecord(x) && str(x.permission) && typeof x.why === "string") ? m.map((x) => ({ permission: String(x.permission), why: String(x.why) })) : null;
}

/** A message from the extension to RPE's relay socket, or null when it is none this build reads. */
export function readToRpe(v: unknown): ToRpe | null {
  if (!isRecord(v)) return null;
  const missing = missingOf(v.missing);
  if (missing === null) return null;
  // An extension built before it said its build says none.
  if (v.rpe === "registered") return { rpe: v.rpe, missing, ...(str(v.build) ? { build: v.build } : {}) };
  if (v.rpe === "permissions") return { rpe: v.rpe, missing };
  return v.rpe === "refused" && str(v.why) ? { rpe: "refused", why: v.why, missing } : null;
}

/** A message from the extension to a page, or null when it is none this build reads. */
export function readToPage(v: unknown): ToPage | null {
  if (!isRecord(v)) return null;
  switch (v.rpe) {
    case "start": {
      const lacking = missingOf(v.missing);
      const facts = v.facts === null ? null : readStartFacts(v.facts);
      if (lacking === null || (v.facts !== null && facts === null)) return null;
      return { rpe: "start", facts, ...(typeof v.error === "string" ? { error: v.error } : {}), missing: lacking };
    }
    case "response": {
      const headers = headersOf(v.headers);
      return str(v.id) && count(v.status) && headers !== null && typeof v.body === "string" ? { rpe: "response", id: v.id, status: v.status, headers, body: v.body } : null;
    }
    case "live": {
      const part = partOf(v.part);
      if (!count(v.seq) || typeof v.data !== "string" || part === null) return null;
      return { rpe: "live", seq: v.seq, data: v.data, ...(part !== undefined ? { part } : {}) };
    }
    case "following":
      return str(v.chat) ? { rpe: "following", chat: v.chat, ...(typeof v.error === "string" ? { error: v.error } : {}) } : null;
    case "permissions": {
      const lacking = missingOf(v.missing);
      return lacking === null ? null : { rpe: "permissions", missing: lacking };
    }
    case "drawer":
      return str(v.id) && typeof v.closed === "boolean" ? { rpe: "drawer", id: v.id, closed: v.closed } : null;
    default:
      return null;
  }
}

/** A message from a page, or null when it is none this build reads. */
export function readFromPage(v: unknown): FromPage | null {
  if (!isRecord(v)) return null;
  switch (v.rpe) {
    case "start":
      return { rpe: "start" };
    case "request": {
      const headers = headersOf(v.headers);
      if (!str(v.id) || !str(v.method) || !str(v.path) || headers === null || (v.body !== undefined && typeof v.body !== "string")) return null;
      return { rpe: "request", id: v.id, method: v.method.toUpperCase(), path: v.path, headers, ...(typeof v.body === "string" ? { body: v.body } : {}) };
    }
    case "follow":
    case "unfollow":
      return str(v.chat) ? { rpe: v.rpe, chat: v.chat } : null;
    case "drawer":
      return str(v.id) ? { rpe: "drawer", id: v.id } : null;
    default:
      return null;
  }
}

/** What RPE's live route was asked, or null. */
export function readLiveAsk(v: unknown): LiveAsk | null {
  if (!isRecord(v) || !str(v.page)) return null;
  if (v.gone === true) return { page: v.page, gone: true };
  return str(v.chat) && typeof v.follow === "boolean" ? { page: v.page, chat: v.chat, follow: v.follow } : null;
}

/** RPE's start-up facts as its route answers them, or null. */
export function readStartFacts(v: unknown): StartFacts | null {
  if (!isRecord(v) || !str(v.token) || !count(v.expiresInMs) || !Array.isArray(v.addresses) || !v.addresses.every(str) || typeof v.build !== "string") return null;
  if (!isRecord(v.road) || !count(v.road.requestMs) || !count(v.road.renewMs) || !isRecord(v.pageSettings)) return null;
  const pageSettings: Record<string, number> = {};
  for (const [key, value] of Object.entries(v.pageSettings)) if (typeof value === "number") pageSettings[key] = value;
  return { token: v.token, expiresInMs: v.expiresInMs, addresses: [...v.addresses], build: v.build, road: { requestMs: v.road.requestMs, renewMs: v.road.renewMs }, pageSettings };
}

/**
 * Whether an address is a bare origin on this machine's loopback: the only kind the extension's road
 * goes to (§4.3). Bare, since the extension adds its paths to it: a path, query, fragment or name in it
 * would turn the confirming call into a POST to any path of any loopback port.
 */
export function onLoopback(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" || /[?#]/.test(base)) return false;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}
