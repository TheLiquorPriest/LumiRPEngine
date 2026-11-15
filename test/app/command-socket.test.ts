// The command line's own road to the running server (plan §16, §4.4): routes of `command` access answer
// on a Unix socket in the data folder that only the owner's account may open, and nowhere else: not on
// the TCP listener, so not through Lumiverse's relay, which reaches RPE there. On that socket a page's
// route answers as the owner, with no token.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstatSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { App, Area, RunningServer } from "../../src/app";
import { route, RouteTable, shape } from "../../src/app";
import { pageRoad } from "../../src/ext/page";
import { REAL_CLOCK } from "../ext/rig";
import { openDoor, USER } from "../adapter/door";
import { type Bed, makeBed, OWNER } from "./helpers";

const whose = shape.object({ user: shape.nullable(shape.text()) });

/** A command route and a page route, each saying whom it answers for. */
const probe: Area = {
  name: "probe",
  mount(app) {
    app.routes.add("probe", [
      route({ method: "GET", path: "/api/v1/command/probe", access: "command", group: "service", does: "Says whom the command line's call is for.", reply: whose, handle: ({ user }) => ({ user }) }),
      route({ method: "GET", path: "/api/v1/probe/me", access: "page", group: "service", does: "Says whose the caller is.", reply: whose, handle: ({ user }) => ({ user }) }),
    ]);
  },
};

/** A request on the command socket. */
function onSocket(running: RunningServer, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, { ...init, unix: running.commandSocket ?? "" });
}

describe("the command socket", () => {
  let bed: Bed;
  let app: App;
  let running: RunningServer;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({ areas: [probe] });
    running = await app.start();
  });
  afterEach(async () => {
    await bed.remove();
  });

  test("a command route answers on the owner's socket and is not found on the TCP listener or through the relay", async () => {
    const answered = await onSocket(running, "/api/v1/command/probe");
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ user: OWNER });
    // A page's own route answers there too, as the owner's call, with no token: the socket is the credential.
    expect(await (await onSocket(running, "/api/v1/probe/me")).json()).toEqual({ user: OWNER });
    // No Host, Origin or key is asked of a call there, and none it sends changes whom it is for.
    const claimed = await onSocket(running, "/api/v1/command/probe", { headers: { host: "elsewhere.invalid", origin: "https://elsewhere.invalid", authorization: "Bearer rpp_not-a-token" } });
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("access-control-allow-origin")).toBeNull();
    expect(await claimed.json()).toEqual({ user: OWNER });

    for (const base of [running.url, running.loopback]) {
      const refused = await fetch(`${base}/api/v1/command/probe`);
      expect(refused.status).toBe(404);
      expect(await refused.json()).toEqual({ error: "RPE has no GET /api/v1/command/probe." });
    }
    await app.close();

    // Through Lumiverse: a page asks the extension, which asks RPE on loopback, where no command route is.
    const door = await openDoor({ clock: REAL_CLOCK, areas: [probe] });
    const page = door.server.page(USER, "aaaaaaaabbbbbbbbccccccccdddddddd", door.extension);
    const road = pageRoad(page.channel, { timers: REAL_CLOCK });
    try {
      const started = await road.start();
      const token = started.facts?.token ?? "";
      const headers = { authorization: `Bearer ${token}` };
      expect((await road.request({ method: "GET", path: "/api/v1/probe/me", headers })).status).toBe(200);
      const relayed = await road.request({ method: "GET", path: "/api/v1/command/probe", headers });
      expect(relayed.status).toBe(404);
      expect(JSON.parse(relayed.body)).toEqual({ error: "RPE has no GET /api/v1/command/probe." });
      // The door's own server answers it on its socket all the same.
      expect((await onSocket(door.listening, "/api/v1/command/probe")).status).toBe(200);
    } finally {
      road.stop();
      await door.close();
    }
  });

  test("the socket is the owner's alone", async () => {
    const socket = running.commandSocket ?? "";
    expect(dirname(socket)).toBe(bed.paths.root);
    expect(lstatSync(socket).isSocket()).toBe(true);
    expect(statSync(socket).mode & 0o777).toBe(0o600);
    expect(statSync(bed.paths.root).mode & 0o777).toBe(0o700);
    // Stopped, it is gone; one left by a server that ended without stopping is taken over at the next start.
    await app.close();
    expect(lstatSync(socket, { throwIfNoEntry: false })).toBeUndefined();
    const left = Bun.serve({ unix: socket, fetch: () => new Response("left behind") });
    left.stop(true);
    const again = await (await bed.open({ areas: [probe] })).start();
    expect(again.commandSocket).toBe(socket);
    expect((await onSocket(again, "/api/v1/command/probe")).status).toBe(200);
    expect(statSync(socket).mode & 0o777).toBe(0o600);
  });

  test("a command route cannot be added at another path or with another access", () => {
    const table = new RouteTable();
    const at = (path: string, access: "command" | "page" | "provider" | "extension") => () =>
      table.add("probe", [route({ method: "GET", path, access, group: path.startsWith("/v1/") ? "provider" : "service", does: "A test's route.", reply: whose, handle: () => ({ user: null }) })]);
    expect(at("/api/v1/probe/command", "command")).toThrow("probe: GET /api/v1/probe/command: a route there is for page or public, not command.");
    expect(at("/api/v1/ext/command", "command")).toThrow("a route there is for extension, not command.");
    expect(at("/v1/command", "command")).toThrow("a route there is for provider, not command.");
    for (const access of ["page", "provider", "extension"] as const) expect(at("/api/v1/command/probe", access)).toThrow(`a route there is for command, not ${access}.`);
    table.add("probe", [route({ method: "GET", path: "/api/v1/command/probe", access: "command", group: "service", does: "A test's route.", reply: whose, handle: () => ({ user: null }) })]);
    expect(table.list().map((r) => `${r.access} ${r.path}`)).toEqual(["command /api/v1/command/probe"]);
  });
});
