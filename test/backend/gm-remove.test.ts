// GM Remove (DESIGN §7) of someone in a symmetric or an inverse relation: each pair is unlinked
// once, so the removal applies instead of being refused for the side its partner's unlink took.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { toChain } from "../../src/backend/ledger-io";
import { GONE_FIELD } from "../../src/engine/scope";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

describe("GM Remove", () => {
  test("removes someone in a symmetric and an inverse pair, unlinking both sides of each", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const put = async (id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "relations", id, value }));
    await put("kin", { id: "kin", label: "Kin", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: {} });
    await put("mentor_of", { id: "mentor_of", label: "Mentor of", from: "person", to: "person", cardinality: "many_many", symmetric: false, inverse: "student_of", fields: {} });
    await put("student_of", { id: "student_of", label: "Student of", from: "person", to: "person", cardinality: "many_many", symmetric: false, fields: {} });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "look around", "Quiet.");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "link", rel: "kin", from: POV, to: "dev" }, { op: "link", rel: "mentor_of", from: POV, to: "dev" }] }));
    const reply = await rig.send({ type: "lre.edit", chatId, ops: [{ op: "despawn", entity: "dev" }] });
    expect(reply.type).not.toBe("lre.error");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    expect(state?.entities.dev?.fields[GONE_FIELD]).toBe(true);
    expect(state?.entities.dev?.relations).toEqual([]);
    expect(state?.entities[POV]?.relations.some((r) => r.to === "dev")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
