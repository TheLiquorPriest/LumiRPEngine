// The place sheet's Things here (`here.tsx`; ITEMS-SPEC §10.3): its groups (In the room, Lying here,
// and what is in each holder there the player character may use) and the controls each of their own
// things gets, which change it at once, off screen: Take, Put in… and Put away, each the gear pack's
// own action sent with `offstage` and no words (no message, no turn, no clock time), recorded as the
// player's fix with its Undo, which the notice over the list offers. The palette's taps and typed
// words stay the story's: they play as the next turn. A thing someone else owns shows without
// controls. The engine judges a control when it lands and refuses with its reason; where the
// palette has judged it already, that reason shows on the button. Also where Put in… and the item
// sheet's ✎ Where is it? may put a thing (`holdersFor`).

import type { ChatId, EntityId } from "../../../shared/ids";
import type { PaletteEntry } from "../../../shared/state-view";
import { Button, IdText } from "../../../frontend/components";
import { Icon, type IconName } from "../../../frontend/icons";
import type { Req } from "../../../frontend/requests";
import type { GearItem, GearView } from "../core/view";
import { AS_LABEL } from "./belongings";

/** The gear actions Things here's controls send at once, each with its button (the offstage table's gear actions). */
export const MANAGE_CONTROLS = {
  take: { label: "Take", icon: "bag" },
  put_in: { label: "Put in…", icon: "box" },
  put_away: { label: "Put away", icon: "home" },
} as const satisfies Record<string, { label: string; icon: IconName }>;

export type ManageAction = keyof typeof MANAGE_CONTROLS;

/** A group's kind on the place sheet. */
export type ManageKey = "room" | "lying" | "inside";

/** The controls the player character's own things get in each group, in the order their buttons show. */
const GROUP_CONTROLS: Readonly<Record<ManageKey, readonly ManageAction[]>> = {
  // Furnishings stand where they are: what is in them is a group of its own.
  room: [],
  lying: ["take", "put_in", "put_away"],
  inside: ["take", "put_away"],
};

export interface ManageGroup {
  key: ManageKey;
  title: string;
  items: GearItem[];
}

/** Things here's groups on the place sheet: In the room, Lying here, and what is in each holder here; the empty ones left out. */
export function hereGroups(here: NonNullable<GearView["here"]>): ManageGroup[] {
  const groups: ManageGroup[] = [{ key: "room", title: "In the room", items: here.room }, { key: "lying", title: "Lying here", items: here.lying }, ...here.inside.map((h): ManageGroup => ({ key: "inside", title: `In ${h.holder.name}`, items: h.items }))];
  return groups.filter((g) => g.items.length > 0);
}

/** A holder Put in… may put a thing into. */
export interface Holder {
  id: EntityId;
  name: string;
}

/** A thing and everything in it, by id. */
function within(item: GearItem): string[] {
  return [item.id, ...(item.children ?? []).flatMap(within)];
}

/**
 * Where Put in… may put a thing: what the player character carries that takes things, the holders
 * here they own or may use, and their wardrobe's holders, each once; never the thing itself or
 * anything in it. The engine still judges the fit and the reach when it lands.
 */
export function holdersFor(view: GearView, item: GearItem): Holder[] {
  const skip = new Set(within(item));
  const out = new Map<string, Holder>();
  const add = (holder: Holder): void => {
    if (!skip.has(holder.id)) out.set(holder.id, holder);
  };
  const walk = (things: readonly GearItem[]): void => {
    for (const t of things) {
      if (t.holds !== undefined && t.mine === true) add({ id: t.id, name: t.name });
      walk(t.children ?? []);
    }
  };
  walk(view.carried);
  if (view.here) {
    walk(view.here.room);
    walk(view.here.lying);
    for (const h of view.here.inside) add(h.holder);
  }
  for (const w of view.wardrobe) if (w.holder) add(w.holder);
  return [...out.values()];
}

/** The controls one thing gets in its group: none for someone else's; Put in… only with somewhere to put it. */
export function controlsFor(key: ManageKey, item: GearItem, holders: readonly Holder[]): ManageAction[] {
  if (item.mine !== true) return [];
  return GROUP_CONTROLS[key].filter((action) => action !== "put_in" || holders.length > 0);
}

/**
 * The palette's word on one control when it lists that thing for that action: why it can't be done
 * now (`disabled`), or that it can; null when the palette doesn't list it (the engine judges it).
 * Put in…'s holder is the option's second pick.
 */
export function judged(entries: readonly PaletteEntry[], action: ManageAction, item: EntityId, into?: EntityId): { disabled?: string } | null {
  const option = entries.find((e) => e.action === action)?.options.find((o) => o.params.item === item);
  const pick = into === undefined ? (option?.next ? undefined : option) : option?.next?.options.find((o) => o.params.into === into);
  if (!pick) return null;
  return pick.disabled !== undefined ? { disabled: pick.disabled } : {};
}

/** The at-once request one control sends: the gear pack's action with no words, off screen, as a panel tap. */
export function manageRequest(chatId: ChatId, action: ManageAction, item: EntityId, into?: EntityId): Req<"lre.action"> {
  return { type: "lre.action", chatId, action, params: { item, ...(into !== undefined ? { into } : {}) }, source: "palette", offstage: true };
}

/** What a control did, as the notice over the list says it. */
export function doneWords(action: ManageAction, item: string, into?: string): string {
  switch (action) {
    case "put_in":
      return `You put ${item} in ${into ?? "it"}.`;
    case "put_away":
      return `You put ${item} away.`;
    case "take":
      return `You took ${item}.`;
  }
}

/** What a row and its contents share: the view (for Put in…'s holders), the palette's judgments, and the one open Put in…. */
interface RowCtx {
  chatId: ChatId;
  view: GearView;
  entries: readonly PaletteEntry[];
  busy: boolean;
  putting: EntityId | null;
  onPutting(id: EntityId | null): void;
  onSend(request: Req<"lre.action">, text: string): void;
  /** Opens a row's item sheet, for the rows `opens` says have one (every row, without it); else its name is plain text. */
  onOpen?(id: EntityId): void;
  opens?(id: EntityId): boolean;
}

/** A thing's second line: how it is on you, its slot, where it is, whose it is when it isn't yours. */
function subOf(item: GearItem): string {
  const whose = item.whose !== undefined && item.whose !== "yours" ? item.whose : null;
  return [item.as ? AS_LABEL[item.as] : null, item.slot ?? null, item.where ?? null, whose].filter((part) => part !== null).join(" · ");
}

/** One thing with its controls, what is in it under it; Put in… opens its holders under the row. */
function ManageRow(props: { group: ManageKey; item: GearItem; ctx: RowCtx }) {
  const { item, ctx } = props;
  const holders = holdersFor(ctx.view, item);
  const controls = controlsFor(props.group, item, holders);
  const sub = subOf(item);
  const title = item.qty !== undefined && item.qty !== 1 ? `${item.name} ×${item.qty}` : item.name;
  const onOpen = ctx.onOpen && (ctx.opens?.(item.id) ?? true) ? ctx.onOpen : undefined;
  const name = (
    <span class="lre-me-item-text">
      <span class="lre-me-item-name">{title}</span>
      {sub !== "" ? <span class="lre-me-item-sub">{sub}</span> : null}
      <IdText id={item.id} />
    </span>
  );
  return (
    <div class="lre-me-item lre-manage-row" role="listitem" data-lre-manage={item.id}>
      <div class="lre-me-item-line">
        {onOpen ? (
          <button type="button" class="lre-me-item-open" onClick={() => onOpen(item.id)}>
            {name}
            <Icon name="chevron-right" size={16} class="lre-me-chev" />
          </button>
        ) : (
          <div class="lre-me-item-open">{name}</div>
        )}
      </div>
      {controls.length > 0 ? (
        <div class="lre-manage-controls" role="group" aria-label={`${item.name}: at once`}>
          {controls.map((action) => {
            const verdict = action === "put_in" ? null : judged(ctx.entries, action, item.id);
            const control = MANAGE_CONTROLS[action];
            return (
              <Button
                key={action}
                size="sm"
                icon={control.icon}
                disabled={ctx.busy || verdict?.disabled !== undefined}
                title={verdict?.disabled}
                onClick={() => (action === "put_in" ? ctx.onPutting(ctx.putting === item.id ? null : item.id) : ctx.onSend(manageRequest(ctx.chatId, action, item.id), doneWords(action, item.name)))}
              >
                {control.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {ctx.putting === item.id && controls.includes("put_in") ? (
        <div class="lre-manage-into" role="group" aria-label={`Put ${item.name} in`}>
          <span class="lre-small lre-muted">Put it in:</span>
          {holders.map((h) => {
            const verdict = judged(ctx.entries, "put_in", item.id, h.id);
            return (
              <Button key={h.id} size="sm" icon="box" disabled={ctx.busy || verdict?.disabled !== undefined} title={verdict?.disabled} onClick={() => ctx.onSend(manageRequest(ctx.chatId, "put_in", item.id, h.id), doneWords("put_in", item.name, h.name))}>
                {h.name}
              </Button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={() => ctx.onPutting(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {(item.children ?? []).length > 0 ? (
        <div class="lre-me-tree" role="list" aria-label={`Inside ${item.name}`}>
          {(item.children ?? []).map((child) => (
            <ManageRow key={child.id} group={props.group} item={child} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Things here's groups, each a part of the one section its caller draws, of rows with their controls; an empty group is left out. Hook-free. */
export function ManageList(props: RowCtx & { groups: readonly ManageGroup[] }) {
  return (
    <>
      {props.groups.map((g, i) =>
        g.items.length === 0 ? null : (
          <div key={`${g.key}:${i}`} class="lre-thing-bucket" data-lre-bucket={g.key}>
            <div class="lre-thing-bucket-head">{g.title}</div>
            <div class="lre-me-items" role="list" aria-label={g.title} data-lre-manage-group={g.key}>
              {g.items.map((item) => (
                <ManageRow key={item.id} group={g.key} item={item} ctx={props} />
              ))}
            </div>
          </div>
        ),
      )}
    </>
  );
}
