// What the lead is given of the prompt Lumiverse sent and of its briefing (plan §4.2 "A prompt with pictures", §10.2, Y6): a picture
// goes to a model known to take pictures, and only in the player's message; what is left out, and a part of the briefing that could not
// be made, is told in the briefing by a line of the notices part and kept on the run, never left out in silence. The one means that
// leaves things out is the Author's and a narrator's alike. Played through the stand-in Lumiverse on the scripted model, the prompt
// handed to the turn as the door hands it with a picture added. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptMessage } from "rp-harness/contract";
import { UserStore } from "../../src/store";
import { BLOCKS } from "../../src/turn";
import { promptOf } from "../../src/turn/request";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const PICTURE = "data:image/png;base64,iVBORw0KGgo=";
const picture = (url = PICTURE) => ({ type: "image_url", image_url: { url } });

/** The notices part as the test words it, at the user's own level: the lines of what a lead is not given. */
const NOTICES = `---
description: Test words.
format: lines
---
pictures_not_taken: PICTURES-LEFT {{count}} in messages {{messages}}.
pictures_text_only: TEXT-ONLY {{count}} in messages {{messages}}.
parts_not_carried: PARTS-LEFT {{count}} in messages {{messages}}.
world_state_failed: STATE-FAILED {{error}}
on_stage_failed: STAGE-FAILED {{error}}
`;

test("the one means, for the Author's prompt and a narrator's: a player's picture goes only to a model that takes pictures; pictures in a system or assistant message and parts that are neither text nor a picture by its data are left out, by message", () => {
  const prompt = [
    { role: "system" as const, content: [{ type: "text", text: "The preset." }, picture()] },
    { role: "user" as const, content: [{ type: "text", text: "Look." }, picture(), picture()] },
    { role: "assistant" as const, content: [{ type: "text", text: "I see." }, picture()] },
    { role: "user" as const, content: [{ type: "text", text: "And this." }, picture("https://pictures.example.invalid/gull.png"), { type: "input_audio", input_audio: { data: "AAAA", format: "wav" } }] },
  ];
  const texts = (messages: PromptMessage[]) => messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : `[${p.mimeType}]`)).join("")));

  const taking = promptOf(prompt, true);
  expect(texts(taking.messages)).toEqual(["The preset.", "Look.[image/png][image/png]", "I see.", "And this."]);
  expect(taking.left).toEqual([
    { what: "textOnly", messages: [0, 2], count: 2 },
    { what: "parts", messages: [3], count: 2 },
  ]);

  const textOnly = promptOf(prompt, false);
  expect(texts(textOnly.messages)).toEqual(["The preset.", "Look.", "I see.", "And this."]);
  expect(textOnly.left).toEqual([
    { what: "pictures", messages: [1], count: 2 },
    { what: "textOnly", messages: [0, 2], count: 2 },
    { what: "parts", messages: [3], count: 2 },
  ]);
  // Roles, order and text stand as Lumiverse sent them.
  expect(textOnly.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
});

/** A bed whose turns are handed the prompt with a picture added to its last message of the player's, in the user's own notices. */
async function picturedBed(answers: Parameters<typeof openTurnBed>[0]["answers"]): Promise<TurnBed> {
  const b = await openTurnBed({ answers });
  beds.push(b);
  await mkdir(join(b.app.paths.files, ".prompts"), { recursive: true });
  await writeFile(join(b.app.paths.files, ".prompts", "notices.md"), NOTICES, "utf8");
  const play = b.turns.lane.play.bind(b.turns.lane);
  b.turns.lane.play = (turn, out, signal) => {
    const last = turn.prompt.findLastIndex((m) => m.role === "user");
    const prompt = turn.prompt.map((m, i) => (i !== last ? m : { ...m, content: [...(typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content), picture()] }));
    return play({ ...turn, prompt }, out, signal);
  };
  return b;
}

test("left out, with a line: a model nobody has said takes pictures is given none of the player's, and the briefing and the run say which message held them", async () => {
  const b = await picturedBed([replying("The gull circles.")]);
  b.host.send(CHAT, "I hold up the sketch.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();

  const request = b.requests.at(-1)!;
  expect(request.prompt.every((m) => typeof m.content === "string" || m.content.every((p) => p.type === "text"))).toBe(true);
  const at = request.prompt.findLastIndex((m) => m.role === "user");
  expect(request.briefing.find((block) => block.name === BLOCKS.notGiven)?.text).toBe(`PICTURES-LEFT 1 in messages ${at}.`);
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!)!;
  expect(run.notGiven).toEqual([{ what: "pictures", messages: [at], count: 1 }]);
  const turn = await b.page<{ runs: { notGiven: unknown[] }[] }>("GET", `/api/v1/chats/${CHAT}/turns/${run.turn}`);
  expect(turn.body.runs[0]!.notGiven).toEqual([{ what: "pictures", messages: [at], count: 1 }]);
});

test("a block that failed is told: a world state that cannot be compiled is said in the briefing with why, and kept on the run", async () => {
  const b = await picturedBed([replying("The gull circles.")]);
  const viewAt = UserStore.prototype.viewAt;
  UserStore.prototype.viewAt = () => {
    throw new Error("THE-FOLD-BROKE");
  };
  try {
    b.host.send(CHAT, "I hold up the sketch.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    const request = b.requests.at(-1)!;
    expect(request.briefing.find((block) => block.name === BLOCKS.worldState)).toBeUndefined();
    expect(request.briefing.find((block) => block.name === BLOCKS.notGiven)?.text).toContain("STATE-FAILED THE-FOLD-BROKE");
    await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(b.turns.runs.byGeneration(USER, out.generationId!)!.notGiven).toContainEqual({ what: "world-state", error: "THE-FOLD-BROKE" });
  } finally {
    UserStore.prototype.viewAt = viewAt;
  }
});
