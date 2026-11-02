// The lore tools' read of a World Info entry (INC1-SPEC R3b; DESIGN §4.2), driven on the fake host
// with no model, in Port Alder. A user's entry text reaches each view through `applyMarks`: a secret
// mark (Marcus's debt, kept from everyone but him) is there under every view, marked as Marcus's in
// the user's own wording of a mark (the registry's `narrator.mark.known`), and the mark's own entry
// reads marked too.

import { describe, expect, test } from "bun:test";
import type { ToolOutcome } from "../../src/backend/agents/runtime";
import { LORE_TOOLS } from "../../src/backend/agents/tools/lore";
import { outsideReader, type ViewLore } from "../../src/backend/agents/tools/read-view";
import { bookLoreId, bookMarkLoreId } from "../../src/backend/book-lore";
import type { HostBookEntryInput } from "../../src/backend/host";
import type { ToolView } from "../../src/shared/agent-tools";
import { Rig } from "../support/rig";

const FERRY = "FERRY-MARK: the ferry runs twice a day.";
const DEBT = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
/** The user's own wording of a mark known to some (Settings → Agents → Prompts → Final output). */
const KNOWN = "{{text}} (a secret only {{known}} knows)";

/** What `lore_read` answers for `id` in `chatId` under `knowledge`, as an agent's call gets it. */
async function loreRead(rig: Rig, chatId: string, knowledge: ToolView, id: string): Promise<ToolOutcome> {
  const tool = LORE_TOOLS.find((t) => t.name === "lore_read");
  if (!tool) throw new Error("no lore_read tool");
  const base = { userId: rig.host.userId, chatId, knowledge };
  return tool.run({ id }, { ...base, reader: outsideReader(rig.rt, base), writer: null, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal });
}

/** A lore read's entry; a refusal fails the test with its note. */
function entryOf(out: ToolOutcome): ViewLore {
  if (out.error) throw new Error(`lore_read refused: ${out.text}`);
  return JSON.parse(out.text) as ViewLore;
}

describe("lore_read of a World Info entry", () => {
  test("under every view, a secret mark is there, marked as Marcus's in the user's wording", async () => {
    const rig = new Rig({ shipped: true });
    const user = rig.host.userId;
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { "narrator.mark.known": KNOWN } } } }));
    // A book of the user's, attached to the chat as the host's World Info picker attaches one; its author named Marcus by a word of his name.
    const bookId = await rig.host.books.create("Harbor notes", "", user);
    const ferry: HostBookEntryInput = { comment: "The ferry", content: `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`, keys: ["ferry"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {} };
    const entryId = await rig.host.books.createEntry(bookId, ferry, user);
    const meta = await rig.host.chats.chatMetadata(chatId, user);
    const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, bookId] }, user);
    const id = bookLoreId(bookId, entryId);
    // The mark's own entry, beside the book entry's.
    const mark = bookMarkLoreId(bookId, entryId, 1);

    const marked = `${DEBT} (a secret only Marcus Delgado knows)`;
    for (const knowledge of ["everyone", "gm"] as const) {
      const read = entryOf(await loreRead(rig, chatId, knowledge, id));
      // Read by its lore id, it answers by its short id: the first LRE gave, as the entry carries no tag.
      expect(read).toMatchObject({ id: "lre0001", title: "The ferry" });
      expect(read.text).toContain(FERRY);
      expect(read.text).toContain(marked);
    }
    expect(entryOf(await loreRead(rig, chatId, "everyone", mark)).text).toBe(marked);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
