// The generated types and the API reference (plan §4.4 l.308) are written by `bun run api` from the route
// table the server runs, read as the app composes it with nothing listening: the committed files are
// what it writes now, and a route an area adds reaches both with nothing else edited.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateApi, REFERENCE_FILE, TYPES_FILE } from "../../scripts/api/generate";
import { type Area, route, shape } from "../../src/app";

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
    expect(types).toContain(['  "GET /api/v1/chats/:chat/tides": {', "    params: { chat: string };", "    query: { day?: number };", "    body: undefined;", "    reply: TideTable;", "    paged: false;", "  };"].join("\n"));
    expect(types).toContain("export interface TideTable {\n  chat: string;\n  turns: { at: string; high: boolean }[];\n}");
    expect(routeKeys(types)).toEqual(new Set([...routeKeys(before.types), "GET /api/v1/chats/:chat/tides"]));
    const places = reference.indexOf("## Places");
    expect(places).toBeGreaterThan(-1);
    expect(reference.indexOf("### `GET /api/v1/chats/:chat/tides`\n\nThe harbor's tides for a chat's day.")).toBeGreaterThan(places);
    expect(reference).toContain("| Query | `day` (may be left out): `number` |");
    expect(reference).toContain("### `TideTable`\n\nWhen each high and low water comes on a day.");
    expect(before.reference).not.toContain("TideTable");
  });
});
