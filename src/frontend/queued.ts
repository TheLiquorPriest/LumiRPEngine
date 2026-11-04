// The one toast a write held behind a turn shows (DESIGN §5.1, P2): made while the engine plans a
// turn, while the turn waits for the page to start its reply, or while the reply is written, it lands
// once that turn is over, wherever it was made.

import type { App } from "./app";

export const QUEUED_TOAST = "Queued — lands after the turn";

/** Shows the toast when a write's answer says it was held (`pending`); true when it was. */
export function toastQueued(app: Pick<App, "toast">, result: { pending?: boolean } | null | undefined): boolean {
  if (result?.pending !== true) return false;
  app.toast(QUEUED_TOAST, "info");
  return true;
}
