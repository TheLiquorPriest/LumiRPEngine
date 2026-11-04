// Problems (DESIGN §13): the draft's full lint, filtered by severity, each issue saying where it is
// by name and opening the item or the world part it points at, with Fix where one press mends it
// (ITEMS-SPEC §10.1: a thing too big to carry, put where its holder stands). `IssueRow` is Build's
// one problem row: Problems, a playtest's findings and an import's review all use it.

import { useMemo, useState } from "preact/hooks";
import type { WorldId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { LintFix, LintIssue, WorldCollection, WorldPart } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { useApp, type BuildRoute } from "../app";
import { Badge, Banner, Button, Empty, IdText, PageHeader, Section, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { useSelect } from "../store";
import { COLLECTION_INFO, go, itemLabel, PART_INFO } from "./chrome";
import { draftSend, loadDraft } from "./draft";

const COLLECTIONS: readonly WorldCollection[] = ["kinds", "relations", "entities", "places", "maps", "routes", "grids", "rules", "actions", "checks", "routines", "schedules", "tracks", "tables", "sections", "steps", "packs", "lore", "classifications"];
/** World parts whose issues open the part: `ruleset.progression.level.thresholds` → the Ruleset part; `loreIndex.terms.ferry` → the lookup table; a step's pins (`lorePins.steps.mind`) → Pinned lore. */
const PARTS: readonly WorldPart[] = ["calendar", "realism", "tiers", "time", "ruleset", "loreIndex", "lorePins", "routineSettings", "needs"];
/** The world's own top-level fields, which the World part edits. */
const META_FIELDS: readonly string[] = ["name", "pov", "start", "seedMode", "lenientPricing", "spawnCap", "placeCap", "placesPerTurn", "lifeStates", "currency", "mapSettings"];

/** The editor an issue path opens: `entities.npc_dev.fields.cash` → entities / npc_dev; a pin's (`lorePins.characters.<id>`, `lorePins.places.<id>`) → the character's or place's page, where its pins are; a built-in section's wording (`sectionTemplates.<id>`) → that section's page. */
export function issueTarget(path: string): { collection: WorldCollection; id: string } | null {
  const [head, id, pinned] = path.split(".");
  if (head === "lorePins" && pinned) return id === "characters" ? { collection: "entities", id: pinned } : id === "places" ? { collection: "places", id: pinned } : null;
  if (head === "sectionTemplates" && id) return { collection: "sections", id };
  const collection = COLLECTIONS.find((c) => c === head);
  return collection && id ? { collection, id } : null;
}

/** Where an issue's Open goes in `worldId`'s world: its item, opened at the issue's path (a routine's block opens its sheet), or the world part it's in; null without a page. */
export function issueRoute(worldId: WorldId, path: string): BuildRoute | null {
  const target = issueTarget(path);
  if (target) return { view: "item", worldId, collection: target.collection, id: target.id, at: path };
  const part = issuePart(path);
  return part ? { view: "part", worldId, part } : null;
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
 * One problem as a row: its severity, its message, where it is by name (its path and code under
 * Show ids), Fix when it has one and the page offers it, and Open when it has a page.
 */
export function IssueLine(props: { issue: LintIssue; where: string; busy?: boolean; onOpen?(): void; onFix?(fix: LintFix): void }) {
  const { issue } = props;
  const fix = issue.fix;
  const onFix = props.onFix;
  const onOpen = props.onOpen;
  return (
    <div class="lre-lint" role="listitem" data-lre-issue={issue.code}>
      <span class="lre-lint-text">
        <SeverityBadge severity={issue.severity} />
        <span class="lre-lint-message">{issue.message}</span>
        <span class="lre-lint-where">{props.where}</span>
        <IdText id={`${issue.path} · ${issue.code}`} />
      </span>
      {fix && onFix ? (
        <Button size="sm" variant="primary" label={fix.label} title={fix.label} busy={props.busy} onClick={() => onFix(fix)}>
          Fix
        </Button>
      ) : null}
      {onOpen ? (
        <Button size="sm" label={`Open ${props.where}`} onClick={onOpen}>
          Open
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One problem: its row, opening the item or the world part it points at in `worldId`'s world (none
 * for a world not yet installed), and its fix when `onFix` applies one.
 */
export function IssueRow(props: { issue: LintIssue; worldId?: WorldId; doc?: WorldDoc; busy?: boolean; onFix?(fix: LintFix): void }) {
  const app = useApp();
  const { issue, worldId, doc } = props;
  const target = issueTarget(issue.path);
  const part = target ? null : issuePart(issue.path);
  let where = issue.path;
  if (target) {
    const items = doc ? ((doc[target.collection] ?? {}) as Record<string, unknown>) : {};
    where = `${COLLECTION_INFO[target.collection].label} › ${itemLabel(target.collection, target.id, hasOwn(items, target.id) ? items[target.id] : undefined, doc?.places)}`;
  } else if (part) where = PART_INFO[part].label;
  const route = worldId === undefined ? null : issueRoute(worldId, issue.path);
  return <IssueLine issue={issue} where={where} busy={props.busy} onOpen={route ? () => go(app, route) : undefined} onFix={props.onFix} />;
}

/** Problems: the draft's whole lint as the engine will play it, by severity, each issue with Open and, where one press mends it, Fix. */
export function CheckView(props: { worldId: WorldId }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => (d?.worldId === props.worldId ? d : undefined));
  const send = useMemo(() => draftSend(app), [app]);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [busy, run] = useBusy();
  const check = () =>
    run(async () => {
      await loadDraft(app, props.worldId);
    });
  const fix = (next: LintFix) =>
    run(async () => {
      await send({ type: "lre.editor", worldId: props.worldId, base: null, op: "patch", ops: next.ops });
    });
  const issues = draft?.lint ?? null;
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
                  <IssueRow key={`${issue.path}:${issue.code}:${i}`} issue={issue} worldId={props.worldId} doc={draft?.doc} busy={busy} onFix={fix} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
