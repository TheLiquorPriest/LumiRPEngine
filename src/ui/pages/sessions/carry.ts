// The three ways a session carries its earlier turns into the next (plan §11), as the Sessions page names them: an open session's carried text
// is shown in each (`open.tsx`), and the session measurement counts what each costs and buys (`measurement.tsx`).

import type { CarryMode } from "../../../shared/api";

export const CARRY_WORDS: Readonly<Record<CarryMode, { name: string; about: string }>> = {
  continuing: { name: "Continuing", about: "what the Author did in its earlier turns, as it did it" },
  records: { name: "Records", about: "the Author's own record of each earlier turn" },
  nothing: { name: "Nothing", about: "only the summary the scene opened with" },
};

export const CARRY_MODES: readonly CarryMode[] = ["continuing", "records", "nothing"];
