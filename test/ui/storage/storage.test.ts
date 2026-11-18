// The Storage page: each kind with how long it is kept and the setting that decides it, chats read a page at a
// time, and a prune told first: the dry run says what would go, and the prune takes exactly that plan.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { SettingView, StorageKindsReply, StoragePruneReply, StorageReply } from "../../../src/shared/api";
import { NO_STORAGE, StorageView, type StorageViewProps, storageCalls, storageControl, type StorageShown } from "../../../src/ui/pages/storage";
import { askingClient, settle } from "../asking";
import { expand, press, textOf } from "../vnodes";

const KINDS: StorageKindsReply = { kinds: [{ kind: "turn-folders", name: "Turn folders kept whole", count: 50, bytes: 4_000_000, oldest: Date.UTC(2026, 9, 1), kept: { by: "setting", setting: "retention.turnFolders", value: 50 } }, { kind: "notes", name: "Agents' notes", count: 3, bytes: 900, oldest: null, kept: { by: "chat" } }], lastPrune: null };
const CHATS = (names: string[], next: string | null): StorageReply => ({ chats: names.map((n) => ({ chat: n, folder: `${n}-f`, bytes: 1000, areas: { notes: 1, turns: 2, sessions: 3, files: 4 }, rows: 500, measured: 1 })), next, global: 10, globalNotes: 1, shipped: 20, database: 30, rest: 5 });
const PLAN: StoragePruneReply = { plan: "plan-1", removed: false, files: 12, bytes: 3_000_000, items: [{ kind: "turn-folder", path: "turns/0001", files: 12, bytes: 3_000_000 }] };

/** The two settings the kinds name, as the Settings page's route gives them: a name, and what no value means. */
const SETTINGS = new Map<string, SettingView>([
  ["retention.turnFolders", { key: "retention.turnFolders", name: "Turn folders kept whole", unit: null, none: null, unset: null } as unknown as SettingView],
  ["notes.versionsKept", { key: "notes.versionsKept", name: "Turns back note versions are kept", unit: null, none: "all of them", unset: null } as unknown as SettingView],
]);

function view(shown: Partial<StorageShown>) {
  const calls: string[] = [];
  const props: StorageViewProps = { shown: { ...NO_STORAGE, ...shown }, settings: SETTINGS, onSetting: (k) => void calls.push(`setting:${k}`), onMore: () => void calls.push("more"), onNotes: (c) => void calls.push(`notes:${c}`), onOpenFile: (c, p) => void calls.push(`file:${c}:${p}`), onPrune: (a) => void calls.push(`prune:${a.what}`), onConfirm: () => void calls.push("confirm"), onDismiss: () => void calls.push("dismiss"), onAskBackup: () => void calls.push("backup"), onMakeBackup: () => void calls.push("make"), onDismissBackup: () => void calls.push("no-backup") };
  const tree = expand(h(StorageView, props));
  return { tree, text: textOf(tree), calls };
}

describe("the Storage page", () => {
  test("a kind a setting decides names the setting and says its value as it reads now: the turn folders' 50, and the note versions' none as the setting words it", () => {
    const page = view({ kinds: KINDS });
    expect(page.text).toContain("Turn folders kept whole");
    expect(page.text).toContain("50 items");
    expect(page.text).toContain("kept as Turn folders kept whole says: 50");
    press(page.tree, "Turn folders kept whole");
    expect(page.calls).toEqual(["setting:retention.turnFolders"]);
    const versions = view({ kinds: { kinds: [{ kind: "note-versions", name: "Versions of notes", count: 4, bytes: 90, oldest: null, kept: { by: "setting", setting: "notes.versionsKept", value: null } }], lastPrune: null } });
    expect(versions.text).toContain("kept as Turns back note versions are kept says: all of them");
    expect(view({ kinds: { kinds: [{ kind: "note-versions", name: "Versions of notes", count: 4, bytes: 90, oldest: null, kept: { by: "setting", setting: "notes.versionsKept", value: 2 } }], lastPrune: null } }).text).toContain("says: 2");
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

  test("the three things the page describes each have a press, and each says first what it would take or make, with a count and a size", async () => {
    const chat = CHATS(["a"], null).chats;
    const buttons = textOf(view({ chats: { ...CHATS(["a"], null), chats: chat } }).tree);
    expect(buttons).toContain("Prune note versions past what is kept");
    expect(buttons).toContain("Prune decided suggestions past what is kept");
    expect(buttons).toContain("Make a backup now");
    const { client, asked } = askingClient();
    let last: StorageShown = NO_STORAGE;
    const control = storageControl(storageCalls(client), () => 50, (s) => (last = s));
    control.ask({ what: "versions", chat: "a" }, "Note versions of a-f past how far back they are kept");
    asked.filter((a) => a.key === "POST /api/v1/storage-prune").at(-1)?.answer({ plan: "p-2", removed: false, files: 7, bytes: 2_048, items: [{ kind: "note-versions", path: "note versions of a", files: 7, bytes: 2_048 }] });
    await settle();
    const question = view({ prune: last.prune }).text;
    expect(question).toContain("This would take 7 note versions, 2.0 KB");
    expect(question).toContain("Note versions past how far back they are kept · 7 note versions");
    control.askBackup();
    asked.find((a) => a.key === "GET /api/v1/backups/next")?.answer({ name: "rpe-backup-20261117T120000Z.tar", database: 5_000_000, files: 40, bytes: 120_000, skipped: [] });
    await settle();
    expect(view({ making: last.making }).text).toContain("This would make one archive, rpe-backup-20261117T120000Z.tar, in the backups folder: the database (up to");
    expect(view({ making: last.making }).text).toContain("40 files of the tree");
    control.makeBackup();
    asked.find((a) => a.key === "POST /api/v1/backups")?.answer({ name: "rpe-backup-20261117T120000Z.tar", bytes: 4_000_000, files: 40, sha256: "ab", skipped: [] });
    await settle();
    expect(view({ making: last.making }).text).toContain("Made rpe-backup-20261117T120000Z.tar in the backups folder");
    control.stop();
  });
});
