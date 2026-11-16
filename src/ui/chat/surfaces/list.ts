// Written by `bun scripts/ui/surfaces.ts` from the surface files in this folder, and again by the build: never by hand.
// Every surface file of the chat, in name order.

import type { SurfaceDef } from "../surface";
import { surface as composerSurface } from "./composer";
import { surface as hudSurface } from "./hud";
import { surface as inputBarSurface } from "./input-bar";
import { surface as toastsSurface } from "./toasts";

export const SURFACES: readonly SurfaceDef[] = [composerSurface, hudSurface, inputBarSurface, toastsSurface];
