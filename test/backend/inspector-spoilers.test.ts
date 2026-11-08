// The context inspector's panel (`core.context`) carries no depth call's answer as written (the depth
// release's security review, M1): outside clients read it through `lre_inspector` and `lre_chat_state`
// without `spoilers`, so a call's `misread` (its raw answer and each field it said) stays on the
// inspector's record for GM → Depth → Turn alone, and the panel keeps every call's provenance but it.

import { expect, test } from "bun:test";
import { cliRig } from "../support/cli-rig";

test("lre_inspector and lre_chat_state never carry a depth call's answer as written, which stays on the inspector's record", async () => {
  const cli = await cliRig({ shipped: true });
  const created = await cli.call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const chatId = cli.rig.host.createChat("Morning.");
  await cli.call("lre_attach", { worldId: String(created.worldId), chatId });
  await cli.rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  const record = cli.rig.rt.inspector.records(chatId)?.at(-1);
  if (!record) throw new Error("no inspector record");
  // A depth turn's call whose answer its stage's parse didn't keep whole, as the bridge records it.
  const secret = "the author's private beat: Danny took the truck keys";
  record.provenance = { calls: [{ role: "author", connection: "conn-gm", model: "m", requestId: "req-1", promptTokens: 10, completionTokens: 5, ms: 40, misread: { fields: [{ field: "beats[0].what", said: JSON.stringify(secret) }], count: 1, raw: `{"beats": [{"what": "${secret}"}]}` } }], turnMs: 900, firstContentMs: 300 };
  const served = async (name: string, args: Record<string, string>): Promise<string> => (await cli.conn.request("lre.tools", { op: "call", name, args: { chatId, ...args } })).result?.text ?? "";
  // lre_chat_state reads the panel at its pointer; read whole, it answers the view's outline.
  for (const [name, args] of [["lre_inspector", {}], ["lre_chat_state", { pointer: "/panels/core.context" }]] as const) {
    const text = await served(name, args);
    expect([name, text.includes("req-1")]).toEqual([name, true]);
    expect([name, text.includes("Danny took the truck keys")]).toEqual([name, false]);
  }
  expect(await served("lre_chat_state", {})).not.toContain("Danny took the truck keys");
  // The record itself keeps it, for GM → Depth → Turn.
  expect(record.provenance.calls[0]?.misread?.raw).toContain(secret);
});
