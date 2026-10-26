// What a GM edit's notice says (DESIGN §7, Player-facing wording): who changed, what the setting
// means and the value in words (a place with the places around it, a thing with where it is), never a
// field's form label glued to a value. The notice is the GM view's own: the lines of the edit it made.

import { describe, expect, test } from "bun:test";
import { bulkDone } from "../../src/frontend/gm/batch";
import { editNotice } from "../../src/frontend/gm/editor";
import { editRequest } from "../../src/frontend/requests";
import type { EditOp } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");
  return { rig, chatId };
}

async function gmView(rig: Rig, chatId: string): Promise<GmView> {
  return rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
}

/** The notice an edit leaves in the GM view: its own Undo chip, worded from the view loaded after it. */
async function noticeOf(rig: Rig, chatId: string, ops: EditOp[]): Promise<string> {
  const reply = await rig.send(editRequest(chatId, ops) as unknown as Record<string, unknown>);
  const undo = rig.body(reply).undo;
  if (typeof undo !== "string") throw new Error(`the edit wasn't applied: ${JSON.stringify(reply)}`);
  return editNotice([undo], (await gmView(rig, chatId)).edits).text;
}

describe("a GM edit's notice says what changed", () => {
  test("a bed names the person, that it's where they sleep, and the place with the places around it, never the field's label", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const person = gm.entities.find((e) => e.id === gm.minds.characters[0]?.entity);
    const place = gm.places.find((p) => p.parent !== null);
    const around = gm.places.find((p) => p.id === place?.parent);
    const label = person?.fields.find((f) => f.id === "bed")?.label;
    if (!person || !place || !around || !label) throw new Error("the starter has no character with a bed field, or no place inside another");
    const notice = await noticeOf(rig, chatId, [{ op: "set", entity: person.id, field: "bed", value: place.id }]);
    expect(notice).toContain(person.name);
    expect(notice).toMatch(/sleep/i);
    expect(notice).toContain(place.name);
    expect(notice).toContain(around.name);
    expect(notice).not.toContain(label);
    expect(notice).not.toContain(place.id);
  });

  test("a thing as a bed reads by its name and where it is", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const person = gm.entities.find((e) => e.id === gm.minds.characters[0]?.entity);
    // Where a thing is, by name: what holds it, else its place.
    const whereOf = (thing: GmView["entities"][number]): string | undefined => (thing.holder ? gm.entities.find((e) => e.id === thing.holder)?.name : gm.places.find((p) => p.id === thing.place)?.name);
    // One whose whereabouts the line could only name by saying where it is: not the person, nor in the thing's own name.
    const thing = gm.entities.find((e) => {
      const where = whereOf(e);
      return !e.person && !e.gone && e.kind !== "account" && where !== undefined && !person?.name.includes(where) && !e.name.includes(where);
    });
    const where = thing ? whereOf(thing) : undefined;
    if (!person || !thing || !where) throw new Error("the starter has no thing somewhere");
    const notice = await noticeOf(rig, chatId, [{ op: "set", entity: person.id, field: "bed", value: thing.id }]);
    expect(notice).toContain(person.name);
    expect(notice).toContain(thing.name);
    expect(notice).toContain(where);
    expect(notice).not.toContain(thing.id);
  });

  test("any other field reads as the person's setting and its value, never its label glued to the value", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const person = gm.entities.find((e) => e.id === gm.minds.characters[0]?.entity);
    const label = person?.fields.find((f) => f.id === "occupation")?.label;
    if (!person || !label) throw new Error("the starter's characters have no occupation field");
    const notice = await noticeOf(rig, chatId, [{ op: "set", entity: person.id, field: "occupation", value: "boat mechanic" }]);
    expect(notice).toContain(person.name);
    expect(notice.toLowerCase()).toContain(label.toLowerCase());
    expect(notice).toContain("boat mechanic");
    expect(notice).not.toContain(`${person.name}: `);
    expect(notice).not.toContain(`${label} boat mechanic`);
  });

  test("a bulk move names how many and the place with the places around it", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const place = gm.places.find((p) => p.parent !== null);
    const around = gm.places.find((p) => p.id === place?.parent);
    if (!place || !around) throw new Error("the starter has no place inside another");
    const notice = bulkDone(gm, { kind: "move", to: place.id }, 3);
    expect(notice).toContain("3");
    expect(notice).toContain(place.name);
    expect(notice).toContain(around.name);
    expect(notice).not.toContain(place.id);
  });
});
