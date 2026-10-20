// The GM view (`core.gm`, DESIGN §7): the truth for the GM section in view, secrets
// and removed entities included, with the editor. GM mode renders it for World, Places and Story,
// for each pack's tab (`UiRegistry.gm`: everyone's money is the economy pack's, the characters'
// minds the minds pack's), and for This chat's Edits. Behind the gate in UI state
// (`ui.gm.revealed`): its data is asked for (`lre.gm`) only while the gate is open and dropped when
// it closes, so it never travels with the player's state and nothing of it is drawn behind the
// gate. Every change is one `lre.edit`: checked against what it touches, all or none, one fix with
// its own Undo chip.

import { useEffect, useRef, useState } from "preact/hooks";
import type { GmView } from "../../shared/state-view";
import { DEFAULT_CURRENCY } from "../../shared/world";
import { useApp, useUi } from "../app";
import { Empty, useBusy } from "../components";
import { Gate, TruthBar } from "../gm/curtain";
import type { Editor } from "../gm/editor";
import { hideTruth, revealTruth } from "../gm/gate";
import { EditsLog, PlacesSection, StorySection } from "../gm/sections";
import { WorldSection } from "../gm/world";
import type { PanelProps } from "../registry";
import { editRequest } from "../requests";

export function GmPanel(props: PanelProps) {
  const app = useApp();
  const revealed = useUi((ui) => ui.gm.revealed);
  const section = useUi((ui) => ui.gm.section);
  const [gm, setGm] = useState<GmView | null>(null);
  const [busy, run] = useBusy();
  // Only the latest load lands: one for another chat, or from before the gate closed, is dropped.
  const loads = useRef(0);
  const load = async (): Promise<void> => {
    const seq = ++loads.current;
    const view = await app.request({ type: "lre.gm", chatId: props.chatId });
    if (view && seq === loads.current && app.ui.get().gm.revealed) setGm(view);
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
  }, [revealed, props.chatId, props.state.status, props.state.chips.length, props.state.journal.length]);
  if (!revealed) return <Gate onReveal={() => app.ui.update(revealTruth)} />;
  const pack = app.catalog.gmSections.find((def) => def.id === section);
  const editor: Editor | null = gm
    ? {
        gm,
        currency: props.state.currency ?? DEFAULT_CURRENCY,
        busy,
        edit: (ops) =>
          new Promise<boolean>((resolve) =>
            run(async () => {
              const result = await app.request(editRequest(props.chatId, ops));
              if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
              if (result) await load();
              resolve(result !== null);
            }),
          ),
      }
    : null;
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
        <EditsLog gm={editor.gm} />
      ) : pack ? (
        <pack.component chatId={props.chatId} gm={editor.gm} currency={editor.currency} busy={editor.busy} edit={editor.edit} reload={load} send={props.send} />
      ) : (
        <WorldSection editor={editor} />
      )}
    </div>
  );
}
