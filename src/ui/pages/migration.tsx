// Migration (plan §14, §15.5, §15.6): what the last run of the migration left, once one has run: its
// report as the run printed it, each chat with what came of it and its check against today's fold, the
// backup and whether it is still there, what is waiting on the user, and the steps of going back with
// the permissions the previous build asks for, in RPE's own words; what became of each world it carried
// into Build; and the offer to start the bootstrap for every chat it carried. Before any run, one line
// says none has.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { MigrationChatRow, MigrationReply, WaitingOnUser } from "../../shared/api";
import { useApp } from "../app";
import { Badge, Banner, Fold, PageHeader, Pre, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { bytesWords, counted, errorWords } from "../words";
import { CarriedOffer } from "./bootstrap";
import type { PageEntry } from "../page-entry";

/** The page's one read: RPE's answer, or its refusal in its own words. */
export interface MigrationRead {
  shown: MigrationReply | null;
  loading: boolean;
  problem: string | null;
}

export const NO_MIGRATION: MigrationRead = { shown: null, loading: true, problem: null };

/** Reads what the last run left; what comes back after the returned function is called (the page has left) is let go. */
export function readMigration(client: Pick<RpeClient, "call">, onRead: (read: MigrationRead) => void): () => void {
  let alive = true;
  client.call("GET /api/v1/migration", {}).then(
    (shown) => {
      if (alive) onRead({ shown, loading: false, problem: null });
    },
    (error: unknown) => {
      if (alive) onRead({ shown: null, loading: false, problem: errorWords(error) });
    },
  );
  return () => {
    alive = false;
  };
}

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** One thing waiting on the user, in words. */
export function waitingWords(w: WaitingOnUser): string {
  if (w.kind === "guidance") return `Your GUIDANCE.md is at ${w.path}, switched off.`;
  if (w.kind === "connection") return `The setting ${w.setting} names ${w.connection}, a connection in Lumiverse: pick one of RPE's for it.`;
  if (w.kind === "own") return `Your own ${andList([counted(w.agents, "agent"), counted(w.skills, "skill"), counted(w.texts, "text")])} are attached and switched off.`;
  if (w.kind === "filing") return `Chat ${w.chat}: the mind files of ${counted(w.characters, "character")}${w.notes ? ", and its notes," : ""} are attached and not yet filed.`;
  const parts = [
    w.questions > 0 ? counted(w.questions, "edit waiting on keep or discard", "edits waiting on keep or discard") : null,
    w.staged > 0 ? counted(w.staged, "staged action") : null,
    w.chips > 0 ? counted(w.chips, "chip") : null,
    w.reviewCards > 0 ? counted(w.reviewCards, "review card") : null,
    w.rollback ? "a rollback never applied" : null,
  ].filter((part) => part !== null);
  return `Chat ${w.chat}: ${andList(parts)}.`;
}

/** A chat as the last run left it: what came of it, and for one it imported, its turns and its check, each place it differed in the report's own words. */
function ChatItem(props: { chat: MigrationChatRow }) {
  const c = props.chat;
  const imported = c.outcome === "imported" || c.outcome === "replaced";
  const m = c.check.matched;
  const clean = m.head && c.check.differences.length === 0;
  return (
    <li class="lre-stack rpe-migrated" data-chat={c.chat}>
      <div class="lre-inline">
        <span class="rpe-strong">{c.chat}</span>
        <Badge tone={imported ? (clean ? "pos" : "warn") : undefined}>{c.outcome}</Badge>
      </div>
      {c.why === null ? null : <p class="rpe-meta">{c.why}</p>}
      {imported ? (
        <p class="rpe-line">
          {counted(c.turns, "turn")} imported · matched at the head: {m.head ? "yes" : "no"}, at {m.swipes} of {m.of} swipes
          {c.shares === null ? "" : ` · shares ${counted(c.shares.messages, "message")} with ${c.shares.chat}`}
        </p>
      ) : null}
      {c.check.differences.length === 0 ? null : (
        <ul class="rpe-reports">
          {c.check.differences.map((d, i) => (
            <li key={i}>
              {d.kept ? "differs" : "differs (not kept: the turn is the chat it was made from's)"} at {d.at === "head" ? "the head" : `message ${d.at.message}, swipe ${d.at.swipe}`}: {d.values.join(", ")}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MigrationView(props: { read: MigrationRead; offer?: ComponentChildren }) {
  const { shown, loading, problem } = props.read;
  return (
    <div class="lre-stack rpe-page" data-page="migration">
      <PageHeader title="Migration" sub="What the last run of the migration left, and going back." />
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The migration's report could not be read">
          <span>{problem}</span>
        </Banner>
      )}
      {shown === null ? (
        loading ? (
          <p class="lre-muted rpe-line">Reading the migration's report…</p>
        ) : null
      ) : shown.text === null ? (
        <p class="rpe-line">No migration has run.</p>
      ) : (
        <>
          <Fold summary="The report, as the run printed it">
            <Pre text={shown.text} />
          </Fold>
          <Section title={`Chats (${shown.chats.length})`} id="chats">
            {shown.chats.length === 0 ? (
              <p class="lre-muted rpe-line">The run imported no chat.</p>
            ) : (
              <ul class="lre-stack rpe-plain">
                {shown.chats.map((c) => (
                  <ChatItem key={c.chat} chat={c} />
                ))}
              </ul>
            )}
          </Section>
          {props.offer === undefined || !shown.chats.some((c) => c.outcome === "imported" || c.outcome === "replaced") ? null : props.offer}
          <Section title="The backup" id="backup">
            {shown.backup === null ? (
              <p class="lre-muted rpe-line">The report names no backup.</p>
            ) : (
              <>
                <Row label="Where" value={shown.backup.path} />
                <Row label="Size" value={bytesWords(shown.backup.bytes)} />
                <Row label="SHA-256" value={<code class="rpe-hash">{shown.backup.sha256}</code>} />
                <Row label="Still there, at that size" value={shown.backup.present ? "yes" : "no"} />
              </>
            )}
          </Section>
          <Section title={`Waiting on you (${shown.waiting.length})`} id="waiting">
            {shown.waiting.length === 0 ? (
              <p class="lre-muted rpe-line">Nothing is waiting on you.</p>
            ) : (
              <ul class="rpe-reports">
                {shown.waiting.map((w, i) => (
                  <li key={i}>{waitingWords(w)}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Going back" id="going-back">
            <ul class="lre-stack rpe-plain">
              {shown.goingBack.steps.map((step, i) => (
                <li key={i} class="rpe-line">
                  {step}
                </li>
              ))}
            </ul>
            <p class="rpe-meta">The permissions the previous build asks for, to approve again ({shown.goingBack.permissions.length}):</p>
            <ul class="rpe-files" data-permissions="true">
              {shown.goingBack.permissions.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

export function MigrationPage() {
  const app = useApp();
  const [read, setRead] = useState<MigrationRead>(NO_MIGRATION);
  useEffect(() => readMigration(app.client, setRead), []);
  return <MigrationView read={read} offer={<CarriedOffer />} />;
}

export const entry: PageEntry = { id: "migration", title: "Migration", icon: "download", shells: ["web", "drawer"], needsChat: false, often: false, order: 130, render: () => <MigrationPage /> };
