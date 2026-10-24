// Character minds, the pure core (DESIGN §24): the fidelity ladder and what moves a character on it,
// which minds run (the Live limit and the refresh triggers), the narrator's Minds section under each
// secrecy, the GM's controls, and that a mind never reaches the Journal.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { MindsSettings } from "../../../src/shared/minds";
import { DEFAULT_WORLD_MINDS, MINDS_DEFAULTS } from "../../../src/shared/minds";
import type { WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import type { WorldState } from "../../../src/engine/state";
import { placeOfEntity } from "../../../src/engine/scope";
import { unrevealedSecrets } from "../../../src/engine/visibility";
import { ALL_PACKS } from "../../../src/packs/index";
import { mindEdit } from "../../../src/packs/minds/core/edit";
import { fidelityOf, pickMinds } from "../../../src/packs/minds/core/fidelity";
import { mindLines } from "../../../src/packs/minds/core/section";
import { readCharacter } from "../../../src/packs/minds/core/state";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const NO_TEXT = { user: "", reply: "" };
const SECRET = "Maya skims the till";

/** Riverton with a secret about Maya (unrevealed), after `patch`. */
function world(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const w = modernUsWorld("w", "R");
  w.tracks.s_till = { id: "s_till", kind: "secret", label: "The till", start: "hidden", stages: { hidden: { label: "Hidden", next: [], truth: SECRET } }, visibility: "secret" };
  patch(w);
  return w;
}

function at(w: WorldDoc, state: WorldState, who: string, place: string): WorldState {
  return fold(reg, w, state, [{ type: "set", entity: who, field: "place", value: place }]);
}

function round(state: WorldState): LedgerEvent {
  return { type: "minds.round", data: { at: state.clock, on: true } };
}

function mind(state: WorldState, entity: string, rest: { monologue?: string; depiction?: string; level?: string; place?: string | null; interrupt?: string; moment?: "turn" | "beat" } = {}): LedgerEvent {
  return {
    type: "minds.mind",
    data: {
      entity,
      at: state.clock,
      place: rest.place ?? null,
      level: rest.level ?? "live",
      moment: rest.moment ?? "turn",
      reason: "live",
      monologue: rest.monologue ?? "I should keep my head down today.",
      depiction: rest.depiction ?? "keeps glancing at the door while wiping the counter",
      intent: "Get through the shift without trouble.",
      reactions: ["if asked about money, changes the subject"],
      plans: [{ id: "p1", what: "Visit her sister", kind: "visit", when: { from: state.clock + 600, to: state.clock + 720 }, where: null, with: [], priority: 3, status: "open", made: state.clock, source: "mind", closed: null, reason: null }],
      mood: "wary",
      interrupt: rest.interrupt ? { reason: rest.interrupt } : null,
      withheld: false,
    },
  };
}

const score = (w: WorldDoc, s: WorldState, who: string, texts = NO_TEXT) => fidelityOf(reg.context(w, s), texts).find((f) => f.entity === who);

describe("the fidelity ladder", () => {
  test("proximity, being named, story tracks and role facets each move a character up; pins decide", () => {
    const w = world((x) => {
      x.classifications.role = { id: "role", label: "Role", multiple: false, values: { antagonist: { label: "Antagonist" }, villain: { label: "Villain", parent: "antagonist" } } };
      x.entities.jordan!.class = { role: ["villain"] };
      x.tracks.a_jordan = { id: "a_jordan", kind: "agenda", label: "Jordan's plan", owner: "jordan", start: "one", stages: { one: { label: "Scheming", next: [{ to: "two", when: "false" }] }, two: { label: "Done", next: [] } }, visibility: "secret" };
    });
    const base = startState(w);
    const away = score(w, base, "maya");
    const here = score(w, at(w, base, "maya", "apartment"), "maya");
    // In the scene, and so seen with the POV just now as well.
    expect(here!.reasons.find((r) => r.label === "In the scene")?.points).toBe(45);
    expect(here!.score - away!.score).toBe(45 + 10);
    const named = score(w, base, "maya", { user: "I text Maya about lunch.", reply: "" });
    expect(named!.score - away!.score).toBe(40);
    expect(named!.reasons.map((r) => r.label)).toContain("Named this turn");
    // A villain owning an agenda under way: the owner's points and the antagonist role's, through its parent value.
    const jordan = score(w, base, "jordan");
    expect(jordan!.reasons.map((r) => r.label)).toEqual(expect.arrayContaining(["Owns a story track", "Story role"]));
    expect(jordan!.reasons.find((r) => r.label === "Story role")?.points).toBe(20);
    // The GM's pin decides whatever the score, and says so.
    const pinned = fold(reg, w, base, [{ type: "minds.pin", data: { entity: "rosa", level: "live" } }]);
    expect(score(w, pinned, "rosa")?.level).toBe("live");
    // The author's `never` wins over `always`, and over a high score.
    const never = world((x) => {
      x.minds = { never: { ids: ["maya"] }, always: { ids: ["maya", "rosa"] } } as WorldDoc["minds"];
    });
    const s2 = at(never, startState(never), "maya", "apartment");
    expect(score(never, s2, "maya", { user: "Maya!", reply: "" })?.level).toBe("background");
    expect(score(never, s2, "rosa")?.level).toBe("live");
  });

  test("thresholds are the world's, read in order", () => {
    const w = world((x) => {
      x.minds = { thresholds: { live: 10, near: 50, far: 5 } } as WorldDoc["minds"];
    });
    // Live below Near reads as Near's threshold: 50.
    const s = at(w, startState(w), "maya", "apartment");
    const f = score(w, s, "maya");
    expect(f!.score).toBeGreaterThanOrEqual(50);
    expect(f!.level).toBe("live");
  });

  test("however much story they carry, someone elsewhere and unnamed is Near at most; at hand or named, they are Live", () => {
    // A threshold every character clears, so only being at hand decides.
    const w = world((x) => {
      x.minds = { thresholds: { live: 1, near: 0.5, far: 0 } } as WorldDoc["minds"];
    });
    const base = startState(w);
    const away = score(w, base, "maya");
    expect(away!.score).toBeGreaterThanOrEqual(1);
    expect(away!.level).toBe("near");
    expect(away!.reasons.map((r) => r.label)).toContain("Not at hand, so Near at most");
    expect(score(w, at(w, base, "maya", "apartment"), "maya")?.level).toBe("live");
    // Down the hall, under the same building: close by scores, but isn't at hand.
    const hall = score(w, at(w, base, "maya", "apartment_hall"), "maya");
    expect(hall!.reasons.map((r) => r.label)).toContain("Close by");
    expect(hall!.level).toBe("near");
    expect(score(w, base, "maya", { user: "I text Maya about lunch.", reply: "" })?.level).toBe("live");
    // A pin still decides: the GM can keep someone far away Live.
    const pinned = fold(reg, w, base, [{ type: "minds.pin", data: { entity: "maya", level: "live" } }]);
    expect(score(w, pinned, "maya")?.level).toBe("live");
  });

  test("regard either way, knowing the POV, a world rule naming them and what is pending with the POV each move them up", () => {
    const s0 = startState(world());
    const before = score(world(), s0, "jordan");
    if (!before) throw new Error("no Jordan");
    /** What `patch` adds to Jordan's score, and the reasons with points it gives. */
    const gain = (patch: (w: WorldDoc) => void) => {
      const w = world(patch);
      const f = score(w, startState(w), "jordan");
      return { points: Math.round(((f?.score ?? 0) - before.score) * 10) / 10, reasons: (f?.reasons ?? []).filter((r) => r.points !== 0 && !before.reasons.some((b) => b.label === r.label)).map((r) => r.label) };
    };
    // Regard counts its stronger way round, as a share of 100, warm or hostile alike.
    expect(gain((w) => w.entities.you?.relations.push({ type: "regard", to: "jordan", fields: { warmth: -90, trust: -90, respect: -90 } }))).toEqual({ points: 9, reasons: ["Regard with you"] });
    expect(gain((w) => w.entities.jordan?.relations.push({ type: "regard", to: "you", fields: { warmth: 40, trust: 40, respect: 40 } }))).toEqual({ points: 4, reasons: ["Regard with you"] });
    // Knowing the POV, or being known by it.
    expect(gain((w) => w.entities.jordan?.relations.push({ type: "knows", to: "you" }))).toEqual({ points: 10, reasons: ["Knows you"] });
    expect(gain((w) => w.entities.you?.relations.push({ type: "knows", to: "jordan" }))).toEqual({ points: 10, reasons: ["Knows you"] });
    // A world rule that names them.
    expect(gain((w) => void (w.rules.audit = { id: "audit", on: { tick: "turn" }, when: "jordan.cash < 0", do: [] }))).toEqual({ points: 5, reasons: ["Named by a world rule"] });
    // What is pending with the POV, three at most: an appointment together still to come counts; one past doesn't.
    const appointments = (...offsets: number[]) => (w: WorldDoc) => void (w.entities.jordan!.fields.appointments = offsets.map((m) => ({ at: s0.clock + m, with: ["you"] })));
    expect(gain(appointments(60))).toEqual({ points: 15, reasons: ["1 pending with you"] });
    expect(gain(appointments(60, 120, 180, 240, 300))).toEqual({ points: 45, reasons: ["3 pending with you"] });
    expect(gain(appointments(-60))).toEqual({ points: 0, reasons: [] });
  });
});

describe("minds lint", () => {
  test("a minds config the engine can't play as written says so, part by part; a minds template's signals are ignored", () => {
    const w = world((x) => {
      x.minds = {
        secrecy: "loud",
        weights: { here: 500, regard: 5, roles: { hero: 10 }, charm: 3 },
        thresholds: { live: 10, near: 50, far: 60 },
        always: {},
        never: { kind: "spaceship" },
        memory: { notes: { show: 2.5 }, consolidate: { enabled: "yes" }, dreams: {} },
        colour: "blue",
      } as unknown as WorldDoc["minds"];
      x.steps.mind_x = { id: "mind_x", purpose: "mind", template: "Think as {{character}}.", output: "text", signals: ["always"] };
    });
    const issues = lintWorld(w, reg).filter((i) => i.code.startsWith("minds."));
    expect(issues.map((i) => `${i.severity} ${i.code} ${i.path}`).sort()).toEqual(
      [
        "error minds.config minds.secrecy",
        "error minds.config minds.weights.here",
        "warning minds.config minds.weights.roles.hero",
        "warning minds.config minds.weights.charm",
        "warning minds.config minds.thresholds.live",
        "warning minds.config minds.thresholds.near",
        "warning minds.config minds.always",
        "error minds.config minds.never",
        "error minds.config minds.memory.notes.show",
        "error minds.config minds.memory.consolidate.enabled",
        "warning minds.config minds.memory.dreams",
        "warning minds.config minds.colour",
        "info minds.step_signals steps.mind_x.signals",
      ].sort(),
    );
    // The defaults, written out, are clean where the world has the role their weights name.
    const clean = world((x) => {
      x.classifications.role = { id: "role", label: "Role", multiple: false, values: { antagonist: { label: "Antagonist" } } };
      x.minds = structuredClone(DEFAULT_WORLD_MINDS) as unknown as WorldDoc["minds"];
    });
    expect(lintWorld(clean, reg).filter((i) => i.code.startsWith("minds."))).toEqual([]);
  });
});

describe("which minds run", () => {
  const settings = (patch: Partial<MindsSettings> = {}): MindsSettings => ({ ...MINDS_DEFAULTS, ...patch });

  test("Live minds run up to the limit, best score first; a GM's refresh always runs", () => {
    const w = world();
    let s = startState(w);
    for (const who of ["maya", "jordan", "rosa"]) s = at(w, s, who, "apartment");
    const ctx = reg.context(w, s);
    const scores = fidelityOf(ctx, NO_TEXT);
    const live = scores.filter((x) => x.level === "live").map((x) => x.entity);
    expect(live.length).toBeGreaterThanOrEqual(2);
    const picked = pickMinds(ctx, scores, NO_TEXT, settings({ liveLimit: 1, refreshLimit: 0 }));
    expect(picked.filter((p) => p.reason === "live").map((p) => p.entity)).toEqual([live[0]!]);
    const asked = fold(reg, w, s, [{ type: "minds.refresh", data: { entity: live[1]! } }]);
    const again = pickMinds(reg.context(w, asked), fidelityOf(reg.context(w, asked), NO_TEXT), NO_TEXT, settings({ liveLimit: 1, refreshLimit: 0 }));
    expect(again.find((p) => p.entity === live[1])?.reason).toBe("gm");
    // "No limit" runs every Live mind.
    expect(pickMinds(ctx, scores, NO_TEXT, settings({ liveLimit: "none" })).filter((p) => p.reason === "live").length).toBe(live.length);
  });

  test("Near minds refresh on their triggers: first, entering the scene, being named, turns and time", () => {
    const w = world((x) => {
      x.minds = { thresholds: { live: 500, near: 1, far: 0 } } as WorldDoc["minds"];
    });
    const base = startState(w);
    const pick = (s: WorldState, texts = NO_TEXT, patch: Partial<MindsSettings> = {}) => pickMinds(reg.context(w, s), fidelityOf(reg.context(w, s), texts), texts, settings({ refreshLimit: "none", ...patch })).find((p) => p.entity === "maya")?.reason ?? null;
    expect(pick(base)).toBe("first");
    // A mind thought at the cafe this round: nothing new until a trigger fires.
    const thought = fold(reg, w, base, [round(base), mind(base, "maya", { level: "near", place: "cafe" })]);
    expect(pick(thought)).toBe(null);
    // In the POV's scene she thinks every turn, as Live does; past the Live limit, coming in is a trigger.
    expect(pick(at(w, thought, "maya", "apartment"))).toBe("live");
    expect(pick(at(w, thought, "maya", "apartment"), NO_TEXT, { liveLimit: 0 })).toBe("scene");
    expect(pick(thought, { user: "Where's Maya today?", reply: "" })).toBe("mention");
    const later = fold(reg, w, thought, Array.from({ length: 6 }, () => round(thought)));
    expect(pick(later)).toBe("turns");
    const old = fold(reg, w, thought, [{ type: "clock", minutes: 121, cause: "tick" }]);
    expect(pick(old)).toBe("minutes");
    expect(pick(old, NO_TEXT, { nearRefresh: { ...MINDS_DEFAULTS.nearRefresh, minutes: "none" } })).toBe(null);
  });
});

describe("the Minds section", () => {
  test("full gives the monologue; brief only a depiction that carries no secret; Stance is told who has one", () => {
    const full = world((x) => {
      x.minds = { secrecy: "full" } as WorldDoc["minds"];
    });
    const brief = world();
    for (const w of [full, brief]) {
      const s0 = at(w, startState(w), "maya", "apartment");
      expect(unrevealedSecrets(reg, w, s0)).toContain(SECRET);
      const s = fold(reg, w, s0, [round(s0), mind(s0, "maya", { monologue: `${SECRET}, and nobody can know.`, place: "apartment" })]);
      const lines = mindLines(reg.context(w, s)).map((l) => l.line).join("\n");
      if (w === full) {
        expect(lines).toContain(SECRET);
        expect(lines).toContain("Intends:");
      } else {
        expect(lines).not.toContain(SECRET);
        expect(lines).toContain("keeps glancing at the door");
      }
      expect(reg.context(w, s).query("minds.minded")(reg.context(w, s))).toEqual(["maya"]);
    }
    // A depiction that would give the secret away is left out under brief, whatever was flagged when it was recorded.
    const s0 = at(brief, startState(brief), "maya", "apartment");
    const leaky = fold(reg, brief, s0, [round(s0), mind(s0, "maya", { depiction: `mutters that ${SECRET.toLowerCase()}`, place: "apartment" })]);
    expect(mindLines(reg.context(brief, leaky))).toEqual([]);
    // A mind from an earlier round isn't this turn's.
    const stale = fold(reg, brief, leaky, [round(leaky)]);
    expect(mindLines(reg.context(brief, stale))).toEqual([]);
  });

  test("a time skip's earlier beats are past: a beat's mind is told only at the beat the skip ended on, a turn's whatever the clock", () => {
    const w = world();
    const s0 = at(w, startState(w), "maya", "apartment");
    const later = (s: WorldState): WorldState => fold(reg, w, s, [{ type: "clock", minutes: 180, cause: "tick" }]);
    const told = (s: WorldState): string[] => mindLines(reg.context(w, s)).map((l) => l.entity);
    // Maya thought at a beat, then the skip ran on three hours: what she thought then is past.
    const beat = later(fold(reg, w, s0, [round(s0), mind(s0, "maya", { moment: "beat", place: "apartment" })]));
    expect(placeOfEntity(beat, "maya")).toBe("apartment");
    expect(told(beat)).toEqual([]);
    // Asked again at the beat it ended on, she is told.
    expect(told(fold(reg, w, beat, [mind(beat, "maya", { moment: "beat", place: "apartment" })]))).toEqual(["maya"]);
    // A turn's mind, asked before the turn's own time passed, is the turn's.
    expect(told(later(fold(reg, w, s0, [round(s0), mind(s0, "maya", { place: "apartment" })])))).toEqual(["maya"]);
  });

  test("no player line ever tells a mind or a memory", () => {
    const w = world();
    const s0 = at(w, startState(w), "maya", "apartment");
    const events: LedgerEvent[] = [
      round(s0),
      mind(s0, "maya", { monologue: SECRET, place: "apartment" }),
      { type: "minds.memory", data: { entity: "maya", at: s0.clock, notes: [{ id: "n1", text: SECRET, salience: 4, at: s0.clock }], commitments: [], resolved: [], plans: [], told: [{ to: ["rosa"], what: SECRET }], summary: SECRET } },
      { type: "minds.presence", data: { msg: "m1", at: s0.clock, place: "apartment", who: ["maya"], saw: [SECRET] } },
    ];
    const s = fold(reg, w, s0, events);
    expect(playerLines(reg, w, s, w.pov, events, 20)).toEqual([]);
    expect(readCharacter(s, "rosa").witness.map((x) => x.how)).toEqual(["told"]);
    expect(readCharacter(s, "maya").witness.map((x) => x.what)).toEqual([SECRET]);
  });
});

describe("the GM's controls", () => {
  test("pin, refresh, and add, edit and delete notes, commitments and plans", () => {
    const w = world();
    const s0 = startState(w);
    const ctx = (s: WorldState) => reg.context(w, s);
    const apply = (s: WorldState, out: LedgerEvent[] | { code: string }): WorldState => {
      if (!Array.isArray(out)) throw new Error(`refused: ${out.code}`);
      return fold(reg, w, s, out);
    };
    let s = apply(s0, mindEdit(ctx(s0), { op: "mind_pin", entity: "maya", level: "near" }));
    expect(readCharacter(s, "maya").pin).toBe("near");
    s = apply(s, mindEdit(ctx(s), { op: "mind_refresh", entity: "maya" }));
    expect(readCharacter(s, "maya").refresh).toBe(true);
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "note", id: null, value: { text: "Alex was kind to me", salience: 4 } }));
    const note = readCharacter(s, "maya").notes[0]!;
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "note", id: note.id, value: { salience: 2 } }));
    expect(readCharacter(s, "maya").notes[0]).toEqual({ ...note, salience: 2 });
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "commitment", id: null, value: { kind: "promise", with: ["you"], text: "Cover Alex's Friday shift" } }));
    const c = readCharacter(s, "maya").commitments[0]!;
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "commitment", id: c.id, value: { status: "kept" } }));
    expect(readCharacter(s, "maya").commitments[0]?.status).toBe("kept");
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "plan", id: null, value: { what: "Call Alex", when: { from: s.clock + 60, to: s.clock + 90 }, with: ["you"] } }));
    const plan = readCharacter(s, "maya").plans[0]!;
    expect(reg.context(w, s).query("minds.plans")(reg.context(w, s), "maya").map((p) => p.id)).toEqual([plan.id]);
    s = apply(s, mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "plan", id: plan.id, value: null }));
    expect(readCharacter(s, "maya").plans).toEqual([]);
    // The POV has no mind, and someone missing can't be edited.
    expect(Array.isArray(mindEdit(ctx(s), { op: "mind_refresh", entity: w.pov }))).toBe(false);
    expect(Array.isArray(mindEdit(ctx(s), { op: "mind_memory", entity: "maya", part: "note", id: "nope", value: null }))).toBe(false);
  });
});
