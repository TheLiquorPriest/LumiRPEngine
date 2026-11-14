// Item 2: a Lumiverse World Info book of the player's own, with one entry that holds two secret
// marks (the player's character later learns the first and never the second, `secrets` step), the
// engine's own fields on that entry, and a second entry carrying an earlier build's secrecy fields,
// which Build → Lore → Secrecy then moves to a mark (its backup is the engine's `secrecy/` store).
// The book and entries are made through Lumiverse's API, as a user makes them; the marks and the
// move are Build's own requests (`lre.lore mark`, `lre.secrecy`), and the fields are the CLI's.

import type { Ctx, Step } from "../lib/context";
import { say } from "../lib/record";

export const BOOK_NAME = "Port Alder test instance · lore";
const MARKED = "The marina office keys";
const LEGACY = "The old lighthouse ledger";

/** The two secret lines of the marked entry, in order: mark 0 is the one the player's character learns. */
export const MARKS = ["The spare key to the marina office hangs on a nail inside the bait freezer.", "Dale has not paid the township for his slip licence in two seasons."];

interface EntryView {
  id: string;
  title: string;
  marks?: { text: string }[];
}

async function entryOf(ctx: Ctx, bookId: string, title: string, make: () => { [key: string]: unknown }): Promise<string> {
  const entries = await ctx.host.bookEntries(bookId);
  const found = entries.find((e) => e.comment === title);
  if (found) return found.id;
  const made = await ctx.host.createEntry(bookId, make());
  ctx.log.log({ step: "book", action: "created", kind: "world book entry", id: made.id, name: title, detail: { bookId } });
  return made.id;
}

export const book: Step = {
  name: "book",
  makes: "a World Info book with secret marks, the engine's entry fields and a moved old-style secret",
  async run(ctx) {
    let bookId = ctx.log.get<string>("bookId");
    const books = await ctx.host.worldBooks();
    if (bookId === undefined || !books.some((b) => b.id === bookId)) {
      bookId = books.find((b) => b.name === BOOK_NAME)?.id;
      if (bookId === undefined) {
        const made = await ctx.host.createWorldBook({ name: BOOK_NAME, description: "Invented lore for the migration's test instance." });
        bookId = made.id;
        ctx.log.log({ step: "book", action: "created", kind: "world book", id: bookId, name: BOOK_NAME });
      }
      ctx.log.set("bookId", bookId);
    }
    const marked = await entryOf(ctx, bookId, MARKED, () => ({
      comment: MARKED,
      key: ["marina office", "office keys"],
      content: "The marina office is a white shed at the head of the main dock. Dale locks it every night at nine.",
    }));
    ctx.log.set("entryId", marked);

    // Build's "Add a secret line", twice: each line known only to Dale.
    const read = async (): Promise<EntryView[]> => ((await ctx.socket.lre<{ entries?: EntryView[] }>("lre.lore", { op: "entries", bookId })).entries ?? []);
    let marks = (await read()).find((e) => e.id === marked)?.marks ?? [];
    for (const [n, text] of MARKS.entries()) {
      if (marks.some((m) => m.text === text)) continue;
      if (marks.length !== n) throw new Error(`the marked entry holds ${marks.length} marks where ${n} were expected; fix it by hand in Build`);
      await ctx.socket.lre("lre.lore", { op: "mark", bookId, entryId: marked, change: { kind: "add", text, knownTo: ["Dale Whitcomb"], keptFrom: "everyone" } });
      ctx.log.log({ step: "book", action: "changed", kind: "secret mark", id: `wi:${bookId}:${marked}:${n}`, name: text });
      marks = (await read()).find((e) => e.id === marked)?.marks ?? [];
    }

    // Build → Lore → World Info entries' Save of the engine's own fields, through the CLI.
    const fields = { links: ["alder_harbor_marina", "dale_whitcomb"], aliases: ["marina keys"] };
    const now = (await read()).find((e) => e.id === marked) as (EntryView & { lore?: { links?: string[] } }) | undefined;
    if ((now?.lore?.links ?? []).join(",") !== fields.links.join(",")) {
      await ctx.cli.run(["lore-fields", bookId, marked, "--fields", JSON.stringify(fields)]);
      ctx.log.log({ step: "book", action: "changed", kind: "entry fields (lumi_rp_engine.lore)", id: marked, detail: fields });
    }

    // An entry as an earlier build left it (its secrecy kept in the entry's extension data), then moved by Build's Secrecy page.
    const legacy = await entryOf(ctx, bookId, LEGACY, () => ({
      comment: LEGACY,
      key: ["lighthouse ledger"],
      content: "The keeper's ledger from the old lighthouse records every ship that ran aground on Gull Island, and who paid to keep it quiet.",
      extensions: { lumi_rp_engine: { lore: { secret: true, gate: "flag('fleet_deal_accepted')", audience: ["npc.choose"], holders: ["marcus_delgado"] } } },
    }));
    ctx.log.set("legacyEntryId", legacy);
    const plan = await ctx.socket.lre<{ book?: { state: string; version: string; entries: { id: string; kind: string }[] } }>("lre.secrecy", { op: "preview", bookId });
    if (plan.book?.state === "legacy") {
      const moved = await ctx.socket.lre<{ book?: { state: string } }>("lre.secrecy", { op: "apply", bookId, version: plan.book.version });
      ctx.log.log({ step: "book", action: "changed", kind: "secrecy move (backup in secrecy/)", id: bookId, detail: { state: moved.book?.state ?? null } });
    } else say(`the book's secrecy move stands at ${plan.book?.state ?? "unknown"}`);
  },
};
