// Hard locks (DESIGN §11): a typed action that misses a plain requirement plays as plain roleplay,
// and only a requirement its author marks hard vetoes it. The shipped Mystery Manor's study safe
// opens only once its puzzle is solved; Build's Hard lock switch writes a requirement as a hard lock,
// and lint suggests one for a plain requirement that reads like a lock.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { lintWorld } from "../../src/engine/authoring";
import { CheckField } from "../../src/frontend/build/form-kit";
import { COLLECTION_SPECS, type FieldSpec } from "../../src/frontend/build/schema";
import { FieldInput, type FormCtx } from "../../src/frontend/build/schema-form";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import type { ActionDef, Requirement, WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { labelled, press } from "../support/tree";

const INTERPRET_MARK = "You map a player's typed input";
const OPEN_SAFE = "Open the study safe";

/** Plays `text` as the next turn, `interpret` reading it as `read`; what its Outcome told the narrator, and its reply's chips. */
async function turn(rig: Rig, chatId: string, text: string, read: JsonObject): Promise<{ outcome: string; chips: Chip[] }> {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.section("Outcome");
  await rig.host.finish(g, "The house is quiet.");
  const head = rig.host.head(chatId);
  return { outcome, chips: (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id) };
}

/** Whether the story has set flag `name`. */
async function flagged(rig: Rig, chatId: string, name: string): Promise<boolean> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const flags = state?.packs.story?.flags;
  return isRecord(flags) && flags[name] === true;
}

/** A Mystery Manor chat on its start: the entrance hall, Friday late afternoon. */
async function manor(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Harrowmere Hall", "mystery_manor");
  const chatId = rig.host.createChat("Evening.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** The latest reply's chips that say the attempt couldn't, and its roleplay receipts, by label. */
function refused(chips: readonly Chip[]): { couldnt: string[]; roleplay: string[] } {
  return { couldnt: chips.filter((c) => c.kind === "decline").map((c) => c.label), roleplay: chips.filter((c) => c.kind === "untracked").map((c) => c.label) };
}

describe("Mystery Manor's study safe", () => {
  test("opening it before its puzzle is solved fails as the hard lock it is and leaves it shut; once solved, the same words open it", async () => {
    const { rig, chatId } = await manor();
    await turn(rig, chatId, "I walk into the study.", { action: "go", params: { to: "study" } });
    const open = { action: "open_study_safe", params: {} };

    const shut = await turn(rig, chatId, "I open the study safe.", open);
    expect(await flagged(rig, chatId, "safe_open")).toBe(false);
    // The narrator is told the attempt failed, and its chip says it couldn't: it never plays as roleplay.
    expect(shut.outcome.split("\n").filter((line) => line.includes(OPEN_SAFE))).toHaveLength(1);
    expect(shut.chips.filter((c) => c.kind === "decline").map((c) => c.label)).toEqual([expect.stringContaining(OPEN_SAFE)]);
    expect(shut.chips.some((c) => c.kind === "untracked")).toBe(false);

    await turn(rig, chatId, "The code is 1887.", { action: "answer", params: { puzzle: "p_study_safe", answer: "1887" } });
    expect(await flagged(rig, chatId, "safe_open")).toBe(true);
    const opened = await turn(rig, chatId, "I open the study safe.", open);
    expect(opened.chips.some((c) => c.kind === "decline" || c.kind === "untracked")).toBe(false);
    expect(opened.outcome.split("\n").filter((line) => line.includes(OPEN_SAFE))).toHaveLength(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("Mystery Manor's telephone line", () => {
  test("the line is spliced only at the gatehouse, and the constable called only from the hall's telephone: typed anywhere else, each fails as the hard lock it is", async () => {
    const { rig, chatId } = await manor();
    // The storm breaks at 21:30 and the line fails with it.
    rig.body(await rig.send({ type: "lre.fix", chatId, time: "1934-10-26 22:00" }));
    const toGatehouse = { action: "go", params: { to: "gatehouse" } };
    const splice = { action: "splice_line", params: {} };
    await turn(rig, chatId, "I walk down the drive to the gatehouse.", toGatehouse);
    await turn(rig, chatId, "I look over the junction box.", { action: "find_phone_fault", params: {} });
    await turn(rig, chatId, "I walk back up to the hall.", { action: "go", params: { to: "entrance_hall" } });
    const away = await turn(rig, chatId, "I splice the telephone line.", splice);
    expect(await flagged(rig, chatId, "phone_working")).toBe(false);
    expect(refused(away.chips)).toEqual({ couldnt: [expect.stringContaining("Splice")], roleplay: [] });

    await turn(rig, chatId, "I walk down the drive to the gatehouse.", toGatehouse);
    await turn(rig, chatId, "I splice the telephone line.", splice);
    expect(await flagged(rig, chatId, "phone_working")).toBe(true);
    const call = await turn(rig, chatId, "I telephone the constable.", { action: "telephone_constable", params: {} });
    expect(await flagged(rig, chatId, "constable_called")).toBe(false);
    expect(refused(call.chips)).toEqual({ couldnt: [expect.stringContaining("Telephone")], roleplay: [] });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("Mystery Manor's muddy prints", () => {
  test("the floor by the garden door is examined only in the conservatory before it is cleaned: typed anywhere else, it fails as the hard lock it is", async () => {
    const { rig, chatId } = await manor();
    const elsewhere = await turn(rig, chatId, "I examine the floor by the garden door.", { action: "find_muddy_prints", params: {} });
    expect(await flagged(rig, chatId, "clue_muddy_prints")).toBe(false);
    expect(refused(elsewhere.chips)).toEqual({ couldnt: [expect.stringContaining("garden door")], roleplay: [] });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("authoring a hard lock", () => {
  const strongbox = (requirement: Requirement): ActionDef => ({ id: "open_strongbox", label: "Open the strongbox", params: {}, requires: ["at(pov, 'harbor_street_114')", requirement], outcomes: { default: [] }, duration: "1", lexicon: ["open the strongbox"] });

  test("lint suggests a hard lock for a plain requirement that reads like one, never for a story step that hides its action, and Build's Hard lock switch makes it one", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const doc = draft.draft as WorldDoc;
    const suggested = (world: WorldDoc): string[] => lintWorld(world, rig.rt.registry).filter((i) => i.path.startsWith("actions.open_strongbox.")).map((i) => `${i.severity} ${i.path}`);
    // A key the strongbox needs is a lock in all but name: a suggestion, never an error.
    expect(suggested({ ...doc, actions: { ...doc.actions, open_strongbox: strongbox("carries(self, 'shop_office_key')") } })).toEqual(["info actions.open_strongbox.requires.1"]);
    // A story step keeps the strongbox off every list until the story gets there; a hard lock would list it, so nothing is suggested.
    expect(suggested({ ...doc, actions: { ...doc.actions, open_strongbox: strongbox("flag('strongbox_key_found')") } })).toEqual([]);
    // Build's Requirement field: the switch marks it hard, and off again it is the plain formula.
    const spec = COLLECTION_SPECS.actions.find((s): s is Extract<FieldSpec, { kind: "list" }> => s.kind === "list" && s.key === "requires")?.item;
    if (!spec) throw new Error("Build's action editor has no requirement field");
    const ctx: FormCtx = { doc, lint: [], path: "actions.open_strongbox.requires.1", identifiers: [], functions: [] };
    const edited: { value: JsonValue | undefined } = { value: "flag('strongbox_key_found')" };
    const field = () => FieldInput({ spec, value: edited.value, ctx, path: ctx.path, parent: {}, onChange: (next: JsonValue | undefined) => (edited.value = next) });
    press(labelled(field(), CheckField, "Hard lock"), true);
    expect(edited.value).toEqual({ expr: "flag('strongbox_key_found')", hard: true });
    expect(suggested({ ...doc, actions: { ...doc.actions, open_strongbox: strongbox({ expr: "carries(self, 'shop_office_key')", hard: true }) } })).toEqual([]);
    press(labelled(field(), CheckField, "Hard lock"), false);
    expect(edited.value).toBe("flag('strongbox_key_found')");
  });
});
