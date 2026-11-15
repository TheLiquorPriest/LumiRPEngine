// The Storage page, read from its view as drawn and from the calls behind it: sizes per chat and per
// area with the levels and the database apart; a chat's largest and most rewritten notes; and the prune
// of a chat's old turn folders, which asks first, says what it took away, and shows RPE's refusal in its
// words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { NO_STORAGE, storageCalls, storageControl, type StorageShown, StorageView, type StorageViewProps } from "../../src/ui/pages/storage";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { askingClient, settle } from "./asking";
import { CHAT } from "./recorded";
import { NOTES, STORAGE } from "./tree-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function view(shown: Partial<StorageShown> = {}, chat: string | null = CHAT) {
  const asked: unknown[] = [];
  const props: StorageViewProps = { chat, shown: { ...NO_STORAGE, storage: STORAGE, notes: NOTES, ...shown }, onChat: (next) => asked.push({ chat: next }), onAsk: (asking) => asked.push({ asking }), onPrune: () => asked.push("prune") };
  const tree = expand(h(StorageView, props));
  return { tree, text: textOf(tree), asked };
}

const section = (tree: unknown, id: string) => elements(tree).find((e) => e.props["data-section"] === id);

describe("the Storage page", () => {
  test("it shows what each chat takes, area by area, and the levels and the database apart", () => {
    const { tree } = view();
    expect(textOf(section(tree, "levels")?.props.children)).toBe("Apart from the chatsYour own level17.8 KBYour global notes, which every chat's agents read0 bytesThe shipped level204.8 KBRPE's database, with its write-ahead log50.0 MB");
    const calder = textOf(elements(tree).find((e) => e.props["data-chat"] === CHAT && e.type === "li")?.props.children);
    expect(calder).toBe("moira-calder-point-0f3a9c21chat-calder3.3 MBnotes 40.2 KB · turn folders 3.0 MB · sessions 172.4 KB · other files 4.1 KB");
    // Another chat offers its own notes and pruning.
    const shown = view();
    press(elements(shown.tree).find((e) => e.props["data-chat"] === "chat-harbour" && e.type === "li"), "Its notes, and pruning");
    expect(shown.asked).toEqual([{ chat: "chat-harbour" }]);
  });

  test("for a chat: its largest notes and those agents rewrote most; pruning asks first, then says what it took away, or RPE's refusal in its words", () => {
    const { tree, asked } = view();
    const largest = textOf(elements(tree).find((e) => e.props["data-notes"] === "largest")?.props.children);
    expect(largest).toBe("The largest notespersistent-workspace/moira.md3 writes in turns23.5 KBpersistent-workspace/ledger.md19 writes in turns12.5 KB");
    const rewritten = textOf(elements(tree).find((e) => e.props["data-notes"] === "rewritten")?.props.children);
    expect(rewritten.indexOf("ledger.md")).toBeLessThan(rewritten.indexOf("moira.md"));
    press(tree, "Prune old turn folders");
    const asking = view({ asking: true });
    expect(asking.text).toContain("Prune the old turn folders of moira-calder-point-0f3a9c21?");
    press(asking.tree, "Prune them");
    press(asking.tree, "Keep them");
    expect([...asked, ...asking.asked]).toEqual([{ asking: true }, "prune", { asking: false }]);
    expect(view({ pruned: { folders: 4, files: 36, bytes: 2_097_152 } }).text).toContain("Pruned 4 turn folders: 36 files, 2.0 MB.");
    expect(banners(view({ refusal: "A turn of this chat is going on: prune once it is over." }).tree)).toEqual([{ title: "RPE did not prune them", text: "RPE did not prune themA turn of this chat is going on: prune once it is over." }]);
    // With no chat chosen, no chat's notes or prune show.
    expect(section(view({}, null).tree, "chat")).toBeUndefined();
  });

  test("each control calls its route: the sizes and the chat's notes at once, the prune with the chat, and both read again after it", async () => {
    const { client, asked } = askingClient();
    const states: StorageShown[] = [];
    const control = storageControl(storageCalls(client), CHAT, (s) => states.push(s));
    expect(asked.map((a) => [a.key, a.query ?? null])).toEqual([
      ["GET /api/v1/storage", null],
      ["GET /api/v1/storage/notes", { chat: CHAT }],
    ]);
    asked[0]?.answer(STORAGE);
    asked[1]?.answer(NOTES);
    await settle();
    expect(states.at(-1)).toMatchObject({ storage: STORAGE, notes: NOTES });
    control.ask(true);
    control.prune();
    expect(asked[2]).toMatchObject({ key: "POST /api/v1/files-prune", body: { chat: CHAT } });
    asked[2]?.answer({ pruned: { folders: 4, files: 36, bytes: 2_097_152 } });
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: false, asking: false, pruned: { folders: 4, files: 36, bytes: 2_097_152 } });
    expect(asked.slice(3).map((a) => a.key)).toEqual(["GET /api/v1/storage", "GET /api/v1/storage/notes"]);
    control.ask(true);
    control.prune();
    asked[5]?.fail(new Error("A turn of this chat is going on: prune once it is over."));
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: false, refusal: "A turn of this chat is going on: prune once it is over.", pruned: null });
    // With no chat chosen only the sizes are read; the page keeps its chat in the address.
    const alone = askingClient();
    storageControl(storageCalls(alone.client), null, () => undefined);
    expect(alone.asked.map((a) => a.key)).toEqual(["GET /api/v1/storage"]);
    expect(routeOfHash(hashOf({ page: "storage", chat: CHAT }))).toEqual({ page: "storage", chat: CHAT });
    expect(routeOfHash(hashOf({ page: "storage", chat: null }))).toEqual({ page: "storage", chat: null });
  });
});
