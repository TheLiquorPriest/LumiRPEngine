// The main agent's digest of what changed since its last turn (DESIGN §11, §4.3 `migrate`; INC2-SPEC
// C14): what the player did off screen comes apart from what landed of its turn, told as the player's
// own arrangements or as bookkeeping not for the story; the GM's Apply of the turn's review card says
// it was the GM's; and an Upgrade since then says what it brought in, money first, with the parts its
// picks left to their defaults, so a part play had changed stays out of it. Port Alder on the fixed
// pipeline, every role prompt-only, the scene role at the GM tier.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import { digestOf } from "../../src/backend/agents/turn-task";
import { toChain } from "../../src/backend/ledger-io";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { ReviewCardView } from "../../src/shared/protocol";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { STARTER_WORLDS } from "../../src/packs/index";
import { actionRequest, blankFlowForm, flowCreateAction, transferAction, type ActionBody } from "../../src/packs/economy/ui/requests";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const CASH = "acct_pov_cash";
const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const TOLD = "Off screen, the player saw to these themselves; the story is told of them as done: ";
const BOOKKEEPING = "Bookkeeping the player did off screen, not for the story: ";
const GM = "Applied by the GM: ";
const UPGRADE = "The chat took in an Upgrade of its world (the author's changes, not the story's): ";
const LANDED = "What landed of your last turn: ";

/**
 * A Port Alder chat on agents, its turns on the fixed pipeline with every role prompt-only and the
 * scene role at the GM tier; interpret reads nothing and the reply's read proposes nothing.
 */
async function agentsChat(): Promise<{ rig: Rig; worldId: string; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const roles = Object.fromEntries(ROLE_IDS.map((role): [string, JsonObject] => [role, role === "scene" ? { promptOnly: true, tier: "gm" } : { promptOnly: true }]));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles } } }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  rig.host.quietReply = (req: QuietRequest) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
  return { rig, worldId, chatId };
}

/** A tap with no words: done at once, off screen. */
async function tap(rig: Rig, chatId: string, body: ActionBody): Promise<void> {
  expect(rig.body(await rig.send(actionRequest(chatId, body)))).toHaveProperty("applied", true);
  await rig.rt.push.settle();
}

/** Build's change to the world, committed: a revision an Upgrade can take the chat to. */
async function revision(rig: Rig, worldId: string, entities: readonly EntityDef[]): Promise<string> {
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  for (const e of entities) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id: e.id, value: e as unknown as JsonObject }));
  return String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
}

/** The digest the main agent's next turn would get, its last turn the head reply's. */
async function digest(rig: Rig, chatId: string, fresh = false): Promise<string> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const last = observed.findLastIndex((m) => !m.isUser);
  return digestOf({ core, observed, registry: rig.rt.registry, last: fresh ? null : last, fresh, tokens: 20_000, texts: {} });
}

/** A digest's part that starts with `lead`, to its end. */
function part(text: string, lead: string): string {
  const at = text.indexOf(lead);
  if (at < 0) throw new Error(`no "${lead}" in the digest:\n${text}`);
  const end = text.indexOf("\n\n", at);
  return text.slice(at + lead.length, end < 0 ? undefined : end);
}

describe("the main agent's digest since its last turn", () => {
  test("off-screen actions come apart, told and not, a review card's Apply is the GM's, and an Upgrade says what it took in, money first", async () => {
    const { rig, worldId, chatId } = await agentsChat();
    // Before the turn: the GM puts cash in, and Danny's cooking changes in play.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CASH, cents: 5000 }] }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "danny_okafor", field: "cooking", value: 9 }] }));
    // The turn: the scene role takes a dollar of cash, a money adjustment, which waits for the GM's Apply on the review card.
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        await ctx.writer.apply([{ kind: "gm_edit", op: { op: "adjust", account: CASH, cents: -100 } }], "the scene's change");
        return roles.scene(task, ctx);
      },
    };
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "You count your cash.");
    rig.rt.orchestrator.roles = roles;
    const [card] = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: card?.turn })).cards).toEqual([expect.objectContaining({ items: [expect.objectContaining({ status: "applied" })] })]);

    // Off screen since: a standing payment to someone else (told), and a transfer between Jordan's own accounts (not told).
    await tap(rig, chatId, flowCreateAction({ ...blankFlowForm(CHECKING), label: "Slip fee", to: "Alder Harbor Marina", amount: "40", day: 5 }, DEFAULT_CURRENCY));
    await tap(rig, chatId, transferAction(CHECKING, SAVINGS, 1000));

    // Then an Upgrade with no picks, as the Upgrade sheet sends one that takes every default: a new
    // income, a bill's new price, a new key, and Danny's cooking, which play changed and so stays.
    const starter = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Alder");
    const streaming = starter.entities.bill_streaming;
    const danny = starter.entities.danny_okafor;
    if (!streaming || !danny) throw new Error("no streaming bill or Danny in Port Alder");
    const to = await revision(rig, worldId, [
      { ...streaming, fields: { ...streaming.fields, amount_cents: 2299 } },
      { ...danny, fields: { ...danny.fields, cooking: 14 } },
      { id: "flow_pov_marina_work", kind: "flow", name: "Marina side work", tier: "background", fields: { flow_kind: "income", from: "Alder Harbor Marina", to: CHECKING, amount_cents: 20_000, shortfall: "skip", status: "active", every: "month", days: [15], category: "income" }, relations: [] },
      { id: "pov_marina_key", kind: "item", name: "Marina gate key", tier: "background", fields: { owner: "pov", place: "harbor_street_114" }, relations: [] },
    ]);
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to, merge: {} }));

    const since = await digest(rig, chatId);
    expect(since.startsWith("What happened in this chat since your last turn, oldest first:")).toBe(true);
    // The standing payment changed nothing Jordan sees yet: the Journal, and so the digest, reads it as the action it was.
    expect(part(since, TOLD)).toStartWith("Set up a standing payment: Slip fee");
    expect(part(since, BOOKKEEPING)).toBe("Transfer: $10.00 from Your checking account to Your savings account");
    // Only what came after the last turn: the GM's cash and Danny's cooking before it are left out.
    expect(part(since, GM)).toBe("Correction: $1.00 out of Your wallet cash");
    // Money first; Danny's cooking, changed in play, stayed the chat's, so Danny isn't in it.
    expect(part(since, UPGRADE)).toBe("Streaming video (money flow, changed); Marina side work (money flow, new); Marina gate key (item, new)");
    // Neither the player's nor the GM's goes under what landed of the turn.
    expect(part(since, LANDED)).toBe("30 min passed");

    // A fresh session's digest, the chat so far, keeps them apart all the same.
    const fresh = await digest(rig, chatId, true);
    expect(fresh.startsWith("You take this chat up now, with no session of your own in it yet.")).toBe(true);
    for (const lead of [TOLD, BOOKKEEPING, GM, UPGRADE]) expect(fresh).toContain(lead);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
