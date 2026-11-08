// GM → Places and Story, and This chat's Edits log: every place with how visible
// it is, nested as the world nests them, each opening who may enter it, whose it is, and its keys,
// which the GM sets for this chat (the orgs pack's `orgs.entry`; a person's own house has no
// organization's Property to set it in); every track with its stage picker and the truths its
// stages hold; and the corrections in force on this chat's path. Places and tracks are the world's
// definitions, edited in Build; here a track's stage is set for this chat. Everyone's money is the
// economy pack's GM tab.

import { useId, useState } from "preact/hooks";
import type { GmPlaceEntry } from "../../shared/org-view";
import type { GmView } from "../../shared/state-view";
import { listWords } from "../../shared/words";
import { Badge, Banner, Button, Card, Empty, Field, List, ListRow, Section } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import { entryDraft, EntryForm, entryOps, PremiseRows, type EntryDraft } from "../place-entry";
import type { Editor } from "./editor";
import { nameOf } from "./editor";
import { ActionRow, ActionRows, BuildLink, GmCard, GmPage, usePages } from "./ui";

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

/** Every place, nested; one the GM may set entry for (with the orgs pack) opens its page, its entry in words when one is set. */
export function PlacesList(props: { gm: GmView; onOpen(place: string): void }) {
  const { gm } = props;
  if (gm.places.length === 0) return <Empty icon="pin" title="No places" action={<BuildLink />} />;
  return (
    <div class="lre-stack">
      <Section title={`${gm.places.length} ${gm.places.length === 1 ? "place" : "places"}`} flush>
        <div data-lre-gm-list="places">
          <List>
            {placesInOrder(gm.places).map(({ place, depth }) => {
              const entry = place.entry;
              const sub = [place.parent ? `In ${nameOf(gm, place.parent)}` : null, entry && (entry.entry !== null || entry.inPlay) ? entry.words : null].filter((part) => part !== null).join(" · ");
              return (
                <ListRow
                  key={place.id}
                  id={place.id}
                  leading={
                    <span class="lre-gm-indent" style={{ paddingLeft: `${depth * 16}px` }}>
                      <Icon name="pin" size={16} />
                    </span>
                  }
                  title={place.name}
                  subtitle={sub || undefined}
                  badge={<Badge tone={place.visibility === "public" ? "neutral" : "gm"}>{humanize(place.visibility)}</Badge>}
                  chevron={entry !== undefined}
                  onClick={entry ? () => props.onOpen(place.id) : undefined}
                />
              );
            })}
          </List>
        </div>
      </Section>
      <BuildLink />
    </div>
  );
}

/** One place's page: whose it is, who may enter it now and why, its keys and who carries them, entries without leave, and Change entry with its keys, for this chat. */
export function PlaceEntryPage(props: { name: string; entry: GmPlaceEntry; draft: EntryDraft; busy: boolean; onDraft(draft: EntryDraft): void; onSave(): void; onBack(): void }) {
  const { entry } = props;
  return (
    <GmPage name="place-entry" title={props.name} subtitle={entry.owners.length > 0 ? `${listWords(entry.owners)}'s` : "No one's"} backLabel="Places" onBack={props.onBack}>
      <div class="lre-stack">
        <Card title="Who may enter" aside={entry.inPlay ? <Badge tone="gm">Set in this chat</Badge> : undefined}>
          <PremiseRows place={entry} />
        </Card>
        <Section title="Change entry">
          <EntryForm place={entry} draft={props.draft} keys busy={props.busy} onDraft={props.onDraft} onSave={props.onSave} onCancel={props.onBack} />
        </Section>
      </div>
    </GmPage>
  );
}

export function PlacesSection(props: { editor: Editor }) {
  const { editor } = props;
  const pages = usePages<string>();
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const open = pages.page === null ? undefined : editor.gm.places.find((p) => p.id === pages.page);
  const entry = open?.entry;
  // The form starts from the place as it stands, and again once a change applies.
  const current = entry && draft?.place === entry.id ? draft : entry ? entryDraft(entry) : null;
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list" hidden={pages.page !== null}>
        <PlacesList
          gm={editor.gm}
          onOpen={(id) => {
            setDraft(null);
            pages.open(id);
          }}
        />
      </div>
      {open && entry && current ? (
        <PlaceEntryPage
          name={open.name}
          entry={entry}
          draft={current}
          busy={editor.busy}
          onDraft={setDraft}
          onSave={() => {
            const ops = entryOps(entry, current);
            if (ops.length > 0) void editor.edit(ops).then((ok) => ok && setDraft(null));
          }}
          onBack={pages.back}
        />
      ) : null}
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
      <Field label="Stage" for={stage} help="On to a stage that follows: it plays as in the story (its effects, rewards and reveal). Back: only the stage is set.">
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

/** The ✎ fixes and GM edits in force on this chat's path, newest first, each on the latest reply with its Undo, and writes a reply refused. */
export function EditsLog(props: { gm: GmView; busy: boolean; onUndo(chip: string): void }) {
  const { gm } = props;
  const older = gm.edits.some((e) => e.undo === null);
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
        <Section title={`${gm.edits.length} in force, newest first`}>
          <ActionRows label="Edits in force">
            {gm.edits.map((e) => {
              const undo = e.undo;
              return (
                // The player's own bookkeeping (a trade, a transfer) or a hint they opened is their action, not a correction.
                <ActionRow
                  key={`${e.messageId}:${e.seq ?? e.entry}`}
                  title={e.by ?? (e.lines.join(" · ") || "Bookkeeping")}
                  subtitle={e.by ? (e.lines.length > 0 ? `The player's action: ${e.lines.join(" · ")}` : "The player's action") : undefined}
                  id={`${e.messageId} · ${e.seq ?? e.entry}`}
                  actions={
                    undo === null ? undefined : (
                      <Button size="sm" variant="ghost" icon="undo" disabled={props.busy} onClick={() => props.onUndo(undo)}>
                        Undo
                      </Button>
                    )
                  }
                />
              );
            })}
          </ActionRows>
        </Section>
      )}
      {older ? <p class="lre-gm-note">Only the latest reply's edits can be undone, as in the chat.</p> : null}
    </div>
  );
}
