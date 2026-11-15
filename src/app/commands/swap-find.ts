// Whether today's build has a runtime of this user in Lumiverse's data folder: what tells the swap from
// the install, with no flag (READINGS R-83).

import { openToday, type Sources } from "../../migrate/today";

/**
 * Whether the data of the user `sources` names holds a runtime of today's build that is his, as the
 * swap reads it (`openToday`). A Lumiverse that has none of today's data, or whose data cannot be read,
 * has no runtime of today's: it is an install.
 */
export async function todaysRuntimeFound(sources: Sources): Promise<boolean> {
  try {
    const today = await openToday(sources);
    try {
      return today.runtime.runtimes.length > 0;
    } finally {
      today.close();
    }
  } catch {
    return false;
  }
}
