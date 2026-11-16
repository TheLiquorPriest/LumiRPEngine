// What the Files page reads of RPE that the route table does not hold yet (see ./index.ts): the Prompts preview (PlanPages-22), built in `src/tree/`
// and answered as a part rendered by RPH: the fields it names, its text with the values of its last use in the chat, and what keeps it from reading.

import type { JsonObject } from "rp-harness/contract";
import type { WantedRoute } from "./index";

export interface PartPreviewReply {
  kind: "prompt" | "tool";
  name: string;
  /** The values of the part's last use in the chat; null where it has had none. */
  values: JsonObject | null;
  /** Every field it names, in the order first named. */
  fields: string[];
  /** Its render; absent where the text does not parse. */
  text?: string;
  /** The fields it put in that had no value. */
  missing: string[];
  /** Why the text does not read, or what of it is shown as written, each with its line. */
  problems: { line?: number; message: string }[];
}

export interface FilesRoutes {
  /** A prompt part or a tool's description rendered, as saved (no `text`) or as drafted. */
  "POST /api/v1/files-preview": WantedRoute<Record<string, never>, Record<string, never>, { path: string; chat?: string; text?: string }, PartPreviewReply>;
}
