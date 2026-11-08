// The loopback's registry (DEPTH-PLAN §3.7, §3.11), in the extension's own storage, since a key a
// relay presents must find its user without knowing who that is: each user's loopback key and each
// relay's secret are kept only as SHA-256 hashes, beside the user they belong to; each relay's name,
// mode, build and address; and whether the operator allowed the shared relay (D-8). What a relay
// says on each ping lives in memory (the bridge); its last hello's report is kept here, so
// Settings → Loopback shows it after LumiRPEngine restarts. Every user's operations rewrite the one
// file, so what it keeps is bounded: a few relays per user, each text field and report checked.

import type { UserId } from "../../shared/ids";
import { hasOwn, isRecord } from "../../shared/json";
import type { RelayMode, RelayReport, SchedulerState } from "../../shared/loopback";
import type { HostPort } from "../host";

/** A relay LumiRPEngine registered (`lre.loopback.register`). */
export interface RelayRecord {
  id: string;
  /** The account that registered it: whose turns it carries in `user` mode, and where its pushes go. */
  user: UserId;
  name: string;
  mode: RelayMode;
  /** SHA-256 of its secret, hex. */
  secret: string;
  build: string;
  host: string;
  listen: string;
  port: number;
  registeredAt: number;
  /** What it said of itself on its last hello. */
  report: RelayReport | null;
}

/** A user's loopback key: its hash, its fingerprint for the page, and when it was made. */
export interface KeyRecord {
  hash: string;
  print: string;
  at: number;
}

interface Registry {
  v: 1;
  keys: Record<UserId, KeyRecord>;
  relays: Record<string, RelayRecord>;
  /** The shared relay (D-8): allowed by the operator named, when. */
  shared: { enabled: boolean; by: UserId | null; at: number | null };
}

const FILE = "loopback/registry.json";
/** Where a registry this build couldn't read is kept before anything is written over it. */
const UNREADABLE_FILE = `${FILE}.bad`;

/** The relays one account may have registered at once: `register` refuses another until one is forgotten. */
export const RELAYS_PER_USER = 8;
/** The longest name, build, host, address or date a relay's record or report keeps. */
export const TEXT_MAX = 255;
/** The longest path a relay's report keeps (Linux's PATH_MAX). */
const PATH_MAX = 4096;

const SCHEDULER: Record<SchedulerState, true> = { excluded: true, missing: true, unavailable: true, unknown: true };

const empty = (): Registry => ({ v: 1, keys: {}, relays: {}, shared: { enabled: false, by: null, at: null } });

const textOf = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const portOf = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
const schedulerOf = (value: unknown): value is SchedulerState => typeof value === "string" && hasOwn(SCHEDULER, value);

/** What a relay says of itself (hello, ping), as it may be kept and shown: every field its type has, each of its type and within its bound, nothing else; null for anything other. */
export function relayReportOf(raw: unknown): RelayReport | null {
  if (!isRecord(raw) || !isRecord(raw.runtime) || !isRecord(raw.session)) return null;
  const { name, build, host, listen, port, scheduler, calls } = raw;
  const { bun, script, unit } = raw.runtime;
  const { valid, expiresAt, checkedAt } = raw.session;
  if (!textOf(name, TEXT_MAX) || !textOf(build, TEXT_MAX) || !textOf(host, TEXT_MAX) || !textOf(listen, TEXT_MAX) || !portOf(port) || !schedulerOf(scheduler)) return null;
  if (typeof calls !== "number" || !Number.isSafeInteger(calls) || calls < 0) return null;
  if (!(bun === null || textOf(bun, PATH_MAX)) || !textOf(script, PATH_MAX)) return null;
  let ran: RelayReport["runtime"]["unit"] = null;
  if (unit !== null) {
    if (!isRecord(unit)) return null;
    const { name: unitName, scope } = unit;
    if (!textOf(unitName, TEXT_MAX) || (scope !== "system" && scope !== "user")) return null;
    ran = { name: unitName, scope };
  }
  if (!(valid === null || typeof valid === "boolean") || !(expiresAt === null || textOf(expiresAt, TEXT_MAX)) || !(checkedAt === null || typeof checkedAt === "number")) return null;
  return { name, build, runtime: { bun, script, unit: ran }, host, listen, port, scheduler, session: { valid, expiresAt, checkedAt }, calls };
}

/** SHA-256 of a text, as hex. */
export async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `bits` random bits as hex: a relay's secret, a loopback key, a turn token. */
export function randomHex(bits: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bits / 8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The registry a stored file holds; null when it isn't one this build reads. A relay record past its bounds is left out, and so is each account's past its newest `RELAYS_PER_USER`. */
function registryOf(raw: unknown): Registry | null {
  const r = empty();
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (isRecord(raw.keys)) for (const [user, k] of Object.entries(raw.keys)) if (isRecord(k) && typeof k.hash === "string" && typeof k.print === "string" && typeof k.at === "number") r.keys[user] = { hash: k.hash, print: k.print, at: k.at };
  if (isRecord(raw.relays)) {
    const kept: RelayRecord[] = [];
    for (const [id, x] of Object.entries(raw.relays)) {
      if (!isRecord(x) || typeof x.user !== "string" || typeof x.name !== "string" || x.name.length > TEXT_MAX || (x.mode !== "user" && x.mode !== "shared") || typeof x.secret !== "string" || !portOf(x.port)) continue;
      const build = typeof x.build === "string" ? x.build : "";
      const host = typeof x.host === "string" ? x.host : "";
      const listen = typeof x.listen === "string" ? x.listen : "127.0.0.1";
      if (build.length > TEXT_MAX || host.length > TEXT_MAX || listen.length > TEXT_MAX) continue;
      kept.push({ id, user: x.user, name: x.name, mode: x.mode, secret: x.secret, build, host, listen, port: x.port, registeredAt: typeof x.registeredAt === "number" ? x.registeredAt : 0, report: relayReportOf(x.report) });
    }
    const counted = new Map<UserId, number>();
    for (const x of kept.sort((a, b) => b.registeredAt - a.registeredAt)) {
      const n = (counted.get(x.user) ?? 0) + 1;
      counted.set(x.user, n);
      if (n <= RELAYS_PER_USER) r.relays[x.id] = x;
    }
  }
  if (isRecord(raw.shared)) r.shared = { enabled: raw.shared.enabled === true, by: typeof raw.shared.by === "string" ? raw.shared.by : null, at: typeof raw.shared.at === "number" ? raw.shared.at : null };
  return r;
}

export class LoopbackStore {
  private loaded: Promise<Registry> | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** The stored text this build couldn't read: kept aside (`UNREADABLE_FILE`) before the first write over it. */
  private unreadable: string | null = null;

  constructor(private readonly host: Pick<HostPort, "extensionStorage" | "log">) {}

  /**
   * The registry as stored, read once. A file this build can't read (not JSON, or not a registry it
   * knows) reads as empty, every relay registering again and each user minting a new key, and is
   * kept aside before anything is written over it. A read that fails is never kept: it fails the
   * request that asked, and the next one reads again, so an outage never stands for an empty registry.
   */
  read(): Promise<Registry> {
    this.loaded ??= this.host.extensionStorage.read(FILE).then(
      (text) => {
        if (text === null) return empty();
        let registry: Registry | null = null;
        try {
          registry = registryOf(JSON.parse(text));
        } catch {
          // Not JSON: as unreadable as a registry of another kind.
        }
        if (registry !== null) return registry;
        this.unreadable = text;
        this.host.log("warn", `[LumiRPEngine] the loopback's registry couldn't be read: every relay registers again, and each user mints a new key (the file is kept as ${UNREADABLE_FILE})`);
        return empty();
      },
      (error: unknown) => {
        this.loaded = null;
        throw new Error(`LumiRPEngine couldn't read the loopback's registry (${error instanceof Error ? error.message : String(error)}). Try again in a moment.`);
      },
    );
    return this.loaded;
  }

  /** Changes the registry and writes it, one change at a time; a file it couldn't read is kept aside first, and nothing is written over it until that is done. */
  async change<T>(fn: (r: Registry) => T): Promise<T> {
    const r = await this.read();
    const out = fn(r);
    const text = JSON.stringify(r);
    this.writing = this.writing
      .then(async () => {
        const unreadable = this.unreadable;
        if (unreadable !== null) {
          await this.host.extensionStorage.write(UNREADABLE_FILE, unreadable);
          this.unreadable = null;
        }
        await this.host.extensionStorage.write(FILE, text);
      })
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the loopback's registry wasn't saved (${error instanceof Error ? error.message : String(error)})`));
    await this.writing;
    return out;
  }

  /** The user a loopback key belongs to; null for a key no user has. */
  async keyUser(key: string): Promise<UserId | null> {
    const hash = await sha256(key);
    const r = await this.read();
    return Object.entries(r.keys).find(([, k]) => k.hash === hash)?.[0] ?? null;
  }

  /** The relay a secret belongs to; null for a secret of no relay. */
  async relayOf(secret: string): Promise<RelayRecord | null> {
    const hash = await sha256(secret);
    return Object.values((await this.read()).relays).find((x) => x.secret === hash) ?? null;
  }

  /** Resolves once every write is done (tests). */
  settle(): Promise<void> {
    return this.writing;
  }
}
