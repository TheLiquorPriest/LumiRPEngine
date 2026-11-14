import { describe, expect, test } from "bun:test";
import type { SessionRow, TurnRow } from "../../src/store";
import { sceneSession } from "../../src/story/index";
import type { StoryWrite } from "../../src/story/record";
import { CHAT, openTable, type Table, USER } from "./rig";

/**
 * A turn begun after the player's message, played the way the turn lane plays one: in the session
 * `sceneSession` names, or a new one for its scene; the turn's writes; then, where the record's scene
 * changed, the session it played in closed and the new scene's opened, both as this turn's work.
 */
async function played(t: Table, turn: TurnRow, writes: readonly StoryWrite[] = []): Promise<{ playedIn: SessionRow; closed: boolean; opened: SessionRow | null }> {
  const at = sceneSession(t.store, USER, CHAT, turn.id);
  const playedIn = at.session ?? (await t.writes.run(() => t.s.openSession({ chat: CHAT, scene: at.scene, turn: turn.id })));
  if (writes.length > 0) await t.write(turn, writes);
  const after = sceneSession(t.store, USER, CHAT, turn.id);
  if (after.session?.id === playedIn.id) return { playedIn, closed: false, opened: null };
  await t.writes.run(() => t.s.closeSession(playedIn.id, turn.id));
  const opened = after.session === null && after.scene !== "" ? await t.writes.run(() => t.s.openSession({ chat: CHAT, scene: after.scene, turn: turn.id })) : null;
  return { playedIn, closed: true, opened };
}

describe("scenes and sessions", () => {
  test("opening a scene opens a session, closing it closes it, and a session opens with the summary of the scene before it", async () => {
    const t = await openTable();
    const first = await t.begin();
    const one = await played(t, first);
    expect(one).toMatchObject({ playedIn: { scene: "", openedBy: first.id }, closed: false });
    await t.tie(first);

    // The Author opens a scene: the session the turn played in closes, and the scene's opens, as this turn's work.
    const second = await t.begin();
    const two = await played(t, second, [{ part: "scene", item: null, value: { title: "The ford" } }]);
    const ford = t.record(second).of("scene")[0]?.id ?? "";
    expect(two).toMatchObject({ playedIn: { id: one.playedIn.id }, closed: true, opened: { scene: ford, openedBy: second.id } });
    expect(t.s.session(one.playedIn.id)?.closedBy).toBe(second.id);
    await t.tie(second);

    // The next turn plays in the scene's session; writing to the scene changes nothing.
    const third = await t.begin();
    const three = await played(t, third, [{ part: "scene", item: ford, value: { tension: "The water is rising." } }]);
    expect(three).toEqual({ playedIn: two.opened as SessionRow, closed: false, opened: null });
    await t.tie(third);

    // Closing the scene closes its session; no scene is open, so none opens until the next turn, with the summary.
    const fourth = await t.begin();
    const four = await played(t, fourth, [{ part: "scene", item: ford, value: { close: true, summary: "Wren crosses the ford, soaked." } }]);
    expect(four).toMatchObject({ playedIn: { scene: ford }, closed: true, opened: null });
    await t.tie(fourth);
    const fifth = await t.begin();
    expect(sceneSession(t.store, USER, CHAT, fifth.id)).toEqual({ session: null, scene: "", summary: "Wren crosses the ford, soaked." });
  });

  test("closing belongs to the turn that did it: swiped, the scene and its session are open again; shown again, closed", async () => {
    const t = await openTable();
    const first = await t.begin();
    await played(t, first, [{ part: "scene", item: null, value: { title: "The ferry" } }]);
    await t.tie(first);
    const ferry = t.record().of("scene")[0]?.id ?? "";
    const second = await t.begin();
    const inFerry = (await played(t, second)).playedIn;
    expect(inFerry.scene).toBe(ferry);
    await t.tie(second);
    const closing = await t.begin();
    await played(t, closing, [
      { part: "scene", item: ferry, value: { close: true, summary: "Wren crosses for one silver." } },
      { part: "scene", item: null, value: { title: "The far bank" } },
    ]);
    const closed = await t.tie(closing);
    expect(t.s.session(inFerry.id)?.closedBy).toBe(closing.id);

    // Another attempt at that reply: the ferry is open on its path, and its session is the one in force.
    const again = await t.swipe();
    expect(sceneSession(t.store, USER, CHAT, again.id)).toEqual({ session: inFerry, scene: ferry, summary: null });
    await t.tie(again, "another reply");

    // The first attempt shown again: the ferry is closed and the far bank open, with the session that turn opened for it.
    await t.showSwipe(closed);
    const next = await t.begin();
    const at = sceneSession(t.store, USER, CHAT, next.id);
    const bank = t.record().of("scene").find((s) => s.fields.title === "The far bank")?.id ?? "";
    expect(at.scene).toBe(bank);
    expect(at.session).toMatchObject({ scene: bank, openedBy: closing.id });
    expect(at.summary).toBe("Wren crosses for one silver.");
  });
});
