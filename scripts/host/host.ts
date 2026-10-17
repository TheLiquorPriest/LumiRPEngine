// Host control for integration on a dev host (never the update route, never a push).
// Usage: bun scripts/host/host.ts [status|restart|log [userId]]
// Configuration and owner credentials come from the environment (scripts/host/lib.ts); the password is never printed.

import { existsSync, readFileSync } from "node:fs";
import { api, dataDir, IDENTIFIER, signIn } from "./lib";

async function extension(): Promise<{ id: string; enabled: boolean; status?: string }> {
  const r = await api("GET", "/api/v1/spindle");
  const list = typeof r.data === "object" && r.data !== null && "extensions" in r.data && Array.isArray(r.data.extensions) ? r.data.extensions : [];
  for (const e of list) {
    if (typeof e === "object" && e !== null && "identifier" in e && e.identifier === IDENTIFIER && "id" in e && typeof e.id === "string") {
      return { id: e.id, enabled: "enabled" in e && e.enabled === true, ...("status" in e && typeof e.status === "string" ? { status: e.status } : {}) };
    }
  }
  throw new Error(`${IDENTIFIER} is not installed`);
}

const action = process.argv[2] ?? "status";
await signIn();
const ext = await extension();
if (action === "restart") {
  const r = await api("POST", `/api/v1/spindle/${ext.id}/restart`);
  console.log(JSON.stringify({ restart: r.status, data: r.data }));
} else if (action === "log") {
  const path = `${dataDir()}/extensions/${IDENTIFIER}/storage/diagnostics/backend.log`;
  console.log(existsSync(path) ? readFileSync(path, "utf8").split("\n").slice(-80).join("\n") : "(no diagnostics log yet)");
  // Lines about a user's chats live in that user's storage; `log <userId>` shows them.
  const user = process.argv[3];
  if (user) {
    const mine = `${dataDir()}/users/${user}/extensions/${IDENTIFIER}/diagnostics.log`;
    console.log(existsSync(mine) ? readFileSync(mine, "utf8").split("\n").slice(-80).join("\n") : "(no user diagnostics yet)");
  }
}
const after = await extension();
const perms = await api("GET", `/api/v1/spindle/${after.id}/permissions`);
console.log(JSON.stringify({ id: after.id, enabled: after.enabled, status: after.status ?? null, permissions: perms.data }));
