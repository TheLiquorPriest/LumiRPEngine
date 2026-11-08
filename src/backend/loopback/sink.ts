// What a loopback turn streams into its provider call's answer (DEPTH-PLAN §3.8). The bridge
// implements it over the call's chunks (`bridge.ts`): progress lines and reasoning go into the
// reply's native thinking block, content is the reply's text, and each model call the turn made is
// its provenance (§9.0), listed in the finish chunk's usage and on the turn's inspector record.
// Whoever renders the turn (today's engine, A2's scene and narrator) writes to it; what they send
// passes as is, so the writer filters by the user's thinking setting (D-5) itself.

import type { LoopbackModelCall } from "../../shared/loopback";
import type { CallMisread } from "../../shared/misread";

export interface TurnSink {
  /** A stage line ("The author is setting the scene"): the thinking block, and the relay's keep-alive. */
  progress(text: string): void;
  /** Thinking, as whole as the writer has it: the author's, a check's verdict, the narrator's own. */
  reasoning(text: string): void;
  /** The reply's text. */
  content(text: string): void;
  /** One model call the turn made: its role, connection, model, upstream request id, tokens and time. */
  call(call: LoopbackModelCall): void;
  /** A call `call` reported, whose answer its stage's parse didn't keep whole: `misread` fills in as the parse goes, and the turn inspector's record of the call keeps it. A sink without it keeps none. */
  misread?(call: LoopbackModelCall, misread: CallMisread): void;
}
