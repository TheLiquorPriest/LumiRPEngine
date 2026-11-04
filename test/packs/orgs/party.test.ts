// The party as an organization (ORG-SPEC §3.12, §4.5, §11 Phase 2 Party; assess-party §6.1), on
// Port Alder. A `travels_with` link without a tier reads core. By tier, its core and its companions
// come along on Jordan's moves, a companion unless their own shift is due, while hired hands and
// allies stay. "We" is the party that comes along, and the People section marks each tier. Name the
// party spawns `party_pov` once. Start a purse opens an account the party owns with Jordan's
// deposit, in one unit that a rebased view without the money drops whole. A hired hand whose job
// with the party has ended is offered a way out of it.

import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { OrgListView, OrgView } from "../../../src/shared/org-view";
import { PARTY_SECTION, type PartySectionView } from "../../../src/shared/party";
import type { WorldDoc } from "../../../src/shared/world";
import { interpretScene } from "../../../src/backend/interpret-context";
import { DEFAULT_RECENT } from "../../../src/shared/settings";
import { applyValidUnits } from "../../../src/engine/events";
import { membersOfOrg, partyRoster } from "../../../src/engine/org";
import { optionalQuery } from "../../../src/engine/pack-kit";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { partyAt } from "../../../src/engine/relocate";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { selectorMatches } from "../../../src/engine/selector";
import { Working } from "../../../src/engine/working";
import { peopleLines } from "../../../src/packs/castlife/core/index";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const HOME = "harbor_street_114";
const PARTY = "party_pov";

/** Port Alder as Jordan sees it, with the given people travelling with him in their tiers (`null`: a link written before tiers). */
function portAlder(party: Record<string, string | null> = {}, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const state = startState(world, reg);
  for (const [who, tier] of Object.entries(party)) {
    const e = state.entities[who];
    if (!e) throw new Error(`no ${who}`);
    e.relations.push({ type: "travels_with", to: "pov", ...(tier === null ? {} : { fields: { tier } }) });
  }
  return new Working(reg, world, state);
}

/** Jordan's action as the palette or the party's page plays it, his money and anyone's it names made real first. */
function act(w: Working, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor: "pov", params }, createRng(`party:${action}:${JSON.stringify(params)}:${w.state.clock}`), { runSeed: "party" });
}

/** Why an action didn't play: its failed requirement or its effects' refusals; "" when it played. */
function refusal(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function panel(w: Working, id: string): JsonValue {
  const view = reg.views.find((v) => v.panel === id);
  if (!view) throw new Error(`no panel ${id}`);
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

function partyPage(w: Working): OrgView {
  const pages = panel(w, "orgs.org") as unknown as Record<string, OrgView>;
  const page = pages[PARTY];
  if (!page) throw new Error("no party page");
  return page;
}

function section(w: Working): PartySectionView {
  const built = partyPage(w).sections[PARTY_SECTION];
  if (!built) throw new Error("no party section");
  return built as unknown as PartySectionView;
}

/** The events an action's one effect made: those of the unit its party's or account's spawn opens. */
function unitOf(r: Resolution, first: (ev: LedgerEvent) => boolean): LedgerEvent[] {
  const group = r.events.find(first)?.group;
  if (group === undefined) throw new Error("no unit");
  return r.events.filter((ev) => ev.group === group);
}

describe("the party's roster and tiers", () => {
  test("a travels_with link without a tier reads core: on the roster, to the party selector, on the move and on the party's page", () => {
    const w = portAlder({ danny_okafor: null });
    expect(partyRoster(w.ctx, "pov")).toEqual([
      { who: "pov", how: "leader" },
      { who: "danny_okafor", how: "core" },
    ]);
    expect(selectorMatches(reg, w.world, w.state, { party: ["core"] }, "danny_okafor")).toBe(true);
    expect(selectorMatches(reg, w.world, w.state, { party: ["companion"] }, "danny_okafor")).toBe(false);
    expect(partyAt(w.ctx, HOME)).toEqual(["danny_okafor"]);
    expect(section(w).members).toEqual([{ id: "danny_okafor", tier: "core", where: null }]);
  });

  test("by tier: the core and companions come along, a companion unless their own shift is due elsewhere, hired hands and allies stay", () => {
    const w = portAlder({ maddie_kowalczyk: "core", danny_okafor: "companion", jess_kowalczyk: "hired", helen_kowalczyk: "ally" });
    expect(partyAt(w.ctx, HOME)).toEqual(["danny_okafor", "maddie_kowalczyk"]);
    // Monday at 8:00 Danny's shift at the shop is due: he stays behind, unless Jordan goes there too.
    w.state.clock += 105;
    expect(optionalQuery(w.ctx, "castlife.commitments")?.(w.ctx, "danny_okafor", w.state.clock, w.state.clock + 1).map((b) => [b.kind, b.place])).toEqual([["work", "alder_automotive"]]);
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).toEqual(["maddie_kowalczyk"]);
    expect(partyAt(w.ctx, HOME, "alder_automotive")).toEqual(["danny_okafor", "maddie_kowalczyk"]);
    // On Go, whoever comes along leaves with Jordan; the hired hand and the ally stay home.
    const go = act(w, "go", { to: "rusty_anchor" });
    expect(refusal(go)).toBe("");
    expect(["pov", "maddie_kowalczyk", "danny_okafor", "jess_kowalczyk", "helen_kowalczyk"].map((id) => w.state.entities[id]?.fields.place)).toEqual(["rusty_anchor", "rusty_anchor", HOME, HOME, HOME]);
  });

  test('"we" is the party that comes along, and the People section marks each tier', () => {
    const w = portAlder({ danny_okafor: "companion", jess_kowalczyk: "hired" });
    const scene = interpretScene(reg, w.world, w.state, { mayKnow: () => true, named: [], earlier: [], recent: DEFAULT_RECENT, hideJson: false }).lines;
    expect(scene.find((l) => l.startsWith("Here with you"))).toContain("Danny Okafor (danny_okafor, party companion)");
    expect(scene).toContain('Your party here, whom "we" means: Danny Okafor (danny_okafor).');
    const people = peopleLines(w.ctx, "player").map((l) => l.text);
    // The tier leads the mark, then their titles where an organization ties them to the player character (ORG-SPEC §3.15).
    expect(people.some((l) => l.startsWith("Danny Okafor (party companion; mechanic at Alder Automotive, where you work) is here"))).toBe(true);
    expect(people.some((l) => l.startsWith("Jess Kowalczyk (hired hand) is here"))).toBe(true);
    expect(people.some((l) => l.startsWith("Helen Kowalczyk (head of The Kowalczyks) is here"))).toBe(true);
    // With no one in the party, "we" names only whom the input names.
    const alone = interpretScene(reg, portAlder().world, portAlder().state, { mayKnow: () => true, named: [], earlier: [], recent: DEFAULT_RECENT, hideJson: false }).lines;
    expect(alone).toContain('Your party here, whom "we" means: no one, so "we" is only whom the input names.');
  });

  test("Add someone you know in a tier, change it keeping since when, take them out: each at once, as the leader's own", () => {
    const w = portAlder();
    expect(section(w).candidates.some((c) => c.id === "danny_okafor")).toBe(true);
    expect(refusal(act(w, "party_tier", { who: "danny_okafor", tier: "companion" }))).toBe("");
    const link = (): JsonObject | undefined => w.state.entities.danny_okafor?.relations.find((r) => r.type === "travels_with" && r.to === "pov")?.fields as JsonObject | undefined;
    expect(link()).toEqual({ tier: "companion", since: "2026-09-14" });
    expect(section(w).candidates.some((c) => c.id === "danny_okafor")).toBe(false);
    w.state.clock += 3 * 1440;
    expect(refusal(act(w, "party_tier", { who: "danny_okafor", tier: "core" }))).toBe("");
    expect(link()).toEqual({ tier: "core", since: "2026-09-14" });
    expect(refusal(act(w, "party_tier", { who: "danny_okafor", tier: "core" }))).toContain("already a core member");
    expect(refusal(act(w, "party_tier", { who: "danny_okafor", tier: "captain" }))).toContain("a tier is one of core, companion, hired, ally, or out");
    expect(refusal(act(w, "party_tier", { who: "pov", tier: "core" }))).toContain("You lead the party");
    expect(refusal(act(w, "party_tier", { who: "danny_okafor", tier: "out" }))).toBe("");
    expect(link()).toBeUndefined();
    expect(membersOfOrg(w.ctx, PARTY)).toEqual([]);
  });
});

describe("the party's entity and purse", () => {
  test("Name the party spawns party_pov once; naming it again renames it", () => {
    const w = portAlder({ danny_okafor: "companion" });
    expect(partyPage(w).exists).toBe(false);
    const named = act(w, "party_name", { name: "The Harbor Crew" });
    expect(refusal(named)).toBe("");
    expect(named.events.filter((ev) => ev.type === "spawn").map((ev) => (ev.type === "spawn" ? [ev.entity.id, ev.entity.kind, ev.entity.name, ev.entity.fields.leader] : null))).toEqual([[PARTY, "party", "The Harbor Crew", "pov"]]);
    expect(refusal(act(w, "party_name", { name: "The Night Shift" }))).toBe("");
    expect(Object.values(w.state.entities).filter((e) => e.kind === "party").map((e) => e.name)).toEqual(["The Night Shift"]);
    const list = panel(w, "orgs.list") as unknown as OrgListView;
    expect([list.party.id, list.party.name, list.party.exists]).toEqual([PARTY, "The Night Shift", true]);
    expect(membersOfOrg(w.ctx, PARTY).map((r) => [r.who, r.how])).toEqual([
      ["pov", "leader"],
      ["danny_okafor", "companion"],
    ]);
    expect(refusal(act(w, "party_name", { name: "The Night Shift" }))).toContain("already called The Night Shift");
  });

  test("Start a purse opens an account the party owns with Jordan's deposit, in the same unit; a rebased view without the money drops it whole", () => {
    const w = portAlder({ danny_okafor: "companion" });
    const before = structuredClone(w.state);
    const started = act(w, "party_purse", { amount: 10_000 });
    expect(refusal(started)).toBe("");
    const unit = unitOf(started, (ev) => ev.type === "spawn" && ev.entity.id === PARTY);
    const spawned = unit.flatMap((ev) => (ev.type === "spawn" ? [[ev.entity.kind, ev.entity.fields.owners ?? null]] : []));
    expect(spawned).toEqual([
      ["party", null],
      ["account", [{ party: PARTY, role: "owner" }]],
    ]);
    expect(unit.some((ev) => ev.type === "post")).toBe(true);
    expect(unit.some((ev) => ev.type === "orgs.log")).toBe(true);
    const purse = section(w).purse;
    expect(purse?.balance).toBe("$100.00");
    expect(purse && w.state.accounts[purse.account]).toBe(10_000);
    expect(partyPage(w).exists).toBe(true);
    expect(Object.keys(partyPage(w).sections)).toContain("money");
    expect(refusal(act(w, "party_purse", { amount: 5_000 }))).toContain("already has a purse");
    // The deposit came from one of Jordan's accounts; a view in which it holds nothing folds none of the unit.
    const post = unit.find((ev) => ev.type === "post");
    const source = post?.type === "post" ? post.lines.find((l) => l.amount < 0)?.account : undefined;
    expect(source).toBeDefined();
    const rebased = structuredClone(before);
    const head = started.events.filter((ev) => !unit.includes(ev));
    applyValidUnits(reg, head, rebased, (s) => reg.context(w.world, s));
    rebased.accounts[source ?? ""] = 0;
    applyValidUnits(reg, unit, rebased, (s) => reg.context(w.world, s));
    expect(rebased.entities[PARTY]).toBeUndefined();
    expect(Object.values(rebased.entities).some((e) => e.kind === "account" && JSON.stringify(e.fields.owners ?? []).includes(PARTY))).toBe(false);
  });
});

describe("a hired hand's job with the party", () => {
  test("when a hired member's job ends, leaving the party is offered", () => {
    const w = portAlder({ jess_kowalczyk: "hired" });
    expect(refusal(act(w, "party_purse", { amount: 50_000 }))).toBe("");
    w.applyAll([{ type: "spawn", entity: { id: "job_jess_party", kind: "job", name: "Jess Kowalczyk for the party", tier: "background", fields: { worker: "jess_kowalczyk", employer: PARTY, status: "active", basis: "hourly", rate: 1500 }, relations: [] } }]);
    expect(section(w).offers).toEqual([]);
    w.applyAll([{ type: "set", entity: "job_jess_party", field: "status", value: "ended" }]);
    expect(section(w).offers).toEqual([{ id: "jess_kowalczyk", name: "Jess Kowalczyk", job: "job_jess_party" }]);
    // She stays on as a companion, or leaves: either way the offer goes.
    expect(refusal(act(w, "party_tier", { who: "jess_kowalczyk", tier: "companion" }))).toBe("");
    expect(section(w).offers).toEqual([]);
    expect(refusal(act(w, "party_tier", { who: "jess_kowalczyk", tier: "out" }))).toBe("");
    expect(section(w).members).toEqual([]);
  });

  test("Hire a hand: a job the party employs and the hired tier, in one unit; Let go, and leaving the party is offered", () => {
    const w = portAlder();
    expect(refusal(act(w, "party_hire", { worker: "jess_kowalczyk", basis: "hourly", rate: 1500 }))).toContain("Start a purse first");
    expect(refusal(act(w, "party_purse", { amount: 50_000 }))).toBe("");
    const hired = act(w, "party_hire", { worker: "jess_kowalczyk", title: "Deckhand", basis: "hourly", rate: 1500 });
    expect(refusal(hired)).toBe("");
    const unit = unitOf(hired, (ev) => ev.type === "spawn" && ev.entity.kind === "job");
    const job = unit.flatMap((ev) => (ev.type === "spawn" ? [ev.entity] : []))[0];
    expect([job?.fields.worker, job?.fields.employer, job?.fields.title]).toEqual(["jess_kowalczyk", PARTY, "Deckhand"]);
    expect(unit.some((ev) => ev.type === "link" && ev.rel === "travels_with" && ev.from === "jess_kowalczyk" && (ev.fields as JsonObject | undefined)?.tier === "hired")).toBe(true);
    expect(section(w).members).toEqual([{ id: "jess_kowalczyk", tier: "hired", where: null }]);
    expect(section(w).offers).toEqual([]);
    expect(refusal(act(w, "job_end", { job: job?.id ?? "" }))).toBe("");
    expect(section(w).offers).toEqual([{ id: "jess_kowalczyk", name: "Jess Kowalczyk", job: job?.id }]);
  });
});

describe("the party's share-out", () => {
  test("Share out pays the core and companion members equally, never the leader, a hired hand or an ally", () => {
    const w = portAlder({ danny_okafor: "companion", maddie_kowalczyk: "core", jess_kowalczyk: "hired", helen_kowalczyk: "ally" });
    expect(refusal(act(w, "party_purse", { amount: 10_000 }))).toBe("");
    const purse = section(w).purse?.account ?? "";
    expect(section(w).shareOut.map((p) => p.id)).toEqual(["danny_okafor", "maddie_kowalczyk"]);
    const shared = act(w, "org_share_out", { org: PARTY, amount: 4_000 });
    expect(refusal(shared)).toBe("");
    // Each line paid out of the purse lands with one of its two takers, $20 each: an account is its
    // holder's, not its custodian's (Maddie's savings name Helen custodian).
    const owner = (account: string): string => {
      const owners = w.state.entities[account]?.fields.owners;
      const rows = Array.isArray(owners) ? owners.filter((o): o is JsonObject => typeof o === "object" && o !== null && !Array.isArray(o)) : [];
      return String((rows.find((o) => o.role !== "custodian") ?? rows[0])?.party ?? account);
    };
    const paid: Record<string, number> = {};
    for (const ev of shared.events) if (ev.type === "post" && ev.lines.some((l) => l.account === purse && l.amount < 0)) for (const l of ev.lines) if (l.amount > 0) paid[owner(l.account)] = (paid[owner(l.account)] ?? 0) + l.amount;
    expect(paid).toEqual({ danny_okafor: 2_000, maddie_kowalczyk: 2_000 });
    expect(w.state.accounts[purse]).toBe(6_000);
  });
});
