// Build → Sections: a section's guidance, the template the narrator reads around its lines (DESIGN
// §6). Every section in force has a page: one the world lists edits its own template; a built-in
// one the world has without listing it (`builtInSectionsOf`) edits the world's wording of it,
// `sectionTemplates`, which stores only what differs from the built-in text. The Gear section's
// page also sets how many lines tell what of the player character's isn't with them (ITEMS-SPEC
// §5.5, §11), which the gear pack keeps in its config (`notWithYou`).

import { useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { JsonPatchOp, LintIssue } from "../../shared/protocol";
import { hasOwn, isRecord } from "../../shared/json";
import { builtInSectionsOf, DEFAULT_SECTIONS, LINES_MARKER, sectionTemplateProblem, storedSectionTemplates } from "../../shared/sections";
import { thingsConfigOf } from "../../shared/things";
import type { SectionTemplate, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Banner, Button, Section, SaveBar, useBusy } from "../components";
import type { EditorProps } from "../registry";
import { useSelect } from "../store";
import { ItemHeader } from "./chrome";
import { useHeld } from "./held";
import { lintAt, NumberInput, TextInput } from "./schema-form";

/** What the guidance field says of itself. */
export const SECTION_TEMPLATE_HELP = `What the narrator reads about this section: what it holds and how to write from it. ${LINES_MARKER} marks where the section's lines go, and must stay in it.`;

/**
 * A section's guidance: its template, with `{{lines}}` checked, and Reset to default where the
 * section is a built-in one (`defaultText`). Hook-free, so its controls can be pressed in tests.
 */
export function SectionTemplateField(props: { value: string; defaultText: string | null; issues: readonly LintIssue[]; disabled?: boolean; onChange(value: string): void }) {
  const problem = sectionTemplateProblem(props.value);
  const issues: LintIssue[] = [...(problem === null ? [] : [{ severity: "error" as const, path: "", code: "section_lines", message: `The guidance ${problem}.` }]), ...props.issues];
  const defaultText = props.defaultText;
  return (
    <div data-lre-section-template>
      <TextInput label="Guidance" multiline value={props.value} hint={SECTION_TEMPLATE_HELP} issues={issues} onChange={(next) => props.onChange(typeof next === "string" ? next : "")} />
      {defaultText !== null ? (
        <div class="lre-inline">
          <Button size="sm" variant="ghost" icon="undo" disabled={props.disabled || props.value === defaultText} onClick={() => props.onChange(defaultText)}>
            Reset to default
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The built-in section a world has without listing it, by id; null for one it lists itself or none. */
export function builtInSection(world: Pick<WorldDoc, "sections">, id: string): SectionTemplate | null {
  return builtInSectionsOf(world).find((s) => s.id === id) ?? null;
}

/** A built-in section's guidance as the world words it: its own wording, else the built-in text. */
export function builtInText(world: Pick<WorldDoc, "sectionTemplates">, section: SectionTemplate): string {
  const own = world.sectionTemplates ?? {};
  const text = hasOwn(own, section.id) ? own[section.id] : undefined;
  return typeof text === "string" ? text : section.template;
}

/** The patch that words the built-in section `id` as `text`: only wording that differs from the built-in text is kept, and none left removes the part. */
export function sectionTemplatesPatch(world: Pick<WorldDoc, "sectionTemplates">, id: string, text: string): JsonPatchOp[] {
  const next = storedSectionTemplates({ ...(world.sectionTemplates ?? {}), [id]: text });
  if (Object.keys(next).length > 0) return [{ op: "add", path: "/sectionTemplates", value: next as JsonObject }];
  return world.sectionTemplates === undefined ? [] : [{ op: "remove", path: "/sectionTemplates" }];
}

/** Build → Sections' rows: every section in force, in rank order, the world's own and the built-in ones it has without listing them (their issues at `sectionTemplates.<id>`). */
export function sectionRows(world: Pick<WorldDoc, "sections" | "sectionTemplates">): { id: string; value: unknown; label: string; path: string; note: string | undefined }[] {
  const own = Object.values(world.sections).map((s) => ({ section: s, path: `sections.${s.id}`, note: undefined }));
  const builtIn = builtInSectionsOf(world).map((s) => ({ section: s, path: `sectionTemplates.${s.id}`, note: builtInText(world, s) === s.template ? "Built-in" : "Built-in, in this world's wording" }));
  return [...own, ...builtIn].sort((a, b) => a.section.rank - b.section.rank).map((r) => ({ id: r.section.id, value: r.section, label: r.section.label || r.section.id, path: r.path, note: r.note }));
}

/** Where the Gear section's Not with you lines are kept, as lint names it. */
export const NOT_WITH_YOU_PATH = "packs.gear.config.notWithYou";

/** The Gear section's Not with you lines (ITEMS-SPEC §5.5, §11): how many of the player character's own things that go about with them, and aren't with them now, the section tells. */
export function NotWithYouField(props: { value: number; issues: readonly LintIssue[]; onChange(value: number): void }) {
  return (
    <NumberInput
      label="Not with you, at most lines"
      value={props.value}
      min={0}
      step={1}
      hint="How many of your character's things that go about with them (their phone, their keys) the section tells when they aren't with them, with where each is; 0 tells none"
      issues={props.issues}
      onChange={(next) => {
        if (typeof next === "number" && Number.isInteger(next) && next >= 0) props.onChange(next);
      }}
    />
  );
}

/** The patch that sets the Gear section's Not with you lines in the gear pack's config; none when they read so already, or the world has no gear pack. */
export function notWithYouPatch(world: Pick<WorldDoc, "packs">, lines: number): JsonPatchOp[] {
  const gear = hasOwn(world.packs, "gear") ? world.packs.gear : undefined;
  if (!gear || thingsConfigOf(world).notWithYou === lines) return [];
  return isRecord(gear.config) ? [{ op: "add", path: "/packs/gear/config/notWithYou", value: lines }] : [{ op: "add", path: "/packs/gear/config", value: { notWithYou: lines } }];
}

/** The page of a built-in section the world has without listing it: its guidance, saved as the world's wording of it, and the Gear section's Not with you lines. */
export function BuiltInSectionEditor(props: EditorProps & { section: SectionTemplate }) {
  const app = useApp();
  const lint = useSelect(app.drafts, (d) => d?.lint ?? []);
  const id = props.section.id;
  const initial = builtInText(props.world, props.section);
  const [value, setValue] = useState(initial);
  const gear = id === "gear" && hasOwn(props.world.packs, "gear");
  const initialLines = thingsConfigOf(props.world).notWithYou;
  const [lines, setLines] = useState(initialLines);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/sectionTemplates/${id}`);
  const defaultText = DEFAULT_SECTIONS[id]?.template ?? props.section.template;
  const changed = value !== initial || (gear && lines !== initialLines);
  return (
    <div class="lre-build-page" data-lre-editor="sections" data-lre-built-in={id}>
      <ItemHeader title={props.section.label} id={id} subtitle={value === defaultText ? "Built-in section" : "Built-in section, in this world's wording"} />
      <Banner tone="info">This world has this section without listing it, so its guidance is what you can change here; the rest of its settings are the built-in ones.</Banner>
      <Section>
        <SectionTemplateField value={value} defaultText={defaultText} issues={lintAt(lint, `sectionTemplates.${id}`)} disabled={busy} onChange={setValue} />
      </Section>
      {gear ? (
        <Section>
          <NotWithYouField value={lines} issues={lintAt(lint, NOT_WITH_YOU_PATH)} onChange={setLines} />
        </Section>
      ) : null}
      <SaveBar>
        <Button
          variant="primary"
          disabled={!changed || sectionTemplateProblem(value) !== null}
          busy={busy}
          onClick={() =>
            run(async () => {
              const ops = [...(value !== initial ? sectionTemplatesPatch(props.world, id, value) : []), ...(gear ? notWithYouPatch(props.world, lines) : [])];
              if (ops.length > 0) await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
            })
          }
        >
          Save to draft
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !changed}
          onClick={() => {
            setValue(initial);
            setLines(initialLines);
          }}
        >
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
