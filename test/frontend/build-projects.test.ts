// Build → Organizations' Projects (DESIGN §26.5): the templates it offers are the economy's (the
// world's own `economy.projects` table, else the shipped one, as play reads them), handed to the
// orgs UI by its host; adding a project copies the template's steps into an entity of its own.

import { describe, expect, test } from "bun:test";
import { projectTemplatesOf } from "../../src/packs/economy/ui/projects";
import { buildProjectPatch } from "../../src/packs/orgs/ui/projects";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import { PROJECTS_TABLE } from "../../src/shared/projects";
import type { WorldDoc } from "../../src/shared/world";

const SHOP = "alder_automotive_co";

function portAlder(): WorldDoc {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  return make("pa", "Port Alder");
}

describe("Build → Organizations: project templates", () => {
  test("a world's own table is what it offers; one made before the table shipped is offered the shipped templates", () => {
    const world = portAlder();
    const own = world.tables[PROJECTS_TABLE];
    if (!own) throw new Error("the starter carries no projects table");
    expect(projectTemplatesOf(world)).toBe(own.rows);
    const { [PROJECTS_TABLE]: _dropped, ...rest } = world.tables;
    const older: WorldDoc = { ...world, tables: rest };
    expect(Object.keys(projectTemplatesOf(older)).sort()).toEqual(["building", "farm_season", "foundry", "oil_well", "water_well"]);
  });

  test("adding one copies the template's steps and payee into a project of the organization's", () => {
    const world = portAlder();
    const templates = projectTemplatesOf(world);
    const well = templates.oil_well as JsonObject;
    const [op] = buildProjectPatch(world, SHOP, { template: "oil_well", name: "", status: "planned", start: "" }, templates);
    expect(op).toEqual({ op: "add", path: `/entities/project_${SHOP}_oil_well`, value: { id: `project_${SHOP}_oil_well`, kind: "project", name: "Oil well", tier: "background", fields: { org: SHOP, template: "oil_well", steps: well.steps ?? [], status: "planned", payee: "Drilling contractors" }, relations: [] } });
    expect(buildProjectPatch(world, SHOP, { template: "no_such_template", name: "", status: "planned", start: "" }, templates)).toEqual([]);
  });
});
