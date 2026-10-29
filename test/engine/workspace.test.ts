// The chat's workspace (DESIGN §4.4): its files' index and pins fold purely from `engine.ws.*`
// events, and follow swipes, Re-runs and branches as every other event of a turn does.

import { describe, expect, test } from "bun:test";
import type { ChatId } from "../../src/shared/ids";
import type { LedgerEvent } from "../../src/shared/ledger";
import { blobHash } from "../../src/shared/stores";
import { applyEvent, validateEvent } from "../../src/engine/events";
import type { TurnModel } from "../../src/engine/ledger/journal";
import type { WorldState } from "../../src/engine/state";
import { WS_DELETE, WS_PIN, WS_WRITE, workspaceOf, workspacePins, workspaceRefs, wsDelete, wsPin, wsWrite } from "../../src/engine/workspace";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";
import { Harness } from "../support/harness";
import { testModel } from "../support/test-pack";

const reg = registryOf();
const world = baseWorld();
const start = startState(world, reg);

const INN = blobHash("The inn's back door sticks.");
const INN_AGAIN = blobHash("The inn's back door is fixed.");
const DEV = blobHash("Dev keeps the bar.");

function refusal(state: Readonly<WorldState>, e: LedgerEvent): string | null {
  return validateEvent(reg, e, reg.context(world, state as WorldState))?.code ?? null;
}

describe("the workspace's events", () => {
  test("a write adds or replaces a file, a delete removes it", () => {
    const written = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV)]);
    expect(workspaceOf(written)).toEqual({ "notes/inn.md": INN, "notes/dev.md": DEV });
    const replaced = fold(reg, world, written, [wsWrite("notes/inn.md", INN_AGAIN), wsWrite("notes/dev.md", DEV)]);
    expect(workspaceOf(replaced)).toEqual({ "notes/inn.md": INN_AGAIN, "notes/dev.md": DEV });
    const deleted = fold(reg, world, replaced, [wsDelete("notes/dev.md")]);
    expect(workspaceOf(deleted)).toEqual({ "notes/inn.md": INN_AGAIN });
  });

  test("a bad path, a bad hash and a delete of a file the workspace lacks are refused", () => {
    for (const path of ["", "/notes.md", "notes//inn.md", "../inn.md", "notes/./inn.md", "notes/inn.md/", "two  spaces.md", 7]) {
      expect(refusal(start, { type: WS_WRITE, data: { path, hash: INN } })).toBe("bad_event");
      expect(refusal(start, { type: WS_DELETE, data: { path } })).toBe("bad_event");
    }
    for (const hash of ["", INN.toUpperCase(), INN.slice(1), `${INN}0`, null]) expect(refusal(start, { type: WS_WRITE, data: { path: "notes/inn.md", hash } })).toBe("bad_event");
    expect(refusal(start, wsDelete("notes/inn.md"))).toBe("missing_file");
    const written = fold(reg, world, start, [wsWrite("notes/inn.md", INN)]);
    expect(refusal(written, wsDelete("notes/dev.md"))).toBe("missing_file");
    expect(refusal(written, wsDelete("notes/inn.md"))).toBeNull();
  });

  test("the same events from the same start fold to the same workspace, and never change a state another shares", () => {
    const events = [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsDelete("notes/inn.md")];
    expect(fold(reg, world, start, events)).toEqual(fold(reg, world, start, events));
    const one = fold(reg, world, start, [wsWrite("notes/inn.md", INN)]);
    // A shallow copy, as a snapshot and the state folded on from it share their slices.
    const shared: WorldState = { ...one, packs: { ...one.packs, engine: { ...one.packs.engine } } };
    for (const e of [wsWrite("notes/dev.md", DEV), wsDelete("notes/inn.md")]) applyEvent(reg, e, shared, reg.context(world, shared));
    expect(workspaceOf(one)).toEqual({ "notes/inn.md": INN });
    expect(workspaceOf(shared)).toEqual({ "notes/dev.md": DEV });
  });

  test("a state no workspace event touched holds no workspace", () => {
    expect(start.packs.engine === undefined || !Object.hasOwn(start.packs.engine, "ws")).toBe(true);
    const other = fold(reg, world, start, [{ type: "engine.note", data: { text: "A note" } }]);
    expect(other.packs.engine === undefined || !Object.hasOwn(other.packs.engine, "ws")).toBe(true);
    expect(workspaceOf(other)).toEqual({});
  });

  test("the player's Journal has no line for a workspace change; the GM's does", () => {
    const state = fold(reg, world, start, [wsWrite("notes/inn.md", INN)]);
    const ctx = reg.context(world, state);
    for (const e of [wsWrite("notes/inn.md", INN), wsDelete("notes/inn.md")]) {
      const def = reg.get(e.type);
      expect(def?.describe(e, ctx, POV)).toBe("");
      expect(def?.describe(e, ctx)).not.toBe("");
    }
  });

  test("the blobs a record's writes name are found among raw events, junk ignored", () => {
    const raw: unknown[] = [wsWrite("notes/inn.md", INN), wsDelete("notes/inn.md"), null, 7, "x", [], { type: WS_WRITE }, { type: WS_WRITE, data: { hash: "nope" } }, { type: WS_WRITE, data: { path: "notes/dev.md", hash: DEV } }, { type: "set", data: { hash: INN_AGAIN } }];
    expect(workspaceRefs(raw)).toEqual([INN, DEV]);
  });

  test("a pin folds into the pins and an unpin takes it out", () => {
    const written = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV)]);
    const pinned = fold(reg, world, written, [wsPin("notes/inn.md", true), wsPin("notes/dev.md", true)]);
    expect(workspacePins(pinned)).toEqual({ "notes/inn.md": true, "notes/dev.md": true });
    const unpinned = fold(reg, world, pinned, [wsPin("notes/inn.md", false)]);
    expect(workspacePins(unpinned)).toEqual({ "notes/dev.md": true });
    expect(workspaceOf(unpinned)).toEqual({ "notes/inn.md": INN, "notes/dev.md": DEV });
  });

  test("a pin of a file the workspace lacks, a bad path and a pin that is neither on nor off are refused", () => {
    expect(refusal(start, wsPin("notes/inn.md", true))).toBe("missing_file");
    const written = fold(reg, world, start, [wsWrite("notes/inn.md", INN)]);
    expect(refusal(written, wsPin("notes/dev.md", true))).toBe("missing_file");
    expect(refusal(written, wsPin("notes/inn.md", true))).toBeNull();
    for (const path of ["", "/notes.md", "../inn.md", 7]) expect(refusal(written, { type: WS_PIN, data: { path, pinned: true } })).toBe("bad_event");
    for (const pinned of ["yes", 1, null]) expect(refusal(written, { type: WS_PIN, data: { path: "notes/inn.md", pinned } })).toBe("bad_event");
    expect(refusal(written, { type: WS_PIN, data: { path: "notes/inn.md" } })).toBe("bad_event");
  });

  test("a delete takes the file's pin with it", () => {
    const pinned = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsPin("notes/inn.md", true), wsPin("notes/dev.md", true)]);
    const deleted = fold(reg, world, pinned, [wsDelete("notes/inn.md")]);
    expect(workspacePins(deleted)).toEqual({ "notes/dev.md": true });
    // Written again at the same path, the file comes back unpinned.
    expect(workspacePins(fold(reg, world, deleted, [wsWrite("notes/inn.md", INN)]))).toEqual({ "notes/dev.md": true });
  });

  test("a state no pin event touched holds no pins, and a delete in a chat that never pinned makes none", () => {
    const noPins = (s: WorldState): boolean => s.packs.engine === undefined || !Object.hasOwn(s.packs.engine, "wsPins");
    expect(noPins(start)).toBe(true);
    const written = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV)]);
    expect(noPins(written)).toBe(true);
    const deleted = fold(reg, world, written, [wsDelete("notes/inn.md")]);
    expect(noPins(deleted)).toBe(true);
    expect(workspacePins(deleted)).toEqual({});
  });

  test("the player's Journal has no line for a pin; the GM's says pinned or unpinned", () => {
    const state = fold(reg, world, start, [wsWrite("notes/inn.md", INN)]);
    const ctx = reg.context(world, state);
    const def = reg.get(WS_PIN);
    expect(def?.describe(wsPin("notes/inn.md", true), ctx, POV)).toBe("");
    expect(def?.describe(wsPin("notes/inn.md", false), ctx, POV)).toBe("");
    expect(def?.describe(wsPin("notes/inn.md", true), ctx)).toBe("workspace file notes/inn.md pinned");
    expect(def?.describe(wsPin("notes/inn.md", false), ctx)).toBe("workspace file notes/inn.md unpinned");
  });

  test("the same pins from the same start fold to the same state, and never change a state another shares", () => {
    const events = [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsPin("notes/inn.md", true), wsPin("notes/dev.md", true), wsDelete("notes/inn.md")];
    expect(fold(reg, world, start, events)).toEqual(fold(reg, world, start, events));
    const one = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsPin("notes/inn.md", true)]);
    // A shallow copy, as a snapshot and the state folded on from it share their slices.
    const shared: WorldState = { ...one, packs: { ...one.packs, engine: { ...one.packs.engine } } };
    for (const e of [wsPin("notes/dev.md", true), wsDelete("notes/inn.md")]) applyEvent(reg, e, shared, reg.context(world, shared));
    expect(workspacePins(one)).toEqual({ "notes/inn.md": true });
    expect(workspacePins(shared)).toEqual({ "notes/dev.md": true });
  });
});

/** The test model, with a note written for each `note:<name>` turn; its body follows the turn's seed, so a Re-run writes it anew. */
const noteModel: TurnModel = {
  plan: (input) => {
    const [verb, name] = (input.userTexts.at(-1) ?? "").split(":");
    const events = testModel.plan(input);
    return verb === "note" && name ? [...events, wsWrite(`notes/${name}.md`, blobHash(`${name} ${input.seed}`))] : events;
  },
  read: (input) => testModel.read(input),
};

/** The chat's workspace at its head, after checking every fold agrees on it. */
async function workspace(h: Harness, chatId: ChatId): Promise<Record<string, string>> {
  const { reference, optimized, cold } = await h.folds(chatId);
  expect(workspaceOf(reference.state)).toEqual(workspaceOf(optimized.state));
  expect(workspaceOf(cold.state)).toEqual(workspaceOf(optimized.state));
  expect(reference.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
  return workspaceOf(optimized.state);
}

describe("the workspace in a chat", () => {
  test("follows turns, GM writes, Re-runs, swipes and branches", async () => {
    const h = new Harness("fresh", { model: noteModel });
    const chat = await h.newChat();
    await h.send(chat, "note:inn");
    const first = h.host.head(chat)?.id ?? "";
    await h.send(chat, "note:dev");
    const head = h.host.head(chat);
    if (!first || !head) throw new Error("no turns");
    const planned = await workspace(h, chat);
    expect(Object.keys(planned).sort()).toEqual(["notes/dev.md", "notes/inn.md"]);

    // A swipe made before the GM's write.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay.");
    const plot = blobHash("The vault opens at dusk.");
    expect((await h.write(chat, { kind: "post", id: "plot", target: "head", entry: { kind: "fix", gm: true, events: [wsWrite("gm/plot.md", plot)] } })).applied).toBe(true);
    expect((await workspace(h, chat))["gm/plot.md"]).toBe(plot);

    // A Re-run plans its turn's note again and carries the GM's file.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay.");
    const rerun = h.host.message(chat, head.id).swipeId;
    const after = await workspace(h, chat);
    expect(after["gm/plot.md"]).toBe(plot);
    expect(after["notes/inn.md"]).toBe(planned["notes/inn.md"]);
    expect(after["notes/dev.md"]).toBeDefined();
    expect(after["notes/dev.md"]).not.toBe(planned["notes/dev.md"]);

    // The first swipe, made before the GM's write, never had its file; back on the Re-run, it is there again.
    h.host.navigate(chat, head.id, 0);
    await h.host.settle();
    expect(await workspace(h, chat)).toEqual(planned);
    h.host.navigate(chat, head.id, rerun);
    await h.host.settle();
    expect(await workspace(h, chat)).toEqual(after);

    // A branch at the first turn holds its note and none written after it.
    const branch = h.host.branch(chat, first);
    await h.service.open(branch, h.host.userId);
    await h.host.settle();
    expect(await workspace(h, branch)).toEqual({ "notes/inn.md": planned["notes/inn.md"] });
    await h.send(branch, "note:cellar");
    expect(Object.keys(await workspace(h, branch)).sort()).toEqual(["notes/cellar.md", "notes/inn.md"]);
    expect(await workspace(h, chat)).toEqual(after);
  });
});
