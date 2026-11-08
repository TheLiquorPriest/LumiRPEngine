// GM → Depth → Archive (DEPTH-PLAN §4.3, §7): the chat's own prose, searched by words, by person,
// by place or by story time, each hit with where it sits in the chat and in the story, the beats
// that cite it, and a jump to its message. The author and the GM search the same index; a character
// never does (its recall is its own mind). The body is hook-free; `ArchiveView` holds the search.

import { useState } from "preact/hooks";
import type { DepthArchiveQuery, DepthArchiveResult } from "../../shared/depth-views";
import type { MessageId } from "../../shared/ids";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, Field, HostSelect, SearchField, useBusy } from "../components";
import { GmCard } from "../gm/ui";
import type { GmSectionProps } from "../registry";

/** Whether a query asks for anything: words, a person, a place or a story time. */
export function archiveAsks(q: DepthArchiveQuery): boolean {
  return [q.text, q.who, q.place, q.from, q.to].some((v) => v !== undefined && v.trim() !== "");
}

/** GM → Depth → Archive's body, hook-free. */
export function ArchiveBody(props: {
  query: DepthArchiveQuery;
  people: readonly { id: string; name: string }[];
  places: readonly { id: string; name: string }[];
  result: DepthArchiveResult | null;
  busy: boolean;
  onQuery(query: DepthArchiveQuery): void;
  onSearch(): void;
  onMore(): void;
  onJump(messageId: MessageId): void;
}) {
  const { query, result } = props;
  const set = (patch: Partial<DepthArchiveQuery>) => props.onQuery({ ...query, ...patch, offset: 0 });
  return (
    <div class="lre-stack lre-depth-archive" data-lre-depth-archive>
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSearch();
        }}
      >
        <SearchField label="Words" placeholder="What was said or done" value={query.text ?? ""} disabled={props.busy} onInput={(text) => set({ text })} />
        <HostSelect label="Person" value={query.who ?? ""} options={[{ value: "", label: "Anyone" }, ...props.people.map((p) => ({ value: p.id, label: p.name }))]} disabled={props.busy} onChange={(who) => set({ who: who || undefined })} />
        <HostSelect label="Place" value={query.place ?? ""} options={[{ value: "", label: "Anywhere" }, ...props.places.map((p) => ({ value: p.id, label: p.name }))]} disabled={props.busy} onChange={(place) => set({ place: place || undefined })} />
        <div class="lre-depth-span">
          <Field label="Story time from">
            <input class="lre-input" type="text" placeholder="3 May" value={query.from ?? ""} disabled={props.busy} aria-label="Story time from" onInput={(event) => set({ from: event.currentTarget.value })} />
          </Field>
          <Field label="to">
            <input class="lre-input" type="text" placeholder="the 14th" value={query.to ?? ""} disabled={props.busy} aria-label="Story time to" onInput={(event) => set({ to: event.currentTarget.value })} />
          </Field>
        </div>
        <Button variant="primary" icon="search" type="submit" busy={props.busy} disabled={!archiveAsks(query)}>
          Search the chat
        </Button>
      </form>
      {result === null ? (
        <p class="lre-small lre-muted lre-depth-note">Search what was written in this chat: by words, by who was there or was told, by place, or by when it happened in the story.</p>
      ) : (
        <div class="lre-stack" data-lre-depth-hits={result.hits.length}>
          {result.unread.length > 0 ? <Banner tone="warn" title="Story time not read">{`The world's calendar couldn't read ${result.unread.map((w) => `"${w}"`).join(" or ")}, so it wasn't used.`}</Banner> : null}
          {result.hits.length === 0 ? (
            <Empty icon="search">Nothing in the chat matches.</Empty>
          ) : (
            result.hits.map((hit) => (
              <div key={`${hit.messageId}:${hit.swipeId}`} data-lre-depth-hit={hit.messageId}>
                <GmCard title={`Message ${hit.index}${hit.isUser ? " · yours" : ""}`} subtitle={[hit.at, hit.places.join(", "), hit.people.join(", ")].filter((s) => s !== null && s !== "").join(" · ")} badges={hit.beats > 0 ? <Badge>{`${hit.beats} ${hit.beats === 1 ? "beat" : "beats"}`}</Badge> : undefined}>
                  <p class="lre-depth-snippet">{hit.snippet}</p>
                  <div class="lre-inline">
                    <Button size="sm" icon="external" onClick={() => props.onJump(hit.messageId)}>
                      Go to the message
                    </Button>
                  </div>
                </GmCard>
              </div>
            ))
          )}
          {result.next !== null ? (
            <Button variant="secondary" busy={props.busy} onClick={props.onMore}>
              More
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** GM → Depth → Archive: the search, the roster and places from the GM view, More for the next page. */
export function ArchiveView(props: { section: GmSectionProps }) {
  const { section } = props;
  const app = useApp();
  const [query, setQuery] = useState<DepthArchiveQuery>({});
  const [result, setResult] = useState<DepthArchiveResult | null>(null);
  const [busy, run] = useBusy();
  const people = section.gm.entities.filter((e) => e.person && !e.gone).map((e) => ({ id: e.id, name: e.name })).sort((a, b) => a.name.localeCompare(b.name));
  const places = section.gm.places.map((p) => ({ id: p.id, name: p.name }));
  const search = (offset: number) =>
    run(async () => {
      const answer = await app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "archive", ...query, offset });
      const page = answer?.archive;
      if (!page) return;
      setResult((before) => (offset > 0 && before ? { ...page, hits: [...before.hits, ...page.hits] } : page));
    });
  return (
    <ArchiveBody
      query={query}
      people={people}
      places={places}
      result={result}
      busy={busy}
      onQuery={setQuery}
      onSearch={() => search(0)}
      onMore={() => search(result?.next ?? 0)}
      onJump={(messageId) => {
        if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
      }}
    />
  );
}
