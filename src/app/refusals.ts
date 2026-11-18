// Refused sign-ins to RPE's web app, told in its log (plan §16): a call that brings a token RPE does not accept, and a sign-in with a Lumiverse
// account that RPE or Lumiverse refused. The first from an address is a line at warn at once, naming the address (never a token or a password);
// the rest from that address over the next `auth.refusedSignInSeconds` are counted and told as one line with their number, so a flood of
// refusals is two lines and not a line each.

import type { Log } from "rp-harness/contract";

/** What was refused: a token RPE does not accept, or a Lumiverse account's sign-in. */
export type RefusedBy = "token" | "account";

const FIRST: Readonly<Record<RefusedBy, string>> = {
  token: "its token is not one RPE accepts, or it has ended",
  account: "the Lumiverse account or password was refused",
};

export class RefusedSignIns {
  readonly #runs = new Map<string, { later: number; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: { log: Log; seconds: number }) {}

  /** A sign-in or a call from `address` was refused. */
  refused(address: string, by: RefusedBy): void {
    const run = this.#runs.get(address);
    if (run !== undefined) {
      run.later += 1;
      return;
    }
    this.deps.log.warn(`A ${by === "token" ? "call" : "sign-in"} to RPE's web app was refused from ${address}: ${FIRST[by]}.`, { address, refused: by });
    const timer = setTimeout(() => this.#tell(address), this.deps.seconds * 1000);
    timer.unref();
    this.#runs.set(address, { later: 0, timer });
  }

  /** The run from `address` is over: what came after its first line is told as one line. */
  #tell(address: string): void {
    const run = this.#runs.get(address);
    if (run === undefined) return;
    this.#runs.delete(address);
    if (run.later > 0) this.deps.log.warn(`${run.later} more sign-ins or calls to RPE's web app were refused from ${address} in the last ${this.deps.seconds} seconds.`, { address, count: run.later });
  }

  /** Tells every run still open: when RPE stops. */
  flush(): void {
    for (const [address, run] of [...this.#runs]) {
      clearTimeout(run.timer);
      this.#tell(address);
    }
  }
}
