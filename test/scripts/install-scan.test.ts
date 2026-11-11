// The build's own reading of Lumiverse's install scan (`scripts/install-scan.ts`): each thing the
// host refuses in a backend bundle is found where it is code, and nowhere it is only words; and the
// built backend, where there is one, holds none of them. The backend carries LumiAH's, so the scan
// is the last thing between a bundled dependency and an extension Lumiverse won't load.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installScan } from "../../scripts/install-scan";

const BACKEND = join(resolve(import.meta.dir, "../.."), "dist/backend.js");

const found = (js: string): string[] => installScan(js).map((hit) => hit.what);

describe("the install scan", () => {
  test("finds each thing the host refuses, as code", () => {
    const refused: [js: string, what: string][] = [
      ["const sum = eval(text);", "dynamic code execution"],
      ["const make = new Function('return 1');", "dynamic code execution"],
      ["const key = process.env.KEY;", "dangerous process API usage"],
      ["const p = process;\np.exit(1);", "dangerous process API usage"],
      ["const { env } = process;", "dangerous process API usage"],
      ['import { join } from "node:path";', "a node: module"],
      ["const crypto = require('node:crypto');", "a node: module"],
      ["import fs from 'fs';", "filesystem module access"],
      ['const run = await import("child" + "_process");', "subprocess module access"],
      ["const mod = await import(name);", "dynamic module access"],
      ['const bytes = Buffer.from(text, "base64");', "base64 decoding"],
      ["const page = await fetch(url);", "a network call (fetch)"],
      ["const page = await globalThis.fetch(url);", "a network call (fetch)"],
      ["Bun.serve({ port: 0 });", "dangerous Bun system API usage"],
      ["Bun['ser' + 've']({ port: 0 });", "dangerous Bun system API usage"],
    ];
    for (const [js, what] of refused) expect({ js, found: found(js) }).toEqual({ js, found: [what] });
  });

  test("finds none of them in a comment, a string, a template's text or a regex, nor in a method of the same name", () => {
    const allowed = [
      "// process.env, fetch(url) and eval(text)\nconst a = 1;",
      "/* Bun.serve({}) */ const b = 2;",
      'const words = "process.env and fetch(url) and eval(text)";',
      "const told = `eval(${count}) of process.env`;",
      "const probe = /\\bFunction\\s*\\(/.test(source);",
      "const page = await host.fetch(url); const fetched = fetcher(url);",
      "api.require(name); class Loader { require(name) { return name; } }",
      'try { new Function(""); } catch {}',
      'const bytes = Buffer.from(text, "utf8");',
    ];
    for (const js of allowed) expect({ js, found: found(js) }).toEqual({ js, found: [] });
  });

  test("says where it found each, on one line", () => {
    const [hit] = installScan("const settings = {};\nconst key = process.env.KEY;\n");
    expect(hit?.near).toBe("const settings = {}; const key = process.env.KEY;");
  });

  test.skipIf(!existsSync(BACKEND))("the built backend holds nothing Lumiverse's install scan refuses", () => {
    expect(installScan(readFileSync(BACKEND, "utf8"))).toEqual([]);
  });
});
