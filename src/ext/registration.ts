// Where this user's RPE is, as RPE last said (STANDALONE-PLAN §4.3): its address on loopback, the key
// that proves the extension to it, its connection in Lumiverse and its relay socket's session. RPE
// tells the extension each time its relay socket opens; the extension keeps it in that user's own
// storage, in a folder today's build never used (`REGISTRATION_FILE`), so a restarted worker knows its
// road before RPE has said it again. It is the extension's one file, and holds no setting.
//
// Any socket of any user can send a registration, so one is kept only once RPE itself confirms it:
// asked at the address it names, on the route only the key in force opens, for the user whose socket
// sent it (§4.4: another user of the same Lumiverse gets none). Else the pipe would carry a page's
// requests to whatever program that user named on this machine's loopback.

import { CONFIRM_PATH, onLoopback, readConfirmed, readRegistration, REGISTRATION_FILE, USER_HEADER, type ConfirmAsk, type Registration } from "../adapter/lumiverse/pipe-wire";
import { isRecord } from "../shared/json";
import type { Road } from "./road";
import type { ExtSpindle, ProxyAnswer } from "./spindle";

export class Registrations {
  private readonly byUser = new Map<string, Registration | null>();

  constructor(
    private readonly storage: ExtSpindle["userStorage"],
    private readonly proxy: ExtSpindle["cors"],
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
   * A registration sent from this user's socket: kept in memory and in their storage once RPE confirms
   * it. Only an address on this machine's loopback is asked, since the road carries lore secrets (§4.3:
   * the road is loopback). The very registration kept already was confirmed when it was kept. Null when
   * it is kept; else why it is not, in words RPE shows its user.
   */
  async keep(user: string, registration: Registration): Promise<string | null> {
    if (!onLoopback(registration.base)) return `its address ${registration.base} is not a bare address on this machine's loopback (a scheme, a host and a port, nothing more), the only road the extension takes to RPE.`;
    if (JSON.stringify(await this.of(user)) === JSON.stringify(registration)) return null;
    const doubt = await this.confirm(user, registration);
    if (doubt !== null) return doubt;
    this.byUser.set(user, registration);
    await this.storage.setJson(REGISTRATION_FILE, registration, { userId: user });
    return null;
  }

  /** Asks RPE, at the address the registration names and with its key, whether it is RPE's own for this user: null when RPE confirms it; else why not. */
  private async confirm(user: string, registration: Registration): Promise<string | null> {
    const base = registration.base.replace(/\/+$/, "");
    const ask: ConfirmAsk = { relay: registration.relay, connection: registration.connection };
    let answer: ProxyAnswer;
    try {
      answer = await this.proxy(`${base}${CONFIRM_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${registration.key}`, [USER_HEADER]: user }, body: JSON.stringify(ask) });
    } catch (error) {
      return `the extension could not reach RPE at ${base} to confirm it (${error instanceof Error ? error.message : String(error)}).`;
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
