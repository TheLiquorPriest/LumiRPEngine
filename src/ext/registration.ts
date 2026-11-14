// Where this user's RPE is, as RPE last said (STANDALONE-PLAN §4.3): its address on loopback, the key
// that proves the extension to it, its connection in Lumiverse and its relay socket's session. RPE
// tells the extension each time its relay socket opens; the extension keeps it in that user's own
// storage, in a folder today's build never used (`REGISTRATION_FILE`), so a restarted worker knows its
// road before RPE has said it again. It is the extension's one file, and holds no setting.

import { onLoopback, readRegistration, REGISTRATION_FILE, USER_HEADER, type Registration } from "../adapter/lumiverse/pipe-wire";
import type { Road } from "./road";
import type { ExtSpindle } from "./spindle";

export class Registrations {
  private readonly byUser = new Map<string, Registration | null>();

  constructor(
    private readonly storage: ExtSpindle["userStorage"],
    private readonly log: (message: string) => void,
  ) {}

  /** This user's registration: from memory, else from their storage the first time; null when RPE never registered for them. */
  async of(user: string): Promise<Registration | null> {
    if (this.byUser.has(user)) return this.byUser.get(user) ?? null;
    const kept = readRegistration(await this.storage.getJson<unknown>(REGISTRATION_FILE, { fallback: null, userId: user }));
    // A registration RPE sent while the file was being read is newer than the file: it stays.
    if (!this.byUser.has(user)) this.byUser.set(user, kept);
    return this.byUser.get(user) ?? null;
  }

  /**
   * RPE registered for this user: kept in memory and in their storage. Only an address on this
   * machine's loopback is taken, since the road carries lore secrets (§4.3: the road is loopback).
   */
  async keep(user: string, registration: Registration): Promise<boolean> {
    if (!onLoopback(registration.base)) {
      this.log(`RPE's registration was refused: its address ${registration.base} is not on this machine's loopback`);
      return false;
    }
    const before = this.byUser.get(user);
    this.byUser.set(user, registration);
    if (JSON.stringify(before) !== JSON.stringify(registration)) await this.storage.setJson(REGISTRATION_FILE, registration, { userId: user });
    return true;
  }

  /** The users RPE registered for, as known in memory now. */
  users(): string[] {
    return [...this.byUser].flatMap(([user, r]) => (r === null ? [] : [user]));
  }

  /** This user's road to RPE: its address, the key as the bearer and the user it is for; null where RPE does not belong to them. */
  async road(user: string): Promise<Road | null> {
    const r = await this.of(user);
    return r === null ? null : { base: r.base.replace(/\/+$/, ""), headers: { authorization: `Bearer ${r.key}`, [USER_HEADER]: user } };
  }

  /** Whether a reply on this connection is RPE's to play. */
  async isRpe(connection: string, user: string): Promise<boolean> {
    return (await this.of(user))?.connection === connection;
  }
}
