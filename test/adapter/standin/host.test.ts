// Spindle's manager as the stand-in Lumiverse's routes answer it (`routes/spindle.routes.ts:171-229`, `:350-514`; `spindle/manager.service.ts:878-918`, `:1370-1510`, `:1713-1731`;
// `spindle/worker-host.ts:1648-1656`; `spindle/worker-runtime.ts:5065-5090`; `spindle/lifecycle.ts:144-163`): an install from a named branch, the grants a fresh install starts with,
// a grant that reaches the worker on a later task and is announced, and both storage layouts. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionChange } from "../../../src/ext/spindle";
import { json, OTHER, PASSWORD, USER, weir as weirOf, type Weir } from "./weir";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const ADMIN = "user-ada";
const URL_ = "https://example.invalid/lumi/reedwarden";
const MANIFEST = { identifier: "reedwarden", name: "Reed warden", version: "1.0.0", github: URL_, permissions: ["interceptor", "generation_parameters", "generation", "cors_proxy", "ui_panels"], entry_backend: "dist/backend.js" };
const accounts = [
  { id: USER, username: "mara", password: PASSWORD },
  { id: OTHER, username: "pell", password: PASSWORD },
  { id: ADMIN, username: "ada", password: PASSWORD, role: "admin" as const },
];

async function bed(): Promise<Weir & { admin: Weir["as"] extends (u: string) => infer A ? A : never }> {
  const w = await weirOf(closing, {}, { accounts });
  // The weir signs in two users; the admin signs in as a person does.
  const signed = await w.server.fetch(`${w.server.base}/api/auth/sign-in/username`, { method: "POST", headers: { "content-type": "application/json" }, body: json({ username: "ada", password: PASSWORD }) });
  const token = ((await signed.json()) as { token: string }).token;
  const send = (method: string, path: string, body?: unknown): Promise<Response> => w.server.fetch(`${w.server.base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const admin = { get: (p: string) => send("GET", p), post: (p: string, b?: unknown) => send("POST", p, b ?? {}), put: (p: string, b: unknown) => send("PUT", p, b), patch: (p: string, b: unknown) => send("PATCH", p, b), delete: (p: string) => send("DELETE", p) };
  w.host.spindle.remote(URL_, { branches: { main: MANIFEST, dev: { ...MANIFEST, version: "1.1.0-dev" }, bare: null } });
  return { ...w, admin: admin as never };
}

describe("an install from a named branch", () => {
  test("an owner or an admin lists a remote's branches and installs one, stored disabled with the permissions it asks for and none granted; a user is refused", async () => {
    const w = await bed();
    const denied = await w.as(USER).post("/api/v1/spindle/install", { github_url: URL_ });
    expect([denied.status, await denied.json()]).toEqual([403, { error: "Forbidden" }]);
    const listed = await w.admin.post("/api/v1/spindle/branches", { github_url: URL_ });
    expect(await listed.json()).toEqual({ branches: ["main", "dev", "bare"] });
    expect((await w.admin.post("/api/v1/spindle/branches", { github_url: "https://example.invalid/none" })).status).toBe(400);
    const made = await w.admin.post("/api/v1/spindle/install", { github_url: URL_, branch: "dev" });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ identifier: "reedwarden", version: "1.1.0-dev", enabled: false, granted_permissions: [], permissions: MANIFEST.permissions, status: "stopped", metadata: { install_scope: "operator", installed_by_user_id: null, branch: "dev" } });
    for (const [body, error] of [
      [{ github_url: URL_ }, 'Extension "reedwarden" is already installed'],
      [{ github_url: URL_, branch: "bare" }, "No spindle.json found in repository"],
      [{ github_url: "git@example.invalid:lumi/x.git" }, "Repository URL must use https://"],
      [{}, "github_url is required"],
    ] as const) {
      const refused = await w.admin.post("/api/v1/spindle/install", body);
      expect([refused.status, await refused.json()]).toEqual([400, { error }]);
    }
  });
});

describe("grants as Lumiverse gives them", () => {
  const started = async (): Promise<Awaited<ReturnType<typeof bed>> & { id: string; worker: NonNullable<ReturnType<Weir["host"]["spindle"]["worker"]>> }> => {
    const w = await bed();
    const id = ((await (await w.admin.post("/api/v1/spindle/install", { github_url: URL_ })).json()) as { id: string }).id;
    expect((await w.admin.post(`/api/v1/spindle/${id}/enable`)).status).toBe(200);
    return { ...w, id, worker: w.host.spindle.worker(id)! };
  };

  test("a fresh install starts with the two grants that need no admin; the rest wait for one, whom a user's request does not stand in for", async () => {
    const w = await started();
    expect(w.worker.permissions.has("generation_parameters")).toBe(true);
    expect(w.worker.permissions.has("ui_panels")).toBe(true);
    for (const waiting of ["interceptor", "generation", "cors_proxy"]) expect(w.worker.permissions.has(waiting)).toBe(false);
    expect(await (await w.admin.get(`/api/v1/spindle/${w.id}/permissions`)).json()).toEqual({ requested: MANIFEST.permissions, granted: ["generation_parameters", "ui_panels"] });
    const asUser = await w.as(USER).post(`/api/v1/spindle/${w.id}/permissions`, { grant: ["interceptor"] });
    expect(asUser.status).toBe(403);
    const invalid = await w.admin.post(`/api/v1/spindle/${w.id}/permissions`, { grant: ["no_such_permission"] });
    expect([invalid.status, await invalid.json()]).toEqual([400, { error: "Invalid permission: no_such_permission" }]);
  });

  test("a grant lands on a later task, its detail names the extension, and the bus announces it; a registration refused before it is not kept", async () => {
    const w = await started();
    const seen: (PermissionChange & { extensionId?: string })[] = [];
    w.worker.permissions.onChanged((change) => seen.push(change));
    w.worker.registerInterceptor(async (messages) => messages, { priority: 1 });
    expect(w.worker.logs).toContain("permission_denied: interceptor (registerInterceptor)");
    const granted = await w.admin.post(`/api/v1/spindle/${w.id}/permissions`, { grant: ["interceptor"] });
    expect((await granted.json()) as { granted: string[] }).toMatchObject({ granted: ["generation_parameters", "ui_panels", "interceptor"] });
    // The route answered, and the worker has not yet heard.
    expect(w.worker.permissions.has("interceptor")).toBe(false);
    expect(seen).toEqual([]);
    await w.clock.advance(0);
    expect(w.worker.permissions.has("interceptor")).toBe(true);
    expect(seen).toEqual([{ extensionId: "reedwarden", permission: "interceptor", granted: true, allGranted: ["generation_parameters", "ui_panels", "interceptor"] }]);
    expect(w.host.events.filter((e) => e.event === "SPINDLE_PERMISSION_CHANGED").map((e) => e.payload)).toEqual([{ extensionId: w.id, permission: "interceptor", granted: true, allGranted: ["generation_parameters", "ui_panels", "interceptor"] }]);
    // The registration it made before was dropped: the grant alone does not make it, and a restart, which starts the worker anew, is where it can.
    const asked = [] as string[];
    w.host.spindle.provide("reedwarden", (api) => void api.registerInterceptor(async (m) => (asked.push("ran"), m), { priority: 1 }));
    expect((await w.admin.post(`/api/v1/spindle/${w.id}/restart`)).status).toBe(200);
    expect(w.host.spindle.worker(w.id)!.permissions.has("interceptor")).toBe(true);
    expect(w.host.spindle.worker(w.id)!.logs).toEqual([]);
  });
});

describe("both storage layouts", () => {
  test("an operator's extension keeps its own files under extensions/<identifier>/storage and each user's under users/<user>/extensions/<identifier>, and its userStorage needs the user; a user's extension writes to its installer's folder", async () => {
    const w = await bed();
    w.host.spindle.remote("https://example.invalid/lumi/otter", { branches: { main: { identifier: "otter", permissions: [] } } });
    const operator = ((await (await w.admin.post("/api/v1/spindle/install", { github_url: URL_ })).json()) as { id: string }).id;
    await w.admin.post(`/api/v1/spindle/${operator}/enable`);
    const worker = w.host.spindle.worker(operator)!;
    await worker.storage.write("notes/a.txt", "own");
    expect(w.host.disk.get("extensions/reedwarden/storage/notes/a.txt")).toBe("own");
    await worker.userStorage.setJson("state.json", { n: 1 }, { userId: USER });
    expect(w.host.disk.get(`users/${USER}/extensions/reedwarden/state.json`)).toBe(JSON.stringify({ n: 1 }, null, 2));
    expect(await worker.userStorage.getJson<Record<string, number>>("state.json", { fallback: {}, userId: USER })).toEqual({ n: 1 });
    await expect(worker.userStorage.setJson("state.json", {})).rejects.toThrow("userId is required for operator-scoped extensions");
    expect(await worker.userStorage.getJson("state.json", { fallback: "none" })).toBe("none");
    await expect(worker.storage.read("../../escape")).rejects.toThrow("Path traversal detected");
    await expect(worker.storage.read("missing.txt")).rejects.toThrow("File not found");

    const mine = ((await (await w.admin.post("/api/v1/spindle/install", { github_url: "https://example.invalid/lumi/otter", scope: "user", user_id: OTHER })).json()) as { id: string }).id;
    await w.admin.post(`/api/v1/spindle/${mine}/enable`);
    const theirs = w.host.spindle.worker(mine)!;
    await theirs.userStorage.setJson("state.json", { n: 2 }, { userId: USER });
    expect(w.host.disk.get(`users/${OTHER}/extensions/otter/state.json`)).toBeDefined();
    expect(w.host.disk.has(`users/${USER}/extensions/otter/state.json`)).toBe(false);
    await theirs.storage.write("x.txt", "theirs");
    expect(w.host.disk.get(`users/${OTHER}/extensions/otter/x.txt`)).toBe("theirs");
    // A user's extension is seen by its installer and the operator's by everyone, and not by a user it is not theirs.
    const listFor = async (user: string): Promise<string[]> => ((await (await w.as(user).get("/api/v1/spindle")).json()) as { extensions: { identifier: string }[] }).extensions.map((e) => e.identifier).filter((i) => i === "otter" || i === "reedwarden").sort();
    expect(await listFor(OTHER)).toEqual(["otter", "reedwarden"]);
    expect(await listFor(USER)).toEqual(["reedwarden"]);
  });
});

describe("what an interceptor marks for the breakdown (`spindle/worker-host.ts:1932-1936`, `:3245-3270`; `services/generate.service.ts:565-583`)", () => {
  test("each entry it names is taken by the index of a message of its own result, with that message's role and text, the extension's name where it gives none, in the order of the messages; an index that is none is dropped", async () => {
    const { StandIn } = await import("../../standin/lumiverse");
    const lv = new StandIn();
    const ext = lv.install(["interceptor"], "reedwarden");
    ext.registerInterceptor(
      async (messages) => ({ messages: [...messages, { role: "system", content: "SECOND added" }, { role: "user", content: "FIRST added" }], breakdown: [{ messageIndex: 2, name: "Second" }, { messageIndex: 1 }, { messageIndex: 9, name: "Nowhere" }, { messageIndex: -1 }] } as never),
      { priority: 1 },
    );
    const run = (lv as unknown as { interceptorPipeline(m: unknown[], c: Record<string, unknown>, u: string | null): Promise<{ breakdown: unknown[] }> }).interceptorPipeline.bind(lv);
    const out = await run([{ role: "system", content: "MAIN" }], { chatId: "c" }, "user-mara");
    expect(out.breakdown).toEqual([
      { type: "extension", name: "reedwarden", role: "system", content: "SECOND added", extensionId: "reedwarden", extensionName: "reedwarden" },
      { type: "extension", name: "Second", role: "user", content: "FIRST added", extensionId: "reedwarden", extensionName: "reedwarden" },
    ]);
  });
});
