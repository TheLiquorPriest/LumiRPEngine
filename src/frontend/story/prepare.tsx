// Play → Now's prepared start (DEPTH2-PLAN §1.11), on a chat the harness plays: offered on a chat
// with a history a world was just attached to and on a new chat, with a box for what the story is
// about and who matters, which goes to the author with the start; shown while it is under way, is
// revised for what the player said, waits for their word, is held, has stopped or was cancelled; and,
// once done, kept to one quiet line that opens it again. Start it; read the author's plan and what the
// whole of it is reckoned to cost, the author's own work included; see what it has spent, as LumiAH
// counts it; give it your word, tell the author what to change (and see what became of each thing you
// said, and the author's answer), or cap what it may spend; hold it, carry it on, start it over, or
// cancel it. Where it can't be reached, one line says so and what to do. The chat plays meanwhile, and
// the card says what isn't prepared yet. `lre.prepare get` when Now opens and every few seconds while
// the author or a job is at work; each press answers how it stands after.

import { useEffect, useState } from "preact/hooks";
import { PREPARE_DEPTHS, type PrepareAsk, type PrepareCallFrom, type PrepareDepth, type PreparePlan, type PrepareView } from "../../shared/story-pages";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Seg, Stat, useBusy } from "../components";
import { capOf, DEPTH_WORDS, nameIn, PREPARE_STATE_WORDS, prepareBusy, prepareQuiet, prepareShown, STRETCH_STATE_WORDS, tokensText } from "./model";
import { PrepareLive } from "./prepare-live";

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

/** What the player has typed into the card and not sent: what they tell the author, the cap (null: as the preparation has it), what the story is about and who matters (the first card's box), and the depth picked before going ahead ("": the author's recommendation). */
export interface PrepareTyped {
  steer: string;
  cap: string | null;
  about: string;
  depth: string;
}

/** What the card itself holds of the prepared start: put away with Not now or Close, opened again from its quiet line, and watched at work (it then stays to say how it ended). */
export interface PrepareShown {
  hidden: boolean;
  opened: boolean;
  watched: boolean;
}

/** What Play → Now shows of the prepared start: nothing, the one line where it can't be reached, the quiet line of a finished preparation, or the card. */
export function prepareSlot(view: PrepareView | null, shown: PrepareShown): "nothing" | "line" | "quiet" | "card" {
  if (view === null) return "nothing";
  if (view.state === "unreachable") return "line";
  if (!shown.hidden && (prepareShown(view) || shown.opened || (shown.watched && view.state === "done"))) return "card";
  return prepareQuiet(view) ? "quiet" : "nothing";
}

export function PrepareCard(props: { chatId: string }) {
  const app = useApp();
  const { chatId } = props;
  const [view, setView] = useState<PrepareView | null>(null);
  const [shown, setShown] = useState<PrepareShown>({ hidden: false, opened: false, watched: false });
  const [typed, setTyped] = useState<PrepareTyped>({ steer: "", cap: null, about: "", depth: "" });
  const [busy, run] = useBusy();
  // Reads are quiet: a chat whose backend can't say yet shows no card, never an error on Now.
  const read = async () => {
    const answer = await app.send({ type: "lre.prepare", chatId, op: "get" });
    if (answer.type === "lre.result" && answer.request === "lre.prepare") setView(answer.body);
  };
  useEffect(() => {
    setView(null);
    setShown({ hidden: false, opened: false, watched: false });
    setTyped({ steer: "", cap: null, about: "", depth: "" });
    void read();
  }, [chatId]);
  const state = view?.state ?? null;
  useEffect(() => {
    if (state === "planning" || state === "revising" || state === "waiting" || state === "running" || state === "paused") setShown((s) => (s.watched ? s : { ...s, watched: true }));
    if (state === null || !prepareBusy(state)) return;
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [chatId, state]);
  const slot = prepareSlot(view, shown);
  if (view === null || slot === "nothing") return null;
  if (slot === "line") return <PrepareLine note={view.note} />;
  if (slot === "quiet") return <PrepareQuiet onOpen={() => setShown((s) => ({ ...s, hidden: false, opened: true }))} />;
  const ask = (body: PrepareAsk) =>
    run(async () => {
      const answer = await app.request({ type: "lre.prepare", chatId, ...body });
      if (answer) setView(answer);
    });
  return <PrepareBody view={view} busy={busy} typed={typed} onType={(part, value) => setTyped((t) => ({ ...t, [part]: value }))} ask={ask} onLater={() => setShown((s) => ({ ...s, hidden: true, opened: false }))} />;
}

/** Where the preparation can't be reached (the runtime not linked, the chat not moved to it), the one line Now shows where the card would be, with what to do. */
export function PrepareLine(props: { note: string | null }) {
  return (
    <p class="lre-story-prepare-line" data-lre-prepare="unreachable" role="status">
      {props.note ?? "The story's preparation can't be reached now."}
    </p>
  );
}

/** A finished preparation, in one quiet line that opens its card again: to see how it went, or to tell the author what to change. */
export function PrepareQuiet(props: { onOpen(): void }) {
  return (
    <div class="lre-story-prepare-quiet" data-lre-prepare="quiet">
      <span class="lre-story-note">This story was prepared.</span>
      <Button variant="ghost" icon="scroll" onClick={props.onOpen}>
        See how it went, or tell the author what to change
      </Button>
    </div>
  );
}

/** The card, drawn from the view and what is typed, holding nothing itself: every press goes through `ask`, every keystroke through `onType`. */
export function PrepareBody(props: { view: PrepareView; busy: boolean; typed: PrepareTyped; onType(part: keyof PrepareTyped, value: string): void; ask(body: PrepareAsk): void; onLater(): void }) {
  const { view, busy, typed, onType, ask } = props;
  const capText = typed.cap ?? (view.cap === null ? "" : String(view.cap));
  const capRead = capOf(capText);
  const words = PREPARE_STATE_WORDS[view.state];
  const offered = view.offer !== null;
  const working = view.state === "planning" || view.state === "revising" || view.state === "waiting" || view.state === "running";
  const stopped = view.state === "paused" || view.state === "failed" || view.state === "cancelled";
  const steering = working || stopped || view.state === "done";
  return (
    <section class={offered ? "lre-story-prepare" : "lre-card lre-story-prepare"} data-lre-prepare={view.state} aria-label="Prepare this story">
      <Banner
        tone={words.tone}
        icon={view.state === "planning" || view.state === "revising" || view.state === "running" ? "hourglass" : "scroll"}
        title={words.title}
        actions={
          <>
            {offered ? (
              <Button
                variant="primary"
                icon="play"
                busy={busy}
                onClick={() => {
                  const about = typed.about.trim();
                  ask(about === "" ? { op: "start" } : { op: "start", about });
                  onType("about", "");
                }}
              >
                Prepare the story
              </Button>
            ) : null}
            {view.state === "waiting" ? (
              <Button variant="primary" icon="check" busy={busy} onClick={() => ask(view.plan !== null && view.plan.depths.length > 1 ? { op: "approve", depth: PREPARE_DEPTHS.find((d) => d === typed.depth) ?? view.plan.depth } : { op: "approve" })}>
                Go ahead with the plan
              </Button>
            ) : null}
            {stopped ? (
              <Button variant="primary" icon="play" busy={busy} onClick={() => ask({ op: "resume" })}>
                Carry on
              </Button>
            ) : null}
            {view.state === "cancelled" ? (
              <Button icon="undo" busy={busy} onClick={() => ask({ op: "restart" })}>
                Start over
              </Button>
            ) : null}
            {view.state === "planning" || view.state === "revising" || view.state === "running" ? (
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
            {view.state === "done" || view.state === "cancelled" ? (
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
          <p class="lre-story-why">The author finished preparing the story. Below is what it cost, as LumiAH counts it. You can still tell the author what to change: it revises the plan, and asks for your word again.</p>
        ) : null}
      </Banner>
      {offered ? (
        <label class="lre-field" data-lre-prepare-first>
          <span class="label">What the story is about, and who matters (you may leave it empty)</span>
          <textarea class="lre-input lre-story-say" rows={3} value={typed.about} placeholder="In your own words: what the story is about for your character, who its main characters are, who is supporting." disabled={busy} onInput={(event) => onType("about", event.currentTarget.value)} />
          <span class="lre-field-help">It goes to the author with the start, as your word, before it plans.</span>
        </label>
      ) : (
        <>
          <div class="lre-story-prepare-figures">
            {view.estimate !== null ? <Stat label="Reckoned in all" value={tokensText(view.estimate)} sub={callWords(view.plan)} /> : null}
            <Stat label={view.state === "done" ? "Spent in all" : "Spent so far"} value={tokensText(view.spent)} sub="Every job of it, as LumiAH counts it" />
            <Stat label="Cap" value={view.cap !== null ? tokensText(view.cap) : "None"} sub="On all the preparation may spend" />
          </div>
          <PrepareLive state={view.state} />
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
                <p class="lre-story-note" data-lre-story-file>The story as the author understands it is kept in Harness → Notebook, story.md: read it there, and tell the author what to correct.</p>
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
                          {s.who.length > 0 ? `, with ${s.who.map((id) => nameIn(view.names, id)).join(", ")}` : ""}: {s.why} <Badge tone={s.state === "recorded" ? "pos" : s.state === "open" ? "accent" : "neutral"}>{s.state === "planned" && !s.chosen ? "Not chosen" : STRETCH_STATE_WORDS[s.state]}</Badge>
                          {s.key ? <Badge tone="accent">Key moment</Badge> : null}
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
          {view.plan !== null && view.plan.depths.length > 1 && view.state !== "planning" && view.state !== "revising" ? (
            <div class="lre-story-prepare-plan" data-lre-depths>
              <h4>How deep</h4>
              <Seg<PrepareDepth>
                label="How deep"
                value={view.state === "waiting" ? (PREPARE_DEPTHS.find((d) => d === typed.depth) ?? view.plan.depth) : view.plan.depth}
                options={view.plan.depths.map((d) => ({ value: d.depth, label: `${DEPTH_WORDS[d.depth].label}: ${tokensText(d.tokens)}` }))}
                disabled={busy}
                onChange={(depth) => (view.state === "waiting" ? onType("depth", depth) : ask({ op: "depth", depth }))}
              />
              <p class="lre-story-note">{`The author recommends ${DEPTH_WORDS[view.plan.recommended.depth].label.toLowerCase()}${view.plan.recommended.why === "" ? "." : `: ${view.plan.recommended.why}`}`}</p>
              <p class="lre-story-note">{view.state === "waiting" ? "Pick a depth, then go ahead: only its stretches are relived. You can go deeper later, and going shallower never undoes what was recorded." : "Going deeper carries the preparation on with the stretches it adds; going shallower never undoes what was recorded."}</p>
            </div>
          ) : null}
          {view.steered.length > 0 ? (
            <div class="lre-story-prepare-plan" data-lre-steered>
              <h4>What you told the author</h4>
              <ul class="lre-story-prepare-list">
                {view.steered.map((said, i) => (
                  <li key={`${i}:${said.text}`} class="lre-story-prepare-said" data-lre-said={said.answer === null ? "open" : "answered"}>
                    <span>{said.text}</span>
                    <span class="lre-story-note">{said.status}</span>
                    {said.answer !== null ? <span class="lre-story-prepare-answer">{`The author's answer: ${said.answer}`}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {steering ? (
            <div class="lre-story-prepare-form">
              <label class="lre-field">
                <span class="label">Tell the author</span>
                <textarea class="lre-input lre-story-say" rows={2} value={typed.steer} placeholder="In your own words: what the story is about, who matters, what to relive or leave out." disabled={busy} onInput={(event) => onType("steer", event.currentTarget.value)} />
                <span class="lre-field-help">{view.state === "paused" ? "Kept until you carry it on: the author reads it first then." : "The author revises its plan with it, tells you what it changed, and asks for your word again."}</span>
              </label>
              <Button
                icon="send"
                disabled={typed.steer.trim() === ""}
                busy={busy}
                onClick={() => {
                  ask({ op: "steer", text: typed.steer.trim() });
                  onType("steer", "");
                }}
              >
                Send
              </Button>
            </div>
          ) : null}
          {steering && view.state !== "done" ? (
            <div class="lre-story-prepare-form">
              <label class="lre-field">
                <span class="label">Most the preparation may spend (tokens)</span>
                <input class={"problem" in capRead ? "lre-input invalid" : "lre-input"} inputMode="numeric" value={capText} placeholder="No cap" disabled={busy} onInput={(event) => onType("cap", event.currentTarget.value)} />
                {"problem" in capRead ? <span class="lre-field-help">{capRead.problem}</span> : <span class="lre-field-help">Counts all it spends, the author's own work included, as LumiAH counts it. Once the next moment to relive would take it past this, nothing more is relived: the author fills the rest from summaries and lore. Empty: no cap.</span>}
              </label>
              <Button icon="check" disabled={"problem" in capRead || capRead.tokens === view.cap} busy={busy} onClick={() => "tokens" in capRead && ask({ op: "cap", tokens: capRead.tokens })}>
                Set the cap
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
