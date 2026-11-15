// The swap's reads of Lumiverse through its HTTP API (STANDALONE-PLAN §15.2; PlanSwap-1): what the swap
// asks of Lumiverse before it takes a connection over, as the signed-in user, read-only.

import { isRecord } from "../../shared/json";
import { answer, type LumiverseCall } from "./install-calls";

/**
 * The permissions Lumiverse has granted the extension with this identifier (not the ones its manifest
 * asks for): its id found in `GET /api/v1/spindle`, then `GET /api/v1/spindle/:id/permissions`, which
 * answers `{ requested, granted }` (`routes/spindle.routes.ts:452-460`). Null where the extension is not
 * listed for the user, or Lumiverse does not say what it granted.
 */
export async function grantedPermissions(call: LumiverseCall, identifier: string): Promise<string[] | null> {
  const list = await answer(await call("GET", "/api/v1/spindle"), "the list of its extensions");
  const found = isRecord(list) && Array.isArray(list.extensions) ? list.extensions.find((e) => isRecord(e) && e.identifier === identifier) : undefined;
  if (!isRecord(found) || typeof found.id !== "string") return null;
  const body = await answer(await call("GET", `/api/v1/spindle/${encodeURIComponent(found.id)}/permissions`), "the permissions it granted the extension");
  return isRecord(body) && Array.isArray(body.granted) ? body.granted.filter((p): p is string => typeof p === "string") : null;
}
