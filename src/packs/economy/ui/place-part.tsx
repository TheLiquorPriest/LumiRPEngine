// The place sheet's Property here (DESIGN §27.9; the economy pack's part of it, `r.placePart`): the
// property the place is as the player's money shows it (one of theirs, or one for sale), with the
// map's mark as its badge (`MapPlaceView.mark`, `.property`). It opens the property's page in Money,
// and one for sale offers Buy…, whose page asks whether they'll live there. A place that is no
// property the player knows of offers Make this a property under the chat's claims policy, as Add a
// vehicle does: a GM edit (`economy.property_make`) made at once with its Undo, theirs already or for
// sale at the price they give; Ask first asks before it's made, and Hold me to the world offers
// nothing. Nothing where the player doesn't follow property (Money 3), or at a place they can't see.

import { useMemo, useState } from "preact/hooks";
import type { ClaimsPolicy } from "../../../shared/claims";
import type { PropertyView } from "../../../shared/finance";
import type { EntityId, PlaceId } from "../../../shared/ids";
import { mapPlaceOf, PLACE_MARK_LABEL, type PlaceMark } from "../../../shared/maps";
import type { EditOp } from "../../../shared/protocol";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { useApp, type SheetRoute } from "../../../frontend/app";
import { Badge, Button, List, ListRow, Section, useBusy } from "../../../frontend/components";
import type { PlacePartProps } from "../../../frontend/registry";
import { editRequest } from "../../../frontend/requests";
import { AtOnceNotice, type AtOnceDone } from "../../../frontend/things/at-once";
import { decodeFinanceView } from "./decode";
import { AmountField, amountProblem, ChoiceField, TextField } from "./forms";
import { propertyControls } from "./layout";
import { actionPage, detailPage } from "./nav";
import { amountOf, propertyMakeOps } from "./requests";
import { routeOf } from "./routes";

/** What Property here shows at a place. */
export interface PropertyHere {
  place: PlaceId;
  /** The place's name, as the map gives it. */
  name: string;
  mark: PlaceMark | null;
  /** The property the place is, as the player's money shows it; null when it is none they know of. */
  property: PropertyView | null;
  /** Whose money the property's pages are: the player's. */
  party: EntityId;
  /** It is for sale to them: Buy… opens its purchase. */
  buy: boolean;
  /** How Make this a property is offered: at once, asked first, or (null) not at all. */
  make: "real" | "ask" | null;
}

/**
 * Property here at `place`, from the map's panel (`space.map`: the place's mark and property) and
 * the player's money (`economy.money`): null where it has nothing to say (a place they can't see,
 * property not followed, or no property and no Make under Hold me to the world).
 */
export function propertyHereOf(map: unknown, money: unknown, place: PlaceId, claims: ClaimsPolicy | null): PropertyHere | null {
  const at = mapPlaceOf(map, place);
  const view = money === undefined || money === null ? null : decodeFinanceView(money);
  if (!at?.known || !view || !view.features.includes("property")) return null;
  const property = at.property === undefined ? null : (view.properties.find((p) => p.id === at.property) ?? null);
  const make = property !== null ? null : claims === null || claims.mode === "real" ? "real" : claims.mode === "ask" ? "ask" : null;
  if (property === null && make === null) return null;
  return { place, name: at.name, mark: at.mark ?? null, property, party: view.party, buy: property !== null && propertyControls(view, property).includes("buy"), make };
}

/** What the Make this a property form holds, as typed. */
export interface PropertyDraft {
  /** Its name; empty, the place's. */
  name: string;
  value: string;
  whose: "mine" | "for_sale";
  /** The asking price of one for sale; empty, its value. */
  asking: string;
}

export const NEW_PROPERTY: PropertyDraft = { name: "", value: "", whose: "for_sale", asking: "" };

const WHOSE_CHOICES = [
  { value: "for_sale", label: "For sale", detail: "Nobody's yet: buy it at its price" },
  { value: "mine", label: "Yours already", detail: "It has been yours since before the story" },
] as const;

/** Why a draft can't be made yet, in words; null when it can. */
export function draftProblem(draft: PropertyDraft, currency: WorldCurrency): string | null {
  return amountProblem(draft.value, currency, "what it's worth") ?? (draft.whose === "for_sale" ? amountProblem(draft.asking, currency, "its asking price", false) : null);
}

/** The GM edit a draft makes: the place a property worth its value, the player's whole, or for sale at its asking price (its value when none is typed); null while it has a problem. */
export function draftOps(place: PlaceId, party: EntityId, draft: PropertyDraft, currency: WorldCurrency): EditOp[] | null {
  const value = amountOf(draft.value, currency);
  if (value === null || draftProblem(draft, currency) !== null) return null;
  return propertyMakeOps(place, { name: draft.name, value, ...(draft.whose === "mine" ? { owner: party } : { askingPrice: amountOf(draft.asking, currency) ?? value }) });
}

/** The property row and its Buy…, or Make this a property; hook-free. */
export function PropertyRows(props: { here: PropertyHere; currency: WorldCurrency; busy: boolean; open(route: SheetRoute): void; onMake(): void }) {
  const { here } = props;
  const p = here.property;
  if (p === null) {
    return here.make !== null ? (
      <Button variant="secondary" icon="plus" block disabled={props.busy} onClick={props.onMake}>
        Make this a property
      </Button>
    ) : null;
  }
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const forSale = p.share <= 0 && p.forSale !== null && p.forSale !== undefined;
  return (
    <>
      <List>
        <ListRow
          icon="home"
          title={p.name}
          subtitle={p.share > 0 ? `${Math.round(p.share * 10) / 10}% yours · worth ${fmt(p.value)}` : forSale ? `Asking ${fmt(p.forSale ?? 0)}` : undefined}
          id={p.id}
          value={fmt(forSale ? (p.forSale ?? 0) : p.value)}
          badge={here.mark !== null ? <Badge tone="accent">{PLACE_MARK_LABEL[here.mark]}</Badge> : undefined}
          chevron
          onClick={() => props.open(routeOf(detailPage("property", p.id), here.party, true))}
        />
      </List>
      {here.buy ? (
        <Button variant="primary" icon="plus" block disabled={props.busy} onClick={() => props.open(routeOf(actionPage("property", p.id, "buy"), here.party, true))}>
          Buy…
        </Button>
      ) : null}
    </>
  );
}

/** Make this a property's fields, then its button (a question first, under Ask first); hook-free. */
export function MakePropertyForm(props: { here: PropertyHere; currency: WorldCurrency; draft: PropertyDraft; asking: boolean; busy: boolean; onDraft(draft: PropertyDraft): void; onGo(): void; onCancel(): void }) {
  const { here, draft, currency } = props;
  const problem = draftProblem(draft, currency);
  const set = (part: Partial<PropertyDraft>): void => props.onDraft({ ...draft, ...part });
  const name = draft.name.trim() || here.name;
  return (
    <div class="lre-stack" data-lre-property-make={here.place}>
      <TextField label="Name (empty: the place's)" value={draft.name} placeholder={here.name} onInput={(v) => set({ name: v })} />
      <AmountField label="What it's worth" value={draft.value} currency={currency} invalid={draft.value.trim() !== "" && amountOf(draft.value, currency) === null} onInput={(v) => set({ value: v })} />
      <ChoiceField label="Whose" value={draft.whose} options={WHOSE_CHOICES} onChange={(v) => set({ whose: v === "mine" ? "mine" : "for_sale" })} />
      {draft.whose === "for_sale" ? <AmountField label="Asking price (empty: what it's worth)" value={draft.asking} currency={currency} invalid={draft.asking.trim() !== "" && amountOf(draft.asking, currency) === null} onInput={(v) => set({ asking: v })} /> : null}
      {problem !== null ? <p class="lre-money-problem">{problem}</p> : props.asking ? <p class="lre-money-problem">{`Add ${name} to the world as a property${draft.whose === "mine" ? " of yours" : ", for sale"}?`}</p> : null}
      <div class="lre-row-actions">
        <Button variant="primary" busy={props.busy} disabled={problem !== null} onClick={props.onGo}>
          {props.asking ? "Yes, make it" : "Make it a property"}
        </Button>
        <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PropertyHereSection(props: PlacePartProps) {
  const app = useApp();
  const mapRaw = props.state.panels["space.map"];
  const moneyRaw = props.state.panels["economy.money"];
  const claims = props.state.controls?.realism.claims ?? null;
  const here = useMemo(() => propertyHereOf(mapRaw, moneyRaw, props.place, claims), [mapRaw, moneyRaw, props.place, claims]);
  const [draft, setDraft] = useState<PropertyDraft | null>(null);
  // Under Ask first, the question the first press puts before the second makes it.
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<AtOnceDone | null>(null);
  const [busy, run] = useBusy();
  if (!here && !done) return null;
  const currency = props.state.currency ?? DEFAULT_CURRENCY;
  const close = (): void => {
    setDraft(null);
    setAsking(false);
  };
  const make = (d: PropertyDraft): void => {
    const ops = here === null ? null : draftOps(here.place, here.party, d, currency);
    if (here === null || ops === null) return;
    if (here.make === "ask" && !asking) {
      setAsking(true);
      return;
    }
    const name = d.name.trim() || here.name;
    run(async () => {
      const result = await app.request(editRequest(props.chatId, ops));
      if (!result) return;
      setDone({ text: d.whose === "mine" ? `${name} is your property.` : `${name} is a property, for sale.`, undo: result.undo, pending: result.pending });
      close();
    });
  };
  return (
    <Section title="Property here" flush>
      <AtOnceNotice
        done={done}
        busy={busy}
        title="Made at once"
        onUndo={() =>
          run(async () => {
            const chip = done?.undo;
            if (chip && (await app.request({ type: "lre.chip", chatId: props.chatId, chip, choice: "undo" })) !== null) setDone(null);
          })
        }
        onDismiss={() => setDone(null)}
      />
      {here === null ? null : draft !== null && here.property === null ? (
        <MakePropertyForm
          here={here}
          currency={currency}
          draft={draft}
          asking={asking}
          busy={busy}
          onDraft={(d) => {
            setDraft(d);
            setAsking(false);
          }}
          onGo={() => make(draft)}
          onCancel={close}
        />
      ) : (
        <PropertyRows here={here} currency={currency} busy={busy} open={props.open} onMake={() => setDraft(NEW_PROPERTY)} />
      )}
    </Section>
  );
}
