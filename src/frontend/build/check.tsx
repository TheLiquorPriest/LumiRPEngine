// Problems (DESIGN §13; redesign contract §4.6): the backend's full lint of the world, filtered by
// severity, each issue saying where it is by name and opening the item or the world part it points
// at. `IssueRow` is Build's one problem row: Problems, a playtest's findings, an import's review and
// a Studio offer's problems all use it.

import { useEffect, useState } from "preact/hooks";
import type { WorldId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { LintIssue, WorldCollection, WorldPart } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, IdText, PageHeader, Section, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { useSelect } from "../store";
import { COLLECTION_INFO, go, itemLabel, PART_INFO } from "./chrome";

const COLLECTIONS: readonly WorldCollection[] = ["kinds", "relations", "entities", "places", "maps", "routes", "grids", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps", "packs", "lore", "classifications"];
/** World parts whose issues open the part: `ruleset.progression.level.thresholds` → the Ruleset part; `loreIndex.terms.ferry` → the lookup table. */
const PARTS: readonly WorldPart[] = ["calendar", "realism", "tiers", "time", "ruleset", "loreIndex"];
/** The world's own top-level fields, which the World part edits. */
const META_FIELDS: readonly string[] = ["name", "pov", "start", "seedMode", "lenientPricing", "spawnCap", "lifeStates", "currency", "mapSettings"];

/** The editor an issue path opens: `entities.npc_dev.fields.cash` → entities / npc_dev. */
export function issueTarget(path: string): { collection: WorldCollection; id: string } | null {
  const [head, id] = path.split(".");
  const collection = COLLECTIONS.find((c) => c === head);
  return collection && id ? { collection, id } : null;
}

/** The world part an issue path opens, when it isn't an item's: `tiers.crowd.band` → Tiers; `spawnTier` sits at the top level, but the Tiers part edits it, and the World part edits the world's own fields (`spawnCap`, `start.place`, `currency.code`…). */
export function issuePart(path: string): WorldPart | null {
  const head = path.split(".")[0] ?? "";
  return head === "spawnTier" ? "tiers" : META_FIELDS.includes(head) ? "meta" : (PARTS.find((p) => p === head) ?? null);
}

type Severity = LintIssue["severity"];

const SEVERITY: Record<Severity, { label: string; tone: "neg" | "warn" | "neutral" }> = {
  error: { label: "Error", tone: "neg" },
  warning: { label: "Warning", tone: "warn" },
  info: { label: "Info", tone: "neutral" },
};

/** An issue's severity in words, with an icon, so it never rests on colour alone. */
export function SeverityBadge(props: { severity: Severity }) {
  const severity = SEVERITY[props.severity];
  return (
    <Badge tone={severity.tone}>
      <Icon name={props.severity === "info" ? "info" : "alert"} size={12} />
      {severity.label}
    </Badge>
  );
}

/**
 * One problem: its severity, its message, where it is by name (its path and code under Show ids),
 * and Open when Build has a page for it in `worldId`'s world (none for a world not yet installed).
 */
export function IssueRow(props: { issue: LintIssue; worldId?: WorldId; doc?: WorldDoc }) {
  const app = useApp();
  const { issue, worldId, doc } = props;
  const target = issueTarget(issue.path);
  const part = target ? null : issuePart(issue.path);
  let where = issue.path;
  if (target) {
    const items = doc ? (doc[target.collection] as Record<string, unknown>) : {};
    where = `${COLLECTION_INFO[target.collection].label} › ${itemLabel(target.collection, target.id, hasOwn(items, target.id) ? items[target.id] : undefined, doc?.places)}`;
  } else if (part) where = PART_INFO[part].label;
  const open = worldId === undefined ? null : target ? () => go(app, { view: "item", worldId, collection: target.collection, id: target.id }) : part ? () => go(app, { view: "part", worldId, part }) : null;
  return (
    <div class="lre-lint" role="listitem" data-lre-issue={issue.code}>
      <span class="lre-lint-text">
        <SeverityBadge severity={issue.severity} />
        <span class="lre-lint-message">{issue.message}</span>
        <span class="lre-lint-where">{where}</span>
        <IdText id={`${issue.path} · ${issue.code}`} />
      </span>
      {open ? (
        <Button size="sm" label={`Open ${where}`} onClick={open}>
          Open
        </Button>
      ) : null}
    </div>
  );
}

export function CheckView(props: { worldId: WorldId }) {
  const app = useApp();
  const doc = useSelect(app.drafts, (d) => (d?.worldId === props.worldId ? d.doc : undefined));
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
    <div class="lre-build-page" data-lre-check>
      <PageHeader
        title="Problems"
        subtitle="The whole draft, checked as the engine will play it"
        actions={
          <Button size="sm" icon="refresh" busy={busy} onClick={check}>
            {busy ? "Checking…" : "Check again"}
          </Button>
        }
      />
      {issues === null ? (
        <Empty icon="hourglass">Checking the world…</Empty>
      ) : issues.length === 0 ? (
        <Banner tone="info" icon="check" title="No issues">
          The world is ready to play.
        </Banner>
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
          {shown.length === 0 ? (
            <Empty>Nothing at this severity.</Empty>
          ) : (
            <Section flush>
              <div class="lre-build-issues" role="list">
                {shown.map((issue, i) => (
                  <IssueRow key={`${issue.path}:${issue.code}:${i}`} issue={issue} worldId={props.worldId} doc={doc} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
