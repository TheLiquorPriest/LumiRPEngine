// The guard's registration (DESIGN §5.1), kept with the old backend until §15.4 removes it. Today's
// ledger moved to src/migrate/today/ledger-io.ts (PlanSwap-5), where the migration reads chats with
// it; the old runtime's ledger is that ledger with its guard registered.

import { HOST_LIMITS } from "../shared/timeouts";
import { LedgerService as TodayLedgerService } from "../migrate/today/ledger-io";

export class LedgerService extends TodayLedgerService {
  /**
   * Registers the guard again when its wait changes (the host replaces a registration); before any
   * user's settings are read, it asks for Lumiverse's longest. The host replaces it inside the handler
   * list its chain walks, which would skip the next extension's handler or run this one twice, so
   * while a generation or a call of the guard is under way the change waits for them.
   */
  protected override registerGuard(): void {
    const timeout = this.guardWait.size === 0 ? HOST_LIMITS.contextHandler.maxMs : Math.max(...this.guardWait.values());
    if (timeout === this.guardTimeout || (this.guardTimeout > 0 && (this.generating.size > 0 || this.guarding > 0))) return;
    this.guardTimeout = timeout;
    this.host.registerContextHandler(async (input, signal) => {
      this.guarding++;
      try {
        return await this.guard(input, signal);
      } finally {
        this.guarding--;
      }
    }, { timeoutMs: timeout, required: this.host.capabilities.required });
  }
}
