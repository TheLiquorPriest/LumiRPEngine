// Notes follow the turn as the turn lane puts them (plan §5.1, §5.4), played through the stand-in
// Lumiverse: a note the Author writes in a turn is gone once that turn is swiped, and back once the
// player shows its swipe again and the next turn begins. The Files page's routes, through RPE as
// composed, show each. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import type { TreeFileEntry, TreeFileText } from "../../src/tree";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const NOTE = "persistent-workspace/harbour.md";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function play(b: TurnBed, type: "normal" | "swipe", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

test("a note the Author writes in a turn is gone after that turn is swiped, and back when the swipe is flipped back", async () => {
  const b = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>One exchange, and a note.</intent>" }, { call: "file_write", args: { path: NOTE, op: "write", text: "The boat is two days late." } }] },
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      replying("The lamp gutters."),
      replying("Wren trims the wick."),
    ],
  });
  beds.push(b);
  /** Whether the Files page's listing of the chat holds the note. */
  const listed = async (): Promise<boolean> => {
    const listing = await b.page<{ files: TreeFileEntry[] }>("GET", `/api/v1/files?chat=${CHAT}`);
    expect(listing.status).toBe(200);
    return listing.body.files.some((f) => f.path === NOTE);
  };

  const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  expect(await listed()).toBe(true);
  await settledTurn(b, await play(b, "swipe"));
  expect(await listed()).toBe(false);

  b.host.cycleSwipe(CHAT, first.message!, "left");
  await settledTurn(b, await play(b, "normal", "I trim the wick."));
  expect(await listed()).toBe(true);
  const note = await b.page<TreeFileText>("GET", `/api/v1/files/${NOTE}?chat=${CHAT}`);
  expect(note.body.text).toBe("The boat is two days late.");
});
