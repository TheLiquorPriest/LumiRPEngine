// GM → Places and Story, and This chat's Edits log: every place with how visible
// it is, nested as the world nests them; every track with its stage picker and the truths its
// stages hold; and the corrections in force on this chat's path. Places and tracks are the world's
// definitions, edited in Build; here a track's stage is set for this chat. Everyone's money is the
// economy pack's GM tab.

import { useId } from "preact/hooks";
import type { GmView } from "../../shared/state-view";
import { Badge, Banner, Empty, Field, List, ListRow, Section } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import type { Editor } from "./editor";
import { nameOf } from "./editor";
import { BuildLink, GmCard } from "./ui";

type Place = GmView["places"][number];
type Track = GmView["tracks"][number];

/** Places in reading order: each under its parent, depth first, the world's order kept among siblings; places in a loop of parents last, at the top level. */
export function placesInOrder(places: readonly Place[]): { place: Place; depth: number }[] {
  const ids = new Set(places.map((p) => p.id));
  const seen = new Set<string>();
  const out: { place: Place; depth: number }[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const place of places) {
      const top = place.parent === null || !ids.has(place.parent);
      if ((parent === null ? !top : place.parent !== parent) || seen.has(place.id)) continue;
      seen.add(place.id);
      out.push({ place, depth });
      visit(place.id, depth + 1);
    }
  };
  visit(null, 0);
  // Places in a loop of parents never come up from the top: list them rather than lose them.
  for (const place of places) if (!seen.has(place.id)) out.push({ place, depth: 0 });
  return out;
}

export function PlacesSection(props: { gm: GmView }) {
  const { gm } = props;
  if (gm.places.length === 0) return <Empty icon="pin" title="No places" action={<BuildLink />} />;
  return (
    <div class="lre-stack">
      <Section title={`${gm.places.length} ${gm.places.length === 1 ? "place" : "places"}`} flush>
        <div data-lre-gm-list="places">
          <List>
            {placesInOrder(gm.places).map(({ place, depth }) => (
              <ListRow
                key={place.id}
                id={place.id}
                leading={
                  <span class="lre-gm-indent" style={{ paddingLeft: `${depth * 16}px` }}>
                    <Icon name="pin" size={16} />
                  </span>
                }
                title={place.name}
                subtitle={place.parent ? `In ${nameOf(gm, place.parent)}` : undefined}
                badge={<Badge tone={place.visibility === "public" ? "neutral" : "gm"}>{humanize(place.visibility)}</Badge>}
              />
            ))}
          </List>
        </div>
      </Section>
      <BuildLink />
    </div>
  );
}

function TrackCard(props: { track: Track; editor: Editor }) {
  const { track: t, editor } = props;
  const stage = useId();
  const truths = t.stages.filter((s) => s.truth);
  const kind = t.kind.replace(/_/g, " ");
  return (
    <GmCard name={t.id} title={t.label} id={t.id} subtitle={t.owner ? `${t.owner}'s ${kind}` : humanize(t.kind)} badges={<Badge tone={t.visibility === "public" ? "neutral" : "gm"}>{humanize(t.visibility)}</Badge>}>
      <Field label="Stage" for={stage}>
        <select id={stage} class="lre-input" value={t.stage} disabled={editor.busy} onChange={(event) => void editor.edit([{ op: "stage", track: t.id, to: event.currentTarget.value }])}>
          {t.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {truths.length > 0 ? (
        <div class="lre-gm-truths">
          <div class="lre-gm-subtitle">Truths</div>
          {truths.map((s) => (
            <div key={s.id} class="lre-gm-truth" aria-current={s.id === t.stage ? "step" : undefined}>
              <span class="lre-gm-truth-stage">
                {s.label}
                {s.id === t.stage ? <Badge tone="accent">Now</Badge> : null}
              </span>
              <p>{s.truth}</p>
            </div>
          ))}
        </div>
      ) : null}
    </GmCard>
  );
}

export function StorySection(props: { editor: Editor }) {
  const { tracks } = props.editor.gm;
  if (tracks.length === 0) return <Empty icon="flag" title="No tracks">This world has no quests, secrets or agendas.</Empty>;
  return (
    <div class="lre-stack" data-lre-gm-list="tracks">
      {tracks.map((t) => (
        <TrackCard key={t.id} track={t} editor={props.editor} />
      ))}
    </div>
  );
}

/** The ✎ fixes and GM edits in force on this chat's path, newest first, and writes a reply refused. */
export function EditsLog(props: { gm: GmView }) {
  const { gm } = props;
  return (
    <div class="lre-stack" data-lre-gm-list="edits">
      {gm.refused.length > 0 ? (
        <Banner tone="warn" title="Didn't apply after a reply">
          {gm.refused.map((r) => (
            <div key={r.id}>{r.reason}</div>
          ))}
        </Banner>
      ) : null}
      {gm.edits.length === 0 ? (
        <Empty icon="edit" title="No corrections">No fixes or GM edits on this chat's path.</Empty>
      ) : (
        <Section title={`${gm.edits.length} in force, newest first`} flush>
          <List>
            {gm.edits.map((e) => (
              // The player's own bookkeeping (a trade, a transfer) is their action, not a correction.
              <ListRow key={`${e.messageId}:${e.seq}`} icon={e.by ? "user" : "edit"} title={e.by ?? (e.lines.join(" · ") || "Bookkeeping")} subtitle={e.by ? `The player's action: ${e.lines.join(" · ")}` : undefined} id={`${e.messageId} · ${e.seq}`} />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}
