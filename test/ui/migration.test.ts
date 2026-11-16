// The Migration page, read from its view as drawn: before any run, the rehearsal's start with the folders it reads, the
// swap's steps and going back's with the permissions; after one, the real run in brief, the backup and whether it is there,
// what is waiting on the user, in RPE's own words. The lists read a page at a time are the routes' (test/migrate).

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { MigrationReply } from "../../src/shared/api";
import { PAGES } from "../../src/ui/page-list";
import { MigrationView } from "../../src/ui/pages/migration";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { MIGRATED, NOT_RUN } from "./migration-recorded";
import { elements, expand, textOf } from "./vnodes";

function view(shown: MigrationReply) {
  const tree = expand(h(MigrationView, { shown, starting: false, said: null, saving: null, of: "run", onOf: () => undefined, onRehearse: () => undefined, onSave: () => undefined, folder: null, onFolder: () => undefined }));
  return { tree, text: textOf(tree) };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);

describe("the Migration page", () => {
  test("before any run it offers the rehearsal over the folders it reads, and shows the swap's steps and going back's with the permissions", () => {
    const { tree } = view(NOT_RUN);
    expect(section(tree, "rehearsal")).toContain("Start a rehearsal");
    expect(section(tree, "rehearsal")).toContain("/srv/home/.config/lumiah");
    expect(section(tree, "run")).toContain("No real run of the migration has been made in this data folder yet.");
    for (const step of NOT_RUN.swap) expect(section(tree, "swap")).toContain(step);
    for (const step of NOT_RUN.goingBack.steps) expect(section(tree, "going-back")).toContain(step);
  });

  test("after a run: the run in brief, the backup with whether it is still there, what is waiting on the user, and every permission to approve again", () => {
    const { tree } = view(MIGRATED);
    expect(section(tree, "run")).toContain("every row balances");
    expect(section(tree, "backup")).toBe(`The backupWhere/srv/rpe/backups/before-migration.tarSize46.1 MBSHA-256${MIGRATED.backup?.sha256}Still there, at that sizeyes`);
    expect(section(view({ ...MIGRATED, backup: { ...(MIGRATED.backup ?? { path: "", bytes: 0, sha256: "" }), present: false } }).tree, "backup")).toContain("Still there, at that sizeno");
    const waiting = section(tree, "waiting");
    expect(waiting).toContain("Waiting on you (5)");
    expect(waiting).toContain("Your GUIDANCE.md is at imported/GUIDANCE.md, switched off.");
    expect(waiting).toContain("Chat chat-harbour: 1 edit waiting on keep or discard, 2 staged actions, 1 review card and a rollback never applied.");
    expect(waiting).not.toContain("undefined");
    const permissions = elements(tree).find((e) => e.props["data-permissions"] === "true");
    expect(elements(permissions?.props.children).filter((e) => e.type === "code").map((e) => textOf(e.props.children))).toEqual(MIGRATED.goingBack.permissions);
    expect(PAGES.find((n) => n.id === "migration")?.shells).toEqual(["web", "drawer"]);
    expect(routeOfHash(hashOf({ page: "migration" }))).toEqual({ page: "migration" });
  });
});
