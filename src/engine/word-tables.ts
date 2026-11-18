// The words the engine says for the ids of a table (a power, who may enter, a need, a plan's status, a company's structure, a project's
// status): lines of the shipped history-words file (`word_<table>_<id>`), read each time one is asked for. The pages keep their own
// tables of the same ids in `shared/`; what a model or the chat's history reads is said from the lines.

import { AUDIENCES, ORG_POWERS } from "../shared/org";
import { NEED_IDS, type NeedId } from "../shared/needs";
import { PLAN_STATUSES } from "../shared/org-feed";
import { COST_WHEN, PROJECT_STATUSES } from "../shared/projects";
import { wordOf, wordTable } from "./lines";

/** What each power lets its holder do, as "you may …" finishes it. */
export const powerWords = wordTable("power", ORG_POWERS);
/** Who may enter a place, as a phrase. */
export const audienceWords = wordTable("entry", AUDIENCES);
/** A plan's status. */
export const planStatusWords = wordTable("plan_status", PLAN_STATUSES);
/** A company's structure, as "a …" says it. */
export const structureWords: Readonly<Record<string, string | undefined>> = wordTable("structure", ["sole_proprietorship", "partnership", "llc", "s_corp", "c_corp", "nonprofit"]);
/** A project's status. */
export const projectStatusWords = wordTable("project_status", PROJECT_STATUSES);
/** When a step of a project is paid for. */
export const costWhenWords = wordTable("cost_when", COST_WHEN);

/** Each need in words: its name, the word the narrator is told once it presses ("hungry"), and what meets it. */
export const needWords: Readonly<Record<NeedId, { readonly name: string; readonly word: string; readonly metBy: string }>> = Object.fromEntries(
  NEED_IDS.map((need) => [
    need,
    {
      get name() {
        return wordOf("need_name", need);
      },
      get word() {
        return wordOf("need", need);
      },
      get metBy() {
        return wordOf("need_met_by", need);
      },
    },
  ]),
) as Record<NeedId, { readonly name: string; readonly word: string; readonly metBy: string }>;
