// The floor's fixture on the rig (PlanScenarios-2 items 6, 9): a play of the floor's gate finds the card, persona, preset and book `floor.ts setup` makes, by the
// rig's own record, read as the floor's reader reads it (`findFixture`, `recordOfEnv`); the plain connection is set to the effort the shipped Author definition names;
// the floor's chat is named "Floor test", starts on the card's greeting and is listed in the record; and the environment is the play's own for as long as it lasts.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { liveReader, missingActs } from "../../../scripts/proof/floor/play";
import type { Host, PlayStart } from "../../../scripts/proof/route/host";
import { openRig, type RigActs } from "../../../scripts/proof/rig/host";
import { authorEffort, CARD, CHAT_NAME, findFixture, LORE, RECORD_FILE, recordOfEnv } from "../../../scripts/testbed/floor-fixture";
import { Lumiverse } from "../../../scripts/testbed/lib/lumiverse";
import { RpeReader } from "../../../scripts/proof/lib/read";

const ROOT = resolve(import.meta.dir, "../../../scripts/proof");
let host: Host<RigActs>;
const kept = new Map<string, unknown>();
const floor: PlayStart = { form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: ROOT, bed: [] }, play: 1, plays: 1, keep: async (name, data) => void kept.set(name, data) };
const other: PlayStart = { form: { id: "99", kind: "scenario", fixtures: [], fixturesDir: ROOT, bed: [] }, play: 1, plays: 1, keep: async () => undefined };

beforeAll(async () => {
  host = await openRig({ root: ROOT, run: "rig-floor-test", pin: { stage: "before-publishing" } });
}, 120_000);

afterAll(async () => {
  await host?.close();
});

test("a play of the floor finds its fixture by the rig's own record, and the environment is given back when the play ends", async () => {
  const was = process.env.LRE_INSTANCE_DIR;
  const session = await host.begin(floor);
  try {
    const acts = session.acts;
    expect(missingActs(acts)).toEqual([]);
    const dir = process.env.LRE_INSTANCE_DIR ?? "";
    expect(dir).not.toBe(was ?? "");
    expect(existsSync(join(dir, RECORD_FILE))).toBe(true);
    const record = recordOfEnv(process.env);
    expect(record).toMatchObject({ presets: ["preset-floor"], personas: ["pers-floor"], cards: ["char-floor"], chats: [] });
    expect(record?.books).toHaveLength(1);

    // The floor's own reader finds it, as `setup` leaves it: every designed entry but the vector one (the rig has no embedding connection), the card holding the book.
    const reader = liveReader(acts);
    const fixture = await reader.fixture();
    reader.close();
    expect(fixture.card).toMatchObject({ id: "char-floor" });
    expect(fixture.book.entries.map((e) => e.title)).toEqual(LORE.filter((d) => d.kind !== "vector").map((d) => d.title));
    expect(fixture.book.vectorBlockers.join(" ")).toContain("embeddings are off");
    expect(await findFixture(new Lumiverse(acts.lumiverse.base, acts.lumiverse.token), record)).toMatchObject({ preset: { id: "preset-floor" }, persona: { id: "pers-floor" } });

    // Plain generation is set to the effort the shipped Author definition names, on its own binding, and still holds its key.
    const effort = authorEffort(await new RpeReader(acts.rpe.base, acts.rpe.token).viewFile("", "@shipped/.agents/author.md"));
    expect(effort).not.toBeNull();
    const connection = await new Lumiverse(acts.lumiverse.base, acts.lumiverse.token).call<{ has_api_key: boolean; metadata: { reasoningBindings: { settings: { apiReasoning: boolean; reasoningEffort?: string } } } }>("GET", `/api/v1/connections/${acts.connections.plain}`);
    expect(connection.metadata.reasoningBindings.settings).toMatchObject({ apiReasoning: effort !== "off" });
    if (effort !== "off") expect(connection.metadata.reasoningBindings.settings.reasoningEffort).toBe(effort ?? "");
    expect(connection.has_api_key).toBe(true);
    expect(kept.get("floor-fixture")).toMatchObject({ record: { cards: ["char-floor"] } });
  } finally {
    await session.close();
  }
  expect(process.env.LRE_INSTANCE_DIR).toBe(was);
}, 120_000);

test("the floor's chat is named Floor test, begins on the card's greeting and is listed in the record; a play of any other form is given no floor fixture", async () => {
  const session = await host.begin(floor);
  try {
    const acts = session.acts;
    const chat = await acts.chat("char-floor");
    const made = acts.bed.host.chats.get(chat);
    expect(made?.name).toBe(CHAT_NAME);
    expect(made?.messages.map((m) => m.content)).toEqual([CARD.first_mes]);
    expect(recordOfEnv(process.env)?.chats).toEqual([chat]);
  } finally {
    await session.close();
  }
  const plain = await host.begin(other);
  try {
    expect(process.env.LRE_INSTANCE_DIR ?? "").not.toContain("rpe-rig-floor");
    expect(plain.acts.bed.db.rows("SELECT id FROM presets").map((r) => r.id)).toEqual(["preset-lamp"]);
    await expect(plain.acts.chat("char-floor")).rejects.toThrow("holds no card char-floor");
  } finally {
    await plain.close();
  }
}, 120_000);
