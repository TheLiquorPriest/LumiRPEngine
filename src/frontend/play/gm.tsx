// The GM view (`core.gm`, DESIGN §7): the truth for the GM section in view, secrets
// and removed entities included, with the editor. GM mode renders it for World, Places, Things
// (ITEMS-SPEC §10.2) and Story, for each pack's tab (`UiRegistry.gm`: everyone's money is the
// economy pack's, the characters' minds the minds pack's, the GM assistant and the workspace the
// core pack's), and for This chat's Edits. Nothing is hidden from the player (DEPTH-PLAN §1.4,
// D-9): it shows as soon as GM mode opens. Its data is asked for only while it shows, so it never
// travels with the player's state. Each tab reads only its parts of the
// view (`lre.gm.part`, `use-gm-parts`), again when the chat moves on (`StateView.gmKey`); while a
// turn runs the page may hold them as they were, with Refresh. Every change is one `lre.edit`:
// checked against what it touches, all or none, one fix with its own Undo chip. Once one applies,
// a notice over the tab bar says what it did, with that Undo; a GM → Workspace write, one GM edit
// through its own request, says it the same way (`changed`).

import { useEffect, useState } from "preact/hooks";
import type { EditOp } from "../../shared/protocol";
import type { StateView } from "../../shared/state-view";
import { DEFAULT_CURRENCY } from "../../shared/world";
import { useApp, useUi } from "../app";
import { sendInChunks } from "../batch";
import { Banner, Button, Empty, useBusy } from "../components";
import type { BulkEditor, EditNotice } from "../gm/editor";
import { editNotice, noticeStands, sendEdits } from "../gm/editor";
import { partsOf } from "../gm/parts";
import { EditsLog, PlacesSection, StorySection } from "../gm/sections";
import { ThingsSection } from "../gm/things";
import { EditNoticeBar } from "../gm/ui";
import { useGmParts } from "../gm/use-gm-parts";
import { WorldSection } from "../gm/world";
import type { PanelProps } from "../registry";
import { editRequest } from "../requests";
import { QUEUED_TOAST, toastQueued } from "../queued";

/**
 * What the GM view is loaded again on when the chat has no GM key (`StateView.gmKey`): the chat
 * moving on (a turn, an edit, an undo), as the player's state shows it. Chips count by id, not by
 * number: an answer that swaps one chip for another (a routine's Yes leaves its Undo) changes the
 * chat while their count stays.
 */
export function gmReloadKey(state: Pick<StateView, "status" | "chips" | "journal">): string {
  return `${state.status}\u0000${state.journal.length}\u0000${state.chips.map((c) => c.id).join("\u0000")}`;
}

export function GmPanel(props: PanelProps) {
  const app = useApp();
  const section = useUi((ui) => ui.gm.section);
  const [notice, setNotice] = useState<EditNotice | null>(null);
  const [busy, run] = useBusy();
  const pack = app.catalog.gmSections.find((def) => def.id === section);
  // The open tab's parts, loaded when it opens and again when the chat moves on (a turn, an edit,
  // an undo), or held while a turn runs.
  const page = useGmParts(app, props.chatId, partsOf(section, pack), props.state.gmKey ?? gmReloadKey(props.state), props.state.status);
  useEffect(() => setNotice(null), [props.chatId]);
  /**
   * Sends edits through `sendAll`, each one `lre.edit`, and once any applied, reloads and says what
   * they did (`done`, from how many operations applied) with the Undo that takes back the edits
   * this wrote, by the chips each said it wrote: nothing that landed meanwhile.
   */
  const commit = (sendAll: (send: (ops: EditOp[]) => Promise<boolean>) => Promise<{ applied: number; of: number }>, done?: (count: number) => string) => {
    const { promise, resolve } = Promise.withResolvers<{ applied: number; of: number }>();
    run(async () => {
      const sent = await sendEdits(sendAll, (ops) => app.request(editRequest(props.chatId, ops)));
      // An edit made during a turn lands after it: there's no Undo to show yet.
      if (sent.held) app.toast(QUEUED_TOAST, "info");
      if (sent.applied > 0) {
        const view = await page.load();
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
      await page.load();
    });
  /** A change sent through a request of its own (GM → Workspace's writes): reloads, then says what it did with its Undo, as `commit` does for an edit. */
  const changed = async (text: string, result: { pending?: boolean; undo?: string | null }): Promise<void> => {
    toastQueued(app, result);
    const view = await page.load();
    if (view && result.undo) setNotice(editNotice([result.undo], view.edits, text));
  };
  const gm = page.gm;
  const editor: BulkEditor | null = gm
    ? {
        gm,
        currency: props.state.currency ?? DEFAULT_CURRENCY,
        busy,
        reloadKey: page.reloadKey,
        need: page.need,
        edit: (ops, done) => commit(async (send) => ({ applied: (await send(ops)) ? 1 : 0, of: 1 }), done === undefined ? undefined : () => done).then((outcome) => outcome.applied === 1),
        editAll: (ops, done) => commit((send) => sendInChunks(ops, send), done),
      }
    : null;
  // A notice shows only while its Undo still reaches what it made: the next reply, or an Undo in the chat, retires it.
  const shown = gm && notice && noticeStands(notice, gm) ? notice : null;
  return (
    <div class="lre-stack lre-gm-truth-view" data-lre-panel="core.gm">
      {page.held ? (
        <div data-lre-gm-held="">
          <Banner
            tone="gm"
            icon="clock"
            actions={
              <Button size="sm" icon="refresh" onClick={() => void page.load()}>
                Refresh
              </Button>
            }
          >
            Showing the chat as it was before this turn
          </Banner>
        </div>
      ) : null}
      {!editor ? (
        <Empty>Loading the truth…</Empty>
      ) : section === "places" ? (
        <PlacesSection editor={editor} />
      ) : section === "things" ? (
        <ThingsSection editor={editor} chatId={props.chatId} />
      ) : section === "story" ? (
        <StorySection editor={editor} />
      ) : section === "chat" ? (
        <EditsLog gm={editor.gm} busy={busy} onUndo={(chip) => undo([chip])} />
      ) : pack ? (
        <pack.component chatId={props.chatId} gm={editor.gm} currency={editor.currency} busy={editor.busy} reloadKey={page.reloadKey} edit={editor.edit} reload={async () => void (await page.load())} changed={changed} send={props.send} />
      ) : (
        <WorldSection editor={editor} chatId={props.chatId} />
      )}
      {shown ? <EditNoticeBar notice={shown} busy={busy} onUndo={() => undo(shown.undo)} onDismiss={() => setNotice(null)} /> : null}
    </div>
  );
}
