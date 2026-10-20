// Story UI: the Quests panel, the quest sheet, the story's glance on Now, and the track editor
// (the track-graph special widget).

import type { UiPackDef } from "../../../frontend/registry";
import { QuestsPanel, StoryGlance } from "./panel";
import { QuestSheet } from "./quest";
import { TrackEditor } from "./track-editor";

const story: UiPackDef = {
  id: "story",
  register(r) {
    r.panel({ id: "story.quests", label: "Quests", order: 80, home: "story", component: QuestsPanel });
    r.sheet("quest", QuestSheet);
    r.glance({ id: "story.step", order: 60, panel: "story.quests", component: StoryGlance });
    r.editor({ collection: "tracks", label: "Tracks", component: TrackEditor });
  },
};

export default story;
