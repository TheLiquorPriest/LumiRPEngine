// Problems (DESIGN §13): the backend's full lint of the world, grouped by severity, each issue
// opening the item or the world part it points at.

import { useEffect, useState } from "preact/hooks";
import type { LintIssue, WorldCollection, WorldPart } from "../../shared/protocol";
import { useApp } from "../app";
import { Card, Empty, Seg, useBusy } from "../components";

const COLLECTIONS: readonly WorldCollection[] = ["kinds", "relations", "entities", "places", "maps", "routes", "grids", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps", "packs", "lore", "classifications"];
/** World parts whose issues open the part: `ruleset.progression.level.thresholds` → the Ruleset part. */
const PARTS: readonly WorldPart[] = ["calendar", "realism", "time", "ruleset"];

/** The editor an issue path opens: `entities.npc_dev.fields.cash` → entities / npc_dev. */
export function issueTarget(path: string): { collection: WorldCollection; id: string } | null {
  const [head, id] = path.split(".");
  const collection = COLLECTIONS.find((c) => c === head);
  return collection && id ? { collection, id } : null;
}

type Severity = LintIssue["severity"];

export function CheckView(props: { worldId: string }) {
  const app = useApp();
  const [issues, setIssues] = useState<LintIssue[] | null>(null);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [busy, run] = useBusy();
  const check = () =>
    run(async () => {
      const result = await app.request({ type: "lre.world", op: "lint", worldId: props.worldId });
      setIssues(result?.lint ?? []);
    });
  useEffect(check, [props.worldId]);
  const count = (s: Severity) => issues?.filter((i) => i.severity === s).length ?? 0;
  const shown = (issues ?? []).filter((i) => severity === "all" || i.severity === severity);
  return (
    <div class="lre-stack" data-lre-check>
      <div class="lre-spread">
        <span class="lre-h2">Problems</span>
        <button type="button" class="lre-btn small" disabled={busy} onClick={check}>
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      {issues === null ? (
        <Empty>Checking…</Empty>
      ) : issues.length === 0 ? (
        <div class="lre-banner info">No issues. The world is ready to play.</div>
      ) : (
        <>
          <Seg<Severity | "all">
            label="Severity"
            value={severity}
            options={[
              { value: "all", label: `All ${issues.length}` },
              { value: "error", label: `Errors ${count("error")}` },
              { value: "warning", label: `Warnings ${count("warning")}` },
              { value: "info", label: `Info ${count("info")}` },
            ]}
            onChange={(next) => setSeverity(next)}
          />
          <Card>
            {shown.map((issue, i) => {
              const target = issueTarget(issue.path);
              const part = target ? undefined : PARTS.find((p) => p === issue.path.split(".")[0]);
              return (
                <div key={`${issue.path}:${issue.code}:${i}`} class="lre-lint">
                  <span class={issue.severity === "error" ? "lre-badge neg" : issue.severity === "warning" ? "lre-badge warn" : "lre-badge"}>{issue.severity}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span>{issue.message}</span>
                    <span class="path" style={{ display: "block" }}>
                      {issue.path} · {issue.code}
                    </span>
                  </span>
                  {target ? (
                    <button type="button" class="lre-btn small" aria-label={`Open ${issue.path}`} onClick={() => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.worldId, collection: target.collection, id: target.id } }))}>
                      Open
                    </button>
                  ) : part ? (
                    <button type="button" class="lre-btn small" aria-label={`Open ${issue.path}`} onClick={() => app.ui.update((ui) => ({ ...ui, build: { view: "part", worldId: props.worldId, part } }))}>
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
