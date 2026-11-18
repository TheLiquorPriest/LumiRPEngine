// Connections and keys (STANDALONE-PLAN §15.2): today's runtime keeps its connections and their
// secrets in two files of its own folder, `connections.json` and `secrets.json` (LumiAH's book,
// `H/runtime/models/book.ts:257-294`). They are carried into RPH's two documents through the
// application's models port (`App.models`): the connections into `RPE-global.yml`'s `models`, and
// every key, sign-in and header value into the secrets file and nowhere else. RPH's model layer holds
// the rules for what a connection may say and checks both documents as it reads them, so each
// connection is carried as today's runtime stored it, in RPH's shape. A connection RPE has of its
// own is left as it is. One a run carried before is replaced by today's only while RPE's copy is
// still what a run put there (its fingerprint, kept by the run), as Build's worlds are: one the user
// changed in RPE (its limits, retries, name, model or effort) or removed there is left as RPE has
// it, and the report says so. So is RPE's default where the user chose another there. The secrets
// are kept likewise: a key or a header value RPE already holds stays, and so does a sign-in RPE
// holds that runs out later than today's, so a later run never puts a retired runtime's credential
// over one RPE uses. Beside each connection's key and headers' values the secrets keep the place
// they were given for, which the model layer compares at every read, the first after a start too:
// the run is that document's second writer, so it keeps RPE's places with RPE's secrets and writes
// today's where today's build sends them. One place stands for a connection's key and values
// together, so where RPE's were given for another place than today's the two are not mixed: a
// connection left as RPE has it keeps RPE's, and one taken from today's takes today's whole.

import { stat } from "node:fs/promises";
import type { ConnectionsDoc, ModelsPort, SecretsDoc, SignInToken, StoredConnection } from "rp-harness/contract";
import { placeOf as rphPlaceOf } from "rp-harness/helpers";
import { hashJson } from "../shared/hash";
import { isRecord } from "../shared/json";
import { readText } from "./files";
import type { RuntimeFile } from "./runtime-folders";
import type { Followed } from "./tables";

/** What was carried, counted: never a key's or a header's value. */
export interface ConnectionsCarried {
  /** The runtime they came from. */
  runtime: string;
  /** Today's connections RPE holds as today's runtime has them now. */
  connections: string[];
  /** Entries today's runtime would leave out as well, as they don't read as a connection. */
  leftOut: number;
  keys: number;
  signins: number;
  headerValues: number;
  /** Keys, sign-ins and header values RPE already held that differ from today's, kept as RPE's. */
  kept: number;
  default: string | null;
  /** Today's connections changed or removed in RPE since a run carried them, left as RPE has them: today's copy not taken. Absent from a report kept before runs told them apart. */
  changedInRpe?: string[];
  /** Whether the default is one the user chose in RPE, kept over today's. Absent from a report kept before runs told them apart. */
  defaultKept?: boolean;
  /** What a later run did about a connection removed on today's side since an earlier run, and a key or header value rotated there: followed where RPE's copy is still what a run put there, else left as RPE has it. */
  followed?: Followed[];
}

/** What a run put into RPE's own documents, by what it is, as `migration_put` keeps it: the fingerprint of each. */
export type PutPrints = ReadonlyMap<string, string>;

/** Today's book as its two files hold it, or why it can't be read. */
type Book = { connections: StoredConnection[]; values: Record<string, Record<string, string>>; leftOut: number; present: Set<string>; default: string | null; secrets: { keys: Record<string, string>; signins: Record<string, SignInToken>; device?: string } } | { why: string };

/** The file format both of the book's files carry (`FORMAT`, book.ts). */
const FORMAT = 1;
const AUTHS: readonly string[] = ["key", "signin", "none"];

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * One stored connection in RPH's shape, or null where it doesn't read as one (`storedOf`, book.ts):
 * its headers by name, their values kept apart for the secrets; a connection that takes one tool
 * call per answer (`serial`) says so.
 */
function connectionOf(raw: unknown, serial: ReadonlySet<string>): { connection: StoredConnection; values: Record<string, string> } | null {
  if (!isRecord(raw) || text(raw.id) === undefined || text(raw.name) === undefined || text(raw.provider) === undefined || !AUTHS.includes(String(raw.auth))) return null;
  const headers = isRecord(raw.headers) ? Object.entries(raw.headers).filter(([, v]) => v === null || typeof v === "string") : [];
  const values = Object.fromEntries(headers.filter((h): h is [string, string] => typeof h[1] === "string"));
  const id = raw.id as string;
  const { baseUrl, api, model, effort } = { baseUrl: text(raw.baseUrl), api: text(raw.api), model: text(raw.model), effort: text(raw.effort) };
  const connection: StoredConnection = {
    id,
    name: raw.name as string,
    provider: raw.provider as string,
    auth: raw.auth as StoredConnection["auth"],
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(api !== undefined ? { api } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort: effort as NonNullable<StoredConnection["effort"]> } : {}),
    ...(headers.length > 0 ? { headers: headers.map(([name]) => name) } : {}),
    ...(serial.has(id) ? { serialTools: true as const } : {}),
  };
  return { connection, values };
}

function isSignIn(value: unknown): value is SignInToken {
  return isRecord(value) && value.type === "oauth" && typeof value.access === "string" && typeof value.refresh === "string" && typeof value.expires === "number";
}

/**
 * Where a connection's key and headers' values go, in the form RPH's model layer keeps beside them
 * in the secrets (`SecretsDoc.places`, RPH's own `placeOf`): its provider and its address's origin
 * and path, null for the provider's own address. The layer compares it at every read, the first
 * after a start too, and sends them to no other place. Undefined for an entry that names no
 * provider or address as a connection does.
 */
function placeOf(c: { provider?: unknown; baseUrl?: unknown }): string | undefined {
  const { provider, baseUrl } = c;
  if (typeof provider !== "string" || (baseUrl !== undefined && typeof baseUrl !== "string")) return undefined;
  return rphPlaceOf(provider, baseUrl);
}

/** The fingerprint of a key or a header's value of a connection, as the run keeps it: never the value itself. */
const printOf = (id: string, value: string): string => hashJson([id, value]);

/** A file of today's runtime that is not as the run counted it. */
class ConnectionsChanged extends Error {
  constructor(path: string) {
    super(`the previous build's file ${path} was changed after the run counted it, so its counts would not describe what is carried; nothing is carried until it is run again`);
    this.name = "ConnectionsChanged";
  }
}

/** A file's text, read as the run counted it: one that is not the size and time it was found at, before or after the read, was changed since. */
async function counted(file: RuntimeFile): Promise<string | null> {
  const steady = async (): Promise<boolean> => {
    const now = await stat(file.disk).catch(() => null);
    return now !== null && now.size === file.bytes && now.mtimeMs === file.mtimeMs;
  };
  if (!(await steady())) throw new ConnectionsChanged(file.path);
  const body = await readText(file.disk);
  if (!(await steady())) throw new ConnectionsChanged(file.path);
  return body;
}

async function readBook(connectionsFile: RuntimeFile, secretsFile: RuntimeFile | undefined, serial: ReadonlySet<string>): Promise<Book> {
  const raw = parsed(await counted(connectionsFile));
  const secret = secretsFile === undefined ? null : parsed(await counted(secretsFile));
  if (raw === undefined || (raw !== null && !(isRecord(raw) && raw.lumiah === FORMAT && Array.isArray(raw.connections)))) return { why: "its connections file isn't a list of connections the previous runtime reads" };
  if (secret === undefined || (secret !== null && !(isRecord(secret) && secret.lumiah === FORMAT && isRecord(secret.keys) && isRecord(secret.signins)))) return { why: "its secrets file isn't a set of secrets the previous runtime reads" };
  const connections: StoredConnection[] = [];
  const present = new Set<string>();
  const values: Record<string, Record<string, string>> = {};
  for (const entry of isRecord(raw) && Array.isArray(raw.connections) ? raw.connections : []) if (isRecord(entry) && typeof entry.id === "string") present.add(entry.id);
  let leftOut = 0;
  for (const entry of isRecord(raw) && Array.isArray(raw.connections) ? raw.connections : []) {
    const read = connectionOf(entry, serial);
    if (read === null || connections.some((c) => c.id === read.connection.id)) {
      leftOut++;
      continue;
    }
    connections.push(read.connection);
    if (Object.keys(read.values).length > 0) values[read.connection.id] = read.values;
  }
  const keys: Record<string, string> = {};
  const signins: Record<string, SignInToken> = {};
  let device: string | undefined;
  if (isRecord(secret) && isRecord(secret.keys) && isRecord(secret.signins)) {
    for (const [id, key] of Object.entries(secret.keys)) if (typeof key === "string" && connections.some((c) => c.id === id && c.auth === "key")) keys[id] = key;
    for (const [provider, credential] of Object.entries(secret.signins)) if (isSignIn(credential)) signins[provider] = credential;
    device = text(secret.device);
  }
  const chosen = isRecord(raw) ? text(raw.default) : undefined;
  return { connections, values, leftOut, present, default: chosen !== undefined && connections.some((c) => c.id === chosen) ? chosen : null, secrets: { keys, signins, ...(device !== undefined ? { device } : {}) } };
}

/** A record of strings from a document read as it comes; empty where it holds none. */
function strings<T>(value: unknown, keep: (v: unknown) => v is T): Record<string, T> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((e): e is [string, T] => keep(e[1]))) : {};
}

const isString = (v: unknown): v is string => typeof v === "string";
const isValues = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every(isString);

/** A runtime's book as the carry reads it from the files the migration found: null where it keeps neither file; `{ why }` where the carry would take nothing of it. */
async function bookOf(runtime: string, files: readonly RuntimeFile[], serial: ReadonlySet<string>): Promise<Book | null> {
  const at = (name: string): RuntimeFile | undefined => files.find((f) => f.path === `runtimes/${runtime}/${name}` && !f.link);
  const connectionsFile = at("connections.json");
  const secretsFile = at("secrets.json");
  if (connectionsFile === undefined) return secretsFile === undefined ? null : { why: "it has a secrets file and no connections file, and the previous runtime reads its keys only with one" };
  return readBook(connectionsFile, secretsFile, serial);
}

/** Why this run would carry nothing of a runtime's book, or null where it carries it or there is none: read before anything is written. */
export async function bookTrouble(runtime: string, files: readonly RuntimeFile[]): Promise<string | null> {
  try {
    const book = await bookOf(runtime, files, new Set());
    return book !== null && "why" in book ? book.why : null;
  } catch (error) {
    if (error instanceof ConnectionsChanged) return error.message;
    throw error;
  }
}

/** Reads the runtime's book once more, as the carry will, and throws where either file is not as the run counted it: a run that is about to write stops before it does. */
export async function checkConnectionsSteady(runtime: string, files: readonly RuntimeFile[]): Promise<void> {
  await bookOf(runtime, files, new Set());
}

/**
 * Carries the runtime's connections and keys into `user`'s two documents through `port`: the secrets
 * first, as the model layer saves them, then the connections. `files` are the runtime's files the
 * migration found; `runtime` the runtime it took, the one this user registered; `earlier` what
 * earlier runs put into RPE's documents (`migration_put`). Null when that runtime keeps no
 * connections; `{ why }` when its files can't be read, and nothing is carried. Else what was carried,
 * and what this run put there, by what it is, to be kept for the next run.
 */
export async function carryConnections(port: ModelsPort, user: string, runtime: string, files: readonly RuntimeFile[], serial: ReadonlySet<string>, earlier: PutPrints): Promise<{ carried: ConnectionsCarried; put: Map<string, string>; drop: Set<string> } | { why: string } | null> {
  const book = await bookOf(runtime, files, serial);
  if (book === null || "why" in book) return book;
  const ids = new Set(book.connections.map((c) => c.id));
  const put = new Map<string, string>();

  // Each of today's connections against RPE's copy: taken where RPE holds none and no run put one there, or where RPE's is still what a run put there; else RPE's stands.
  const hadDoc = await port.loadConnections({ user });
  const held = (isRecord(hadDoc) && Array.isArray(hadDoc.connections) ? hadDoc.connections : []).filter((c: unknown): c is StoredConnection => isRecord(c) && typeof c.id === "string");
  // A connection removed on today's side since a run goes from RPE where RPE's copy is still what a run put there, else it stays as RPE has it; either way it is named and no run keeps its print.
  const followed: Followed[] = [];
  const drop = new Set<string>();
  const removed = new Set<string>();
  const own = held.filter((c) => {
    // Today's own readable connections are taken below; one today's file holds but would leave out stays as RPE has it.
    if (ids.has(c.id)) return false;
    if (book.present.has(c.id)) return true;
    const was = earlier.get(`connection ${c.id}`);
    if (was === undefined) return true;
    drop.add(`connection ${c.id}`);
    const follows = hashJson(c) === was;
    followed.push({ what: `connection ${c.id}`, change: "removed on the previous build's side since an earlier run", followed: follows });
    if (follows) removed.add(c.id);
    return !follows;
  });
  const taken: StoredConnection[] = [];
  const changedInRpe: string[] = [];
  for (const c of book.connections) {
    const what = `connection ${c.id}`;
    const print = hashJson(c);
    const ours = held.find((h) => h.id === c.id);
    const was = earlier.get(what);
    if (ours === undefined ? was === undefined : hashJson(ours) === print || hashJson(ours) === was) {
      taken.push(c);
      put.set(what, print);
    } else {
      if (ours !== undefined) taken.push(ours);
      changedInRpe.push(c.id);
    }
  }
  const kept = new Set(changedInRpe);
  const result = [...own, ...taken];
  const there = new Set(result.map((c) => c.id));

  const hadSecrets = await port.loadSecrets({ user });
  const had = isRecord(hadSecrets) ? hadSecrets : {};
  const carried = { keys: 0, signins: 0, headerValues: 0, kept: 0 };
  const keys = strings(had.keys, isString);
  const headers = strings(had.headers, isValues);
  // Beside each connection's key and headers' values, the place they were given for: RPE's stay with RPE's, today's go with the place today's build sends them to.
  const places = strings(had.places, isString);
  // A connection followed out of RPE takes its key, headers' values and place with it, and the prints of them.
  for (const id of removed) {
    delete keys[id];
    delete headers[id];
    delete places[id];
    for (const what of earlier.keys()) if (what.startsWith(`key ${id}`) || what.startsWith(`value ${id}\u0000`)) drop.add(what);
  }
  for (const c of book.connections) {
    // A connection removed in RPE takes no key back.
    if (!there.has(c.id)) continue;
    const given = placeOf(c);
    // RPE's were given where the secrets say; ones kept before places were, where RPE's copy went before this run, as the layer would have taken it.
    const ourPlace = places[c.id] ?? placeOf(held.find((h) => h.id === c.id) ?? {});
    // One place stands for a connection's key and values together, so RPE's and today's, given for different places, are never mixed: where RPE's copy of the connection stays, RPE's stay and none of today's joins them; where today's copy is taken, today's replace RPE's.
    const apart = (Object.hasOwn(keys, c.id) || Object.hasOwn(headers, c.id)) && ourPlace !== given;
    const joins = !apart || !kept.has(c.id);
    if (apart && joins) {
      delete keys[c.id];
      delete headers[c.id];
    }
    const key = book.secrets.keys[c.id];
    if (key !== undefined) {
      const what = `key ${c.id}`;
      const ourKey = keys[c.id];
      // A key rotated on today's side since a run is taken where RPE's key is still the one a run put there; one the user set in RPE stays.
      const rotated = ourKey !== undefined && ourKey !== key && earlier.get(what) === printOf(c.id, ourKey);
      if (ourKey !== undefined && ourKey !== key && !rotated) carried.kept++;
      else if (joins) {
        if (rotated) followed.push({ what: `the key of connection ${c.id}`, change: "rotated on the previous build's side since an earlier run, and still given for the address it was", followed: true });
        keys[c.id] = key;
        carried.keys++;
        put.set(what, printOf(c.id, key));
      }
    }
    const values = book.values[c.id];
    if (values !== undefined) {
      const ours = { ...headers[c.id] };
      for (const [name, value] of Object.entries(values)) {
        const what = `value ${c.id}\u0000${name}`;
        const rotated = ours[name] !== undefined && ours[name] !== value && earlier.get(what) === printOf(c.id, ours[name] ?? "");
        if (ours[name] !== undefined && ours[name] !== value && !rotated) carried.kept++;
        else if (joins) {
          if (rotated) followed.push({ what: `the value of header ${name} of connection ${c.id}`, change: "rotated on the previous build's side since an earlier run", followed: true });
          ours[name] = value;
          carried.headerValues++;
          put.set(what, printOf(c.id, value));
        }
      }
      if (joins) headers[c.id] = ours;
    }
    if (!joins) continue;
    if ((Object.hasOwn(keys, c.id) || Object.hasOwn(headers, c.id)) && given !== undefined) places[c.id] = given;
    else delete places[c.id];
  }
  // A sign-in RPE refreshed runs out later than the one today's runtime last saved.
  const signins = strings(had.signins, isSignIn);
  for (const [provider, signin] of Object.entries(book.secrets.signins)) {
    const ours = signins[provider];
    if (ours !== undefined && ours.expires > signin.expires) carried.kept++;
    else {
      signins[provider] = signin;
      carried.signins++;
    }
  }
  const device = text(had.device) ?? book.secrets.device;
  const secrets: SecretsDoc = {
    v: 1,
    keys,
    signins,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(places).length > 0 ? { places } : {}),
    ...(device !== undefined ? { device } : {}),
  };
  await port.saveSecrets({ user }, secrets);

  // The default as the connections: today's where RPE's is still what a run put there, or where no run put one and RPE has none of its own choosing; else RPE's stands.
  const ourDefault = (isRecord(hadDoc) ? text(hadDoc.default) : undefined) ?? null;
  const todays = book.default !== null && there.has(book.default) ? book.default : null;
  const was = earlier.get("default");
  const takeTodays = ourDefault === todays || (was === undefined ? ourDefault === null || !there.has(ourDefault) : hashJson(ourDefault) === was || (ourDefault !== null && !there.has(ourDefault)));
  const chosen = takeTodays ? todays : ourDefault;
  if (takeTodays) put.set("default", hashJson(todays));
  const doc: ConnectionsDoc = { v: 1, default: chosen, connections: result };
  await port.saveConnections({ user }, doc);
  return {
    carried: {
      runtime,
      connections: taken.filter((c) => !kept.has(c.id)).map((c) => c.id),
      leftOut: book.leftOut,
      ...carried,
      default: chosen,
      changedInRpe,
      defaultKept: !takeTodays,
      ...(followed.length > 0 ? { followed } : {}),
    },
    put,
    drop,
  };
}
