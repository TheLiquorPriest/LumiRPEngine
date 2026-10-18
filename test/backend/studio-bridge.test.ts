// The Studio bridge on the fake host (DESIGN §15; docs/STUDIO.md "The Studio bridge"): what
// LumiRPEngine Studio may read (the worlds, each one's head and revisions, the world chats as their
// players see them), and its offer, which Build reviews and installs only on Install.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { JsonValue } from "../../src/shared/json";
import type { StudioChats, StudioWorldList, StudioWorldRead } from "../../src/shared/studio-bridge";
import { channelId, chatsChannel, ENGINE_EXTENSION, engineEndpoint, offerEndpoint, STUDIO_EXTENSION, worldChannel, worldsChannel } from "../../src/shared/studio-bridge";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { testWorld } from "../support/test-pack";

/** What LumiRPEngine Studio reads from the engine, as the Studio. */
async function studioRead<T>(rig: Rig, channel: string): Promise<T> {
  return (await rig.host.rpcPool.read(engineEndpoint(channel), STUDIO_EXTENSION)) as T;
}

/** The Studio publishing an offer for the rig's user, answering the engine only (as the Studio does). */
function offer(rig: Rig, value: Record<string, unknown>): void {
  rig.host.rpcPool.port(STUDIO_EXTENSION).handle(`offer.${channelId(rig.host.userId)}`, [], async (requester) => {
    if (requester !== ENGINE_EXTENSION) throw new Error("not for you");
    return value;
  });
}

async function review(rig: Rig): Promise<Record<string, unknown>> {
  const body = rig.body(await rig.send({ type: "lre.studio", op: "offer" }));
  if (!isRecord(body.offer)) throw new Error(`no offer: ${String(body.message)}`);
  return body.offer;
}

function doc(world: WorldDoc): JsonValue {
  return JSON.parse(JSON.stringify(world)) as JsonValue;
}

describe("the Studio bridge", () => {
  test("a channel names an id by its bytes, so ids that differ only in case stay apart", () => {
    expect(channelId("AbC-1")).toBe("4162432d31");
    expect(channelId("abc-1")).not.toBe(channelId("ABC-1"));
    expect(offerEndpoint("User_X")).toMatch(/^lumi_rp_engine_studio\.offer\.[0-9a-f]+$/);
  });

  test("the Studio reads the world list and each world's head and revisions; no other extension may", async () => {
    const rig = new Rig();
    const user = rig.host.userId;
    const worldId = await rig.newWorld("Harbor");
    const listed = await studioRead<StudioWorldList>(rig, worldsChannel(user));
    const entry = listed.worlds.find((w) => w.id === worldId);
    if (!entry) throw new Error("the world isn't listed");
    expect([entry.name, entry.revisions, entry.revisionCount]).toEqual(["Harbor", [entry.head], 1]);
    const first = entry.head;

    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "pier", value: { id: "pier", name: "The pier", fields: {} } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const head = await studioRead<StudioWorldRead>(rig, worldChannel(user, worldId));
    expect(head.revision).toBe(String(committed.revision));
    expect(head.head).toBe(head.revision);
    expect(Object.keys(head.world.places)).toContain("pier");
    const older = await studioRead<StudioWorldRead>(rig, worldChannel(user, worldId, first));
    expect([older.revision, Object.keys(older.world.places).includes("pier")]).toEqual([first, false]);

    await expect(rig.host.rpcPool.read(engineEndpoint(worldsChannel(user)), "another_ext")).rejects.toThrow(STUDIO_EXTENSION);
    await expect(rig.host.rpcPool.read(engineEndpoint(worldChannel(user, worldId)), "another_ext")).rejects.toThrow(STUDIO_EXTENSION);

    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId }));
    expect(rig.host.rpcPool.registered(engineEndpoint(worldChannel(user, worldId)))).toBe(false);
    expect((await studioRead<StudioWorldList>(rig, worldsChannel(user))).worlds).toEqual([]);
  });

  test("a world chat's summary is what its player sees: a hidden person and a secret's label and truth stay out", async () => {
    const rig = new Rig({ shipped: true });
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Lantern Row", template: null }));
    if (!isRecord(created.world) || typeof created.world.id !== "string") throw new Error("no world");
    const worldId = created.world.id;
    const put = async (collection: string, id: string, value: Record<string, unknown>) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
    await put("entities", "mara", { id: "mara", kind: "person", name: "Mara Vell", tier: "supporting", fields: { place: "home" }, relations: [] });
    await put("entities", "ghost", { id: "ghost", kind: "person", name: "Silas Thorne", tier: "supporting", fields: { place: "home" }, relations: [], visibility: "secret" });
    await put("tracks", "lost_cat", { id: "lost_cat", kind: "quest", label: "Find the lost cat", start: "looking", visibility: "public", stages: { looking: { label: "Looking", cue: "Mara's cat hasn't come home.", next: [{ to: "found", when: "false" }] }, found: { label: "Found", next: [] } } });
    await put("tracks", "debt", { id: "debt", kind: "secret", label: "Thorne's hidden debt", start: "hidden", visibility: "secret", stages: { hidden: { label: "Something is off", cue: "The ledger doesn't add up.", next: [{ to: "out", when: "false" }] }, out: { label: "Thorne owes the guild", truth: "Silas Thorne owes the guild a fortune.", next: [] } } });
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Evening on Lantern Row.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));

    const { chats } = await studioRead<StudioChats>(rig, chatsChannel(rig.host.userId));
    const summary = chats.find((c) => c.chatId === chatId);
    if (!summary) throw new Error("the chat isn't summarized");
    expect([summary.worldId, summary.revision, summary.place?.name]).toEqual([worldId, String(committed.revision), "Home"]);
    expect(summary.clock?.label).toBeTruthy();
    expect(summary.present.map((p) => p.name)).toContain("Mara Vell");
    expect(summary.quests.map((q) => q.label)).toContain("Find the lost cat");
    const text = JSON.stringify(summary);
    for (const secret of ["Silas Thorne", "ghost", "Thorne's hidden debt", "owes the guild"]) expect(text).not.toContain(secret);
    // The summaries come from chats: a reader without `chats` is refused by the read policy.
    await expect(rig.host.rpcPool.read(engineEndpoint(chatsChannel(rig.host.userId)), "another_ext")).rejects.toThrow("chats");
  });

  test("an offer is reviewed without installing anything, installs as a new world on Install, and only once", async () => {
    const rig = new Rig();
    const world = testWorld();
    world.lore.note = { id: "note", title: "A note", content: "Ask {{user}} about the key.", keys: [], links: [] };
    offer(rig, { offerId: "offer-1", doc: doc(world), mode: "new", createdAt: 5 });

    const reviewed = await review(rig);
    expect([reviewed.name, reviewed.mode, reviewed.errors, reviewed.blocked, reviewed.installed]).toEqual(["Test world 0", "new", 0, null, null]);
    expect(isRecord(reviewed.counts) && reviewed.counts.entities).toBe(2);
    expect(Array.isArray(reviewed.macros) && reviewed.macros.length).toBe(1);
    expect(rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds).toEqual([]);

    const stale = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-0" });
    expect(stale.type === "lre.error" && stale.code).toBe("conflict");
    const installed = rig.body(await rig.send({ type: "lre.studio", op: "install", offerId: "offer-1" }));
    if (!isRecord(installed.installed)) throw new Error("not installed");
    expect(installed.installed.worldId).not.toBe(world.id);
    expect([installed.installed.mode, installed.installed.name, Array.isArray(installed.lint) && installed.lint.length]).toEqual(["new", "Test world 0", 1]);
    const worlds = rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds;
    expect(Array.isArray(worlds) && worlds.map((w) => (isRecord(w) ? w.id : null))).toEqual([installed.installed.worldId]);

    expect((await review(rig)).installed).toEqual({ worldId: installed.installed.worldId, revision: installed.installed.revision });
    const again = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-1" });
    expect(again.type === "lre.error" && again.code).toBe("conflict");
    // The engine is the only reader of the Studio's offer.
    const offerReads = rig.host.rpcPool.reads.filter((r) => r.endpoint === offerEndpoint(rig.host.userId));
    expect(offerReads.length).toBeGreaterThan(0);
    expect(offerReads.every((r) => r.requester === ENGINE_EXTENSION)).toBe(true);
  });

  test("a revision offer becomes its world's next revision under the world's id, its chats stay on theirs, and Build's unsaved draft blocks it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const before = await rig.rt.runOf(chatId, rig.host.userId);
    if (!before) throw new Error("no run");
    const worldId = before.worldId;
    const read = await studioRead<StudioWorldRead>(rig, worldChannel(rig.host.userId, worldId));
    const next = structuredClone(read.world);
    next.id = "the-studio-draft";
    next.places.pier = { id: "pier", name: "The pier", fields: {} };
    offer(rig, { offerId: "offer-2", doc: doc(next), mode: "revision", worldId, baseRevision: read.revision, attachChatId: chatId, createdAt: 7 });

    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "shed", value: { id: "shed", name: "The shed", fields: {} } }));
    expect(String((await review(rig)).blocked)).toContain("unsaved changes");
    const refused = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-2" });
    expect(refused.type === "lre.error" && refused.code).toBe("conflict");

    rig.body(await rig.send({ type: "lre.editor", op: "discard", worldId, base: null }));
    const reviewed = await review(rig);
    expect([reviewed.blocked, reviewed.target, reviewed.attachChatId]).toEqual([null, { worldId, name: read.name }, chatId]);
    const installed = rig.body(await rig.send({ type: "lre.studio", op: "install", offerId: "offer-2" }));
    if (!isRecord(installed.installed)) throw new Error("not installed");
    expect([installed.installed.worldId, installed.installed.mode, installed.installed.attachChatId]).toEqual([worldId, "revision", chatId]);
    const revision = String(installed.installed.revision);
    expect(revision).not.toBe(before.revision);

    const head = await studioRead<StudioWorldRead>(rig, worldChannel(rig.host.userId, worldId));
    expect([head.revision, head.world.id, Object.keys(head.world.places).includes("pier")]).toEqual([revision, worldId, true]);
    rig.rt.forgetChat(chatId);
    expect((await rig.rt.runOf(chatId, rig.host.userId))?.revision).toBe(before.revision);
    // The player moves the chat onto it with an Upgrade.
    expect(rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: revision })).revision).toBe(revision);
  });

  test("an offer with errors, or that isn't a world, is shown with why and can't be installed", async () => {
    const rig = new Rig();
    offer(rig, { offerId: "offer-3", doc: doc({ ...testWorld(), pov: "nobody" }), mode: "new", createdAt: 1 });
    const broken = await review(rig);
    expect(Number(broken.errors)).toBeGreaterThan(0);
    expect(String(broken.blocked)).toContain("error");
    const refused = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-3" });
    expect(refused.type === "lre.error" && refused.code).toBe("validation");

    offer(rig, { offerId: "offer-4", doc: { format: "something-else", name: "Not a world" }, mode: "new", createdAt: 2 });
    expect(String((await review(rig)).blocked)).toContain("lre-world-v1");
    expect(rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds).toEqual([]);
  });

  test("with nothing offered, Build says so and nothing changes", async () => {
    const rig = new Rig();
    const body = rig.body(await rig.send({ type: "lre.studio", op: "offer" }));
    expect(body.offer).toBeNull();
    expect(String(body.message)).toContain("LumiRPEngine Studio");
    const refused = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-1" });
    expect(refused.type === "lre.error" && refused.code).toBe("not_found");
  });

  test("a revision whose world moved in Build since the Studio took it is flagged, and installs only when the player confirms", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Harbor");
    const taken = await studioRead<StudioWorldRead>(rig, worldChannel(rig.host.userId, worldId));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "shed", value: { id: "shed", name: "The shed", fields: {} } }));
    const moved = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision);
    const next = structuredClone(taken.world);
    next.places.pier = { id: "pier", name: "The pier", fields: {} };
    offer(rig, { offerId: "offer-5", doc: doc(next), mode: "revision", worldId, baseRevision: taken.revision, createdAt: 9 });
    expect((await review(rig)).headMoved).toEqual({ base: taken.revision, head: moved });
    const refused = await rig.send({ type: "lre.studio", op: "install", offerId: "offer-5" });
    expect(refused.type === "lre.error" && refused.code).toBe("conflict");
    const installed = rig.body(await rig.send({ type: "lre.studio", op: "install", offerId: "offer-5", acceptMovedHead: true }));
    if (!isRecord(installed.installed)) throw new Error("not installed");
    expect(installed.installed.worldId).toBe(worldId);
    // An offer taken from the head as it is now isn't flagged.
    offer(rig, { offerId: "offer-6", doc: doc(next), mode: "revision", worldId, baseRevision: String(installed.installed.revision), createdAt: 10 });
    expect((await review(rig)).headMoved).toBeNull();
  });
});
