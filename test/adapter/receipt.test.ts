// The history window as RPE makes it on receipt (STANDALONE-PLAN §4.2; READINGS R-21, R-103), when the
// extension had no answer to cut by: counted over the chat's messages as Lumiverse's own rows hold them,
// so a message Lumiverse joined before the interceptor counts as every row it stands for, a hidden one
// counts as none, and every place is Lumiverse's stored number, gaps and all. And what the receipt tells
// the turn of the prompt: a body it cannot match to the tag's list, a picture the body lacks, and
// Lumiverse's own clipping inside the window. The request is the one the stand-in Lumiverse sends with the
// light extension in it (`test/ext/rig.ts`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { WindowAsk } from "../../src/adapter/lumiverse/answer";
import { createDbReader } from "../../src/adapter/lumiverse/db";
import { createHttpReads } from "../../src/adapter/lumiverse/http-reads";
import { rawLayout } from "../../src/adapter/lumiverse/layout";
import type { Joining } from "../../src/adapter/lumiverse/overlay";
import { promptReads, receive, type ChatRows, type PromptReads } from "../../src/adapter/lumiverse/receipt";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { readTag, type Tag } from "../../src/adapter/lumiverse/wire";
import { historyWindow, WINDOW_DEFAULTS } from "../../src/story/window";
import { FakeClock } from "../standin/clock";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import type { Outcome } from "../standin/lumiverse";
import { PRESET, promptText, Rig, USER } from "../ext/rig";

const label = (i: number): string => `HIST-${String(i).padStart(2, "0")}`;

/** RPE's reads on receipt over the stand-in's own rows: the joining its settings give (the rig's: none), and no message limit. */
const reads = (rows: ChatRows, joining: Joining = { post: "none", collapse: false }): PromptReads => ({ rows, joining: async () => joining, messageLimit: async () => null });

/** The window of `size` over the path the window is asked, as RPE's turn lane counts it. */
const windowOf = (size: number, step: number | null = null) => async (ask: WindowAsk) => historyWindow(await ask.path(), { ...WINDOW_DEFAULTS, size, step }, new Set()).first;

function tagOf(out: Outcome): Tag {
  const read = readTag(out.body);
  if (!("tag" in read)) throw new Error("the request carried no tag");
  return read.tag;
}

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

describe("the window made on receipt", () => {
  test("two queued messages joined into one count as two, and after a delete left a gap the cut on receipt falls on the right message", async () => {
    // The harbor chat: m5 hidden, m10 and m11 the player's two last lines, sent in a row. RPE could not answer the question, so the
    // extension cut nothing; and the player's m1 was deleted before, so Lumiverse's numbers run 0, 2, 3, 4, … (a reply deleted between
    // two of the player's lines would have joined them too).
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    rig.lv.deleteMessage(rig.chat.id, "m1");
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    const tag = tagOf(out);
    expect(tag.cut).toEqual({ answered: false, remembered: null, removed: 0 });
    // What reached the interceptor: m11's words inside m10's message, and m10 at the number Lumiverse stored for it.
    const listed = tag.messages.flatMap((m) => (m.history && m.source ? [m.source] : []));
    expect(listed.map((s) => s.id)).toEqual(["m0", "m2", "m3", "m4", "m6", "m7", "m8", "m9", "m10"]);
    expect(listed.at(-1)).toEqual({ id: "m10", index: 10 });

    // RPE's window of four over the chat's rows: m11 counts beside m10, the hidden m5 and the reply being written not at all.
    const asked: string[][] = [];
    let read = 0;
    const received = await receive(tag, out.body!, {
      user: USER,
      window: async (ask) => {
        const path = await ask.path();
        asked.push(path.map((s) => `${s.id}@${s.index}`));
        return historyWindow(path, { ...WINDOW_DEFAULTS, size: 4 }, new Set()).first;
      },
      reads: reads(async (chat) => {
        read++;
        return rig.lv.rowsOf(chat);
      }),
    }, new AbortController().signal);
    // Nothing is cut from an earlier generation's word: with no answer in the tag, the rows are read once, through RPE's own read.
    expect(read).toBe(1);
    expect(asked).toEqual([["m0@0", "m2@2", "m3@3", "m4@4", "m6@6", "m7@7", "m8@8", "m9@9", "m10@10", "m11@11"]]);
    expect(received.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: null, byRpe: 6, joining: { post: "none", collapse: false, from: "settings" }, told: true, notices: [] });
    // The prompt passed on holds exactly the latest four of the chat's messages: m8, m9, and m10 with m11 inside it.
    const sent = promptText(received.messages);
    for (const i of [8, 9, 10, 11]) expect(sent).toContain(label(i));
    for (const i of [0, 2, 3, 4, 6, 7]) expect(sent).not.toContain(label(i));
  });

  test("a chat whose rows cannot be read is not sent with more history than the window allows, and with the window off it is sent whole", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);
    const asking = receive(tag, out.body!, { user: USER, window: windowOf(4), reads: reads(async () => null) }, new AbortController().signal);
    await expect(asking).rejects.toMatchObject({ name: "Refused", status: 404 });
    // The window off reads no rows for its count, so a chat whose rows cannot be read refuses nothing; Lumiverse's clipping is then not known.
    const off = await receive(tag, out.body!, { user: USER, window: async () => null, reads: reads(async () => null) }, new AbortController().signal);
    expect(off.cut).toMatchObject({ keep: null, byExtension: null, byRpe: 0, clipped: null });
  });

  test("a cut inside a message Lumiverse joined keeps it whole and names its first row (R-202)", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    // A window of one: the latest message is m11, which Lumiverse joined into m10; the cut falls at m10, and m10 with m11 inside it goes.
    const received = await receive(tagOf(out), out.body!, { user: USER, window: windowOf(1), reads: reads(async (chat) => rig.lv.rowsOf(chat)) }, new AbortController().signal);
    expect(received.cut.keep).toEqual({ id: "m10", index: 10 });
    const sent = promptText(received.messages);
    for (const i of [10, 11]) expect(sent).toContain(label(i));
    expect(sent).not.toContain(label(9));
  });

  test("the count on receipt stops where the prompt's history stops, and counts a message the prompt holds that was deleted since", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);
    // Rows past the prompt's newest message that Lumiverse did not join into it (an Edit-and-Send made in place leaves them in the chat).
    const beyond = async (chat: string) => [...rig.lv.rowsOf(chat)!, { id: "m90", index: 90, hidden: false, role: "assistant" as const }, { id: "m91", index: 91, hidden: false, role: "user" as const }];
    expect((await receive(tag, out.body!, { user: USER, window: windowOf(4), reads: reads(beyond) }, new AbortController().signal)).cut.keep).toEqual({ id: "m8", index: 8 });
    // m9 deleted after the prompt was made: the prompt still holds it, so it still counts.
    const deleted = async (chat: string) => rig.lv.rowsOf(chat)!.filter((r) => r.id !== "m9");
    expect((await receive(tag, out.body!, { user: USER, window: windowOf(4), reads: reads(deleted) }, new AbortController().signal)).cut.keep).toEqual({ id: "m8", index: 8 });
  });

  test("after a delete brings the chat to exactly the window and its step and one more, the question's cut and the receipt's both keep the window (R-95)", async () => {
    // A window of 4 with a step of 2 holds 4 to 6; m0 to m3 deleted leave seven counted (m4, m6 to m11; m5 hidden), so both cut back to four.
    const rig = await new Rig({ window: 4, step: 2 }).start();
    for (const id of ["m0", "m1", "m2", "m3"]) rig.lv.deleteMessage(rig.chat.id, id);
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);
    expect(tag.cut).toMatchObject({ answered: true, keep: { id: "m8", index: 8 } });
    const unanswered = { ...tag, cut: { answered: false as const, remembered: null, removed: 0 } };
    const received = await receive(unanswered, out.body!, { user: USER, window: windowOf(4, 2), reads: reads(async (chat) => rig.lv.rowsOf(chat)) }, new AbortController().signal);
    expect(received.cut.keep).toEqual({ id: "m8", index: 8 });
  });

  test("the chat's rows are read through RPE's own read of Lumiverse, from its database file and over HTTP, and the request's signal reaches the read", async () => {
    const db = new StandInDb();
    closing.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Harbor", email: "harbor@example.invalid", username: "harbor" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    const rig = await new Rig({ windowFailsAtQuestion: true, db }).start();
    rig.lv.deleteMessage(rig.chat.id, "m1");
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);

    const database = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
    closing.push(() => database.close());
    const fromFile = await receive(tag, out.body!, { user: USER, window: windowOf(4), reads: promptReads(database) }, new AbortController().signal);
    expect(fromFile.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byRpe: 6, joining: { post: "none", collapse: false, from: "settings" }, clipped: { count: 0, by: null } });

    // Over HTTP as the signed-in user, every read of the chat's messages carries the request's signal; a stopped request ends the read.
    const clock = new FakeClock();
    const server = new LumiverseServer({ clock, db, host: rig.lv, accounts: [{ id: USER, username: "harbor", password: "lantern and salt" }] });
    closing.push(() => server.stop());
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch = (url: string, init: RequestInit): Promise<Response> => {
      if (new URL(url).pathname.endsWith("/messages")) signals.push(init.signal);
      return init.signal?.aborted ? Promise.reject(init.signal.reason) : server.fetch(url, init);
    };
    const session = new LumiverseSession({ base: server.base, fetch, signIn: null, save: async () => undefined, owner: () => USER, clock, log: () => undefined });
    await session.signIn("harbor", "lantern and salt");
    const http = promptReads(createHttpReads(session));
    const going = new AbortController();
    const overHttp = await receive(tag, out.body!, { user: USER, window: windowOf(4), reads: http }, going.signal);
    expect(overHttp.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byRpe: 6 });
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) expect(s).toBe(going.signal);
    const stopped = new AbortController();
    stopped.abort();
    await expect(receive(tag, out.body!, { user: USER, window: windowOf(4), reads: http }, stopped.signal)).rejects.toBeDefined();
  });
});

describe("what the receipt tells the turn of the prompt", () => {
  test("a body that cannot be matched to the tag's list, and a picture the interceptor saw that the body lacks, each give the turn a prompt notice, and nothing is put back", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true, picture: true }).start();
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);
    const rows = reads(async (chat) => rig.lv.rowsOf(chat));
    type Sent = { role: string; content: string | { type: string }[] };

    // Another extension's interceptor after RPE's rewrote the style block: that message matches nothing listed, the rest still does, and
    // the window is still cut.
    const rewritten = structuredClone(out.body!) as { messages: Sent[] };
    const style = rewritten.messages.findIndex((m) => typeof m.content === "string" && m.content.startsWith("STYLE-BLOCK"));
    rewritten.messages[style] = { ...rewritten.messages[style]!, content: "STYLE-BLOCK Write in the past tense." };
    const unmatched = await receive(tag, rewritten, { user: USER, window: windowOf(4), reads: rows }, new AbortController().signal);
    expect(unmatched.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byRpe: 7, told: false, notices: [{ kind: "unmatched", missing: 1 }] });
    const sent = promptText(unmatched.messages);
    expect(sent).toContain("past tense");
    expect(sent).not.toContain("present tense");
    for (const i of [0, 1, 2, 3, 4, 6, 7]) expect(sent).not.toContain(label(i));

    // The picture on the player's message dropped after the interceptor: told, and not put back.
    const bare = structuredClone(out.body!) as { messages: Sent[] };
    const pictured = bare.messages.findIndex((m) => Array.isArray(m.content) && m.content.some((p) => p.type !== "text"));
    expect(pictured).toBeGreaterThanOrEqual(0);
    bare.messages[pictured] = { ...bare.messages[pictured]!, content: (bare.messages[pictured]!.content as { type: string }[]).filter((p) => p.type === "text") };
    const dropped = await receive(tag, bare, { user: USER, window: windowOf(4), reads: rows }, new AbortController().signal);
    expect(dropped.cut).toMatchObject({ told: true, notices: [{ kind: "pictures", dropped: 1 }] });
    expect(dropped.messages.every((m) => m.media === 0)).toBe(true);
  });

  test("a mode whose parts cannot be told apart is listed as unsupported for slicing, and the whole prompt reaches the Author", async () => {
    // Collapse on: the body is one user message; something after the interceptors changed it, so no listed message is found in it.
    const rig = await new Rig({ windowFailsAtQuestion: true, collapse: true }).start();
    const out = await rig.generate("conn-rpe");
    const tag = tagOf(out);
    const body = structuredClone(out.body!) as { messages: { role: string; content: string }[] };
    expect(body.messages).toHaveLength(1);
    body.messages[0] = { ...body.messages[0]!, content: `${body.messages[0]!.content}\n\n(a line added after the interceptors)` };
    const received = await receive(tag, body, { user: USER, window: windowOf(4), reads: reads(async (chat) => rig.lv.rowsOf(chat), { post: "none", collapse: true }) }, new AbortController().signal);
    // The window's seven are still in the one message, and the turn says so; nothing is refused.
    expect(received.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byRpe: 0, told: false, joining: { collapse: true, from: "settings" } });
    expect(received.cut.notices).toEqual([{ kind: "uncut", history: 7 }, { kind: "unmatched", missing: tag.messages.filter((m) => m.blank !== true).length }]);
    expect(received.messages.map((m) => m.content)).toEqual(body.messages.map((m) => m.content));
    const layout = rawLayout(tag, received.messages, received.cut.told, null);
    expect(layout.complete).toBe(false);
    expect(layout.messages.map((m) => m.parts.map((p) => [p.kind, p.start, p.end]))).toEqual([[["unknown", 0, body.messages[0]!.content.length]]]);
  });

  test("with the preset's context size clipping inside a window of 40, the turn records the messages Lumiverse left out", async () => {
    // The prompt as it comes unclipped, to size a context that keeps only its last three history messages.
    const plain = await new Rig({ window: 40 }).start();
    await plain.generate("conn-rpe");
    const whole = plain.turns[0]!.tag;
    // Lumiverse's count with no tokenizer: `role\ntext`, a quarter of its characters, rounded up (`prompt-assembly.service.ts:7373-7376`).
    const tokens = (m: Tag["messages"][number]): number => Math.ceil((m.role.length + 1 + m.length) / 4);
    const fixed = whole.messages.filter((m) => m.history !== true).reduce((n, m) => n + tokens(m), 0);
    const history = whole.messages.filter((m) => m.history === true);
    const lastThree = history.slice(-3).reduce((n, m) => n + tokens(m), 0);
    // The context less one token of reply room and the safety margin of 256 (`:7285-7296`) leaves room for exactly those three.
    const rig = new Rig({ window: 40 });
    rig.lv.presets.get(PRESET.id)!.parameters = { ...PRESET.parameters, max_context_length: 1 + 256 + fixed + lastThree, max_tokens: 1 };
    await rig.start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    const turn = rig.turns[0]!;
    const listed = turn.tag.messages.flatMap((m) => (m.history === true && m.source ? [m.source.id] : []));
    expect(listed).toEqual(["m8", "m9", "m10"]);
    // The window keeps all eleven shown messages (m5 is hidden); the prompt holds m8, m9, and m10 with m11 joined into it.
    expect(turn.cut).toMatchObject({ keep: null, byExtension: 0, byRpe: 0, clipped: { count: 7, by: "context-size" } });
  });
});
