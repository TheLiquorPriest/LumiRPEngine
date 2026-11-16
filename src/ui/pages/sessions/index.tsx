// Sessions (plan §11, §14): a chat's sessions as the Author's working memory between turns. Each scene of the story is a session, newest first,
// open or closed, with the turn that closed it and whether the close was his; the sessions of the sub-agents, jobs and talks it ran sit
// beneath the turn that started them. The list sits beside the session open at desktop width and gives way to it, with Back, on a phone; the
// open session is in the address (`sessions/<id>`). What each carries, its compactions, Close and Compact now are in `open.tsx`.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { SessionShown, StoryItemRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Empty, PageHeader } from "../../atoms";
import type { PageEntry } from "../../page-entry";
import { usePaged, useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, when } from "../../words";
import { parentWords, SessionOpen } from "./open";
import { replyOf } from "../../client";

export { parentWords } from "./open";

/** The scenes' own names by their id, from the story record's timeline. */
export type SceneNames = ReadonlyMap<string, string>;

function words(item: StoryItemRow): string | null {
  for (const key of ["name", "title", "summary"]) {
    const value = item.fields[key];
    if (typeof value === "string" && value.trim() !== "") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  return null;
}

/** A session's name: a scene's by the record's own word, the rest by their agent and kind. */
export function sessionName(session: SessionShown, scenes: SceneNames, ordinal: number): string {
  if (session.kind === "scene") return (session.scene === undefined ? undefined : scenes.get(session.scene)) ?? `Scene ${ordinal}`;
  return `${session.agent ?? session.kind}, ${session.kind === "agent" ? "a sub-agent's run" : session.kind === "job" ? "a job's run" : "a talk"}`;
}

function SessionLine(props: { session: SessionShown; name: string; open: boolean; onOpen(): void }) {
  const { session } = props;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-session-line={session.id} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{props.name}</span>
            <span class="lre-listrow-sub lre-num">
              {counted(session.turns, "turn")} · opened {when(session.opened)}
              {session.state === "closed" ? (session.by === "user" ? " · you closed it" : session.closedBy === undefined ? "" : " · closed by a turn") : ""}
              {session.from === undefined ? "" : " · forked"}
              {parentWords(session) === "" ? "" : ` · ${parentWords(session)}`}
            </span>
          </span>
          <span class="lre-inline">
            {session.offPath === true ? <Badge>off the path</Badge> : null}
            {session.compactAsked === true ? <Badge tone="warn">compaction asked</Badge> : null}
            <Badge tone={session.state === "open" ? "pos" : undefined}>{session.state}</Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

export interface SessionsViewProps {
  sessions: readonly SessionShown[];
  scenes: SceneNames;
  openId: string | null;
  loading: boolean;
  problem: string | null;
  onOpen(id: string | null): void;
  /** The open session, drawn. */
  children?: ComponentChildren;
}

/** Scenes newest first, then the other sessions grouped under the turn that started them. */
export function groupSessions(sessions: readonly SessionShown[]): { scenes: SessionShown[]; others: { turn: string | null; sessions: SessionShown[] }[] } {
  const scenes = sessions.filter((s) => s.kind === "scene").sort((a, b) => b.opened - a.opened);
  const by = new Map<string | null, SessionShown[]>();
  for (const s of sessions.filter((x) => x.kind !== "scene").sort((a, b) => b.opened - a.opened)) {
    const turn = s.parent === undefined || "owner" in s.parent ? null : (s.parent.turn ?? null);
    by.set(turn, [...(by.get(turn) ?? []), s]);
  }
  return { scenes, others: [...by].map(([turn, list]) => ({ turn, sessions: list })) };
}

export function SessionsView(props: SessionsViewProps) {
  const groups = groupSessions(props.sessions);
  const ordinals = new Map(props.sessions.filter((s) => s.kind === "scene").sort((a, b) => a.opened - b.opened).map((s, i) => [s.id, i + 1]));
  return (
    <div class="lre-stack rpe-page" data-page="sessions">
      <PageHeader
        title="Sessions"
        sub="What the Author remembers between turns, scene by scene."
        {...(props.openId === null ? {} : { back: { label: "All sessions", go: () => props.onOpen(null) } })}
      />
      {props.problem === null ? null : <p class="rpe-line" data-sessions-problem>{props.problem}</p>}
      <div class="rpe-files-split" data-open={props.openId === null ? "no" : "yes"}>
        <div class="rpe-files-browser lre-stack">
          {props.sessions.length === 0 && !props.loading ? (
            <Empty icon="layers" title="No session yet">
              <span>A session opens with the first turn of a scene.</span>
            </Empty>
          ) : (
            <>
              <ul class="lre-list" data-scenes>
                {groups.scenes.map((s) => (
                  <SessionLine key={s.id} session={s} name={sessionName(s, props.scenes, ordinals.get(s.id) ?? 0)} open={props.openId === s.id} onOpen={() => props.onOpen(s.id)} />
                ))}
              </ul>
              {groups.others.map((g) => (
                <details key={g.turn ?? "none"} class="lre-disclosure" data-under={g.turn ?? "none"}>
                  <summary>
                    <span class="lre-disclosure-label">{g.turn === null ? "Started by him, or by no turn" : "Started in a turn"} · {counted(g.sessions.length, "session")}</span>
                  </summary>
                  <ul class="lre-list">
                    {g.sessions.map((s) => (
                      <SessionLine key={s.id} session={s} name={sessionName(s, props.scenes, 0)} open={props.openId === s.id} onOpen={() => props.onOpen(s.id)} />
                    ))}
                  </ul>
                </details>
              ))}
            </>
          )}
          {props.loading ? <p class="lre-muted rpe-line">Reading the sessions…</p> : null}
        </div>
        {props.openId === null ? null : <div class="lre-stack rpe-open-session">{props.children}</div>}
      </div>
    </div>
  );
}

export function SessionsPage(props: { chat: string; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const [changed, setChanged] = useState<ReadonlyMap<string, SessionShown>>(new Map());
  const perPage = useUiSetting("rowsAtOnce");
  const list = usePaged((cursor) => app.client.call("GET /api/v1/chats/:chat/sessions", { chat }, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }), [chat]);
  // The route lists in the order opened; the newest are shown first, so the list is read to its end.
  useEffect(() => {
    if (list.more && !list.loading && list.problem === null) list.older();
  }, [list.more, list.loading, list.problem, list.items.length]);
  const story = useRead(() => app.client.call("GET /api/v1/chats/:chat/story", { chat }).then((answer) => replyOf(answer)), [chat]);
  const scenes: SceneNames = new Map((story.value?.timeline.scene.items ?? []).flatMap((item) => {
    const name = words(item);
    return name === null ? [] : [[item.id, name] as const];
  }));
  const openId = props.at?.[0] ?? null;
  const items = list.items.map((s) => changed.get(s.id) ?? s);
  const open = openId === null ? null : (items.find((s) => s.id === openId) ?? null);
  const go = (id: string | null): void => app.go({ page: "sessions", chat, at: id === null ? [] : [id] });
  return (
    <SessionsView sessions={items} scenes={scenes} openId={openId} loading={list.loading} problem={list.problem} onOpen={go}>
      {open === null ? (
        <p class="lre-muted rpe-line">{list.loading || list.more ? "Reading the sessions…" : "That session is not on this chat."}</p>
      ) : (
        <SessionOpen
          key={open.id}
          chat={chat}
          session={open}
          onChanged={(next) => setChanged((held) => new Map(held).set(next.id, next))}
          onTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })}
        />
      )}
    </SessionsView>
  );
}

export const entry: PageEntry = { id: "sessions", title: "Sessions", icon: "layers", shells: ["web", "drawer"], needsChat: true, often: false, order: 35, render: (route) => <SessionsPage chat={route.chat} at={route.at} /> };
