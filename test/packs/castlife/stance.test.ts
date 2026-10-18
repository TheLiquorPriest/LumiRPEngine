// The Stance section (DESIGN §6.6): for each person with the POV that it can see, what they know of
// it, their regard in words, their intent, and the cues for their secrets while those are kept. A
// person the POV can't see gets no line and is named in none; a cue that would carry an unrevealed
// secret or name something hidden is left out on its own; the lint says so where cues are written.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { EntityCue, WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { placeOfEntity } from "../../../src/engine/scope";
import type { WorldState } from "../../../src/engine/state";
import { ALL_PACKS } from "../../../src/packs/index";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with Maya at the POV's place, Relationships 3 (regard by axis, no decay), after `patch`. */
function scene(patch: (world: WorldDoc) => void = () => undefined): { world: WorldDoc; state: WorldState } {
  const world = modernUsWorld("w", "R");
  world.realism.levels.relationships = 3;
  patch(world);
  const state = startState(world);
  const here = placeOfEntity(state, world.pov);
  if (!here) throw new Error("the POV has no place");
  state.entities.maya!.fields.place = here;
  return { world, state };
}

function stance(world: WorldDoc, state: WorldState): string[] {
  return reg.renderers.filter((r) => r.slot === "stance").flatMap((r) => r.render(reg.context(world, state)));
}

/** The lines about one person, by name. */
function about(lines: readonly string[], name: string): string[] {
  return lines.filter((l) => l.startsWith(name));
}

function cues(world: WorldDoc, who: string, list: EntityCue[]): void {
  world.entities[who]!.cues = list;
}

describe("the Stance section", () => {
  test("someone the POV can't see gets no line, and no one's line names them", () => {
    const { world, state } = scene((w) => {
      for (const [id, name, visibility] of [["vex", "Vex Morrow", "secret"], ["nina", "Nina Hale", "known_by"]] as const) w.entities[id] = { id, kind: "person", name, tier: "supporting", fields: { place: "apartment" }, relations: [], visibility };
      cues(w, "maya", [{ text: "keeps an eye on Vex", flag: "watching" }, { text: "fidgets with her apron", flag: "watching" }]);
    });
    for (const id of ["vex", "nina"]) state.entities[id]!.fields.place = state.entities.maya!.fields.place ?? null;
    const lines = stance(world, state);
    expect(about(lines, "Maya Chen").length).toBeGreaterThan(0);
    for (const hidden of ["Vex", "Morrow", "Nina", "Hale"]) expect(lines.join("\n")).not.toContain(hidden);
    expect(lines.join("\n")).toContain("fidgets with her apron");
    // Once the POV knows Nina, she is someone it can see, and she gets her line.
    const known = fold(reg, world, state, [{ type: "link", rel: "knows", from: world.pov, to: "nina" }]);
    expect(about(stance(world, known), "Nina Hale").length).toBe(1);
  });

  test("regard is told in the world's band words, never as numbers, and a stranger is told as one", () => {
    const { world, state } = scene((w) => {
      w.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 45, trust: -40, respect: 35 } });
    });
    const maya = about(stance(world, state), "Maya Chen")[0] ?? "";
    // Warm and respected, but distrusted: the axes that part from the overall band are named in their words.
    expect(maya).toContain("warm");
    expect(maya).toContain("cold");
    expect(maya).not.toMatch(/\d/);
    // No regard and no `knows`: she doesn't know the POV, and no regard is claimed.
    const stranger = scene();
    const line = about(stance(stranger.world, stranger.state), "Maya Chen")[0] ?? "";
    expect(line).toContain("doesn't know you");
    expect(line).not.toContain("regard");
  });

  test("intent: what she is doing and a public agenda's cue; a secret agenda never shows", () => {
    const { world, state } = scene((w) => {
      w.tracks.a_bakery = { id: "a_bakery", kind: "agenda", label: "Open a bakery", owner: "maya", start: "save", visibility: "public", stages: { save: { label: "Save money", priority: 2, cue: "talks up her bakery plans to every customer", next: [] } } };
      w.tracks.b_mayor = { id: "b_mayor", kind: "agenda", label: "Poison the mayor", owner: "maya", start: "buy", visibility: "secret", stages: { buy: { label: "Buy arsenic", priority: 1, next: [] } } };
    });
    state.entities.maya!.fields.activity = "work_shift";
    const maya = about(stance(world, state), "Maya Chen").join("\n");
    expect(maya).toContain("work shift");
    expect(maya).toContain("talks up her bakery plans to every customer");
    for (const secret of ["Poison the mayor", "Buy arsenic", "Open a bakery"]) expect(maya).not.toContain(secret);
  });

  test("intent: the block of her day that her own recorded choice settled", () => {
    const { world, state } = scene((w) => {
      w.entities.maya!.fields.chores = [
        { label: "Sort the mail", minutes: 30, utility: 20 },
        { label: "Water the plants", minutes: 30, utility: 20 },
      ];
    });
    const tie = dayPlan(reg.context(world, state), "maya").ties.find((t) => t.via === "seed" && t.options.every((o) => o.startsWith("chore:")));
    if (!tie) throw new Error("no close call between the chores");
    const before = about(stance(world, state), "Maya Chen").join("\n");
    expect(before).not.toContain("Sort the mail");
    expect(before).not.toContain("Water the plants");
    const choice = tie.options.find((o) => o !== tie.chosen) ?? "";
    const after = fold(reg, world, state, [{ type: "castlife.decision", data: { key: tie.key, choice } }]);
    const [chosen, other] = choice === "chore:0" ? ["Sort the mail", "Water the plants"] : ["Water the plants", "Sort the mail"];
    const maya = about(stance(world, after), "Maya Chen").join("\n");
    expect(maya).toContain(chosen);
    expect(maya).not.toContain(other);
  });

  describe("a cue shows while its secret is kept, and goes once it is out", () => {
    const keyed: [string, (w: WorldDoc) => void, LedgerEvent[]][] = [
      ["a story flag", (w) => cues(w, "maya", [{ text: "keeps glancing at the back room", flag: "back_room_found" }]), [{ type: "story.flag", data: { name: "back_room_found", value: true } }]],
      [
        "secret lore",
        (w) => {
          w.lore.maya_debts = { id: "maya_debts", title: "Maya's debts", content: "Maya owes the loan shark on Fifth Street more than she earns in a year.", keys: [], links: [], secret: true, gate: "flag('debts_known')" };
          cues(w, "maya", [{ text: "keeps glancing at the back room", lore: "maya_debts" }]);
        },
        [{ type: "story.flag", data: { name: "debts_known", value: true } }],
      ],
      [
        "a track",
        (w) => {
          w.tracks.s_past = { id: "s_past", kind: "secret", label: "Something about Toledo", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [] }, found: { label: "Found", next: [], truth: "Maya once ran card games out of a Toledo basement." } } };
          cues(w, "maya", [{ text: "keeps glancing at the back room", track: "s_past" }]);
        },
        [{ type: "stage", track: "s_past", to: "found" }, { type: "engine.revealed", data: { track: "s_past", stage: "found" } }],
      ],
      [
        "a track she owns, by its stage's cue",
        (w) => {
          w.tracks.s_till = { id: "s_till", kind: "secret", label: "The short till", owner: "maya", start: "quiet", visibility: "secret", stages: { quiet: { label: "Quiet", cue: "keeps glancing at the back room", next: [] }, told: { label: "Told", next: [], truth: "Maya has been covering the cafe's short till from her own wages." } } };
        },
        [{ type: "stage", track: "s_till", to: "told" }, { type: "engine.revealed", data: { track: "s_till", stage: "told" } }],
      ],
    ];
    for (const [name, patch, reveal] of keyed) {
      test(name, () => {
        const { world, state } = scene(patch);
        expect(stance(world, state).join("\n")).toContain("keeps glancing at the back room");
        expect(stance(world, fold(reg, world, state, reveal)).join("\n")).not.toContain("keeps glancing at the back room");
      });
    }
  });

  test("a cue that would carry an unrevealed secret or name something hidden is dropped on its own", () => {
    const { world, state } = scene((w) => {
      w.tracks.s_till = { id: "s_till", kind: "secret", label: "The short till", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: "Maya covers the short till" } } };
      w.lore.toledo = { id: "toledo", title: "The Toledo years", content: "What happened before Riverton.", keys: [], links: [], secret: true, gate: "false" };
      w.entities.vex = { id: "vex", kind: "person", name: "Vex Morrow", tier: "supporting", fields: {}, relations: [], visibility: "secret" };
      cues(w, "maya", [
        { text: "everyone can see Maya covers the short till", track: "s_till" },
        { text: "goes quiet whenever Vex is mentioned", track: "s_till" },
        { text: "won't talk about the Toledo years", track: "s_till" },
        { text: "fidgets with her apron", track: "s_till" },
      ]);
    });
    const shown = stance(world, state).join("\n");
    expect(shown).toContain("fidgets with her apron");
    for (const dropped of ["covers the short till", "Vex", "Toledo"]) expect(shown).not.toContain(dropped);
  });
});

describe("cue lint (castlife.cues)", () => {
  const lint = (world: WorldDoc) => reg.lints.filter((l) => l.code === "castlife.cues").flatMap((l) => l.check(world));

  test("a cue that gives its secret away is an error; one naming what the player may not know is a warning", () => {
    const world = modernUsWorld("w", "R");
    world.tracks.s_till = { id: "s_till", kind: "secret", label: "The short till", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: "Maya covers the short till" } } };
    world.lore.toledo = { id: "toledo", title: "The Toledo years", content: "What happened before Riverton.", keys: [], links: [], secret: true, gate: "false" };
    cues(world, "maya", [
      { text: "Maya covers the short till and flinches at audits", track: "s_till" },
      { text: "won't talk about the Toledo years", track: "s_till" },
      { text: "goes quiet when anyone mentions Maya's flat", track: "s_till" },
      { text: "fidgets with her apron", track: "s_till" },
    ]);
    const issues = lint(world);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.path)).toEqual(["entities.maya.cues.0.text"]);
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.path)).toEqual(["entities.maya.cues.1.text", "entities.maya.cues.2.text"]);
  });

  test("a cue that can never show: no text, no secret or two, one the world doesn't have, or one that hides nothing", () => {
    const world = modernUsWorld("w", "R");
    world.lore.cafe = { id: "cafe", title: "The cafe", content: "Open early.", keys: [], links: [] };
    cues(world, "maya", [
      { text: "" },
      { text: "hums" },
      { text: "hums", flag: "a", track: "b" },
      { text: "hums", lore: "nowhere" },
      { text: "hums", track: "nothing" },
      { text: "hums", lore: "cafe" },
      { text: "hums", track: "first_week" },
    ]);
    world.entities.wallet!.cues = [{ text: "rattles", flag: "a" }];
    const issues = lint(world).map((i) => [i.severity, i.path]);
    expect(issues).toEqual([
      ["error", "entities.maya.cues.0.text"],
      ["error", "entities.maya.cues.1"],
      ["error", "entities.maya.cues.2"],
      ["error", "entities.maya.cues.3.lore"],
      ["error", "entities.maya.cues.4.track"],
      ["warning", "entities.maya.cues.5.lore"],
      ["warning", "entities.maya.cues.6.track"],
      ["warning", "entities.wallet.cues"],
    ]);
  });

  test("an owned track's stage cue that names what the player may not know is a warning", () => {
    const world = modernUsWorld("w", "R");
    world.tracks.s_flat = { id: "s_flat", kind: "secret", label: "Behind the door", owner: "maya", start: "quiet", visibility: "secret", stages: { quiet: { label: "Quiet", cue: "hurries home to Maya's flat after every shift", next: [] } } };
    expect(lint(world).map((i) => [i.severity, i.path])).toEqual([["warning", "tracks.s_flat.stages.quiet.cue"]]);
  });
});
