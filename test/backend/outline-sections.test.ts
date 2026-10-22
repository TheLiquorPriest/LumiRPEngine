// The Outline points only at sections the narrator has this turn (DESIGN §9.5): the engine's fixed
// wording and an outline step's beats alike. A timelapse with nothing for the Montage gives an
// Outline that never mentions it; the outline step is told the sections, and a beat of its that
// points at one the turn didn't fill loses what names it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { withoutMissing } from "../../src/backend/section-refs";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

/** A Port Alder chat after `settings` patches, with minds off (no model answers them here). */
async function alder(settings: JsonObject[] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = () => "{}";
  for (const patch of [...settings, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** A Timelapse from the palette, `minutes` long, and its reply. */
async function timelapse(rig: Rig, chatId: string, minutes: number): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes } }, source: "palette", now: true }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Time passes.");
}

describe("the Outline points only at sections the narrator has", () => {
  test("a timelapse with nothing for the Montage gives an Outline that never mentions it; one with a Montage keeps the pointer", async () => {
    const { rig, chatId } = await alder();
    await timelapse(rig, chatId, 10);
    expect(rig.host.section("Montage")).toBe("");
    const outline = rig.host.section("Outline");
    expect(outline).toContain("- Time passes. Don't add events.");
    expect(outline).not.toContain("Montage");
    // Two hours brings service reminders into the Montage, and the Outline points at it.
    await timelapse(rig, chatId, 120);
    expect(rig.host.section("Montage")).not.toBe("");
    expect(rig.host.section("Outline")).toContain("Time passes. Narrate the interval from the Montage; don't add events.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the outline step is told the sections the narrator has, and its beat that points at another loses what names it", async () => {
    const { rig, chatId } = await alder([{ modelUse: { preset: "full" } }]);
    const asked: string[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").startsWith("You outline a roleplay narrator's next reply")) return "{}";
      asked.push(req.messages[1]?.content ?? "");
      return JSON.stringify({ beats: ["Danny glances at the clock.", "Narrate the wait from the Montage.", "Keep it quiet; the Minds section has what Danny thinks."] });
    };
    await timelapse(rig, chatId, 10);
    expect(asked).toHaveLength(1);
    const told = asked[0]?.split("Sections the narrator has this turn (point at no other):\n")[1]?.split("\n")[0] ?? "";
    expect(told.split(", ")).toEqual(expect.arrayContaining(["Outcome", "Scene", "Outline"]));
    expect(told).not.toContain("Montage");
    expect(told).not.toContain("Minds");
    const outline = rig.host.section("Outline");
    expect(outline).toContain("- Danny glances at the clock.");
    expect(outline).toContain("- Keep it quiet.");
    expect(outline).not.toContain("Montage");
    expect(outline).not.toContain("Minds");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("only what names a missing section goes: the rest of its sentence, other sentences and other lines stay as written", () => {
    const lines = ["Danny pays $4.50 for both. Narrate it from the Montage; keep it short.", "The Minds section has it.", "Nothing points anywhere here; e.g. the money stays put."];
    expect(withoutMissing(lines, ["Montage", "Minds"])).toEqual(["Danny pays $4.50 for both. Keep it short.", "Nothing points anywhere here; e.g. the money stays put."]);
    expect(withoutMissing(lines, [])).toEqual(lines);
  });
});
