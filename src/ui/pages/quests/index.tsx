// The Quests page (plan §14 Quests, §8.3): every quest, secret, puzzle and agenda as the Author keeps it, behind the spoiler gate, and, outside it, the
// journal he sees, drawn from those records with only what each quest lets him see. The records are read, a page at a time, only while the chat's gate
// is open; the journal is always read, for the route gives him nothing he may not see. Both are read again when the chat's live view says a run
// began or ended or the state changed.

import { useEffect, useState } from "preact/hooks";
import type { QuestRecordRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Button, Empty, Gated, PageHeader, Section } from "../../../frontend/components";
import { replyOf } from "../../client";
import { onChatChange } from "../../live-watch";
import type { PageEntry } from "../../page-entry";
import { usePaged, useRead } from "../../reading";
import { useSelect } from "../../store";
import { useUiSetting } from "../../ui-settings";
import { JournalView, KIND_WORDS } from "./journal";
import { QuestOpen } from "./record";

export { KIND_WORDS, stageWords } from "./journal";
export { shownWords } from "./record";

const GATE_WHY = "The Author's records of a quest, its stages' conditions, the reasons given and who and where it involves, can give away what comes next.";

export function QuestLine(props: { quest: QuestRecordRow; open: boolean; onOpen(): void }) {
  const { quest } = props;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-quest-line={quest.id} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{quest.name}</span>
            <span class="lre-listrow-sub">{quest.objective ?? "it says no objective"}</span>
          </span>
          <span class="lre-inline">
            <Badge>{KIND_WORDS[quest.kind]}</Badge>
            {quest.open ? <Badge tone="accent">open</Badge> : <Badge tone="warn">closed</Badge>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function QuestsPage(props: { chat: string; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const [stamp, setStamp] = useState(0);
  useEffect(() => onChatChange(app.client, chat, () => setStamp((n) => n + 1)), [chat]);
  const journal = useRead(() => app.client.call("GET /api/v1/chats/:chat/journal", { chat }).then(replyOf), [chat, stamp]);
  const list = usePaged(
    gate ? (cursor) => app.client.call("GET /api/v1/chats/:chat/quests", { chat }, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }) : null,
    [chat, stamp, gate],
  );
  const id = props.at?.[0] ?? null;
  const go = (to: string | null): void => app.go({ page: "quests", chat, at: to === null ? [] : [to] });
  return (
    <div class="lre-stack rpe-page" data-page="quests">
      <PageHeader title="Quests" subtitle="The quests as the Author keeps them, and what he sees of them in his journal." {...(id === null ? {} : { onBack: () => go(null), backLabel: "all quests" })} />
      {id !== null && gate ? null : <JournalView journal={journal.value} loading={journal.loading} problem={journal.problem} />}
      <Gated open={gate} onOpen={() => app.gate.open(chat)} onClose={() => app.gate.close(chat)} why={GATE_WHY}>
        <div class="rpe-files-split" data-open={id === null ? "no" : "yes"}>
          <div class="rpe-files-browser lre-stack">
            {list.problem === null ? null : <p class="rpe-line" data-problem>{list.problem}</p>}
            {list.items.length === 0 && !list.loading && list.problem === null ? (
              <Empty icon="checklist" title="No quest">
                <span>The record holds no quest of this chat yet.</span>
              </Empty>
            ) : (
              <Section id="records" title="The Author's records">
                <ul class="lre-list" data-quests>
                  {list.items.map((q) => (
                    <QuestLine key={q.id} quest={q} open={id === q.id} onOpen={() => go(q.id)} />
                  ))}
                </ul>
                {list.more ? (
                  <Button busy={list.loading} onClick={list.older}>
                    More quests
                  </Button>
                ) : null}
              </Section>
            )}
          </div>
          {id === null ? null : (
            <div class="lre-stack rpe-open-session">
              <QuestOpen key={id} chat={chat} quest={id} stamp={stamp} onTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })} />
            </div>
          )}
        </div>
      </Gated>
    </div>
  );
}

export const entry: PageEntry = { id: "quests", title: "Quests", icon: "checklist", shells: ["web", "drawer"], needsChat: true, often: false, order: 62, render: (route) => <QuestsPage chat={route.chat} at={route.at} /> };
