// Build → Entities and Places, Change the selected (DESIGN §4.1): one change for everyone picked in
// the list, written to the draft as a JSON Patch worked out from the draft as it stands, so only what
// changes is written, in chunks of `EDIT_OPS_MAX` operations. Entities take a tier, a domain's level
// override and a lore pin; places a default scene type and a lore pin. A place a map draws keeps the
// map's scene type; its pins are the world's, so they're set here as for any place.

import { useEffect, useId, useState } from "preact/hooks";
import type { DomainId, Level } from "../../shared/ids";
import { DOMAINS } from "../../shared/ids";
import type { LoreBookEntryView, LoreBookView } from "../../shared/protocol";
import type { LorePin } from "../../shared/world";
import { useApp } from "../app";
import type { DraftChange } from "../batch";
import { draftPatch, sendInChunks } from "../batch";
import { Banner, Button, Field, Section, useBusy } from "../components";
import { DOMAIN_LABEL, LEVEL_LABEL } from "../settings/realism";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { FormSheet } from "./form-kit";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** The picker's choice of a whole book rather than one of its entries; no host entry id looks like it. */
const WHOLE_BOOK = "lre:whole-book";

export function DraftBatchSheet(props: { collection: "entities" | "places"; ids: readonly string[]; onClose(): void }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [busy, run] = useBusy();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [tier, setTier] = useState("");
  const [domain, setDomain] = useState<DomainId>(DOMAINS[0]);
  const [level, setLevel] = useState<Level | null>(null);
  const [sceneType, setSceneType] = useState("");
  const [lore, setLore] = useState("");
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  const [book, setBook] = useState("");
  const [entries, setEntries] = useState<LoreBookEntryView[] | null>(null);
  const [entry, setEntry] = useState("");
  const ids = { tier: useId(), domain: useId(), level: useId(), scene: useId(), scenes: useId(), lore: useId(), book: useId(), entry: useId() };
  useEffect(() => {
    void app.request({ type: "lre.lore", op: "books", ...(app.client.getState().chatId ? { chatId: app.client.getState().chatId ?? "" } : {}) }).then((body) => setBooks(body?.books ?? []));
  }, []);
  useEffect(() => {
    setEntries(null);
    setEntry("");
    if (book === "") return;
    void app.request({ type: "lre.lore", op: "entries", bookId: book }).then((body) => setEntries(body?.entries ?? []));
  }, [book]);
  if (!draft) return null;
  const doc = draft.doc;
  const tiers = Object.entries(doc.tiers).sort(([, a], [, b]) => a.order - b.order);
  const tierPick = tier !== "" ? tier : (tiers[0]?.[0] ?? "");
  const scenes = [...new Set(Object.values(doc.places).flatMap((p) => (p.sceneType ? [p.sceneType] : [])))].sort();
  const pin: LorePin | null = lore !== "" ? { lore } : book !== "" && entry !== "" ? (entry === WHOLE_BOOK ? { book } : { book, entry }) : null;
  const send = draftSend(app);
  const apply = (change: DraftChange) =>
    run(async () => {
      const current = app.drafts.get();
      if (!current) return;
      const ops = draftPatch(current.doc, props.collection, props.ids, change);
      if (ops.length === 0) return setOutcome("Nothing to change: everyone selected has it already.");
      // `draftSend` writes against the draft as it stands, so each chunk follows the one before.
      const done = await sendInChunks(ops, async (chunk) => (await send({ type: "lre.editor", worldId: current.worldId, base: current.base, op: "patch", ops: chunk })).type === "lre.result");
      if (done.applied === done.of) props.onClose();
      else setOutcome(done.applied === 0 ? "Nothing was saved." : `${done.applied} of ${done.of} writes saved; the next was refused, so the rest weren't sent.`);
    });
  const noun = props.collection === "entities" ? "entity" : "place";
  return (
    <FormSheet title={props.ids.length === 1 ? `Change 1 ${noun}` : `Change ${props.ids.length} ${props.collection}`} subtitle="Each change goes to the draft at once" onClose={props.onClose}>
      <div class="lre-stack" data-lre-build-batch={props.collection}>
        {outcome ? <Banner tone="warn">{outcome}</Banner> : null}
        {props.collection === "entities" ? (
          <>
            <Section title="Tier">
              <div class="lre-stack">
                <Field label="Tier" for={ids.tier}>
                  <select id={ids.tier} class="lre-input" value={tierPick} onChange={(event) => setTier(event.currentTarget.value)}>
                    {tiers.map(([id, t]) => (
                      <option key={id} value={id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="primary" icon="check" disabled={busy || tierPick === ""} onClick={() => apply({ kind: "tier", tier: tierPick })}>
                  Set the tier
                </Button>
              </div>
            </Section>
            <Section title="Detail in one domain">
              <div class="lre-stack">
                <Field label="Domain" for={ids.domain}>
                  <select id={ids.domain} class="lre-input" value={domain} onChange={(event) => setDomain(DOMAINS.find((d) => d === event.currentTarget.value) ?? DOMAINS[0])}>
                    {DOMAINS.map((d) => (
                      <option key={d} value={d}>
                        {DOMAIN_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Level" for={ids.level} help="A level here wins over the tier's; From the tier removes the override.">
                  <select id={ids.level} class="lre-input" value={level === null ? "" : String(level)} onChange={(event) => setLevel(LEVELS.find((n) => String(n) === event.currentTarget.value) ?? null)}>
                    <option value="">From the tier</option>
                    {LEVELS.map((n) => (
                      <option key={n} value={String(n)}>
                        {n} · {LEVEL_LABEL[n]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="primary" icon="check" disabled={busy} onClick={() => apply({ kind: "level", domain, level })}>
                  Set the level
                </Button>
              </div>
            </Section>
          </>
        ) : (
          <Section title="Default scene type">
            <div class="lre-stack">
              <Field label="Scene type" for={ids.scene} help="Blank removes it. A place a map draws keeps the map's.">
                <input id={ids.scene} class="lre-input" list={ids.scenes} value={sceneType} onInput={(event) => setSceneType(event.currentTarget.value)} />
                <datalist id={ids.scenes}>
                  {scenes.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Button variant="primary" icon="check" disabled={busy} onClick={() => apply({ kind: "sceneType", sceneType: sceneType.trim() === "" ? null : sceneType.trim() })}>
                {sceneType.trim() === "" ? "Remove the scene type" : "Set the scene type"}
              </Button>
            </div>
          </Section>
        )}
        <Section title="Pin lore">
          <div class="lre-stack">
            <p class="lre-build-note">Adds the pin to each one's Pinned lore, where it isn't pinned already. A chat uses it once you commit and Upgrade it.</p>
            <Field label="One of the world's lore entries" for={ids.lore}>
              <select id={ids.lore} class="lre-input" value={lore} onChange={(event) => (setLore(event.currentTarget.value), setBook(""))}>
                <option value="">Choose an entry</option>
                {Object.values(doc.lore)
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title || l.id}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Or from a World Info book" for={ids.book}>
              <select id={ids.book} class="lre-input" value={book} onChange={(event) => (setBook(event.currentTarget.value), setLore(""))}>
                <option value="">{books === null ? "Loading books…" : books.length === 0 ? "No World Info books" : "Choose a book"}</option>
                {(books ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            {book !== "" ? (
              <Field label="Entry" for={ids.entry}>
                <select id={ids.entry} class="lre-input" value={entry} onChange={(event) => setEntry(event.currentTarget.value)}>
                  <option value="">{entries === null ? "Loading entries…" : "Choose the whole book or one entry"}</option>
                  <option value={WHOLE_BOOK}>The whole book (its switched-on entries, new ones too)</option>
                  {(entries ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title || e.id}
                      {e.disabled ? " (off in its book)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Button variant="primary" icon="pin" disabled={busy || pin === null} onClick={() => pin && apply({ kind: "pin", pin })}>
              Pin it
            </Button>
          </div>
        </Section>
      </div>
    </FormSheet>
  );
}
