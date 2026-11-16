import { TurnTold } from "../told";
import type { TurnSection } from "../types";

export const section: TurnSection = {
  id: "told",
  order: 130,
  title: "Gap checks, consents and what it was told",
  spoiler: true,
  body: ({ turn }) => {
    const { told } = turn;
    return told.gapChecks.length + told.consents.length + told.rules.length + told.attachments.length + told.dropped.length === 0 ? null : <TurnTold told={told} />;
  },
};
