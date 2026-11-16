// A level's typed systems (Iface-40): a person's level gives their accounts with balance, their things with the four facts, their
// groups and their sheet, each named by its system; a thing's level gives its four facts; a turn joined to another is told as a fact
// and nothing is read there. Every name is invented (the starter world's).

import { expect, test } from "bun:test";
import { systemsAt } from "../../src/iface/systems";
import { JoinedTurnError } from "../../src/store";
import { CHAT, makeBed, USER } from "../play/bed";

test("a person's level gives each system's view as it keeps it", async () => {
  const bed = makeBed();
  await bed.plays("modern_slice_of_life");
  await bed.turn();
  const read = systemsAt(bed.store, USER, CHAT, "entity:pov", null);
  expect(read.systems.map((s) => s.system)).toEqual(["economy", "gear", "orgs", "vehicles", "sheets"]);
  const rows = (system: string, title: string) => read.systems.find((s) => s.system === system)?.sections.find((s) => s.title.startsWith(title))?.rows ?? [];
  expect(rows("economy", "Your checking account").find((r) => r.label === "Balance")?.value).toBe("$1,842.17");
  expect(rows("gear", "Theirs, with them").find((r) => r.label === "Wallet")?.value).toContain("Whose: Jordan Ellis's.");
  expect(rows("orgs", "Alder Automotive").find((r) => r.label === "Position")?.value).toBe("Mechanic");
  const truck = systemsAt(bed.store, USER, CHAT, "entity:pov_truck", null);
  expect(truck.systems.find((s) => s.system === "gear")?.sections[0]?.rows.map((r) => r.label)).toEqual(["Where it is", "Who has it", "Whose it is", "Who may use it"]);
  expect(systemsAt(bed.store, USER, CHAT, "world", null).systems.map((s) => s.system)).toEqual(["economy", "calendar", "weather"]);
});

test("asked at a joined turn's id, the read is refused naming the turn it joined and reads no state", async () => {
  const bed = makeBed();
  await bed.plays("modern_slice_of_life");
  const first = await bed.turn();
  const s = bed.store.user(USER);
  const held = await bed.writes.run(() => {
    const turn = s.beginTurn({ chat: CHAT, kind: "continue", on: first.node });
    s.joinTurn(turn.id, first.id);
    return turn.id;
  });
  expect(() => systemsAt(bed.store, USER, CHAT, "world", held)).toThrow(JoinedTurnError);
  expect(() => systemsAt(bed.store, USER, CHAT, "world", first.id)).not.toThrow();
});
