// What an agent the Author delegates to is given by the names its definition lists (plan §5.4, §10.4,
// Appendix C): the GM, the scene in full with its map, what is due and the story brief, each laid out
// as the Author's briefing lays it out and read at the turn it runs in; a name nobody gives is said so,
// in one line. Played through the stand-in Lumiverse on the scripted model, on a chat that plays an
// invented world whose revision the store keeps. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldDoc } from "../../src/shared/world";
import { INN, worldWith } from "../iface/map/fixtures";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat plays `doc`, kept by the store, from before its first turn. */
async function worldBed(doc: WorldDoc, options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  await playsWorld(b, doc);
  return b;
}

/** The player says something and asks for a reply; gives the turn once it is settled. */
async function play(b: TurnBed, said: string) {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return await settledTurn(b, out.generationId!);
}

/** The inn's common room, mapped; Tam keeps the market from nine. */
function innWorld(): WorldDoc {
  const doc = worldWith(INN);
  doc.schedules = { tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }] } };
  return doc;
}

/** The first turn: the scene is the common room, and the story record opens it. */
const OPENING = {
  pieces: [
    { text: "<intent>The night watch opens in the common room.</intent>" },
    { call: "world_apply", args: { operations: [{ op: "horizon", list: ["common_room"], source: { from: "author" } }] } },
    { call: "story_record", args: { operations: [{ op: "scene", new: true, title: "SCENE-WATCH The night watch", place: "The Common Room" }] } },
  ],
};

test("a delegated GM's first request holds the scene in full with its map, what is due and the story brief, by the names its definition lists", async () => {
  const b = await worldBed(innWorld(), {
    answers: [
      OPENING,
      { pieces: [{ text: "<reply>The common room is warm and loud.</reply>" }] },
      { pieces: [{ text: "<intent>Ask the GM.</intent>" }, { call: "delegate", args: { agent: "gm", brief: "Can Tam reach the market before nine?" } }] },
      { pieces: [{ text: "He can, with an hour to spare." }] },
      replying("Tam drains his cup and goes."),
    ],
  });
  await play(b, "I step into the inn.");
  await play(b, "I ask Tam whether he will make the market.");

  // The GM's first request: its own, holding the brief it was sent.
  const gm = b.model.requests.map((r) => JSON.stringify(r.messages)).find((sent) => sent.includes("Can Tam reach the market before nine?") && sent.includes("game master's hand"));
  expect(gm).toBeDefined();
  // The scene in full: the room, under the world state's own heading, with a row of its map as the map prints it.
  expect(gm).toContain("### At hand");
  expect(gm).toContain("The Common Room");
  expect(gm).toContain("# . . B B B . . . .  .  #");
  // What is due, worded by the world state's layout.
  expect(gm).toContain("### Due");
  expect(gm).toContain("9:00 AM: place at Market Square, Tam (tam_day)");
  // The story brief, as its layout lays out the scene the record holds open.
  expect(gm).toContain("SCENE-WATCH The night watch");
  // The world's ruleset, as world_query gives it.
  expect(gm).toContain('{\\"ruleset\\":');

  // The Author is told of no name of these the GM was not given.
  const answered = JSON.stringify(b.model.requests.at(-1)!.messages);
  for (const name of ["story:brief", "world:scene(full, map)", "world:due", "ruleset"]) expect(answered).not.toContain(`was not given ${name}`);
});

test("a keeper delegated after the reply is given the reply as it went out and the scene in full without its map", async () => {
  const b = await worldBed(innWorld(), {
    answers: [
      OPENING,
      { pieces: [{ text: "<reply>REPLY-WARM The common room is warm and loud.</reply>" }, { call: "delegate", args: { agent: "keeper", brief: "Bring the record in line with the reply." } }] },
      { pieces: [{ text: "Nothing to add." }] },
      { pieces: [{ text: "Settled." }] },
    ],
  });
  await play(b, "I step into the inn.");

  const keeper = b.model.requests.map((r) => JSON.stringify(r.messages)).find((sent) => sent.includes("Bring the record in line with the reply.") && sent.includes("You keep the books"));
  expect(keeper).toBeDefined();
  expect(keeper).toContain("REPLY-WARM The common room is warm and loud.");
  expect(keeper).toContain("### At hand");
  expect(keeper).toContain("The Common Room");
  expect(keeper).not.toContain("# . . B B B . . . .  .  #");
  expect(keeper).toContain("SCENE-WATCH The night watch");
});

test("a definition that names a view nobody gives is answered with one line that says so, and the agent runs", async () => {
  const b = await worldBed(innWorld(), {
    answers: [
      { pieces: [{ text: "<intent>Ask the surveyor.</intent>" }, { call: "delegate", args: { agent: "surveyor", brief: "How wide is the common room?" } }] },
      { pieces: [{ text: "Eleven squares." }] },
      replying("The room is wide."),
    ],
  });
  // The user's own definition, at the global level, naming a view nobody offers.
  const agents = join(b.app.paths.files, ".agents");
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, "surveyor.md"), "---\nname: surveyor\ndescription: Measures rooms.\ntools: []\nreads: []\ngiven:\n  - world:weather(tomorrow)\n---\nYou measure rooms.\n");
  await play(b, "I pace out the room.");

  const answered = JSON.stringify(b.model.requests.at(-1)!.messages);
  expect(answered.split("surveyor-1 was not given world:weather(tomorrow): it could not be found.")).toHaveLength(2);
  expect(answered).toContain("Eleven squares.");
});

/** Every name of RPE's own a shipped definition lists: none of them may be told to the Author as one that could not be found. */
const RPE_NAMES = ["story:brief", "world:scene(full, map)", "world:due", "ruleset", "index:known-to-self", "cast:self("];

test("a GM delegated on a chat's first turn, in a world where nothing is due, is given each empty view in its own file's words for nothing, and the Author is told of no name of RPE's it was not given", async () => {
  const b = await worldBed(worldWith(INN), {
    answers: [
      { pieces: [{ text: "<intent>Ask the GM before anything is set.</intent>" }, { call: "delegate", args: { agent: "gm", brief: "BRIEF-BARE What stands in the room?" } }] },
      { pieces: [{ text: "Nothing is set yet." }] },
      replying("The room waits."),
    ],
  });
  await play(b, "I look around.");

  const gm = b.model.requests.map((r) => JSON.stringify(r.messages)).find((sent) => sent.includes("BRIEF-BARE") && sent.includes("game master's hand"));
  expect(gm).toBeDefined();
  // The story brief's none part, the world state's own heading and line for an empty horizon, and its line for nothing due in the
  // span the chat's settings give (360 minutes as shipped).
  expect(gm).toContain("Nothing to brief: no scene is open, no thread is held hot, no future's time has come, and nothing is recorded of the player.");
  expect(gm).toContain("### At hand");
  expect(gm).toContain("Nothing is at hand: no place, person or thing is on the horizon.");
  expect(gm).toContain("### Due");
  expect(gm).toContain("The world state lists nothing due in the next 360 minutes of story time.");

  const answered = JSON.stringify(b.model.requests.at(-1)!.messages);
  expect(answered).toContain("Nothing is set yet.");
  for (const name of RPE_NAMES) expect(answered).not.toContain(`was not given ${name}`);
});

test("a character delegated in a chat with no world, before the cast has any record of her, is given her views and her lore in their own files' words for nothing, and the Author is told of no name of RPE's it was not given", async () => {
  const b = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Ask Wren.</intent>" }, { call: "delegate", args: { agent: "character", brief: "BRIEF-WREN The player asks whether the boat came.", plays: "Wren Hale" } }] },
      { pieces: [{ text: "I have not seen it." }] },
      replying("Wren shakes her head."),
    ],
  });
  beds.push(b);
  await play(b, "Did the boat come?");

  const wren = b.model.requests.map((r) => JSON.stringify(r.messages)).find((sent) => sent.includes("BRIEF-WREN") && sent.includes("You are Wren Hale"));
  expect(wren).toBeDefined();
  // The lore's own line for none, and each cast view's none part under its heading.
  expect(wren).toContain("No lore is bound to you.");
  expect(wren).toContain("Nothing is recorded of who they are yet.");
  expect(wren).toContain("### On Wren Hale's mind");
  expect(wren).toContain("Nothing is recorded on their mind.");
  expect(wren).toContain("The world holds no one by their name, or more than one.");
  expect(wren).not.toContain("in the world ()");

  const answered = JSON.stringify(b.model.requests.at(-1)!.messages);
  expect(answered).toContain("I have not seen it.");
  for (const name of RPE_NAMES) expect(answered).not.toContain(`was not given ${name}`);
});
