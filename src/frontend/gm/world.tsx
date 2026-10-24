// GM → World: every entity, secrets and the removed included, with search, a kind
// filter and badges; each opens its editor as a page. While a fight is on, a Fight card leads,
// opening the fight as the GM sees it (everyone named, HP exact). The things the player claimed
// into being (DESIGN §9.4) get a section of their own, with who holds each, so a GM can find one
// and remove it from its page. Spawn adds someone or something to this chat.

import { useEffect, useId, useState } from "preact/hooks";
import type { EncounterView } from "../../packs/combat/ui/panel";
import { decodeEncounterView, EncounterCard } from "../../packs/combat/ui/panel";
import { Button, Empty, Field, List, ListRow, Section } from "../components";
import { fidelityGroups } from "../batch";
import { Icon } from "../icons";
import { PickBox, SelectBar, useSelection } from "../multi-select";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";
import { BatchPage } from "./batch";
import type { Editor } from "./editor";
import { claimedThings, findEntities } from "./editor";
import { EntityBadges, EntityPage } from "./entity";
import { BuildLink, GmPage, useGmFocus, usePages } from "./ui";
import { CharacterSheet } from "./character";

type WorldPage = { entity: string } | "spawn" | "fight" | "batch";

function FightCard(props: { fight: EncounterView; turn: string; onOpen(): void }) {
  const { fight } = props;
  const standing = fight.order.filter((row) => !row.down && !row.out).length;
  return (
    <Section title="Fight under way" flush>
      <List>
        <ListRow icon="sword" title={`Round ${fight.round} · ${props.turn}`} subtitle={`${standing} of ${fight.order.length} still fighting`} chevron onClick={props.onOpen} />
      </List>
    </Section>
  );
}

function SpawnPage(props: { editor: Editor; onBack(): void }) {
  const { editor } = props;
  const [kind, setKind] = useState(editor.gm.kinds.find((k) => k.id === "person")?.id ?? editor.gm.kinds[0]?.id ?? "");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [tier, setTier] = useState("");
  const nameId = useId();
  const kindId = useId();
  const placeId = useId();
  const tierId = useId();
  const ready = !editor.busy && name.trim() !== "" && kind !== "";
  return (
    <GmPage name="spawn" title="Spawn" subtitle="Someone or something new in this chat" backLabel="World" onBack={props.onBack}>
      <Section>
        <form
          class="lre-stack"
          onSubmit={(event) => {
            event.preventDefault();
            // Back to the list, where what was spawned now shows.
            if (ready) void editor.edit([{ op: "spawn", kind, name: name.trim(), ...(place ? { place } : {}), ...(tier ? { tier } : {}) }]).then((ok) => ok && props.onBack());
          }}
        >
          <Field label="Name" for={nameId}>
            <input id={nameId} class="lre-input" value={name} onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
          <Field label="Kind" for={kindId}>
            <select id={kindId} class="lre-input" value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
              {editor.gm.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Place" for={placeId}>
            <select id={placeId} class="lre-input" value={place} onChange={(event) => setPlace(event.currentTarget.value)}>
              <option value="">No place</option>
              {editor.gm.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tier" for={tierId}>
            <select id={tierId} class="lre-input" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
              <option value="">The world's tier for new people</option>
              {editor.gm.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="primary" icon="user-plus" disabled={!ready}>
            Spawn
          </Button>
        </form>
      </Section>
    </GmPage>
  );
}

export function WorldSection(props: { editor: Editor; chatId: string }) {
  const { editor } = props;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const pages = usePages<WorldPage>();
  // A link from a character's Minds, Routines or Money page opens their sheet here.
  useGmFocus((id) => pages.open({ entity: id }));
  // Choosing several to change at once: a row's tap picks it instead of opening its page.
  const selection = useSelection();
  const fight = editor.gm.encounter === null ? null : decodeEncounterView(editor.gm.encounter);
  // Whose turn it is, as the Encounter card says it.
  const turn = fight === null ? "" : fight.yours ? "Your turn" : `${fight.turn.charAt(0).toUpperCase()}${fight.turn.slice(1)}'s turn`;
  const page = pages.page;
  const entity = page !== null && typeof page === "object" ? editor.gm.entities.find((e) => e.id === page.entity) : undefined;
  // Those picked still in the world's list (an Undo can take back a spawn), in its order.
  const chosen = editor.gm.entities.filter((e) => selection.ids.includes(e.id)).map((e) => e.id);
  const open = page === "spawn" || (page === "fight" && fight !== null) || (page === "batch" && chosen.length > 0) || entity !== undefined;
  // A page whose subject is gone (the fight ended, an Undo took back a spawn) gives way to the list.
  useEffect(() => {
    if (page !== null && !open) pages.back();
  });
  const list = findEntities(editor.gm.entities, query, kind);
  const kinds = editor.gm.kinds.filter((k) => editor.gm.entities.some((e) => e.kind === k.id));
  const claimed = claimedThings(editor.gm);
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list" hidden={open}>
        {fight ? <FightCard fight={fight} turn={turn} onOpen={() => pages.open("fight")} /> : null}
        {claimed.length > 0 ? (
          <Section title="Claimed by the player" flush>
            <div data-lre-gm-list="claimed">
              <List>
                {claimed.map(({ entity: e, where }) => (
                  <ListRow key={e.id} id={e.id} title={e.name} subtitle={where} badge={<EntityBadges entity={e} />} chevron onClick={() => pages.open({ entity: e.id })} />
                ))}
              </List>
            </div>
          </Section>
        ) : null}
        <div class="lre-gm-tools">
          <label class="lre-gm-search">
            <Icon name="search" size={16} />
            <input class="lre-input" type="search" aria-label="Search by name" placeholder="Search by name" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <select class="lre-input" aria-label="Kind" value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
            <option value="">Every kind</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <Button icon="user-plus" onClick={() => pages.open("spawn")}>
            Spawn
          </Button>
          <Button icon="checklist" variant={selection.on ? "primary" : "secondary"} onClick={() => (selection.on ? selection.stop() : selection.start())}>
            {selection.on ? "Done" : "Select"}
          </Button>
        </div>
        <Section title={`${list.length} of ${editor.gm.entities.length}`} flush>
          {list.length === 0 ? (
            <Empty icon="search">No one and nothing matches.</Empty>
          ) : (
            <div data-lre-gm-list="entities">
              <List>
                {list.map((e) => (
                  <ListRow
                    key={e.id}
                    id={e.id}
                    title={e.name}
                    leading={selection.on ? <PickBox label={`Select ${e.name}`} checked={selection.ids.includes(e.id)} /> : undefined}
                    subtitle={[editor.gm.kinds.find((k) => k.id === e.kind)?.label ?? e.kind, e.agent ? "lives their own day" : null, e.spawned ? "spawned here" : null].filter((part) => part !== null).join(" · ")}
                    badge={<EntityBadges entity={e} />}
                    chevron={!selection.on}
                    onClick={() => (selection.on ? selection.toggle(e.id) : pages.open({ entity: e.id }))}
                  />
                ))}
              </List>
            </div>
          )}
        </Section>
        {selection.on ? (
          <SelectBar label="Change the selected" selection={selection} all={editor.gm.entities.map((e) => e.id)} shown={list.map((e) => e.id)} groups={fidelityGroups(editor.gm.minds.characters, FIDELITY_LABEL)} groupLabel="Select a level">
            <Button variant="primary" icon="edit" disabled={chosen.length === 0 || editor.busy} onClick={() => pages.open("batch")}>
              {chosen.length === 1 ? "Change 1…" : `Change ${chosen.length}…`}
            </Button>
          </SelectBar>
        ) : (
          <BuildLink />
        )}
      </div>
      {page === "spawn" ? <SpawnPage editor={editor} onBack={pages.back} /> : null}
      {page === "fight" && fight ? (
        <GmPage name="fight" title="Fight" subtitle={`Round ${fight.round} · ${turn}`} backLabel="World" onBack={pages.back}>
          <EncounterCard view={fight} />
        </GmPage>
      ) : null}
      {entity ? entity.person ? <CharacterSheet entity={entity} editor={editor} chatId={props.chatId} onBack={pages.back} onOpen={(id) => pages.open({ entity: id })} /> : <EntityPage entity={entity} editor={editor} onBack={pages.back} /> : null}
      {page === "batch" && chosen.length > 0 ? <BatchPage editor={editor} ids={chosen} onBack={pages.back} /> : null}
    </div>
  );
}
