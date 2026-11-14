// The web app is served at `/ui/` from the folder the build made, with each file's own type, to
// anyone, and nothing outside that folder is: not by a step up, an encoded slash, a link, or dot
// segments sent as they are, past any client's tidying. Run from source, where nothing is built,
// `/ui/` says so.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunningServer } from "../../src/app";
import { RPE_UI } from "../../src/app/ui";
import { type Bed, makeBed } from "./helpers";

describe("the web app at /ui/", () => {
  let bed: Bed;
  let built: string;

  beforeEach(async () => {
    bed = await makeBed();
    built = join(bed.root, "ui");
    await mkdir(join(built, "assets"), { recursive: true });
    await writeFile(join(built, "index.html"), "<!doctype html><title>RPE</title>");
    await writeFile(join(built, "assets", "app.js"), "console.log(1);");
    await writeFile(join(built, "assets", "app.css"), "body{}");
    await writeFile(join(bed.root, "secret.txt"), "not for pages");
    await symlink(join(bed.root, "secret.txt"), join(built, "assets", "link.txt"));
  });

  afterEach(async () => {
    await bed.remove();
  });

  async function serve(ui: string | null): Promise<RunningServer> {
    return await (await bed.open({ ui })).start();
  }

  test("serves the built files with their types, index.html for /ui/, without a credential", async () => {
    const server = await serve(built);
    const index = await fetch(`${server.url}/ui/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toStartWith("text/html");
    expect(await index.text()).toBe("<!doctype html><title>RPE</title>");
    const script = await fetch(`${server.url}/ui/assets/app.js`);
    expect(script.headers.get("content-type")).toStartWith("text/javascript");
    expect(await script.text()).toBe("console.log(1);");
    expect((await fetch(`${server.url}/ui/assets/app.css`)).headers.get("content-type")).toStartWith("text/css");
    const bare = await fetch(`${server.url}/ui`, { redirect: "manual" });
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe(`${server.url}/ui/`);
  });

  test("serves nothing outside its folder, and nothing it does not have", async () => {
    const server = await serve(built);
    for (const path of ["/ui/..%2Fsecret.txt", "/ui/assets/..%2F..%2Fsecret.txt", "/ui/assets/link.txt", "/ui/assets", "/ui/assets/", "/ui/missing.js", "/ui/%E0%A4%A"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("not for pages");
    }
  });

  test("dot segments sent as they are reach the web app's route, and it serves nothing for a path they take out of /ui/", async () => {
    const server = await serve(built);
    // `fetch` tidies dot segments away before it sends; a raw request line keeps them, and Bun routes it by them.
    const raw = async (path: string): Promise<string> => {
      const { promise, resolve } = Promise.withResolvers<string>();
      let got = "";
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open: (socket) => void socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`),
          data: (_socket, bytes) => void (got += new TextDecoder().decode(bytes)),
          close: () => resolve(got),
          error: () => resolve(got),
        },
      });
      return await promise;
    };
    for (const path of ["/ui/%2e%2e/secret.txt", "/ui/../secret.txt", "/ui/assets/%2e%2e/%2e%2e/secret.txt", "/ui/..", "/ui/%2e%2e/"]) {
      const answer = await raw(path);
      expect(answer.split("\r\n")[0], path).toBe("HTTP/1.1 404 Not Found");
      expect(answer, path).not.toContain("not for pages");
      expect(answer, path).not.toContain("<title>RPE</title>");
    }
    expect((await raw("/ui/assets/../index.html")).split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
  });

  test("run from source, with no built folder, /ui/ answers 404 in one plain sentence", async () => {
    expect(RPE_UI).toBeNull();
    const server = await serve(RPE_UI);
    const res = await fetch(`${server.url}/ui/`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    const words = await res.text();
    expect(words).toMatch(/^[A-Z][^.\n]*\.$/);
    expect(words).toContain("web app");
  });
});
