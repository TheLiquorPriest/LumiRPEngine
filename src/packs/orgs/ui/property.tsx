// An organization's Property tab (ORG-SPEC §4.4, §3.9; `r.orgTab` over the orgs pack's `premises`
// section): Premises and entry, each place it holds with who may enter and now, its hours, keys and
// who carries them, and the latest entries without leave for a reader who may change them. Change
// entry, for a holder of `property.manage`, is their bookkeeping (`org_entry`, mechanical: it applies
// at once, with its Undo). In GM → Orgs the GM changes the keys too, by one edit (`orgs.entry`).

import { useState } from "preact/hooks";
import { isRecord, type JsonObject } from "../../../shared/json";
import { AUDIENCES, ORG_ENTRY_ACTION } from "../../../shared/org";
import type { PremiseView, PremisesView } from "../../../shared/org-view";
import { useApp } from "../../../frontend/app";
import { Badge, Button, Card, Empty, JsonView, Section, useBusy } from "../../../frontend/components";
import { list, num, str, strings } from "../../../frontend/decode";
import { entryArgs, entryDraft, EntryForm, entryOps, PremiseRows, type EntryDraft } from "../../../frontend/place-entry";
import type { OrgGmTabProps, OrgTabDef, OrgTabProps } from "../../../frontend/registry";

function text(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function premise(p: Record<string, unknown>): PremiseView | null {
  if (typeof p.id !== "string") return null;
  const audience = (v: unknown) => AUDIENCES.find((a) => a === v) ?? null;
  return {
    id: p.id,
    name: str(p.name, p.id),
    entry: audience(p.entry),
    from: text(p.from),
    playEntry: audience(p.playEntry),
    inPlay: p.inPlay === true,
    words: str(p.words),
    now: str(p.now),
    hours: text(p.hours),
    keys: strings(p.keys),
    keysSet: strings(p.keysSet),
    carriers: list(p.carriers, (c) => (typeof c.id === "string" ? { id: c.id, name: str(c.name, c.id) } : null)),
    hiddenCarriers: num(p.hiddenCarriers),
    trespass: list(p.trespass, (t) => (typeof t.who === "string" ? { who: t.who, at: str(t.at) } : null)),
  };
}

/** The Premises section as the page carries it; null for a shape it isn't. */
export function decodePremises(value: unknown): PremisesView | null {
  if (!isRecord(value) || !Array.isArray(value.places)) return null;
  return { places: list(value.places, premise), canChange: value.canChange === true };
}

export interface PremisesProps {
  view: PremisesView;
  /** The place whose entry is being changed, and how; null while none is. */
  draft: EntryDraft | null;
  /** The GM's form, with the keys. */
  keys: boolean;
  busy: boolean;
  onDraft(draft: EntryDraft | null): void;
  onSave(place: PremiseView, draft: EntryDraft): void;
}

/** Premises and entry: a card for each place, with Change entry for a reader who may. */
export function Premises(props: PremisesProps) {
  const { view, draft } = props;
  if (view.places.length === 0) return <Empty icon="home">It holds no place you know of.</Empty>;
  return (
    <div class="lre-stack" data-lre-org-premises="">
      <Section title="Premises and entry">
        <div class="lre-stack">
          {view.places.map((p) => (
            <div key={p.id} data-lre-premise={p.id}>
              <Card title={p.name} aside={p.inPlay ? <Badge tone="accent">Changed in play</Badge> : undefined}>
                <div class="lre-stack">
                  <PremiseRows place={p} />
                  {!view.canChange ? null : draft?.place === p.id ? (
                    <EntryForm place={p} draft={draft} keys={props.keys} busy={props.busy} onDraft={props.onDraft} onSave={() => props.onSave(p, draft)} onCancel={() => props.onDraft(null)} />
                  ) : (
                    <Button size="sm" variant="secondary" icon="key" disabled={props.busy} onClick={() => props.onDraft(entryDraft(p))}>
                      Change entry
                    </Button>
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** A member's Change entry as `org_entry`'s params: who may enter only (the keys are the GM's); null when it changes nothing. */
export function orgEntryParams(org: string, p: PremiseView, d: EntryDraft): JsonObject | null {
  const entry = entryArgs(p, d)?.entry;
  return entry === undefined ? null : { org, place: p.id, entry };
}

/** Play's Property: Change entry is the reader's own bookkeeping for the organization, recorded at once. */
export function OrgPropertyTab(props: OrgTabProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const view = decodePremises(props.section);
  if (!view) return <JsonView value={props.section} />;
  const save = (p: PremiseView, d: EntryDraft): void => {
    const params = orgEntryParams(props.org.id, p, d);
    if (params === null) return;
    run(async () => {
      const result = await app.request({ type: "lre.action", chatId: props.chatId, action: ORG_ENTRY_ACTION, params, source: "palette" });
      if (result && "pending" in result && result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result) setDraft(null);
    });
  };
  return <Premises view={view} draft={draft} keys={false} busy={busy} onDraft={setDraft} onSave={save} />;
}

/** GM → Orgs' Property: the same, with the keys, each change one edit with its History line on the organization. */
export function GmOrgPropertyTab(props: OrgGmTabProps) {
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const view = decodePremises(props.section);
  if (!view) return <JsonView value={props.section} />;
  const save = (p: PremiseView, d: EntryDraft): void => {
    const ops = entryOps(p, d, props.org.id);
    if (ops.length > 0) void props.gm.edit(ops).then((ok) => ok && setDraft(null));
  };
  return <Premises view={view} draft={draft} keys busy={props.gm.busy} onDraft={setDraft} onSave={save} />;
}

/** The Property tab, after Money (40) and before Ownership (60). */
export const PROPERTY_TAB: OrgTabDef = { id: "orgs.property", label: "Property", order: 50, section: "premises", component: OrgPropertyTab, gm: GmOrgPropertyTab };
