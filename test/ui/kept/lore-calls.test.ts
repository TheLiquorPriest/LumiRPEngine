// Build's lore and secrecy tools through the kept App (PlanChatUI-B3 item 6): `lre.lore` and `lre.secrecy` reach the typed routes, none goes by the old
// road, a write carries the revision the page read, and one on an entry that changed since is refused as the conflict it is.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keptApp, type ToastSettings } from "../../../src/ui/kept/app";
import { webHost } from "../../../src/ui/kept/host";
import { createStore } from "../../../src/ui/store";
import { handTimers, routeClient } from "./bed";
import { openPage, type Page } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const SETTINGS: ToastSettings = { toastsShown: 3, errorToastMs: 6000, toastMs: 3500 };
const quiet = { follow: () => () => undefined };

describe("Build's lore and secrecy requests", () => {
  test("they reach the typed routes; a stale write is refused and the page reads the book as it stands; the lore index entry says why it is not served", async () => {
    const rpe = routeClient();
    const book = rpe.books.add("Port Alder");
    const key = rpe.books.put(book, { comment: "The key", content: "Helen keeps the spare key under the mat." });
    const kept = keptApp({ client: { ...rpe.client, ...quiet }, chat: createStore<string | null>(null), mode: "build", host: webHost({ revokeMs: () => 1000 }), timers: handTimers(), settings: () => SETTINGS });
    expect((await kept.app.request({ type: "lre.lore", op: "books" }))?.books?.map((b) => b.name)).toEqual(["Port Alder"]);
    const read = (await kept.app.request({ type: "lre.lore", op: "entries", bookId: book }))?.entries ?? [];
    expect(read.map((e) => [e.title, e.revision])).toEqual([["The key", 1]]);
    const made = await kept.app.request({ type: "lre.lore", op: "mark", bookId: book, entryId: key, change: { kind: "secret", knownTo: ["helen"], keptFrom: "everyone" }, revision: read[0]?.revision });
    expect(made?.entries?.[0]).toMatchObject({ whole: true, revision: 2 });
    // The entry changes in Lumiverse; the page still holds revision 2.
    rpe.books.elsewhere(key, { content: "Moved." });
    expect(await kept.app.request({ type: "lre.lore", op: "fields", bookId: book, entryId: key, fields: { links: ["door"] }, revision: 2 })).toBeNull();
    expect(rpe.books.at(key).extensions).toEqual({});
    expect(kept.app.toasts.get().map((t) => t.text).join(" ")).toContain("changed in Lumiverse");
    // A write that names no revision is not one.
    expect(await kept.app.request({ type: "lre.lore", op: "fields", bookId: book, entryId: key, fields: null })).toBeNull();
    expect((await kept.app.request({ type: "lre.secrecy", op: "books" }))?.books?.map((b) => [b.name, b.state])).toEqual([["Port Alder", "legacy"]]);
    expect(await kept.app.request({ type: "lre.lore", op: "index", worldId: "w" })).toBeNull();
    expect(rpe.asked.some((a) => a.key === "POST /api/v1/build")).toBe(false);
    kept.stop();
  });
});
