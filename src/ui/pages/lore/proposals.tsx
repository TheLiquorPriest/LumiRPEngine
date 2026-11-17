// What his agents drafted for his lore, and what RPE wrote there (plan §9.5, §14 Lore): the proposals waiting on him, each with
// the passage as it stands beside what would replace it, approved as drafted or with his edits, or rejected; a proposal the
// entry's change made stale is refused in the route's own words and stays on the page, said so. Under them every write RPE made to
// his lore, newest first, each put back on his word after a question that says what that does. Nothing here writes by itself.

import { useState } from "preact/hooks";
import type { LoreProposal, LoreWrite } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../../frontend/components";
import { usePaged } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords, when } from "../../words";

const REFUSED_WORDS: Readonly<Record<NonNullable<LoreProposal["refused"]>, string>> = {
  changed: "the entry changed after the draft was made",
  missing: "the entry is gone",
  draft: "a draft of your own of the world stands uncommitted",
};

/** What a proposal is, in a line. */
export function proposalWords(p: LoreProposal): string {
  const what = p.target === null ? `a new entry${p.title === null ? "" : ` “${p.title}”`}${p.book === null ? "" : ` for the book ${p.book}`}` : `an edit of the entry ${p.target}`;
  return `${p.agent} drafted ${what}${p.world === null ? "" : ` in the world ${p.world}`}`;
}

/** The body an approval sends: only what he changed of the draft, so an unedited approval sends nothing of the draft's own. */
export function approvalOf(p: LoreProposal, edited: { text: string; title: string; keys: string; book: string }): { text?: string; title?: string; keys?: string[]; book?: string } {
  const keys = edited.keys.split(",").map((k) => k.trim()).filter((k) => k !== "");
  const was = p.keys ?? [];
  return {
    ...(edited.text !== p.text ? { text: edited.text } : {}),
    ...(p.target === null && edited.title !== (p.title ?? "") ? { title: edited.title } : {}),
    ...(p.target === null && (keys.length !== was.length || keys.some((k, i) => k !== was[i])) ? { keys } : {}),
    ...(p.target === null && edited.book !== (p.book ?? "") ? { book: edited.book } : {}),
  };
}

export interface ProposalDecided {
  proposal: LoreProposal;
  /** The write an approval made. */
  write: LoreWrite | null;
}

function ProposalCard(props: { p: LoreProposal; onDecided(done: ProposalDecided): void; onTurn(turn: string): void }) {
  const app = useApp();
  const { p } = props;
  const open = p.status === "open";
  const [text, setText] = useState(p.text);
  const [title, setTitle] = useState(p.title ?? "");
  const [keys, setKeys] = useState((p.keys ?? []).join(", "));
  const [book, setBook] = useState(p.book ?? "");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const edited = approvalOf(p, { text, title, keys, book });
  const changed = Object.keys(edited).length > 0;
  const decide = (what: "approve" | "reject"): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    const finish = (done: ProposalDecided): void => {
      setBusy(null);
      props.onDecided(done);
    };
    const fail = (error: unknown): void => {
      setBusy(null);
      setProblem(errorWords(error));
    };
    if (what === "approve") app.client.call("POST /api/v1/lore/proposals/:id/approve", { id: String(p.id) }, { body: edited }).then((answer) => finish({ proposal: answer.proposal, write: answer.write }), fail);
    else app.client.call("POST /api/v1/lore/proposals/:id/reject", { id: String(p.id) }).then((answer) => finish({ proposal: answer.proposal, write: null }), fail);
  };
  return (
    <li class="lre-stack rpe-entry" data-proposal={p.id} data-status={p.status}>
      <p class="rpe-line">
        <strong>{proposalWords(p)}</strong> <Badge tone={p.status === "open" ? "warn" : p.status === "approved" ? "pos" : undefined}>{p.status}</Badge>
      </p>
      <p class="rpe-meta">
        {when(p.created)}
        {p.decided === null ? "" : ` · decided ${when(p.decided)}`}
        {p.turn === null ? "" : " · from "}
        {p.turn === null ? null : (
          <Button size="sm" variant="ghost" onClick={() => props.onTurn(p.turn as string)}>
            its turn
          </Button>
        )}
      </p>
      <p class="rpe-line" data-reason>{p.reason}</p>
      {p.refused === null ? null : (
        <Banner tone="warn" icon="alert" title="Refused">
          <span data-refused>Not written: {REFUSED_WORDS[p.refused]}. It stays here, as drafted.</span>
        </Banner>
      )}
      {p.was === null ? null : (
        <div class="lre-stack" data-was>
          <span class="rpe-caption">The passage as it stands</span>
          <p class="rpe-pre">{p.was}</p>
        </div>
      )}
      {open ? (
        <div class="lre-stack">
          {p.target !== null ? null : (
            <>
              <label class="lre-field">
                <span class="label">Book</span>
                <input class="lre-input" value={book} spellcheck={false} onInput={(e) => setBook((e.currentTarget as HTMLInputElement).value)} />
              </label>
              <label class="lre-field">
                <span class="label">Title</span>
                <input class="lre-input" value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
              </label>
              <label class="lre-field">
                <span class="label">Keys, separated by commas</span>
                <input class="lre-input" value={keys} onInput={(e) => setKeys((e.currentTarget as HTMLInputElement).value)} />
              </label>
            </>
          )}
          <label class="lre-field">
            <span class="label">{p.target === null ? "Its text" : p.was === null ? "What would replace the entry's text" : "What would replace it"}</span>
            <textarea class="lre-input" rows={6} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          <div class="lre-inline rpe-wrap">
            <Button busy={busy === "approve"} onClick={() => decide("approve")}>
              {changed ? "Approve with my edits" : "Approve"}
            </Button>
            <Button variant="ghost" busy={busy === "reject"} onClick={() => decide("reject")}>
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div class="lre-stack" data-text>
          <span class="rpe-caption">{p.status === "approved" ? "What was written" : "What it drafted"}</span>
          <p class="rpe-pre">{p.text}</p>
        </div>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </li>
  );
}

/** The proposals of the chat (or every chat's), the open ones first and the decided ones read on request. */
export function ProposalsSection(props: { chat: string; onTurn(turn: string): void; onWritten(): void }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const [all, setAll] = useState(false);
  const [decided, setDecided] = useState(false);
  const [done, setDone] = useState<ProposalDecided | null>(null);
  const list = usePaged(
    (cursor) =>
      app.client.call("GET /api/v1/lore/proposals", {}, { query: { ...(all ? {} : { chat }), status: decided ? "approved" : "open", limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }),
    [chat, all, decided],
  );
  const shown = done === null ? list.items : list.items.filter((p) => p.id !== done.proposal.id);
  return (
    <Section
      id="proposals"
      title="Proposals waiting on you"
      aside={
        <div class="lre-inline">
          <Button size="sm" variant="ghost" current={!all} onClick={() => setAll(false)}>
            This chat's
          </Button>
          <Button size="sm" variant="ghost" current={all} onClick={() => setAll(true)}>
            Every chat's
          </Button>
        </div>
      }
    >
      <div class="lre-inline">
        <Button size="sm" variant="ghost" current={!decided} onClick={() => setDecided(false)}>
          Waiting
        </Button>
        <Button size="sm" variant="ghost" current={decided} onClick={() => setDecided(true)}>
          Approved
        </Button>
      </div>
      {done === null ? null : (
        <Banner tone="info" icon="check" title={done.write === null ? "Rejected" : "Written"}>
          <span data-done>
            {done.write === null ? "Nothing was written." : `Written to ${done.write.world === null ? "your Lumiverse book" : "your world, as its next revision"}; it is among the writes below, where you can put it back.`}
          </span>
        </Banner>
      )}
      {list.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The proposals could not be read">
          <span>{list.problem}</span>
        </Banner>
      )}
      {shown.length === 0 && !list.loading && list.problem === null ? (
        <p class="lre-muted rpe-line" data-proposals-none>{decided ? "Nothing approved yet." : "No proposal is waiting."}</p>
      ) : (
        <ul class="rpe-plain lre-stack" data-proposals>
          {shown.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              onTurn={props.onTurn}
              onDecided={(result) => {
                setDone(result);
                if (result.write !== null) props.onWritten();
                list.again();
              }}
            />
          ))}
        </ul>
      )}
      {list.more ? (
        <Button busy={list.loading} onClick={list.older}>
          More proposals
        </Button>
      ) : null}
    </Section>
  );
}

function fieldsWords(f: LoreWrite["before"]): string {
  return f === null ? "nothing" : `“${f.comment}” (${counted(f.keys.length, "key")}): ${f.content}`;
}

function WriteCard(props: { w: LoreWrite; onPutBack(done: { write: LoreWrite; of: LoreWrite }): void }) {
  const app = useApp();
  const { w } = props;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const putBack = (): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/lore/writes/:id/put-back", { id: String(w.id) }).then(
      (answer) => {
        setBusy(false);
        setAsking(false);
        props.onPutBack(answer);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const kind = w.kind === "create" ? "made an entry" : w.kind === "edit" ? "changed an entry" : `put write ${w.of} back`;
  return (
    <li class="rpe-entry lre-stack" data-write={w.id}>
      <p class="rpe-line">
        <strong>{kind}</strong> <span class="rpe-meta">{w.world === null ? `in your book` : `in your world ${w.world}`} · {w.entry} · {when(w.at)}</span>
        {w.putBack === null ? null : <Badge>put back by write {w.putBack}</Badge>}
      </p>
      <details class="lre-disclosure">
        <summary>
          <span class="lre-disclosure-label">The entry before and after</span>
        </summary>
        <div class="lre-stack">
          <span class="rpe-caption">Before</span>
          <p class="rpe-pre" data-before>{fieldsWords(w.before)}</p>
          <span class="rpe-caption">After</span>
          <p class="rpe-pre" data-after>{fieldsWords(w.after)}</p>
        </div>
      </details>
      {w.putBack !== null || w.kind === "put_back" ? null : asking ? (
        <Banner tone="warn" icon="alert" title="Put it back?">
          <span>
            {w.kind === "create" ? "The entry RPE made is taken away." : `The entry goes back to what it was before this write${w.world === null ? "" : ", as the world's next revision"}.`} It is refused if the entry changed since.
          </span>
          <div class="lre-inline">
            <Button variant="danger" busy={busy} onClick={putBack}>
              Yes, put it back
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              No
            </Button>
          </div>
        </Banner>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
          Put it back
        </Button>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not put back">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </li>
  );
}

/** Every write RPE made to his lore, newest first, each put back on his word. */
export function WritesSection(props: { reload: number }) {
  const app = useApp();
  const perPage = useUiSetting("rowsAtOnce");
  const [changed, setChanged] = useState<ReadonlyMap<number, LoreWrite>>(new Map());
  const list = usePaged((cursor) => app.client.call("GET /api/v1/lore/writes", {}, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }), [props.reload]);
  const items = list.items.map((w) => changed.get(w.id) ?? w);
  return (
    <Section id="writes" title="What RPE wrote to your lore">
      {list.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The writes could not be read">
          <span>{list.problem}</span>
        </Banner>
      )}
      {items.length === 0 && !list.loading && list.problem === null ? (
        <p class="lre-muted rpe-line" data-writes-none>RPE has written nothing to your lore.</p>
      ) : (
        <ul class="rpe-plain lre-stack" data-writes>
          {items.map((w) => (
            <WriteCard
              key={w.id}
              w={w}
              onPutBack={(done) => {
                setChanged((held) => new Map(held).set(done.of.id, done.of));
                list.again();
              }}
            />
          ))}
        </ul>
      )}
      {list.more ? (
        <Button busy={list.loading} onClick={list.older}>
          More writes
        </Button>
      ) : null}
    </Section>
  );
}
