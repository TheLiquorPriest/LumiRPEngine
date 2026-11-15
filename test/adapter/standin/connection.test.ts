// The connection a reply is made on, as the stand-in Lumiverse picks it, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): the chat's pin first, then the connection
// the composer sends (`connection_id`), which is the user's selection (`activeProfileId`), then his default (`resolveChatGenerationConnection`, `services/generation/connection-resolution.ts:29-91`;
// `services/generate.service.ts:1731-1755`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { Outcome } from "../../standin/lumiverse";
import { boat, closeBoats, CHAT, ORIGIN, USER, type Boat } from "./boat";

afterEach(closeBoats);

/** The boat's chat, with a second connection beside its own, and a chat pinned to the first with a model of its own. */
function twoConnections(replies: number): Boat {
  const b = boat(Array.from({ length: replies }, (_, i) => ({ words: [`Reply ${i + 1}.`] })));
  b.lv.connections.set("conn-b", { id: "conn-b", base: `${ORIGIN}/v1`, key: "key-b", model: "model-b", name: "Second" });
  b.lv.addChat({ id: "chat-pinned", user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "p0", role: "user", content: "USER-1 I steer the boat." }], metadata: { connection_profile_id: "conn-model", connection_model: "model-pinned" } });
  return b;
}

/** A request of the user's own as the composer sends it: no connection named by the test, the one he has selected sent by the page. */
const composer = (b: Boat, chat: string): Promise<Outcome> => b.lv.generate({ chat, preset: "preset-boat" });

/** The model each request to the provider named. */
const models = (b: Boat): unknown[] => b.provider.calls.map((c) => c.body.model);

describe("the connection of a reply (`resolveChatGenerationConnection`)", () => {
  test("in an unpinned chat, switching the composer's connection puts the next reply on it; a pinned chat keeps its pin", async () => {
    const b = twoConnections(4);
    // His selection is the boat's own connection: that is the one the composer sends.
    b.lv.switchConnection("conn-model");
    await composer(b, CHAT);
    b.lv.send(CHAT, "USER-2 I row on.");
    // He switches the composer to the second: the next reply of the unpinned chat is made on it.
    b.lv.switchConnection("conn-b");
    await composer(b, CHAT);
    expect(models(b)).toEqual(["model", "model-b"]);
    // The pinned chat keeps its pin, and the model it pins, whatever the composer sends.
    await composer(b, "chat-pinned");
    expect(models(b)).toEqual(["model", "model-b", "model-pinned"]);
    const started = b.lv.events.filter((e) => e.event === "GENERATION_STARTED").at(-1)!.payload as { model: string };
    expect(started.model).toBe("model-pinned");
  });

  test("a request that names a connection is put on it in an unpinned chat, and a pin that names none that exists is no pin", async () => {
    const b = twoConnections(3);
    b.lv.switchConnection("conn-model");
    await b.lv.generate({ chat: CHAT, connection: "conn-b", preset: "preset-boat" });
    expect(models(b)).toEqual(["model-b"]);
    // A pin on a connection that was deleted falls through to what the request names, the model it pinned dropped with it.
    b.lv.addChat({ id: "chat-gone", user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "g0", role: "user", content: "USER-1 I steer the boat." }], metadata: { connection_profile_id: "conn-gone", connection_model: "model-pinned" } });
    await b.lv.generate({ chat: "chat-gone", connection: "conn-b", preset: "preset-boat" });
    expect(models(b)).toEqual(["model-b", "model-b"]);
  });

  test("a request that names none, with nothing selected, goes to the user's default connection, and where he has none the first he has; where he has none at all it fails as Lumiverse's does", async () => {
    const b = twoConnections(3);
    b.lv.connections.set("conn-b", { ...b.lv.connections.get("conn-b")!, isDefault: true });
    await composer(b, CHAT);
    expect(models(b)).toEqual(["model-b"]);
    b.lv.connections.set("conn-b", { ...b.lv.connections.get("conn-b")!, isDefault: false });
    b.lv.send(CHAT, "USER-2 I row on.");
    await composer(b, CHAT);
    expect(models(b)).toEqual(["model-b", "model"]);
    b.lv.connections.clear();
    await expect(composer(b, CHAT)).rejects.toThrow("No connection profile found. Configure a default connection or select one for this chat.");
  });
});
