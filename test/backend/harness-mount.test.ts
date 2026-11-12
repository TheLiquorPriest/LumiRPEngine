// LumiAH's backend mounted in the engine (`backend/harness/mount.ts`) on LumiAH's own terms: the
// runtime's copy of a chat is told that the engine keeps LumiAH's records in the chat's ledger and
// gives it no lore, reads the records from the ledger and is told when they change; a runtime with
// no connection of its own plays no turn and says so; an agent's connection the runtime doesn't have
// runs on its default; with no runtime linked, what reaches LumiAH's workspace says so in LumiAH's
// own words; a timeout of an ask names its wait where the engine shows LumiAH's Settings, as
// Settings → Timeouts says; and the engine's asks take Lumiverse's proxy to the runtime once
// `cors_proxy` is granted, and the link without it, with the same answers. With LumiAH's real
// backend and its runtime linked (`support/runtime-bed.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { preparePage } from "../../src/backend/story/prepare";
import { RUNTIME_WAITS } from "../../src/frontend/settings/timeouts";
import { isRecord } from "../../src/shared/json";
import { cast, lumiahBed, offers } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import type { RuntimeBed } from "../support/runtime-bed";
import { noModelCalls, recordOn } from "./harness-driver";
import { alderWorld, calls, chatOn, release, say, worldChat } from "./harness-e2e-kit";

const opened: { close(): void }[] = [];
afterEach(() => {
  for (const one of opened.splice(0)) one.close();
});

/** What the engine says while the runtime has no connection to call a model on. */
const NO_CONNECTION = "LumiRPEngine's runtime has no connection to call a model on, so its agents can't play this chat. Add one on the Runtime page of the Harness tab, under Connections.";

/** LumiAH's words for an ask no runtime of the user's is linked to answer. */
const NONE_LINKED = "LumiRPEngine needs its runtime for this, and none is linked now. Start it (its line is on LumiRPEngine's Runtime page) and try again.";

/** Where the engine shows LumiAH's Settings, as the mount tells LumiAH and LumiAH tells the runtime. */
const SETTINGS_AT = "LumiRPEngine's Harness tab → System → Settings";

/** LumiAH's words for an ask its runtime didn't answer within the Runtime wait, set to a second: the wait by its name, where it is changed. */
const TIMED_OUT = `The runtime didn't answer within 1 second. It may be busy or restarting: try again in a moment. Runtime wait (${SETTINGS_AT} → Timeouts → Waiting for the runtime) says how long a page waits for it.`;

/** What the engine asks of LumiAH's workspace and jobs, as the timing log names each ask. */
const ENGINE_ASKS = ["workspace.write", "workspace.read", "workspace.list", "jobs.list"];

/** The runtime's answers to asks stop reaching the backend: whatever is asked of it from now on waits for an answer that never comes. */
function unanswering(bed: RuntimeBed): void {
  const deliver = bed.deliver;
  bed.deliver = (payload, session) => {
    if (!(isRecord(payload) && payload.type === "ask.answer")) deliver(payload, session);
  };
}

describe("LumiAH mounted in the engine", () => {
  test("the runtime's copy is told the engine keeps LumiAH's records in the chat's ledger and gives it no lore: it reads a chat's records from the ledger, is told each time they change, and is given no lore", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    const hello = bed.received.find((frame) => isRecord(frame) && frame.type === "result" && isRecord(frame.body) && isRecord(frame.body.copy));
    expect(isRecord(hello) && isRecord(hello.body) ? hello.body.copy : null).toMatchObject({ identifier: "lumi_rp_engine", ownElsewhere: true, declinesLore: true, records: { under: null } });

    const told = (): number => bed.received.filter((frame) => isRecord(frame) && frame.type === "own" && frame.chat === chatId).length;
    const before = told();
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), release("Five quiet minutes pass."), "Released."] }).script;
    const turn = await say(bed, rig, chatId, "I sit a while.");
    const replyId = turn.generation.messageId ?? "";
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, "the turn's record");
    await bed.until(() => told() > before, "the runtime told the chat's records changed");

    // The records as the copy reads them are the ledger's, in the form LumiAH's own entry has.
    const record = recHarnessOf(await recordOn(rig, chatId, replyId))?.record;
    if (record === undefined) throw new Error("the turn's record holds no record of LumiAH's");
    const read = await bed.runtime.link.request("own.read", { chat: chatId }, 5_000);
    expect(read.entries).toEqual({ [replyId]: { v: 1, swipes: { [String(rig.host.message(chatId, replyId).swipeId)]: record } } });

    // A change in the chat is told as well.
    const after = told();
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser)?.id ?? "";
    rig.host.editMessage(chatId, said, "I sit a long while.");
    await bed.until(() => told() > after, "the edit told");
    // No lore, whatever the copy asks of the engine's host.
    expect(await bed.runtime.link.request("host.read", { port: "lore", method: "global", args: [] }, 5_000)).toEqual({ value: [] });
    noModelCalls(rig);
  });

  test("a runtime with no connection of its own plays no turn: the Engine page and the stopped reply say so and where to add one; with one again, the turn plays", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    const blocked = async (): Promise<unknown> => rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked;
    expect(await blocked()).toBeUndefined();
    await bed.page("lah.connections.remove", { id: bed.connection });
    expect(await blocked()).toBe(NO_CONNECTION);
    const stopped = await say(bed, rig, chatId, "I wait.");
    expect([stopped.generation.halted, stopped.content]).toEqual(["cancelled", ""]);
    expect((await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.kind === "engine_failed")?.detail).toContain(NO_CONNECTION);
    expect(bed.calls).toEqual([]);

    await bed.page("lah.connections.save", { connection: { name: "Main", provider: "openai", auth: "key", model: "test-model" }, key: "sk-bed-made-up-0123456789abcdef" });
    expect(await blocked()).toBeUndefined();
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: [release("The street below is quiet."), "Released."] }).script;
    expect((await bed.reply(chatId)).content).toBe("The street below is quiet.");
    noModelCalls(rig);
  });

  test("a connection Settings → Story → Models names that the runtime doesn't have refuses nothing: the agent runs on the runtime's default", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { story: { models: { default: { connectionId: "conn-lumiverse-only" } } } } }));
    expect((await rig.rt.settings.get(rig.host.userId)).story.models.default.connectionId).toBe("conn-lumiverse-only");
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked).toBeUndefined();
    const play = cast({ name: "author", is: offers("reply_write"), lines: [release("The kettle ticks as it warms."), "Released."] });
    bed.script = play.script;
    const replied = await say(bed, rig, chatId, "I wait for the kettle.");
    expect([replied.error, replied.content]).toEqual([null, "The kettle ticks as it warms."]);
    expect(play.calls("author").map((request) => request.connectionId)).toEqual([bed.connection, bed.connection]);
    noModelCalls(rig);
  });

  test("with no runtime linked, the workspace the engine's tools reach and the story's preparation say so in LumiAH's words", async () => {
    const rig = new Rig({ shipped: true });
    const bed = lumiahBed(rig);
    opened.push(bed);
    const chatId = await chatOn(rig, await alderWorld(rig));
    const at = { chatId, userId: rig.host.userId };
    const files = rig.rt.harness.files?.(at);
    if (files === undefined) throw new Error("the mount gave the engine no workspace");
    // What a tool that reads or lists the workspace is answered with: LumiAH's words, which say what to do.
    expect(files.read("author/notebook.md")).rejects.toThrow(NONE_LINKED);
    expect(files.list("")).rejects.toThrow(NONE_LINKED);
    expect(await files.write("author/notebook.md", "A note.", null)).toEqual({ refused: { code: "unavailable", reason: NONE_LINKED, version: null } });
    // The preparation's page says the same where its card would be.
    expect(JSON.stringify(await preparePage(rig.rt, at, { op: "get" }))).toContain(NONE_LINKED);
  });

  test("an ask the runtime doesn't answer in time names the wait that ran out where the engine shows LumiAH's Settings, as Settings → Timeouts says; the runtime is told the same place for its own", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    // Who the runtime is linked to, as its hello's answer tells it: its own timeouts name the same place.
    const hello = bed.received.find((frame) => isRecord(frame) && frame.type === "result" && isRecord(frame.body) && isRecord(frame.body.backend));
    expect(isRecord(hello) && isRecord(hello.body) ? hello.body.backend : null).toEqual({ name: "LumiRPEngine", connection: "LumiRPEngine", settingsAt: SETTINGS_AT });

    // Runtime wait at its shortest, as a player sets it on LumiAH's Timeouts page; then the runtime answers no ask.
    await bed.page("lah.settings.set", { set: [{ path: ["transport", "pages", "askMs"], value: 1_000 }], reset: [] });
    unanswering(bed);
    const at = { chatId, userId: rig.host.userId };
    const files = rig.rt.harness.files?.(at);
    if (files === undefined) throw new Error("the mount gave the engine no workspace");
    // What a tool that reads the workspace is answered with, which the agent is told; the preparation's page shows the same where its card would be.
    await expect(files.read("author/notebook.md")).rejects.toThrow(TIMED_OUT);
    expect(JSON.stringify(await preparePage(rig.rt, at, { op: "get" }))).toContain(TIMED_OUT);
    // Settings → Timeouts' own line quotes the wait as these words name it.
    const named = /Runtime wait \([^)]*\)/.exec(TIMED_OUT)?.[0] ?? "";
    expect(RUNTIME_WAITS).toContain(`“${named}”`);
    expect(RUNTIME_WAITS).toContain(`${SETTINGS_AT} → Timeouts`);
    noModelCalls(rig);
  });

  test("the engine's asks (a tool's write, read and listing of a workspace file; the preparation's page reading its state) take Lumiverse's proxy to the runtime once cors_proxy is granted, and the link without it, with the same answers", async () => {
    /** The same asks in a new chat of a new bed, with the permission granted or not: what each answered, and every ask the engine made meanwhile, by the road it took and how it ended, as the timing log keeps it. */
    const asked = async (granted: boolean) => {
      const { bed, rig, chatId } = await worldChat();
      opened.push(bed);
      const userId = rig.host.userId;
      const [relay] = await bed.backend.relays.linked(userId);
      if (relay === undefined) throw new Error("no runtime linked");
      if (granted) {
        // Granted while the engine runs, as an owner grants it in Lumiverse: the road is proved before it is taken.
        bed.permit("cors_proxy", true);
        await bed.until(async () => (await bed.backend.road.open(userId, relay.id)) !== null, "the road to the runtime proved");
      }
      const { runtime } = await bed.page<{ runtime: { road: { granted: boolean; relays: Record<string, { road: string }> } } }>("lah.hello", { active: null });
      const at = { chatId, userId };
      const files = rig.rt.harness.files?.(at);
      if (files === undefined) throw new Error("the mount gave the engine no workspace");
      const from = bed.backend.timings.all().length;
      const written = await files.write("notes/ferry.md", "The ferry leaves at six.", null);
      const read = await files.read("notes/ferry.md");
      const listed = await files.list("notes/");
      const page = await preparePage(rig.rt, at, { op: "get" });
      const roads = bed.backend.timings
        .all()
        .slice(from)
        .map((row) => ({ op: row.op, road: row.road, outcome: row.outcome }));
      noModelCalls(rig);
      return { answers: { written, read, listed, page }, roads, page: { granted: runtime.road.granted, road: runtime.road.relays[relay.id]?.road } };
    };
    const link = await asked(false);
    const proxy = await asked(true);
    // The same answers either way, and real ones: the file as written, and the page's offer to prepare the story.
    expect(proxy.answers).toEqual(link.answers);
    expect(link.answers.read).toEqual({ path: "notes/ferry.md", text: "The ferry leaves at six.", version: "version" in link.answers.written ? link.answers.written.version : "" });
    expect(link.answers.listed.map((file) => file.path)).toEqual(["notes/ferry.md"]);
    expect(link.answers.page.offer).not.toBeNull();
    // Each of those asks was answered over the link without the permission, and through the proxy with it; so was every other the engine made meanwhile (a read of a file that isn't there is refused as not found, on either road).
    for (const { roads, road } of [
      { roads: link.roads, road: "link" },
      { roads: proxy.roads, road: "proxy" },
    ]) {
      expect(ENGINE_ASKS.filter((op) => !roads.some((row) => row.op === op && row.outcome === "ok"))).toEqual([]);
      expect(roads.filter((row) => row.road !== road || (row.outcome !== "ok" && row.outcome !== "refused"))).toEqual([]);
    }
    // And the Runtime page says which road the runtime's requests take.
    expect([link.page, proxy.page]).toEqual([
      { granted: false, road: "link" },
      { granted: true, road: "proxy" },
    ]);
  });
});
