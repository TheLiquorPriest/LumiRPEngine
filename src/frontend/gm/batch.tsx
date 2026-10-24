// GM → World, Change the selected (DESIGN §7): one change for everyone picked in the list, each its
// GM edit op per entity, sent in chunks of `EDIT_OPS_MAX`, each chunk one edit with its own Undo.
// Their tier and a domain's level apply to anything picked; their routine's role, a fidelity pin and
// an intent to the characters among them; a move to anything not removed. GM data, behind the gate.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { DomainId, EntityId, Level, PlaceId } from "../../shared/ids";
import type { Fidelity, MindApproach } from "../../shared/minds";
import { FIDELITIES, MIND_APPROACHES, MIND_TEXT_CAPS } from "../../shared/minds";
import type { RoutineRole } from "../../shared/routines";
import { ROUTINE_ROLE_LABEL, ROUTINE_ROLES } from "../../shared/routines";
import { APPROACH_LABEL, FIDELITY_LABEL } from "../../packs/minds/ui/ops";
import type { BulkChange } from "../batch";
import { bulkOps, forCharacters, sendInChunks } from "../batch";
import { Banner, Button, Field, Section } from "../components";
import { LEVEL_LABEL } from "../settings/realism";
import type { Editor } from "./editor";
import { GmPage } from "./ui";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** Who a change reaches among those picked: the characters for a mind or routine change, anyone not removed for a move, everyone for the rest. */
export function bulkTargets(editor: Pick<Editor, "gm">, ids: readonly EntityId[], change: BulkChange): EntityId[] {
  if (forCharacters(change)) return ids.filter((id) => editor.gm.minds.characters.some((c) => c.entity === id));
  if (change.kind === "move") return ids.filter((id) => editor.gm.entities.some((e) => e.id === id && !e.gone));
  return [...ids];
}

function ChangeCard(props: { title: string; note: string; reach: number; ready: boolean; busy: boolean; onApply(): void; children: ComponentChildren }) {
  return (
    <Section title={props.title}>
      <div class="lre-stack">
        {props.children}
        <p class="lre-gm-note">{props.note}</p>
        <Button variant="primary" icon="check" disabled={props.busy || !props.ready || props.reach === 0} onClick={props.onApply}>
          {props.reach === 1 ? "Apply to 1" : `Apply to ${props.reach}`}
        </Button>
      </div>
    </Section>
  );
}

export function BatchPage(props: { editor: Editor; ids: readonly EntityId[]; onBack(): void }) {
  const { editor, ids } = props;
  const gm = editor.gm;
  const [tier, setTier] = useState(gm.tiers[0]?.id ?? "");
  const [domain, setDomain] = useState<DomainId | "">(gm.domains[0]?.id ?? "");
  const [level, setLevel] = useState<Level | null>(null);
  const [role, setRole] = useState<RoutineRole | null>(null);
  const [pin, setPin] = useState<Fidelity | null>(null);
  const [text, setText] = useState("");
  const [approach, setApproach] = useState<MindApproach | null>(null);
  const [place, setPlace] = useState<PlaceId | "">("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const tierId = useId();
  const domainId = useId();
  const levelId = useId();
  const roleId = useId();
  const pinId = useId();
  const textId = useId();
  const approachId = useId();
  const placeId = useId();
  const reach = (change: BulkChange) => bulkTargets(editor, ids, change).length;
  const apply = (change: BulkChange) => {
    const ops = bulkOps(bulkTargets(editor, ids, change), change);
    if (!ops || ops.length === 0) return;
    void sendInChunks(ops, editor.edit).then(({ applied, of }) => {
      if (applied === of) props.onBack();
      else setOutcome(applied === 0 ? "Nothing changed: the first edit was refused." : `${applied} of ${of} edits applied; the next was refused, so the rest weren't sent. Each applied edit has its own Undo.`);
    });
  };
  const characters = ids.filter((id) => gm.minds.characters.some((c) => c.entity === id)).length;
  const intent: BulkChange = { kind: "intent", text, approach };
  return (
    <GmPage name="batch" title={ids.length === 1 ? "Change 1 selected" : `Change ${ids.length} selected`} subtitle={`${characters} of them characters`} backLabel="World" onBack={props.onBack}>
      <div class="lre-stack" data-lre-gm-batch={ids.length}>
        <p class="lre-gm-note">Each change goes to everyone it applies to, as edits of at most 64, each with its own Undo.</p>
        {outcome ? <Banner tone="warn">{outcome}</Banner> : null}
        <ChangeCard title="Tier" note="Their detail band's caps follow the tier." reach={reach({ kind: "tier", tier })} ready={tier !== ""} busy={editor.busy} onApply={() => apply({ kind: "tier", tier })}>
          <Field label="Tier" for={tierId}>
            <select id={tierId} class="lre-input" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
              {gm.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard title="Detail in one domain" note="A level here wins over their tier's; From the tier hands it back." reach={domain === "" ? 0 : reach({ kind: "level", domain, level })} ready={domain !== ""} busy={editor.busy} onApply={() => domain !== "" && apply({ kind: "level", domain, level })}>
          <Field label="Domain" for={domainId}>
            <select id={domainId} class="lre-input" value={domain} onChange={(event) => setDomain(event.currentTarget.value as DomainId)}>
              {gm.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level" for={levelId}>
            <select id={levelId} class="lre-input" value={level === null ? "" : String(level)} onChange={(event) => setLevel(event.currentTarget.value === "" ? null : (Number(event.currentTarget.value) as Level))}>
              <option value="">From the tier</option>
              {LEVELS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} · {LEVEL_LABEL[n]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard title="Their routine" note="Characters only: what their routine is to the engine in this chat; As the world has it clears the chat's choice." reach={reach({ kind: "role", role })} ready busy={editor.busy} onApply={() => apply({ kind: "role", role })}>
          <Field label="Routine role" for={roleId}>
            <select id={roleId} class="lre-input" value={role ?? ""} onChange={(event) => setRole(ROUTINE_ROLES.find((r) => r === event.currentTarget.value) ?? null)}>
              <option value="">As the world has it</option>
              {ROUTINE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROUTINE_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard title="Pin their fidelity" note="Characters only: keeps them at a level in this chat whatever their score; By score unpins." reach={reach({ kind: "pin", level: pin })} ready busy={editor.busy} onApply={() => apply({ kind: "pin", level: pin })}>
          <Field label="Fidelity" for={pinId}>
            <select id={pinId} class="lre-input" value={pin ?? ""} onChange={(event) => setPin(FIDELITIES.find((f) => f === event.currentTarget.value) ?? null)}>
              <option value="">By score</option>
              {FIDELITIES.map((f) => (
                <option key={f} value={f}>
                  {FIDELITY_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard title="Your intent for them" note="Characters only: what each means to do now, which only their own mind reads. Blank text and Their mind decides clear it." reach={reach(intent)} ready={bulkOps([], intent) !== null} busy={editor.busy} onApply={() => apply(intent)}>
          <Field label="What they mean to do" for={textId} help={`${text.length} / ${MIND_TEXT_CAPS.gmIntent}`}>
            <textarea id={textId} class="lre-input lre-gm-prose" rows={3} maxLength={MIND_TEXT_CAPS.gmIntent} value={text} onInput={(event) => setText(event.currentTarget.value)} />
          </Field>
          <Field label="How they go about it" for={approachId}>
            <select id={approachId} class="lre-input" value={approach ?? ""} onChange={(event) => setApproach(MIND_APPROACHES.find((a) => a === event.currentTarget.value) ?? null)}>
              <option value="">Their mind decides</option>
              {MIND_APPROACHES.map((a) => (
                <option key={a} value={a}>
                  {APPROACH_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard title="Move to a place" note="Each one moves as the GM's Move does: anyone not removed." reach={place === "" ? 0 : reach({ kind: "move", to: place })} ready={place !== ""} busy={editor.busy} onApply={() => place !== "" && apply({ kind: "move", to: place })}>
          <Field label="Place" for={placeId}>
            <select id={placeId} class="lre-input" value={place} onChange={(event) => setPlace(event.currentTarget.value)}>
              <option value="">Choose a place</option>
              {gm.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
      </div>
    </GmPage>
  );
}
