// The chat's projection book (plan §9.6, §14 Lore): a book of its own that carries what the story changed and made (notes on his
// entries, the people and canon it made), off unless he turns it on for this chat. The switch is the chat's own setting
// `lore.projection`, written at the chat's level; "Apply now" makes or rewrites the book from the path as it stands, or takes
// the one made away when it is off. His own books are never touched.

import { useState } from "preact/hooks";
import type { LoreProjectionRefreshed } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../atoms";
import { useRead } from "../../reading";
import { errorWords } from "../../words";

/** What an Apply now did, in words. */
export function refreshedWords(r: LoreProjectionRefreshed): string {
  if (!r.on) return r.removed === null ? "It is off, and there was no book to take away." : `It is off: the book ${r.removed} was taken away.`;
  return r.written ? `The book ${r.book ?? ""} was written again from the path as it stands.` : `The book ${r.book ?? ""} already held what the path says.`;
}

export function ProjectionSection(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const state = useRead(() => app.client.call("GET /api/v1/chats/:chat/lore/projection", { chat }), [chat]);
  const [busy, setBusy] = useState<"switch" | "apply" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const on = state.value?.on ?? false;
  const run = (what: "switch" | "apply", go: () => Promise<void>): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      () => setBusy(null),
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const turn = (): void =>
    run("switch", async () => {
      await app.client.call("PUT /api/v1/settings", {}, { body: { level: "chat", chat, key: "lore.projection", value: !on } });
      setSaid(!on ? "Turned on for this chat, in its own settings. The book is made from the next turn, or press Apply now." : "Turned off for this chat. The book stays until you press Apply now.");
      state.again();
    });
  const apply = (): void =>
    run("apply", async () => {
      const done = await app.client.call("POST /api/v1/chats/:chat/lore/projection/refresh", { chat });
      setSaid(refreshedWords(done));
      state.again();
    });
  return (
    <Section id="projection" title="This chat's projection book">
      <p class="rpe-line">A book of its own that carries what the story changed and made: notes on your entries, the people it brought in and the canon it set down. Off unless you turn it on for this chat.</p>
      {state.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Where it stands could not be read">
          <span>{state.problem}</span>
        </Banner>
      )}
      {state.value === null ? null : (
        <p class="rpe-line" data-projection={on ? "on" : "off"}>
          <Badge tone={on ? "pos" : undefined}>{on ? "on" : "off"}</Badge> {state.value.book === null ? "No book is made yet." : `Its book in Lumiverse: ${state.value.book}.`}
        </p>
      )}
      <div class="lre-inline rpe-wrap">
        <Button busy={busy === "switch"} onClick={turn} disabled={state.value === null}>
          {on ? "Turn it off for this chat" : "Turn it on for this chat"}
        </Button>
        <Button kind="ghost" busy={busy === "apply"} onClick={apply} disabled={state.value === null}>
          Apply now
        </Button>
      </div>
      {said === null ? null : <p class="rpe-line" data-said>{said}</p>}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span>{problem}</span>
        </Banner>
      )}
    </Section>
  );
}
