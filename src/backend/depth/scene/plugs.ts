// The live scene's plugs (DEPTH-PLAN §9.2 A2): the real stage each lane built, bound where the turn
// (`turn.ts`) calls it. A test binds scripted ones in their place.

import { narrationOf, renarrateMoments } from "./narration";
import { actBeatTexts, play, sceneRecall, sceneSoFar } from "./play";
import { realtimeTurn } from "./realtime";
import { attemptSeed, playerBeats, resolveAttempt } from "./resolve";
import type { ScenePlugs } from "./turn";

export const scenePlugs: ScenePlugs = { playerBeats, play, sceneSoFar, sceneRecall, actBeatTexts, resolveAttempt, attemptSeed, narration: narrationOf, renarrateMoments, realtimeTurn };
