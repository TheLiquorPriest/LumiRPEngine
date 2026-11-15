// What the bed's host needs of the machine it runs on (PlanScenarios-3 items 1, 5, 9). Everything comes from the
// environment with no default, so nothing here names a host, a user, a port, a path or a key: the variables are the
// bed scripts' own (`scripts/testbed/README.md`): `LRE_HOST_URL`, `LRE_DATA_DIR`, `LRE_INSTANCE_DIR`,
// `LRE_CONNECTION_NAME` and `LRE_NEVER_TOUCH` (`scripts/testbed/lib/env.ts`), the instance's user's
// `LRE_OWNER_USERNAME` and `LRE_OWNER_PASSWORD` (`scripts/testbed/lib/instance/env.ts`), and the floor's four
// (`FLOOR_PLAIN_CONNECTION`, `FLOOR_RPE_CONNECTION`, `FLOOR_RPE_URL`, `FLOOR_RPE_TOKEN`): RPE's address and web key
// and the names of Lumiverse's two connections, plain generation's and RPE's. The second invented user's sign-in
// (`LRE_OTHER_USERNAME`, `LRE_OTHER_PASSWORD`) is read only where a scenario says it plays as that user.
// A password or a key is never printed or written.

import { readEnv, type TestbedEnv } from "../../testbed/lib/env";

export interface Account {
  username: string;
  password: string;
}

export interface LiveEnv {
  /** The bed scripts' own: Lumiverse's address, its data folder, the instance's folder, the instance's connection's name, the ids never to touch. */
  bed: TestbedEnv;
  /** The instance's user: the one the host signs in as. */
  owner: Account;
  /** RPE's address, as its server listens, and the web key its pages and routes let in. */
  rpe: { base: string; token: string };
  /** The two connections' names in Lumiverse: plain generation on the allowed model, and RPE's. */
  connections: { plain: string; rpe: string };
}

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`set ${name} (see scripts/testbed/README.md)`);
  return value;
}

/** The bed's host's settings from the environment; names the first variable that is not set. */
export function readLiveEnv(): LiveEnv {
  return {
    bed: readEnv(),
    owner: { username: need("LRE_OWNER_USERNAME"), password: need("LRE_OWNER_PASSWORD") },
    rpe: { base: need("FLOOR_RPE_URL").replace(/\/+$/, ""), token: need("FLOOR_RPE_TOKEN") },
    connections: { plain: need("FLOOR_PLAIN_CONNECTION"), rpe: need("FLOOR_RPE_CONNECTION") },
  };
}

/** The second invented user's sign-in, for a scenario that plays as that user (the boundary checks). */
export function readOtherAccount(): Account {
  return { username: need("LRE_OTHER_USERNAME"), password: need("LRE_OTHER_PASSWORD") };
}
