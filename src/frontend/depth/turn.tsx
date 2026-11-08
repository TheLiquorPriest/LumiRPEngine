// GM → Depth → Turn (DEPTH-PLAN §7, §9.1): the turn inspector's scene view. One depth reply's scene:
// where everyone was (the staging), the beats in the order the scene decided them with who decided
// each, who perceived each and how (each point of view whole), each play's private take (the
// working memory its character's next plays read), and each passage of the reply with every draft,
// the GM's check of it and what the narrator asked; beside it, every model call the turn made with
// its connection, model, the provider's request id, tokens and time, a room its provider capped,
// and, where its stage's parse didn't keep the answer whole, the fields and the answer as written.
// Nothing is withheld (§1.4). The body is hook-free; `TurnView` holds the request.

import { useEffect, useState } from "preact/hooks";
import { type DepthResult, durationText, tokensText } from "../../shared/depth-views";
import type { MessageId } from "../../shared/ids";
import { type DepthSceneView, SCENE_DECIDER_LABEL, type SceneBeat, type ScenePassage } from "../../shared/scene-view";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, HostSelect } from "../components";
import { ActionRow, ActionRows, GmCard } from "../gm/ui";
import type { GmSectionProps } from "../registry";
import { MisreadFields } from "./misread";

function verdictBadge(faithful: boolean | null) {
  return faithful === true ? <Badge tone="pos">Faithful</Badge> : faithful === false ? <Badge tone="neg">Not faithful</Badge> : <Badge tone="warn">Unchecked</Badge>;
}

function BeatCard(props: { beat: SceneBeat; pov: string }) {
  const { beat } = props;
  return (
    <div data-lre-depth-beat={beat.id}>
      <GmCard
        title={`${beat.actors.join(", ") || "The world"} · ${beat.act}`}
        subtitle={[beat.at, beat.place].join(" · ")}
        id={beat.id}
        badges={
          <>
            <Badge tone={beat.decided === "player" ? "accent" : "neutral"}>{SCENE_DECIDER_LABEL[beat.decided]}</Badge>
            {beat.asked ? <Badge tone="gm">Asked for</Badge> : null}
            {beat.continued ? <Badge>Continued</Badge> : null}
          </>
        }
      >
        <p class="lre-depth-beat-what">{beat.what}</p>
        <p class="lre-small lre-muted">{`What there was to sense: ${beat.surface}`}</p>
        {beat.quotes ? <p class="lre-depth-beat-quote">{`“${beat.quotes}”`}</p> : null}
        <ActionRows label="Who perceived it">
          {beat.exposure.length === 0 ? (
            <ActionRow title="No one" tone="muted" />
          ) : (
            beat.exposure.map((x) => (
              <ActionRow key={x.who} title={x.name} subtitle={[`by ${x.channel}`, x.reach === "whole" ? "whole" : "in part", x.pending ? "not lived yet" : ""].filter((s) => s !== "").join(" · ")} value={x.pov ? <Disclosure summary="Their point of view">{x.pov}</Disclosure> : undefined} />
            ))
          )}
        </ActionRows>
        <p class="lre-small lre-muted">{beat.passage !== null ? `Its moment is passage ${beat.passage}.` : `No passage rendered it: nothing of it reached ${props.pov}.`}</p>
      </GmCard>
    </div>
  );
}

function PassageCard(props: { passage: ScenePassage }) {
  const { passage } = props;
  const last = passage.drafts.at(-1);
  return (
    <div data-lre-depth-passage={passage.index}>
      <GmCard
        title={`Passage ${passage.index}`}
        subtitle={`${passage.beats.length} ${passage.beats.length === 1 ? "beat" : "beats"} · ${passage.drafts.length - 1} ${passage.drafts.length - 1 === 1 ? "redraft" : "redrafts"}`}
        badges={
          <>
            {verdictBadge(last?.faithful ?? null)}
            {passage.continued ? <Badge>Continued</Badge> : null}
          </>
        }
      >
        {passage.departs ? <Banner tone="warn" title="Streamed with a chip">{`${passage.departs} The beats stay canon; Re-narrate renders them again.`}</Banner> : null}
        <p class="lre-depth-passage">{passage.text}</p>
        {passage.asked.map((a, i) => (
          <p key={i} class="lre-small lre-muted">{`The narrator asked: ${a.question}${a.beats.length > 0 ? ` (the author decided ${a.beats.length} ${a.beats.length === 1 ? "beat" : "beats"})` : " (the author added nothing)"}`}</p>
        ))}
        <Disclosure summary={`Drafts and checks (${passage.drafts.length})`}>
          <div class="lre-stack">
            {passage.drafts.map((d, i) => (
              <div key={i} class="lre-stack" data-lre-depth-draft={i + 1}>
                <div class="lre-inline">
                  <strong>{`Draft ${i + 1}`}</strong>
                  {verdictBadge(d.faithful)}
                </div>
                <p class="lre-depth-passage">{d.text}</p>
                {d.notes ? <p class="lre-small">{`The GM: ${d.notes}`}</p> : null}
                {d.reasoning ? <Disclosure summary="The narrator's reasoning">{d.reasoning}</Disclosure> : null}
                {d.checkReasoning ? <Disclosure summary="The check's reasoning">{d.checkReasoning}</Disclosure> : null}
              </div>
            ))}
          </div>
        </Disclosure>
      </GmCard>
    </div>
  );
}

/** GM → Depth → Turn's body, hook-free. */
export function TurnBody(props: { view: DepthSceneView; busy: boolean; onPick(messageId: MessageId): void; onJump(messageId: MessageId): void }) {
  const { view } = props;
  const reply = view.reply;
  if (!reply) {
    return (
      <Empty icon="layers" title="No scene yet">
        Once a depth reply is played, its scene shows here: where everyone was, each beat with who decided it and who perceived it, and each passage with the GM's checks.
      </Empty>
    );
  }
  const pov = view.pov?.name ?? "the player character";
  const calls = view.provenance?.calls ?? [];
  return (
    <div class="lre-stack lre-depth-turn" data-lre-depth-turn={reply.messageId}>
      <HostSelect label="Reply" value={reply.messageId} options={view.replies.map((r) => ({ value: r.messageId, label: `Message ${r.index}`, ...(r.at ? { sublabel: r.at } : {}) }))} disabled={props.busy} onChange={(id) => props.onPick(id)} />
      <div class="lre-inline">
        <Button size="sm" icon="external" onClick={() => props.onJump(reply.messageId)}>
          Go to the message
        </Button>
      </div>
      <p class="lre-small lre-muted lre-depth-note">{`The scene as it was decided, before any prose: each passage renders it from ${pov}'s point of view, checked by the GM before it streamed.`}</p>
      <h4 class="lre-depth-subhead">Model calls</h4>
      {view.provenance ? (
        <div class="lre-stack" data-lre-depth-calls={calls.length}>
          <p class="lre-small">{`${calls.length} ${calls.length === 1 ? "call" : "calls"} · the turn took ${durationText(view.provenance.turnMs)}${view.provenance.firstContentMs !== null ? ` · the first passage after ${durationText(view.provenance.firstContentMs)}` : ""}`}</p>
          <ActionRows label="Model calls">
            {calls.map((c, i) => (
              <ActionRow key={i} title={c.role} subtitle={[c.connection || "your default connection", c.model, c.requestId ?? ""].filter((s) => s !== "").join(" · ")} value={[c.promptTokens !== undefined || c.completionTokens !== undefined ? `${tokensText((c.promptTokens ?? 0) + (c.completionTokens ?? 0))} tokens` : "", c.ms !== undefined ? durationText(c.ms) : ""].filter((s) => s !== "").join(" · ")} {...(c.misread ? { tone: "warn" as const } : {})}>
                {c.capped ? <p class="lre-small lre-muted">{`Its answer room of ${tokensText(c.capped.asked)} tokens was over what the model takes, so it was asked again at ${tokensText(c.capped.limit)}.`}</p> : null}
                {c.misread ? <MisreadFields fields={c.misread.fields} count={c.misread.count} raw={c.misread.raw} /> : null}
                {c.reasoning ? <Disclosure summary="Its reasoning">{c.reasoning}</Disclosure> : null}
              </ActionRow>
            ))}
          </ActionRows>
        </div>
      ) : (
        <p class="lre-small lre-muted">This turn's model calls are kept with the chat's last ten turns' inspector records.</p>
      )}
      <h4 class="lre-depth-subhead">Where everyone was</h4>
      {view.staging.length === 0 ? (
        <p class="lre-small lre-muted">No staging was written for this scene.</p>
      ) : (
        <ActionRows label="Staging">
          {view.staging.map((s, i) => (
            <ActionRow key={i} title={s.name} subtitle={[s.where, s.doing, s.occluded ? `blocked: ${s.occluded}` : "", s.after ? `after ${s.after}` : ""].filter((t) => t !== "").join(" · ")} />
          ))}
        </ActionRows>
      )}
      <h4 class="lre-depth-subhead">{`Beats (${view.beats.length})`}</h4>
      {view.beats.length === 0 ? <p class="lre-small lre-muted">No beat was decided.</p> : view.beats.map((b) => <BeatCard key={b.id} beat={b} pov={pov} />)}
      <h4 class="lre-depth-subhead">{`Takes (${view.takes.length})`}</h4>
      {view.takes.length === 0 ? (
        <p class="lre-small lre-muted">No character played this turn as its own agent.</p>
      ) : (
        <div data-lre-depth-takes={view.takes.length}>
          <ActionRows label="Each play's take">
            {view.takes.map((t, i) => (
              <ActionRow key={i} title={t.name} subtitle={[t.at, t.beat !== null ? `played beat ${t.beat}` : "let the moment pass", `lived ${t.lived} ${t.lived === 1 ? "beat" : "beats"}`].join(" · ")}>
                <p class="lre-depth-take-text">{t.text}</p>
              </ActionRow>
            ))}
          </ActionRows>
        </div>
      )}
      <h4 class="lre-depth-subhead">{`Each passage (${view.told.length})`}</h4>
      {view.told.length === 0 ? <p class="lre-small lre-muted">No passage streamed.</p> : view.told.map((p) => <PassageCard key={p.index} passage={p} />)}
    </div>
  );
}

/** GM → Depth → Turn: the newest depth reply's scene, or the one picked; read again when the chat moves on. */
export function TurnView(props: { section: GmSectionProps }) {
  const { section } = props;
  const app = useApp();
  const [view, setView] = useState<DepthSceneView | null | undefined>(undefined);
  const [message, setMessage] = useState<MessageId | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState<DepthResult["dryRun"]>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "scene", ...(message !== undefined ? { message } : {}) }).then((result) => {
      if (!live) return;
      setView(result?.scene ?? null);
      setDryRun(result?.dryRun ?? null);
      setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [section.chatId, section.reloadKey, message]);
  if (view === undefined) return <Empty icon="hourglass">Reading the scene…</Empty>;
  if (view === null) return <Empty icon="layers">The scene couldn't be read.</Empty>;
  return (
    <>
      <TurnBody
        view={view}
        busy={busy}
        onPick={setMessage}
        onJump={(messageId) => {
          if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
        }}
      />
      {dryRun ? <DryRunPanel dryRun={dryRun} /> : null}
    </>
  );
}

/** The chat's last dry run on the loopback: the narrator's prompt LumiRPEngine would send, each message in order. */
function DryRunPanel(props: { dryRun: NonNullable<DepthResult["dryRun"]> }) {
  const { dryRun } = props;
  return (
    <details class="lre-depth-dry-run">
      <summary>{`Dry run: the narrator prompt LumiRPEngine would send (${dryRun.messages.length} messages, ${new Date(dryRun.at).toLocaleTimeString()})`}</summary>
      <p class="lre-small lre-muted">Without the sections a turn's engine run writes: a dry run runs no engine.</p>
      {dryRun.messages.map((m, i) => (
        <div key={i} class="lre-small">
          <strong>{m.role}</strong>
          <pre class="lre-section-text">{m.content}</pre>
        </div>
      ))}
    </details>
  );
}
