// Spindle's manager as Lumiverse runs it (PlanAdapter-S13): an extension is installed from a named branch of a remote, stored disabled with the
// permissions its manifest asks for, enabled by an owner or an admin (which grants the permissions that need no admin and starts its worker), and
// granted the rest by an owner or an admin alone, each grant reaching the running worker on a later task and announced on the event bus. The
// routes of `routes/spindle.routes.ts` and the rigs both go through it, each as a viewer with a role, so a rig installs as an admin does.
// What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; paths are Lumiverse's `src/`. What it does not model: a
// clone (a test gives each remote's branches and the manifest of each), the extension's build, its update checks, and the Illarin sources.

import { IDENTIFIER_PATTERN, isValidPermission } from "lumiverse-spindle-types";
import type { HostClock, Installed } from "./host";

/** `PRIVILEGED_PERMISSIONS` (`spindle/manager.service.ts:878-907`): what an owner or an admin alone may grant. */
export const PRIVILEGED_PERMISSIONS: ReadonlySet<string> = new Set([
  "screen_capture",
  "screen_recording",
  "system_audio",
  "app_manipulation",
  "cors_proxy",
  "generation",
  "interceptor",
  "context_handler",
  "macro_interceptor",
  "characters",
  "chats",
  "world_books",
  "presets",
  "regex_scripts",
  "regex_scripts_unrestricted",
  "databanks",
  "personas",
  "push_notification",
  "image_gen",
  "images",
  "web_search",
  "unsafe_eval",
  "providers.embedding.register",
  "providers.tts.register",
  "providers.stt.register",
  "providers.sidecar.register",
  "mcp_servers",
  "mcp_servers.create",
]);

export type Role = "owner" | "admin" | "user";

/** Who asks (`getViewer`, `routes/spindle.routes.ts:25-32`). */
export interface Viewer {
  userId: string;
  role: Role;
}

/** The manifest an extension's repository holds (`spindle.json`), as far as the manager reads it. */
export interface Manifest {
  identifier: string;
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  github?: string;
  homepage?: string;
  permissions?: string[];
  entry_backend?: string;
  entry_frontend?: string;
  /** The extension's own limit for a prompt interceptor (`manifest.interceptorTimeoutMs`, `spindle/worker-host.ts:3159-3163`). */
  interceptorTimeoutMs?: number;
}

/** What a remote holds: each branch's manifest, `null` for a branch with no `spindle.json`. */
export interface Remote {
  branches: Record<string, Manifest | null>;
  /** The branch a clone with none named takes. */
  default?: string;
}

/** `ExtensionInfo` as `rowToExtensionInfo` makes it (`spindle/manager.service.ts:2395-2450`). */
export interface ExtensionInfo {
  id: string;
  identifier: string;
  name: string;
  version: string;
  author: string;
  description: string;
  github: string;
  homepage: string;
  permissions: string[];
  granted_permissions: string[];
  enabled: boolean;
  installed_at: number;
  updated_at: number;
  has_frontend: boolean;
  has_backend: boolean;
  status: "running" | "stopped";
  metadata: { install_scope: "user" | "operator"; installed_by_user_id: string | null; branch: string | null };
}

/** An answer the routes tell as a status and a message. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** What an extension's code is: given its worker's view of Spindle it starts, and gives what stops it. */
export type Extension = (api: Installed) => Promise<{ stop(): void } | void> | { stop(): void } | void;

interface Record_ {
  id: string;
  manifest: Manifest;
  github: string;
  branch: string | null;
  scope: "user" | "operator";
  installedBy: string | null;
  granted: Set<string>;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  worker: Installed | null;
  running: { stop(): void } | void;
}

/** What the manager needs of the host it starts workers in. */
export interface SpindleHost {
  install(granted: readonly string[], identifier?: string, options?: { id?: string; scope?: "user" | "operator"; installedBy?: string | null; interceptorTimeoutMs?: number }): Installed;
  notifyPermissionChanged(id: string, permission: string, granted: boolean, allGranted: readonly string[]): void;
  emit(event: string, payload: unknown, userId?: string): void;
  /** The clock its later tasks run on; one a test moves by hand has `advance`. */
  readonly clock: HostClock & { advance?(ms: number): Promise<void> };
}

const isOwnerOrAdmin = (viewer: Viewer): boolean => viewer.role === "owner" || viewer.role === "admin";

export class SpindleManager {
  /** The remotes a test gives, by URL. */
  readonly remotes = new Map<string, Remote>();
  /** The code of each extension by its identifier, which starts when its worker does. */
  readonly code = new Map<string, Extension>();
  private readonly records = new Map<string, Record_>();
  private ids = 0;

  constructor(
    private readonly host: SpindleHost,
    private readonly now: () => number,
  ) {}

  /** A remote at `url` with these branches' manifests. */
  remote(url: string, remote: Remote): void {
    this.remotes.set(url, remote);
  }

  /** The code an extension runs once enabled. */
  provide(identifier: string, code: Extension): void {
    this.code.set(identifier, code);
  }

  /** The worker of an extension that is running, as its code sees Spindle. */
  worker(id: string): Installed | undefined {
    return this.records.get(id)?.worker ?? undefined;
  }

  /** Lumiverse's identifier for the extension, by its id; the id itself where none is installed (the stand-in's by-hand workers). */
  identifierOf(id: string): string {
    return this.records.get(id)?.manifest.identifier ?? id;
  }

  /** `getEnabledExtensionIdentifiers` (`spindle/manager.service.ts:2027-2033`): the identifiers of every enabled extension, whoever installed it. */
  enabledIdentifiers(): string[] {
    return [...this.records.values()].filter((r) => r.enabled).map((r) => r.manifest.identifier);
  }

  /** `getExtensionForUser` then `getWorkerHost` (`ws/handler.ts:445-452`): the running worker of an extension the viewer may see, none for any other. */
  workerFor(viewer: Viewer, id: string): Installed | undefined {
    return this.visible(viewer, id)?.worker ?? undefined;
  }

  // ---------------------------------------------------------------- who sees and who manages

  private info(r: Record_): ExtensionInfo {
    const m = r.manifest;
    return {
      id: r.id,
      identifier: m.identifier,
      name: m.name ?? m.identifier,
      version: m.version ?? "0.0.0",
      author: m.author ?? "",
      description: m.description ?? "",
      github: r.github,
      homepage: m.homepage ?? "",
      permissions: [...(m.permissions ?? [])],
      granted_permissions: [...r.granted],
      enabled: r.enabled,
      installed_at: r.installedAt,
      updated_at: r.updatedAt,
      has_frontend: m.entry_frontend !== undefined,
      has_backend: m.entry_backend !== undefined,
      status: r.worker === null ? "stopped" : "running",
      metadata: { install_scope: r.scope, installed_by_user_id: r.installedBy, branch: r.branch },
    };
  }

  /** `listForUser` (`:1927-1942`): an owner and an admin see every extension, anyone else the operator's and their own. */
  list(viewer: Viewer): ExtensionInfo[] {
    const all = [...this.records.values()].sort((a, b) => b.installedAt - a.installedAt);
    return all.filter((r) => isOwnerOrAdmin(viewer) || r.scope === "operator" || r.installedBy === viewer.userId).map((r) => this.info(r));
  }

  private visible(viewer: Viewer, id: string): Record_ | null {
    const r = this.records.get(id);
    if (r === undefined) return null;
    return isOwnerOrAdmin(viewer) || r.scope === "operator" || r.installedBy === viewer.userId ? r : null;
  }

  /** `canManageExtension` (`:1970-1982`). */
  private manages(viewer: Viewer, r: Record_): boolean {
    return isOwnerOrAdmin(viewer) || (r.scope === "user" && r.installedBy === viewer.userId);
  }

  /** The extension, for a route that lets the viewer manage it: 404 where it is not visible, 403 where it is not theirs to manage. */
  private managed(viewer: Viewer, id: string): Record_ {
    const r = this.visible(viewer, id);
    if (r === null) throw new Refused(404, "Not found");
    if (!this.manages(viewer, r)) throw new Refused(403, "Forbidden");
    return r;
  }

  /** `requireOwner` (`auth/middleware.ts:92-103`): the owner and an admin. */
  private requireOwner(viewer: Viewer): void {
    if (!isOwnerOrAdmin(viewer)) throw new Refused(403, "Forbidden");
  }

  // ---------------------------------------------------------------- install

  /** `assertSafeGitUrl` (`:1337-1368`). */
  private assertSafeUrl(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim() === "") throw new Error("Repository URL is required");
    const url = raw.trim();
    if (/^[\w.+-]+@[^:]+:/.test(url) || url.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(url)) throw new Error("Repository URL must use https://");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Repository URL is not a valid URL");
    }
    if (parsed.protocol !== "https:") throw new Error(`Repository URL protocol "${parsed.protocol}" is not allowed; use https://`);
    if (!parsed.hostname) throw new Error("Repository URL must include a hostname");
    return url;
  }

  /** `POST /api/v1/spindle/branches` (`routes/spindle.routes.ts:171-184`; `listRemoteBranches`, `:2235-2249`): the remote's branches, an owner's or an admin's to ask. */
  branches(viewer: Viewer, body: { github_url?: unknown }): string[] {
    this.requireOwner(viewer);
    if (!body.github_url) throw new Refused(400, "github_url is required");
    const url = String(body.github_url);
    const remote = this.remotes.get(url);
    if (remote === undefined) throw new Refused(400, `Failed to list remote branches: fatal: repository '${url}/' not found\n`);
    return Object.keys(remote.branches);
  }

  /**
   * `POST /api/v1/spindle/install` (`routes/spindle.routes.ts:186-229`; `install`, `:1370-1394`; `installCheckout`, `:1411-1510`): from a named branch of a remote, stored
   * disabled with the manifest's permissions, none granted. An operator's install is for every user; `scope: "user"` makes it one user's, the viewer's unless `user_id` names another.
   */
  install(viewer: Viewer, body: { github_url?: unknown; branch?: unknown; scope?: unknown; user_id?: unknown }): ExtensionInfo {
    this.requireOwner(viewer);
    if (!body.github_url) throw new Refused(400, "github_url is required");
    const scope = typeof body.scope === "string" && body.scope.trim() === "user" ? "user" : "operator";
    const installedBy = scope === "user" ? (typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : viewer.userId) : null;
    const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : null;
    this.host.emit("SPINDLE_EXTENSION_STATUS", { operation: "installing", name: body.github_url });
    let url: string;
    try {
      url = this.assertSafeUrl(body.github_url);
    } catch (error) {
      throw new Refused(400, error instanceof Error ? error.message : String(error));
    }
    const remote = this.remotes.get(url);
    if (remote === undefined) throw new Refused(400, `git clone failed: Cloning into 'extensions/_temp'...\nfatal: repository '${url}/' not found\n`);
    const named = branch ?? remote.default ?? Object.keys(remote.branches)[0];
    if (named === undefined || !(named in remote.branches)) throw new Refused(400, `git clone failed: Cloning into 'extensions/_temp'...\nfatal: Remote branch ${branch ?? named} not found in upstream origin\n`);
    const manifest = remote.branches[named];
    if (manifest === null || manifest === undefined) throw new Refused(400, "No spindle.json found in repository");
    if (!manifest.identifier || !new RegExp(IDENTIFIER_PATTERN).test(manifest.identifier)) throw new Refused(400, `Invalid identifier "${manifest.identifier}". Must match /^[a-z][a-z0-9_]*$/`);
    if ([...this.records.values()].some((r) => r.manifest.identifier === manifest.identifier)) throw new Refused(400, `Extension "${manifest.identifier}" is already installed`);
    const at = Math.floor(this.now() / 1000);
    const r: Record_ = {
      id: `ext-${++this.ids}`,
      manifest: structuredClone(manifest),
      github: manifest.github ?? url,
      branch,
      scope,
      installedBy,
      granted: new Set(),
      enabled: false,
      installedAt: at,
      updatedAt: at,
      worker: null,
      running: undefined,
    };
    this.records.set(r.id, r);
    this.host.emit("SPINDLE_EXTENSION_STATUS", { extensionId: r.id, operation: "installed", name: r.manifest.name ?? r.manifest.identifier });
    return this.info(r);
  }

  // ---------------------------------------------------------------- enable, disable, restart

  private async start(r: Record_): Promise<void> {
    const worker = this.host.install([...r.granted], r.manifest.identifier, { id: r.id, scope: r.scope, installedBy: r.installedBy, interceptorTimeoutMs: r.manifest.interceptorTimeoutMs });
    r.worker = worker;
    try {
      const code = this.code.get(r.manifest.identifier);
      if (code !== undefined) r.running = await code(worker);
    } catch (error) {
      worker.stop();
      r.worker = null;
      this.host.emit("SPINDLE_EXTENSION_ERROR", { extensionId: r.id, identifier: r.manifest.identifier, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    this.host.emit("SPINDLE_EXTENSION_LOADED", { extensionId: r.id, identifier: r.manifest.identifier, name: r.manifest.name ?? r.manifest.identifier });
  }

  private stop(r: Record_): void {
    if (r.worker === null) return;
    if (r.running !== undefined) r.running.stop();
    r.running = undefined;
    r.worker.stop();
    r.worker = null;
    this.host.emit("SPINDLE_EXTENSION_UNLOADED", { extensionId: r.id, identifier: r.manifest.identifier, name: r.manifest.name ?? r.manifest.identifier });
  }

  /**
   * `POST /api/v1/spindle/:id/enable` (`routes/spindle.routes.ts:350-381`; `enable`, `:1713-1731`): an owner's or an admin's; the permissions the extension asks for that
   * need no admin are granted, as they are on every enable, and the worker starts with them. A worker already running is left as it is.
   */
  async enable(viewer: Viewer, id: string): Promise<void> {
    this.requireOwner(viewer);
    const r = this.managed(viewer, id);
    const status = (operation: string): void => this.host.emit("SPINDLE_EXTENSION_STATUS", { extensionId: r.id, operation, name: r.manifest.name ?? r.manifest.identifier });
    status("enabling");
    r.enabled = true;
    r.updatedAt = Math.floor(this.now() / 1000);
    for (const permission of r.manifest.permissions ?? []) if (!PRIVILEGED_PERMISSIONS.has(permission) && isValidPermission(permission)) r.granted.add(permission);
    if (r.worker === null) await this.start(r);
    status("enabled");
  }

  /** `POST /api/v1/spindle/:id/disable` (`:383-409`): the worker stopped, the extension left disabled with its grants. */
  async disable(viewer: Viewer, id: string): Promise<void> {
    const r = this.managed(viewer, id);
    const status = (operation: string): void => this.host.emit("SPINDLE_EXTENSION_STATUS", { extensionId: r.id, operation, name: r.manifest.name ?? r.manifest.identifier });
    status("disabling");
    this.stop(r);
    r.enabled = false;
    r.updatedAt = Math.floor(this.now() / 1000);
    status("disabled");
  }

  /** `POST /api/v1/spindle/:id/restart` (`:412-437`): stopped and started again, which is where a registration refused before its grant is made anew. */
  async restart(viewer: Viewer, id: string): Promise<void> {
    const r = this.managed(viewer, id);
    if (!r.enabled) throw new Refused(400, "Extension is not enabled");
    const status = (operation: string): void => this.host.emit("SPINDLE_EXTENSION_STATUS", { extensionId: r.id, operation, name: r.manifest.name ?? r.manifest.identifier });
    status("restarting");
    this.stop(r);
    await this.start(r);
    status("restarted");
  }

  // ---------------------------------------------------------------- permissions

  /** `GET /api/v1/spindle/:id/permissions` (`:451-461`): what is requested and what is granted. */
  permissions(viewer: Viewer, id: string): { requested: string[]; granted: string[] } {
    const r = this.visible(viewer, id);
    if (r === null) throw new Refused(404, "Not found");
    return { requested: [...(r.manifest.permissions ?? [])], granted: [...r.granted] };
  }

  /**
   * `POST /api/v1/spindle/:id/permissions` (`:463-514`): the extension's manager grants and revokes what the body names; a privileged permission needs an owner or an admin (403
   * naming them); one that is no permission is refused with what was granted before it left granted. A running worker is told each change, on a later task, and the bus announces it.
   */
  setPermissions(viewer: Viewer, id: string, body: { grant?: unknown; revoke?: unknown }): { requested: string[]; granted: string[] } {
    const r = this.managed(viewer, id);
    const grant = body.grant as string[] | undefined;
    const revoke = body.revoke as string[] | undefined;
    if (grant) {
      const privileged = grant.filter((p) => PRIVILEGED_PERMISSIONS.has(p));
      if (privileged.length > 0 && !isOwnerOrAdmin(viewer)) throw new Refused(403, `These permissions require admin approval: ${privileged.join(", ")}`);
      for (const permission of grant) {
        if (!isValidPermission(permission) && permission !== "mcp_servers" && permission !== "mcp_servers.create" && permission !== "screen_capture" && permission !== "screen_recording") throw new Refused(400, `Invalid permission: ${permission}`);
        r.granted.add(permission);
      }
    }
    if (revoke) for (const permission of revoke) r.granted.delete(permission);
    const all = [...r.granted];
    if (r.worker !== null) {
      for (const [list, granted] of [[grant, true], [revoke, false]] as const) {
        for (const permission of list ?? []) {
          this.host.notifyPermissionChanged(r.id, permission, granted, all);
          this.host.emit("SPINDLE_PERMISSION_CHANGED", { extensionId: r.id, permission, granted, allGranted: all });
        }
      }
    }
    return { requested: [...(r.manifest.permissions ?? [])], granted: all };
  }

  /**
   * An extension set up as an admin sets one up on Lumiverse's Extensions page, for a rig that wants one running: installed from `url`'s branch, the permissions of `granted` that need an admin granted, then
   * enabled (which grants the permissions the manifest asks for that need none, and starts its worker), and any of those that `granted` leaves out revoked, as an admin revokes one. The worker's later tasks
   * are run before it gives the extension's record (the test's clock moved by nothing, or the process's given a turn).
   */
  async setUp(viewer: Viewer, setup: { url: string; manifest: Manifest; code?: Extension; granted: readonly string[]; scope?: "user"; userId?: string }): Promise<ExtensionInfo> {
    this.remote(setup.url, { branches: { main: setup.manifest } });
    if (setup.code !== undefined) this.provide(setup.manifest.identifier, setup.code);
    const info = this.install(viewer, { github_url: setup.url, branch: "main", ...(setup.scope === undefined ? {} : { scope: setup.scope, user_id: setup.userId }) });
    const privileged = setup.granted.filter((permission) => PRIVILEGED_PERMISSIONS.has(permission));
    if (privileged.length > 0) this.setPermissions(viewer, info.id, { grant: privileged });
    await this.enable(viewer, info.id);
    const withheld = (setup.manifest.permissions ?? []).filter((permission) => !PRIVILEGED_PERMISSIONS.has(permission) && !setup.granted.includes(permission));
    if (withheld.length > 0) this.setPermissions(viewer, info.id, { revoke: withheld });
    const clock = this.host.clock;
    if (clock.advance !== undefined) await clock.advance(0);
    else await Bun.sleep(2);
    return this.list(viewer).find((extension) => extension.id === info.id)!;
  }
}
