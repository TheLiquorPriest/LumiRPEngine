// The generated types and the API reference (plan §4.4 l.308) are written by `bun run api` from the route
// table the server runs, read as the app composes it with nothing listening: the committed files are
// what it writes now, a route an area adds reaches both with nothing else edited, the live socket's own
// messages are in both, and the pages take every type the generated file holds from it alone.

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { generateApi, REFERENCE_FILE, TYPES_FILE } from "../../scripts/api/generate";
import { type Area, route, shape } from "../../src/app";

const ROOT = resolve(import.meta.dir, "../..");
const GENERATED = join(ROOT, "src/shared/api");
const UI_API = join(ROOT, "src/ui/api");

/** The names a module's file exports. */
function exportsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^export (?:type |interface |const )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] ?? "");
}

/** What a file's import lines take: the module each names (a relative one resolved from the file's folder), and the names taken from it. */
function importsOf(file: string): { from: string; names: string[] }[] {
  return [...readFileSync(file, "utf8").matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/gm)].map((m) => {
    const from = m[2] ?? "";
    const names = (m[1] ?? "").split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "");
    return { from: from.startsWith(".") ? resolve(dirname(file), from) : from, names: names.filter((name) => name !== "") };
  });
}

/** Where a committed file first parts from what the table writes now; null where they are the same. */
function firstDifference(committed: string, now: string): string | null {
  const was = committed.split("\n");
  const is = now.split("\n");
  for (let i = 0; i < Math.max(was.length, is.length); i++) if (was[i] !== is[i]) return `line ${i + 1}: the file has ${JSON.stringify(was[i] ?? "(nothing)")}, and the table writes ${JSON.stringify(is[i] ?? "(nothing)")}`;
  return null;
}

/** The routes the generated types hold, by method and path. */
function routeKeys(types: string): Set<string> {
  return new Set([...types.matchAll(/^ {2}"([A-Z]+ [^"]+)": \{$/gm)].map((m) => m[1] ?? ""));
}

/** An area of a fixture's own: a page's route the table did not hold before. */
const tides: Area = {
  name: "tides",
  mount: (app) =>
    app.routes.add("tides", [
      route({
        method: "GET",
        path: "/api/v1/chats/:chat/tides",
        access: "page",
        group: "places",
        does: "The harbor's tides for a chat's day.",
        query: { day: shape.optional(shape.whole({ least: 1 })) },
        reply: shape.named("TideTable", "When each high and low water comes on a day.", shape.object({ chat: shape.text(), turns: shape.list(shape.object({ at: shape.text(), high: shape.yesNo() })) })),
        handle: ({ params }) => ({ chat: params.chat, turns: [{ at: "06:12", high: true }] }),
      }),
    ]),
};

describe("the generated types and the API reference", () => {
  test("the committed generated types and API reference are what the generator writes from the table now", async () => {
    const { types, reference } = await generateApi();
    // Either one behind the table: run `bun run api`, and commit what it writes.
    expect({ file: "src/shared/api/index.ts", difference: firstDifference(readFileSync(TYPES_FILE, "utf8"), types) }).toEqual({ file: "src/shared/api/index.ts", difference: null });
    expect({ file: "docs/api.md", difference: firstDifference(readFileSync(REFERENCE_FILE, "utf8"), reference) }).toEqual({ file: "docs/api.md", difference: null });
  });

  test("a route a fixture area adds appears in the generated types and in the reference, with nothing else edited", async () => {
    const before = await generateApi();
    const { types, reference } = await generateApi([tides]);
    expect(types).toContain(['  "GET /api/v1/chats/:chat/tides": {', "    params: { chat: string };", "    query: { day?: number };", "    body: undefined;", "    reply: TideTable;", "    paged: false;", "    joined: false;", "  };"].join("\n"));
    expect(types).toContain("export interface TideTable {\n  chat: string;\n  turns: { at: string; high: boolean }[];\n}");
    expect(routeKeys(types)).toEqual(new Set([...routeKeys(before.types), "GET /api/v1/chats/:chat/tides"]));
    const places = reference.indexOf("## Places");
    expect(places).toBeGreaterThan(-1);
    expect(reference.indexOf("### `GET /api/v1/chats/:chat/tides`\n\nThe harbor's tides for a chat's day.")).toBeGreaterThan(places);
    expect(reference).toContain("| Query | `day` (may be left out): `number` |");
    expect(reference).toContain("### `TideTable`\n\nWhen each high and low water comes on a day.");
    expect(before.reference).not.toContain("TideTable");
  });

  test("the generated types and the reference hold the socket's messages: follow, unfollow, following, events with missed, refused, the 4401 close and the token protocol", async () => {
    const { types, reference } = await generateApi();
    expect(types).toContain('export interface LiveAsk {\n  op: "follow" | "unfollow";\n  chat: string;\n}');
    expect(types).toContain('export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };');
    expect(types).toContain("export interface LiveMissed {\n  from: number;\n  to: number;\n}");
    expect(types).toContain("export interface LiveBatch {\n  chat: string;\n  events: LiveEvent[];\n  missed?: LiveMissed;\n}");
    expect(types).toContain('kind: "handler_failed"; at: number; data: { op: string; error: string } }');
    for (const line of ['export const LIVE_PATH = "/api/v1/live";', 'export const LIVE_PROTOCOL = "rpe.live";', 'export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";', "export const LIVE_TOKEN_ENDED = 4401;"]) expect(types).toContain(line);
    const section = reference.slice(reference.indexOf("## The live socket's messages"), reference.indexOf("## Types"));
    expect(section).toContain("offering the protocol `rpe.live`");
    expect(section).toContain("as a second protocol: `rpe.token.` and then the token");
    expect(section).toContain("| A page sends | [`LiveAsk`](#liveask) |");
    expect(section).toContain("| A page is sent | [`LiveMessage`](#livemessage) |");
    expect(section).toContain("| Closed | with the code 4401 and the reason ");
    for (const name of ["LiveAsk", "LiveMessage", "LiveMissed", "LiveBatch", "LiveEvent"]) expect(reference).toContain(`### \`${name}\``);
    expect(reference).toContain("- [The live socket's messages](#the-live-sockets-messages)");
  });

  test("a file under src/ui that takes types from the generated file takes none of the same names from rp-harness/contract or from src/ui/api.ts", () => {
    const generated = new Set(exportsOf(TYPES_FILE));
    const files = [...new Glob("src/ui/**/*.{ts,tsx}").scanSync(ROOT)].map((file) => join(ROOT, file)).sort();
    const takers: string[] = [];
    const doubled: string[] = [];
    for (const file of files) {
      const imports = importsOf(file);
      if (!imports.some((i) => i.from === GENERATED)) continue;
      takers.push(relative(ROOT, file));
      for (const i of imports) if (i.from === "rp-harness/contract" || i.from === UI_API) for (const name of i.names.filter((n) => generated.has(n))) doubled.push(`${relative(ROOT, file)} takes ${name} from ${i.from === UI_API ? "src/ui/api.ts" : i.from}`);
    }
    expect(doubled).toEqual([]);
    // Every file that reads the live socket is among them.
    expect(takers).toEqual(expect.arrayContaining(["src/ui/client.ts", "src/ui/roads.ts", "src/ui/live-model.ts", "src/ui/live-watch.ts", "src/ui/pages/connections.tsx", "src/ui/pages/settings.tsx"]));
    // Nor does src/ui/api.ts keep a copy of one for a page to take.
    expect(exportsOf(`${UI_API}.ts`).filter((name) => generated.has(name))).toEqual([]);
  });
});
