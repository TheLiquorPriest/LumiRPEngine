// Settings → Your preset (DESIGN §6.8; docs/PRESETS.md): the preset world chats assemble with, what
// it says to LumiRPEngine (its section outlets and guidance blocks), adding the missing blocks, and
// whether a reply's <json> blocks show in world chats.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { PresetCard } from "../../shared/protocol";
import { useApp } from "../app";
import { Badge, Button, Empty, HostSwitch, List, ListRow, Section, useBusy } from "../components";

const BLOCK_STATE: Record<PresetCard["blocks"][number]["state"], { text: string; tone: "neutral" | "pos" | "warn" }> = {
  missing: { text: "Not in this preset", tone: "neutral" },
  empty: { text: "Switched off, nothing written yet", tone: "neutral" },
  read: { text: "Read for this helper", tone: "pos" },
  enabled: { text: "Switched on: it reaches the narrator in every chat, so the engine doesn't read it", tone: "warn" },
};

const BLOCK_BADGE: Record<PresetCard["blocks"][number]["state"], string> = { missing: "Missing", empty: "Empty", read: "Read", enabled: "On" };

function PresetCardView() {
  const app = useApp();
  const [card, setCard] = useState<PresetCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useBusy();
  useEffect(() => {
    void app.request({ type: "lre.preset", op: "get" }).then((result) => {
      if (result) setCard(result.card);
      else setFailed(true);
    });
  }, []);
  if (!card) return <Section>{failed ? <Empty icon="alert">The active preset could not be read.</Empty> : <Empty>Reading the active preset…</Empty>}</Section>;
  const missing = card.blocks.some((b) => b.state === "missing");
  const add = () =>
    run(async () => {
      const result = await app.request({ type: "lre.preset", op: "add" });
      if (result) setCard(result.card);
    });
  return (
    <div class="lre-stack" data-lre-preset-card>
      <Section title="Active preset" flush>
        <List>
          <ListRow icon="layers" title={card.preset?.name ?? "None"} subtitle="The preset world chats assemble with now: the active Loom preset, else the one the chat's connection links, else the one the last reply was assembled with." />
        </List>
      </Section>
      <Section title="Outlets" flush>
        {card.outlets.length === 0 ? (
          <Empty>None: the world places every section.</Empty>
        ) : (
          <List>
            {card.outlets.map((o) => (
              <ListRow key={o.outlet} title={<code class="lre-set-code">{`{{outlet::${o.outlet}}}`}</code>} subtitle={o.label ?? "No section of that name"} badge={o.label ? undefined : <Badge tone="warn">Unmatched</Badge>} />
            ))}
          </List>
        )}
      </Section>
      <Section title="Guidance blocks" flush>
        <List>
          {card.blocks.map((b) => (
            <ListRow key={b.target} title={b.name} subtitle={BLOCK_STATE[b.state].text} badge={<Badge tone={BLOCK_STATE[b.state].tone}>{BLOCK_BADGE[b.state]}</Badge>} />
          ))}
        </List>
      </Section>
      <Button icon="plus" block disabled={busy || !card.preset || !missing} onClick={add}>
        Add RPEngine blocks to this preset
      </Button>
      {!missing && card.preset ? <p class="lre-small lre-muted" style={{ margin: 0 }}>This preset has every RPEngine block.</p> : null}
    </div>
  );
}

export function PresetPage(props: { hideJsonBlocks: boolean; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack" data-lre-settings-page="preset">
      <p class="lre-set-lead">What your Lumiverse preset says to LumiRPEngine: where the engine's sections go and the guidance blocks its helpers read.</p>
      <PresetCardView />
      <Section title="JSON in replies">
        <div class="lre-field" data-lre-hide-json>
          <HostSwitch label="Hide JSON blocks in world chats" checked={props.hideJsonBlocks} disabled={props.busy} onChange={(hideJsonBlocks) => props.patch({ hideJsonBlocks })} />
          <span class="lre-field-help">
            {props.hideJsonBlocks
              ? "A <json>…</json> block a reply carries (some presets ask for one) is hidden once your preset's own display scripts have run, so a tracker your preset draws from it still shows. World Info skips the block either way, and it stays as written, so anything that reads it still can."
              : "Replies show their <json> blocks as the AI wrote them. World Info still skips the blocks."}
          </span>
        </div>
      </Section>
    </div>
  );
}
