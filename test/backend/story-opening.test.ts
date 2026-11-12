// The author's opening (`story/opening.ts`): the moment as it stands, read by the engine with no
// model call, so the author acts without first reading the time, the place, who is there, the last
// beats or the quests. Cut to the player's size, the oldest beats go first and who is there stays.

import { describe, expect, test } from "bun:test";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { authorOpening } from "../../src/backend/story/opening";
import { chatStoryPort } from "../../src/backend/story/record";
import type { Beat } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { calendarOf, formatClock, placeOffset } from "../../src/engine/calendar";
import { alderChat, HOME } from "../support/tools";

const person = (id: string, name: string, here: boolean): JsonObject => ({ id, kind: "character", name, tier: "background", fields: here ? { place: HOME } : {}, relations: [] });

/** A public quest at its first stage, which the player's character can see. */
const KETTLE: JsonObject = { id: "q_kettle", kind: "quest", label: "The broken kettle", start: "asked", visibility: "public", stages: { asked: { label: "Find a new kettle", cue: "The kettle is dead.", next: [{ to: "found", when: "false" }] }, found: { label: "A new kettle", next: [] } } };

describe("the author's opening", () => {
  test("gives the time, the place, who is there with their standing and what waits for each mind, the last beats and the quests, and keeps who is there when cut small", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { mara: person("mara", "Mara", true), joss: person("joss", "Joss", true), ilse: person("ilse", "Ilse", true), okoro: person("okoro", "Okoro", false) }, tracks: { q_kettle: KETTLE } } });
    const userId = rig.host.userId;
    const head = await chatHead(rig.rt, chatId, userId);
    if (!head) throw new Error("the chat plays no world");
    const { world, state } = head;
    const beat = (id: string, by: string, kind: Beat["kind"], what: string, reached: string[]): Beat => ({ id, turn: "earlier", at: state.clock, where: HOME, by, kind, what, surface: what, exposure: reached.map((who) => ({ who, reach: "whole" as const })), decidedBy: { agent: "author" } });
    // Written on the chat's reply as an earlier turn's record holds them: Mara a principal who has
    // taken in nothing yet, Joss supporting, and the player's character's mind up to the second beat.
    const port = chatStoryPort(rig.rt, { chatId, userId, turn: "earlier", on: "last" });
    expect(
      await port.write({
        beats: [beat("b1", "player", "say", "Jordan asks Mara whether the kettle still works.", ["mara", "joss"]), beat("b2", "mara", "do", "Mara shakes the kettle and hears a rattle.", ["player", "joss"]), beat("b3", "world", "happen", "The kettle sputters out.", [])],
        cast: [
          { entity: "mara", standing: "principal" },
          { entity: "joss", standing: "supporting" },
          { entity: "player", standing: "principal", digestedTo: "b2" },
        ],
      }),
    ).toEqual({ kept: true });

    const pov = state.entities[world.pov]?.name ?? world.pov;
    const opening = await authorOpening(rig.rt, { chatId, userId }, null, await rig.rt.settings.get(userId));
    const lines = opening.split("\n");
    expect(opening).toContain(`- Time: ${formatClock(calendarOf(world), state.clock, placeOffset(world, state.clock, HOME))}`);
    expect(lines).toContain(`- ${pov} is at ${world.places[HOME]?.name} (${HOME}).`);
    expect(lines).toContain("- Principals here, who answer for themselves: Mara (mara).");
    // Mara has her own act and Jordan's words still to take in; the player's character is marked up to date.
    expect(lines).toContain("- Mara (mara): principal, with 2 beats that reached them still to take in");
    expect(lines).toContain(`- ${pov} (player): the player's character, has taken in all that reached them`);
    expect(lines).toContain("- Joss (joss): supporting");
    expect(lines).toContain("- Ilse (ilse): extra");
    expect(opening).not.toContain("Okoro");
    expect(lines).toContain(`- ${pov} (say): Jordan asks Mara whether the kettle still works.`);
    expect(lines).toContain("- the world (happen): The kettle sputters out.");
    expect(lines).toContain("- The broken kettle: Find a new kettle");
    expect(opening.length).toBeLessThanOrEqual(4000);

    // Cut small, through the settings as the page sets them: within the size, the oldest beat gone first, the principals still named.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { story: { limits: { openingChars: 500 } } } }));
    const small = await authorOpening(rig.rt, { chatId, userId }, null, await rig.rt.settings.get(userId));
    expect(small.length).toBeLessThanOrEqual(500);
    expect(small.split("\n")).toContain("- Principals here, who answer for themselves: Mara (mara).");
    expect(small).toContain(`${pov} is at`);
    expect(small).not.toContain("Jordan asks Mara whether the kettle still works.");
  });
});
