// A panel's press, by its kind (plan §10.10, "A panel action"): one that is part of his next message is
// held as a request, shown in the chat's state view in the words the next briefing gives the Author, and
// taken back by the same press again; a palette entry that manages is marked as done at once.

import { describe, expect, test } from "bun:test";
import { pressedLine } from "../../src/play/view";
import type { PanelAsk } from "../../src/turn/requests";
import { CHAT, makeBed, USER } from "./bed";

describe("a press that is part of the next message", () => {
  test("is held and shown as waiting, in the briefing's words, until the same press takes it back", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const before = await bed.state();
    expect(before.staged ?? null).toBeNull();
    expect(before.palette?.entries.find((e) => e.action === "pay")?.atOnce).toBe(true);
    const entry = before.palette?.entries.find((e) => e.atOnce !== true && e.group === "action" && e.amount === undefined && e.number === undefined && e.options.some((o) => o.disabled === undefined && o.next === undefined));
    const option = entry?.options.find((o) => o.disabled === undefined && o.next === undefined);
    if (entry === undefined || option === undefined) throw new Error("the starter world's palette has no press that waits");
    const press = { kind: "action" as const, action: entry.action, params: option.params, source: "palette" };

    const held = await bed.service.tap(USER, CHAT, press);
    expect(held.asked !== undefined && "held" in held.asked ? held.asked.held?.kind : null).toBe("panel");
    const waiting = bed.requests.waiting(USER, CHAT);
    expect(waiting).toHaveLength(1);
    const asked = waiting[0]?.asked as PanelAsk;
    const shown = (await bed.state()).staged;
    expect(shown).toMatchObject({ request: waiting[0]?.id, action: entry.action, from: "palette", what: asked.what, on: asked.on });
    expect(shown?.label).toBe(pressedLine(asked));

    const again = await bed.service.tap(USER, CHAT, press);
    expect(again.asked).toEqual({ held: null });
    expect(bed.requests.waiting(USER, CHAT)).toEqual([]);
    expect((await bed.state()).staged ?? null).toBeNull();
  });
});
