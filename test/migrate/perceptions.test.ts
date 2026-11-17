// Who perceived each old beat, and how far each principal had taken it in, as the cast's perceptions (STANDALONE-PLAN §7.5, §15.2); and a
// casting pin he set in RPE before playing the chat, which a later run leaves as he set it and names.

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { castAt } from "../../src/cast/path";
import { CastRecord, chatLine, findCharacter, pinCasting } from "../../src/cast/record";
import { migrate } from "../../src/migrate/migrate";
import type { Beat, Rec } from "../../src/shared/ledger";
import { buildFixture, CHAT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { look, turnOf } from "./look";
import { editRecord } from "./today-edits";
import { TREE as tree } from "./tree";

const beat = (b: Partial<Beat> & { id: string; at: number }): Beat => ({ turn: "gen-1", where: null, by: "world", kind: "happen", what: "Fog came.", surface: "Fog.", exposure: [], decidedBy: { agent: "author" }, ...b });

async function withFixture(run: (fixture: Fixture, data: string) => Promise<void>): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await run(fixture, join(fixture.root, "rpe-data"));
  } finally {
    await fixture.remove();
  }
}

describe("what his characters perceived", () => {
  test("who perceived each old beat is in the cast, and a principal is given only what it had not taken in", async () => {
    await withFixture(async (fixture, data) => {
      // Ada saw part of the fog and told Bo; the lamp was lit before them both; her mind had taken in the fog and not the lamp.
      editRecord(fixture, "m-h2", 0, (rec: Rec) => ({ ...rec, story: { ...rec.story, beats: [beat({ id: "b1", at: 0, exposure: [{ who: PEOPLE.ada.entity, reach: "part", got: "A grey thing on the water." }, { who: PEOPLE.bo.entity, reach: "told", from: PEOPLE.ada.entity, got: "Ada says fog came." }, { who: "world", reach: "whole" }] })] } }));
      editRecord(fixture, "m-h6", 0, (rec: Rec) => ({
        ...rec,
        story: { ...rec.story, beats: (rec.story?.beats ?? []).map((b) => ({ ...b, exposure: [...b.exposure, { who: PEOPLE.ada.entity, reach: "whole" as const }] })), cast: [...(rec.story?.cast ?? []), { entity: PEOPLE.ada.entity, standing: "principal" as const, pinned: true, digestedTo: "b1" }] },
      }));
      const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
      expect(run.ran).toBe(true);
      expect(run.report.carried?.story).toMatchObject({ perceptions: 4, takenIn: 1, exposureLeft: 1, digestedUnknown: 0 });
      look(data, (db, s, store) => {
        const line = chatLine(s, CHAT.harness);
        const [ada, bo] = [PEOPLE.ada.name, PEOPLE.bo.name].map((name) => findCharacter(db, USER, line, name));
        if (ada === null || bo === null) throw new Error("a person of the chat has no character");
        const record = CastRecord.read(store, USER, castAt(s, CHAT.harness, turnOf(db, CHAT.harness, "m-h6", 0)));
        const adas = record.of(ada.id, "perception");
        const bos = record.of(bo.id, "perception");
        // Ada: part of the fog, taken in; the lamp, whole, not yet taken in. Bo: told of the fog by Ada; saw the lamp.
        expect(adas.map((p) => [p.fields.beat, p.fields.reach, p.fields.taken === true])).toEqual([["b:b1", "part", true], ["b:b2", "whole", false]]);
        expect(adas[0]?.fields.content).toBe("A grey thing on the water.");
        expect(bos.map((p) => [p.fields.beat, p.fields.reach, p.fields.told_by ?? null, p.fields.taken === true])).toEqual([["b:b1", "told", PEOPLE.ada.name, false], ["b:b2", "whole", null, false]]);
      });
    });
  });

  test("a later run keeps the casting pin he set in RPE, as he set it, and names it", async () => {
    await withFixture(async (fixture, data) => {
      const at = (hour: number) => ({ data, env: fixture.named, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
      expect((await migrate(fixture.sources, at(9))).ran).toBe(true);
      // In RPE, before the chat is played: Bo, whom today's side never pinned, is pinned a principal.
      const boId = look(data, (db, s) => {
        const bo = findCharacter(db, USER, chatLine(s, CHAT.harness), PEOPLE.bo.name);
        if (bo === null) throw new Error("Bo has no character");
        pinCasting(db, USER, bo.id, "principal");
        return bo.id;
      });
      const second = await migrate(fixture.sources, at(10));
      expect(second.ran).toBe(true);
      expect(second.report.carried?.story.pinsKept).toEqual([{ chat: CHAT.harness, character: boId, standing: "principal" }]);
      look(data, (db, s) => {
        const line = chatLine(s, CHAT.harness);
        expect(findCharacter(db, USER, line, PEOPLE.bo.name)?.pinned).toBe("principal");
        expect(findCharacter(db, USER, line, PEOPLE.ada.name)?.pinned).toBe("principal");
      });
    });
  });
});
