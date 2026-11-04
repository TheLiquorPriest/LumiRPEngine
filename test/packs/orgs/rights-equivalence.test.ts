// Rights equivalence (ORG-SPEC §11 Phase 1, the phase gate; §3.4): with no positions authored, the
// powers the organization model gives equal the rights today's formulas answer, on every starter
// with its authored structure taken out (positions, the positions members and jobs hold, and
// delegations), as a chat starts and after its golden timelapse (eight days, as the starter smoke
// runs them), for every person against every business, trust and household:
// - `manages(p, X)`: every power a managing role carries beyond seeing and using (`may` of each);
// - `holds(p, X)`: any role on its owners list, which sees its money (`money.view`, as an owner);
// - `spends(p, X)`: `money.spend`, but for an authorized user, whose spending right on a business's
//   or a trust's own list pays from none of its accounts and becomes `money.view` (§3.4's table);
// - `may_draw(p, X)`: unchanged, and only ever an owner holding `money.payout`.
// The one addition is the household Head (sign-off item 3): Helen, by her title, holds every power.

import { describe, expect, test } from "bun:test";
import { ownersIn } from "../../../src/shared/finance";
import { ACTS_FOR, ORG_POWERS, type OrgPower } from "../../../src/shared/org";
import type { WorldDoc } from "../../../src/shared/world";
import type { Value } from "../../../src/engine/expr";
import { materializeAll } from "../../../src/engine/materialize";
import { headOf, orgPower, orgTypeOf, positionsOf } from "../../../src/engine/org";
import type { ReadContext } from "../../../src/engine/registry";
import { createRegistry } from "../../../src/engine/registry-impl";
import { isGone, kindIs } from "../../../src/engine/scope";
import { linkedMemberOf, MEMBER_OF } from "../../../src/engine/selector";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** The powers a member's or a beneficiary's default may give without managing: seeing the money, and using (or, for what is consumed, disposing of) the things. */
const UNMANAGED: readonly OrgPower[] = ["money.view", "assets.use", "assets.assign", "assets.dispose"];
const MANAGING = ORG_POWERS.filter((p) => !UNMANAGED.includes(p));

function formula(ctx: ReadContext, name: string, ...args: Value[]): boolean {
  const fn = reg.formulas.get(name);
  if (!fn) throw new Error(`no formula ${name}`);
  return fn(ctx, ...args) === true;
}

/** A starter without the structure an author wrote over today's storage: no positions, no position held by a member or a job, no delegation. */
function unstructured(world: WorldDoc): WorldDoc {
  for (const e of Object.values(world.entities)) {
    delete e.fields.positions;
    if (e.kind === "job") delete e.fields.position;
    e.relations = e.relations.filter((r) => r.type !== ACTS_FOR).map((r) => (r.type === MEMBER_OF && r.fields?.position !== undefined ? { ...r, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => k !== "position")) } : r));
  }
  return world;
}

/** The world at chat start and after its golden timelapse. */
function phases(world: WorldDoc): { name: string; ctx: ReadContext }[] {
  const start = new Working(reg, world, startState(world, reg));
  const later = new Working(reg, world, startState(world, reg));
  for (const id of Object.keys(world.entities)) if (world.entities[id]?.kind === "character") materializeAll(reg, later, id, "smoke");
  const out = runTimelapse(reg, later, { type: "duration", minutes: 8 * 1440 }, { runSeed: "smoke", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(`timelapse refused: ${out.reason}`);
  return [
    { name: "at chat start", ctx: start.ctx },
    { name: "after the golden timelapse", ctx: later.ctx },
  ];
}

describe("rights equivalence on every starter", () => {
  for (const [template, make] of Object.entries(STARTER_WORLDS)) {
    for (const { name, ctx } of phases(unstructured(make("w", template)))) {
      test(`${template}, ${name}: today's manages, holds, spends and may_draw equal the new may under the defaults`, () => {
        const { state } = ctx;
        const people = Object.keys(state.entities).filter((id) => kindIs(reg, ctx.world, state.entities[id]?.kind ?? "", "person") && !isGone(state, id));
        const orgs = Object.keys(state.entities).filter((id) => ["company", "trust", "household"].includes(orgTypeOf(ctx, id) ?? "") && !isGone(state, id));
        expect(people.length).toBeGreaterThan(0);
        const additions: string[] = [];
        let compared = 0;
        for (const org of orgs) {
          // With no positions authored: the defaults alone.
          expect(positionsOf(ctx, org)).toEqual([]);
          const type = orgTypeOf(ctx, org);
          const roles = ownersIn(state.entities[org]?.fields ?? {});
          for (const p of people) {
            const may = (power: OrgPower): boolean => orgPower(ctx, p, org, power) !== null;
            const manages = formula(ctx, "manages", p, org);
            const head = type === "household" && headOf(ctx, org) === p;
            for (const power of MANAGING) {
              compared++;
              if (may(power) !== manages) additions.push(`${p} ${power} ${org}`);
            }
            if (type === "household") {
              // Today a household's members see its money and use its things; nobody manages it.
              expect([p, org, may("money.view"), may("assets.use")]).toEqual([p, org, linkedMemberOf(state, p, org), linkedMemberOf(state, p, org)]);
              expect([p, org, manages]).toEqual([p, org, false]);
              continue;
            }
            expect(head).toBe(false);
            const holds = formula(ctx, "holds", p, org);
            expect([p, org, "holds", holds]).toEqual([p, org, "holds", orgPower(ctx, p, org, "money.view")?.basis === "owner"]);
            const authorizedOnly = roles.some((o) => o.party === p) && roles.filter((o) => o.party === p).every((o) => o.role === "authorized_user");
            expect([p, org, "spends", formula(ctx, "spends", p, org) && !authorizedOnly]).toEqual([p, org, "spends", may("money.spend")]);
            for (const power of ["assets.use", "assets.assign", "assets.dispose"] as const) expect([p, org, power, may(power)]).toEqual([p, org, power, manages]);
            if (formula(ctx, "may_draw", p, org)) expect([p, org, orgPower(ctx, p, org, "money.payout")]).toEqual([p, org, { basis: "owner" }]);
          }
        }
        // The household Head, the one addition: every managing power, and nobody else gains one.
        const heads = orgs.filter((o) => orgTypeOf(ctx, o) === "household").flatMap((o) => (headOf(ctx, o) === null ? [] : [`${headOf(ctx, o)} ${o}`]));
        expect(additions).toEqual(heads.flatMap((h) => MANAGING.map((power) => `${h.split(" ")[0]} ${power} ${h.split(" ")[1]}`)));
        if (template === "modern_slice_of_life") {
          expect(heads).toEqual(["helen_kowalczyk household_kowalczyk"]);
          expect(compared).toBeGreaterThan(0);
        }
      });
    }
  }
});
