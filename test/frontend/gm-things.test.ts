// GM → Things (ITEMS-SPEC §10.2, §7.5, §6.2, lane G) on Port Alder, its pages walked as rendered
// trees (no DOM), as Build's Things tests do, from what the engine reads of a chat starting: Here
// (in the room, lying here, on the people here with why each has what they have), Tidy up's cards
// (Fix and the choices, Leave it and Bring it back, Ask the Curator, Show N left, findings per run),
// Keep in the world's list, the GM thing page, the bulk bar and + Add a thing, each control's one GM
// edit with the sentence its notice says; a person's outfits and loadouts on their GM page; and GM →
// This chat → Things, the chat's own Tidy up switch over the world's.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { migrateWorld } from "../../src/engine/authoring";
import { buildGmWorld } from "../../src/engine/gm-view";
import { createRegistry } from "../../src/engine/registry-impl";
import { gmThingExtras, gmThingsList } from "../../src/engine/thing-gm";
import { tidyFindings, tidyRun } from "../../src/engine/thing-tidy";
import { buildContext, thingPage, thingPicks, thingsList, thingTypes } from "../../src/engine/thing-view";
import { buildClasses, HoldsSection, ThingRowView } from "../../src/frontend/build/things";
import { AddPicker, RefPicker } from "../../src/frontend/build/form-kit";
import { Button, Disclosure, HostSwitch, ListRow, NumberStepper, Section } from "../../src/frontend/components";
import { thingsSummary, tidyRequest, TidySwitch } from "../../src/frontend/gm/chat-things";
import type { Editor } from "../../src/frontend/gm/editor";
import { FieldRow, Relations } from "../../src/frontend/gm/entity";
import { addEdit, allWorn, bulkEdit, bulkLoans, GmAddSheet, GmSets, gmSets, GmThingBody, HereView, KeepList, ThingsBulkBar, TidyCard, TidyList, hereSections, isThingKind, keepKey, type BulkSheet, type GmThingBodyProps, type ThingSheet } from "../../src/frontend/gm/things";
import type { Selection } from "../../src/frontend/multi-select";
import { ActionRow, GmCard } from "../../src/frontend/gm/ui";
import type { AddDraft } from "../../src/frontend/things/add-thing";
import { AddThingSheet } from "../../src/frontend/things/add-thing";
import { typesOfKind } from "../../src/frontend/things/what-it-is";
import type { EditOp } from "../../src/shared/protocol";
import type { GmEntity, GmView } from "../../src/shared/state-view";
import type { MadeInPlay, TidyFinding } from "../../src/shared/thing-gm";
import { DEFAULT_CURRENCY, type WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { piecesLine, SetRows } from "../../src/packs/gear/ui/sets-sheet";
import { expand, labelled, press, type Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const portAlder = migrateWorld(await Bun.file(new URL("../../src/packs/starters/modern_slice_of_life.json", import.meta.url)).json());

function ctxOf(world: WorldDoc = portAlder) {
  const ctx = buildContext(reg, world);
  if (!ctx) throw new Error("the world can't start a chat");
  return ctx;
}

/** Port Alder with Jordan's phone lying at home while it is still on him, as an older build could leave it. */
function splitPhone(): WorldDoc {
  const world = structuredClone(portAlder);
  const phone = world.entities.pov_phone;
  if (!phone) throw new Error("no phone");
  phone.fields.place = "harbor_street_114";
  return world;
}

/** Every element anywhere in a rendered tree, under its children and every other prop that holds elements (a row's actions, a card's badges). */
function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  return [v, ...Object.values(v.props).flatMap(elements)];
}

/** The props of every element of `type` anywhere in a rendered tree. */
function find(node: unknown, type: unknown): Props[] {
  return elements(node)
    .filter((v) => v.type === type)
    .map((v) => v.props);
}

/** The words a rendered tree shows under its children, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Presses the one button showing `text`. */
function click(tree: unknown, text: string): void {
  const found = find(tree, Button).filter((p) => textOf(p.children) === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons say ${text}`);
  (found[0]?.onClick as () => void)();
}

/** The GM view of a chat starting on `world`, and an editor that keeps what it is asked to send. */
function editorOf(world: WorldDoc = portAlder): { gm: GmView; editor: Editor; sent: { ops: EditOp[]; done?: string }[] } {
  const ctx = ctxOf(world);
  const gm: GmView = { ...buildGmWorld(reg, world, ctx.state), edits: [], refused: [], held: [], minds: {} as GmView["minds"] };
  const sent: { ops: EditOp[]; done?: string }[] = [];
  const editor: Editor = {
    gm,
    currency: DEFAULT_CURRENCY,
    busy: false,
    edit: (ops, done) => {
      sent.push({ ops, ...(done !== undefined ? { done } : {}) });
      return Promise.resolve(true);
    },
  };
  return { gm, editor, sent };
}

describe("Here", () => {
  const ctx = ctxOf();
  const list = thingsList(ctx);
  const here = gmThingsList(ctx);

  test("where the player character is: the room's furniture and vehicles, what lies there, and the people there", () => {
    expect(here.here).toBe("harbor_street_114");
    const sections = hereSections(list.rows, "harbor_street_114");
    const home = sections[0];
    // Headed from where Jordan is inward, not from the county.
    expect(home?.path.map((s) => s.id)).toEqual(["harbor_street_114"]);
    expect(home?.room.map((n) => ("thing" in n ? n.thing.id : n.holder.id))).toContain("pov_truck");
    expect(home?.lying.some((n) => "thing" in n && n.thing.id === "pov_truck")).toBe(false);
    expect(home?.people.map((p) => p.holder.id)).toContain("pov");
    // Nothing of another place: the toolbox lies at Alder Automotive.
    expect(sections.flatMap((s) => [...s.room, ...s.lying]).some((n) => "thing" in n && n.thing.id === "pov_toolbox")).toBe(false);
  });

  test("each person there with Open, each thing on them with why they have it", () => {
    let person = "";
    const tree = HereView({ sections: hereSections(list.rows, "harbor_street_114"), why: here.why, open: new Set(), onToggle: () => undefined, onOpen: () => undefined, onPerson: (id) => (person = id) });
    const text = textOf(tree);
    expect(text).toContain("In the room");
    expect(text).toContain("On the people here");
    expect(text).toContain("On Jordan Ellis");
    (find(tree, Button).find((p) => p.label === "Open Jordan Ellis's sheet")?.onClick as () => void)();
    expect(person).toBe("pov");
    // The rows of what is on Jordan, one level down: each with why he has it.
    const jordan = elements(tree).find((v) => Array.isArray(v.props.nodes) && v.props.why !== undefined && (v.props.nodes as { thing?: { id: string } }[]).some((n) => n.thing?.id === "pov_keys"));
    if (!jordan) throw new Error("no rows on Jordan");
    const keys = find(expand(jordan), ThingRowView).find((p) => (p.row as { id: string }).id === "pov_keys");
    expect(keys?.sub).toBe("Theirs");
  });
});

describe("Tidy up's cards", () => {
  const ctx = ctxOf(splitPhone());
  const findings = tidyFindings(ctx, []);
  const phone = findings.find((f) => f.key === "two_places:pov_phone");
  if (!phone) throw new Error("no finding");
  const names = new Map([["pov_phone", "Phone"]]);

  test("a card: its sentence, Fix and the other fix, Open, Leave it and Ask the Curator", () => {
    const calls: unknown[][] = [];
    const card = TidyCard({ finding: phone, names, busy: false, onFix: (fix) => calls.push(["fix", fix.label]), onLeave: (left) => calls.push(["leave", left]), onAsk: () => calls.push(["ask"]), onOpen: (id) => calls.push(["open", id]) });
    expect(find(card, GmCard)[0]?.title).toBe("In two places at once");
    expect(textOf(card)).toContain("Phone lies at 114 Harbor Street and is on Jordan Ellis at once; play reads it at 114 Harbor Street.");
    for (const text of ["Keep it at 114 Harbor Street", "Keep it on Jordan Ellis", "Phone", "Leave it", "Ask the Curator"]) click(card, text);
    expect(calls).toEqual([["fix", "Keep it at 114 Harbor Street"], ["fix", "Keep it on Jordan Ellis"], ["open", "pov_phone"], ["leave", true], ["ask"]]);
  });

  test("a run: its count, findings per run, and Show N left, each left card with Bring it back and no Fix", () => {
    const calls: unknown[][] = [];
    const props = { names, busy: false, onFix: (fix: { label: string }) => calls.push(["fix", fix.label]), onLeave: (f: TidyFinding, left: boolean) => calls.push(["leave", f.key, left]), onAsk: (f: TidyFinding) => calls.push(["ask", f.key]), onShowLeft: (show: boolean) => calls.push(["show", show]), onLimit: (n: number) => calls.push(["limit", n]), onOpen: (id: string) => calls.push(["open", id]) };
    const all = TidyList({ ...props, run: tidyRun(findings, new Set(), 50), showLeft: false });
    expect(find(all, Section)[0]?.title).toBe(findings.length === 1 ? "1 finding" : `${findings.length} findings`);
    const stepper = find(all, NumberStepper)[0];
    expect(stepper).toMatchObject({ label: "Findings per run", value: 50, min: 1, max: 500 });
    (stepper?.onChange as (n: number) => void)(10);
    expect(calls).toEqual([["limit", 10]]);

    const run = tidyRun(findings, new Set([phone.key]), 50);
    const folded = TidyList({ ...props, run, showLeft: false });
    expect(find(folded, TidyCard).some((p) => (p.finding as TidyFinding).key === phone.key)).toBe(false);
    click(folded, "Show 1 left");
    const shown = TidyList({ ...props, run, showLeft: true });
    const left = find(shown, TidyCard).find((p) => (p.finding as TidyFinding).key === phone.key);
    expect(left?.left).toBe(true);
    const card = TidyCard(left as Parameters<typeof TidyCard>[0]);
    expect(find(card, Button).find((p) => textOf(p.children) === "Keep it at 114 Harbor Street")?.disabled).toBe(true);
    click(card, "Bring it back");
    expect(calls.slice(1)).toEqual([["show", true], ["leave", phone.key, false]]);
  });
});

describe("Keep in the world's list", () => {
  const path = [
    { id: "port_alder", name: "Port Alder", is: "place" as const },
    { id: "harbor_street_114", name: "114 Harbor Street", is: "place" as const },
  ];
  const made: MadeInPlay = {
    places: [{ id: "place_garage_1", name: "Garage", path, as: "room", inDraft: false }],
    things: [
      { id: "thing_workbench_1", name: "Workbench", where: [...path, { id: "place_garage_1", name: "Garage", is: "place" }], inDraft: false },
      { id: "thing_lamp_1", name: "Lamp", where: path, inDraft: true },
    ],
  };

  test("places and things to pick, one the draft has already held back, and Keep with how many", () => {
    const picks: unknown[][] = [];
    let kept = 0;
    const tree = KeepList({ made, picked: new Set([keepKey("place", "place_garage_1")]), kept: null, names: new Map(), busy: false, onPick: (key, on) => picks.push([key, on]), onKeep: () => kept++ });
    const rows = find(tree, ListRow);
    expect(rows.map((p) => [p.title, p.subtitle, p.disabled])).toEqual([
      ["Garage", "A room in Port Alder › 114 Harbor Street", false],
      ["Workbench", "At Garage", false],
      ["Lamp", "At 114 Harbor Street · in the world's draft already", true],
    ]);
    for (const row of rows.slice(0, 2)) (row.onClick as () => void)();
    expect(picks).toEqual([
      ["place:place_garage_1", false],
      ["thing:thing_workbench_1", true],
    ]);
    click(tree, "Keep 1 in the world");
    expect(kept).toBe(1);
  });

  test("what Keep did: kept, skipped with why, and what a kept thing lost on the way", () => {
    const tree = KeepList({ made, picked: new Set(), kept: { things: ["thing_workbench_1"], places: ["place_garage_1"], skipped: [{ id: "place_shelf_1", reason: "Corner shelf: it is in Garage, which was made in play too: keep it as well" }], notes: ["Workbench: its owner Sam isn't in the world, so it is kept as nobody's."] }, names: new Map([["thing_workbench_1", "Workbench"], ["place_garage_1", "Garage"]]), busy: false, onPick: () => undefined, onKeep: () => undefined });
    const text = textOf(tree);
    expect(text).toContain("Garage, Workbench");
    expect(text).toContain("Corner shelf: it is in Garage, which was made in play too: keep it as well");
    expect(text).toContain("Workbench: its owner Sam isn't in the world, so it is kept as nobody's.");
    expect(find(tree, Button).find((p) => textOf(p.children) === "Keep in the world")?.disabled).toBe(true);
  });
});

describe("the GM thing page", () => {
  const ctx = ctxOf();
  const page = thingPage(ctx, "pov_toolbox");
  if (!page) throw new Error("no toolbox");
  const pick = thingPicks(ctx);
  const extras = gmThingExtras(reg, ctx, [], "pov_toolbox", [], 12);

  function render(over: Partial<GmThingBodyProps> = {}) {
    const { gm, editor, sent } = editorOf();
    const sheets: ThingSheet[] = [];
    const props: GmThingBodyProps = { page: page!, gm: { ...extras, putAway: { place: "harbor_street_114" }, history: [{ turn: 2, source: "gm", lines: ["Mechanic's toolbox is now at 114 Harbor Street"] }] }, pick, entity: gm.entities.find((e) => e.id === "pov_toolbox"), editor, onSheet: (s) => sheets.push(s), onOpen: () => undefined, ...over };
    return { tree: GmThingBody(props), sent, sheets, gm };
  }

  test("its sections, in order, with no simulation, life or tier", () => {
    const { tree } = render();
    expect(find(tree, Section).map((p) => p.title)).toEqual(["Where it is", "Whose", "Who may use it", "What it is", "Secrecy", "History", "Remove"]);
    expect(find(tree, HoldsSection).length).toBe(1);
    expect(textOf(find(tree, Disclosure)[0]?.summary)).toBe("Advanced: every field, its relations and its id");
    expect(find(tree, FieldRow).length).toBeGreaterThan(0);
    expect(find(tree, Relations).length).toBe(1);
    const titles = find(tree, ActionRow).map((p) => textOf(p.title));
    expect(titles.slice(0, 2)).toEqual(["Is", "Kept at"]);
    expect(titles).toContain("Mechanic's toolbox is now at 114 Harbor Street");
    expect(find(tree, ActionRow).find((p) => textOf(p.title) === "Mechanic's toolbox is now at 114 Harbor Street")?.subtitle).toBe("Turn 2 · the GM");
    expect(find(tree, ActionRow).find((p) => p.title === "Kept at")?.subtitle).toBe("Where the world starts it");
  });

  test("Move to…, Put in…, Hand to…, Kept at… and + Add inside open their sheets", () => {
    const { tree, sheets } = render();
    for (const text of ["Move to…", "Put in…", "Hand to…", "Kept at…"]) click(tree, text);
    (find(tree, HoldsSection)[0]?.onAdd as () => void)();
    expect(sheets).toEqual(["move", "put", "hand", "kept", "inside"]);
  });

  test("each control is one GM edit, its notice the sentence of what it did", () => {
    const { tree, sent } = render();
    click(tree, "Put it away");
    (find(tree, RefPicker).find((p) => p.label === "Make it theirs…")?.onChange as (v: string) => void)("danny_okafor");
    (find(tree, RefPicker).find((p) => p.label === "Make it theirs…")?.onChange as (v: string) => void)("");
    (find(tree, AddPicker)[0]?.onAdd as (v: string) => void)("danny_okafor");
    click(tree, "Remove from the world");
    expect(sent).toEqual([
      { ops: [{ op: "item", change: { do: "move", item: "pov_toolbox", to: { place: "harbor_street_114" }, why: "Put away" } }], done: "Mechanic's toolbox is put away, at 114 Harbor Street." },
      { ops: [{ op: "item", change: { do: "own", item: "pov_toolbox", owner: "danny_okafor", why: "The GM made it so" } }], done: "Mechanic's toolbox is Danny Okafor's now." },
      { ops: [{ op: "item", change: { do: "own", item: "pov_toolbox", owner: null, why: "The GM made it so" } }], done: "Mechanic's toolbox is nobody's now." },
      { ops: [{ op: "item", change: { do: "grant", item: "pov_toolbox", who: "danny_okafor", basis: "assign" } }], done: "Danny Okafor may use Mechanic's toolbox now." },
      { ops: [{ op: "item", change: { do: "remove", item: "pov_toolbox", why: "The GM removed it" } }], done: "Mechanic's toolbox is out of the world." },
    ]);
  });

  test("a grant with Stop; Reveal for a hidden thing the player character hasn't found; Tidy up's finding on it first", () => {
    const row = { ...page.row, hidden: true };
    const finding: TidyFinding = { key: "size_unknown:pov_toolbox", kind: "size_unknown", things: ["pov_toolbox"], text: "Mechanic's toolbox was made in play.", fix: null, choices: [{ label: "Heavy", ops: [{ op: "item", change: { do: "label", item: "pov_toolbox", size: "heavy" } }], done: "Mechanic's toolbox is Heavy now." }], secret: false };
    const { tree, sent } = render({ page: { ...page, row, grants: [{ who: { id: "danny_okafor", name: "Danny Okafor", is: "person" }, basis: "loan", until: "Friday 6 November 2026, 18:00" }] }, gm: { ...extras, found: false, findings: [finding] } });
    expect(find(tree, AddPicker)[0]?.options).not.toContainEqual(expect.objectContaining({ value: "danny_okafor" }));
    (find(tree, Button).find((p) => p.label === "Stop Danny Okafor using it")?.onClick as () => void)();
    click(tree, "Reveal to Jordan Ellis");
    const card = find(tree, TidyCard)[0];
    (card?.onFix as (fix: TidyFinding["choices"][number]) => void)(finding.choices[0]!);
    expect(sent).toEqual([
      { ops: [{ op: "item", change: { do: "revoke", item: "pov_toolbox", who: "danny_okafor" } }], done: "Danny Okafor may no longer use Mechanic's toolbox." },
      { ops: [{ op: "link", rel: "knows", from: "pov", to: "pov_toolbox" }], done: "Jordan Ellis knows of Mechanic's toolbox now." },
      { ops: [{ op: "item", change: { do: "label", item: "pov_toolbox", size: "heavy" } }], done: "Mechanic's toolbox is Heavy now." },
    ]);
    // Found, or public, there is nothing to reveal.
    expect(find(render().tree, Button).some((p) => textOf(p.children).startsWith("Reveal"))).toBe(false);
  });

  test("a thing is an item or a kind built on one, as the GM view's kinds say", () => {
    const { gm } = editorOf();
    expect(isThingKind(gm.kinds, "container")).toBe(true);
    expect(isThingKind(gm.kinds, "vehicle")).toBe(true);
    expect(isThingKind(gm.kinds, "character")).toBe(false);
    expect(isThingKind(gm.kinds, "account")).toBe(false);
  });
});

describe("Select and the bulk bar", () => {
  const ctx = ctxOf();
  const rows = thingsList(ctx).rows;
  const pick = (ids: readonly string[]) => ids.map((id) => rows.find((r) => r.id === id) ?? ((): never => { throw new Error(`no ${id}`); })());
  const selection: Selection = { on: true, ids: [], start: () => undefined, stop: () => undefined, toggle: () => undefined, set: () => undefined };

  test("Select 3 + Put away sends one request with 3 move ops, each to where it rests", () => {
    const { editor, sent } = editorOf();
    const three = pick(["pov_wallet", "pov_keys", "pov_phone"]).map((r) => ({ ...r, where: [{ id: "alder_market", name: "Alder Market", is: "place" as const }], rest: { in: "pov" } }));
    click(ThingsBulkBar({ selection, all: rows.map((r) => r.id), shown: [], rows: three, editor, onSheet: () => undefined }), "Put away");
    expect(sent.length).toBe(1);
    expect(sent[0]?.ops).toEqual(three.map((r) => ({ op: "item", change: { do: "move", item: r.id, to: { in: "pov" }, why: "Put away" } })));
  });

  test("one edit a change: Move to, Make it theirs, Size and Remove; what is so already is left out; over 64 picked, nothing is offered", () => {
    const two = pick(["pov_wallet", "pov_toolbox"]);
    expect(bulkEdit({ do: "move", to: { place: "harbor_street_114" }, words: "at 114 Harbor Street" }, two)?.ops.length).toBe(2);
    expect(bulkEdit({ do: "own", owner: { id: "danny_okafor", name: "Danny Okafor", is: "person" } }, two)?.done).toBe("Wallet and Mechanic's toolbox are Danny Okafor's now.");
    expect(bulkEdit({ do: "size", size: two[0]!.size as "pocket" }, [two[0]!])).toBeNull();
    expect(bulkEdit({ do: "remove" }, two)?.ops).toEqual(two.map((r) => ({ op: "item", change: { do: "remove", item: r.id, why: "The GM removed it" } })));
    const { editor } = editorOf();
    const many = Array.from({ length: 65 }, (_, i) => ({ ...two[0]!, id: `t${i}` }));
    const bar = ThingsBulkBar({ selection, all: [], shown: [], rows: many, editor, onSheet: () => undefined });
    expect(find(bar, Button).filter((p) => textOf(p.children) !== "Clear" && !textOf(p.children).startsWith("Select all")).every((p) => p.disabled === true)).toBe(true);
  });

  test("Wear sends do: wear on whoever has it, and Take off what they wear", () => {
    const page = thingPage(ctx, "pov_watch");
    if (!page) throw new Error("no watch");
    const extras = gmThingExtras(reg, ctx, [], "pov_watch", [], 12);
    const { gm, editor, sent } = editorOf();
    const body = (row: typeof page.row) => GmThingBody({ page: { ...page, row }, gm: extras, pick: thingPicks(ctx), entity: gm.entities.find((e) => e.id === "pov_watch"), editor, onSheet: () => undefined, onOpen: () => undefined });
    click(body(page.row), "Take off");
    click(body({ ...page.row, worn: null, slot: "wrist" }), "Wear");
    expect(sent.map((s) => s.ops)).toEqual([[{ op: "item", change: { do: "wear", item: "pov_watch", who: "pov", off: true } }], [{ op: "item", change: { do: "wear", item: "pov_watch", who: "pov" } }]]);
  });

  test("Take off when every one picked is worn, else Wear what takes a slot, each on whoever has it, as one edit; Hand to…, Let use… and Rename… (one thing only) open their sheets", () => {
    const { editor, sent } = editorOf();
    const sheets: BulkSheet[] = [];
    const worn = pick(["pov_watch", "pov_wallet"]);
    expect(allWorn(worn)).toBe(true);
    const bar = ThingsBulkBar({ selection, all: [], shown: [], rows: worn, editor, onSheet: (s) => sheets.push(s) });
    click(bar, "Take off");
    for (const text of ["Hand to…", "Let use…"]) click(bar, text);
    expect(find(bar, Button).find((p) => textOf(p.children) === "Rename…")?.disabled).toBe(true);
    // The watch off already and the toolbox, which nobody has: only the watch is worn.
    const mixed = [{ ...worn[0]!, worn: null }, ...pick(["pov_toolbox"])];
    click(ThingsBulkBar({ selection, all: [], shown: [], rows: mixed, editor, onSheet: () => undefined }), "Wear");
    click(ThingsBulkBar({ selection, all: [], shown: [], rows: pick(["pov_toolbox"]), editor, onSheet: (s) => sheets.push(s) }), "Rename…");
    expect(sent).toEqual([
      { ops: worn.map((r) => ({ op: "item", change: { do: "wear", item: r.id, who: "pov", off: true } })), done: "Wristwatch and Wallet are taken off; each stays with whoever wore it." },
      { ops: [{ op: "item", change: { do: "wear", item: "pov_watch", who: "pov" } }], done: "Wristwatch is worn now, by whoever has it." },
    ]);
    expect(sheets).toEqual(["hand", "use", "rename"]);
    expect(bulkEdit({ do: "wear" }, pick(["pov_toolbox"]))).toBeNull();
  });

  test("Hand to… hands each over in one edit, a loan until its end; Let use… grants each, a loan with an end, else assigned; Rename names one; what they hold or own already is left out", () => {
    const two = pick(["pov_wallet", "pov_toolbox"]);
    const loans = bulkLoans(1000);
    expect(loans).toEqual([
      { label: "For a day", until: 2440 },
      { label: "For three days", until: 5320 },
      { label: "For a week", until: 11080 },
    ]);
    expect(bulkLoans(null)).toEqual([]);
    const day = loans[0]!;
    expect(bulkEdit({ do: "hand", to: "danny_okafor", whom: "Danny Okafor", basis: "loan", until: day }, two)).toEqual({
      ops: two.map((r) => ({ op: "item", change: { do: "hand", item: r.id, to: "danny_okafor", basis: "loan", until: 2440, why: "The GM handed it over" } })),
      done: "Danny Okafor has Wallet and Mechanic's toolbox on loan, for a day.",
    });
    expect(bulkEdit({ do: "hand", to: "danny_okafor", whom: "Danny Okafor", basis: "gift" }, two)?.done).toBe("Wallet and Mechanic's toolbox are Danny Okafor's now, a gift.");
    expect(bulkEdit({ do: "hand", to: "danny_okafor", whom: "Danny Okafor", basis: "hold" }, two)?.done).toBe("Danny Okafor is holding Wallet and Mechanic's toolbox now.");
    // Jordan has the wallet on him already: only the toolbox goes to him.
    expect(bulkEdit({ do: "hand", to: "pov", whom: "Jordan Ellis", basis: "hold" }, two)?.ops).toEqual([{ op: "item", change: { do: "hand", item: "pov_toolbox", to: "pov", basis: "hold", why: "The GM handed it over" } }]);
    expect(bulkEdit({ do: "grant", who: "danny_okafor", whom: "Danny Okafor" }, two)).toEqual({
      ops: two.map((r) => ({ op: "item", change: { do: "grant", item: r.id, who: "danny_okafor", basis: "assign" } })),
      done: "Danny Okafor may use Wallet and Mechanic's toolbox now.",
    });
    expect(bulkEdit({ do: "grant", who: "danny_okafor", whom: "Danny Okafor", until: day }, two)).toEqual({
      ops: two.map((r) => ({ op: "item", change: { do: "grant", item: r.id, who: "danny_okafor", basis: "loan", until: 2440 } })),
      done: "Danny Okafor may use Wallet and Mechanic's toolbox for a day.",
    });
    // Both are Jordan's: he needs no leave to use them.
    expect(bulkEdit({ do: "grant", who: "pov", whom: "Jordan Ellis" }, two)).toBeNull();
    expect(bulkEdit({ do: "rename", name: " Old wallet " }, [two[0]!])).toEqual({ ops: [{ op: "item", change: { do: "label", item: "pov_wallet", name: "Old wallet" } }], done: "Wallet is called Old wallet now." });
    expect(bulkEdit({ do: "rename", name: "Old wallet" }, two)).toBeNull();
    expect(bulkEdit({ do: "rename", name: "Wallet" }, [two[0]!])).toBeNull();
  });
});

describe("+ Add a thing", () => {
  const ctx = ctxOf();
  const pick = thingPicks(ctx);
  const types = thingTypes(ctx);
  const at = (id: string) => pick.where.find((c) => c.id === id) ?? ((): never => { throw new Error(`no ${id}`); })();
  const draft = (over: Partial<AddDraft>): AddDraft => ({ name: "Thing", kind: "item", what: null, qty: 1, at: at("harbor_street_114"), ...over });

  test("its sheet starts where the player character is, offers Vehicle once the world has classes, and sends one make: a vehicle by its class, with its make, model and year", async () => {
    const { editor, sent } = editorOf();
    const classes = buildClasses(portAlder);
    let closed = 0;
    const sheet = (over: Partial<Parameters<typeof GmAddSheet>[0]> = {}) => GmAddSheet({ pick, here: "harbor_street_114", types, classes, editor, onClose: () => (closed += 1), ...over });
    const tree = sheet();
    expect(tree.type).toBe(AddThingSheet);
    const props = tree.props as Props;
    expect(props.start).toEqual({ at: at("harbor_street_114") });
    expect(props.kinds).toContain("vehicle");
    expect(sheet({ classes: [] }).props.kinds).not.toContain("vehicle");
    expect(sheet({ classes: null }).props.kinds).not.toContain("vehicle");
    const pickup = classes.find((c) => c.domain === "road");
    if (!pickup) throw new Error("no road class");
    (props.onSubmit as (d: AddDraft) => void)(draft({ name: "Dad's old pickup", kind: "vehicle", what: { vehicle: { id: pickup.id, name: pickup.name, domain: pickup.domain, make: "Ford", model: "F-150", year: 2004 } } }));
    expect(sent).toEqual([{ ops: [{ op: "item", change: { do: "make", name: "Dad's old pickup", at: { place: "harbor_street_114" }, class: pickup.id, details: { make: "Ford", model: "F-150", year: 2004 }, why: "The GM put it there" } }], done: "Dad's old pickup is at 114 Harbor Street now." }]);
    await Promise.resolve();
    expect(closed).toBe(1);
  });

  test("a catalog type (each kind lists its category's), or something else by its kind and size; how many; in a holder or on someone", () => {
    expect(typesOfKind(types, "clothing").length).toBeGreaterThan(0);
    expect(typesOfKind(types, "weapon").every((t) => t.categoryId === "weapon")).toBe(true);
    const rounds = typesOfKind(types, "ammo")[0];
    if (!rounds) throw new Error("no ammunition in the catalogs");
    expect(addEdit(draft({ name: "Rounds", kind: "ammo", what: { type: rounds }, qty: 50, at: at("pov_truck_glovebox") }))).toEqual({
      ops: [{ op: "item", change: { do: "make", name: "Rounds", at: { in: "pov_truck_glovebox" }, type: rounds.id, qty: 50, why: "The GM put it there" } }],
      done: "Rounds ×50 is in Truck glovebox now.",
    });
    expect(addEdit(draft({ name: "Rain poncho", kind: "clothing", what: { size: "hand" }, at: at("pov") }))).toEqual({
      ops: [{ op: "item", change: { do: "make", name: "Rain poncho", at: { in: "pov" }, category: "clothing", size: "hand", why: "The GM put it there" } }],
      done: "Rain poncho is on Jordan Ellis now.",
    });
    expect(addEdit(draft({ name: "Crate", kind: "container" })).ops).toEqual([{ op: "item", change: { do: "make", name: "Crate", at: { place: "harbor_street_114" }, holds: "hand", why: "The GM put it there" } }]);
  });
});

describe("a person's outfits and loadouts on their GM page", () => {
  const ctx = ctxOf();
  const rows = thingsList(ctx).rows;
  const worn = rows.filter((r) => r.id === "pov_watch" || r.id === "pov_keys");

  test("each saved set with its pieces (one gone from the world named so) and On now; Change into and Forget are GM edits", () => {
    const { gm, editor, sent } = editorOf();
    const jordan = gm.entities.find((e) => e.id === "pov");
    if (!jordan) throw new Error("no Jordan");
    const sets = {
      set_watch: { name: "Watch on", kind: "outfit", pieces: [{ item: "pov_watch" }] },
      set_keys: { name: "Keys out", kind: "outfit", pieces: [{ item: "pov_keys", slot: "hand_held" }] },
      set_gone: { name: "Lost ring", kind: "loadout", pieces: [{ item: "nowhere_ring" }] },
    };
    const person: GmEntity = { ...jordan, fields: [...jordan.fields, { id: "sets", label: "sets", type: "text", value: sets, extra: true }] };
    const listed = gmSets(person, worn, gm.entities);
    expect(listed.map((s) => [s.id, s.on === true, piecesLine(s)])).toEqual([
      ["set_gone", false, "missing nowhere_ring"],
      ["set_keys", false, "Keys"],
      ["set_watch", true, "Wristwatch"],
    ]);
    const tree = GmSets({ person, outfit: worn, editor });
    expect(find(tree, SetRows).map((p) => p.kind)).toEqual(["outfit", "loadout"]);
    const outfits = SetRows(find(tree, SetRows)[0] as Parameters<typeof SetRows>[0]);
    const change = find(outfits, Button).filter((p) => textOf(p.children) === "Change into");
    expect(change.map((p) => p.disabled)).toEqual([false, true]);
    (change[0]?.onClick as () => void)();
    (find(outfits, Button).find((p) => p.label === "Forget Watch on")?.onClick as () => void)();
    expect(sent).toEqual([
      { ops: [{ op: "item", change: { do: "set_apply", who: "pov", set: "set_keys" } }], done: "Jordan Ellis changed into Keys out." },
      { ops: [{ op: "item", change: { do: "set_drop", who: "pov", set: "set_watch" } }], done: "Jordan Ellis no longer keeps Watch on." },
    ]);
  });
});

describe("GM → This chat → Things", () => {
  test("following the world's setting, it says so; its own setting starts from the world's and sends lre.chat.knowledge with tidy, null to follow again", () => {
    const sent: (boolean | null)[] = [];
    const following = TidySwitch({ tidy: { chat: null, world: true }, busy: false, onChange: (tidy) => sent.push(tidy) });
    expect(find(following, HostSwitch).map((p) => [p.label, p.checked])).toEqual([["This chat has its own setting", false]]);
    expect(textOf(following)).toContain("It follows the world's setting (Build → Packs → gear → Tidy up), now On.");
    expect(thingsSummary({ chat: null, world: true })).toBe("Tidy impossible holds every turn: on · the world's setting");
    press(labelled(following, HostSwitch, "This chat has its own setting"), true);
    const own = TidySwitch({ tidy: { chat: true, world: true }, busy: false, onChange: (tidy) => sent.push(tidy) });
    expect(find(own, HostSwitch).map((p) => [p.label, p.checked])).toEqual([
      ["This chat has its own setting", true],
      ["Tidy impossible holds every turn in this chat", true],
    ]);
    press(labelled(own, HostSwitch, "Tidy impossible holds every turn in this chat"), false);
    press(labelled(own, HostSwitch, "This chat has its own setting"), false);
    expect(sent).toEqual([true, false, null]);
    expect(thingsSummary({ chat: false, world: true })).toBe("Tidy impossible holds every turn: off · this chat's own");
    expect(tidyRequest("chat_1", false)).toEqual({ type: "lre.chat.knowledge", chatId: "chat_1", tidy: false });
    expect(tidyRequest("chat_1", null)).toEqual({ type: "lre.chat.knowledge", chatId: "chat_1", tidy: null });
    // A world that has it off: the chat's own setting starts off too.
    const off: (boolean | null)[] = [];
    press(labelled(TidySwitch({ tidy: { chat: null, world: false }, busy: false, onChange: (tidy) => off.push(tidy) }), HostSwitch, "This chat has its own setting"), true);
    expect(off).toEqual([false]);
  });
});
