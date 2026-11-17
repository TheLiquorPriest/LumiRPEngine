// What RPH does with a file, as the listing says it in RPH's own terms (plan §5): in force; switched off, and
// which lists name it; replaced by a nearer file; held out because a file its `needs:` names is not in force or
// because its header does not parse; an example, never in force; a level's config file; generated, with the page
// that edits what it shows; or kept and read by no agent. Nothing here is worked out from a file's name.

import type { TreeFileRow, TreeListed } from "../../../shared/api";
import type { Tone } from "../../../frontend/components";

/**
 * The files of a folder no agent reads, by path: guidance RPH loads by no name (the listing's `item` is null) other than
 * the files RPE and RPH read by place: a level's config, and what sits in a skill's folder beside its SKILL.md.
 */
export function unreadIn(items: readonly TreeListed[]): Set<string> {
  const files = items.flatMap((i) => (i.entry === null ? [] : [i.entry]));
  const skills = files.flatMap((f) => (f.item?.startsWith("skills/") === true ? [f.path.slice(0, f.path.lastIndexOf("/") + 1)] : []));
  return new Set(
    files
      .filter((f) => f.kind === "yours" && f.item === null && f.isConfig !== true && f.held === undefined && f.hooks === undefined)
      .filter((f) => (f.level === "chat" ? f.path : f.path.slice(f.path.indexOf("/") + 1)).includes("/"))
      .filter((f) => !skills.some((folder) => f.path.startsWith(folder)))
      .map((f) => f.path),
  );
}

/** Whether RPH takes a file, in words; a file no agent reads (`unreadIn`) is said to be kept. */
export function standingOf(entry: TreeFileRow, unread: boolean): { words: string; tone: Tone | undefined } {
  if (entry.isConfig === true) return { words: "a level's config file", tone: undefined };
  if (entry.editedOn !== undefined && entry.editedOn !== null) return { words: `generated; edited on the ${entry.editedOn} page`, tone: undefined };
  if (entry.hooks !== undefined) {
    const running = entry.hooks.filter((h) => h.applies && h.state === "on").length;
    return { words: entry.hooks.length === 0 ? "read: it names no hook RPH can read" : `read: ${running} of its ${entry.hooks.length} ${entry.hooks.length === 1 ? "hook runs" : "hooks run"}; see the Rules page`, tone: running > 0 ? "pos" : undefined };
  }
  if (unread) return { words: "kept, read by no agent", tone: undefined };
  if (entry.off) return { words: "switched off", tone: "warn" };
  if (entry.replacedBy !== null) return { words: `replaced by ${entry.replacedBy}`, tone: undefined };
  if (entry.held === "needs") return { words: "held out: a file its needs: names is not in force", tone: "warn" };
  if (entry.held === "broken") return { words: "held out: its header does not parse", tone: "neg" };
  if (!entry.applies && /(^|\/)examples\//.test(entry.path)) return { words: "an example, never in force", tone: undefined };
  return entry.applies ? { words: "in force", tone: "pos" } : { words: "not in force", tone: undefined };
}
