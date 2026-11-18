// The World page's press that puts a rule set on a chat's world, through its service: it said first, then made, in the words of
// `.prompts/play-answers.md`, the Undo the answer names taking it all back; a chat behind its world is refused in words. Every world and
// chat here is invented.

import { expect, test } from "bun:test";
import { RulesService } from "../../src/play/rules";
import { presetAdjudication } from "../../src/shared/adjudication";
import { makeBed, USER, worldsOn } from "../build-mode/bed";
import { GUIDANCE } from "./bed";

test("a rule set is said first, then put on; its Undo takes the revision and the level back, and a chat behind its world is refused in words", async () => {
  const bed = makeBed();
  const worlds = worldsOn(bed);
  const made = await worlds.create(USER, "Fernwick", "fantasy_town");
  const s = bed.store.user(USER);
  await bed.writes.run(() => s.createChat({ id: "c", world: made.world.id, revision: made.revision }));
  const rules = new RulesService({ worlds, store: bed.store, writes: bed.writes, guidance: GUIDANCE });
  const level = (): number | undefined => s.headState("c").state.world.realism.levels.d20;

  const said = await rules.put(USER, "c", { rules: "classic", preview: true });
  expect(said).toMatchObject({ made: false, undo: null });
  expect(said.words[0]).toContain("Nothing was changed");
  expect(level()).not.toBe(1);

  const done = await rules.put(USER, "c", { rules: "classic" });
  expect(done.made).toBe(true);
  expect(done.words.join(" ")).toContain("new revision");
  expect(done.words.join(" ")).toContain("no sheet yet");
  expect(level()).toBe(1);
  expect(s.headState("c").state.world.revision).not.toBe(made.revision);

  const undone = await worlds.chats.undoUpgrade(USER, "c", done.undo ?? "");
  expect(undone.undone).toBe(true);
  expect(level()).not.toBe(1);
  expect(s.headState("c").state.world.revision).toBe(made.revision);

  // The world has a newer revision than the chat plays now: refused, in words, with nothing changed.
  const head = (await worlds.read(USER, made.world.id)).revision;
  await worlds.draft(USER, made.world.id, { op: "set", part: "ruleset", value: { adjudication: presetAdjudication("narrative") } as never });
  await worlds.commit(USER, made.world.id, { base: head, source: "build" });
  const behind = await rules.put(USER, "c", { rules: "classic" });
  expect(behind.made).toBe(false);
  expect(behind.words[0]).toContain("older revision");
});
