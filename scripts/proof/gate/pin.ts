// RPH's pin (PlanScenarios-5 item 2; plan §18.2 l.1970; READINGS R-196): RPE's `package.json` names `rp-harness` by
// one whole commit (forty hex digits); the installed `rp-harness` is a real folder, not a link; it is that commit by
// its own tag; and every file of that commit is in it with the same blob id (what `build/pin.sh verify` checks). The
// host that names the commit is `rph.invalid` until publishing and GitHub's after it, which the run's record says as
// the pin's stage; the check here is of the commit and the files, which are the same either way.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";

/** A whole commit: forty hex digits. */
export const WHOLE_COMMIT = /^[0-9a-f]{40}$/;

/** What RPE's manifest names for `rp-harness`: the whole name, and the commit after its `#`. */
export interface Named {
  name: string;
  commit: string | null;
}

export function manifestName(manifest: unknown): Named | null {
  const name = isRecord(manifest) && isRecord(manifest.dependencies) ? manifest.dependencies["rp-harness"] : undefined;
  if (typeof name !== "string") return null;
  const found = /#([0-9a-f]+)$/.exec(name);
  return { name, commit: found?.[1] ?? null };
}

/** The installed package folder's own tag, which `bun install` leaves: the commit it was installed at. */
export function installedTag(repo: string): string | null {
  const tag = join(repo, "node_modules", "rp-harness", ".bun-tag");
  return existsSync(tag) ? readFileSync(tag, "utf8").trim() : null;
}

/** A git command's output in `repo`, or null where git fails. */
function git(repo: string, args: string[], stdin?: string): string | null {
  const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "ignore" });
  return done.exitCode === 0 ? done.stdout.toString() : null;
}

/**
 * Why RPH is not held as the plan says, in plain words; empty when it is. `rphRepo` is a repository that holds the
 * commit (RPH's own, or its mirror on the bed): without one the installed files cannot be held to the commit's, and
 * that is a fault, never a pass.
 */
export function pinProblems(repo: string, rphRepo: string | null): string[] {
  const problems: string[] = [];
  const manifest: unknown = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const named = manifestName(manifest);
  if (named === null) return ["RPE's package.json names no rp-harness"];
  if (named.commit === null || !WHOLE_COMMIT.test(named.commit)) problems.push(`package.json names rp-harness as ${named.name}, which is not one whole commit (forty hex digits)`);
  const installed = join(repo, "node_modules", "rp-harness");
  if (!existsSync(installed)) return [...problems, "rp-harness is not installed"];
  if (lstatSync(installed).isSymbolicLink()) problems.push("the installed rp-harness is a link, not a real folder: a link is no pin");
  const tag = installedTag(repo);
  if (tag === null) problems.push("the installed rp-harness holds no .bun-tag: it was not installed from a commit");
  else if (named.commit !== null && tag !== named.commit) problems.push(`the installed rp-harness is ${tag.slice(0, 8)}, and package.json names ${named.commit.slice(0, 8)}`);
  if (named.commit === null || !WHOLE_COMMIT.test(named.commit)) return problems;
  if (rphRepo === null) return [...problems, "no RPH repository is named to hold the installed files against the commit's (RPE_PROOF_RPH_REPO)"];
  const listed = git(rphRepo, ["ls-tree", "-r", named.commit]);
  if (listed === null) return [...problems, `${rphRepo} does not hold the commit ${named.commit.slice(0, 8)}`];
  const files = listed
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [meta = "", path = ""] = line.split("\t");
      return { blob: meta.split(" ")[2] ?? "", path };
    });
  const present = files.filter((f) => existsSync(join(installed, f.path)));
  for (const f of files) if (!present.includes(f)) problems.push(`missing from the installed rp-harness: ${f.path}`);
  const hashes = (git(rphRepo, ["hash-object", "--no-filters", "--stdin-paths"], present.map((f) => join(installed, f.path)).join("\n") + "\n") ?? "").split("\n").filter((h) => h !== "");
  present.forEach((f, i) => {
    if (hashes[i] !== f.blob) problems.push(`differs from the commit's: ${f.path}`);
  });
  return problems;
}
