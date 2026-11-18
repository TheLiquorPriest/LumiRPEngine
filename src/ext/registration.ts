// Where this user's RPE is, as RPE last said (STANDALONE-PLAN §4.3): its address on loopback, the key
// that proves the extension to it, its connections in Lumiverse and its relay socket's session. RPE
// tells the extension each time its relay socket opens; the extension keeps it in that user's own
// storage, in a folder today's build never used (`REGISTRATION_FILE`), so a restarted worker knows its
// road before RPE has said it again. It is the extension's one file, and holds no setting.
//
// Any socket of any user can send a registration, so one is kept only once RPE itself confirms it:
// asked at the address it names, on the route only the key in force opens, for the user whose socket
// sent it (§4.4: another user of the same Lumiverse gets none). Else the pipe would carry a page's
// requests to whatever program that user named on this machine's loopback. A stored registration that
// does not say RPE confirmed it (one stored before the extension asked) is confirmed before it is used.
//
// Whose chat a reply is (N-3) does not hang on that file: a reply on a connection the registration held
// in memory names is RPE's; else the connection's own record in Lumiverse tells, by RPE's mark in its
// `metadata`, which RPE writes on every connection it takes (at install and at the swap). Only where
// neither can be read is it not known. Each of those reads is waited for up to RPE's setting
// `lumiverse.extension.whoseWaitSeconds`, given with the registration (`WHOSE_WAIT_MS` until one is held): a read
// that does not answer in it has failed, and says so.

import { CONFIRM_PATH, onLoopback, readConfirmed, readRegistration, REGISTRATION_FILE, rpeMarked, USER_HEADER, type ConfirmAsk, type Registration } from "../adapter/lumiverse/pipe-wire";
import { isRecord } from "../shared/json";
import type { Road } from "./road";
import type { ExtSpindle, ProxyAnswer } from "./spindle";

/** Whose chat a reply on a connection is: RPE's or not, or not known, with how each read failed. */
export type Whose = { rpe: boolean } | { unknown: { registration: string; mark: string } };

export interface RegistrationDeps {
  storage: ExtSpindle["userStorage"];
  proxy: ExtSpindle["cors"];
  connections: ExtSpindle["connections"];
  /** This user's stored registration could not be read, and why; null once it could. */
  unread(user: string, why: string | null): void;
  log(message: string): void;
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** How long each read of whose chat a reply is waits, until RPE's registration gives its own (`lumiverse.extension.whoseWaitSeconds`). */
export const WHOSE_WAIT_MS = 2_000;

/** `read`, or a rejection saying it did not answer within `ms`. */
async function within<T>(read: Promise<T>, ms: number): Promise<T> {
  const late = Promise.withResolvers<never>();
  const timer = setTimeout(() => late.reject(new Error(`it did not answer within ${ms / 1000} s`)), ms);
  try {
    return await Promise.race([read, late.promise]);
  } finally {
    clearTimeout(timer);
  }
}

export class Registrations {
  /** By user: the registration held; null where RPE never registered for them, or what was stored is not RPE's to trust. */
  private readonly byUser = new Map<string, Registration | null>();
  /** By user: the read of their stored registration under way. */
  private readonly reading = new Map<string, Promise<Registration | null>>();
  /** By user and connection: whether the connection's own record carries RPE's mark, read once for the worker's life. */
  private readonly marks = new Map<string, boolean>();

  constructor(private readonly deps: RegistrationDeps) {}

  /** This user's registration: from memory, else from their storage the first time; null when RPE never registered for them. Rejects where the storage cannot be read. */
  of(user: string): Promise<Registration | null> {
    if (this.byUser.has(user)) return Promise.resolve(this.byUser.get(user) ?? null);
    let read = this.reading.get(user);
    if (read === undefined) {
      read = this.read(user).finally(() => this.reading.delete(user));
      this.reading.set(user, read);
    }
    return read;
  }

  private async read(user: string): Promise<Registration | null> {
    let stored: unknown;
    try {
      stored = await this.deps.storage.getJson<unknown>(REGISTRATION_FILE, { fallback: null, userId: user });
    } catch (error) {
      this.deps.unread(user, words(error));
      throw error;
    }
    this.deps.unread(user, null);
    let kept = readRegistration(stored);
    if (kept !== null && !(isRecord(stored) && stored.confirmed === true)) {
      const doubt = await this.confirm(user, kept);
      if (doubt === null) await this.store(user, kept).catch((error: unknown) => this.deps.log(`the confirmed registration of user ${user} was not stored again: ${words(error)}`));
      else {
        this.deps.log(`the registration stored for user ${user} is not used: ${doubt}`);
        kept = null;
      }
    }
    // A registration RPE sent while the file was being read is newer than the file: it stays.
    if (!this.byUser.has(user)) this.byUser.set(user, kept);
    return this.byUser.get(user) ?? null;
  }

  /** Kept in the user's storage with the word that RPE confirmed it. */
  private store(user: string, registration: Registration): Promise<void> {
    return this.deps.storage.setJson(REGISTRATION_FILE, { ...registration, confirmed: true }, { userId: user });
  }

  /**
   * A registration sent from this user's socket: kept in memory and in their storage once RPE confirms
   * it. Only an address on this machine's loopback is asked, since the road carries lore secrets (§4.3:
   * the road is loopback). The very registration kept already was confirmed when it was kept. Null when
   * it is kept; else why it is not, in words RPE shows its user.
   */
  async keep(user: string, registration: Registration): Promise<string | null> {
    if (!onLoopback(registration.base)) return `its address ${registration.base} is not a bare address on this machine's loopback (a scheme, a host and a port, nothing more), the only road the extension takes to RPE.`;
    const held = await this.of(user).catch(() => undefined);
    if (held !== undefined && JSON.stringify(held) === JSON.stringify(registration)) return null;
    const doubt = await this.confirm(user, registration);
    if (doubt !== null) return doubt;
    this.byUser.set(user, registration);
    this.deps.unread(user, null);
    await this.store(user, registration);
    return null;
  }

  /** Asks RPE, at the address the registration names and with its key, whether it is RPE's own for this user: null when RPE confirms it; else why not. */
  private async confirm(user: string, registration: Registration): Promise<string | null> {
    const base = registration.base.replace(/\/+$/, "");
    const ask: ConfirmAsk = { relay: registration.relay, connections: registration.connections };
    let answer: ProxyAnswer;
    try {
      answer = await this.deps.proxy(`${base}${CONFIRM_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${registration.key}`, [USER_HEADER]: user }, body: JSON.stringify(ask) });
    } catch (error) {
      return `the extension could not reach RPE at ${base} to confirm it (${words(error)}).`;
    }
    let body: unknown = null;
    try {
      body = JSON.parse(answer.body ?? "");
    } catch {
      // Not JSON: nothing RPE answers.
    }
    if (answer.status !== 200) return `RPE did not confirm it (it answered ${answer.status}${isRecord(body) && typeof body.error === "string" ? `: ${body.error.replace(/\.$/, "")}` : ""}).`;
    const confirmed = readConfirmed(body);
    return confirmed !== null && confirmed.user === user && confirmed.relay === registration.relay ? null : `what answers at ${base} is not RPE.`;
  }

  /** The users RPE registered for, as known in memory now. */
  users(): string[] {
    return [...this.byUser].flatMap(([user, r]) => (r === null ? [] : [user]));
  }

  /** This user's road to RPE: its address, the key as the bearer and the user it is for, and RPE's values for it; null where RPE does not belong to them, or their registration cannot be read. */
  async road(user: string): Promise<Road | null> {
    const r = await this.of(user).catch(() => null);
    return r === null ? null : { base: r.base.replace(/\/+$/, ""), headers: { authorization: `Bearer ${r.key}`, [USER_HEADER]: user }, waitMs: r.values.questionMs, logChars: r.values.logChars };
  }

  /** Whether the connection's own record carries RPE's mark; kept for the worker's life once read. */
  private async marked(connection: string, user: string): Promise<boolean> {
    const key = `${user}\u0000${connection}`;
    const kept = this.marks.get(key);
    if (kept !== undefined) return kept;
    const profile = await this.deps.connections.get(connection, user);
    const marked = profile !== null && rpeMarked(profile.metadata);
    this.marks.set(key, marked);
    return marked;
  }

  /**
   * Whose chat a reply on this connection is: RPE's where the registration held in memory names the
   * connection, or the connection's own record carries RPE's mark; another's where neither says so. The
   * registration is read from storage only where it is not held and the record cannot be read. Each read
   * waits up to the registration's `whoseMs` (or `WHOSE_WAIT_MS` with none held), and one past it has failed.
   */
  async whose(connection: string, user: string): Promise<Whose> {
    const held = this.byUser.get(user);
    if (held?.connections.includes(connection) === true) return { rpe: true };
    const waitMs = held?.values.whoseMs ?? WHOSE_WAIT_MS;
    let mark: string;
    try {
      return { rpe: await within(this.marked(connection, user), waitMs) };
    } catch (error) {
      mark = words(error);
    }
    if (held !== undefined) return { rpe: false };
    try {
      return { rpe: (await within(this.of(user), waitMs))?.connections.includes(connection) === true };
    } catch (error) {
      return { unknown: { registration: words(error), mark } };
    }
  }
}
