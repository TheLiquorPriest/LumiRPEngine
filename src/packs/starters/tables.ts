// The starter worlds' own data tables (Data updates, DESIGN §9.2): the tables a template swaps in for
// the packs' Modern US ones (`scripts/templates/convert.ts`: Brindlemere's and Harrowmere's prices,
// categories, items and vehicle classes), each with every revision it has shipped as. `shipped.json`
// beside the worlds is the template build's record (`bun run templates`, seeded once from git
// history), by starter and table, oldest first, the last being the table the starter world ships
// with; a world made from a starter is offered the newer versions of the copies it never changed.

import type { DataTable, ShippedRevision, StarterTable } from "../../shared/tables";
import fantasyTown from "./fantasy_town.json";
import { STARTER_INFO } from "./info";
import modernSliceOfLife from "./modern_slice_of_life.json";
import mysteryManor from "./mystery_manor.json";
import shipped from "./shipped.json";

const DOCS: Readonly<Record<string, { tables: Readonly<Record<string, DataTable>> }>> = { fantasy_town: fantasyTown, mystery_manor: mysteryManor, modern_slice_of_life: modernSliceOfLife } as unknown as Readonly<Record<string, { tables: Readonly<Record<string, DataTable>> }>>;
const HISTORIES = shipped as unknown as Readonly<Record<string, Readonly<Record<string, readonly ShippedRevision[]>>>>;

/** Every starter's own tables, starters in the template picker's order, each table as its world ships it with its history. */
export const STARTER_TABLES: readonly StarterTable[] = STARTER_INFO.flatMap((info) =>
  Object.entries(HISTORIES[info.id] ?? {}).flatMap(([id, history]) => {
    const table = DOCS[info.id]?.tables[id];
    return table ? [{ starter: { id: info.id, name: info.name }, table, shipped: history }] : [];
  }),
);
