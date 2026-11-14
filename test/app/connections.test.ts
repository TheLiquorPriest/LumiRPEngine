// Connections: the model layer's two documents kept exactly as it gives them, where the plan puts
// them (the connections, with their headers' names, in the global config; every key, sign-in and
// header value in the secrets file and nowhere else); a file written the earlier way, with the
// headers' values kept apart, read in the form the layer moves at its next save; the user's own lines
// in the global config kept as they wrote them; and routes that add, change, list and remove a
// connection without ever giving a key back. The route tests start the server in-process on a free
// loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { YAML } from "bun";
import type { ConnectionsDoc, SecretsDoc } from "rp-harness/contract";
import type { App, RunningServer } from "../../src/app";
import { connectionRoutes } from "../../src/app";
import { walk } from "../../src/app/archive";
import { bearer, type Bed, makeBed, makeKey, testModelLayer } from "./helpers";

const KEY = "sk-invented-key-0123456789abcdef";
const HEADER_VALUE = "proxy-secret-value-fedcba9876543210";

const FLOOR = { id: "floor", name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", limits: { "deepseek-v4-flash": { contextWindow: 128_000 } } };
const LOCAL = { id: "local", name: "Local server", provider: "openai-compatible", auth: "none", baseUrl: "http://127.0.0.1:1234/v1", reported: { "local-model": { maxTokens: 4096 } } };
const SIGNINS = { anthropic: { type: "oauth", access: "invented-access", refresh: "invented-refresh", expires: 1 } };
// As the layer gives them (RPH `src/model/book.ts`): a connection's headers by name alone, their values with the secrets by the connection's id. The contract's document types do not say so yet.
const DOC = { v: 1, default: "floor", connections: [{ ...FLOOR, headers: ["X-Proxy-Token", "X-Dropped"] }, LOCAL] } as unknown as ConnectionsDoc;
const SECRETS = { v: 1, keys: { floor: KEY }, headers: { floor: { "X-Proxy-Token": HEADER_VALUE } }, signins: SIGNINS } as unknown as SecretsDoc;

/** Every file of the tree agents see, as text. */
async function treeText(app: App): Promise<string> {
  const files = await walk(app.paths.files);
  return (await Promise.all(files.map((f) => readFile(join(app.paths.files, f.path), "utf8")))).join("\n");
}

describe("connections", () => {
  let bed: Bed;
  let app: App;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({ areas: [{ name: "connections", mount: (a) => a.routes.add("connections", connectionRoutes(testModelLayer(a.models))) }] });
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("each document is given back exactly as the layer gave it: the connections, with their headers' names, in the global config; keys, sign-ins and header values in the secrets file alone", async () => {
    await app.models.saveSecrets(SECRETS);
    await app.models.saveConnections(DOC);
    expect(await app.models.loadConnections()).toEqual(DOC);
    expect(await app.models.loadSecrets()).toEqual(SECRETS);
    const global = await readFile(app.paths.globalConfig, "utf8");
    for (const kept of ["Floor model", "deepseek-v4-flash", "X-Proxy-Token"]) expect(global).toContain(kept);
    const tree = await treeText(app);
    for (const secret of [KEY, HEADER_VALUE, "invented-refresh"]) expect(tree).not.toContain(secret);
    const secrets = await readFile(app.paths.secrets, "utf8");
    for (const secret of [KEY, HEADER_VALUE, "invented-refresh"]) expect(secrets).toContain(secret);
    expect(statSync(app.paths.secrets).mode & 0o777).toBe(0o600);
    expect(statSync(app.paths.root).mode & 0o777).toBe(0o700);
  });

  test("a file written the earlier way gives the headers' values back in the connections, and once the layer has saved, none are left in the old place", async () => {
    // The earlier way: the connections without their headers, and the values apart, by connection id.
    await writeFile(app.paths.globalConfig, YAML.stringify({ models: { v: 1, default: "floor", connections: [FLOOR, LOCAL] } }, null, 2));
    await writeFile(app.paths.secrets, JSON.stringify({ v: 1, parts: { models: { v: 1, keys: { floor: KEY }, signins: SIGNINS }, headers: { floor: { "X-Proxy-Token": HEADER_VALUE, "X-Dropped": null } } } }));
    expect(await app.models.loadConnections()).toEqual({ v: 1, default: "floor", connections: [{ ...FLOOR, headers: { "X-Proxy-Token": HEADER_VALUE, "X-Dropped": null } }, LOCAL] });
    // The layer's next save moves them: its secrets first, the values with them, then the connections with the names alone.
    await app.models.saveSecrets(SECRETS);
    await app.models.saveConnections(DOC);
    expect(await app.models.loadConnections()).toEqual(DOC);
    expect(await app.models.loadSecrets()).toEqual(SECRETS);
    expect(Object.keys(JSON.parse(await readFile(app.paths.secrets, "utf8")).parts)).toEqual(["models"]);
    expect(await treeText(app)).not.toContain(HEADER_VALUE);
  });

  test("the user's own lines in the global config are kept as they wrote them", async () => {
    const mine = ["# My global settings.", "off:", "  - WORLD.md", "", "# The connections, kept by RPE:", "models:", "  # an old note under the block", "  v: 1", "  connections: []", "", "# How much history the prompt keeps.", "history:", "  keep: 40", ""].join("\n");
    await Bun.write(app.paths.globalConfig, mine);
    await app.models.saveConnections(DOC);
    await app.models.saveConnections({ ...DOC, default: "local" });
    const lines = (await readFile(app.paths.globalConfig, "utf8")).split("\n");
    expect(lines.slice(0, 5)).toEqual(["# My global settings.", "off:", "  - WORLD.md", "", "# The connections, kept by RPE:"]);
    expect(lines.slice(-5)).toEqual(["", "# How much history the prompt keeps.", "history:", "  keep: 40", ""]);
    const read = YAML.parse(lines.join("\n")) as Record<string, unknown>;
    expect(read.off).toEqual(["WORLD.md"]);
    expect(read.history).toEqual({ keep: 40 });
    expect(await app.models.loadConnections()).toEqual({ ...DOC, default: "local" });
  });

  describe("the routes", () => {
    let server: RunningServer;
    let page: Record<string, string>;

    beforeEach(async () => {
      server = await app.start();
      page = { ...bearer(await makeKey(app, "web")), "content-type": "application/json" };
    });

    test("add, change, list and remove a connection, and never give a key back", async () => {
      const added = await fetch(`${server.url}/api/v1/connections`, { method: "POST", headers: page, body: JSON.stringify({ connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash" }, key: KEY }) });
      expect(added.status).toBe(200);
      const addedText = await added.text();
      expect(addedText).not.toContain(KEY);
      const view = JSON.parse(addedText) as { id: string; key: { set: boolean; last4: string } };
      expect(view.key).toEqual({ set: true, last4: KEY.slice(-4) });
      const changed = await fetch(`${server.url}/api/v1/connections/${view.id}`, { method: "PUT", headers: page, body: JSON.stringify({ connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-pro" } }) });
      expect(await changed.json()).toMatchObject({ model: "deepseek-v4-pro", key: { set: true } });
      expect((await fetch(`${server.url}/api/v1/connections/${view.id}/default`, { method: "PUT", headers: page })).status).toBe(204);
      const listed = await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).text();
      expect(listed).not.toContain(KEY);
      expect(JSON.parse(listed)).toMatchObject({ default: view.id, connections: [{ id: view.id, model: "deepseek-v4-pro", default: true }] });
      expect(await treeText(app)).not.toContain(KEY);
      expect(await readFile(app.paths.secrets, "utf8")).toContain(KEY);
      expect((await fetch(`${server.url}/api/v1/connections/${view.id}`, { method: "DELETE", headers: page })).status).toBe(204);
      expect(await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).json()).toMatchObject({ connections: [] });
      expect(await readFile(app.paths.secrets, "utf8")).not.toContain(KEY);
    });

    test("refuse what is not a connection, a new one with an id, and a caller without a page's token", async () => {
      const post = (body: unknown, headers = page) => fetch(`${server.url}/api/v1/connections`, { method: "POST", headers, body: JSON.stringify(body) });
      expect((await post({ connection: { provider: "deepseek", auth: "key" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "password" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "key" }, key: "" })).status).toBe(400);
      expect((await post({ connection: { id: "chosen", name: "x", provider: "deepseek", auth: "none" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "none" } }, { "content-type": "application/json" })).status).toBe(401);
      expect((await fetch(`${server.url}/api/v1/connections/nowhere`, { method: "PUT", headers: page, body: JSON.stringify({ connection: { name: "x", provider: "deepseek", auth: "none" } }) })).status).toBe(400);
    });
  });
});
