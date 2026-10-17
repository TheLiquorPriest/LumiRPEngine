import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { Rig } from "../support/rig";

async function viewOf(rig: Rig, chatId: string): Promise<Record<string, unknown> | null> {
  rig.body(await rig.send({ type: "lre.hello", chatId }));
  return rig.latestView(chatId);
}

/** The display the chat's map panel was built for. */
async function displayOf(rig: Rig, chatId: string): Promise<unknown> {
  const panels = (await viewOf(rig, chatId))?.panels;
  const map = isRecord(panels) ? panels["space.map"] : null;
  return isRecord(map) ? map.display : null;
}

const prefsFile = (rig: Rig) => [...rig.host.files].find(([path]) => path.endsWith("/prefs.json"))?.[1] ?? null;

async function brindlemere(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
  const chatId = rig.host.createChat("Good morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

describe("the map's display per chat", () => {
  test("a pick is kept beside the chat, the map is built for it, and it survives a restart; a bad value is refused", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await brindlemere(rig);
    expect(await displayOf(rig, chatId)).toBe("knowledge");
    expect(rig.body(await rig.send({ type: "lre.map", chatId, display: "fog" }))).toEqual({ display: "fog" });
    expect(await displayOf(rig, chatId)).toBe("fog");
    expect(JSON.parse(prefsFile(rig) ?? "null")).toEqual({ v: 1, mapDisplay: "fog" });
    expect((await rig.send({ type: "lre.map", chatId, display: "satellite" })).type).toBe("lre.error");
    expect(await displayOf(rig, chatId)).toBe("fog");
    expect(await displayOf(rig.restart(), chatId)).toBe("fog");
  });

  test("a chat without a world has no map to show", async () => {
    const rig = new Rig();
    const chatId = rig.host.createChat("Hello.");
    expect((await rig.send({ type: "lre.map", chatId, display: "fog" })).type).toBe("lre.error");
    expect(prefsFile(rig)).toBeNull();
  });

  test("until the player picks, the map shows as the world says", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await brindlemere(rig);
    expect(await displayOf(rig, chatId)).toBe("knowledge");
    expect(prefsFile(rig)).toBeNull();
  });
});
