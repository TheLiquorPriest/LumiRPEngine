// What a chat's state view builds from a state: built in stretches as one read pass, a panel of many pages a page at a time, it comes
// to what one pass builds whole; it is kept under the store's key for the state, so a second ask builds nothing, the store letting the
// state go to fold others loses it not, and a turn makes another.

import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../src/engine/places-in-play";
import { readPass } from "../../src/engine/read-pass";
import type { JsonValue } from "../../src/shared/json";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import { CHAT, makeBed, USER } from "./bed";

describe("a chat's state view", () => {
  test("built in stretches, a page at a time, has the panels one pass builds whole", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    const view = await bed.state();
    const state = bed.store.user(USER).headState(CHAT).state.world;
    const doc = bed.store.env.worlds(state.revision);
    if (doc === undefined) throw new Error("the chat's world is not kept");
    const world = playedWorld(doc, state);
    const registry = bed.store.env.registry;
    const whole = readPass(() => {
      const ctx = registry.context(world, state);
      return Object.fromEntries(registry.views.map((v): [string, JsonValue] => [v.panel, v.build(ctx, { mapDisplay: null, mapConfig: MAP_DEFAULTS })]));
    });
    // The organisations' pages are built a page at a time: more than one here.
    expect(Object.keys(view.panels["orgs.org"] as object).length).toBeGreaterThan(1);
    // The quest log takes the quests' trails after it is built; every other panel is as its pack builds it.
    const built = Object.fromEntries(Object.entries(view.panels).filter(([panel]) => panel !== "story.quests"));
    const asWhole = Object.fromEntries(Object.entries(whole).filter(([panel]) => panel !== "story.quests"));
    expect(JSON.parse(JSON.stringify(built))).toEqual(JSON.parse(JSON.stringify(asWhole)));
  });

  test("is kept under the store's key for its state, past the store letting the state go, until a turn", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const turns = [];
    for (let i = 0; i < 12; i++) turns.push(await bed.turn());
    const first = await bed.state();
    expect((await bed.state()).panels).toBe(first.panels);
    // Reading every turn's state and start folds more states than the store holds for a chat: the head's is let go.
    const s = bed.store.user(USER);
    const head = s.headState(CHAT);
    for (const t of turns) {
      s.stateAt(t.id);
      s.startOf(t.id);
    }
    expect(s.headState(CHAT)).not.toBe(head);
    expect((await bed.state()).panels).toBe(first.panels);
    await bed.turn();
    const next = await bed.state();
    expect(next.panels).not.toBe(first.panels);
    expect(next.hud?.clock.minutes).toBe(s.headState(CHAT).state.world.clock);
  });
});
