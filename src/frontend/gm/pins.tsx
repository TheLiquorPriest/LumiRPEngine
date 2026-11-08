// GM → This chat → Pins and upgrade (DESIGN §4.3 `migrate`, §9.2, §12): the world and the revision
// this chat plays, whether a newer one exists, the Upgrade with its review, and the generator
// versions and table revisions the revision pins, each table this build ships newer marked, with
// the way to Build → World → Data updates while the world hasn't taken them. Moved here from
// Settings. The Upgrade review shows every change, one that would give a secret away marked Secret.

import { useEffect, useState } from "preact/hooks";
import type { TableUpdate, UpgradePreview } from "../../shared/protocol";
import type { StateView } from "../../shared/state-view";
import type { WorldDoc, WorldIndex } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, List, ListRow, Section, useBusy } from "../components";
import { humanize } from "../format";
import { UpgradePanel } from "../settings/upgrade";

/** How many newer tables the notice names before it counts the rest. */
const NAMED = 4;

export function PinsAndUpgrade(props: { view: StateView }) {
  const { view } = props;
  const app = useApp();
  const [world, setWorld] = useState<WorldDoc | null>(null);
  const [index, setIndex] = useState<WorldIndex | null>(null);
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  // What this build ships newer than this chat's revision has, and what the world's draft still lacks of it.
  const [newer, setNewer] = useState<{ chat: TableUpdate[]; world: TableUpdate[] } | null>(null);
  const [busy, run] = useBusy();
  const worldId = view.worldId;
  useEffect(() => {
    if (!worldId) return;
    void app.request({ type: "lre.world", op: "get", worldId, revision: view.revision ?? undefined }).then((result) => setWorld(result?.world ?? null));
    void app.request({ type: "lre.world", op: "list" }).then((result) => setIndex(result?.worlds?.find((w) => w.id === worldId) ?? null));
    if (view.revision) {
      const revision = view.revision;
      void Promise.all([app.request({ type: "lre.world", op: "updates", worldId, revision }), app.request({ type: "lre.world", op: "updates", worldId })]).then(([chat, draft]) => setNewer(chat?.updates && draft?.updates ? { chat: chat.updates, world: draft.updates } : null));
    }
  }, [worldId, view.revision]);
  if (!worldId) return <Empty icon="layers">Open a world chat to see its pins.</Empty>;
  const lagging = view.definitionsFrom;
  // An earlier Upgrade that didn't bring the definitions in leaves them to bring in, even at the head.
  const behind = index !== null && view.revision !== null && (index.head !== view.revision || lagging !== undefined);
  const generators = world ? Object.entries(world.pins.generators) : [];
  const tables = world ? Object.entries(world.pins.tables) : [];
  const shippedNewer = new Set((newer?.chat ?? []).map((u) => u.table));
  const named = (newer?.chat ?? []).slice(0, NAMED).map((u) => (u.status === "missing" ? `${u.label} (new)` : u.label));
  const more = (newer?.chat.length ?? 0) - named.length;
  return (
    <div class="lre-stack" data-lre-gm-pins>
      <Section flush>
        <List>
          <ListRow icon="globe" title="World" value={index?.name ?? world?.name ?? worldId} />
          <ListRow
            icon="layers"
            title="This chat's revision"
            subtitle={index !== null && index.head !== view.revision ? "A newer revision exists." : lagging ? "Up to date, but its people, things and accounts aren't." : "Up to date."}
            value={<code class="lre-gm-rev">{view.revision?.slice(0, 8) ?? "—"}</code>}
            valueTone={behind ? "warn" : undefined}
          />
        </List>
      </Section>
      {lagging ? (
        <div data-lre-definitions-lag>
          <Banner tone="warn" title="Not everything came in">
            People, things and accounts in this chat still follow revision {lagging.slice(0, 8)}: an earlier Upgrade didn't bring their changes in. Upgrade to review them and bring them in.
          </Banner>
        </div>
      ) : null}
      {newer && newer.chat.length > 0 ? (
        <div data-lre-gm-data-updates>
          <Banner
            tone="info"
            icon="table"
            title="Newer shipped data"
            actions={
              newer.world.length > 0 ? (
                <Button size="sm" icon="hammer" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "part", worldId, part: "meta" } }))}>
                  Open Data updates
                </Button>
              ) : undefined
            }
          >
            This build of LumiRPEngine ships newer data than this chat's revision has: {named.join(", ")}
            {more > 0 ? ` and ${more} more` : ""}.{" "}
            {newer.world.length > 0 ? "Apply them in Build → World → Data updates and commit; then Upgrade brings them into this chat." : "The world has them now: once its draft is committed, Upgrade brings them into this chat."}
          </Banner>
        </div>
      ) : null}
      {behind && index && !preview ? (
        <Button
          variant="primary"
          icon="refresh"
          busy={busy}
          onClick={() =>
            run(async () => {
              const result = await app.request({ type: "lre.marker", chatId: view.chatId, kind: "migrate", to: index.head, preview: true });
              if (result?.preview?.upgrade) setPreview(result.preview.upgrade);
            })
          }
        >
          Upgrade to the latest revision
        </Button>
      ) : null}
      {preview ? <UpgradePanel chatId={view.chatId} preview={preview} onDone={() => setPreview(null)} /> : null}
      {world ? (
        <>
          <Section title="Generators" flush>
            {generators.length === 0 ? (
              <Empty>None pinned.</Empty>
            ) : (
              <List>
                {generators.map(([id, version]) => (
                  <ListRow key={id} title={humanize(id)} id={id} value={`v${version}`} />
                ))}
              </List>
            )}
          </Section>
          <Section title="Tables" flush>
            {tables.length === 0 ? (
              <Empty>None pinned.</Empty>
            ) : (
              <List>
                {tables.map(([id, revision]) => (
                  <ListRow key={id} title={world.tables[id]?.label ?? humanize(id)} id={id} badge={shippedNewer.has(id) ? <Badge tone="accent">Newer shipped</Badge> : undefined} value={<code class="lre-gm-rev">{revision.slice(0, 8)}</code>} />
                ))}
              </List>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
