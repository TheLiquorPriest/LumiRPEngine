// A Port Alder chat on the shipped packs driven as the money hub drives it (DESIGN §7, §25): the
// player's controls sent as in-world actions and played as turns, the GM's as edits, and the
// views the hub draws read back through its own decoder.

import { expect } from "bun:test";
import type { AccountView, FinanceView } from "../../src/shared/finance";
import type { Level } from "../../src/shared/ids";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { BackendToFrontend, EditOp } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../../src/shared/world";
import { editRequest, resolveMarker, timelapseRequest } from "../../src/frontend/requests";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { actionRequest, amountOf, type ActionBody } from "../../src/packs/economy/ui/requests";
import { Rig } from "./rig";

/** The GM view's Money tab: everyone's money as it decodes `lre.gm`, and each entity's declared fields (what its ✎ forms edit) with their values. */
export interface GmMoney {
  money: FinanceView[];
  fields: Map<string, string[]>;
  values: Map<string, Record<string, unknown>>;
}

/** What a test changes in the world before the chat starts: fields added to places (a cash machine, a branch) and set on entities. */
export interface WorldPatch {
  places?: Record<string, JsonObject>;
  entities?: Record<string, JsonObject>;
}

export class MoneyChat {
  private constructor(
    readonly rig: Rig,
    readonly chatId: string,
    readonly currency: WorldCurrency,
  ) {}

  /** Port Alder with `patch` committed to the world, a chat attached, and Play → Money opened as picking the tab opens it. */
  static async start(patch: WorldPatch = {}): Promise<MoneyChat> {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const edits = [...Object.entries(patch.places ?? {}).map(([id, fields]) => ({ collection: "places", id, fields })), ...Object.entries(patch.entities ?? {}).map(([id, fields]) => ({ collection: "entities", id, fields }))];
    if (edits.length > 0) {
      const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
      const doc = isRecord(draft.draft) ? draft.draft : {};
      for (const { collection, id, fields } of edits) {
        const items = doc[collection];
        const item = isRecord(items) ? items[id] : undefined;
        if (!isRecord(item)) throw new Error(`no ${collection} ${id}`);
        const value = { ...item, fields: { ...(isRecord(item.fields) ? item.fields : {}), ...fields } };
        rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection, id, value }));
      }
      rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    }
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // Picking Play → Money opens the POV's money (play.tsx), which posts the authored openings.
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "economy.money", entity: null }));
    await rig.rt.push.settle();
    return new MoneyChat(rig, chatId, (await rig.rt.view(chatId, rig.host.userId)).currency ?? DEFAULT_CURRENCY);
  }

  /** The state view the client renders. */
  async state(): Promise<StateView> {
    return this.rig.rt.view(this.chatId, this.rig.host.userId);
  }

  /** Play → Money: the POV's money as the panel decodes the view the backend sends. */
  async hub(): Promise<FinanceView> {
    const view = decodeFinanceView((await this.state()).panels["economy.money"]);
    if (!view) throw new Error("Play → Money can't draw the POV's money");
    return view;
  }

  async gm(): Promise<GmMoney> {
    const body = this.rig.body(await this.rig.send({ type: "lre.gm", chatId: this.chatId }));
    const money = (Array.isArray(body.money) ? body.money : []).map((raw) => {
      const view = decodeFinanceView(raw);
      if (!view) throw new Error("the GM view's Money can't draw a party");
      return view;
    });
    const fields = new Map<string, string[]>();
    const values = new Map<string, Record<string, unknown>>();
    for (const e of Array.isArray(body.entities) ? body.entities : []) {
      if (!isRecord(e) || typeof e.id !== "string") continue;
      const own = Array.isArray(e.fields) ? e.fields.filter(isRecord) : [];
      fields.set(e.id, own.flatMap((f) => (typeof f.id === "string" ? [f.id] : [])));
      values.set(e.id, Object.fromEntries(own.flatMap((f) => (typeof f.id === "string" && f.value !== undefined ? [[f.id, f.value]] : []))));
    }
    return { money, fields, values };
  }

  /** One party's money in the GM view. */
  async party(id: string): Promise<FinanceView> {
    const view = (await this.gm()).money.find((m) => m.party === id);
    if (!view) throw new Error(`the GM view has no money for ${id}`);
    return view;
  }

  /** A player control: its action sent as the hub sends it, then the turn it plays as. Returns the turn's outcome lines. */
  async play(body: ActionBody): Promise<string> {
    this.rig.body(await this.rig.send(actionRequest(this.chatId, body)));
    await this.rig.host.settle();
    const generation = await this.rig.host.start(this.chatId, { type: "normal" });
    const outcome = this.rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    await this.rig.host.finish(generation, "Done.");
    await this.rig.rt.push.settle();
    return outcome;
  }

  /** A GM control: its operations as one edit. Returns the reply, a refusal included. */
  async edit(ops: EditOp[]): Promise<BackendToFrontend> {
    const reply = await this.rig.send(editRequest(this.chatId, ops));
    await this.rig.rt.push.settle();
    return reply;
  }

  /** Time passing, as the palette's Timelapse sends it. */
  async timelapse(minutes: number): Promise<void> {
    const timelapse = (await this.state()).palette?.timelapse;
    if (!timelapse) throw new Error("no Timelapse");
    this.rig.body(await this.rig.send(timelapseRequest(timelapse, { type: "duration", minutes }, {}, this.chatId)));
    await this.rig.host.settle();
    const generation = await this.rig.host.start(this.chatId, { type: "normal" });
    await this.rig.host.finish(generation, "Time passes.");
    await this.rig.rt.push.settle();
  }

  /** The POV's Money level, as Play → Realism sets it. */
  async level(to: Level): Promise<void> {
    this.rig.body(await this.rig.send(resolveMarker(this.chatId, "money", { entity: "pov" }, to)));
  }

  /** An amount as typed into a control. */
  cents(text: string): number {
    const cents = amountOf(text, this.currency);
    if (cents === null) throw new Error(`${text} isn't an amount`);
    return cents;
  }
}

export function account(view: FinanceView, id: string): AccountView {
  const a = view.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`no ${id} in ${view.name}'s money`);
  return a;
}

/** Cash on hand as the hub shows it. */
export function cashOf(view: FinanceView): number {
  return view.cash && "cents" in view.cash ? view.cash.cents : 0;
}

/** What a refused edit says. */
export function refusal(reply: BackendToFrontend): string {
  if (reply.type !== "lre.error") throw new Error(`the edit wasn't refused (${reply.type})`);
  return reply.message;
}

export function accepted(reply: BackendToFrontend): void {
  if (reply.type === "lre.error") throw new Error(`the edit was refused: ${reply.message}`);
  expect(reply.type).toBe("lre.result");
}
