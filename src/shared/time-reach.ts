// The clock's reach and Speed through (DESIGN §9.2): the activities it lists, its default, the range of
// its threshold and how far a timelapse reaches. Moved unchanged out of the previous extension's
// settings registry (PlanSwap-13), which takes them back from here until it goes.

/** The activities Speed through always lists (DESIGN §9.2), each offered as a timelapse past 30 minutes unless set otherwise; worlds may add more. */
export const SPEED_ACTIVITIES = ["sleep", "work_shift", "travel", "waiting"] as const;
export const SPEED_DEFAULT: Readonly<{ mode: "offer" | "auto"; thresholdMinutes: number }> = Object.freeze({ mode: "offer", thresholdMinutes: 30 });
/** A Speed-through threshold's range in whole minutes, 1 minute to 7 days (DESIGN §9.2): what Settings keeps, the controls offer and the engine reads. */
export const SPEED_THRESHOLD_MINUTES = [1, 7 * 1440] as const;
/** The farthest a timelapse reaches from now, 366 days in minutes (DESIGN §9.2): the engine's hard maximum, and the most a skip can run without asking. */
export const TIMELAPSE_REACH_MINUTES = 366 * 1440;
