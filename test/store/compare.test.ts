// The same invented chat folded by today's fold (`LedgerFold`, over today's per-message ledger) and by
// the new one (the store, over turns and changes imported as plan §15.3 item 7 says: each swipe
// along its own recorded path, what today's fold applied there becoming that turn's changes). Time,
// place, coin and inventory are equal at the head and at every swipe, and so is the whole state.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent, Marker, Rec } from "../../src/shared/ledger";
import type { ChainMessage, FoldOutput } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../src/engine/ledger/path";
import { optionalQuery } from "../../src/engine/pack-kit";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { ChangeInput } from "../../src/store/types";
import { carried, engine, goTo, hand, make, pay, POV, registry, testStore, tick } from "./fixtures";

const ORDER = ["a0", "u1", "a1", "u2", "a2", "u3", "a3", "u4", "a4"] as const;
type Id = (typeof ORDER)[number];

/** The chat's messages as today's build keeps them: each reply's swipes, and its ledger. */
function messages(): Record<Id, ChainMessage> {
  const reply = (id: string, ...swipes: string[]): ChainMessage => ({ id, isUser: false, swipeId: 0, swipes, ledger: { v: 1, swipes: {}, markers: [] } });
  const user = (id: string, text: string): ChainMessage => ({ id, isUser: true, swipeId: 0, swipes: [text], ledger: null });
  return {
    a0: { id: "a0", isUser: false, swipeId: 0, swipes: ["Rain hammers the shutters of the Lamp and Ladle."], ledger: null },
    u1: user("u1", "I order a hot cider and pay for it."),
    a1: reply("a1", "Bram pours, and takes her coin."),
    u2: user("u2", "I go down to the cellar."),
    a2: reply("a2", "Odile hands her a lantern at the foot of the stairs.", "She thinks better of it and stays by the fire."),
    u3: user("u3", "I leave the lantern by the cask and take my knife."),
    a3: reply("a3", "The lantern goes by the cask; the knife to her hand.", "She only takes the knife."),
    u4: user("u4", "Back upstairs, and I buy a pie."),
    a4: reply("a4", "Up the stairs, and a pie from Bram.", "She waits, and finds a folded note in her pocket."),
  };
}

/** A recorded path: which swipe each reply showed, up to `last`. */
type Picks = Partial<Record<Id, number>>;

function chainOf(msgs: Record<Id, ChainMessage>, picks: Picks, last: Id): ChainMessage[] {
  const out: ChainMessage[] = [];
  for (const id of ORDER) {
    out.push({ ...msgs[id], swipeId: picks[id] ?? 0 });
    if (id === last) break;
  }
  return out;
}

interface Played {
  id: Id;
  swipe: number;
  /** The swipes the replies before it showed when it was played. */
  picks: Picks;
  events: LedgerEvent[];
  markers?: Marker[];
  date: number;
}

describe("the new fold against today's", () => {
  test("time, place, coin and inventory are equal at the head and at every swipe", () => {
    const { s, world, revision } = testStore();
    const reg = registry();
    const msgs = messages();
    // Each swipe's record, made on the path that showed when it was played, as today's build makes it.
    const played: Played[] = [
      { id: "a1", swipe: 0, picks: {}, markers: [{ kind: "resolve", domain: "gear", scope: { all: true }, to: 2, seq: 1, at: null }], events: [tick(10), pay("acct_wren", 150, "Hot cider"), { type: "set", entity: POV, field: "mood", value: "warm" }], date: 101 },
      { id: "a2", swipe: 0, picks: { a1: 0 }, events: [goTo(POV, "cellar"), make("lantern", "Lantern", POV), { type: "relationships.regard", data: { from: "odile", to: POV, deltas: { trust: 3 }, why: "a kind word" } }, tick(5)], date: 201 },
      { id: "a2", swipe: 1, picks: { a1: 0 }, events: [{ type: "castlife.need", data: { entity: POV, need: "hunger", delta: -20, at: 0, from: 40 } }, tick(30)], date: 202 },
      { id: "a3", swipe: 0, picks: { a1: 0, a2: 0 }, events: [...hand("lantern", POV, "cask"), ...hand("knife", "satchel", POV), tick(3)], date: 301 },
      { id: "a3", swipe: 1, picks: { a1: 0, a2: 0 }, events: [...hand("knife", "satchel", POV), tick(4)], date: 302 },
      { id: "a4", swipe: 0, picks: { a1: 0, a2: 0, a3: 0 }, events: [goTo(POV, "common_room"), tick(2), pay("acct_wren", 50, "A pie")], date: 401 },
      // Played after the second reply was flipped to its other swipe, on top of the third reply as it then stood.
      { id: "a4", swipe: 1, picks: { a1: 0, a2: 1, a3: 0 }, events: [tick(7), make("note", "Folded note", POV)], date: 402 },
    ];
    let seq = 1;
    for (const p of played) {
      const chain = chainOf(msgs, { ...p.picks, [p.id]: p.swipe }, p.id);
      const at = chain.length - 1;
      const parent = computePaths(chain, [])[at]?.parentPath ?? "";
      const ledger = msgs[p.id].ledger;
      if (!ledger) throw new Error(`no ledger on ${p.id}`);
      if (p.markers) ledger.markers.push(...p.markers);
      const rec: Rec = { v: 1, defHash: revision, seq: ++seq, swipeHash: contentId(msgs[p.id].swipes[p.swipe] ?? ""), path: parent, seed: "s", pre: p.events.length, events: p.events, post: [], markersApplied: p.markers?.length ?? 0, status: "ok", undone: [], intents: {} };
      ledger.swipes[String(p.swipe)] = rec;
    }
    const today = (chain: ChainMessage[]): FoldOutput => new LedgerFold(reg).fold({ worlds: (r) => (r === revision ? world : undefined), revision, chain, pauses: [], tombstones: [], resolveFix: () => null });
    /** What today's fold dropped on a chain, by message and event index. */
    const dropsOf = (out: FoldOutput): [string, number][] => out.notes.filter((n) => n.kind === "dropped").map((n) => [n.messageId, n.ref && "in" in n.ref ? n.ref.index : -1]);

    // The import: each swipe a turn, on the path it was played on; what today's fold applied there, its changes.
    s.createChat({ id: "c", revision });
    const turns = new Map<string, { id: string; node: string }>();
    const key = (id: Id, swipe: number): string => `${id}:${swipe}`;
    const turnOf = (id: Id, swipe: number): string => {
      const t = turns.get(key(id, swipe));
      if (!t) throw new Error(`no turn for ${id} swipe ${swipe}`);
      return t.id;
    };
    for (const p of played) {
      let on: string | null = null;
      for (const id of ORDER) {
        if (id === p.id) break;
        if (id.startsWith("u") || id === "a0") continue;
        const t = turns.get(key(id, p.picks[id] ?? 0));
        if (!t) throw new Error(`no turn for ${id}`);
        on = s.extendPath(on, t.id);
      }
      // In the order the migration's importer calls: begin, tie to the message, add what today's fold applied.
      const t = s.beginTurn({ chat: "c", kind: p.swipe === 0 ? "normal" : "swipe", imported: true, on });
      s.tieTurn(t.id, { message: p.id, hash: contentId(msgs[p.id].swipes[p.swipe] ?? "").hash, date: p.date });
      const markers: ChangeInput[] = (p.markers ?? []).map(({ seq: _seq, at: _at, start: _start, ...body }) => ({ lane: "engine", op: "store.marker", value: body as unknown as JsonObject, by: "import", source: "import" }));
      s.addChanges(t.id, [...markers, ...engine(...p.events).map((c) => ({ ...c, by: "import", source: "import" as const }))]);
      turns.set(key(p.id, p.swipe), { id: t.id, node: t.node });
    }
    expect(s.isPlayed("c")).toBe(false);

    const four = (state: WorldState) => {
      const ctx = reg.context(world, state);
      return {
        time: state.clock,
        place: placeOfEntity(state, POV),
        coin: { accounts: state.accounts, carried: optionalQuery(ctx, "economy.carried_cash")?.(ctx, POV) ?? null },
        inventory: carried(state, POV).map((id) => [id, state.entities[id]?.fields.qty ?? 1]),
      };
    };

    // At every swipe, along its own recorded path: the same state, and what does not apply there is what today's fold drops.
    for (const p of played) {
      const theirs = today(chainOf(msgs, { ...p.picks, [p.id]: p.swipe }, p.id));
      const ours = s.stateAt(turnOf(p.id, p.swipe));
      expect(four(ours.state.world)).toEqual(four(theirs.state));
      expect(hashJson(ours.state.world)).toBe(hashJson(theirs.state));
      expect(ours.notApplied.length).toBe(dropsOf(theirs).length);
    }

    // At the head: the second reply flipped to its other swipe, with the third and fourth after it.
    const headPicks: Picks = { a1: 0, a2: 1, a3: 0, a4: 1 };
    const headChain = chainOf(msgs, headPicks, "a4");
    s.sync(
      "c",
      headChain.map((m) => ({ id: m.id, user: m.isUser, hash: contentId(m.swipes[m.swipeId] ?? "").hash, date: m.isUser ? null : (played.find((p) => p.id === m.id && p.swipe === m.swipeId)?.date ?? null), hidden: false })),
    );
    const theirs = today(headChain);
    const ours = s.headState("c");
    expect(four(ours.state.world)).toEqual(four(theirs.state));
    expect(hashJson(ours.state.world)).toBe(hashJson(theirs.state));
    // What no longer applies at the head is what today's fold drops there: handing over a lantern this swipe never made.
    expect(dropsOf(theirs)).toEqual([
      ["a3", 0],
      ["a3", 1],
    ]);
    expect(ours.notApplied.map((n) => [n.turn, n.op])).toEqual([
      [turnOf("a3", 0), "unlink"],
      [turnOf("a3", 0), "link"],
    ]);
    // The four values differ between swipes, so equality above means something.
    expect(four(ours.state.world)).not.toEqual(four(s.stateAt(turnOf("a4", 0)).state.world));
  });
});
