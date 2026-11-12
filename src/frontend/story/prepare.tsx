// Play → Now's prepared start (DEPTH2-PLAN §1.11), on a chat the harness plays: offered on a chat
// with a history a world was just attached to and on a new chat, and shown while it is under way,
// waits for the player's word, is held or has stopped, and, once the card watched it at work, when
// it is done. Start it; read the author's plan and what the whole of it is reckoned to cost, the
// author's own work included; see what it has spent, as LumiAH counts it; give it your word, steer
// it in your own words, or cap what it may spend; hold it, carry it on, or cancel it. The chat plays
// meanwhile, and the card says what isn't prepared yet. `lre.prepare get` when Now opens and every
// few seconds while the author or a job is at work; each press answers how it stands after.

import { useEffect, useState } from "preact/hooks";
import type { PrepareAsk, PrepareCallFrom, PreparePlan, PrepareView } from "../../shared/story-pages";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Meter, Stat, useBusy } from "../components";
import { capOf, nameIn, PREPARE_STATE_WORDS, prepareBusy, prepareProgress, prepareShown, STRETCH_STATE_WORDS, tokensText } from "./model";

/** How often the card reads the preparation again while it is at work, in ms. */
const POLL_MS = 4000;

/** Where the weight of one model call came from, in the card's words. */
const CALL_FROM_WORDS: Readonly<Record<PrepareCallFrom, string>> = {
  job: "weighed from its own calls",
  chat: "weighed from this chat's last author run",
  default: "your setting, as no call was measured yet (Settings → Story → Preparing)",
};

/** What one model call of the plan was reckoned to weigh, and where that came from, in a line; the author's own work is in the whole either way. */
function callWords(plan: PreparePlan | null): string {
  return plan?.call ? `The author's work included; ${tokensText(plan.call.tokens)} a call, ${CALL_FROM_WORDS[plan.call.from]}` : "The author's own work included";
}

export function PrepareCard(props: { chatId: string }) {
  const app = useApp();
  const { chatId } = props;
  const [view, setView] = useState<PrepareView | null>(null);
  const [hidden, setHidden] = useState(false);
  // Once the card watched the preparation at work, it stays to say how it ended, done included, until it is closed.
  const [watched, setWatched] = useState(false);
  const [busy, run] = useBusy();
  // Reads are quiet: a chat whose backend can't say yet shows no card, never an error on Now.
  const read = async () => {
    const answer = await app.send({ type: "lre.prepare", chatId, op: "get" });
    if (answer.type === "lre.result" && answer.request === "lre.prepare") setView(answer.body);
  };
  useEffect(() => {
    setView(null);
    setHidden(false);
    setWatched(false);
    void read();
  }, [chatId]);
  const state = view?.state ?? null;
  useEffect(() => {
    if (state === "planning" || state === "waiting" || state === "running" || state === "paused") setWatched(true);
    if (state === null || !prepareBusy(state)) return;
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [chatId, state]);
  if (hidden || view === null || !(prepareShown(view) || (watched && view.state === "done"))) return null;
  const ask = (body: PrepareAsk) =>
    run(async () => {
      const answer = await app.request({ type: "lre.prepare", chatId, ...body });
      if (answer) setView(answer);
    });
  return <PrepareBody view={view} busy={busy} ask={ask} onLater={() => setHidden(true)} />;
}

/** The card, holding only what is typed: what the player tells the author, and the cap. */
export function PrepareBody(props: { view: PrepareView; busy: boolean; ask(body: PrepareAsk): void; onLater(): void }) {
  const { view, busy, ask } = props;
  const [steer, setSteer] = useState("");
  const [cap, setCap] = useState(view.cap === null ? "" : String(view.cap));
  const capRead = capOf(cap);
  const words = PREPARE_STATE_WORDS[view.state];
  const progress = prepareProgress(view);
  const offered = view.offer !== null && (view.state === "none" || view.state === "cancelled" || view.state === "done");
  const working = view.state === "planning" || view.state === "waiting" || view.state === "running";
  const steering = view.state === "waiting" || view.state === "running" || view.state === "planning" || view.state === "paused";
  return (
    <section class={offered ? "lre-story-prepare" : "lre-card lre-story-prepare"} data-lre-prepare={view.state} aria-label="Prepare this story">
      <Banner
        tone={words.tone}
        icon={view.state === "planning" || view.state === "running" ? "hourglass" : "scroll"}
        title={words.title}
        actions={
          <>
            {offered ? (
              <Button variant="primary" icon="play" busy={busy} onClick={() => ask({ op: "start" })}>
                {view.state === "none" ? "Prepare the story" : "Start again"}
              </Button>
            ) : null}
            {view.state === "waiting" ? (
              <Button variant="primary" icon="check" busy={busy} onClick={() => ask({ op: "approve" })}>
                Go ahead with the plan
              </Button>
            ) : null}
            {view.state === "paused" || view.state === "failed" ? (
              <Button variant="primary" icon="play" busy={busy} onClick={() => ask({ op: "resume" })}>
                Carry on
              </Button>
            ) : null}
            {view.state === "planning" || view.state === "running" ? (
              <Button icon="pause" busy={busy} onClick={() => ask({ op: "pause" })}>
                Pause
              </Button>
            ) : null}
            {working || view.state === "paused" || view.state === "failed" ? (
              <Button variant="ghost" icon="close" busy={busy} onClick={() => ask({ op: "cancel" })}>
                Cancel
              </Button>
            ) : null}
            {offered ? (
              <Button variant="ghost" onClick={props.onLater}>
                Not now
              </Button>
            ) : null}
            {view.state === "done" ? (
              <Button variant="ghost" onClick={props.onLater}>
                Close
              </Button>
            ) : null}
          </>
        }
      >
        {offered ? (
          <>
            <p class="lre-story-why">{view.offer}</p>
            <p class="lre-story-note">The author reads the chat so far and plans how to bring the story up to date: who the principals are, and which moments they relive. A plan reckoned to cost more in all than your ceiling, the author's own work included (Settings → Story → Preparing), waits for your word.</p>
          </>
        ) : view.state === "planning" ? (
          <p class="lre-story-why">The author is reading the chat and writing its plan.</p>
        ) : view.note !== null ? (
          <p class="lre-story-why">{view.note}</p>
        ) : view.state === "running" ? (
          <p class="lre-story-why">The principals are reliving the chat's past, a stretch at a time.</p>
        ) : view.state === "done" ? (
          <p class="lre-story-why">The author finished preparing the story. Below is what it cost, as LumiAH counts it.</p>
        ) : null}
      </Banner>
      {!offered ? (
        <>
          <div class="lre-story-prepare-figures">
            {view.estimate !== null ? <Stat label="Reckoned in all" value={tokensText(view.estimate)} sub={callWords(view.plan)} /> : null}
            <Stat label={view.state === "done" ? "Spent in all" : "Spent so far"} value={tokensText(view.spent)} sub="Every job of it, as LumiAH counts it" />
            <Stat label="Cap" value={view.cap !== null ? tokensText(view.cap) : "None"} sub="On all the preparation may spend" />
          </div>
          {progress !== null ? <Meter label={`${progress.done} of ${progress.total} stretches prepared`} value={progress.done} max={progress.total} showValue /> : null}
          {view.notYet.length > 0 ? (
            <div class="lre-story-prepare-plan" data-lre-not-yet>
              <h4>Not prepared yet</h4>
              <ul class="lre-story-prepare-list">
                {view.notYet.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p class="lre-story-note">You can play meanwhile. What isn't prepared yet comes in as it's done.</p>
            </div>
          ) : null}
          {view.plan !== null ? (
            <Disclosure summary="The author's plan" defaultOpen={view.state === "waiting"}>
              <div class="lre-story-prepare-plan" data-lre-plan>
                <p class="lre-story-note">The plan may say what the characters keep from you.</p>
                <h4>The story</h4>
                <p>{view.plan.story}</p>
                {view.plan.principals.length > 0 ? (
                  <>
                    <h4>Principals</h4>
                    <ul class="lre-story-prepare-list">
                      {view.plan.principals.map((p) => (
                        <li key={p.entity}>
                          <strong>{nameIn(view.names, p.entity)}</strong>: {p.why}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {view.plan.stretches.length > 0 ? (
                  <>
                    <h4>Moments to relive</h4>
                    <ul class="lre-story-prepare-list">
                      {view.plan.stretches.map((s) => (
                        <li key={s.id} data-lre-stretch={s.state}>
                          {`Messages ${s.from} to ${s.to}`}
                          {s.who.length > 0 ? `, with ${s.who.map((id) => nameIn(view.names, id)).join(", ")}` : ""}: {s.why} <Badge tone={s.state === "recorded" ? "pos" : s.state === "open" ? "accent" : "neutral"}>{STRETCH_STATE_WORDS[s.state]}</Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {view.plan.summaries !== null ? (
                  <>
                    <h4>Filled from summaries</h4>
                    <p>{view.plan.summaries}</p>
                  </>
                ) : null}
                <p class="lre-story-note">{`The author reckons the whole preparation at ${tokensText(view.plan.authorEstimate)}; the engine at ${tokensText(view.plan.reckoned)}, what was spent already and the model calls left, the author's own included. Your ceiling on the whole was ${tokensText(view.plan.ceiling)} when the plan was written.`}</p>
              </div>
            </Disclosure>
          ) : null}
          {view.steered.length > 0 ? (
            <div class="lre-story-prepare-plan">
              <h4>What you told the author</h4>
              <ul class="lre-story-prepare-list">
                {view.steered.map((line, i) => (
                  <li key={`${i}:${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {steering ? (
            <>
              <div class="lre-story-prepare-form">
                <label class="lre-field">
                  <span class="label">Tell the author</span>
                  <textarea class="lre-input lre-story-say" rows={2} value={steer} placeholder="In your own words: what to relive, who matters, what to leave out." disabled={busy} onInput={(event) => setSteer(event.currentTarget.value)} />
                </label>
                <Button
                  icon="send"
                  disabled={steer.trim() === ""}
                  busy={busy}
                  onClick={() => {
                    ask({ op: "steer", text: steer.trim() });
                    setSteer("");
                  }}
                >
                  Send
                </Button>
              </div>
              <div class="lre-story-prepare-form">
                <label class="lre-field">
                  <span class="label">Most the preparation may spend (tokens)</span>
                  <input class={"problem" in capRead ? "lre-input invalid" : "lre-input"} inputMode="numeric" value={cap} placeholder="No cap" disabled={busy} onInput={(event) => setCap(event.currentTarget.value)} />
                  {"problem" in capRead ? <span class="lre-field-help">{capRead.problem}</span> : <span class="lre-field-help">Counts all it spends, the author's own work included, as LumiAH counts it. Once the next moment to relive would take it past this, nothing more is relived: the author fills the rest from summaries and lore. Empty: no cap.</span>}
                </label>
                <Button icon="check" disabled={"problem" in capRead || capRead.tokens === view.cap} busy={busy} onClick={() => "tokens" in capRead && ask({ op: "cap", tokens: capRead.tokens })}>
                  Set the cap
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
