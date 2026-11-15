// RPE's light extension put on the stand-in Lumiverse as an admin puts it on a real one (`spindle.ts`, `routes/spindle.routes.ts`), for the rigs and the tests that need it running: installed from the
// branch of its repository `spindle.json` names, stored with the permissions that file asks for, the ones that need an admin granted by one, enabled (which grants the others and starts its worker)
// and any the test withholds revoked. A rig that wants the extension to find a permission missing at its start gives `granted` without it; one that grants it later does so as the admin does:
// `host.spindle.setPermissions(ADMIN, id, { grant: [permission] })`, which the worker hears on a later task.

import manifest from "../../spindle.json";
import type { Installed } from "./host";
import type { StandIn } from "./lumiverse";
import type { Extension, Viewer } from "./spindle";

/** The admin who sets the extension up: an operator's install is for every user, so which account it is makes no difference to it. */
export const ADMIN: Viewer = { userId: "user-admin", role: "admin" };

/** What the extension asks for (`spindle.json`). */
export const ASKED: readonly string[] = manifest.permissions;

/**
 * The extension installed, granted `granted` (all it asks for where none is said) and enabled as the admin does, with `code` started in its worker when it is given. Gives Lumiverse's id for it and
 * its worker's view of Spindle.
 */
export async function installRpe(host: StandIn, options: { granted?: readonly string[]; code?: Extension } = {}): Promise<{ id: string; worker: Installed }> {
  const info = await host.spindle.setUp(ADMIN, { url: manifest.github, manifest, granted: options.granted ?? ASKED, ...(options.code === undefined ? {} : { code: options.code }) });
  return { id: info.id, worker: host.spindle.worker(info.id)! };
}
