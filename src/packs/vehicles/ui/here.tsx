// The place sheet's "Parked here" part (DESIGN §9.3): the vehicles the player may drive that stand
// at this place, each with Drive… (a story action); and, where the player is, Park here for theirs
// that stand elsewhere (the story left it here), at once with Undo. Read from the Garage's view.

import { useMemo, useState } from "preact/hooks";
import { Button, List, ListRow, Section } from "../../../frontend/components";
import type { PlacePartProps } from "../../../frontend/registry";
import { AtOnceNotice, thingsFix, useAtOnce } from "../../../frontend/things/at-once";
import { decodeGarageView, vehicleIcon } from "./panel";
import { GarageSheets, parkFix, type GarageSheet } from "./manage";

export function ParkedHere(props: PlacePartProps) {
  const raw = props.state.panels["vehicles.garage"];
  const view = useMemo(() => decodeGarageView(raw), [raw]);
  const atOnce = useAtOnce(props.chatId);
  const [sheet, setSheet] = useState<GarageSheet | null>(null);
  if (!view) return null;
  const parked = view.vehicles.filter((v) => v.placeId === props.place);
  // Only the player's own may be parked here by a fix: anyone else's stands where its owner left it.
  const elsewhere = props.here ? view.vehicles.filter((v) => v.mine && v.placeId !== props.place) : [];
  if (parked.length === 0 && elsewhere.length === 0) return null;
  return (
    <Section title="Parked here" flush>
      <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
      <List>
        {parked.map((v) => (
          <ListRow
            key={v.id}
            icon={vehicleIcon(v)}
            title={v.name}
            subtitle={[v.access, v.status].filter((p) => p).join(" · ")}
            value={
              v.status !== "broken" ? (
                <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: "drive", vehicle: v.id })}>
                  Drive…
                </Button>
              ) : undefined
            }
          />
        ))}
        {elsewhere.map((v) => (
          <ListRow
            key={v.id}
            icon={vehicleIcon(v)}
            title={v.name}
            subtitle={v.place ? `Now: ${v.place}` : "Nowhere yet"}
            value={
              <Button size="sm" variant="secondary" disabled={atOnce.busy} onClick={() => atOnce.send(thingsFix(props.chatId, [parkFix(v.id, props.place)], `Parked ${v.name}`), `${v.name} is parked here.`)}>
                Park here
              </Button>
            }
          />
        ))}
      </List>
      <GarageSheets chatId={props.chatId} view={view} sheet={sheet} claims={null} atOnce={atOnce} onClose={() => setSheet(null)} />
    </Section>
  );
}
