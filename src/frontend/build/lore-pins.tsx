// Build → an entity's or a place's page, Pinned lore (DESIGN §24.5): lore pinned to a character or a place was read first by the
// previous build's mind calls and helpers. Nothing RPE runs reads a pin, so none is drawn: the world's file keeps the pins as they
// are, and this page names them once in a closed line at its foot (`KeptUnused`), only where the file holds some.

import { lorePinsOf } from "../../shared/lore";
import { useApp } from "../app";
import { useSelect } from "../../ui/store";
import { KeptUnused } from "../kept-unused";

/** The closed line at the foot of a character's or a place's page: the lore pinned to it, which the world's file keeps and nothing reads. */
export function LorePinsKept(props: { target: "characters" | "places"; id: string }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  if (!draft) return null;
  const pins = lorePinsOf(draft.doc)[props.target][props.id];
  const noun = props.target === "places" ? "place" : "character";
  return <KeptUnused fields={[{ key: "pins", label: `Lore pinned to this ${noun}` }]} held={{ pins: pins !== undefined && pins.length > 0 ? pins : undefined }} />;
}
