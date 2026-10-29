// Calendar & time UI: the Calendar panel (clock, coming up, Pause/Resume and Timelapse), its glance
// on Now (the next commitments), and the schedule editor (the schedule/timeline special widget).

import type { UiPackDef } from "../../../frontend/registry";
import { ScheduleEditor } from "./schedule-editor";
import { CalendarGlance, CalendarPanel } from "./panel";

const calendar: UiPackDef = {
  id: "calendar",
  register(r) {
    // Story's sub-tabs run Quests, What you know, Journal, Calendar.
    r.panel({ id: "calendar.calendar", label: "Calendar", order: 95, home: "story", component: CalendarPanel });
    r.glance({ id: "calendar.next", order: 50, panel: "calendar.calendar", component: CalendarGlance });
    r.editor({ collection: "schedules", label: "Schedules", component: ScheduleEditor });
  },
};

export default calendar;
