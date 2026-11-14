// The build's own reading of Lumiverse's install scan (`scripts/install-scan.ts`): each thing the host
// refuses in a backend bundle is found where it is code, and nowhere it is only words. The scan is the
// last thing between a bundled module and an extension Lumiverse won't load.

import { describe, expect, test } from "bun:test";
import { installScan } from "../../scripts/install-scan";

const found = (js: string): string[] => installScan(js).map((hit) => hit.what);

describe("the install scan", () => {
  test("finds each thing the host refuses, as code", () => {
    const refused: [js: string, what: string][] = [
      ["const sum = eval(text);", "dynamic code execution"],
      ["const make = new Function('return 1');", "dynamic code execution"],
      ["const key = process.env.KEY;", "dangerous process API usage"],
      ["const p = process;\np.exit(1);", "dangerous process API usage"],
      ["const { env } = process;", "dangerous process API usage"],
      ["import fs from 'fs';", "filesystem module access"],
      ['const run = await import("child" + "_process");', "subprocess module access"],
      ["const mod = await import(name);", "dynamic module access"],
      ['const bytes = Buffer.from(text, "base64");', "base64 decoding"],
      ["Bun.serve({ port: 0 });", "dangerous Bun system API usage"],
      ["Bun['ser' + 've']({ port: 0 });", "dangerous Bun system API usage"],
      ["const page = await Bun.fetch(url);", "dangerous Bun system API usage"],
      ['import { file } from "bun";', "dangerous Bun system API usage"],
      ["const page = await fetch(url);", "direct fetch API usage"],
      ["const page = await fetch?.(url);", "direct fetch API usage"],
      ["const get = fetch;", "direct fetch API usage"],
      ["const page = await fetch.call(null, url);", "direct fetch API usage"],
      ["const page = await globalThis.fetch(url);", "direct fetch API usage"],
      ['const page = await self["fet" + "ch"](url);', "direct fetch API usage"],
      ["const g = globalThis;\nconst page = await g.fetch(url);", "direct fetch API usage"],
      ["const { fetch: get } = globalThis;", "direct fetch API usage"],
      ['import fetch from "node-fetch";', "direct fetch API usage"],
      ['const { request } = require("undici");', "direct fetch API usage"],
      // Stricter than the host: the light extension holds nothing but what Spindle gives it.
      ['import { join } from "node:path";', "a node: module"],
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
      "const page = await spindle.cors(url); const fetched = fetcher(url); const other = await host.fetch(url);",
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
});
