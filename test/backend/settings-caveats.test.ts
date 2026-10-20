// Settings → Caveats apart from settings (DESIGN §13): the preset lint needs a dry run of the chat,
// a whole prompt assembly that takes long on a long chat, so a settings load or save never waits on
// it. Its finding is kept per chat, preset revision and settings revision; a failed or slow run
// reads as a caveat.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { DryRun } from "../../src/backend/host";
import { Rig } from "../support/rig";

describe("Settings → Caveats apart from settings", () => {
  function counting(rig: Rig): { runs: number } {
    const count = { runs: 0 };
    const real = rig.host.dryRun.bind(rig.host);
    rig.host.dryRun = async (chatId) => {
      count.runs += 1;
      return real(chatId);
    };
    return count;
  }

  test("loading and saving settings never dry-run the chat; caveats do, once per chat, preset and settings revision", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.activeChat = chatId;
    rig.host.preset = { name: "Default", blocks: [{ id: "b1", name: "Ledger (JSON)", content: "End every reply with the updated ledger as JSON:\n<json>{}</json>" }], maxTokens: 800, model: "deepseek-v4-flash" };
    const count = counting(rig);
    const got = rig.body(await rig.send({ type: "lre.settings.get" }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate" } }));
    expect(count.runs).toBe(0);
    expect(got.caveats).toBeUndefined();
    const first = rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats;
    const codes = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord).map((c) => c.code) : []);
    expect(codes(first)).toEqual(["preset_json_ledger", "preset_low_max_tokens"]);
    expect(count.runs).toBe(1);
    rig.body(await rig.send({ type: "lre.settings.caveats" }));
    expect(count.runs).toBe(1);
    // A new preset revision is checked again.
    rig.host.preset = { name: "Default", blocks: [{ id: "b1", name: "Main", content: "Write prose." }], maxTokens: 9000, model: "deepseek-v4-flash" };
    rig.host.presetRevision += 1;
    expect(codes(rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats)).toEqual([]);
    expect(count.runs).toBe(2);
    // So is a settings change.
    await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: false } });
    rig.body(await rig.send({ type: "lre.settings.caveats" }));
    expect(count.runs).toBe(3);
  });

  test("a dry run that fails reads as a caveat and runs again next time; one that runs long says it's still checking", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.activeChat = chatId;
    const real = rig.host.dryRun.bind(rig.host);
    let mode: "fail" | "hang" | "ok" = "fail";
    rig.host.dryRun = async (id): Promise<DryRun> => {
      if (mode === "fail") throw new Error("assembly timed out");
      if (mode === "hang") return new Promise<DryRun>(() => undefined);
      return real(id);
    };
    expect(rig.body(await rig.send({ type: "lre.settings.get" })).settings).toBeDefined();
    const failed = rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats;
    expect(Array.isArray(failed) && failed.filter(isRecord).map((c) => c.code)).toEqual(["preset_lint_failed"]);
    mode = "ok";
    expect(rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats).toEqual([]);
    mode = "hang";
    rig.host.presetRevision += 1;
    const pending = await rig.rt.presetCaveats(rig.host.userId, 20);
    expect(pending.map((c) => c.code)).toEqual(["preset_lint_pending"]);
  });
});
