import { describe, expect, test } from "bun:test";
import { adjustOp, chipIntent, convertRequest, editRequest, entityStateOp, fixRequest, paletteRequest, relationFields, resolveMarker, timelapseRequest, timeMarker, travelRequest, upgradeRequest } from "../../src/frontend/requests";
import type { UpgradePreview } from "../../src/shared/protocol";
import type { Chip, GmEntity, PaletteEntry, TimelapseView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { INTERRUPT_CLASSES } from "../../src/shared/ids";
import type { InterruptClass, InterruptPolicy } from "../../src/shared/ids";

const chip = (kind: Chip["kind"], actions: string[]): Chip => ({
  id: `chip-${kind}`,
  kind,
  messageId: "m7",
  label: kind,
  actions: actions.map((id) => ({ id, label: id })),
  expires: "next_send",
});

describe("chip actions", () => {
  test("every chip choice but regenerate sends lre.chip with the chip id and the action id", () => {
    for (const [kind, choice] of [
      ["confirm", "confirm"],
      ["confirm", "reject"],
      ["undo", "undo"],
      ["retry_read", "retry_read"],
      ["reread", "reread"],
      ["not_action", "not_action"],
      ["timelapse_offer", "timelapse"],
      ["continue_timelapse", "timelapse"],
      ["mode_change", "undo"],
      ["overdue", "retrieve"],
      ["keep_report", "open"],
      ["keep_report", "keep"],
      ["keep_report", "discard"],
    ] as const) {
      expect(chipIntent(chip(kind, [choice]), choice, "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: `chip-${kind}`, choice }, regenerate: false });
    }
  });

  test("a payload travels only when given", () => {
    expect(chipIntent(chip("confirm", ["confirm"]), "confirm", "c1", { cents: 899 })).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-confirm", choice: "confirm", payload: { cents: 899 } }, regenerate: false });
  });

  test("the pause chip's Keep and Discard are chip choices; the backend writes the decision", () => {
    const report = chip("keep_report", ["keep", "discard"]);
    expect(chipIntent(report, "discard", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-keep_report", choice: "discard" }, regenerate: false });
    expect(chipIntent(report, "keep", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-keep_report", choice: "keep" }, regenerate: false });
  });

  test("Retry (regenerate) runs the host's Regenerate and sends nothing to the backend", () => {
    expect(chipIntent(chip("retry", ["regenerate"]), "regenerate", "c1")).toEqual({ request: null, regenerate: true });
    expect(chipIntent(chip("degraded", ["regenerate"]), "regenerate", "c1")).toEqual({ request: null, regenerate: true });
  });

  test("a swipe option records the one-shot choice, then runs the host's Regenerate", () => {
    expect(chipIntent(chip("swipe_option", ["renarrate", "rerun"]), "renarrate", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-swipe_option", choice: "renarrate" }, regenerate: true });
    expect(chipIntent(chip("swipe_option", ["renarrate", "rerun"]), "rerun", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-swipe_option", choice: "rerun" }, regenerate: true });
  });

  test("a contradiction's Re-narrate records the choice and swipes; It's fine only records", () => {
    expect(chipIntent(chip("contradiction", ["renarrate", "dismiss"]), "renarrate", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-contradiction", choice: "renarrate" }, regenerate: true });
    expect(chipIntent(chip("contradiction", ["renarrate", "dismiss"]), "dismiss", "c1")).toEqual({ request: { type: "lre.chip", chatId: "c1", chip: "chip-contradiction", choice: "dismiss" }, regenerate: false });
  });

  test("converting an entry sends its event ref and parent path; markers cannot convert", () => {
    expect(convertRequest({ messageId: "m3", parentPath: "p".repeat(32), ref: { in: "post", seq: 4, index: 1 }, status: "dropped", text: "Paid $12" }, "c1")).toEqual({
      type: "lre.keep",
      chatId: "c1",
      choice: "convert",
      messageId: "m3",
      parentPath: "p".repeat(32),
      refs: [{ in: "post", seq: 4, index: 1 }],
    });
    expect(convertRequest({ messageId: "m3", parentPath: "p", ref: { marker: 2 }, status: "inert", text: "Realism" }, "c1")).toBeNull();
  });
});

describe("palette and map actions", () => {
  const pay: PaletteEntry = { action: "economy.pay", label: "Pay", group: "pay", options: [{ label: "Dev", params: { to: "npc_dev" } }], amount: { param: "cents", min: 1, max: 5000 } };

  test("an option's params go verbatim; the free amount merges as integer cents", () => {
    const option = pay.options[0];
    if (!option) throw new Error("fixture");
    expect(paletteRequest(pay, [option], "c1", 1234.4)).toEqual({ type: "lre.action", chatId: "c1", action: "economy.pay", params: { to: "npc_dev", cents: 1234 }, source: "palette" });
    expect(option.params).toEqual({ to: "npc_dev" });
    expect(paletteRequest(pay, [option], "c1")).toEqual({ type: "lre.action", chatId: "c1", action: "economy.pay", params: { to: "npc_dev" }, source: "palette" });
  });

  test("a second-step pick merges its param into the first option's", () => {
    const drive: PaletteEntry = { action: "vehicles.drive", label: "Drive", group: "drive", options: [{ label: "Your pickup", params: { vehicle: "pov_truck" } }] };
    const truck = drive.options[0];
    if (!truck) throw new Error("fixture");
    expect(paletteRequest(drive, [truck, { label: "Alder Automotive", params: { destination: "alder_automotive" } }], "c1")).toEqual({ type: "lre.action", chatId: "c1", action: "vehicles.drive", params: { vehicle: "pov_truck", destination: "alder_automotive" }, source: "palette" });
    expect(truck.params).toEqual({ vehicle: "pov_truck" });
  });

  test("Lend's required number merges under its param", () => {
    const lend: PaletteEntry = { action: "gear.lend", label: "Lend", group: "lend", options: [{ label: "Pocketknife", params: { item: "pov_knife" } }], number: { param: "days", label: "days", min: 1, max: null, default: 1 } };
    const knife = lend.options[0];
    if (!knife) throw new Error("fixture");
    expect(paletteRequest(lend, [knife, { label: "Danny Okafor", params: { to: "danny" } }], "c1", undefined, 3).params).toEqual({ item: "pov_knife", to: "danny", days: 3 });
  });

  test("a map tap sends the travel option's action from the map", () => {
    expect(travelRequest("space.drive", { to: "diner", vehicle: "car1" }, "c1")).toEqual({ type: "lre.action", chatId: "c1", action: "space.drive", params: { to: "diner", vehicle: "car1" }, source: "map" });
  });

  test("a timelapse sends its target and only the overrides that change the policy", () => {
    const interrupts = Object.fromEntries(INTERRUPT_CLASSES.map((cls) => [cls, "ignore"])) as Record<InterruptClass, InterruptPolicy>;
    interrupts.invitation = "stop";
    const view: TimelapseView = { action: "calendar.timelapse", blocked: null, durations: [60], until: [], interrupts, dayParts: false, followRoutine: false };
    expect(timelapseRequest(view, { type: "duration", minutes: 480 }, { invitation: "stop", bill: "note", weather: "stop" }, "c1")).toEqual({
      type: "lre.action",
      chatId: "c1",
      action: "calendar.timelapse",
      params: { target: { type: "duration", minutes: 480 }, overrides: { bill: "note", weather: "stop" } },
      source: "palette",
    });
  });

  test("a timelapse's Follow my routine travels as followRoutine when given, either way, and is left to the world's default when not", () => {
    const interrupts = Object.fromEntries(INTERRUPT_CLASSES.map((cls) => [cls, "ignore"])) as Record<InterruptClass, InterruptPolicy>;
    const view: TimelapseView = { action: "calendar.timelapse", blocked: null, durations: [60], until: [], interrupts, dayParts: false, followRoutine: true };
    const target = { type: "duration", minutes: 60 } as const;
    expect(timelapseRequest(view, target, {}, "c1", false).params).toEqual({ target, overrides: {}, followRoutine: false });
    expect(timelapseRequest(view, target, {}, "c1", true).params).toEqual({ target, overrides: {}, followRoutine: true });
    expect(timelapseRequest(view, target, {}, "c1").params).toEqual({ target, overrides: {} });
  });
});

describe("fixes and markers", () => {
  test("a ✎ fix writes the target's entity and field", () => {
    expect(fixRequest({ entity: "pov", field: "cash", type: "money", value: 4600 }, 3900, "c1")).toEqual({ type: "lre.fix", chatId: "c1", entity: "pov", field: "cash", value: 3900 });
  });

  test("time and resolve markers carry preview only when asked", () => {
    expect(timeMarker("c1", "pause", { all: true }, true)).toEqual({ type: "lre.marker", chatId: "c1", kind: "time", control: "pause", scope: { all: true }, to: true });
    expect(resolveMarker("c1", "money", { all: true }, 3, true)).toEqual({ type: "lre.marker", chatId: "c1", kind: "resolve", domain: "money", scope: { all: true }, to: 3, preview: true });
    expect(resolveMarker("c1", "money", { tier: "background" }, 1)).toEqual({ type: "lre.marker", chatId: "c1", kind: "resolve", domain: "money", scope: { tier: "background" }, to: 1 });
  });
});

describe("GM edits", () => {
  const rosie: GmEntity = {
    id: "npc_rosie",
    name: "Rosie Alvarez",
    kind: "npc",
    tier: "principal",
    agent: true,
    pov: false,
    gone: false,
    spawned: false,
    visibility: "public",
    place: "diner",
    holder: null,
    claimed: false,
    fields: [],
    relations: [],
    levels: [
      { domain: "money", level: 3, override: null },
      { domain: "castlife", level: 2, override: 2 },
    ],
    class: {},
    tags: [],
    sheet: null,
    life: { state: "alive", label: "Alive", acts: true, everyone: true, aware: [], unaware: [] },
  };
  const regard = [
    { id: "warmth", label: "Warmth", type: "number" as const, min: -100, max: 100 },
    { id: "since", label: "Since", type: "text" as const },
    { id: "mood", label: "Mood", type: "enum" as const, values: ["warm", "cold"] },
    { id: "close", label: "Close", type: "bool" as const },
  ];

  test("an edit sends its operations in order as one lre.edit", () => {
    const ops = [
      { op: "set" as const, entity: "npc_rosie", field: "mood", value: "happy" },
      { op: "despawn" as const, entity: "npc_vic" },
    ];
    expect(editRequest("chat-1", ops)).toEqual({ type: "lre.edit", chatId: "chat-1", ops });
  });

  test("the simulation form sends only what changed, and nothing when nothing did", () => {
    expect(entityStateOp(rosie, "principal", true, { money: null, castlife: 2 })).toBeNull();
    expect(entityStateOp(rosie, "supporting", true, { money: null, castlife: 2 })).toEqual({ op: "entity", entity: "npc_rosie", tier: "supporting" });
    expect(entityStateOp(rosie, "principal", false, { money: 4, castlife: null })).toEqual({ op: "entity", entity: "npc_rosie", agent: false, levels: { money: 4, castlife: null } });
  });

  test("relation fields are typed by their definitions, checked against bounds and values, and keep what the type doesn't declare", () => {
    expect(relationFields(regard, { warmth: "40", since: " spring ", mood: "warm", close: "true" })).toEqual({ warmth: 40, since: "spring", mood: "warm", close: true });
    expect(relationFields(regard, { warmth: "", since: "" }, { warmth: 10, decay: 0.5 })).toEqual({ decay: 0.5 });
    expect(relationFields(regard, { warmth: "140" })).toBeNull();
    expect(relationFields(regard, { warmth: "lots" })).toBeNull();
    expect(relationFields(regard, { mood: "angry" })).toBeNull();
  });

  test("money goes in or out of an account in minor units, and only for an amount above zero", () => {
    expect(adjustOp("dev_checking", "12.50", DEFAULT_CURRENCY, false)).toEqual({ op: "adjust", account: "dev_checking", cents: 1250 });
    expect(adjustOp("dev_checking", "$1,000", DEFAULT_CURRENCY, true)).toEqual({ op: "adjust", account: "dev_checking", cents: -100000 });
    expect(adjustOp("dev_checking", "0", DEFAULT_CURRENCY, false)).toBeNull();
    expect(adjustOp("dev_checking", "a lot", DEFAULT_CURRENCY, false)).toBeNull();
  });
});

describe("an Upgrade's picks", () => {
  const preview: UpgradePreview = {
    from: "r1",
    to: "r2",
    tracks: [],
    entities: [
      { entity: "kid", name: "Kit", kind: "Person", status: "new", changes: [{ id: "kid:entity", label: "New", from: "", to: "", pick: "take", options: ["take", "keep"], why: "new", targets: [{ entity: "kid", part: "entity" }] }] },
      {
        entity: "dev",
        name: "Dev",
        kind: "Person",
        status: "changed",
        changes: [
          { id: "dev:field:home", label: "Home", from: "", to: "", pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "field", field: "home" }] },
          { id: "dev:field:mood", label: "Mood", from: "", to: "", pick: "keep", options: ["take", "keep"], why: "changed in play", targets: [{ entity: "dev", part: "field", field: "mood" }] },
          { id: "dev:rel:sibling_of:sam", label: "Sibling", from: "", to: "", pick: "keep", options: ["take", "keep"], why: "changed in play", targets: [{ entity: "dev", part: "relation", rel: "sibling_of", to: "sam" }, { entity: "sam", part: "relation", rel: "sibling_of", to: "dev" }] },
          { id: "dev:tier", label: "Tier", from: "", to: "", pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "tier" }] },
        ],
      },
      { entity: "jo", name: "Jo", kind: "Person", status: "removed", changes: [{ id: "jo:entity", label: "Gone", from: "", to: "", pick: "keep", options: ["keep", "remove"], why: "removed", targets: [{ entity: "jo", part: "entity" }] }] },
    ],
  };

  test("send only what differs from the defaults, at every target, and an Upgrade with none still merges", () => {
    expect(upgradeRequest("c1", preview, {})).toEqual({ type: "lre.world", op: "upgrade", chatId: "c1", to: "r2", merge: {} });
    const req = upgradeRequest("c1", preview, { "kid:entity": "keep", "dev:field:home": "take", "dev:field:mood": "take", "dev:rel:sibling_of:sam": "take", "dev:tier": "keep", "jo:entity": "remove" });
    expect(req).toEqual({
      type: "lre.world",
      op: "upgrade",
      chatId: "c1",
      to: "r2",
      merge: { kid: { entity: "keep" }, dev: { fields: { mood: "take" }, relations: { sibling_of: { sam: "take" } }, tier: "keep" }, sam: { relations: { sibling_of: { dev: "take" } } }, jo: { entity: "remove" } },
    });
  });
});
