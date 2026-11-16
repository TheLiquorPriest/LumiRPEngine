import { latestOf } from "../../../turn-model";
import { ReplyBox } from "../../../trace-view";
import type { TurnSection } from "../types";



export const section: TurnSection = {
  id: "reply",
  order: 40,
  title: "What went to the chat",
  spoiler: false,
  body: ({ turn, runs }) => {
    const latest = latestOf(turn, runs);
    return latest === undefined ? null : <ReplyBox run={latest} />;
  },
};
