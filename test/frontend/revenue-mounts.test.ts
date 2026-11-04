// The economy's revenue editor where it is mounted (DESIGN §26.2, Revenue streams), on Port Alder:
// - Build → Organizations: a stream saved from a template is the organization's in the draft (its
//   model a one-record list, as the editor writes it), lints clean, and a change writes only its
//   name and fields;
// - GM → Orgs → Money: the organization's streams read from the GM view, each save one GM edit the
//   engine takes: spawned, changed (a field the form emptied cleared, a rename), removed.

import { describe, expect, test } from "bun:test";
import { lintWorld } from "../../src/engine/authoring";
import { resolveEdit } from "../../src/engine/edits";
import { buildGmWorld } from "../../src/engine/gm-view";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { revenueStreamPatch, revenueStreamsOf } from "../../src/frontend/build/organizations";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { gmStreamDrafts, revenueEditOps, revenueSpawnOps, streamFromTemplate, type RevenueStreamDraft } from "../../src/packs/economy/ui/revenue";
import type { JsonValue } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import type { EditOp } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const SHOP_ACCOUNT = "acct_marcus_shop";

function portAlder(): WorldDoc {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  return make("pa", "Port Alder");
}

describe("Build → Organizations: revenue streams", () => {
  test("a stream saved from a template is the organization's, paid to it or its account, and lints clean", () => {
    const base = portAlder();
    const draft = streamFromTemplate("walk_in", SHOP, new Set(Object.keys(base.entities)));
    const doc = applyPatch(base as unknown as JsonValue, revenueStreamPatch(draft, null)) as unknown as WorldDoc;
    expect(doc.entities[draft.id]).toEqual({ id: draft.id, kind: "flow", name: "Walk-in customers", tier: "background", fields: draft.fields, relations: [] });
    expect(revenueStreamsOf(doc, SHOP, [])).toEqual([{ id: draft.id, name: "Walk-in customers", fields: draft.fields }]);
    // Paid into its operating account, it is the organization's too; it is no one else's.
    const intoAccount = applyPatch(doc as unknown as JsonValue, [{ op: "replace", path: `/entities/${draft.id}/fields/to`, value: SHOP_ACCOUNT }]) as unknown as WorldDoc;
    expect(revenueStreamsOf(intoAccount, SHOP, [SHOP_ACCOUNT]).map((s) => s.id)).toEqual([draft.id]);
    expect(revenueStreamsOf(doc, "harbor_towing", [])).toEqual([]);
    const issues = lintWorld(doc, reg).filter((i) => i.severity === "error" || i.path.startsWith(`entities.${draft.id}`) || i.code === "economy.revenue");
    expect(issues.map((i) => `${i.path} ${i.code}: ${i.message}`)).toEqual([]);
  });

  test("a change writes only the stream's name and fields: its tier and links stay", () => {
    const base = portAlder();
    const draft = streamFromTemplate("fees", SHOP, new Set(Object.keys(base.entities)));
    const doc = applyPatch(base as unknown as JsonValue, revenueStreamPatch(draft, null)) as unknown as WorldDoc;
    const before = doc.entities[draft.id];
    if (!before) throw new Error("the stream wasn't added");
    before.tier = "minor";
    before.relations = [{ type: "in", to: SHOP }];
    const changed: RevenueStreamDraft = { ...draft, name: " Retainers ", fields: { ...draft.fields, revenue: [{ type: "fees", units: 1, price: 7_500, buyers: 4 }] } };
    const after = applyPatch(doc as unknown as JsonValue, revenueStreamPatch(changed, draft)) as unknown as WorldDoc;
    expect(after.entities[draft.id]).toEqual({ ...before, name: "Retainers", fields: changed.fields });
  });
});

describe("GM → Orgs → Money: revenue streams", () => {
  /** A GM edit applied, as GM → Orgs sends it. */
  function edit(w: Working, ops: EditOp[]): void {
    const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "revenue-mounts" });
    if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
    for (const e of "events" in out ? out.events : []) {
      const refused = w.apply(e);
      if (refused) throw new Error(`dropped: ${refused.reason}`);
    }
  }

  test("a new stream is spawned paying the organization, read back from the GM view, changed and removed, each one edit", () => {
    const world = portAlder();
    const w = new Working(reg, world, startState(world, reg));
    const gm = () => readPass(() => buildGmWorld(reg, w.world, w.state));
    const streams = () => gm().money.find((m) => m.party === SHOP)?.streams ?? [];
    expect(streams()).toEqual([]);

    const template = streamFromTemplate("fees", SHOP, new Set(gm().entities.map((e) => e.id)));
    const draft: RevenueStreamDraft = { ...template, fields: { ...template.fields, start: "2026-10-01" } };
    edit(w, revenueSpawnOps(draft));
    expect(streams().map((s) => ({ id: s.id, label: s.label, type: s.type, earner: s.earner, status: s.status }))).toEqual([{ id: draft.id, label: "Fees", type: "fees", earner: SHOP, status: "active" }]);
    const [held] = gmStreamDrafts(gm(), streams());
    if (!held) throw new Error("the GM view doesn't hold the stream");
    expect(held).toMatchObject({ id: draft.id, name: "Fees", fields: draft.fields });
    // Nothing changed, nothing is sent.
    expect(revenueEditOps(held, held)).toEqual([]);

    // Paid daily instead of on the 1st and from now on (the form takes its day of the month and its start off), at a new price, renamed.
    const { days: _day, start: _start, ...rest } = held.fields;
    const changed: RevenueStreamDraft = { ...held, name: "Retainers", fields: { ...rest, every: "day", revenue: [{ type: "fees", units: 1, price: 7_500, buyers: 4 }] } };
    const ops = revenueEditOps(held, changed);
    // A set for each changed field (in the GM view's field order), the emptied list set empty, then the rename with the start cleared.
    expect(ops).toHaveLength(4);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "set", entity: draft.id, field: "every", value: "day" },
        { op: "set", entity: draft.id, field: "revenue", value: [{ type: "fees", units: 1, price: 7_500, buyers: 4 }] },
        { op: "set", entity: draft.id, field: "days", value: [] },
      ]),
    );
    expect(ops[3]).toEqual({ op: "effect", effect: "economy.flow_edit", args: { flow: draft.id, name: "Retainers", clear: "start" } });
    edit(w, ops);
    const [after] = gmStreamDrafts(gm(), streams());
    expect(after?.name).toBe("Retainers");
    expect(after?.fields.every).toBe("day");
    expect(after?.fields.days ?? []).toEqual([]);
    expect(after?.fields.start).toBeUndefined();

    edit(w, [{ op: "despawn", entity: draft.id }]);
    expect(streams()).toEqual([]);
    expect(gmStreamDrafts(gm(), [{ ...held, label: held.name, type: "fees", earner: SHOP, link: null, status: "active", months: [], preview: [], ai: "off", adjustments: [] }])).toEqual([]);
  });
});
