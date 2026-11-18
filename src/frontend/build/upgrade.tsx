// Build → a world → its chats → Upgrade (DESIGN §4.3 `migrate`, §12; PlanChatUI-B4): what the Upgrade brings into the chat, entity by
// entity. Each change shows the chat's value, the revision's, and why it defaults to take (unchanged in play) or keep (changed in
// play); the owner flips any of them, and the Upgrade goes out with the picks that differ from the defaults. Changes that would give a
// secret away wait behind their own spoiler gate, as the World page's truth does: each reads "A hidden change", with its pick still there,
// until the owner shows the spoilers. A move takes effect from the chat's next turn (a turn that runs now keeps the revision it
// started with), and Undo takes it back whole. The world home lists each of the world's chats and the Upgrade of the ones behind.

import { useEffect, useState } from "preact/hooks";
import type { WorldId } from "../../shared/ids";
import type { EntityUpgradePick } from "../../shared/ledger";
import type { WorldChatInfo } from "../../shared/protocol";
import type { UpgradeChange, UpgradePreview } from "../../shared/upgrade";
import { useApp, useView } from "../app";
import { Badge, Banner, Button, List, ListRow, Section, Seg, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard } from "../gm/ui";
import { upgradeRequest } from "../requests";

const PICK_LABEL: Record<EntityUpgradePick, string> = { take: "Take", keep: "Keep", remove: "Remove" };
const WHY_LABEL: Record<UpgradeChange["why"], string> = { "changed in play": "Changed in play", unchanged: "Unchanged in play", new: "New in this revision", removed: "Gone from this revision" };
const STATUS_LABEL: Record<UpgradePreview["entities"][number]["status"], string> = { new: "New", changed: "Changed", removed: "Gone" };
/** What a change behind the spoiler gate reads as. */
const HIDDEN = "A hidden change";

export function UpgradePanel(props: { chatId: string; preview: UpgradePreview; onDone(done?: { edit: string | null }): void }) {
  const app = useApp();
  const [choices, setChoices] = useState<Record<string, EntityUpgradePick>>({});
  const [inPlayOnly, setInPlayOnly] = useState(false);
  const [spoilers, setSpoilers] = useState(false);
  const [busy, run] = useBusy();
  const all = props.preview.entities.flatMap((row) => row.changes);
  const choiceOf = (c: UpgradeChange): EntityUpgradePick => choices[c.id] ?? c.pick;
  const inPlay = all.filter((c) => c.why === "changed in play").length;
  const taking = all.filter((c) => choiceOf(c) !== "keep").length;
  const secrets = props.preview.entities.some((row) => row.secret === true || row.changes.some((c) => c.secret === true)) || props.preview.tracks.some((t) => t.secret === true);
  const rows = props.preview.entities.map((row) => ({ ...row, changes: inPlayOnly ? row.changes.filter((c) => c.why === "changed in play") : row.changes })).filter((row) => row.changes.length > 0);
  const to = props.preview.to.slice(0, 8);
  const takeUnchanged = (): void =>
    setChoices((prev) => {
      const next = { ...prev };
      for (const c of all) if (c.why !== "changed in play" && c.options.includes("take")) next[c.id] = "take";
      return next;
    });
  const confirm = (): void =>
    run(async () => {
      const result = await app.request(upgradeRequest(props.chatId, props.preview, choices));
      if (!result) return;
      app.toast(result.pending === true ? `Upgrading to revision ${to}: the next turn plays it.` : `Upgraded to revision ${to}: the next turn plays it.`, "info");
      props.onDone({ edit: result.undo ?? null });
    });
  return (
    <div class="lre-stack lre-gm-upgrade" data-lre-upgrade-preview>
      <div class="lre-gm-upgrade-head">
        <h3 class="lre-gm-card-title">Upgrade to revision {to}</h3>
        <p class="lre-gm-note">
          {all.length === 0 ? "No person, thing or account changes; rules, schedules and tables apply from the next turn." : `${all.length} ${all.length === 1 ? "change" : "changes"} to people, things and accounts, ${inPlay} changed in play. ${taking} will be taken.`} Earlier turns keep what they showed.
        </p>
      </div>
      {secrets ? (
        <Banner
          tone="gm"
          icon={spoilers ? "eye" : "eye-off"}
          title={spoilers ? "Spoilers are shown" : "Some changes are hidden"}
          actions={
            <button type="button" class="lre-btn small" aria-pressed={spoilers} disabled={busy} onClick={() => setSpoilers(!spoilers)} data-lre-upgrade-spoilers>
              {spoilers ? "Hide spoilers" : "Show spoilers"}
            </button>
          }
        >
          {spoilers ? "Every change shows as it is." : "Changes that would give a secret away read as hidden; their picks still apply."}
        </Banner>
      ) : null}
      {all.length > 0 ? (
        <div class="lre-inline">
          <Button size="sm" icon="check" disabled={busy} onClick={takeUnchanged}>
            Take all unchanged
          </Button>
          <button type="button" class={inPlayOnly ? "lre-btn small primary" : "lre-btn small"} aria-pressed={inPlayOnly} disabled={busy || inPlay === 0} onClick={() => setInPlayOnly(!inPlayOnly)}>
            Review changed in play ({inPlay})
          </button>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const rowHidden = row.secret === true && !spoilers;
        return (
          <div key={`${row.entity}:${row.secret === true ? "hidden" : "shown"}`} data-lre-upgrade-entity={rowHidden ? `hidden-${index}` : row.entity}>
            <GmCard title={rowHidden ? HIDDEN : row.name} subtitle={rowHidden ? undefined : row.kind} id={rowHidden ? undefined : row.entity} badges={rowHidden ? undefined : <Badge>{STATUS_LABEL[row.status]}</Badge>}>
              <ActionRows label={rowHidden ? HIDDEN : row.name}>
                {row.changes.map((c, i) => {
                  const hidden = rowHidden || (c.secret === true && !spoilers);
                  return (
                    <ActionRow key={c.id} title={hidden ? HIDDEN : c.label} subtitle={hidden ? undefined : `${c.from} → ${c.to}`} value={WHY_LABEL[c.why]} tone={c.why === "changed in play" ? "warn" : "muted"}>
                      <div class="lre-gm-upgrade-pick" data-lre-upgrade-change={hidden ? `hidden-${index}-${i}` : c.id}>
                        <Seg<EntityUpgradePick> label={hidden ? HIDDEN : `${row.name}: ${c.label}`} value={choiceOf(c)} disabled={busy} options={c.options.map((o) => ({ value: o, label: PICK_LABEL[o] }))} onChange={(v) => setChoices((prev) => ({ ...prev, [c.id]: v }))} />
                      </div>
                    </ActionRow>
                  );
                })}
              </ActionRows>
            </GmCard>
          </div>
        );
      })}
      {props.preview.tracks.length > 0 ? (
        <ul class="lre-gm-lines">
          {props.preview.tracks.map((line, i) => (
            <li key={`${i}`}>{line.secret === true && !spoilers ? HIDDEN : line.text}</li>
          ))}
        </ul>
      ) : null}
      <div class="lre-inline">
        <Button variant="primary" busy={busy} onClick={confirm}>
          Upgrade with these picks
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => props.onDone()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A world's home: the chats that play it, each with the revision it plays and whether the world has gone on past it. A chat that is
 * behind opens the Upgrade sheet over today's preview and picks; once moved, Undo takes the move back whole. The open chat is marked.
 */
export function WorldChatsSection(props: { worldId: WorldId }) {
  const app = useApp();
  const open = useView();
  const [chats, setChats] = useState<WorldChatInfo[] | null>(null);
  const [sheet, setSheet] = useState<{ chat: string; preview: UpgradePreview } | null>(null);
  const [undo, setUndo] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const load = (): void => void app.request({ type: "lre.world", op: "chats", worldId: props.worldId }).then((result) => setChats(result?.chats ?? []));
  useEffect(load, [props.worldId]);
  if (chats === null || chats.length === 0) return null;
  const named = (chat: string): string => chats.find((c) => c.chatId === chat)?.name ?? chat;
  const preview = (chat: WorldChatInfo): void =>
    run(async () => {
      if (chat.head === undefined || chat.head === null) return;
      const result = await app.request({ type: "lre.marker", chatId: chat.chatId, kind: "migrate", to: chat.head, preview: true });
      if (result?.preview?.upgrade) setSheet({ chat: chat.chatId, preview: result.preview.upgrade });
    });
  const takeBack = (chat: string): void =>
    run(async () => {
      const edit = undo[chat];
      if (edit === undefined) return;
      const result = await app.request({ type: "lre.world", op: "undo_upgrade", chatId: chat, edit });
      if (!result) return;
      app.toast(result.undone === true ? `${named(chat)} goes back to the revision it came from, from its next turn.` : (result.words ?? "Nothing was taken back."), "info");
      setUndo(({ [chat]: _taken, ...rest }) => rest);
      load();
    });
  return (
    <div data-lre-world-chats>
      <Section title="Chats" aside={<Badge>{chats.length}</Badge>} flush>
        <List>
          {chats.map((chat) => (
            <ListRow
              key={chat.chatId}
              icon="link"
              title={chat.name}
              subtitle={chat.reason ?? (chat.behind ? `Plays revision ${(chat.revision ?? "").slice(0, 8)}; the world has a newer one` : `Plays revision ${(chat.revision ?? "").slice(0, 8)}, the world's latest`)}
              badge={
                <>
                  {open?.chatId === chat.chatId ? <Badge tone="accent">This chat</Badge> : null}
                  {chat.behind ? <Badge tone="warn">Behind</Badge> : null}
                </>
              }
              chevron={chat.behind}
              disabled={busy || !chat.behind}
              onClick={chat.behind ? () => preview(chat) : undefined}
            />
          ))}
        </List>
      </Section>
      {Object.keys(undo).map((chat) => (
        <div key={chat} class="lre-inline" data-lre-upgrade-undo={chat}>
          <span class="lre-small lre-muted">{named(chat)} was moved on.</span>
          <Button size="sm" variant="ghost" icon="undo" disabled={busy} onClick={() => takeBack(chat)}>
            Undo the move
          </Button>
        </div>
      ))}
      {sheet ? (
        <UpgradePanel
          chatId={sheet.chat}
          preview={sheet.preview}
          onDone={(done) => {
            setSheet(null);
            if (done?.edit) setUndo((held) => ({ ...held, [sheet.chat]: done.edit ?? "" }));
            load();
          }}
        />
      ) : null}
    </div>
  );
}
