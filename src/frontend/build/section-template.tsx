// Build → Sections: a section's guidance, the template the narrator reads around its lines (DESIGN
// §6). Every section in force has a page: one the world lists edits its own template; a built-in
// one the world has without listing it (`builtInSectionsOf`) edits the world's wording of it,
// `sectionTemplates`, which stores only what differs from the built-in text.

import { useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { JsonPatchOp, LintIssue } from "../../shared/protocol";
import { hasOwn } from "../../shared/json";
import { builtInSectionsOf, DEFAULT_SECTIONS, LINES_MARKER, sectionTemplateProblem, storedSectionTemplates } from "../../shared/sections";
import type { SectionTemplate, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Banner, Button, Section, SaveBar, useBusy } from "../components";
import type { EditorProps } from "../registry";
import { useSelect } from "../store";
import { ItemHeader } from "./chrome";
import { useHeld } from "./held";
import { lintAt, TextInput } from "./schema-form";

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

/** The page of a built-in section the world has without listing it: its guidance, saved as the world's wording of it. */
export function BuiltInSectionEditor(props: EditorProps & { section: SectionTemplate }) {
  const app = useApp();
  const lint = useSelect(app.drafts, (d) => d?.lint ?? []);
  const id = props.section.id;
  const initial = builtInText(props.world, props.section);
  const [value, setValue] = useState(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/sectionTemplates/${id}`);
  const defaultText = DEFAULT_SECTIONS[id]?.template ?? props.section.template;
  const changed = value !== initial;
  return (
    <div class="lre-build-page" data-lre-editor="sections" data-lre-built-in={id}>
      <ItemHeader title={props.section.label} id={id} subtitle={value === defaultText ? "Built-in section" : "Built-in section, in this world's wording"} />
      <Banner tone="info">This world has this section without listing it, so its guidance is what you can change here; the rest of its settings are the built-in ones.</Banner>
      <Section>
        <SectionTemplateField value={value} defaultText={defaultText} issues={lintAt(lint, `sectionTemplates.${id}`)} disabled={busy} onChange={setValue} />
      </Section>
      <SaveBar>
        <Button
          variant="primary"
          disabled={!changed || sectionTemplateProblem(value) !== null}
          busy={busy}
          onClick={() =>
            run(async () => {
              const ops = sectionTemplatesPatch(props.world, id, value);
              if (ops.length > 0) await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
            })
          }
        >
          Save to draft
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
