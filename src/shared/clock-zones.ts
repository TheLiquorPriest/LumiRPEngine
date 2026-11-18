// The time zones the world's clock holds rules for: each has its standard offset and daylight saving rule in `engine/calendar.ts`, which is typed by
// this list so the two cannot differ. A zone outside it can be a real one (Asia/Dubai) that the clock cannot tell the time in: times there read as
// the world's own. Build's Calendar and Places fields show this list, and the world's checks warn about a zone that is not on it.

export const CLOCK_ZONES = [
  "UTC",
  "Etc/UTC",
  "America/New_York",
  "America/Detroit",
  "America/Indiana/Indianapolis",
  "America/Kentucky/Louisville",
  "America/Chicago",
  "America/Menominee",
  "America/Denver",
  "America/Boise",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Adak",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Athens",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

export type ClockZone = (typeof CLOCK_ZONES)[number];

/** Whether the runtime knows `zone` as an IANA time zone name ("America/New_York"), which "Mars/Olympus" and the empty text are not. It is the check of a name, never of the clock's rules (`CLOCK_ZONES`). */
export function timeZoneExists(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
