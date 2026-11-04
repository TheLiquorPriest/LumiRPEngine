// Build → World → Data updates (DESIGN §9.2, ARCHITECTURE §6): the data tables this build ships newer
// than the world's copies (`lre.world updates`, read for the draft). A table the world never changed
// and one it lacks, Apply puts in the draft as shipped (`lre.editor shipped`). One the world changed
// is never replaced unasked: it reads "Changed by you · newer shipped version available", and its
// review shows what the shipped version changes and what the world changed, with Use the shipped
// version, asked first. Commit makes the draft a revision, and each chat takes it with an Upgrade
// (GM → This chat → Pins and upgrade).

import { useEffect, useMemo, useState } from "preact/hooks";
import type { TableId } from "../../shared/ids";
import type { TableRowChanges, TableUpdate } from "../../shared/protocol";
import { useApp } from "../app";
import { Badge, Button, List, ListRow, Section, useBusy } from "../components";
import { humanize } from "../format";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { FormGroup, FormSheet } from "./form-kit";

/** What a changed table's row says, as the user asked it to read. */
export const EDITED = "Changed by you · newer shipped version available";

/** What Apply leaves to do, said once it has put the updates in the draft. */
const APPLIED = "Data updates are in the draft. Commit makes them a revision; then Upgrade each chat in GM → This chat → Pins and upgrade.";

const rows = (n: number): string => (n === 1 ? "1 row" : `${n} rows`);

/** A change's rows in a few words ("18 rows added, 178 rows changed"); empty when no row changes. */
function rowWords(changes: TableRowChanges): string {
  const parts: string[] = [];
  if (changes.added.count > 0) parts.push(`${rows(changes.added.count)} added`);
  if (changes.changed.count > 0) parts.push(`${rows(changes.changed.count)} changed`);
  if (changes.dropped.count > 0) parts.push(`${rows(changes.dropped.count)} dropped`);
  return parts.join(", ");
}

/** A table's line in the card: what it is, and what the shipped version brings (a starter's own, named: "Newer Fantasy town version"). */
export function updateSummary(update: TableUpdate): string {
  if (update.status === "missing") return `New table · ${rows(update.shipped.added.count)}`;
  if (update.status === "edited") return EDITED;
  const columns = update.shipped.columns.added.map(humanize);
  return [update.starter ? `Newer ${update.starter.name} version` : "Newer shipped version", rowWords(update.shipped), columns.length > 0 ? `new ${columns.length === 1 ? "column" : "columns"}: ${columns.join(", ")}` : ""].filter((part) => part !== "").join(" · ");
}

/** The review's lines for one side of a change: each kind of row change with the rows it names, then the columns. */
export function changeLines(changes: TableRowChanges, columns?: TableUpdate["shipped"]["columns"]): string[] {
  const lines: string[] = [];
  // Row names may hold commas ("Refrigerator, full-size"), so semicolons part them.
  for (const [what, part] of [["added", changes.added], ["changed", changes.changed], ["dropped", changes.dropped]] as const) if (part.count > 0) lines.push(`${rows(part.count)} ${what}: ${part.names.join("; ")}${part.count > part.names.length ? `; and ${part.count - part.names.length} more` : ""}`);
  for (const [what, ids] of [["added", columns?.added ?? []], ["changed", columns?.changed ?? []], ["dropped", columns?.dropped ?? []]] as const) if (ids.length > 0) lines.push(`${ids.length === 1 ? "Column" : "Columns"} ${what}: ${ids.map(humanize).join(", ")}`);
  return lines.length > 0 ? lines : ["No rows change."];
}

/** The data updates for the draft Build holds, read again whenever the draft changes; null until read. */
export function useTableUpdates(): TableUpdate[] | null {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const key = draft ? `${draft.worldId}\u0000${draft.version}` : "";
  const [read, setRead] = useState<{ key: string; updates: TableUpdate[] } | null>(null);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    void app.request({ type: "lre.world", op: "updates", worldId: draft.worldId }).then((body) => {
      if (live && body?.updates) setRead({ key, updates: body.updates });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return read?.key === key ? read.updates : null;
}

/** An edited table's review: what each side changed since the version the world's copy came from, and the choice. */
function TableReview(props: { update: TableUpdate; busy: boolean; onTake(): void; onClose(): void }) {
  const { update } = props;
  return (
    <FormSheet title={update.label} subtitle={EDITED} backLabel="World" onClose={props.onClose}>
      <div class="lre-stack" data-lre-data-review={update.table}>
        <FormGroup title={update.starter ? `What ${update.starter.name}'s newer version changes` : "What the shipped version changes"}>
          <ul class="lre-gm-lines">
            {changeLines(update.shipped, update.shipped.columns).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </FormGroup>
        {update.yours ? (
          <FormGroup title="What you changed">
            <ul class="lre-gm-lines">
              {changeLines(update.yours).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </FormGroup>
        ) : null}
        <p class="lre-build-note">The shipped version takes this table's place in the draft, so what you changed in it leaves the draft. Discard changes brings it back until you commit, and the world's earlier revisions keep it.</p>
        <div class="lre-build-actions">
          <Button variant="danger" busy={props.busy} onClick={props.onTake}>
            Use the shipped version
          </Button>
          <Button variant="primary" disabled={props.busy} onClick={props.onClose}>
            Keep mine
          </Button>
        </div>
      </div>
    </FormSheet>
  );
}

/** The Data updates card: shown only while the draft has tables this build ships newer. */
export function DataUpdatesSection() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const updates = useTableUpdates();
  const [reviewing, setReviewing] = useState<TableId | null>(null);
  const [busy, run] = useBusy();
  if (!draft || !updates || updates.length === 0) return null;
  const taken = updates.filter((u) => u.status !== "edited");
  const review = reviewing === null ? undefined : updates.find((u) => u.table === reviewing && u.status === "edited");
  const take = (tables: TableId[], after?: () => void): void =>
    run(async () => {
      const message = await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "shipped", tables });
      if (message.type !== "lre.result") return;
      after?.();
      app.toast(APPLIED, "info");
    });
  const chooseShipped = (update: TableUpdate): void =>
    void app.host.confirm("Use the shipped version", `Put the shipped “${update.label}” in place of this world's copy? What you changed in it leaves the draft.`, "danger", "Use the shipped version").then((sure) => {
      if (sure) take([update.table], () => setReviewing(null));
    });
  return (
    <>
      <Section title="Data updates" aside={<Badge tone="accent">{updates.length}</Badge>}>
        <div class="lre-stack" data-lre-data-updates>
          <p class="lre-build-note">This build of LumiRPEngine ships newer data tables than this world has. Apply puts them in the draft; Commit makes them a revision, and each chat takes them when you Upgrade it (GM → This chat → Pins and upgrade). A table you changed stays as it is: review it to see what's new, and take the shipped version only if you want it.</p>
          <List>
            {updates.map((u) => (
              <ListRow
                key={u.table}
                icon="table"
                title={u.label}
                subtitle={updateSummary(u)}
                id={u.table}
                badge={u.status === "missing" ? <Badge tone="accent">New</Badge> : u.status === "edited" ? <Badge tone="warn">Review</Badge> : undefined}
                chevron={u.status === "edited"}
                onClick={u.status === "edited" ? () => setReviewing(u.table) : undefined}
              />
            ))}
          </List>
          {taken.length > 0 ? (
            <div class="lre-build-actions">
              <Button variant="primary" icon="refresh" busy={busy} onClick={() => take(taken.map((u) => u.table))}>
                {taken.length === 1 ? "Apply 1 update" : `Apply ${taken.length} updates`}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>
      {review ? <TableReview update={review} busy={busy} onTake={() => chooseShipped(review)} onClose={() => setReviewing(null)} /> : null}
    </>
  );
}
