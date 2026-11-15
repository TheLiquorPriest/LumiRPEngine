// The history window as RPE makes it on receipt (STANDALONE-PLAN §4.2; READINGS R-21, R-103), when the
// extension had no answer to cut by: counted over the chat's messages as Lumiverse's own rows hold them,
// so a message Lumiverse joined before the interceptor counts as every row it stands for, a hidden one
// counts as none, and every place is Lumiverse's stored number, gaps and all. The request is the one the
// stand-in Lumiverse sends with the light extension in it (`test/ext/rig.ts`). Every name is invented.

import { describe, expect, test } from "bun:test";
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
    const received = await receive(tag, out.body!, {
      user: USER,
      window: async (ask) => {
        asked.push(ask.path.map((s) => `${s.id}@${s.index}`));
        return historyWindow(ask.path, { ...WINDOW_DEFAULTS, size: 4 }, new Set()).first;
      },
      rows: async (chat) => rig.lv.rowsOf(chat),
    }, new AbortController().signal);
    expect(asked).toEqual([["m0@0", "m2@2", "m3@3", "m4@4", "m6@6", "m7@7", "m8@8", "m9@9", "m10@10", "m11@11"]]);
    expect(received.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: null, remembered: false, byRpe: 6 });
    // The prompt passed on holds exactly the latest four of the chat's messages: m8, m9, and m10 with m11 inside it.
    const sent = promptText(received.messages);
    for (const i of [8, 9, 10, 11]) expect(sent).toContain(label(i));
    for (const i of [0, 2, 3, 4, 6, 7]) expect(sent).not.toContain(label(i));
  });

  test("a chat whose rows cannot be read is not sent with more history than the window allows", async () => {
    const rig = await new Rig({ windowFailsAtQuestion: true }).start();
    const out = await rig.generate("conn-rpe");
    const read = readTag(out.body);
    if (!("tag" in read)) throw new Error("the request carried no tag");
    const asking = receive(read.tag, out.body!, { user: USER, window: async () => null, rows: async () => null }, new AbortController().signal);
    await expect(asking).rejects.toMatchObject({ name: "Refused", status: 404 });
  });
});
