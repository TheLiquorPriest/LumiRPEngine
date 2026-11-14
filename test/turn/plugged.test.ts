// What other lanes built, plugged into the turn: the engine's four fixed tools are the environment's
// tools, worded by their files (plan §6.8), and the history window (plan §4.2, §8.1) is the window the
// adapter asks, on the chat's settings. Both are seen where they matter, in what the Author is sent.
// Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../standin/lumiverse";
import { CHAT, CONNECTION, openTurnBed, PRESET, type TurnBed, type TurnBedOptions } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

const ANSWER = { pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns.</reply>" }] };

/** Seven messages before the player's next one, each marked by its place. */
function history(): ChatMessage[] {
  return Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, role: i % 2 === 0 ? "assistant" : "user", content: `HIST-0${i} ${i % 2 === 0 ? "The sea is loud." : "I listen."}` }));
}

describe("the engine's tools and the history window, in the Author's request", () => {
  test("the Author's first request declares the engine's four fixed tools, each worded by its file", async () => {
    const b = await bed({ answers: [ANSWER] });
    b.host.send(CHAT, "I ask Wren what the barometer says.");
    expect((await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).error).toBeNull();

    const tools = b.model.requests[0]!.tools;
    const names = tools.map((t) => t.name);
    for (const name of ["world_query", "world_search", "world_apply", "roll"]) expect(names).toContain(name);
    const shipped = await Bun.file(new URL("../../guidance/.tools/world_query.md", import.meta.url)).text();
    const body = shipped.slice(shipped.indexOf("\n---\n") + 5).trim();
    expect(tools.find((t) => t.name === "world_query")?.description).toBe(body);
  });

  test("with a window of 3 in the user's settings, the Author holds only the latest 3 messages of the chat; with none set, all of them", async () => {
    const said = "HIST-07 I ask whether the boat came.";
    const narrow = await bed({ answers: [ANSWER], messages: history(), global: "history:\n  window: 3\n" });
    narrow.host.send(CHAT, said);
    expect((await narrow.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).error).toBeNull();
    const kept = JSON.stringify(narrow.model.requests[0]!.messages);
    expect(["HIST-00", "HIST-01", "HIST-02", "HIST-03", "HIST-04"].filter((mark) => kept.includes(mark))).toEqual([]);
    for (const mark of ["HIST-05", "HIST-06", "HIST-07"]) expect(kept).toContain(mark);

    const whole = await bed({ answers: [ANSWER], messages: history() });
    whole.host.send(CHAT, said);
    expect((await whole.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).error).toBeNull();
    const all = JSON.stringify(whole.model.requests[0]!.messages);
    for (let i = 0; i <= 7; i++) expect(all).toContain(`HIST-0${i}`);
  });
});
