// A chat by the name the Chats page gives it, for the Migration page's lists, which hold chats by their ids. The names are read
// once from the route the Chats page reads (`GET /api/v1/chats`): a chat RPE holds has one, a chat it does not hold has none and
// is shown by its id. The name opens the chat, as it does on the Chats page; the id stays beside it, small, or as its tooltip.

import { useEffect, useState } from "preact/hooks";
import { Button } from "../../frontend/components";
import { useApp } from "../app";

/** The name the Chats page gives a chat (its id where Lumiverse gives it none); null where RPE holds no such chat. */
export type ChatNames = (chat: string) => string | null;

/** Reads the names of the chats RPE holds, once, as the Chats page reads them. */
export function useChatNames(): ChatNames {
  const app = useApp();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    app.client.call("GET /api/v1/chats", {}).then(
      (list) => {
        if (alive) setNames(new Map(list.chats.map((c) => [c.id, c.name === "" ? c.id : c.name])));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return (chat) => names.get(chat) ?? null;
}

/** A chat's name in a sentence: pressed to open the chat, with its id as the tooltip; the id itself where no name is known. */
export function ChatName(props: { chat: string; name: string | null; onOpen?(chat: string): void }) {
  const { chat, name, onOpen } = props;
  if (name === null) return <>{chat}</>;
  if (onOpen === undefined) return <span title={chat}>{name}</span>;
  return (
    <Button size="sm" variant="ghost" title={chat} onClick={() => onOpen(chat)}>
      {name}
    </Button>
  );
}

/** A chat in a list: its name, pressed to open the chat, with its id small beside it; the id alone where no name is known. */
export function ChatLabel(props: { chat: string; name: string | null; onOpen?(chat: string): void }) {
  const { chat, name, onOpen } = props;
  if (name === null) return <span class="rpe-strong">{chat}</span>;
  const label = (
    <span class="rpe-strong">
      <ChatName chat={chat} name={name} {...(onOpen === undefined ? {} : { onOpen })} />
    </span>
  );
  if (name === chat) return label;
  return (
    <span class="lre-inline rpe-wrap">
      {label}
      <span class="rpe-meta">{chat}</span>
    </span>
  );
}

/** No chat has a name: each is shown by its id. */
export const NO_NAMES: ChatNames = () => null;
