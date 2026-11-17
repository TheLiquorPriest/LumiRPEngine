// The notes and signals the engine's own code records (an arrival, a need, an overdue thing, a closed road), each worded by a line of
// the history lines (`src/engine/lines.ts`): code gives the line's name and what fills it, and the record's own data. Where the
// line is not said (the user deleted it) nothing is recorded: a notice with no words is no notice.

import type { LedgerEvent } from "../shared/ledger";
import type { JsonObject } from "../shared/json";
import { type LineFields, say } from "./lines";

/** A note (`engine.note`) worded by `line`, with `data` beside its text; none where the line is not said. */
export function noteOf(line: string, fields: LineFields, data: JsonObject = {}): LedgerEvent[] {
  const text = say(line, fields);
  return text === "" ? [] : [{ type: "engine.note", data: { text, ...data } }];
}

/** A signal (`engine.signal`) of class `cls` worded by `line`, with `data` beside its class and text; none where the line is not said. */
export function signalOf(cls: string, line: string, fields: LineFields, data: JsonObject = {}): LedgerEvent[] {
  const text = say(line, fields);
  return text === "" ? [] : [{ type: "engine.signal", data: { class: cls, text, ...data } }];
}
