// The place sheet (contract §4.3): a place from the map, with its exact travel options (mode,
// time, cost, or why not), whether the POV is there, has been there or has only heard of it, and
// ways back to the map: open its own map, or show it where it lies. A place the POV can't see goes
// by "Somewhere" and offers nothing. Places aren't entities, so opening one observes nothing new
// (the map was observed when its destination opened). The same details show in the map overlay's
// dock, where no sheet stack is.

import { useMemo } from "preact/hooks";
import type { TravelMode } from "../../../shared/ids";
import { playAt, useApp } from "../../../frontend/app";
import { Empty, IdText, List, ListRow, PageHeader, Section, useBusy } from "../../../frontend/components";
import { formatCents, formatMinutes } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { Icon } from "../../../frontend/icons";
import type { SheetProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import { createStore } from "../../../frontend/store";
import type { MapPlaceView, MapScopeView, MapView } from "../core/view";
import { decodeMapView } from "./view";

export const MODE_ICON: Record<TravelMode, IconName> = { walk: "route", road: "car", offroad: "car", water: "boat" };

/**
 * A place sheet's request that the map show a scope, with a place picked; Play's map takes each new
 * one (`n` grows) once. The sheet lives in the drawer, the map's scope in the map's own state.
 */
export interface MapFocus {
  chatId: string;
  scope: string | null;
  place: string | null;
  n: number;
}

export const mapFocus = createStore<MapFocus | null>(null);

/** A place on the map and the scope that draws it. */
export function findPlace(view: MapView, id: string): { place: MapPlaceView; scope: MapScopeView } | null {
  for (const scope of view.scopes) {
    const place = scope.places.find((p) => p.id === id);
    if (place) return { place, scope };
  }
  return null;
}

/** Where the POV stands with a place, in words (a sentence, and a short form for lists) and an icon, as the map draws it. */
export function placeStatus(view: MapView, place: MapPlaceView): { icon: IconName; text: string; short: string } {
  if (!place.known) return { icon: "help", text: "You can't tell where this is.", short: "Somewhere" };
  if (place.id === view.here) return { icon: "pin", text: "You are here.", short: "You're here" };
  if (view.path.includes(place.id)) return { icon: "home", text: "You're inside.", short: "You're inside" };
  if (!place.visited) return { icon: "help", text: "You've heard of it, but you haven't been there.", short: "Heard of" };
  return { icon: "check", text: "You've been there.", short: "Been there" };
}

/** A place's details: where you stand with it, its travel options and its map actions. */
export function PlaceDetail(props: { view: MapView; place: MapPlaceView; chatId: string; onOpen(): void; onShow?: () => void; onTravelled(): void }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const { view, place } = props;
  const status = placeStatus(view, place);
  if (!place.known) {
    return (
      <Empty icon="help" title="Somewhere">
        You can't tell where this is.
      </Empty>
    );
  }
  const options = view.travel.filter((t) => t.to === place.id);
  const opens = view.scopes.some((s) => s.id === place.id);
  const there = place.id === view.here || view.path.includes(place.id);
  const onShow = props.onShow;
  return (
    <div class="lre-stack" data-lre-place-detail={place.id}>
      <p class="lre-world-status">
        <Icon name={status.icon} size={16} />
        <span>{status.text}</span>
      </p>
      {!there ? (
        <Section title="Getting there" flush>
          {options.length === 0 ? (
            <Empty icon="route">No route from here.</Empty>
          ) : (
            <List>
              {options.map((option) => (
                <ListRow
                  key={`${option.action}:${option.mode}:${option.vehicle ?? ""}`}
                  icon={MODE_ICON[option.mode]}
                  title={option.label}
                  subtitle={[option.disabled === undefined ? formatMinutes(option.minutes) : null, option.vehicle, option.disabled].filter((part) => part).join(" · ")}
                  value={option.cents !== undefined ? formatCents(option.cents) : undefined}
                  disabled={busy || option.disabled !== undefined}
                  onClick={() =>
                    run(async () => {
                      const result = await app.request(travelRequest(option.action, option.params, props.chatId));
                      if (result) props.onTravelled();
                    })
                  }
                />
              ))}
            </List>
          )}
        </Section>
      ) : null}
      {opens || onShow ? (
        <Section flush>
          <List>
            {opens ? <ListRow icon="layers" title={`Open ${place.name}`} subtitle="See the places inside" chevron onClick={props.onOpen} /> : null}
            {onShow ? <ListRow icon="pin" title="Show on the map" chevron onClick={onShow} /> : null}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

let focusSeq = 0;

export function PlaceSheet(props: SheetProps) {
  const app = useApp();
  const raw = props.state.panels["space.map"];
  const view = useMemo(() => decodeMapView(raw), [raw]);
  const found = view ? findPlace(view, props.id) : null;
  if (!view || !found) {
    return (
      <div class="lre-stack lre-world">
        <PageHeader title="Place" onBack={props.close} />
        <Empty icon="map">This place isn't on your map any more.</Empty>
      </div>
    );
  }
  const { place, scope } = found;
  // The map takes the request, then Play goes to it: the stack closes on the way.
  const showOnMap = (focus: Omit<MapFocus, "n" | "chatId">) => {
    focusSeq += 1;
    mapFocus.set({ ...focus, chatId: props.chatId, n: focusSeq });
    app.ui.update((ui) => playAt(ui, "places", "space.map"));
  };
  // The place it lies in, unless that one goes by "Somewhere" too.
  const parent = scope.id !== null && findPlace(view, scope.id)?.place.known !== false ? scope.name : null;
  return (
    <div class="lre-stack lre-world" data-lre-sheet-place={place.id}>
      <PageHeader title={place.name} subtitle={parent !== null ? `In ${parent}` : undefined} onBack={props.close} />
      {place.known ? <IdText id={place.id} /> : null}
      <PlaceDetail
        view={view}
        place={place}
        chatId={props.chatId}
        onOpen={() => showOnMap({ scope: place.id, place: null })}
        onShow={() => showOnMap({ scope: scope.id, place: place.id })}
        onTravelled={() => {
          props.close();
          app.overlays.closeMap();
        }}
      />
    </div>
  );
}
