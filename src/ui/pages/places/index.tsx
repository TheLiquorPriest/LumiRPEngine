// Places (plan §8.2, §14): every place of the chat, the world's own and those made in play, searchable and read a page at a time; one opened by address
// (`places/<place>`, and `places/<place>/<turn>` for the place as it stood at a turn) shows its record in nine parts and its grid with everyone and
// everything on it (`record.tsx`, `grid.tsx`). The list sits beside the place open at desktop width and gives way to it, with Back, on a phone. The
// records are the Author's, so they are read only while the chat's spoiler gate is open.

import { useEffect, useState } from "preact/hooks";
import type { PlaceRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Button, Empty, Gated, PageHeader, Section } from "../../../frontend/components";
import { replyOf } from "../../client";
import { onChatChange } from "../../live-watch";
import type { PageEntry } from "../../page-entry";
import { usePaged } from "../../reading";
import { useSelect } from "../../store";
import { useUiSetting } from "../../ui-settings";
import { counted } from "../../words";
import { PlaceOpen } from "./record";

const GATE_WHY = "The Author's records of a place, what the story changed there, who is there and who knows of it, can give away what comes next.";

/** Whether a place matches what he typed: its name, id, the place it is in and its kind. */
export function placeMatches(row: PlaceRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || [row.name, row.place, row.parent?.name ?? "", row.kind].some((t) => t.toLowerCase().includes(q));
}

function PlaceLine(props: { place: PlaceRow; open: boolean; onOpen(): void }) {
  const { place } = props;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-place-line={place.place} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{place.name}</span>
            <span class="lre-listrow-sub">{place.parent === null ? "a place of the world's top" : `in ${place.parent.name}`}</span>
          </span>
          <span class="lre-inline">
            <Badge>{place.kind}</Badge>
            {place.grid ? <Badge>grid</Badge> : null}
            {place.made ? <Badge tone="accent" title="Play made it; the world's document does not have it">made in play</Badge> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function PlacesPage(props: { chat: string; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const [stamp, setStamp] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => onChatChange(app.client, chat, () => setStamp((n) => n + 1)), [chat]);
  const list = usePaged(
    gate ? (cursor) => app.client.call("GET /api/v1/chats/:chat/places", { chat }, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }).then(replyOf) : null,
    [chat, stamp, gate],
  );
  // A search looks across every place, so while one is typed the pages not yet read are read on.
  useEffect(() => {
    if (query.trim() !== "" && list.more && !list.loading && list.problem === null) list.older();
  }, [query, list.more, list.loading, list.items.length]);
  const id = props.at?.[0] ?? null;
  const turn = props.at?.[1] ?? null;
  const go = (to: string | null, at: string | null = null): void => app.go({ page: "places", chat, at: to === null ? [] : at === null ? [to] : [to, at] });
  const rows = list.items.filter((row) => placeMatches(row, query));
  return (
    <div class="lre-stack rpe-page" data-page="places">
      <PageHeader title="Places" subtitle="Every place of this chat, its record and its map." {...(id === null ? {} : { onBack: () => go(null), backLabel: "all places" })} />
      <Gated open={gate} onOpen={() => app.gate.open(chat)} onClose={() => app.gate.close(chat)} why={GATE_WHY}>
        <div class="rpe-files-split" data-open={id === null ? "no" : "yes"}>
          <div class="rpe-files-browser lre-stack">
            <label class="lre-field">
              <span>Search the places</span>
              <input class="lre-input" type="search" value={query} placeholder="a name, a kind, the place it is in" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
            </label>
            {list.problem === null ? null : <p class="rpe-line" data-problem>{list.problem}</p>}
            {list.items.length === 0 && !list.loading && list.problem === null ? (
              <Empty icon="map" title="No place">
                <span>The chat's world holds no place yet, and none has been made in play.</span>
              </Empty>
            ) : (
              <Section id="places" title={counted(list.items.length, "place")}>
                {rows.length === 0 && list.items.length > 0 ? <p class="lre-muted rpe-line">{list.more ? "Nothing among the places read so far; reading on." : "No place matches."}</p> : null}
                <ul class="lre-list" data-places>
                  {rows.map((p) => (
                    <PlaceLine key={p.place} place={p} open={id === p.place} onOpen={() => go(p.place)} />
                  ))}
                </ul>
                {list.more ? (
                  <Button busy={list.loading} onClick={list.older}>
                    More places
                  </Button>
                ) : null}
              </Section>
            )}
          </div>
          {id === null ? null : (
            <div class="lre-stack rpe-open-session">
              <PlaceOpen
                key={id}
                chat={chat}
                place={id}
                turn={turn}
                stamp={stamp}
                onTurn={(to) => go(id, to)}
                onOpenTurn={(t) => app.go({ page: "turns", chat, at: [t] })}
                onOpenPlace={(p) => go(p)}
                onLore={() => app.go({ page: "lore", chat })}
              />
            </div>
          )}
        </div>
      </Gated>
    </div>
  );
}

export const entry: PageEntry = { id: "places", title: "Places", icon: "map", shells: ["web", "drawer"], needsChat: true, often: false, order: 61, render: (route) => <PlacesPage chat={route.chat} at={route.at} /> };
