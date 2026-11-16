// The Storage page: each kind with how long it is kept and the setting that decides it, chats read a page at a
// time, and a prune told first: the dry run says what would go, and the prune takes exactly that plan.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { StorageKindsReply, StoragePruneReply, StorageReply } from "../../../src/shared/api";
import { NO_STORAGE, StorageView, type StorageViewProps, storageCalls, storageControl, type StorageShown } from "../../../src/ui/pages/storage";
import { askingClient, settle } from "../asking";
import { expand, press, textOf } from "../vnodes";

const KINDS: StorageKindsReply = { kinds: [{ kind: "turn-folders", count: 50, bytes: 4_000_000, oldest: Date.UTC(2026, 9, 1), kept: { by: "setting", setting: "retention.turnFolders", value: 50 } }, { kind: "notes", count: 3, bytes: 900, oldest: null, kept: { by: "chat" } }], lastPrune: null };
const CHATS = (names: string[], next: string | null): StorageReply => ({ chats: names.map((n) => ({ chat: n, folder: `${n}-f`, bytes: 1000, areas: { notes: 1, turns: 2, sessions: 3, files: 4 }, rows: 500, measured: 1 })), next, global: 10, globalNotes: 1, shipped: 20, database: 30, rest: 5 });
const PLAN: StoragePruneReply = { plan: "plan-1", removed: false, files: 12, bytes: 3_000_000, items: [{ kind: "turn-folder", path: "turns/0001", files: 12, bytes: 3_000_000 }] };

function view(shown: Partial<StorageShown>) {
  const calls: string[] = [];
  const props: StorageViewProps = { shown: { ...NO_STORAGE, ...shown }, onSetting: (k) => void calls.push(`setting:${k}`), onMore: () => void calls.push("more"), onNotes: (c) => void calls.push(`notes:${c}`), onOpenFile: (c, p) => void calls.push(`file:${c}:${p}`), onPrune: (a) => void calls.push(`prune:${a.what}`), onConfirm: () => void calls.push("confirm"), onDismiss: () => void calls.push("dismiss") };
  const tree = expand(h(StorageView, props));
  return { tree, text: textOf(tree), calls };
}

describe("the Storage page", () => {
  test("turn folders show 50 kept whole with a link to retention.turnFolders, and their oldest", () => {
    const page = view({ kinds: KINDS });
    expect(page.text).toContain("Turn folders kept whole");
    expect(page.text).toContain("50 items");
    expect(page.text).toContain("the newest 50 kept by");
    press(page.tree, "retention.turnFolders");
    expect(page.calls).toEqual(["setting:retention.turnFolders"]);
  });

  test("chats are read a page at a time, each with what it takes in the database", async () => {
    const { client, asked } = askingClient();
    let last: StorageShown = NO_STORAGE;
    const control = storageControl(storageCalls(client), () => 2, (s) => (last = s));
    const first = asked.find((a) => a.key === "GET /api/v1/storage");
    expect(first).toMatchObject({ query: { limit: 2 } });
    first?.answer(CHATS(["a", "b"], "b"));
    await settle();
    expect(last.more).toBe(true);
    control.more();
    const second = asked.filter((a) => a.key === "GET /api/v1/storage").at(-1);
    expect(second).toMatchObject({ query: { limit: 2, after: "b" } });
    second?.answer(CHATS(["c"], null));
    await settle();
    expect(last.chats?.chats.map((c) => c.chat)).toEqual(["a", "b", "c"]);
    expect(last.more).toBe(false);
    expect(view({ chats: last.chats }).text).toContain("500 bytes of the database");
    control.stop();
  });

  test("a prune says first what goes, then takes exactly that plan", async () => {
    const { client, asked } = askingClient();
    let last: StorageShown = NO_STORAGE;
    const control = storageControl(storageCalls(client), () => 50, (s) => (last = s));
    control.ask({ what: "turns", chat: "a" }, "Old turn folders of a-f");
    const dry = asked.filter((a) => a.key === "POST /api/v1/storage-prune").at(-1);
    expect(dry?.body).toEqual({ what: "turns", chat: "a" });
    dry?.answer(PLAN);
    await settle();
    const question = view({ prune: last.prune });
    expect(question.text).toContain("This would take 12 files");
    expect(question.text).toContain("turns/0001");
    control.confirm();
    const real = asked.filter((a) => a.key === "POST /api/v1/storage-prune").at(-1);
    expect(real?.body).toEqual({ what: "turns", chat: "a", plan: "plan-1" });
    real?.answer({ ...PLAN, removed: true });
    await settle();
    expect(view({ prune: last.prune }).text).toContain("It took 12 files");
    control.stop();
  });
});
