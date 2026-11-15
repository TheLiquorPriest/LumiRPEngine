// The history window as RPE makes it on receipt (STANDALONE-PLAN §4.2; READINGS R-21, R-103), when the
// extension had no answer to cut by: counted over the chat's messages as Lumiverse's own rows hold them,
// so a message Lumiverse joined before the interceptor counts as every row it stands for, a hidden one
// counts as none, and every place is Lumiverse's stored number, gaps and all. The request is the one the
// stand-in Lumiverse sends with the light extension in it (`test/ext/rig.ts`). Every name is invented.

import { describe, expect, test } from "bun:test";
import type { WindowAsk } from "../../src/adapter/lumiverse/answer";
import { receive } from "../../src/adapter/lumiverse/receipt";
import { readTag } from "../../src/adapter/lumiverse/wire";
import { historyWindow, WINDOW_DEFAULTS } from "../../src/story/window";
import { promptText, Rig, USER } from "../ext/rig";

const label = (i: number): string => `HIST-${String(i).padStart(2, "0")}`;

describe("the window made on receipt", () => {
  test("two queued messages joined into one count as two, and after a delete left a gap the cut on receipt falls on the right message", async () => {
    // The harbor chat: m5 hidden, m10 and m11 the player's two last lines, sent in a row. RPE could not answer the question, so the
    // extension cut nothing; and the player's m1 was deleted before, so Lumiverse's numbers run 0, 2, 3, 4, … (a reply deleted between
    // two of the player's lines would have joined them too).
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    rig.lv.deleteMessage(rig.chat.id, "m1");
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    const tag = read.tag;
    expect(tag.cut).toEqual({ answered: false, remembered: null, removed: 0 });
    // What reached the interceptor: m11's words inside m10's message, and m10 at the number Lumiverse stored for it.
    const listed = tag.messages.flatMap((m) => (m.history && m.source ? [m.source] : []));
    expect(listed.map((s) => s.id)).toEqual(["m0", "m2", "m3", "m4", "m6", "m7", "m8", "m9", "m10"]);
    expect(listed.at(-1)).toEqual({ id: "m10", index: 10 });

    // RPE's window of four over the chat's rows: m11 counts beside m10, the hidden m5 and the reply being written not at all.
    const asked: string[][] = [];
    let reads = 0;
    const received = await receive(tag, out.body!, {
      user: USER,
      window: async (ask) => {
        const path = await ask.path();
        asked.push(path.map((s) => `${s.id}@${s.index}`));
        return historyWindow(path, { ...WINDOW_DEFAULTS, size: 4 }, new Set()).first;
      },
      rows: async (chat) => {
        reads++;
        return rig.lv.rowsOf(chat);
      },
    }, new AbortController().signal);
    // Nothing is cut from an earlier generation's word: with no answer in the tag, the rows are read once, through RPE's own read.
    expect(reads).toBe(1);
    expect(asked).toEqual([["m0@0", "m2@2", "m3@3", "m4@4", "m6@6", "m7@7", "m8@8", "m9@9", "m10@10", "m11@11"]]);
    expect(received.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: null, byRpe: 6 });
    // The prompt passed on holds exactly the latest four of the chat's messages: m8, m9, and m10 with m11 inside it.
    const sent = promptText(received.messages);
    for (const i of [8, 9, 10, 11]) expect(sent).toContain(label(i));
    for (const i of [0, 2, 3, 4, 6, 7]) expect(sent).not.toContain(label(i));
  });

  test("a chat whose rows cannot be read is not sent with more history than the window allows, and with the window off it is sent whole", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    const counted = async (ask: WindowAsk) => historyWindow(await ask.path(), { ...WINDOW_DEFAULTS, size: 4 }, new Set()).first;
    const asking = receive(read.tag, out.body!, { user: USER, window: counted, rows: async () => null }, new AbortController().signal);
    await expect(asking).rejects.toMatchObject({ name: "Refused", status: 404 });
    // The window off reads no rows, so a chat whose rows cannot be read refuses nothing.
    const off = await receive(read.tag, out.body!, { user: USER, window: async () => null, rows: async () => null }, new AbortController().signal);
    expect(off.cut).toEqual({ keep: null, byExtension: null, byRpe: 0 });
  });

  test("a cut inside a message Lumiverse joined keeps it whole and names its first row (R-202)", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    // A window of one: the latest message is m11, which Lumiverse joined into m10; the cut falls at m10, and m10 with m11 inside it goes.
    const one = async (ask: WindowAsk) => historyWindow(await ask.path(), { ...WINDOW_DEFAULTS, size: 1 }, new Set()).first;
    const received = await receive(read.tag, out.body!, { user: USER, window: one, rows: async (chat) => rig.lv.rowsOf(chat) }, new AbortController().signal);
    expect(received.cut.keep).toEqual({ id: "m10", index: 10 });
    const sent = promptText(received.messages);
    for (const i of [10, 11]) expect(sent).toContain(label(i));
    expect(sent).not.toContain(label(9));
  });

  test("the count on receipt stops where the prompt's history stops, and counts a message the prompt holds that was deleted since", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    const four = async (ask: WindowAsk) => historyWindow(await ask.path(), { ...WINDOW_DEFAULTS, size: 4 }, new Set()).first;
    // Rows past the prompt's newest message that Lumiverse did not join into it (an Edit-and-Send made in place leaves them in the chat).
    const beyond = async (chat: string) => [...rig.lv.rowsOf(chat)!, { id: "m90", index: 90, hidden: false, role: "assistant" as const }, { id: "m91", index: 91, hidden: false, role: "user" as const }];
    expect((await receive(read.tag, out.body!, { user: USER, window: four, rows: beyond }, new AbortController().signal)).cut.keep).toEqual({ id: "m8", index: 8 });
    // m9 deleted after the prompt was made: the prompt still holds it, so it still counts.
    const deleted = async (chat: string) => rig.lv.rowsOf(chat)!.filter((r) => r.id !== "m9");
    expect((await receive(read.tag, out.body!, { user: USER, window: four, rows: deleted }, new AbortController().signal)).cut.keep).toEqual({ id: "m8", index: 8 });
  });

  test("after a delete brings the chat to exactly the window and its step and one more, the question's cut and the receipt's both keep the window (R-95)", async () => {
    // A window of 4 with a step of 2 holds 4 to 6; m0 to m3 deleted leave seven counted (m4, m6 to m11; m5 hidden), so both cut back to four.
    const rig = await new Rig({ window: 4, step: 2 }).start();
    for (const id of ["m0", "m1", "m2", "m3"]) rig.lv.deleteMessage(rig.chat.id, id);
    const out = await rig.generate("conn-rpe");
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    expect(read.tag.cut).toMatchObject({ answered: true, keep: { id: "m8", index: 8 } });
    const stepped = async (ask: WindowAsk) => historyWindow(await ask.path(), { ...WINDOW_DEFAULTS, size: 4, step: 2 }, new Set()).first;
    const unanswered = { ...read.tag, cut: { answered: false as const, remembered: null, removed: 0 } };
    const received = await receive(unanswered, out.body!, { user: USER, window: stepped, rows: async (chat) => rig.lv.rowsOf(chat) }, new AbortController().signal);
    expect(received.cut.keep).toEqual({ id: "m8", index: 8 });
  });
});
