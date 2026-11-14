// The web shell's first page: the chats RPE plays, the most recently played first. In Lumiverse's drawer
// the chat is the one Lumiverse shows, so this page is the web shell's alone.

import { useEffect, useState } from "preact/hooks";
import type { ChatSummary } from "../api";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, PageHeader } from "../atoms";
import { errorWords, when } from "../words";

export interface ChatsViewProps {
  chats: readonly ChatSummary[] | null;
  problem: string | null;
  onOpen(chat: string): void;
  /** The chat's panels, on the Play page: offered beside every chat the list does not say has no world (Play says so of one that has none). */
  onPlay(chat: string): void;
  onRead(): void;
}

export function ChatsView(props: ChatsViewProps) {
  return (
    <div class="lre-stack rpe-page" data-page="chats">
      <PageHeader title="Chats" sub="The chats RPE plays. Pick one to watch its turns." />
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The chats could not be read" actions={<Button onClick={props.onRead}>Try again</Button>}>
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.chats === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">Reading the chats…</p> : null
      ) : props.chats.length === 0 ? (
        <Empty icon="message" title="No chats yet">
          <span>A chat shows here once RPE plays a reply in it.</span>
        </Empty>
      ) : (
        <div class="lre-section flush">
          <ul class="lre-section-body lre-rowlist">
            {props.chats.map((chat) => (
              <li key={chat.id} class="lre-listrow">
                <button type="button" class="lre-listrow-hit" onClick={() => props.onOpen(chat.id)} data-chat={chat.id}>
                  <span class="lre-listrow-content">
                    <span class="lre-listrow-text">
                      <span class="lre-listrow-title">{chat.name}</span>
                      <span class="lre-listrow-sub">{chat.lastTurnAt === null ? "Imported, not played on RPE yet" : `Last turn ${when(chat.lastTurnAt)}`}</span>
                    </span>
                    {chat.running ? <Badge tone="accent">running</Badge> : null}
                  </span>
                </button>
                {chat.world === false ? null : (
                  <div class="lre-inline">
                    <Button small kind="ghost" title={`Play ${chat.name}`} onClick={() => props.onPlay(chat.id)}>
                      Play
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ChatsPage() {
  const app = useApp();
  const [state, setState] = useState<{ chats: ChatSummary[] | null; problem: string | null; reads: number }>({ chats: null, problem: null, reads: 0 });
  useEffect(() => {
    let alive = true;
    app.client.call("GET /api/v1/chats", {}).then(
      (list) => {
        if (alive) setState((s) => ({ ...s, chats: list.chats, problem: null }));
      },
      (error: unknown) => {
        if (alive) setState((s) => ({ ...s, problem: errorWords(error) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [state.reads]);
  return <ChatsView chats={state.chats} problem={state.problem} onOpen={(chat) => app.go({ page: "live", chat })} onPlay={(chat) => app.go({ page: "play", chat })} onRead={() => setState((s) => ({ ...s, reads: s.reads + 1 }))} />;
}
