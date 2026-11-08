// GM → Depth → Bootstrap's LumiBooks tree (DEPTH-PLAN, Round 2 item 1): the chat's LumiBooks book as
// the bootstrap imported it, volume, arc and chapter, each with the messages it spans and how they
// stand (imported, changed since, not in the book, read by the author, read deeply), who has caught
// up on it and whose full mind is built from it. Each node offers the user's deepenings: Catch up the
// characters you pick, Read deeply (exact beats replace the imported record) and Build one
// character's full mind, the whole book's too. Each asks for its estimate first and runs only on
// Confirm. A chat with no book offers summarizing it with LumiBooks first. The body is hook-free;
// `LumiBooksPanel` holds the requests (`lre.bootstrap`'s `lb_*` operations).

import { useEffect, useState } from "preact/hooks";
import type { BootstrapOp, LbActionEstimate, LbCoverage, LbLevel, LbNode, LbTree } from "../../shared/bootstrap";
import { durationText, moneyText, tokensText } from "../../shared/depth-views";
import type { EntityId } from "../../shared/ids";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, HostSwitch, Section, Seg, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";

/** A deepening the user sets up on a node: whom it is for, before its estimate. `fullmind`'s `node` null is the whole book. */
export type LbDeepening = { kind: "catchup"; node: string; who: EntityId[] } | { kind: "deep"; node: string } | { kind: "fullmind"; node: string | null; who: EntityId | null };

/** The request a deepening makes: without `confirm` it only asks for the estimate. Null until it names whom it is for. */
export function lbOp(what: LbDeepening, confirm: boolean): BootstrapOp | null {
  const sure = confirm ? { confirm: true } : {};
  switch (what.kind) {
    case "catchup":
      return what.who.length > 0 ? { op: "lb_catchup", node: what.node, who: what.who, ...sure } : null;
    case "deep":
      return { op: "lb_deep", node: what.node, ...sure };
    case "fullmind":
      return what.who !== null ? { op: "lb_fullmind", who: what.who, ...(what.node !== null ? { node: what.node } : {}), ...sure } : null;
  }
}

export const LEVEL_LABEL: Readonly<Record<LbLevel, string>> = { volume: "Volume", arc: "Arc", chapter: "Chapter" };

export const COVERAGE_LABEL: Readonly<Record<LbCoverage, { label: string; tone: "neutral" | "accent" | "pos" | "warn" }>> = {
  covered: { label: "Imported", tone: "neutral" },
  changed: { label: "Changed since", tone: "warn" },
  uncovered: { label: "Not in the book", tone: "warn" },
  read: { label: "Read by the author", tone: "accent" },
  deep: { label: "Read deeply", tone: "pos" },
};

/** A message range as the chat numbers it, from 1: "Messages 12–40". */
export function rangeText(range: readonly [number, number]): string {
  return range[0] === range[1] ? `Message ${range[0] + 1}` : `Messages ${range[0] + 1}–${range[1] + 1}`;
}

/** An estimate in a line: "14 calls · 180K tokens · $0.31 · 2 min". */
export function lbEstimateText(e: LbActionEstimate): string {
  return [`${e.calls.toLocaleString("en-US")} ${e.calls === 1 ? "call" : "calls"}`, `${tokensText(e.tokens)} tokens`, moneyText(e.cost), durationText(e.ms)].join(" · ");
}

/** The tree in reading order, each node with how deep it sits. */
export function lbRows(nodes: readonly LbNode[], depth = 0): { node: LbNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...lbRows(node.children, depth + 1)]);
}

/** What the tree's controls do. */
export interface LumiBooksControls {
  busy: boolean;
  /** The deepening being set up, and its estimate once asked for. */
  pending: { what: LbDeepening; estimate: LbActionEstimate | null } | null;
  /** Sets up a deepening (or changes whom it is for), which drops any estimate; null cancels. */
  onPick(what: LbDeepening | null): void;
  onEstimate(): void;
  onConfirm(): void;
}

const VERB: Readonly<Record<LbDeepening["kind"], string>> = { catchup: "Catch up", deep: "Read deeply", fullmind: "Build the full mind" };

/** The offer for a chat with no LumiBooks book: summarize it with LumiBooks first, so the bootstrap imports the book as records with no model call. */
export function LumiBooksFirst() {
  return (
    <Banner tone="info" icon="book" title="Summarize with LumiBooks first">
      This chat has no LumiBooks book. Summarize it with LumiBooks first (its own Summarize, in the LumiBooks panel): the bootstrap then imports the book's entries as records with no model call, for the book's tree in GM → Depth → Bootstrap. The full read of the history still runs.
    </Banner>
  );
}

/** Whom a deepening is for, and what it would take: the picks, Estimate, then the estimate with Confirm. */
function DeepeningEditor(props: { tree: LbTree; title: string; pending: NonNullable<LumiBooksControls["pending"]>; c: LumiBooksControls }) {
  const { tree, pending, c } = props;
  const { what, estimate } = pending;
  const ready = lbOp(what, false) !== null;
  return (
    <div class="lre-stack lre-lb-deepening" data-lre-lb-deepening={what.kind}>
      {what.kind === "catchup" ? (
        <>
          <p class="lre-small lre-muted">{`Each character you pick catches up on ${props.title} from their own point of view: what they lived of it joins their mind.`}</p>
          {tree.cast.map((who) => (
            <HostSwitch key={who.id} label={who.name} checked={what.who.includes(who.id)} disabled={c.busy} onChange={(on) => c.onPick({ ...what, who: on ? [...what.who, who.id] : what.who.filter((id) => id !== who.id) })} />
          ))}
        </>
      ) : what.kind === "fullmind" ? (
        <>
          <p class="lre-small lre-muted">{`Builds one character's lived memories of ${props.title} from scratch, scene by scene, as a full read does.`}</p>
          <Seg<EntityId> label="Whose full mind" value={what.who} options={tree.cast.map((who) => ({ value: who.id, label: who.name }))} disabled={c.busy} onChange={(who) => c.onPick({ ...what, who })} />
        </>
      ) : (
        <p class="lre-small lre-muted">{`The author reads ${props.title} again in full: exact canon beats replace the imported record.`}</p>
      )}
      {estimate ? (
        <div class="lre-stack" data-lre-lb-estimate>
          <p class="lre-small">{`It would take ${lbEstimateText(estimate)}.`}</p>
          {estimate.notes.map((note, i) => (
            <p key={i} class="lre-small lre-muted">
              {note}
            </p>
          ))}
        </div>
      ) : null}
      <div class="lre-inline">
        {estimate ? (
          <Button size="sm" variant="primary" icon="play" busy={c.busy} onClick={c.onConfirm}>
            {`Confirm: ${VERB[what.kind]}`}
          </Button>
        ) : (
          <Button size="sm" variant="primary" busy={c.busy} disabled={!ready} onClick={c.onEstimate}>
            Estimate
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={c.busy} onClick={() => c.onPick(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** GM → Depth → Bootstrap's LumiBooks tree, hook-free. */
export function LumiBooksBody(props: { tree: LbTree; c: LumiBooksControls }) {
  const { tree, c } = props;
  if (tree.book === null) return <LumiBooksFirst />;
  const names = new Map(tree.cast.map((who) => [who.id, who.name]));
  const named = (ids: readonly EntityId[]): string => ids.map((id) => names.get(id) ?? id).join(", ");
  const pendingOn = (node: string | null) => (c.pending && c.pending.what.node === node ? c.pending : null);
  const whole = pendingOn(null);
  return (
    <div class="lre-stack lre-lb" data-lre-lb={tree.book}>
      <Section title={`LumiBooks: ${tree.book}`} flush>
        <ActionRows label="The LumiBooks tree">
          {lbRows(tree.nodes).map(({ node, depth }) => {
            const coverage = COVERAGE_LABEL[node.coverage];
            const title = `${LEVEL_LABEL[node.level]}: ${node.title}`;
            const subtitle = [rangeText(node.range), node.changed > 0 ? `${node.changed} ${node.changed === 1 ? "message" : "messages"} changed since` : null, node.caughtUp.length > 0 ? `Caught up: ${named(node.caughtUp)}` : null, node.fullMind.length > 0 ? `Full mind: ${named(node.fullMind)}` : null].filter((s) => s !== null).join(" · ");
            const open = pendingOn(node.id);
            return (
              <div key={node.id} class="lre-lb-node" data-lre-lb-node={node.id} data-lre-lb-level={node.level} style={{ "--lre-lb-depth": depth }}>
                <ActionRow
                  title={title}
                  subtitle={subtitle}
                  value={<Badge tone={coverage.tone}>{coverage.label}</Badge>}
                  actions={
                    <>
                      <Button size="sm" variant="secondary" disabled={c.busy || tree.cast.length === 0} onClick={() => c.onPick({ kind: "catchup", node: node.id, who: [] })}>
                        Catch up…
                      </Button>
                      <Button size="sm" variant="secondary" disabled={c.busy || node.coverage === "deep"} onClick={() => c.onPick({ kind: "deep", node: node.id })}>
                        Read deeply
                      </Button>
                      <Button size="sm" variant="secondary" disabled={c.busy || tree.cast.length === 0} onClick={() => c.onPick({ kind: "fullmind", node: node.id, who: null })}>
                        Build a full mind…
                      </Button>
                    </>
                  }
                >
                  {open ? <DeepeningEditor tree={tree} title={`${LEVEL_LABEL[node.level].toLowerCase()} ${node.title}`} pending={open} c={c} /> : null}
                </ActionRow>
              </div>
            );
          })}
        </ActionRows>
      </Section>
      <div class="lre-stack">
        <Button variant="secondary" disabled={c.busy || tree.cast.length === 0} onClick={() => c.onPick({ kind: "fullmind", node: null, who: null })}>
          Build a full mind from the whole book…
        </Button>
        {whole ? <DeepeningEditor tree={tree} title="the whole book" pending={whole} c={c} /> : null}
      </div>
      {tree.uncovered.length > 0 ? (
        <Section title="Not in the book">
          <div class="lre-stack" data-lre-lb-uncovered>
            <p class="lre-small lre-muted">The author reads these as it reads any chat: no book entry spans them.</p>
            <p class="lre-small">{tree.uncovered.map((r) => rangeText(r)).join(" · ")}</p>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Follows a chat's LumiBooks tree: asked for once, and again as the chat's bootstrap moves (its
 * pushes carry the view, not the tree). Undefined while first read; null where it couldn't be read.
 */
export function useLumiBooks(chatId: string): { tree: LbTree | null | undefined; ask(op: BootstrapOp): Promise<{ tree?: LbTree; lbEstimate?: LbActionEstimate } | null> } {
  const app = useApp();
  const [tree, setTree] = useState<LbTree | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      const message = await app.send({ type: "lre.bootstrap", chatId, op: "lb_tree" });
      reading = false;
      if (!live) return;
      if (message.type === "lre.result" && message.request === "lre.bootstrap") setTree(message.body.tree ?? null);
      else setTree((was) => was ?? null);
    };
    void read();
    const off = app.client.onBootstrap((update) => {
      if (update.chatId === chatId) void read();
    });
    return () => {
      live = false;
      off();
    };
  }, [chatId]);
  return {
    tree,
    ask: async (op) => {
      const message = await app.send({ type: "lre.bootstrap", chatId, ...op });
      if (message.type === "lre.error") {
        app.toast(message.message, "error");
        return null;
      }
      if (message.type !== "lre.result" || message.request !== "lre.bootstrap") return null;
      if (message.body.tree) setTree(message.body.tree);
      return message.body;
    },
  };
}

/** GM → Depth → Bootstrap's LumiBooks tree, with its deepenings. */
export function LumiBooksPanel(props: { chatId: string }) {
  const lb = useLumiBooks(props.chatId);
  const [busy, go] = useBusy();
  const [pending, setPending] = useState<LumiBooksControls["pending"]>(null);
  if (lb.tree === undefined) return <Empty icon="hourglass">Reading the LumiBooks book…</Empty>;
  if (lb.tree === null) return null;
  const estimate = (what: LbDeepening) =>
    go(async () => {
      const op = lbOp(what, false);
      if (op === null) return;
      const body = await lb.ask(op);
      setPending((now) => (now && now.what === what && body?.lbEstimate ? { what, estimate: body.lbEstimate } : now));
    });
  const c: LumiBooksControls = {
    busy,
    pending,
    onPick: (what) => {
      setPending(what ? { what, estimate: null } : null);
      // Read deeply has nothing to pick: its estimate is asked for at once.
      if (what?.kind === "deep") estimate(what);
    },
    onEstimate: () => {
      if (pending) estimate(pending.what);
    },
    onConfirm: () =>
      go(async () => {
        const op = pending ? lbOp(pending.what, true) : null;
        if (op === null) return;
        if (await lb.ask(op)) setPending(null);
      }),
  };
  return <LumiBooksBody tree={lb.tree} c={c} />;
}
