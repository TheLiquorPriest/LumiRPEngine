// Who may know a world entry, as today's code has it, in a chat played through the store: asked as a
// character, a secret, an entry known only to those who know what it links, one awaiting review; and
// as the lead, every entry marked with who may know it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loreGateReader } from "../../src/engine/visibility";
import { Lore, storeWorlds } from "../../src/lore/index";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { openStore, type Store, type UserStore } from "../../src/store/store";
import type { TurnRow } from "../../src/store/types";
import { CHAT, coastWorld, dbFile, type LoreDb, loreDb, POV, registry, Shelf, Tags, USER, W } from "./fixtures";

const AT = { user: USER, chat: CHAT };
const CROWN = [W.drowned_crown];
const COVE = [W.cove_route];

const ids = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id);

describe("who may know a world entry", () => {
  let dir: string;
  let db: LoreDb;
  let store: Store;
  let s: UserStore;
  let lore: Lore;
  let played = 0;

  /** A reply played on the chat, recording `events` as the GM's. */
  function play(...events: LedgerEvent[]): TurnRow {
    played++;
    const turn = s.beginTurn({ chat: CHAT, kind: "normal" });
    const { changes } = s.addChanges(turn.id, events.map((e) => ({ lane: "engine", op: e.type, value: e as unknown as JsonObject, by: "gm", source: "gm" })));
    expect(changes.every((c) => c.applied)).toBe(true);
    return s.tieTurn(turn.id, { message: `message-${played}`, hash: `hash-${played}`, date: played });
  }

  /** Whether the drowned crown's gate holds where the chat's path stands now. */
  function crownGateHolds(): boolean {
    const at = storeWorlds(store).at(USER, CHAT);
    const entry = at?.world.lore.drowned_crown;
    if (!at || !entry) throw new Error("the coast's world was not read");
    return loreGateReader(at.registry, at.world, at.state)(entry);
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-knowing-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    const world = coastWorld();
    const revision = hashJson(world);
    store = openStore({ db: ":memory:", registry: registry(), worlds: (r) => (r === revision ? world : undefined) });
    s = store.user(USER);
    s.createChat({ id: CHAT, world: world.id, revision });
    lore = new Lore({ books: new Shelf(), worlds: storeWorlds(store), turns: new Tags(), numbers: db.numbers });
  });
  afterAll(async () => {
    store.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a secret is read by its holder before its gate holds, and by nobody else even after it holds", async () => {
    expect(crownGateHolds()).toBe(false);
    expect(ids(await lore.readAs(AT, "orrin", CROWN))).toEqual(CROWN);
    for (const who of [POV, "sefa", "tobin"]) expect(await lore.readAs(AT, who, CROWN)).toEqual([]);
    expect(ids(await lore.searchAs(AT, "orrin", { text: "crown" }))).toEqual(CROWN);
    expect(await lore.searchAs(AT, "tobin", { text: "crown" })).toEqual([]);

    play({ type: "set", entity: POV, field: "place", value: "lighthouse" });
    expect(crownGateHolds()).toBe(true);
    expect(ids(await lore.readAs(AT, "orrin", CROWN))).toEqual(CROWN);
    for (const who of [POV, "sefa", "tobin"]) expect(await lore.readAs(AT, who, CROWN)).toEqual([]);
    expect(await lore.searchAs(AT, POV, { text: "crown" })).toEqual([]);
  });

  test("an entry known only to those who know what it links is read once the character knows every person and place it links", async () => {
    // Sefa knows herself and stands in the cove; Nell knows neither.
    expect(ids(await lore.readAs(AT, "sefa", COVE))).toEqual(COVE);
    expect(await lore.readAs(AT, POV, COVE)).toEqual([]);
    expect(await lore.readAs(AT, "tobin", COVE)).toEqual([]);

    // What a turn has staged counts at that turn, and nowhere else until it is played.
    const open = s.beginTurn({ chat: CHAT, kind: "normal" });
    s.addChanges(open.id, [{ lane: "engine", op: "link", value: { type: "link", rel: "knows", from: "tobin", to: "sefa" }, by: "gm", source: "gm" }, { lane: "engine", op: "link", value: { type: "link", rel: "knows", from: "tobin", to: "smugglers_cove" }, by: "gm", source: "gm" }]);
    expect(ids(await lore.readAs({ ...AT, turn: open.id }, "tobin", COVE))).toEqual(COVE);
    expect(await lore.readAs(AT, "tobin", COVE)).toEqual([]);
    s.dropTurn(open.id);

    play({ type: "link", rel: "knows", from: "tobin", to: "sefa" });
    expect(await lore.readAs(AT, "tobin", COVE)).toEqual([]);
    play({ type: "link", rel: "knows", from: "tobin", to: "smugglers_cove" });
    expect(ids(await lore.readAs(AT, "tobin", COVE))).toEqual(COVE);
    expect(await lore.readAs(AT, POV, COVE)).toEqual([]);
  });

  test("an entry an agent wrote that awaits review is the GM's alone; the lead reads every entry, marked with who may know it now", async () => {
    for (const who of [POV, "orrin", "sefa", "tobin"]) expect(await lore.readAs(AT, who, [W.ferry_draft])).toEqual([]);
    expect(ids(await lore.readAs(AT, "tobin", [W.tithe_law]))).toEqual([W.tithe_law]);
    const lead = await lore.read(AT, [W.tithe_law, W.cove_route, W.drowned_crown, W.ferry_draft]);
    expect(lead.map((e) => [e.id, e.knowing])).toEqual([
      [W.tithe_law, undefined],
      [W.cove_route, { by: "characters", names: ["Sefa Moor", "Tobin Reed"] }],
      [W.drowned_crown, { by: "gate", gate: "self.place == 'lighthouse'", open: true }],
      [W.ferry_draft, { by: "characters", names: [] }],
    ]);
    expect(lead.map((e) => e.text)).toEqual([
      "Every boat pays a tenth of its catch at the harbor steps.",
      "Sefa runs brandy through the cove at the new moon.",
      "Orrin hid the old queen's crown under the lighthouse stair.",
      "A flat ferry crosses the estuary at slack water.",
    ]);
  });

  test("a character reads a public book entry, and a mark of it only once it holds it; a character given lore tools finds only what it may know", async () => {
    const [lamp] = await lore.search(AT, { text: "beacon" });
    const [bell] = await lore.search(AT, { text: "bell" });
    expect([lamp?.title, bell?.title]).toEqual(["The lamp room", "The tide bell"]);
    const text = async (who: string, id: string | undefined): Promise<string | undefined> => (await lore.readAs(AT, who, [id ?? ""]))[0]?.text;
    expect(await text("tobin", lamp?.id)).toBe("Green glass and whale oil, kept burning by the night watch.");
    // The mark known to Orrin is his alone: where it stands it is left out for Tobin and read in place by Orrin.
    expect(await text("tobin", bell?.id)).toBe("The bell rings at high water.\n");
    expect(await text("orrin", bell?.id)).toBe("The bell rings at high water.\nOrrin cracked the bell with a hammer.");
    expect(ids(await lore.searchAs(AT, "orrin", { text: "hammer" }))).toEqual([bell?.id ?? ""]);
    expect(await lore.searchAs(AT, "tobin", { text: "hammer" })).toEqual([]);
    expect(ids(await lore.searchAs(AT, "tobin", { text: "beacon" }))).toEqual([lamp?.id ?? ""]);
    // A twin of an entry already read, and one switched off, are no one's lore.
    expect((await lore.searchAs(AT, "tobin", { text: "rumor" })).length).toBe(0);
    // Named for the character (bound to it, or attached for it), an entry switched off is read as the character may know it.
    const off = (await db.numbers.of(USER, ["entry-off"])).get("entry-off");
    expect((await lore.readAs(AT, "tobin", [`e-${off}`]))[0]?.text).toBe("A rumor that the lamp keeper drinks.");
  });

  test("a holder made through perceive reads the world secret before its gate holds, once the holding counts", async () => {
    const fact = { type: "minds.fact", data: { fact: { id: "lore:drowned_crown", kind: "lore", claim: "Orrin hid the old queen's crown under the lighthouse stair.", about: [], truth: "true" } } } as unknown as LedgerEvent;
    const learn = (who: string, confidence: number): LedgerEvent => ({ type: "minds.learn", data: { who: [who], fact: "lore:drowned_crown", how: "told", by: "orrin", evidence: [], belief: "true", confidence, keptFrom: "everyone", msg: null, at: 1 } } as unknown as LedgerEvent);
    // Not sure enough: a suspicion makes no one a holder. Sure enough, told by Orrin, Sefa reads it, the gate shut or open, and Tobin still does not.
    play(fact, learn("tobin", 0.4));
    expect(await lore.readAs(AT, "tobin", CROWN)).toEqual([]);
    play(learn("sefa", 1));
    expect(ids(await lore.readAs(AT, "sefa", CROWN))).toEqual(CROWN);
    expect(ids(await lore.searchAs(AT, "sefa", { text: "crown" }))).toEqual(CROWN);
    expect(await lore.readAs(AT, "tobin", CROWN)).toEqual([]);
  });
});
