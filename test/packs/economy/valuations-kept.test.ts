// A read pass keeps each company's valuation (`bookValuationOf`), so the organisations' pages of a long chat are not valued again for
// every page that names them. What it keeps must be what working each out afresh gives, also where companies hold each other: one that
// (through others) holds itself is worth nothing more the second time round, so a valuation met inside another is kept only where it
// did not take a company being valued around it as nothing, and used again only while none it asked about is being valued.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { Working } from "../../../src/engine/working";
import { materializeAll } from "../../../src/engine/materialize";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function portAlder(patch: (world: WorldDoc) => void): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, "pov", "valuations");
  return w;
}

/** Every company's value and every party's net worth, each asked on its own outside a pass (worked out afresh), then all inside one pass, in two orders. */
function worths(w: Working): { afresh: Record<string, number>; pass: Record<string, number>; reversed: Record<string, number> } {
  const value = reg.formulas.get("business_value");
  const worth = reg.formulas.get("net_worth");
  if (value === undefined || worth === undefined) throw new Error("no business_value or net_worth formula");
  const ids = Object.keys(w.state.entities).filter((id) => w.state.entities[id]?.kind === "business" || w.state.entities[id]?.kind === "person").sort();
  const ask = (id: string): number => Number(value(w.ctx, id)) + Number(worth(w.ctx, id));
  const afresh = Object.fromEntries(ids.map((id) => [id, ask(id)]));
  const pass = readPass(() => Object.fromEntries(ids.map((id) => [id, ask(id)])));
  const reversed = readPass(() => Object.fromEntries([...ids].reverse().map((id) => [id, ask(id)])));
  return { afresh, pass, reversed };
}

describe("valuations kept in a read pass", () => {
  test("come to what each worked out afresh gives, with companies that hold shares of each other", () => {
    const w = portAlder((world) => {
      const shop = Object.values(world.entities).find((e) => e.kind === "business");
      if (shop === undefined) throw new Error("the starter holds no company");
      // Two more companies like the shop, each with its own copy of the shop's accounts; each holds more than it owes, so each is worth something.
      const accounts = Object.values(world.entities).filter((e) => e.kind === "account" && JSON.stringify(e.fields.owners ?? e.fields.owner ?? null).includes(shop.id));
      const [a, b, c] = [shop.id, `${shop.id}_two`, `${shop.id}_three`];
      for (const acct of accounts) if (acct.fields.product === "business_checking") acct.fields.opening = 9_000_000;
      for (const id of [b, c]) {
        world.entities[id] = { ...structuredClone(shop), id, name: `${shop.name} ${id}` };
        for (const acct of accounts) {
          const copy = structuredClone(acct);
          copy.id = `${acct.id}_${id}`;
          copy.fields = JSON.parse(JSON.stringify(copy.fields).replaceAll(shop.id, id));
          world.entities[copy.id] = copy;
        }
      }
      // a holds part of b, b part of c, and c part of a: a ring, each also held by its first owner.
      const hold = (id: string, by: string): void => {
        const e = world.entities[id];
        if (!e) return;
        const owners = Array.isArray(e.fields.owners) ? e.fields.owners : [];
        e.fields.owners = [...owners, { party: by, role: "owner", share: 30 }];
      };
      hold(b, a);
      hold(c, b);
      hold(a, c);
    });
    const { afresh, pass, reversed } = worths(w);
    // The ring counts: each company's worth takes in its share of the next, which takes in its share of the one after.
    const ring = Object.entries(afresh).filter(([id]) => id.includes("_co"));
    expect(ring.length).toBe(3);
    expect(ring.every(([, v]) => v > 0)).toBe(true);
    expect(pass).toEqual(afresh);
    expect(reversed).toEqual(afresh);
  });
});
