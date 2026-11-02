// Build → Lore's lore index (DESIGN §4.2): the index of the world's books as `lre.lore index` reads it
// on Port Alder, each book with its count and the text an index entry would hold; Build an index entry
// waits for a book to be picked and writes nothing until it is pressed; once built, the section says
// which entry LumiRPEngine keeps in sync and points to Settings → Lore to stop it, also when the entry
// is another world's. And the browser preview answers the same two requests.

import { afterEach, describe, expect, test, vi } from "bun:test";
import { MockBackend } from "../../dev/preview/mock-backend";
import { LoreIndexBody, type LoreIndexProps } from "../../src/frontend/build/lore-editor";
import { Banner, Button, HostSelect, ListRow } from "../../src/frontend/components";
import type { HostBookEntryInput } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { LoreBookView, LoreIndexView } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { labelled, press, propsOf, type Props } from "../support/tree";

const BUILD = "Build an index entry";
const LIGHT = "The old lighthouse stands dark on the breakwater.";

const entry = (comment: string, content: string, keys: string[]): HostBookEntryInput => ({ comment, content, keys, disabled: false, constant: false, extensions: {} });

/** Port Alder, with a book of the user's its chat reads (one entry) and an empty one to write the index into. */
async function alder() {
  const rig = new Rig({ shipped: true });
  const user = rig.host.userId;
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const bookId = await rig.host.books.create("Harbor notes", "", user);
  await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: [bookId] } }));
  const target = await rig.host.books.create("Index", "", user);
  const books = rig.body(await rig.send({ type: "lre.lore", op: "books" })).books as LoreBookView[];
  return { rig, user, worldId, bookId, target, books };
}

/** The section as Build lays it out; Build's press and the settings button are counted. */
function section(over: Partial<LoreIndexProps> & Pick<LoreIndexProps, "worldId" | "view" | "books">, pressed: { build: number; settings: number; picked: string | null }): unknown {
  return LoreIndexBody({ target: "", pickTarget: (id) => void (pressed.picked = id), build: () => void (pressed.build += 1), openSettings: () => void (pressed.settings += 1), busy: false, ...over });
}

function button(tree: unknown, text: string): Props {
  // A banner's buttons are its actions.
  const found = [...propsOf(tree, Button), ...propsOf(propsOf(tree, Banner).map((b) => b.actions), Button)].filter((p) => p.children === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons reading ${text}`);
  return found[0] ?? {};
}

function click(props: Props): void {
  if (typeof props.onClick !== "function") throw new Error("not a button");
  props.onClick();
}

/** All the text a tree holds, joined. */
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isRecord(node) && isRecord(node.props) ? textOf(node.props.children) : "";
}

describe("Build → Lore's lore index", () => {
  test("shows each book's count and the entry's text, and builds only on the press, into the book picked", async () => {
    const { rig, user, worldId, bookId, target, books } = await alder();
    const view = rig.body(await rig.send({ type: "lre.lore", op: "index", worldId })).index as LoreIndexView;
    expect(view.books).toEqual([{ id: bookId, name: "Harbor notes", entries: 1 }]);
    expect(view.text).toContain("lre0001 Lighthouse");
    expect(view.built).toBeNull();

    const pressed = { build: 0, settings: 0, picked: null as string | null };
    const fresh = section({ worldId, view, books }, pressed);
    expect(textOf(fresh)).toContain(view.text);
    expect(propsOf(fresh, ListRow).map((p) => [p.title, p.value])).toEqual([["Harbor notes", "1 entry"]]);
    // No book picked: Build waits.
    expect(button(fresh, BUILD).disabled).toBe(true);
    const picker = labelled(fresh, HostSelect, "Book to write the index entry into");
    expect((picker.options as { value: string }[]).map((o) => o.value)).toEqual(books.map((b) => b.id));
    press(picker, target);
    expect(pressed.picked).toBe(target);
    // Picking writes nothing.
    expect(await rig.host.books.entries(target, user)).toEqual([]);

    const ready = section({ worldId, view, books, target }, pressed);
    expect(button(ready, BUILD).disabled).toBe(false);
    click(button(ready, BUILD));
    expect(pressed.build).toBe(1);
    // What the press sends, through the real backend.
    const after = rig.body(await rig.send({ type: "lre.lore", op: "build", worldId, bookId: target })).index as LoreIndexView;
    expect(after.built).toMatchObject({ bookId: target, worldId, book: "Index" });
    expect((await rig.host.books.entries(target, user)).map((e) => e.content)).toEqual([after.text]);

    const kept = section({ worldId, view: after, books, target }, pressed);
    expect(propsOf(kept, HostSelect)).toEqual([]);
    expect(propsOf(kept, Button)).toEqual([]);
    const banner = textOf(propsOf(kept, Banner).map((p) => p.children));
    expect(banner).toContain(`Index has this index as entry ${after.built?.entryId}`);
    expect(banner).toContain("Stop it in Settings → Lore");
    click(button(kept, "Open Settings → Lore"));
    expect(pressed.settings).toBe(1);

    // A second build is refused while one is kept.
    expect((await rig.send({ type: "lre.lore", op: "build", worldId, bookId })).type).toBe("lre.error");
  }, 60_000);

  test("an entry kept for another world says so, with no Build until it is stopped", () => {
    const view: LoreIndexView = { text: "LORE INDEX", books: [], built: { bookId: "b", entryId: "e", worldId: "elsewhere", book: "Index" } };
    const pressed = { build: 0, settings: 0, picked: null };
    const tree = section({ worldId: "alder", view, books: [] }, pressed);
    expect(propsOf(tree, Button)).toEqual([]);
    button(tree, "Open Settings → Lore");
    expect(textOf(propsOf(tree, Banner).map((p) => p.children))).toContain("for another world (elsewhere)");
  });
});

describe("the browser preview's lore index", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("answers index and build as the backend does: the built entry once, Stop in Settings lets it go", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const backend = new MockBackend((payload) => sent.push(payload), { scenario: "play", closeDrawer: () => {} });
    const ask = (reqId: string, message: JsonObject): JsonObject => {
      backend.receive({ lre: 1, reqId, ...message } as never);
      vi.advanceTimersByTime(100);
      const answer = sent.find((m): m is JsonObject => isRecord(m) && m.reqId === reqId);
      if (!answer) throw new Error(`no answer to ${reqId}`);
      return answer;
    };
    /** The index a preview answer carries; the preview answers `lre.lore` with `ResultBodies["lre.lore"]`, so its `index` is a `LoreIndexView`. */
    const viewOf = (answer: JsonObject): LoreIndexView => {
      const body = answer.body;
      if (answer.type !== "lre.result" || !isRecord(body) || !isRecord(body.index)) throw new Error(`no index in ${JSON.stringify(answer)}`);
      const view: unknown = body.index;
      return view as LoreIndexView;
    };
    const view = viewOf(ask("i1", { type: "lre.lore", op: "index", worldId: "w" }));
    expect(view.built).toBeNull();
    expect(view.books.map((b) => b.name)).toEqual(["Town lore"]);
    expect(view.text).toContain("lre0001");
    expect(viewOf(ask("b1", { type: "lre.lore", op: "build", worldId: "w", bookId: "book_harbor" })).built).toMatchObject({ bookId: "book_harbor", worldId: "w", book: "Harbor notes" });
    expect(ask("b2", { type: "lre.lore", op: "build", worldId: "w", bookId: "book_town" }).type).toBe("lre.error");
    ask("s1", { type: "lre.settings.set", patch: { loreIndex: { built: null } } });
    expect(viewOf(ask("i2", { type: "lre.lore", op: "index", worldId: "w" })).built).toBeNull();
  });
});
