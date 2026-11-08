// What the perf scripts share (`engine-state.ts`, `agent-chat.ts`): the host as the extension's
// subprocess sees it (every value copied across, as over Spindle's IPC, each call optionally taking
// the time a round trip does), a fake host's state stored and restored as a dataset, and the
// measuring helpers: the heap after a full collection, waiting for the backend to be idle, and
// reading or emptying a private field by name.

import { heapStats } from "bun:jsc";
import type { HostPort } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import { FakeHost, type FakeChat } from "../../test/support/fake-host";
import type { Rig } from "../../test/support/rig";

export const mb = (bytes: number): number => Math.round(bytes / 1e5) / 10;

/** The namespaces whose calls cross the host's IPC: storage and the chat's reads take a round trip each on the real host. */
const SLOW_NAMESPACES: Readonly<Record<string, true>> = { chats: true, storage: true, extensionStorage: true };

/**
 * What the port does besides copying: the wait each round trip to the host takes, a count of the
 * round trips made (in all and by call), and how a storage read reaches the host: the adapter's own
 * way (`read-first`: the read, and whether the file is there only once it fails) or an earlier
 * build's (`exists-first`: whether it is there, then the read).
 */
export interface IpcOptions {
  latencyMs?: number;
  trips?: { n: number; by?: Record<string, number> };
  reads?: "read-first" | "exists-first";
}

/**
 * The host as the extension's subprocess sees it: every value that crosses the port is a copy, as
 * over Spindle's IPC, and nothing on either side holds the other's objects strongly. The backend's
 * handlers are held on its side and reached from the host through weak references, and the port
 * reaches the host weakly too, so a heap snapshot's dominators split the two. Each chat or storage
 * call is a round trip to the host, a storage read one or two as `options.reads` has it, counted in
 * `trips` and each waiting `latencyMs` before it answers.
 */
export function ipcPort(host: FakeHost, options: IpcOptions = {}): HostPort {
  const latencyMs = options.latencyMs ?? 0;
  const far = new WeakRef(host);
  const near = (): FakeHost => {
    const h = far.deref();
    if (!h) throw new Error("the host is gone");
    return h;
  };
  const own = new Set<unknown>();
  const copy = (v: unknown): unknown => {
    if (typeof v === "string") return JSON.parse(JSON.stringify(v)) as string;
    if (v === null || typeof v !== "object" || v instanceof AbortSignal) return v;
    if (Object.values(v).some((x) => typeof x === "function")) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "function" ? x : copy(x)]));
    return structuredClone(v);
  };
  const settled = (v: unknown): unknown => (v instanceof Promise ? v.then(copy) : copy(v));
  // What the backend hands the host: data copied; a function kept here and called through a weak reference.
  const out = (v: unknown): unknown => {
    if (typeof v !== "function") return copy(v);
    own.add(v);
    const ref = new WeakRef(v as (...args: unknown[]) => unknown);
    return (...args: unknown[]) => settled(ref.deref()?.(...args.map(copy)));
  };
  const count = (label: string, trips: number): void => {
    if (!options.trips || trips === 0) return;
    options.trips.n += trips;
    if (options.trips.by) options.trips.by[label] = (options.trips.by[label] ?? 0) + trips;
  };
  const call =
    (target: () => Record<string, unknown>, name: string, slow = false, label = name) =>
    (...args: unknown[]): unknown => {
      const t = target();
      const answer = settled((t[name] as (...a: unknown[]) => unknown).apply(t, args.map(out)));
      if (!slow) return answer;
      return (async () => {
        const value = await answer;
        // A storage read is one round trip or two, by whether the file was there and how the adapter asks.
        const there = value !== null;
        const trips = label === "storage.read" || label === "extensionStorage.read" ? ((options.reads ?? "read-first") === "read-first" ? (there ? 1 : 2) : there ? 2 : 1) : 1;
        count(label, trips);
        if (latencyMs > 0) await Bun.sleep(latencyMs * trips);
        return value;
      })();
    };
  const namespace = (key: string): Record<string, unknown> => {
    const of = (): Record<string, unknown> => (near() as unknown as Record<string, Record<string, unknown>>)[key] as Record<string, unknown>;
    return Object.fromEntries(Object.keys(of()).map((name) => [name, call(of, name, SLOW_NAMESPACES[key] === true, `${key}.${name}`)]));
  };
  const self = (): Record<string, unknown> => near() as unknown as Record<string, unknown>;
  const port = {
    chats: namespace("chats"),
    storage: namespace("storage"),
    extensionStorage: namespace("extensionStorage"),
    models: namespace("models"),
    tokens: namespace("tokens"),
    frontend: namespace("frontend"),
    books: namespace("books"),
    presets: namespace("presets"),
    connections: namespace("connections"),
    mcp: namespace("mcp"),
    regex: namespace("regex"),
    processes: namespace("processes"),
    users: namespace("users"),
    on: call(self, "on"),
    registerContextHandler: call(self, "registerContextHandler"),
    registerWorldInfoInterceptor: call(self, "registerWorldInfoInterceptor"),
    registerPromptInterceptor: call(self, "registerPromptInterceptor"),
    toast: call(self, "toast"),
    dryRun: call(self, "dryRun"),
    log: call(self, "log"),
    get capabilities() {
      return copy(near().capabilities);
    },
    get bunPath() {
      return near().bunPath;
    },
  };
  return port as unknown as HostPort;
}

// ---------------------------------------------------------------- the dataset

/** A fake host's state as a dataset stores it. */
export interface HostDump {
  nextId: number;
  bookChanges: number;
  chats: FakeChat[];
  files: [string, string][];
  extensionFiles: [string, string][];
  books: [string, { name: string; character?: boolean; added?: number; updated: number; entries: [string, JsonObject][] }][];
  regex: [string, JsonObject][];
  globalBooks: string[];
}

/** The fake host's private counters, which a stored dataset carries. */
interface HostCounters {
  nextId: number;
  bookChanges: number;
}

export function dumpHost(host: FakeHost): HostDump {
  const counters = host as unknown as HostCounters;
  return {
    nextId: counters.nextId,
    bookChanges: counters.bookChanges,
    chats: [...host.chatsById.values()],
    files: [...host.files],
    extensionFiles: [...host.extensionFiles],
    books: [...host.bookStore].map(([id, b]) => [id, { ...b, entries: [...b.entries].map(([k, e]): [string, JsonObject] => [k, e as unknown as JsonObject]) }]),
    regex: [...host.regexScripts].map(([k, s]): [string, JsonObject] => [k, s as unknown as JsonObject]),
    globalBooks: [...host.globalBooks],
  };
}

export function restoreHost(dump: HostDump): FakeHost {
  const host = new FakeHost();
  const counters = host as unknown as HostCounters;
  counters.nextId = dump.nextId;
  counters.bookChanges = dump.bookChanges;
  for (const c of dump.chats) host.chatsById.set(c.id, c);
  for (const [k, v] of dump.files) host.files.set(k, v);
  for (const [k, v] of dump.extensionFiles) host.extensionFiles.set(k, v);
  for (const [id, b] of dump.books) host.bookStore.set(id, { ...b, entries: new Map(b.entries.map(([k, e]) => [k, e as never])) });
  for (const [k, s] of dump.regex) host.regexScripts.set(k, s as never);
  host.globalBooks = [...dump.globalBooks];
  return host;
}

/** Drops what the fake host records for tests (every message sent, call made, line logged): host-side, and not the backend's. */
export function quiet(host: FakeHost): void {
  for (const list of [host.sent, host.sentTo, host.quietCalls, host.quietStopped, host.logs, host.tokenCalls, host.placed, host.fills, host.restarts, host.toasts, host.spawned, host.decideCalls, host.mcpReads]) list.length = 0;
  host.userLogs.clear();
  host.logTurns.clear();
  host.processMail.clear();
  host.assembled = [];
}

// ---------------------------------------------------------------- measuring

/** The heap after a full collection, in bytes. */
export function heap(): number {
  Bun.gc(true);
  Bun.gc(true);
  return heapStats().heapSize;
}

/** Waits until nothing the backend started is still running or scheduled. */
export async function calm(rig: Rig): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await rig.host.settle();
    await Bun.sleep(30);
  }
  quiet(rig.host);
}

type Clear = Map<unknown, unknown> | Set<unknown> | unknown[];

/** Empties each named field of `owner` (a Map, Set or array); a field missing is an error, so a renamed one never measures as nothing. */
export function empty(owner: unknown, ...fields: string[]): void {
  for (const f of fields) {
    const v = (owner as Record<string, Clear | undefined>)[f];
    if (v instanceof Map || v instanceof Set) v.clear();
    else if (Array.isArray(v)) v.length = 0;
    else throw new Error(`no field ${f} to empty`);
  }
}

/** A private field, read as `T`; missing is an error. */
export function field<T>(owner: unknown, name: string): T {
  const v = (owner as Record<string, unknown>)[name];
  if (v === undefined) throw new Error(`no field ${name}`);
  return v as T;
}
