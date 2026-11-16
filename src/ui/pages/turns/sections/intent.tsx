import { Pre } from "../../../atoms";
import type { TurnSection } from "../types";



export const section: TurnSection = { id: "intent", order: 60, title: "Intent record", spoiler: true, body: ({ turn }) => (turn.intent === null ? null : <Pre text={turn.intent} mono={false} />) };
