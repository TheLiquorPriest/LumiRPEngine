// Build → Ruleset → Start from a profile… (DESIGN §11): pick a profile, see what it adds to the
// draft and what it would change, keep or take each conflicting item, and apply it in one write
// (`lre.editor profile`). The preview is the plan the backend applies (`shared/profiles`), read
// here on the draft with the packs' kinds, so what it shows is what the write does.

import { useMemo, useState } from "preact/hooks";
import { planProfile, PROFILE_IDS, PROFILES, type ProfileChoice, type ProfileGroup, type ProfileId } from "../../shared/profiles/index";
import type { Draft } from "../app";
import { useApp } from "../app";
import { Badge, Button, IdText, Row, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { draftSend } from "./draft";

const GROUPS: readonly { id: ProfileGroup; label: string }[] = [
  { id: "fields", label: "Fields" },
  { id: "checks", label: "Checks" },
  { id: "actions", label: "Actions" },
  { id: "tables", label: "Data tables" },
  { id: "ruleset", label: "Ruleset" },
];

const KEEP_OR_TAKE = [
  { value: "mine" as const, label: "Keep mine" },
  { value: "profile" as const, label: "Take the profile's" },
];

/** `blocked`: why applying waits (unsaved ruleset edits), or null. */
export function ProfilePicker(props: { draft: Draft; blocked: string | null; onDone(): void }) {
  const app = useApp();
  const send = useMemo(() => draftSend(app), [app]);
  const [id, setId] = useState<ProfileId>("modern");
  const [choices, setChoices] = useState<Record<string, ProfileChoice>>({});
  const [busy, run] = useBusy();
  const profile = PROFILES[id];
  const plan = useMemo(() => planProfile(props.draft.doc, profile, props.draft.packKinds, choices), [props.draft.doc, props.draft.packKinds, profile, choices]);
  const added = plan.items.filter((i) => i.status === "add");
  const conflicts = plan.items.filter((i) => i.status === "conflict");
  const same = plan.items.length - added.length - conflicts.length;
  // Applying again changes nothing once everything is in place and the profile is recorded.
  const nothing = added.length === 0 && conflicts.every((c) => choices[c.path] !== "profile") && plan.values.length === 0 && props.draft.doc.ruleset?.profile === id;
  const apply = () =>
    run(async () => {
      const message = await send({ type: "lre.editor", worldId: props.draft.worldId, base: props.draft.base, op: "profile", profile: id, choices });
      if (message.type !== "lre.result") return;
      app.toast(`Applied the ${profile.label} profile to the draft.`, "info");
      props.onDone();
    });
  return (
    <div class="lre-stack lre-build-profile" data-lre-profile-picker={id}>
      <Seg
        label="Profile"
        value={id}
        disabled={busy}
        options={PROFILE_IDS.map((p) => ({ value: p, label: PROFILES[p].label }))}
        onChange={(next) => {
          setId(next);
          setChoices({});
        }}
      />
      <p class="lre-build-note">{profile.summary}</p>
      {GROUPS.map((group) => {
        const items = added.filter((i) => i.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} class="lre-build-profile-group" data-lre-profile-group={group.id}>
            <span class="lre-build-profile-head">
              {group.id === "fields" ? `Fields added to ${plan.kind.label}` : `${group.label} added`} <Badge>{items.length}</Badge>
            </span>
            <div class="lre-build-chips">
              {items.map((i) => (
                <Badge key={i.path} tone="accent">
                  {i.label}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
      {conflicts.length > 0 ? (
        <div class="lre-build-profile-group" data-lre-profile-conflicts>
          <span class="lre-build-profile-head">
            Already in this world, different <Badge tone="warn">{conflicts.length}</Badge>
          </span>
          {conflicts.map((c) => (
            // The choice sits under its label: two long buttons don't fit beside it at 390 px.
            <div key={c.path} class="lre-build-profile-conflict" data-lre-conflict={c.path}>
              <span>
                {c.label} <IdText id={c.path} />
              </span>
              <Seg label={`${c.label}: keep yours or take the profile's`} value={choices[c.path] ?? "mine"} options={KEEP_OR_TAKE} disabled={busy} onChange={(choice) => setChoices((prev) => ({ ...prev, [c.path]: choice }))} />
            </div>
          ))}
        </div>
      ) : null}
      {same > 0 ? <p class="lre-build-note">{same === 1 ? "1 item already matches this world." : `${same} items already match this world.`}</p> : null}
      {plan.kind.copied ? (
        <p class="lre-build-note lre-warn">
          <Icon name="info" size={16} /> {plan.kind.label} comes from a pack, so the world gets its own copy of it, with every field the pack gives it, to hold the new ones.
        </p>
      ) : null}
      <p class="lre-build-note">
        {plan.people === 1 ? "1 person" : `${plan.people} people`} of the {plan.kind.label} kind read the new fields' defaults.
        {plan.values.length === 0 ? " Nobody's stored values change." : " These stored values don't fit the new fields and change:"}
      </p>
      {plan.values.map((v) => (
        <Row key={`${v.entity}:${v.field}`} k={`${v.name}: ${v.field}`} v={`${JSON.stringify(v.from)} → ${v.to === null ? "the default" : JSON.stringify(v.to)}`} tone="warn" />
      ))}
      {props.blocked ? (
        <p class="lre-build-note lre-warn">
          <Icon name="alert" size={16} /> {props.blocked}
        </p>
      ) : null}
      <div class="lre-build-actions">
        <Button variant="primary" disabled={nothing || props.blocked !== null} busy={busy} onClick={apply}>
          {nothing ? "Nothing to apply" : "Apply to draft"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
