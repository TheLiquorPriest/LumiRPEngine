// RPE's lore port against the lore part of RPH's contract kit. The kit's seed is laid as RPE holds
// lore: its book entries as invented Lumiverse books whose entries go by the numbers the seed names,
// its world entries in an invented world, who may know each as the world's people, and what activated
// for each prompt as each turn's tag.

import { join } from "node:path";
import { type KitPorts, type KitSeed, runKitPart } from "rp-harness/testing/kit";
import { blankWorld } from "../../src/engine/authoring";
import { initialState } from "../../src/engine/world-state";
import { hashJson } from "../../src/shared/hash";
import type { LoreEntryDef } from "../../src/shared/world";
import { type ActivatedEntry, Lore, type LoreBook, type LoreBookEntry, lorePort, loreRefOf, type LoreWorlds } from "../../src/lore/index";
import { loreDb, registry, Shelf, Tags } from "./fixtures";

async function laid(seed: KitSeed, place: string): Promise<KitPorts<"lore">> {
  const { user, chat } = seed.scope;
  const db = loreDb(join(place, "rpe.db"), join(place, "backups"));
  const books = new Map<string, LoreBook>();
  const entries: LoreBookEntry[] = [];
  const numbered: [number, string][] = [];
  const lore: Record<string, LoreEntryDef> = {};
  const people: Record<string, string> = {};
  let worldName = "";
  for (const e of seed.lore) {
    const ref = loreRefOf(e.id);
    if (ref?.kind === "book") {
      const book = books.get(e.source) ?? { id: `kit-book-${books.size + 1}`, name: e.source };
      books.set(e.source, book);
      entries.push({ id: `kit-entry-${ref.n}`, book: book.id, comment: e.title, content: e.text, keys: e.keys, secondaryKeys: [], disabled: false, extensions: {} });
      numbered.push([ref.n, `kit-entry-${ref.n}`]);
    } else if (ref?.kind === "world") {
      worldName = e.source;
      const def: LoreEntryDef = { id: ref.key, title: e.title, content: e.text, keys: e.keys, links: [] };
      if (e.knowing?.by === "characters") {
        // Those who may know it, ever and none else: the people who hold it as a secret.
        const holders = e.knowing.names.map((name) => {
          const id = `kit-person-${Object.keys(people).length + 1}`;
          people[id] = name;
          return id;
        });
        Object.assign(def, { secret: true, gate: "false", holders });
      } else if (e.knowing !== undefined) throw new Error(`The kit's entry ${e.id} is known ${e.knowing.by}, which this laying does not lay`);
      lore[ref.key] = def;
    } else throw new Error(`The kit's entry ${e.id} has no id RPE gives an entry`);
  }
  // The numbers the seed's book entries go by, kept where RPE keeps them.
  await db.writes.run((d) => {
    for (const [n, id] of numbered) d.run("INSERT INTO lore_entry_number (user, n, entry) VALUES (?, ?, ?)", [user, n, id]);
  });

  const reg = registry();
  const world = { ...blankWorld("kit-world", worldName), lore };
  world.entities = { ...world.entities, ...Object.fromEntries(Object.entries(people).map(([id, name]) => [id, { id, kind: "person", name, tier: "principal", fields: {}, relations: [] }])) };
  const at = { registry: reg, world, state: initialState(world, hashJson(world), reg) };
  const worlds: LoreWorlds = { registry: reg, at: (u, c) => (u === user && c === chat ? at : null) };

  const tags = new Tags();
  for (const prompt of seed.prompts) {
    const activated = prompt.activated.map((a): ActivatedEntry => {
      const ref = loreRefOf(a.id);
      if (ref?.kind !== "book") throw new Error(`The kit's prompt activated ${a.id}, which is not a book entry`);
      return { id: `kit-entry-${ref.n}`, book: books.get(a.source)?.id ?? null, title: a.title, how: a.how ?? null };
    });
    tags.set(user, chat, prompt.turn, activated);
  }

  const shelf = new Shelf(new Map([[user, { books: [...books.values()], entries, attached: new Map([[chat, [...books.values()].map((b) => b.id)]]) }]]));
  return { lore: lorePort(new Lore({ books: shelf, worlds, turns: tags, numbers: db.numbers })), close: () => db.close() };
}

runKitPart("RPE's lore", "lore", laid);
