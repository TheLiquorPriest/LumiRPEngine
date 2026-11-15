// Steps 1 to 3 of making the test instance from nothing (PlanScenarios-4 item 1), done by the owner
// through Lumiverse's own routes as its pages call them: the owner's connections (the Connections
// page), the second invented user (Settings → Users), and today's pushed build installed, granted,
// enabled and running for every user (the Extensions page). "Lumiverse" below is its checkout at
// a70f4ed2: `src/` for the server, `frontend/src/` for its pages.

import { IDENTIFIER } from "../env";
import { HttpError, type Lumiverse } from "../lumiverse";
import { say } from "../record";
import { buildDir } from "./env";
import type { SetupCtx, SetupStep } from "./setup";
import { git } from "./setup-runtime";

/**
 * The install runs a clone, `bun install` and a build within its request, with no limit of
 * Lumiverse's own on any of them (src/spindle/manager.service.ts:1382-1389, :1177, :1484): fifteen
 * minutes holds a slow clone and install.
 */
const INSTALL_MS = 15 * 60_000;
/** How long an enabled extension may take to show as running: Lumiverse starts its worker within the enable request itself (src/routes/spindle.routes.ts:375-377). */
const RUN_MS = 2 * 60_000;
const POLL_MS = 3_000;

/** The second connection: a model choice naming it is one RPE will have no connection to match (STANDALONE-PLAN §15.2, "Which model each kind of work uses"). Invented, never called, and given no key. */
const UNMATCHED_NAME = "Unmatched model (never called)";
const UNMATCHED_MODEL = "invented-model-never-called";
/**
 * Providers Lumiverse registers (src/llm/registry.ts:56, :59; src/llm/providers/mistral.ts:5,
 * groq.ts:5) for which its Connections form adds no settings of its own to a new connection
 * (frontend/src/components/panels/connection-manager/ConnectionForm.tsx:312-318, :462-514): the
 * unmatched connection takes the first that isn't the main one's.
 */
const UNMATCHED_PROVIDERS = ["mistral", "groq"] as const;

// ---------------------------------------------------------------- connections

/** A connection as Lumiverse lists it; the key itself is never returned (src/services/connections.service.ts:267-275). */
interface Connection {
  id: string;
  name: string;
  provider: string;
  model: string;
  has_api_key: boolean;
}

/** Every connection of the user's, paged by 200 as the Connections page pages them (frontend/src/api/listAllConnections.ts:3-19; src/routes/connections.routes.ts:44-53). */
async function listConnections(host: Lumiverse): Promise<Connection[]> {
  const out: Connection[] = [];
  for (;;) {
    const page = await host.call<{ data: Connection[]; total: number }>("GET", `/api/v1/connections?limit=200&offset=${out.length}`);
    out.push(...page.data);
    if (page.data.length === 0 || out.length >= page.total) return out;
  }
}

/**
 * The owner's connection named `want.name`, made unless an earlier run made it. The page creates one
 * with `POST /api/v1/connections` and the form's fields: name, provider, the key, the model, whether
 * it is the default (off unless ticked) and the provider's own settings, none for these providers;
 * an address only where one is typed (ConnectionForm.tsx:104-109, :526-534;
 * frontend/src/components/panels/ConnectionManager.tsx:122-124; frontend/src/api/connections.ts:18-20).
 * Lumiverse asks for nothing but a name and a provider (src/routes/connections.routes.ts:55-61), and
 * keeps a key only when one is given (src/services/connections.service.ts:459-489).
 */
async function ensureConnection(s: SetupCtx, host: Lumiverse, want: { state: string; name: string; provider: string; model: string; key: string | null }): Promise<void> {
  const named = (await listConnections(host)).filter((c) => c.name === want.name);
  if (named.length > 1) throw new Error(`the owner has ${named.length} Lumiverse connections named "${want.name}"`);
  let found = named[0];
  if (found !== undefined) {
    if (found.provider !== want.provider || found.model !== want.model || found.has_api_key !== (want.key !== null)) {
      throw new Error(`the owner's Lumiverse connection "${want.name}" is ${found.provider} / ${found.model}${found.has_api_key ? " with a key" : " without a key"}, not what the set-up makes: it doesn't change a connection it didn't make`);
    }
    say(`  the connection "${want.name}" stands from an earlier run`);
  } else {
    found = await host.call<Connection>("POST", "/api/v1/connections", { name: want.name, provider: want.provider, ...(want.key !== null ? { api_key: want.key } : {}), model: want.model, is_default: false, metadata: {} });
    s.log.log({ step: "connection", action: "created", kind: "Lumiverse connection (connection_profiles; a key in the secrets table)", id: found.id, name: found.name, detail: { provider: want.provider, model: want.model, key: want.key !== null } });
  }
  s.log.set(want.state, found.id);
}

export const connection: SetupStep = {
  name: "connection",
  makes: "the owner's Lumiverse connections: the allowed model with its key, and an invented model no RPE connection will match",
  async run(s) {
    const host = await s.session("owner");
    // The providers the Connections page offers (src/routes/providers.routes.ts:6-14, mounted at src/app.ts:446): Lumiverse saves any name, but generates only on one of these.
    const offered = (await host.call<{ providers: { id: string }[] }>("GET", "/api/v1/providers")).providers.map((p) => p.id);
    const unmatched = s.env.provider === UNMATCHED_PROVIDERS[0] ? UNMATCHED_PROVIDERS[1] : UNMATCHED_PROVIDERS[0];
    for (const provider of [s.env.provider, unmatched]) if (!offered.includes(provider)) throw new Error(`Lumiverse offers no provider "${provider}" (it offers ${offered.join(", ")})`);
    await ensureConnection(s, host, { state: "connection:main", name: s.env.connectionName, provider: s.env.provider, model: s.env.model, key: s.env.providerKey });
    // No key: Lumiverse requires none to save a connection of any provider; only a call on it would need one, and fail without (src/services/connections.service.ts:467-471, :657-665).
    await ensureConnection(s, host, { state: "connection:unmatched", name: UNMATCHED_NAME, provider: unmatched, model: UNMATCHED_MODEL, key: null });
  },
};

// ---------------------------------------------------------------- the second user

interface UserRow {
  id: string;
  username: string | null;
  role: string | null;
}

export const users: SetupStep = {
  name: "users",
  makes: "the second invented user, made by the owner on Lumiverse's user admin page",
  async run(s) {
    const host = await s.session("owner");
    const ownerId = await host.userId();
    s.log.set("user:owner", ownerId);
    // Settings → Users lists every user (`GET /api/v1/users`, owner or admin only) and makes one with
    // `POST /api/v1/users` and `{ username, password, role }`, its role "user" unless chosen
    // (frontend/src/components/settings/UserManagement.tsx:26, :65; frontend/src/store/slices/auth.ts:169-174;
    // src/routes/users.routes.ts:88-97, :102-147, mounted at src/app.ts:451). Usernames are kept in
    // lower case (src/auth/index.ts:114-116).
    const wanted = s.env.other.username.toLowerCase();
    let other = (await host.call<UserRow[]>("GET", "/api/v1/users")).find((u) => u.username?.toLowerCase() === wanted);
    if (other === undefined) {
      const made = await host.call<{ id: string }>("POST", "/api/v1/users", { username: s.env.other.username, password: s.env.other.password, role: "user" });
      other = (await host.call<UserRow[]>("GET", "/api/v1/users")).find((u) => u.id === made.id);
      if (other === undefined) throw new Error(`Lumiverse made the user ${s.env.other.username} (${made.id}) but doesn't list it`);
      s.log.log({ step: "users", action: "created", kind: "Lumiverse user", id: other.id, name: other.username ?? wanted, detail: { role: other.role } });
    }
    if (other.id === ownerId || other.role !== "user") throw new Error(`the user ${s.env.other.username} is ${other.id === ownerId ? "the owner" : `a${other.role === "admin" ? "n" : ""} ${other.role ?? "roleless"} account`}, not a second plain user`);
    s.log.set("user:other", other.id);
  },
};

// ---------------------------------------------------------------- today's build

/** An extension as `GET /api/v1/spindle` lists it (src/routes/spindle.routes.ts:46-58; src/spindle/manager.service.ts:2395-2449). */
interface Extension {
  id: string;
  identifier: string;
  name: string;
  enabled: boolean;
  status: string;
  permissions: string[];
  granted_permissions: string[];
  metadata: { install_scope?: string | null; branch?: string | null };
}

async function extensionOf(host: Lumiverse): Promise<Extension | undefined> {
  return (await host.call<{ extensions: Extension[] }>("GET", "/api/v1/spindle")).extensions.find((e) => e.identifier === IDENTIFIER);
}

/**
 * The Extensions page's install from a repository and a branch: `POST /api/v1/spindle/install` with
 * `{ github_url, branch }`, no scope, so the install is the operator's (frontend/src/api/spindle.ts:67-69;
 * src/routes/spindle.routes.ts:185-225). The request holds the clone, `bun install` and the build;
 * where it ends without an answer, the install may still go on in Lumiverse, so the extension is
 * looked for until the same limit.
 */
async function installBuild(s: SetupCtx, host: Lumiverse): Promise<Extension> {
  const deadline = Date.now() + INSTALL_MS;
  const reply = await fetch(`${host.base}/api/v1/spindle/install`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ github_url: s.env.buildUrl, branch: s.env.buildBranch }),
    redirect: "manual",
    signal: AbortSignal.timeout(INSTALL_MS),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (reply instanceof Error) say(`  the install request ended without an answer (${reply.message}); looking for the extension`);
  else if (!reply.ok) {
    const text = await reply.text();
    // Another install of the same identifier is refused as "already installed" (src/spindle/manager.service.ts:1460-1464): it is found below.
    if (!text.includes("already installed")) throw new HttpError(reply.status, text, "POST /api/v1/spindle/install");
  }
  for (;;) {
    const found = await extensionOf(host);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`today's build isn't installed ${INSTALL_MS / 60_000} minutes after the install was asked for`);
    await Bun.sleep(POLL_MS);
  }
}

export const install: SetupStep = {
  name: "install",
  makes: "today's pushed build installed from its branch on the Extensions page, every permission it asks granted, enabled and running for every user",
  async run(s) {
    const { env, log } = s;
    const host = await s.session("owner");
    let ext = await extensionOf(host);
    if (ext === undefined) {
      ext = await installBuild(s, host);
      log.log({ step: "install", action: "created", kind: "Lumiverse extension (today's pushed build)", id: ext.id, name: ext.name, detail: { identifier: ext.identifier, from: env.buildUrl, branch: env.buildBranch } });
    }

    // Lumiverse records the branch asked for at install (src/db/migrations/029_extension_branches.sql:2,
    // src/spindle/manager.service.ts:1488-1494, :2423), and none when none was asked for: then the
    // checkout says which it is on (its repo folder, :705-717).
    const branch = ext.metadata.branch ?? (await git(buildDir(env), ["rev-parse", "--abbrev-ref", "HEAD"]));
    if (branch !== env.buildBranch) throw new Error(`${IDENTIFIER} is installed from the branch ${branch}, not ${env.buildBranch}: remove it on the Extensions page, then run the set-up again`);
    // An install from the page is the operator's, which every user sees and runs (src/routes/spindle.routes.ts:197-203,
    // src/spindle/manager.service.ts:1927-1941, :2421); there is no switch per user (`enabled` is one column).
    if (ext.metadata.install_scope !== "operator") throw new Error(`${IDENTIFIER} is installed for one user (${ext.metadata.install_scope ?? "no scope"}), not for every user as the Extensions page installs it`);

    // The page's "Enable all" grants every permission not granted yet (frontend/src/components/panels/SpindlePanel.tsx:484-506,
    // :1001; frontend/src/store/slices/spindle.ts:280-287; frontend/src/api/spindle.ts:118-120;
    // src/routes/spindle.routes.ts:462-513). Install grants none (src/spindle/manager.service.ts:1488-1494),
    // and enabling grants only the unprivileged ones (:878-918).
    const granted = ext.granted_permissions;
    const ungranted = ext.permissions.filter((p) => !granted.includes(p));
    if (ungranted.length > 0) {
      const after = await host.call<{ requested: string[]; granted: string[] }>("POST", `/api/v1/spindle/${ext.id}/permissions`, { grant: ungranted });
      const still = after.requested.filter((p) => !after.granted.includes(p));
      if (still.length > 0) throw new Error(`Lumiverse didn't grant ${still.join(", ")}`);
      log.log({ step: "install", action: "changed", kind: "extension permissions (granted on the Extensions page)", id: ext.id, name: ext.name, detail: { granted: ungranted } });
    }

    // Enable starts its worker (frontend/src/api/spindle.ts:102-103; src/routes/spindle.routes.ts:349-389);
    // an enabled extension that isn't running is restarted with the page's Restart (:422-449).
    if (!ext.enabled) {
      await host.call("POST", `/api/v1/spindle/${ext.id}/enable`, {});
      log.log({ step: "install", action: "changed", kind: "extension enabled (its worker started)", id: ext.id, name: ext.name });
    } else if (ext.status !== "running") {
      await host.call("POST", `/api/v1/spindle/${ext.id}/restart`, {});
      log.log({ step: "install", action: "changed", kind: "extension restarted", id: ext.id, name: ext.name });
    }
    const began = Date.now();
    for (;;) {
      const status = (await extensionOf(host))?.status ?? "gone";
      if (status === "running") break;
      if (Date.now() - began > RUN_MS) throw new Error(`today's build is ${status} ${RUN_MS / 1000} s after it was enabled, not running`);
      await Bun.sleep(POLL_MS);
    }

    // Lumiverse keeps no record of the commit it installed (src/spindle/manager.service.ts:1488-1494;
    // its update check shows one only while an update waits), so the checkout says it.
    log.set("extension", ext.id);
    log.set("build:commit", await git(buildDir(env), ["rev-parse", "HEAD"]));
    log.set("build:branch", branch);
    log.set("lumiverse:commit", await git(env.coreDir, ["rev-parse", "HEAD"]));
  },
};
