// Connections and keys (STANDALONE-PLAN §15.2): today's runtime keeps its connections and their
// secrets in two files of its own folder, `connections.json` and `secrets.json` (LumiAH's book,
// `H/runtime/models/book.ts:257-294`). They are carried into RPH's two documents through the
// application's models port (`App.models`): the connections into `RPE-global.yml`'s `models`, and
// every key, sign-in and header value into the secrets file and nowhere else. RPH's model layer holds
// the rules for what a connection may say and checks both documents as it reads them, so each
// connection is carried as today's runtime stored it, in RPH's shape. A connection RPE has of its
// own is left as it is; one carried before is replaced by today's. Its secrets are not: a key or a
// header value RPE already holds stays, and so does a sign-in RPE holds that runs out later than
// today's, so a later run never puts a retired runtime's credential over one RPE uses.

import type { ConnectionsDoc, ModelsPort, SecretsDoc, SignInToken, StoredConnection } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { readText } from "./files";
import type { RuntimeFile } from "./runtime-folders";

/** What was carried, counted: never a key's or a header's value. */
export interface ConnectionsCarried {
  /** The runtime they came from. */
  runtime: string;
  connections: string[];
  /** Entries today's runtime would leave out as well, as they don't read as a connection. */
  leftOut: number;
  keys: number;
  signins: number;
  headerValues: number;
  /** Keys, sign-ins and header values RPE already held that differ from today's, kept as RPE's. */
  kept: number;
  default: string | null;
}

/** Today's book as its two files hold it, or why it can't be read. */
type Book = { connections: StoredConnection[]; values: Record<string, Record<string, string>>; leftOut: number; default: string | null; secrets: { keys: Record<string, string>; signins: Record<string, SignInToken>; device?: string } } | { why: string };

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

async function readBook(connectionsFile: string, secretsFile: string | undefined, serial: ReadonlySet<string>): Promise<Book> {
  const raw = parsed(await readText(connectionsFile));
  const secret = secretsFile === undefined ? null : parsed(await readText(secretsFile));
  if (raw === undefined || (raw !== null && !(isRecord(raw) && raw.lumiah === FORMAT && Array.isArray(raw.connections)))) return { why: "its connections file isn't a list of connections today's runtime reads" };
  if (secret === undefined || (secret !== null && !(isRecord(secret) && secret.lumiah === FORMAT && isRecord(secret.keys) && isRecord(secret.signins)))) return { why: "its secrets file isn't a set of secrets today's runtime reads" };
  const connections: StoredConnection[] = [];
  const values: Record<string, Record<string, string>> = {};
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
  return { connections, values, leftOut, default: chosen !== undefined && connections.some((c) => c.id === chosen) ? chosen : null, secrets: { keys, signins, ...(device !== undefined ? { device } : {}) } };
}

/** A record of strings from a document read as it comes; empty where it holds none. */
function strings<T>(value: unknown, keep: (v: unknown) => v is T): Record<string, T> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((e): e is [string, T] => keep(e[1]))) : {};
}

const isString = (v: unknown): v is string => typeof v === "string";
const isValues = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every(isString);

/** A runtime's book as the carry reads it from the files the migration found: null where it keeps neither file; `{ why }` where the carry would take nothing of it. */
async function bookOf(runtime: string, files: readonly RuntimeFile[], serial: ReadonlySet<string>): Promise<Book | null> {
  const at = (name: string): string | undefined => files.find((f) => f.path === `runtimes/${runtime}/${name}` && !f.link)?.disk;
  const connectionsFile = at("connections.json");
  const secretsFile = at("secrets.json");
  if (connectionsFile === undefined) return secretsFile === undefined ? null : { why: "it has a secrets file and no connections file, and today's runtime reads its keys only with one" };
  return readBook(connectionsFile, secretsFile, serial);
}

/** Why this run would carry nothing of a runtime's book, or null where it carries it or there is none: read before anything is written. */
export async function bookTrouble(runtime: string, files: readonly RuntimeFile[]): Promise<string | null> {
  const book = await bookOf(runtime, files, new Set());
  return book !== null && "why" in book ? book.why : null;
}

/**
 * Carries the runtime's connections and keys into RPE's two documents through `port`: the secrets
 * first, as the model layer saves them, then the connections. `files` are the runtime's files the
 * migration found; `runtime` the runtime it took, the one this user registered. Null when that runtime keeps no
 * connections; `{ why }` when its files can't be read, and nothing is carried.
 */
export async function carryConnections(port: ModelsPort, runtime: string, files: readonly RuntimeFile[], serial: ReadonlySet<string>): Promise<ConnectionsCarried | { why: string } | null> {
  const book = await bookOf(runtime, files, serial);
  if (book === null || "why" in book) return book;
  const ids = new Set(book.connections.map((c) => c.id));

  const hadSecrets = await port.loadSecrets();
  const had = isRecord(hadSecrets) ? hadSecrets : {};
  const carried = { keys: 0, signins: 0, headerValues: 0, kept: 0 };
  const keys = strings(had.keys, isString);
  for (const [id, key] of Object.entries(book.secrets.keys)) {
    if (keys[id] !== undefined && keys[id] !== key) carried.kept++;
    else {
      keys[id] = key;
      carried.keys++;
    }
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
  const headers = strings(had.headers, isValues);
  for (const [id, values] of Object.entries(book.values)) {
    const ours = { ...headers[id] };
    for (const [name, value] of Object.entries(values)) {
      if (ours[name] !== undefined && ours[name] !== value) carried.kept++;
      else {
        ours[name] = value;
        carried.headerValues++;
      }
    }
    headers[id] = ours;
  }
  const device = text(had.device) ?? book.secrets.device;
  const secrets: SecretsDoc = {
    v: 1,
    keys,
    signins,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(device !== undefined ? { device } : {}),
  };
  await port.saveSecrets(secrets);

  const hadDoc = await port.loadConnections();
  const own = (isRecord(hadDoc) && Array.isArray(hadDoc.connections) ? hadDoc.connections : []).filter((c: unknown): c is StoredConnection => isRecord(c) && typeof c.id === "string" && !ids.has(c.id));
  const ownDefault = isRecord(hadDoc) ? text(hadDoc.default) : undefined;
  // RPE's own choice of default stands; one a run carried is today's choice again.
  const chosen = ownDefault !== undefined && own.some((c) => c.id === ownDefault) ? ownDefault : book.default;
  const doc: ConnectionsDoc = { v: 1, default: chosen, connections: [...own, ...book.connections] };
  await port.saveConnections(doc);
  return {
    runtime,
    connections: book.connections.map((c) => c.id),
    leftOut: book.leftOut,
    ...carried,
    default: chosen,
  };
}
