// The place sheet's Things here (the gear pack's part of it, `r.placePart`): where the player
// character is, the furnishings, what lies loose and what is in the holders there they may use, read
// from the Gear view's `here`; their own things get the at-once controls (Take, Put in…, Put away),
// each with its Undo in the notice over the list. Nothing for another place, or with Gear off.

import { useState } from "preact/hooks";
import type { EntityId } from "../../../shared/ids";
import { Empty, Section } from "../../../frontend/components";
import type { PlacePartProps } from "../../../frontend/registry";
import { AtOnceNotice, useAtOnce } from "../../../frontend/things/at-once";
import { findItem } from "./item";
import { hereGroups, ManageList } from "./manage";
import { decodeGearView } from "./panel";

export function ThingsHere(props: PlacePartProps) {
  const atOnce = useAtOnce(props.chatId);
  const [putting, setPutting] = useState<EntityId | null>(null);
  const view = props.here ? decodeGearView(props.state.panels["gear.gear"]) : null;
  const here = view?.here ?? null;
  if (!view || !here) return null;
  const groups = hereGroups(here);
  return (
    <Section title="Things here" flush>
      <div class="lre-stack lre-me" data-lre-things-here={props.place}>
        <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
        {groups.length === 0 ? (
          <Empty icon="box">Nothing you can see lies here.</Empty>
        ) : (
          <ManageList
            chatId={props.chatId}
            view={view}
            entries={props.state.palette?.entries ?? []}
            groups={groups}
            busy={atOnce.busy}
            putting={putting}
            onPutting={setPutting}
            onSend={(request, text) => {
              setPutting(null);
              atOnce.send(request, text);
            }}
            // Only what is in the Gear view has an item sheet: theirs, or someone else's they have.
            opens={(id) => findItem(view, id) !== null}
            onOpen={(id) => props.open({ kind: "item", id })}
          />
        )}
      </div>
    </Section>
  );
}
