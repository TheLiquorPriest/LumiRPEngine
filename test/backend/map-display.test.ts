import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";

async function viewOf(rig: Rig, chatId: string): Promise<Record<string, unknown> | null> {
  rig.body(await rig.send({ type: "lre.hello", chatId }));
  return rig.latestView(chatId);
}

const prefsFile = (rig: Rig) => [...rig.host.files].find(([path]) => path.endsWith("/prefs.json"))?.[1] ?? null;

describe("the map's display per chat", () => {
  test("a pick is kept beside the chat and survives a restart; a bad value is refused", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    expect((await viewOf(rig, chatId))?.mapDisplay).toBeNull();
    expect(rig.body(await rig.send({ type: "lre.map", chatId, display: "fog" }))).toEqual({ display: "fog" });
    expect((await viewOf(rig, chatId))?.mapDisplay).toBe("fog");
    expect(JSON.parse(prefsFile(rig) ?? "null")).toEqual({ v: 1, mapDisplay: "fog" });
    expect((await rig.send({ type: "lre.map", chatId, display: "satellite" })).type).toBe("lre.error");
    expect((await viewOf(rig, chatId))?.mapDisplay).toBe("fog");
    expect((await viewOf(rig.restart(), chatId))?.mapDisplay).toBe("fog");
  });

  test("a chat without a world has no map to show", async () => {
    const rig = new Rig();
    const chatId = rig.host.createChat("Hello.");
    expect((await rig.send({ type: "lre.map", chatId, display: "fog" })).type).toBe("lre.error");
    expect(prefsFile(rig)).toBeNull();
  });

  test("until the player picks, the map shows as the world says", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    const chatId = rig.host.createChat("Good morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = await viewOf(rig, chatId);
    expect(view?.mapDisplay).toBeNull();
    const panels = view?.panels;
    const map = panels && typeof panels === "object" && "space.map" in panels ? panels["space.map"] : null;
    expect(map && typeof map === "object" && "display" in map ? map.display : null).toBe("knowledge");
  });
});
