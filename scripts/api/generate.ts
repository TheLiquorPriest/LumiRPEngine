// `bun run api` (plan §4.4 l.308): the route table read as the app composes it, every area mounted over a
// data folder of the generator's own and nothing listening, and from it the generated types
// (`src/shared/api/index.ts`) and the API reference (`docs/api.md`) written (render.ts). The test that
// holds the committed files to the table reads it the same way.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Area, dataPaths, LIVE_KINDS, lineLog, openApp } from "../../src/app";
import { compose } from "../../src/app/compose";
import { configOf } from "../../src/app/config";
import { renderReference, renderTypes, type Table } from "./render";

const ROOT = resolve(import.meta.dir, "../..");
export const TYPES_FILE = join(ROOT, "src/shared/api/index.ts");
export const REFERENCE_FILE = join(ROOT, "docs/api.md");

/** An area that reached for Lumiverse while it mounted would stop the generator here, rather than reach a network. */
function noLumiverse(): never {
  throw new Error("The API generator reaches no Lumiverse, and an area asked for it while it mounted.");
}

/**
 * The table as RPE composes it, with `extra` areas mounted after RPE's own: the app opened over an
 * empty data folder of its own, a user named, nothing listening, and closed and removed after.
 */
export async function readTable(extra: readonly Area[] = []): Promise<Table> {
  const root = await mkdtemp(join(tmpdir(), "rpe-api-"));
  try {
    const composition = compose({ fetch: async () => noLumiverse(), open: noLumiverse, sleep: async () => noLumiverse() });
    const app = await openApp({
      paths: dataPaths(join(root, "data")),
      config: configOf({ port: 0, lumiverse: { url: "http://127.0.0.1:9", user: "api-reader" } }, {}, "the API generator's config"),
      version: "api",
      areas: [...composition.areas, ...extra],
      ui: null,
      log: lineLog(() => undefined),
    });
    try {
      return { routes: app.routes.list(), kinds: LIVE_KINDS, bodyBytes: app.config.server.bodyBytes, providerBodyBytes: app.config.server.providerBodyBytes };
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The generated types and the API reference, as the table holds them now. */
export async function generateApi(extra: readonly Area[] = []): Promise<{ types: string; reference: string }> {
  const table = await readTable(extra);
  return { types: renderTypes(table), reference: renderReference(table) };
}

if (import.meta.main) {
  const { types, reference } = await generateApi();
  await writeFile(TYPES_FILE, types);
  await writeFile(REFERENCE_FILE, reference);
  console.log(`Wrote ${TYPES_FILE.slice(ROOT.length + 1)} and ${REFERENCE_FILE.slice(ROOT.length + 1)} from the route table.`);
}
