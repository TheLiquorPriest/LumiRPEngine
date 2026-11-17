// What the previous build's play pages are told that the route form does not describe field by field: the
// chat's state view (`src/shared/state-view.ts`). RPE carries it as the previous build wrote it, under the name
// of its type, which the generated types take from its own module, and the reference marks it as what it is.

import { isRecord } from "../shared/json";
import type { StateView } from "../shared/state-view";
import { shape } from "./routes";

/** A chat's state as the previous build's pages take it. */
export const stateView = shape.carried<StateView>("StateView", "../state-view", "A chat's state as the previous build's play pages take it: its status, its clock, its sheet, its scene, its chips and the rest of what the pages draw.", "a chat's state view", (value): value is StateView => isRecord(value));
