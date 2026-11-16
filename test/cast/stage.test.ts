// What is given of those on stage: a character's game side, as the world state holds the person they
// are; and the Author's views of everyone on stage, as the guidance names them (a principal's history,
// a supporting character's old mind files). Every name and word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TemplatePart } from "../../src/app/guidance";
import type { JsonValue } from "rp-harness/contract";
import { charactersOf } from "../../src/cast/record";
import { type CastViewInput, type CastViewName, castPresentViews, castViews } from "../../src/cast/views";
import { type Bench, CHAT, openBench, shippedLayouts, tokensOf, USER } from "./rig";

let layouts: Partial<Record<CastViewName, TemplatePart>> = {};
let dispose = (): void => undefined;

beforeAll(async () => {
  ({ layouts, dispose } = await shippedLayouts());
});

afterAll(() => dispose());

function input(b: Bench, present: string[] = [], turn: string | null = null): Omit<CastViewInput, "character"> {
  return { store: b.t.store, user: USER, chat: CHAT, turn, present, sources: b.t.shelf.reader, layouts, tokens: tokensOf };
}

/** Bram and Wren cast as principals, Odile as supporting, Hale (whom the world does not hold) as an extra, in one played turn, with what the Author recorded of their story. */
async function cast(b: Bench): Promise<void> {
  const turn = await b.t.begin();
  const r = await b.call(
    "cast_update",
    {
      operations: [
        { op: "cast", who: "Bram", as: "principal" },
        { op: "cast", who: "Wren", as: "principal" },
        { op: "cast", who: "Odile", as: "supporting" },
        { op: "cast", who: "Hale", as: "extra", line: "A watchman." },
        { op: "history", who: "Bram", text: "Took the inn over from his mother.", beats: ["b-3"] },
        { op: "history", who: "Odile", text: "Came down from the hills with nothing." },
      ],
    },
    turn.id,
  );
  expect(r.error).toBeUndefined();
  await b.t.tie(turn);
}

describe("a character's game side", () => {
  test("is the world state's person by the character's name: where they are, what is on them, and each value the state keeps; it follows the path", async () => {
    const b = await openBench();
    await cast(b);
    const side = async (): Promise<string> => (await castViews(["game-side"], { ...input(b), character: "Wren" }))[0]?.text ?? "";
    expect(await side()).toBe(
      [
        "### Wren in the world (entity:wren)",
        "",
        "Where: The Common Room, The Lamp and Ladle, Thornbury, Hollow Vale",
        "",
        "On them:",
        "- Coin purse (Container)",
        "- Grey cloak (Item)",
        "- Satchel (Container)",
        "",
        "As the world state has them:",
        "- tier: Leads",
        "- coin: $12.00",
        "- place: common_room",
        "- home: lamp_ladle",
        "- description: A courier with mud on her boots.",
        "- owner: bram",
        "- law: the watch's rules",
        "- curfew: midnight",
        "- region: region_vale",
        "- currency: USD ($)",
      ].join("\n"),
    );

    // A move recorded on a turn moves her game side; a swipe of that turn moves it back.
    const turn = await b.t.begin();
    const move = { type: "set", entity: "wren", field: "place", value: "cellar" };
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, [{ lane: "engine", op: "set", value: move as unknown as JsonValue }]));
    const moved = await b.t.tie(turn);
    expect(await side()).toContain("Where: The Cellar, The Lamp and Ladle, Thornbury, Hollow Vale");
    await b.t.tie(await b.t.swipe());
    expect(await side()).toContain("Where: The Common Room, The Lamp and Ladle");
    await b.t.showSwipe(moved);
    expect(await side()).toContain("Where: The Cellar,");
  });

  test("there is none for a character the world holds no one by", async () => {
    const b = await openBench();
    await cast(b);
    expect(charactersOf(b.t.db, USER, [CHAT]).map((c) => c.name)).toContain("Hale");
    expect(await castViews(["game-side"], { ...input(b), character: "Hale" })).toEqual([{ name: "game-side", text: "" }]);
  });
});

describe("the Author's views of those on stage", () => {
  test("each view the guidance names, of everyone on stage or of those cast so, one character after another in the stage's order; someone off stage is not given", async () => {
    const b = await openBench();
    await cast(b);
    const turn = await b.t.begin();
    const odile = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Odile")?.id ?? "";
    await b.t.write(turn, [{ character: odile, part: "mind", item: `imported:${odile}:core.md`, value: { kind: "imported", file: "core.md", text: "Odile. Keeps the cellar key.", entity: "odile", filed: false } }], "migration");
    await b.t.tie(turn);

    const BRAM = "### Bram's history in the story\n- Took the inn over from his mother. (Sat 1 Mar 2031, 8:00 AM) (beats b-3)";
    const ODILE = "### Odile's history in the story\n- Came down from the hills with nothing. (Sat 1 Mar 2031, 8:00 AM)";
    expect(await castPresentViews(["history:principal", "imported:supporting", "history", "lore:map", "history:hero"], input(b, ["Odile", "Bram", "Wren", "Tam"]))).toEqual([
      { name: "history:principal", text: BRAM },
      { name: "imported:supporting", text: "### Odile's old mind files, as they were written\n\n#### core.md\n\nOdile. Keeps the cellar key." },
      { name: "history", text: `${ODILE}\n\n${BRAM}` },
    ]);
    expect(await castPresentViews(["history:principal"], input(b, ["Odile"]))).toEqual([{ name: "history:principal", text: "" }]);
  });
});
