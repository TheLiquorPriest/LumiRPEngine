// Each area registers from a file of its own (STANDALONE-PLAN §4.1): its routes, its tables and its
// settings are named in the `area.ts` of its folder, and `compose.ts` names each area once and hands it
// what it takes. A view an agent is given by name, and the lanes of the door to Lumiverse, are filled
// by the areas that know the answer, through the app's hooks. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentRef, Scope } from "rp-harness/contract";
import { harnessSettings, type Setting } from "../../src/app/setting-list";
import { USER_HEADER } from "../../src/adapter/lumiverse/pipe-wire";
import { LUMIVERSE_SETTINGS } from "../../src/adapter/lumiverse/settings";
import { QUESTION_PATH, type Question } from "../../src/adapter/lumiverse/wire";
import type { LumiverseDoor } from "../../src/adapter/lumiverse/mount";
import { type App, type Area, MIGRATION_AREAS } from "../../src/app";
import { compose } from "../../src/app/compose";
import { UPDATE_SETTINGS } from "../../src/app/update";
import { SERVER_SETTINGS } from "../../src/app/config";
import { CAST_SETTINGS } from "../../src/cast";
import { IFACE_SETTINGS } from "../../src/iface";
import { LORE_SETTINGS } from "../../src/lore";
import { STORE_SETTINGS } from "../../src/store";
import { STORY_SETTINGS } from "../../src/story";
import { TREE_SETTINGS } from "../../src/tree";
import { NO_SESSION, TURN_SETTINGS } from "../../src/turn";
import { BOOTSTRAP_FACTS, BOOTSTRAP_SETTINGS } from "../../src/turn/bootstrap";
import { CHAT, openTurnBed, USER, type TurnBed } from "../turn/bed";
import { makeBed, type Bed } from "./helpers";

const SRC = resolve(import.meta.dir, "../../src");
const COMPOSE = join(SRC, "app/compose.ts");

/** Each area of RPE by name: the file that registers it, and the settings its file lists. */
const OWN: Readonly<Record<string, { file: string; settings: readonly Setting[] }>> = {
  app: { file: "app/area.ts", settings: [...UPDATE_SETTINGS, ...SERVER_SETTINGS] },
  store: { file: "store/area.ts", settings: STORE_SETTINGS },
  lore: { file: "lore/area.ts", settings: LORE_SETTINGS },
  iface: { file: "iface/area.ts", settings: IFACE_SETTINGS },
  migrate: { file: "migrate/area.ts", settings: [] },
  tree: { file: "tree/area.ts", settings: TREE_SETTINGS },
  turn: { file: "turn/area.ts", settings: [...harnessSettings(), ...TURN_SETTINGS] },
  bootstrap: { file: "turn/bootstrap/area.ts", settings: BOOTSTRAP_SETTINGS },
  cast: { file: "cast/area.ts", settings: CAST_SETTINGS },
  story: { file: "story/area.ts", settings: STORY_SETTINGS },
  build: { file: "build/area.ts", settings: [] },
  play: { file: "play/area.ts", settings: [] },
  lumiverse: { file: "adapter/lumiverse/area.ts", settings: LUMIVERSE_SETTINGS },
};

/** Lumiverse's network refused, as the API generator composes: an area that reached for it while it mounted would stop here. */
function noLumiverse(): never {
  throw new Error("this test reaches no Lumiverse");
}

describe("each area registers from a file of its own", () => {
  let bed: Bed | null = null;
  afterEach(async () => {
    await bed?.remove();
    bed = null;
  });

  test("every route in the table, every migration step and every setting was added by its own area's file", async () => {
    bed = await makeBed();
    const composition = compose({ fetch: async () => noLumiverse(), open: noLumiverse, sleep: async () => noLumiverse() });
    // What each area added to the route table, through its own `mount` and `mounted`; and what the table held before the first area mounted: the app's own.
    const added = new Map<string, string[]>();
    let own: string[] | null = null;
    const noting = (area: Area): Area => {
      const note = (at: App, before: number): void => {
        const routes = at.routes.list().slice(before).map((r) => `${r.method} ${r.path}`);
        added.set(area.name, [...(added.get(area.name) ?? []), ...routes]);
      };
      return {
        ...area,
        mount: async (at) => {
          own ??= at.routes.list().map((r) => `${r.method} ${r.path}`);
          const before = at.routes.list().length;
          await area.mount?.(at);
          note(at, before);
        },
        mounted: async (at) => {
          const before = at.routes.list().length;
          await area.mounted?.(at);
          note(at, before);
        },
      };
    };
    const app = await bed.open({ areas: composition.areas.map(noting) });

    // Every area is one of RPE's own, and each is registered from its own folder's `area.ts`.
    expect(composition.areas.map((a) => a.name).sort()).toEqual(Object.keys(OWN).sort());
    const compositionSource = readFileSync(COMPOSE, "utf8");
    for (const [name, { file }] of Object.entries(OWN)) {
      expect({ name, file, exists: existsSync(join(SRC, file)) }).toEqual({ name, file, exists: true });
      expect({ name, imported: compositionSource.includes(`"../${file.replace(/\.ts$/, "")}"`) || compositionSource.includes(`"./${file.replace(/^app\//, "").replace(/\.ts$/, "")}"`) }).toEqual({ name, imported: true });
    }

    // Every route of the table is the app's own, added where it opens, or was added by one area's file and by that one alone.
    const table = app.routes.list().map((r) => `${r.method} ${r.path}`);
    const ownRoutes = (own as string[] | null) ?? [];
    const byAreas = [...added.values()].flat();
    expect(ownRoutes.length).toBeGreaterThan(0);
    expect(new Set(byAreas).size).toBe(byAreas.length);
    expect([...ownRoutes, ...byAreas].sort()).toEqual([...table].sort());
    for (const name of ["migrate", "turn", "bootstrap", "tree", "lore", "cast", "story", "build", "play", "lumiverse"]) expect({ name, routes: (added.get(name) ?? []).length > 0 }).toEqual({ name, routes: true });
    // The app's own area adds the Settings routes, over the whole registry, once every area is mounted.
    expect({ name: "app", routes: (added.get("app") ?? []).sort() }).toEqual({ name: "app", routes: ["GET /api/v1/settings", "PUT /api/v1/settings"] });
    for (const name of ["store", "iface"]) expect({ name, routes: added.get(name) ?? [] }).toEqual({ name, routes: [] });

    // Every migration step the database ran is one of an area's own, and every area of tables has an area that brings it.
    const brought = new Map<string, Set<number>>();
    for (const area of composition.areas) for (const t of area.tables ?? []) brought.set(t.area, new Set(t.migrations.map((m) => m.version)));
    expect([...brought.keys()].sort()).toEqual(MIGRATION_AREAS.filter((a) => a !== "app").sort());
    for (const step of app.migrated.applied) if (step.area !== "app") expect({ step, own: brought.get(step.area)?.has(step.version) }).toEqual({ step, own: true });
    expect(app.migrated.applied.some((s) => s.area !== "app")).toBe(true);

    // Every setting listed is one of an area's own list, once, in the order of the areas.
    for (const area of composition.areas) expect({ area: area.name, keys: (area.settings ?? []).map((d) => d.key) }).toEqual({ area: area.name, keys: (OWN[area.name]?.settings ?? []).map((d) => d.key) });
    expect(app.settings.map((d) => d.key)).toEqual(composition.areas.flatMap((a) => (a.settings ?? []).map((d) => d.key)));
    expect(new Set(app.settings.map((d) => d.key)).size).toBe(app.settings.length);
    expect(app.settings.length).toBeGreaterThan(50);
  });

  test("a lane two areas fill, and a setting two areas list, stop the app before it opens", async () => {
    bed = await makeBed();
    const fill = (name: string): Area => ({ name, fills: { door: { passConnection: () => null } } });
    await expect(bed.open({ areas: [fill("first"), fill("second")] })).rejects.toThrow("The door's passConnection lane is filled by two areas, first and second");
    const list = (name: string): Area => ({ name, settings: CAST_SETTINGS.slice(0, 1) });
    await expect(bed.open({ areas: [list("first"), list("second")] })).rejects.toThrow(`The setting ${CAST_SETTINGS[0]?.key} is listed by two areas, first and second`);
  });
});

/** What `compose.ts` holds that only an area's own file may: a route added, a table or a setting named. Each finding is a line of the source. */
function wiredHere(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const line of code.split("\n")) if (/\.routes\.add\(|\btables\s*:|\b[A-Z][A-Z_]*_(MIGRATIONS|SETTINGS|TABLES)\b|\bsettings\s*:\s*\[|\bmigrations\s*:/.test(line)) found.push(line.trim());
  return found;
}

/** The areas the composition names, each once: how many times each area's own function is called. */
function namedTimes(source: string): Record<string, number> {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const times = (pattern: RegExp): number => (code.match(pattern) ?? []).length;
  return {
    app: times(/\bappArea\(/g),
    store: times(/\bstoreArea\(/g),
    lore: times(/\bloreArea\(/g),
    iface: times(/\bifaceArea\(/g),
    migrate: times(/\bmigrateArea\(/g),
    tree: times(/\btreeArea\(/g),
    turn: times(/\bturnArea\(/g) + times(/\bturn\.area\b/g) - 1,
    bootstrap: times(/\bbootstrapArea\(/g),
    cast: times(/\bcastArea\(/g),
    story: times(/\bstoryArea\(/g),
    build: times(/\bbuildArea\(/g),
    play: times(/\bplayArea\(/g),
    lumiverse: times(/\bdoorArea\(/g) + times(/\bdoor\.area\b/g) - 1,
  };
}

describe("the composition", () => {
  const source = readFileSync(COMPOSE, "utf8");

  test("compose.ts names each area once and adds no route, table or setting of its own (it fails when one is wired anywhere else)", () => {
    expect(wiredHere(source)).toEqual([]);
    expect(namedTimes(source)).toEqual(Object.fromEntries(Object.keys(OWN).map((name) => [name, 1])));
    // The same check fails for a composition that wires one in itself, or names an area twice or not at all.
    expect(wiredHere(`${source}\n  at.routes.add("probe", []);`)).toHaveLength(1);
    expect(wiredHere(`${source}\n  const tables = { area: "store", migrations: [] };`).length).toBeGreaterThan(0);
    expect(wiredHere(`${source}\n  const list = [...CAST_SETTINGS];`)).toHaveLength(1);
    expect(wiredHere(`${source}\n  settings: [...HARNESS_SETTINGS],`).length).toBeGreaterThan(0);
    expect(namedTimes(`${source}\n  castArea(() => ({}));`).cast).toBe(2);
    expect(namedTimes(source.replace(/\bplayArea\(/, "playAreas(")).play).toBe(0);
  });
});

/** A turn's bed with one more area, which a test names from the composition (its door, its turn lane). */
async function bedWith(areas?: (composition: { door: LumiverseDoor }) => readonly Area[]): Promise<TurnBed> {
  return await openTurnBed({ answers: [], ...(areas !== undefined ? { areas } : {}) });
}

describe("the hooks areas fill", () => {
  const beds: TurnBed[] = [];
  afterEach(async () => {
    for (const b of beds.splice(0)) await b.close();
  });

  test("a view a test area's file registers is given to an agent by name, and the same area reads a Lumiverse chat's name through the door", async () => {
    const mine = (door: LumiverseDoor): Area => ({
      name: "views-test",
      fills: { views: async (scope: Scope, _agent: AgentRef, ref: string) => (ref === "test:chat_name" ? ((await door.lumiverse()?.reads.chat(scope.chat))?.name ?? null) : null) },
    });
    const b = await bedWith((composition) => [mine(composition.door)]);
    beds.push(b);
    const scope = { user: USER, chat: CHAT, session: NO_SESSION };
    const agent = { id: "author-1", definition: "author" };
    const blocks = await b.turns.env.events.attachments(scope, agent, [
      { ref: "test:chat_name", from: "definition", own: false },
      { ref: BOOTSTRAP_FACTS, from: "definition", own: false },
      { ref: "test:nobody_has_this", from: "definition", own: false },
    ]);
    // The test area's view, from Lumiverse's chat; the bootstrap's own, which another area fills; and a name no area has is left out.
    expect(blocks.map((block) => block.name)).toEqual(["test:chat_name", BOOTSTRAP_FACTS]);
    expect(blocks[0]?.text).toBe("The lighthouse");
  });

  test("a hook of the door no area fills keeps today's answer, and one a test area fills is used", async () => {
    const question = (b: TurnBed): Promise<Response> => {
      const registration = b.composition.door.registration();
      if (registration === null) throw new Error("RPE made no registration");
      const asked: Question = { v: 1, user: USER, chat: CHAT, purpose: "prompt", generation: null, path: [{ id: "m-greeting", index: 0, swipe: 0 }], entries: [] };
      return fetch(`${b.listening.url}${QUESTION_PATH}`, { method: "POST", headers: { authorization: `Bearer ${registration.key}`, [USER_HEADER]: USER, "content-type": "application/json" }, body: JSON.stringify(asked) });
    };
    // No area fills the secrecy lane: today's answer, that the secrets are not known, so the extension keeps every marked secret out.
    const plain = await bedWith();
    beds.push(plain);
    const unfilled = await (await question(plain)).json();
    expect(unfilled).toMatchObject({ v: 1, secrecy: null });
    expect(plain.logged.some((l) => l.level === "error")).toBe(false);

    const heard: string[] = [];
    const filling: Area = {
      name: "secrecy-test",
      fills: {
        door: {
          secrecy: async (ask) => {
            heard.push(`${ask.chat}:${ask.purpose}`);
            return { disabled: ["entry-1"], enabled: [], mutated: [] };
          },
        },
      },
    };
    const filled = await bedWith(() => [filling]);
    beds.push(filled);
    const answered = await (await question(filled)).json();
    expect(answered).toMatchObject({ v: 1, secrecy: { disabled: ["entry-1"], enabled: [], mutated: [] } });
    expect(heard).toEqual([`${CHAT}:prompt`]);
  });
});
