// Story UI: the Quests panel and the track editor (the track-graph special widget).

import type { UiPackDef } from "../../../frontend/registry";
import { QuestsPanel } from "./panel";
import { TrackEditor } from "./track-editor";

const story: UiPackDef = {
  id: "story",
  register(r) {
    r.panel({ id: "story.quests", label: "Quests", order: 80, component: QuestsPanel });
    r.editor({ collection: "tracks", label: "Tracks", component: TrackEditor });
  },
};

export default story;
