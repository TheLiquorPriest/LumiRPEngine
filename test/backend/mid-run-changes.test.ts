// What the player and the GM do in the RPEngine tab while the engine runs a turn never stops that
// turn's reply (DESIGN §5.1, §4.3 P2). A turn runs on the settings and the chat's own choices it
// started with, so a change to them applies from the chat's next turn, and a failure to read them as
// its run starts fails the run as a failed step does; a write to the chat's world (a payment, a ✎
// fix, a GM edit, a chip's Apply or Undo, a Realism level, detail opened) is held by the turn and
// lands once its reply is in, over what the turn did. Only a change to the chat itself (a message
// sent, edited, swiped or deleted) keeps a prepared reply from starting. Port Alder, on classic and
// on agents with a main agent.

import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import { FRAME_UNREAD } from "../../src/shared/diagnostics";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { BackendToFrontend } from "../../src/shared/protocol";
import { actionRequest, payCardAction } from "../../src/packs/economy/ui/requests";
import type { Generation, QuietScript } from "../support/fake-host";
import { account, MoneyChat } from "../support/money-chat";
import { plainMinds, Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const CHECKING = "acct_pov_checking";
const CARD = "acct_pov_card";
const DANNY = "danny_okafor";
/** A $2 newspaper: a purchase asks first, on a confirm chip. */
const NEWSPAPER = { type: "purchase", payer: "pov", item: "newspaper", price: 2 };
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }]));

const isExtract = (req: QuietRequest): boolean => (req.messages[0]?.content ?? "").includes(EXTRACT_MARK);

/**
 * The models: a main agent runs every role its stage names and commits the stage; interpret reads no
 * action; a read proposes what `proposals` gives for the reply it reads; minds answer plainly.
 */
function models(rig: Rig, proposals: (reply: string) => JsonObject[] = () => []): void {
  let calls = 0;
  rig.host.quietReply = (req: QuietRequest): QuietScript => {
    if ((req.tools ?? []).some((t) => t.name === "run_role")) {
      const stage = req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
      const roles = [...new Set([...stage.matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      const n = ++calls;
      const run = (role: string): QuietToolCall => ({ name: "run_role", args: { role, task: `The ${role} task.` }, callId: `c${n}_${role}` });
      return { content: "", toolCalls: [...roles.map(run), { name: "commit", args: {}, callId: `c${n}_commit` }] };
    }
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: proposals(req.messages[1]?.content ?? "") });
    return plainMinds(req);
  };
}

/** The chat plays on agents, a main agent running each turn, every role as its classic call. */
async function onMainAgent(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY } } }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
}

/** Port Alder with one turn played, on the shipped packs. */
async function alder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  models(rig);
  await rig.turn(chatId, "I look around the kitchen.", "The coffee maker gurgles.");
  return { rig, chatId };
}

/**
 * The player sends `text`, and while the engine runs the turn (from its first model call, the run
 * holding the chat) `act` is done in the tab: the generation the reply streams in (the stopped one
 * when the reply didn't start), and what `act` was answered.
 */
async function playWhile(rig: Rig, chatId: string, text: string, act: () => Promise<BackendToFrontend>): Promise<{ g: Generation; answer: BackendToFrontend }> {
  const base = rig.host.quietReply;
  let made: Promise<BackendToFrontend> | undefined;
  rig.host.quietReply = (req) => {
    made ??= act();
    return base ? base(req) : "{}";
  };
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  rig.host.quietReply = base;
  if (!made) throw new Error("the engine asked no model while it ran");
  return { g, answer: await made };
}

/** Whether the chat says a turn generated nothing. */
async function flagged(rig: Rig, chatId: string): Promise<string | null> {
  const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
  return flag ? `${flag.label}: ${flag.detail ?? ""}` : null;
}

/** The head reply's active record. */
async function headRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Nothing waits any more, and nothing held was refused. */
async function allLanded(rig: Rig, chatId: string): Promise<void> {
  const journal = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal;
  expect([journal?.held, journal?.prereply, journal?.refused]).toEqual([[], undefined, undefined]);
}

describe("paying a card in Play → Money while the engine runs a turn", () => {
  for (const engine of ["classic", "agents"] as const) {
    test(`the reply starts and lands, and the payment lands once it is in (${engine})`, async () => {
      const chat = await MoneyChat.start();
      const { rig, chatId } = chat;
      models(rig);
      if (engine === "agents") await onMainAgent(rig, chatId);
      const before = await chat.hub();
      const { g, answer } = await playWhile(rig, chatId, "I check the news on my phone.", () => rig.send(actionRequest(chatId, payCardAction(CARD, CHECKING, chat.cents("200")))));
      expect(g.halted).toBeUndefined();
      // The payment waits for the turn the engine is preparing, changing nothing yet; its Undo comes once it lands.
      expect(rig.body(answer)).toEqual({ applied: true, pending: true, queued: "engine", undo: null });
      expect(account(await chat.hub(), CARD).cents).toBe(account(before, CARD).cents);
      await rig.host.finish(g, "The headlines scroll past.");
      expect(await flagged(rig, chatId)).toBeNull();
      const after = await chat.hub();
      expect(account(after, CARD).cents).toBe(account(before, CARD).cents + 20000);
      expect(account(after, CHECKING).cents).toBe(account(before, CHECKING).cents - 20000);
      // It is the turn's own: on the reply's record, after the turn's events, the turn played on its engine.
      const rec = await headRecord(rig, chatId);
      expect(rec.status).toBe("ok");
      expect(rec.post.find((p) => p.kind === "fix")?.seq).toBeGreaterThan(rec.seq);
      expect(rec.session === undefined).toBe(engine === "classic");
      await allLanded(rig, chatId);
      expect(rig.rt.ledger.errors).toEqual([]);
    });
  }
});

describe("a settings change while the engine runs a turn", () => {
  test("the reply lands on the settings the turn started with, and the next turn runs on the new ones", async () => {
    const { rig, chatId } = await alder();
    const budget = (await rig.rt.settings.get(rig.host.userId)).modelUse.tokens.sections;
    const asked = rig.host.quietCalls.length;
    const { g, answer } = await playWhile(rig, chatId, "I look out over the harbor.", () => rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: budget + 700 }, steps: { extract: { route: { connectionId: "other", model: "other-model" } } } } } }));
    expect(g.halted).toBeUndefined();
    // Settings has the change at once.
    expect(rig.body(answer).settings).toMatchObject({ modelUse: { tokens: { sections: budget + 700 } } });
    expect((await rig.rt.settings.get(rig.host.userId)).modelUse.tokens.sections).toBe(budget + 700);
    await rig.host.finish(g, "Gulls wheel over the water.");
    expect(await flagged(rig, chatId)).toBeNull();
    // The turn ran on what it started with: its sections on the old budget, its reply read on the old connection.
    expect(rig.rt.inspector.records(chatId)?.at(-1)?.budget.sections).toBe(budget);
    const read = rig.host.quietCalls.slice(asked).filter(isExtract);
    expect(read).toHaveLength(1);
    expect(read[0]?.connectionId).not.toBe("other");
    // The next turn runs on the new ones.
    const next = rig.host.quietCalls.length;
    await rig.turn(chatId, "I head down to the docks.", "The boards creak underfoot.");
    expect(rig.rt.inspector.records(chatId)?.at(-1)?.budget.sections).toBe(budget + 700);
    expect(rig.host.quietCalls.slice(next).filter(isExtract).map((c) => [c.connectionId, c.model])).toEqual([["other", "other-model"]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the settings a turn runs on, read as its engine run starts", () => {
  test("a read that fails fails the run as a failed step does: nothing is generated, Diagnostics says why, the chat's card has Retry, and Retry plays the turn", async () => {
    const { rig, chatId } = await alder();
    const frame = rig.rt.frame.bind(rig.rt);
    rig.rt.frame = () => Promise.reject(new Error("settings.json: disk I/O error"));
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(true);
    const why = `${FRAME_UNREAD} (settings.json: disk I/O error)`;
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect([flag?.label, flag?.detail, flag?.actions.map((a) => a.id)]).toEqual(["The engine didn't finish, so nothing was generated", `Running the engine: ${why}`, ["regenerate", "diagnostics"]]);
    const failed = (await rig.rt.diag.records(chatId, rig.host.userId)).filter((r) => r.kind === "turn" && r.status === "failed");
    expect(failed.map((r) => r.reason)).toEqual([`engine: ${why}`]);
    // The settings read again: Retry (Lumiverse's Regenerate) runs the engine, then the reply.
    rig.rt.frame = frame;
    const retry = await rig.host.start(chatId, { type: "regenerate" });
    expect(retry.halted).toBeUndefined();
    await rig.host.finish(retry, "Gulls wheel over the water.");
    expect(await flagged(rig, chatId)).toBeNull();
    expect((await headRecord(rig, chatId)).status).toBe("ok");
    await allLanded(rig, chatId);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a chip's Apply while a turn is under way", () => {
  test("Apply on the reply being continued, as the Continue waits to start: the reply lands, and what the chip applies lands after it", async () => {
    const { rig, chatId } = await alder();
    models(rig, (reply) => (reply.includes("newspaper") ? [NEWSPAPER] : []));
    await rig.turn(chatId, "I buy a newspaper at the kiosk.", "The vendor hands you a newspaper for two dollars.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    if (!chip) throw new Error("no confirm chip");
    // The player continues the reply: the engine runs for the Continue, and its reply waits to start.
    expect((await rig.host.begin(chatId, { type: "continue" })).halted).toBe("cancelled");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" }))).toEqual({ applied: false, pending: true, queued: "page" });
    // Waiting, it is on the record not yet.
    expect((await headRecord(rig, chatId)).post.some((p) => p.kind === "confirm")).toBe(false);
    const g = await rig.host.begin(chatId, { type: "continue" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The ink is still wet.");
    expect(await flagged(rig, chatId)).toBeNull();
    expect(rig.host.head(chatId)?.swipes).toEqual(["The vendor hands you a newspaper for two dollars. The ink is still wet."]);
    // The purchase it confirmed landed once the Continue was in, and the chip is gone.
    expect((await headRecord(rig, chatId)).post.some((p) => p.kind === "confirm")).toBe(true);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip.id)).toBe(false);
    await allLanded(rig, chatId);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("every other change from the tab while the engine runs a turn", () => {
  /** Each change, made from Play or GM: its request on the chat as it stands, and whether it changed the chat once the reply is in. */
  const CHANGES: [string, (rig: Rig, chatId: string) => Promise<{ request: Record<string, unknown>; landed: () => Promise<boolean> }>][] = [
    ["a ✎ fix of the clock", async (rig, chatId) => ({ request: { type: "lre.fix", chatId, time: "2026-09-14 11:00" }, landed: async () => (await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.time?.value === "2026-09-14 11:00" })],
    ["a GM edit", async (rig, chatId) => ({ request: { type: "lre.edit", chatId, ops: [{ op: "move", entity: DANNY, to: "rusty_anchor" }] }, landed: async () => (await headRecord(rig, chatId)).post.some((p) => p.kind === "fix" && p.gm === true) })],
    [
      "a Realism level",
      async (rig, chatId) => ({
        request: { type: "lre.marker", chatId, kind: "resolve", domain: "money", scope: { all: true }, to: 2 },
        landed: async () => {
          const rec = await headRecord(rig, chatId);
          const markers = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[rig.host.head(chatId)?.id ?? ""]?.ledger.markers ?? [];
          return markers.some((m) => m.kind === "resolve" && m.seq > rec.seq);
        },
      }),
    ],
    ["detail opened", async (rig, chatId) => ({ request: { type: "lre.view.open", chatId, panel: "economy.money", entity: DANNY }, landed: async () => (await headRecord(rig, chatId)).post.some((p) => p.kind === "materialize") })],
    [
      "a ✎ fix's Undo",
      async (rig, chatId) => {
        rig.body(await rig.send({ type: "lre.fix", chatId, time: "2026-09-14 08:00" }));
        const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "fix");
        if (!undo) throw new Error("no Undo on the fix");
        const [, messageId = "", swipe = "0", seq = ""] = undo.id.split(":");
        return {
          request: { type: "lre.chip", chatId, chip: undo.id, choice: "undo" },
          landed: async () => ((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[messageId]?.ledger.swipes[swipe]?.undone ?? []).some((u) => u.in === "post" && u.seq === Number(seq)),
        };
      },
    ],
  ];
  for (const [name, change] of CHANGES) {
    test(`${name}: it waits for the turn, whose reply lands, and lands once the reply is in`, async () => {
      const { rig, chatId } = await alder();
      const { request, landed } = await change(rig, chatId);
      const { g, answer } = await playWhile(rig, chatId, "I stretch and yawn.", () => rig.send(request));
      expect(g.halted).toBeUndefined();
      expect(rig.body(answer).pending).toBe(true);
      await rig.host.finish(g, "You stretch.");
      expect(await flagged(rig, chatId)).toBeNull();
      expect(await landed()).toBe(true);
      await allLanded(rig, chatId);
      expect(rig.rt.ledger.errors).toEqual([]);
    });
  }

  test("GM → This chat's engine and knowledge: the reply lands, the turn finishing on the engine and choices it started with; the next turn plays the new ones", async () => {
    const { rig, chatId } = await alder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: PROMPT_ONLY } } }));
    const { g, answer } = await playWhile(rig, chatId, "I wave at the window.", () => rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents", knowledge: false }));
    expect(g.halted).toBeUndefined();
    // GM → This chat shows the new choices at once.
    expect(rig.body(answer)).toEqual({ knowledge: false, narrator: null, engine: "agents" });
    await rig.host.finish(g, "Someone waves back.");
    expect(await flagged(rig, chatId)).toBeNull();
    // A classic turn's record keeps no session; an agent turn's does.
    expect((await headRecord(rig, chatId)).session).toBeUndefined();
    await rig.turn(chatId, "I go out.", "The street is busy.");
    expect(typeof (await headRecord(rig, chatId)).session?.segment).toBe("string");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a message edited while the engine runs still keeps the reply from starting, saying so, and Retry plays the turn", async () => {
    const { rig, chatId } = await alder();
    const earlier = rig.host.head(chatId)?.id ?? "";
    const { g } = await playWhile(rig, chatId, "I wave.", async () => {
      rig.host.editMessage(chatId, earlier, "The coffee maker hisses.");
      return { lre: 1, type: "lre.result", reqId: "edit", request: "lre.ui", body: { done: true } } as unknown as BackendToFrontend;
    });
    expect(g.halted).toBe("cancelled");
    expect(await flagged(rig, chatId)).toBe("The reply didn't start, so nothing was generated: A message of the chat was sent, edited, swiped or deleted after the engine ran and before the reply started");
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Someone waves back.");
    expect(await flagged(rig, chatId)).toBeNull();
  });
});
