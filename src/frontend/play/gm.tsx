// The GM view (`core.gm`, DESIGN §7): the truth for the GM section in view, secrets
// and removed entities included, with the editor. GM mode renders it for World, Places and Story,
// for each pack's tab (`UiRegistry.gm`: everyone's money is the economy pack's, the characters'
// minds the minds pack's, the GM assistant and the workspace the core pack's), and for This chat's
// Edits. Behind the gate in UI state (`ui.gm.revealed`): its data is asked for (`lre.gm`) only while
// the gate is open and dropped when it closes, so it never travels with the player's state and
// nothing of it is drawn behind the gate. Every change is one `lre.edit`: checked against what it
// touches, all or none, one fix with its own Undo chip. Once one applies, a notice over the tab bar
// says what it did, with that Undo; a GM → Workspace write, one GM edit through its own request,
// says it the same way (`changed`).

import { useEffect, useRef, useState } from "preact/hooks";
import type { EditOp } from "../../shared/protocol";
import type { GmView, StateView } from "../../shared/state-view";
import { DEFAULT_CURRENCY } from "../../shared/world";
import { useApp, useUi } from "../app";
import { sendInChunks } from "../batch";
import { Empty, useBusy } from "../components";
import { Gate, TruthBar } from "../gm/curtain";
import type { BulkEditor, EditNotice } from "../gm/editor";
import { editNotice, noticeStands, sendEdits } from "../gm/editor";
import { hideTruth, revealTruth } from "../gm/gate";
import { EditsLog, PlacesSection, StorySection } from "../gm/sections";
import { EditNoticeBar } from "../gm/ui";
import { WorldSection } from "../gm/world";
import type { PanelProps } from "../registry";
import { editRequest } from "../requests";

/**
 * What the GM view is loaded again on: the chat moving on (a turn, an edit, an undo), as the
 * player's state shows it. Chips count by id, not by number: an answer that swaps one chip for
 * another (a routine's Yes leaves its Undo) changes the chat while their count stays.
 */
export function gmReloadKey(state: Pick<StateView, "status" | "chips" | "journal">): string {
  return `${state.status}\u0000${state.journal.length}\u0000${state.chips.map((c) => c.id).join("\u0000")}`;
}

export function GmPanel(props: PanelProps) {
  const app = useApp();
  const revealed = useUi((ui) => ui.gm.revealed);
  const section = useUi((ui) => ui.gm.section);
  const [gm, setGm] = useState<GmView | null>(null);
  const [notice, setNotice] = useState<EditNotice | null>(null);
  const [busy, run] = useBusy();
  // Only the latest load lands: one for another chat, or from before the gate closed, is dropped.
  // Each still resolves its view (null once the gate closed): one asked for after an edit applied
  // shows that edit, whichever load lands.
  const loads = useRef(0);
  const load = async (): Promise<GmView | null> => {
    const seq = ++loads.current;
    const view = await app.request({ type: "lre.gm", chatId: props.chatId });
    if (!view || !app.ui.get().gm.revealed) return null;
    if (seq === loads.current) setGm(view);
    return view;
  };
  // Loaded when the gate opens, and again when the chat moves on (a turn, an edit, an undo);
  // forgotten when it closes.
  useEffect(() => {
    if (revealed) {
      void load();
      return;
    }
    loads.current++;
    setGm(null);
    setNotice(null);
  }, [revealed, props.chatId, gmReloadKey(props.state)]);
  if (!revealed) return <Gate onReveal={() => app.ui.update(revealTruth)} />;
  /**
   * Sends edits through `sendAll`, each one `lre.edit`, and once any applied, reloads and says what
   * they did (`done`, from how many operations applied) with the Undo that takes back the edits
   * this wrote, by the chips each said it wrote: nothing that landed meanwhile.
   */
  const commit = (sendAll: (send: (ops: EditOp[]) => Promise<boolean>) => Promise<{ applied: number; of: number }>, done?: (count: number) => string) => {
    const { promise, resolve } = Promise.withResolvers<{ applied: number; of: number }>();
    run(async () => {
      const sent = await sendEdits(sendAll, (ops) => app.request(editRequest(props.chatId, ops)));
      // An edit made while a reply is being written lands when it finishes: there's no Undo to show yet.
      if (sent.held) app.toast("Saved — it applies when the reply finishes.", "info");
      if (sent.applied > 0) {
        const view = await load();
        if (sent.undo.length > 0) setNotice(editNotice(sent.undo, view?.edits ?? [], done?.(sent.count)));
      }
      resolve({ applied: sent.applied, of: sent.of });
    });
    return promise;
  };
  /** Undoes edits by their chips, newest first, stopping at the first refused (its reason is a toast). */
  const undo = (chips: readonly string[]) =>
    run(async () => {
      let all = true;
      for (const chip of chips) {
        if (await app.request({ type: "lre.chip", chatId: props.chatId, chip, choice: "undo" })) continue;
        all = false;
        break;
      }
      if (all) app.toast("Undone.", "info");
      setNotice(null);
      await load();
    });
  /** A change sent through a request of its own (GM → Workspace's writes): reloads, then says what it did with its Undo, as `commit` does for an edit. */
  const changed = async (text: string, result: { pending?: boolean; undo?: string | null }): Promise<void> => {
    if (result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
    const view = await load();
    if (view && result.undo) setNotice(editNotice([result.undo], view.edits, text));
  };
  const pack = app.catalog.gmSections.find((def) => def.id === section);
  const editor: BulkEditor | null = gm
    ? {
        gm,
        currency: props.state.currency ?? DEFAULT_CURRENCY,
        busy,
        edit: (ops, done) => commit(async (send) => ({ applied: (await send(ops)) ? 1 : 0, of: 1 }), done === undefined ? undefined : () => done).then((outcome) => outcome.applied === 1),
        editAll: (ops, done) => commit((send) => sendInChunks(ops, send), done),
      }
    : null;
  // A notice shows only while its Undo still reaches what it made: the next reply, or an Undo in the chat, retires it.
  const shown = gm && notice && noticeStands(notice, gm) ? notice : null;
  return (
    <div class="lre-stack lre-gm-truth-view" data-lre-panel="core.gm">
      <TruthBar onHide={() => app.ui.update(hideTruth)} />
      {!editor ? (
        <Empty>Loading the truth…</Empty>
      ) : section === "places" ? (
        <PlacesSection gm={editor.gm} />
      ) : section === "story" ? (
        <StorySection editor={editor} />
      ) : section === "chat" ? (
        <EditsLog gm={editor.gm} busy={busy} onUndo={(chip) => undo([chip])} />
      ) : pack ? (
        <pack.component chatId={props.chatId} gm={editor.gm} currency={editor.currency} busy={editor.busy} edit={editor.edit} reload={async () => void (await load())} changed={changed} send={props.send} />
      ) : (
        <WorldSection editor={editor} chatId={props.chatId} />
      )}
      {shown ? <EditNoticeBar notice={shown} busy={busy} onUndo={() => undo(shown.undo)} onDismiss={() => setNotice(null)} /> : null}
    </div>
  );
}
