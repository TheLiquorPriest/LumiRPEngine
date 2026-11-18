// Storage (plan §14, §5.1, §5.5): what RPE keeps and how much, on disk and in the database: each kind with how
// many, how big, the oldest, how long it is kept (the setting that decides it opens on Settings) and when he last
// pruned; every chat, a page at a time, with its folder by area and its rows of the database; the notes agents
// lean on, each opening on Files; the backups and copies of the database; and pruning on request, told first
// exactly what will go and what stays, then taken on his yes. What RPE refuses is shown in its words.

import { useEffect, useRef, useState } from "preact/hooks";
import type { BackupShown, ChatStorageRow, SettingView, StorageKindRow, StoragePruneAsk } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Disclosure, PageHeader, Row, Section } from "../../../frontend/components";
import type { PageEntry } from "../../page-entry";
import { useUiSetting } from "../../ui-settings";
import { bytesWords, counted, when } from "../../words";
import { type MakingBackup, NO_STORAGE, type PruneShown, type StorageControl, storageCalls, storageControl, type StorageShown } from "./model";
import { valueWords } from "../settings/model";
import { useSettingMap } from "../settings/names";

export { NO_STORAGE, storageCalls, storageControl } from "./model";
export type { StorageShown } from "./model";

function KeptWords(props: { row: StorageKindRow; setting: SettingView | undefined; onSetting(key: string): void }) {
  const { kept } = props.row;
  const { setting } = props;
  if (kept.by === "never") return <span>RPE never removes it</span>;
  if (kept.by === "chat") return <span>kept until its chat is deleted or you prune it</span>;
  return (
    <span>
      kept as{" "}
      <Button size="sm" variant="ghost" title={kept.setting} onClick={() => props.onSetting(kept.setting)}>
        {setting === undefined ? "its setting" : setting.name}
      </Button>
      {setting === undefined ? "" : ` says: ${valueWords(setting, kept.value)}`}
    </span>
  );
}

function KindsSection(props: { shown: StorageShown; settings: ReadonlyMap<string, SettingView> | null; onSetting(key: string): void }) {
  const { kinds, kindsProblem } = props.shown;
  return (
    <Section title="What RPE keeps" id="kinds">
      {kindsProblem === null ? null : (
        <Banner tone="neg" icon="alert" title="The kinds could not be read">
          <span>{kindsProblem}</span>
        </Banner>
      )}
      {kinds === null ? (
        kindsProblem === null ? (
          <p class="lre-muted rpe-line">Reading what RPE keeps…</p>
        ) : null
      ) : (
        <div class="lre-stack" data-kinds>
          {kinds.kinds.map((row) => (
            <div key={row.kind} class="rpe-entry" data-kind={row.kind}>
              <Row k={row.name} v={`${counted(row.count, "item")} · ${bytesWords(row.bytes)}`} sub={row.oldest === null ? undefined : `the oldest from ${when(row.oldest)}`} />
              <p class="rpe-meta">
                <KeptWords row={row} setting={row.kept.by === "setting" ? props.settings?.get(row.kept.setting) : undefined} onSetting={props.onSetting} />
              </p>
            </div>
          ))}
          <p class="rpe-meta">{kinds.lastPrune === null ? "You have never pruned." : `You last pruned on ${when(kinds.lastPrune)}.`}</p>
        </div>
      )}
    </Section>
  );
}

/** One chat: its folder by area, its rows of the database, and what can be done with it. */
function ChatLine(props: { chat: ChatStorageRow; open: boolean; onNotes(chat: string | null): void; onPrune(ask: StoragePruneAsk, title: string): void }) {
  const { chat } = props;
  const deleted = chat.deleted != null;
  return (
    <li class="lre-stack rpe-entry" data-chat={chat.chat}>
      <Row k={chat.folder} v={bytesWords(chat.bytes)} sub={chat.rows === undefined ? undefined : `${bytesWords(chat.rows)} of the database`} />
      <p class="rpe-meta">
        Notes {bytesWords(chat.areas.notes)} · turns {bytesWords(chat.areas.turns)} · sessions {bytesWords(chat.areas.sessions)} · files {bytesWords(chat.areas.files)}
        {chat.measured == null ? " · not measured yet; its sizes come at the next read" : ""}
      </p>
      {deleted ? <Badge tone="warn">Lumiverse deleted this chat</Badge> : null}
      <div class="lre-inline rpe-wrap">
        <Button size="sm" variant="ghost" current={props.open} onClick={() => props.onNotes(props.open ? null : chat.chat)}>
          Its notes
        </Button>
        {deleted ? (
          <Button size="sm" variant="danger" onClick={() => props.onPrune({ what: "chat", chat: chat.chat }, `What is left of the deleted chat ${chat.folder}`)}>
            Prune what is left of it
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => props.onPrune({ what: "turns", chat: chat.chat }, `Old turn folders of ${chat.folder}`)}>
              Prune old turn folders
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onPrune({ what: "sessions", chat: chat.chat }, `Closed sessions' files of ${chat.folder}`)}>
              Prune closed sessions' files
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onPrune({ what: "versions", chat: chat.chat }, `Note versions of ${chat.folder} past how far back they are kept`)}>
              Prune note versions past what is kept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onPrune({ what: "suggestions", chat: chat.chat }, `Decided suggestions of ${chat.folder} past the number kept`)}>
              Prune decided suggestions past what is kept
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** What each kind of place a prune takes from is counted in, and the words that name a place that is no file (the plan's own path of one reads as a chat's id). */
const ITEM_WORDS: Readonly<Record<string, { unit: string; label: string | null }>> = {
  suggestions: { unit: "decided suggestion", label: "Decided suggestions past the number kept" },
  "note-versions": { unit: "note version", label: "Note versions past how far back they are kept" },
  "chat-rows": { unit: "database row", label: null },
  "derived-rows": { unit: "database row", label: null },
};

/** What a prune says when it finds nothing to take, by what it was asked to prune. */
const EMPTY: Readonly<Record<StoragePruneAsk["what"], string>> = {
  turns: "Nothing would go: nothing is old enough, or every turn and open session is still in use.",
  sessions: "Nothing would go: every session of the chat is open or in use.",
  chat: "Nothing would go: nothing of the deleted chat is left.",
  backup: "Nothing would go.",
  suggestions: "Nothing would go: no decided suggestion is past the number kept.",
  versions: "Nothing would go: no note version is past how far back they are kept.",
  rows: "Nothing would go: the deleted chat holds no rows.",
  derived: "Nothing would go: the chat holds no snapshots, vectors or caches.",
};

/** The unit a plan counts in: that of its places where they agree, else items. */
function unitOf(items: readonly { kind: string }[]): string {
  const units = new Set(items.map((item) => ITEM_WORDS[item.kind]?.unit ?? "file"));
  return units.size === 1 ? [...units][0] ?? "item" : "item";
}

function PruneQuestion(props: { prune: PruneShown; onConfirm(): void; onDismiss(): void }) {
  const { prune } = props;
  const plan = prune.done ?? prune.plan;
  return (
    <Banner tone={prune.done === null ? "warn" : "info"} icon={prune.done === null ? "alert" : "check"} title={prune.done === null ? `Prune: ${prune.title}` : "Pruned"}>
      <div class="lre-stack" data-prune>
        {prune.problem === null ? null : <span data-prune-problem>{prune.problem}</span>}
        {plan === null ? (
          prune.busy ? (
            <span>Asking RPE what it would take…</span>
          ) : null
        ) : plan.files === 0 && plan.items.length === 0 ? (
          <span>{prune.done === null ? EMPTY[prune.ask.what] : "It took nothing."}</span>
        ) : (
          <>
            <span>
              {prune.done === null ? "This would take" : "It took"} {counted(plan.files, unitOf(plan.items))}, {bytesWords(plan.bytes)}:
            </span>
            <ul class="rpe-reports">
              {plan.items.map((item) => (
                <li key={`${item.kind}-${item.path}`}>
                  {ITEM_WORDS[item.kind]?.label ?? item.path} · {counted(item.files, ITEM_WORDS[item.kind]?.unit ?? "file")} · {bytesWords(item.bytes)}
                </li>
              ))}
            </ul>
          </>
        )}
        <div class="lre-inline">
          {prune.done === null && plan !== null && (plan.files > 0 || plan.items.length > 0) ? (
            <Button variant="danger" busy={prune.busy} onClick={props.onConfirm}>
              Yes, prune exactly that
            </Button>
          ) : null}
          <Button variant="ghost" onClick={props.onDismiss}>
            {prune.done === null ? "No" : "Close"}
          </Button>
        </div>
      </div>
    </Banner>
  );
}

/** What a backup made now would hold, said before it is made, and what it made once it is. */
function BackupQuestion(props: { making: MakingBackup; onMake(): void; onDismiss(): void }) {
  const { making } = props;
  const { plan, made } = making;
  const links = (skipped: readonly string[]): string => (skipped.length === 0 ? "" : ` Left out, being links: ${skipped.join(", ")}.`);
  return (
    <Banner tone="info" icon={made === null ? "info" : "check"} title={made === null ? "Make a backup now" : "Backup made"}>
      <div class="lre-stack" data-making-backup>
        {making.problem === null ? null : <span data-backup-problem>{making.problem}</span>}
        {made !== null ? (
          <span>
            Made {made.name} in the backups folder: {bytesWords(made.bytes)}, the database and {counted(made.files, "file")} of the tree.{links(made.skipped)}
          </span>
        ) : plan === null ? (
          making.busy ? (
            <span>Asking RPE what it would make…</span>
          ) : null
        ) : (
          <span>
            This would make one archive, {plan.name}, in the backups folder: the database (up to {bytesWords(plan.database)}) and {counted(plan.files, "file")} of the tree, {bytesWords(plan.bytes)}.{links(plan.skipped)}
          </span>
        )}
        <div class="lre-inline">
          {made === null && plan !== null ? (
            <Button busy={making.busy} onClick={props.onMake}>
              Yes, make it
            </Button>
          ) : null}
          <Button variant="ghost" onClick={props.onDismiss}>
            {made === null ? "No" : "Close"}
          </Button>
        </div>
      </div>
    </Banner>
  );
}

function BackupsSection(props: { backups: readonly BackupShown[]; onPrune(ask: StoragePruneAsk, title: string): void; onAskBackup(): void }) {
  return (
    <Section title="Backups and copies of the database" id="backups">
      <div class="lre-inline rpe-wrap">
        <Button onClick={props.onAskBackup}>Make a backup now</Button>
      </div>
      {props.backups.length === 0 ? <p class="lre-muted rpe-line">The backups folder holds none yet.</p> : null}
      <ul class="rpe-plain lre-stack">
        {props.backups.map((b) => (
          <li key={b.name} class="rpe-entry" data-backup={b.name}>
            <Row k={b.name} v={bytesWords(b.bytes)} sub={`${b.kind === "copy" ? "a copy taken before a migration" : b.kind === "archive" ? "an archive rpe backup made" : "the migration's backup"} · ${when(b.at)}`} />
            <Button size="sm" variant="ghost" onClick={() => props.onPrune({ what: "backup", name: b.name }, `The backup ${b.name}`)}>
              Prune it
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export interface StorageViewProps {
  shown: StorageShown;
  /** The settings by key, as the Settings page declares them: the kinds that a setting decides name it and say its value as it reads now. Null until read. */
  settings?: ReadonlyMap<string, SettingView> | null;
  onSetting(key: string): void;
  onMore(): void;
  onNotes(chat: string | null): void;
  onOpenFile(chat: string, path: string): void;
  onPrune(ask: StoragePruneAsk, title: string): void;
  onConfirm(): void;
  onDismiss(): void;
  onAskBackup(): void;
  onMakeBackup(): void;
  onDismissBackup(): void;
}

export function StorageView(props: StorageViewProps) {
  const { shown } = props;
  const totals = shown.chats;
  return (
    <div class="lre-stack rpe-page" data-page="storage">
      <PageHeader title="Storage" subtitle="What RPE keeps, how much, and for how long." />
      {shown.prune === null ? null : <PruneQuestion prune={shown.prune} onConfirm={props.onConfirm} onDismiss={props.onDismiss} />}
      {shown.making === null ? null : <BackupQuestion making={shown.making} onMake={props.onMakeBackup} onDismiss={props.onDismissBackup} />}
      <KindsSection shown={shown} settings={props.settings ?? null} onSetting={props.onSetting} />
      <Section title="Everything" id="totals">
        {totals === null ? (
          <p class="lre-muted rpe-line">Reading what the tree takes…</p>
        ) : (
          <div>
            <Row k="Your own level" v={bytesWords(totals.global)} sub={`${bytesWords(totals.globalNotes)} of it notes every chat's agents read`} />
            <Row k="The shipped level" v={bytesWords(totals.shipped)} />
            <Row k="The database" v={bytesWords(totals.database)} sub={totals.rest === undefined ? undefined : `${bytesWords(totals.rest)} of it is no chat's`} />
          </div>
        )}
      </Section>
      <Section title="Chat by chat" id="chats">
        {shown.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="The chats could not be read">
            <span>{shown.problem}</span>
          </Banner>
        )}
        {totals === null ? null : totals.chats.length === 0 ? (
          <p class="lre-muted rpe-line">RPE keeps no chat's files.</p>
        ) : (
          <ul class="rpe-plain lre-stack" data-chats>
            {totals.chats.map((chat) => (
              <ChatLine key={chat.chat} chat={chat} open={shown.chat === chat.chat} onNotes={props.onNotes} onPrune={props.onPrune} />
            ))}
          </ul>
        )}
        {shown.more ? (
          <Button busy={shown.loading} onClick={props.onMore}>
            More chats
          </Button>
        ) : null}
      </Section>
      {shown.chat === null ? null : (
        <Section title="The notes agents lean on" id="notes">
          {shown.notesProblem === null ? null : (
            <Banner tone="neg" icon="alert" title="The notes could not be read">
              <span>{shown.notesProblem}</span>
            </Banner>
          )}
          {shown.notes === null ? (
            shown.notesProblem === null ? (
              <p class="lre-muted rpe-line">Reading its notes…</p>
            ) : null
          ) : (
            <div class="lre-stack" data-notes>
              {([["The largest", shown.notes.largest], ["The most rewritten", shown.notes.rewritten]] as const).map(([title, list]) => (
                <Disclosure key={title} defaultOpen summary={title}>
                  <ul class="rpe-plain lre-stack">
                    {list.length === 0 ? <li class="lre-muted rpe-line">None.</li> : null}
                    {list.map((note) => (
                      <li key={note.path} data-note={note.path}>
                        <Button size="sm" variant="ghost" onClick={() => props.onOpenFile(shown.chat as string, note.path)}>
                          {note.path}
                        </Button>
                        <span class="rpe-meta">
                          {" "}
                          {bytesWords(note.bytes)} · written {counted(note.writes, "time")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ))}
            </div>
          )}
        </Section>
      )}
      <BackupsSection backups={shown.backups?.items ?? []} onPrune={props.onPrune} onAskBackup={props.onAskBackup} />
    </div>
  );
}

export function StoragePage() {
  const app = useApp();
  const [shown, setShown] = useState<StorageShown>(NO_STORAGE);
  const settings = useSettingMap();
  const [control, setControl] = useState<StorageControl | null>(null);
  const perPage = useUiSetting("chatsAtATime");
  const limit = useRef(perPage);
  limit.current = perPage;
  useEffect(() => {
    const made = storageControl(storageCalls(app.client), () => limit.current, setShown);
    setControl(made);
    return () => made.stop();
  }, []);
  return (
    <StorageView
      shown={shown}
      settings={settings}
      onSetting={(key) => app.go({ page: "settings", chat: app.route.get().chat ?? null, at: [key] })}
      onMore={() => control?.more()}
      onNotes={(chat) => control?.notes(chat)}
      onOpenFile={(chat, path) => app.go({ page: "files", chat, at: [path] })}
      onPrune={(ask, title) => control?.ask(ask, title)}
      onConfirm={() => control?.confirm()}
      onDismiss={() => control?.dismiss()}
      onAskBackup={() => control?.askBackup()}
      onMakeBackup={() => control?.makeBackup()}
      onDismissBackup={() => control?.dismissBackup()}
    />
  );
}

export const entry: PageEntry = { id: "storage", title: "Storage", icon: "box", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 120, render: () => <StoragePage /> };
