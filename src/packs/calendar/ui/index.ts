// Calendar & time UI: the Calendar panel (clock, upcoming, time controls) and the schedule
// editor (the schedule/timeline special widget).

import type { UiPackDef } from "../../../frontend/registry";
import { ScheduleEditor } from "./schedule-editor";
import { CalendarPanel } from "./panel";

const calendar: UiPackDef = {
  id: "calendar",
  register(r) {
    r.panel({ id: "calendar.calendar", label: "Calendar", order: 70, component: CalendarPanel });
    r.editor({ collection: "schedules", label: "Schedules", component: ScheduleEditor });
  },
};

export default calendar;
