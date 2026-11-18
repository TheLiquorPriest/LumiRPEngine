// Build → Entities and Places, Change the selected (DESIGN §4.1): one change for everyone picked in
// the list, written to the draft as a JSON Patch worked out from the draft as it stands, so only what
// changes is written, in chunks of `EDIT_OPS_MAX` operations. Entities take a tier and a domain's
// level override; places a default scene type. Every control starts empty ("Choose…"), so nothing
// applies until a value is picked, and each card says how those it reaches stand now. An entity's
// tier and level reach the people picked unless widened to everything picked. A place a map draws
// keeps the map's scene type. Lore pins are not offered: nothing RPE runs reads them.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { DomainId, Level } from "../../shared/ids";
import { DOMAINS } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import type { DraftChange } from "../batch";
import { draftPatch, mixOf, sendInChunks } from "../batch";
import { Banner, Button, Field, HostSwitch, Section, useBusy } from "../components";
import { DOMAIN_LABEL, LEVEL_LABEL } from "../../shared/ids";
import { useSelect } from "../../ui/store";
import { draftSend } from "./draft";
import { FormSheet } from "./form-kit";
import { kindIs } from "./selector-editor";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** Who an entity change reaches among those picked: the people (a kind that is or extends a person), or every one picked when `everything`. Places take every change. */
export function draftTargets(doc: WorldDoc, collection: "entities" | "places", ids: readonly string[], everything: boolean): string[] {
  if (collection === "places" || everything) return [...ids];
  return ids.filter((id) => hasOwn(doc.entities, id) && kindIs(doc, doc.entities[id]?.kind ?? "", "person"));
}

/** One change's card: its controls, how those it reaches stand now, and its button, off until a value is chosen and someone picked fits it. */
function ChangeCard(props: { title: string; now: string | null; ready: boolean; reach: number; busy: boolean; verb: string; onApply(): void; children: ComponentChildren }) {
  return (
    <Section title={props.title}>
      <div class="lre-stack">
        {props.children}
        {props.now ? <p class="lre-batch-now">Now: {props.now}</p> : null}
        <Button variant="primary" icon="check" disabled={props.busy || !props.ready || props.reach === 0} onClick={props.onApply}>
          {!props.ready ? props.verb : props.reach === 0 ? "None of them fit" : `${props.verb} for ${props.reach}`}
        </Button>
      </div>
    </Section>
  );
}

export function DraftBatchSheet(props: { collection: "entities" | "places"; ids: readonly string[]; onClose(): void }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [busy, run] = useBusy();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainId | null>(null);
  const [level, setLevel] = useState<Level | "tier" | null>(null);
  const [sceneType, setSceneType] = useState("");
  // Whether a card widens past the people picked to every entity picked.
  const [all, setAll] = useState({ tier: false, level: false });
  const ids = { tier: useId(), domain: useId(), level: useId(), scene: useId(), scenes: useId() };
  if (!draft) return null;
  const doc = draft.doc;
  const tiers = Object.entries(doc.tiers).sort(([, a], [, b]) => a.order - b.order);
  const scenes = [...new Set(Object.values(doc.places).flatMap((p) => (p.sceneType ? [p.sceneType] : [])))].sort();
  const send = draftSend(app);
  const reach = (card: "tier" | "level") => draftTargets(doc, props.collection, props.ids, all[card]);
  const others = props.ids.length - draftTargets(doc, props.collection, props.ids, false).length;
  const apply = (targets: readonly string[], change: DraftChange) =>
    run(async () => {
      const current = app.drafts.get();
      if (!current) return;
      const ops = draftPatch(current.doc, props.collection, targets, change);
      if (ops.length === 0) return setOutcome("Nothing to change: everyone selected has it already.");
      // The size is RPE's setting: `engine.maxEditOps` operations at a time, never more than one patch of a draft may carry (`worlds.maxPatchOps`).
      const limits = (await app.request({ type: "lre.world", op: "limits" }))?.limits;
      if (!limits) return;
      const size = Math.min(limits.editOps, limits.patchOps);
      // `draftSend` writes against the draft as it stands, so each chunk follows the one before.
      const done = await sendInChunks(ops, async (chunk) => (await send({ type: "lre.editor", worldId: current.worldId, base: current.base, op: "patch", ops: chunk })).type === "lre.result", size);
      if (done.applied === done.of) props.onClose();
      else setOutcome(done.applied === 0 ? "Nothing was saved." : `${done.applied} of ${done.of} writes saved; the next was refused, so the rest weren't sent.`);
    });
  const widen = (card: "tier" | "level") =>
    props.collection === "entities" && others > 0 ? <HostSwitch checked={all[card]} label={others === 1 ? "Also the 1 picked that isn't a person" : `Also the ${others} picked that aren't people`} onChange={(checked) => setAll({ ...all, [card]: checked })} /> : null;
  const entity = (id: string) => (hasOwn(doc.entities, id) ? doc.entities[id] : undefined);
  const tierOf = (id: string | undefined) => (id === undefined ? "with no tier" : (doc.tiers[id]?.label ?? id));
  const levelOf = (id: string): string => {
    const set = LEVELS.find((n) => domain !== null && n === entity(id)?.levels?.[domain]);
    return set === undefined ? "from the tier" : `set to ${set} · ${LEVEL_LABEL[set]}`;
  };
  const levelChange: DraftChange | null = domain === null || level === null ? null : { kind: "level", domain, level: level === "tier" ? null : level };
  const noun = props.collection === "entities" ? "entity" : "place";
  return (
    <FormSheet title={props.ids.length === 1 ? `Change 1 ${noun}` : `Change ${props.ids.length} ${props.collection}`} subtitle="Pick a value, then apply it: each change goes to the draft at once" onClose={props.onClose}>
      <div class="lre-stack" data-lre-build-batch={props.collection}>
        {outcome ? <Banner tone="warn">{outcome}</Banner> : null}
        {props.collection === "entities" ? (
          <>
            <ChangeCard title="Tier" now={reach("tier").length > 0 ? mixOf(reach("tier").map((id) => tierOf(entity(id)?.tier))) : null} ready={tier !== null} reach={reach("tier").length} busy={busy} verb="Set the tier" onApply={() => tier !== null && apply(reach("tier"), { kind: "tier", tier })}>
              <Field label="Tier" for={ids.tier}>
                <select id={ids.tier} class="lre-input" value={tier ?? ""} onChange={(event) => setTier(event.currentTarget.value === "" ? null : event.currentTarget.value)}>
                  <option value="">Choose a tier…</option>
                  {tiers.map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {widen("tier")}
            </ChangeCard>
            <ChangeCard title="Detail in one area" now={domain === null || reach("level").length === 0 ? null : mixOf(reach("level").map(levelOf))} ready={levelChange !== null} reach={reach("level").length} busy={busy} verb="Set the level" onApply={() => levelChange && apply(reach("level"), levelChange)}>
              <Field label="Area" for={ids.domain}>
                <select id={ids.domain} class="lre-input" value={domain ?? ""} onChange={(event) => setDomain(DOMAINS.find((d) => d === event.currentTarget.value) ?? null)}>
                  <option value="">Choose an area…</option>
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {DOMAIN_LABEL[d]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Level" for={ids.level} help="A level here wins over the tier's; “From the tier” removes it.">
                <select id={ids.level} class="lre-input" value={level === null ? "" : String(level)} onChange={(event) => setLevel(event.currentTarget.value === "tier" ? "tier" : (LEVELS.find((n) => String(n) === event.currentTarget.value) ?? null))}>
                  <option value="">Choose a level…</option>
                  <option value="tier">From the tier</option>
                  {LEVELS.map((n) => (
                    <option key={n} value={String(n)}>
                      {n} · {LEVEL_LABEL[n]}
                    </option>
                  ))}
                </select>
              </Field>
              {widen("level")}
            </ChangeCard>
          </>
        ) : (
          <Section title="Default scene type">
            <div class="lre-stack">
              <Field label="Scene type" for={ids.scene} help="A place a map draws keeps the map's.">
                <input id={ids.scene} class="lre-input" list={ids.scenes} placeholder="Choose or type a scene type…" value={sceneType} onInput={(event) => setSceneType(event.currentTarget.value)} />
                <datalist id={ids.scenes}>
                  {scenes.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <p class="lre-batch-now">Now: {mixOf(props.ids.map((id) => (doc.places[id]?.map !== undefined ? "drawn by a map" : (doc.places[id]?.sceneType ?? "none"))))}</p>
              <Button variant="primary" icon="check" disabled={busy || sceneType.trim() === ""} onClick={() => apply(props.ids, { kind: "sceneType", sceneType: sceneType.trim() })}>
                {sceneType.trim() === "" ? "Set the scene type" : `Set it for ${props.ids.length}`}
              </Button>
              <Button variant="ghost" icon="close" disabled={busy} onClick={() => apply(props.ids, { kind: "sceneType", sceneType: null })}>
                Remove their scene type
              </Button>
            </div>
          </Section>
        )}
      </div>
    </FormSheet>
  );
}
