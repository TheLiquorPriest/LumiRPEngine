// A chat switched to another player character (D-10, `minds.v2.pov`) before Play as was turned off:
// from the switch on, his action is played as the character he switched to, what the narrator is
// told the player character knows is that character's (the secret only the switched character holds
// is told as his own once he plays him, and never while he plays the world's own), and the chips
// after the reply name things as he knows them. Play as itself isn't supported yet: the backend
// refuses a switch, and the chat keeps the one it plays.

import { describe, expect, test } from "bun:test";
import { headBasis, PLAY_AS_OFF } from "../../src/backend/character-engine";
import { toChain } from "../../src/backend/ledger-io";
import { MIND_POV, mindPovEvent } from "../../src/shared/character-engine";
import type { ChatId, EntityId } from "../../src/shared/ids";
import { placeOfEntity } from "../../src/engine/scope";
import { alderChat, DANNY, fakeModels, PRIYA } from "../support/mind-chat";
import { Rig } from "../support/rig";

const SHOP = "alder_automotive";
const MARKET = "alder_market";
const SEEN = "SEEN-MARK: Danny saw the boat go down from the breakwater";
const LOCKUP = "danny_lockup";
const PHONE = "danny_phone";
const INTERPRET_MARK = "You map a player's typed input";
/** An entry a user's book holds, as the host's World Info editor writes it. */
const bookEntry = (content: string) => ({ comment: "The breakwater", content, keys: ["breakwater"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {} });

/** The switch as Play as landed it before it was turned off: `minds.v2.pov` at the chat's head. */
async function switchTo(rig: Rig, chatId: ChatId, who: EntityId): Promise<void> {
  const userId = rig.host.userId;
  const basis = await headBasis(rig.rt, chatId, userId);
  if (!basis) throw new Error("no basis");
  expect((await rig.rt.ledger.landLayer(chatId, userId, { id: `pov:${who}:${basis.message}:${basis.swipe}`, basis, kind: MIND_POV, events: [mindPovEvent(who)], by: { role: "user" } })).status).toBe("landed");
}

describe("Play as (D-10)", () => {
  test("isn't supported yet: the backend refuses a switch in words the player reads, and the chat keeps the one it plays", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    expect(await rig.send({ type: "lre.depth", op: "pov", chatId, who: DANNY })).toMatchObject({ type: "lre.error", code: "validation", message: PLAY_AS_OFF });
    expect((await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).filter((s) => s.kind === MIND_POV)).toEqual([]);
    const minds = rig.body(await rig.send({ type: "lre.depth", op: "minds", chatId })) as { minds: { pov: { id: string } | null } };
    expect(minds.minds.pov?.id).toBe("pov");
  });
});

describe("a chat switched to another player character", () => {
  test("plays the player's action as the character he switched to", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", DANNY].map((entity) => ({ op: "move", entity, to: SHOP })) }));
    await switchTo(rig, chatId, DANNY);
    rig.body(await rig.send({ type: "lre.action", chatId, action: "go", params: { to: MARKET }, source: "palette", now: true }));
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Danny walks over to the market.");

    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const messages = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const rec = core?.chain(messages).at(-1)?.ledger?.swipes["0"];
    expect((rec ? rig.rt.bridgeOf(chatId)?.planFor(rec.seed)?.resolutions : undefined)?.map((r) => [r.action, r.actor, r.ok])).toEqual([["go", DANNY, true]]);
    const state = core?.fold(messages).state;
    if (!state) throw new Error("no state");
    expect([placeOfEntity(state, DANNY), placeOfEntity(state, "pov")]).toEqual([MARKET, SHOP]);
  });

  test("tells the narrator what the character he switched to knows as the player character's own, and none of it before", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    await rig.host.books.createEntry(bookId, bookEntry(`The breakwater is older than the pier.\n{{// Secret (known to Danny Okafor): ${SEEN}}}`), rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [bookId] }, rig.host.userId);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, narrator: { knowledge: "pov", secrets: "marked" } }));
    // The first turn with the book seeds what its mark gives Danny; the sections read it from the next.
    await rig.turn(chatId, "Morning.", "The shop opens.");
    const told = async (said: string): Promise<string[]> => {
      await rig.turn(chatId, said, "Gulls wheel over the harbor.");
      return rig.host.section("Who knows what").split("\n").filter((l) => l.includes(SEEN));
    };
    expect(await told("I look out at the water.")).toEqual([]);
    await switchTo(rig, chatId, DANNY);
    expect(await told("I look out at the water again.")).toEqual([`- You: ${SEEN} (from the start); keeps it from everyone`]);
  });

  test("names in the turn's chips what the character he switched to knows: where his own thing was, brought along, a place only he knows", async () => {
    const rig = new Rig({ shipped: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "custom", claims: { mode: "real", capped: false } } } }));
    const chatId = await alderChat(
      rig,
      async (put) => {
        await put("places", LOCKUP, { id: LOCKUP, name: "Danny's lockup", parent: "harbor_street_114", visibility: "known_by", knownBy: { ids: [DANNY] }, fields: {} });
        await put("entities", PHONE, { id: PHONE, kind: "item", name: "Phone", tier: "background", fields: { owner: DANNY, place: LOCKUP, category: "carried", slot: "pocket", weight_g: 190, volume_l: 0.1 }, relations: [] });
      },
      [DANNY, PRIYA],
    );
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ confidence: 0.9, action: "use", params: { item: PHONE }, thing: "other" }) : "{}");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", DANNY].map((entity) => ({ op: "move", entity, to: SHOP })) }));
    await switchTo(rig, chatId, DANNY);
    await rig.turn(chatId, "I check my phone.", "Danny scrolls through his messages.");
    const brought = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "claimed");
    expect(brought?.detail).toStartWith("It was at Danny's lockup");
  });
});
