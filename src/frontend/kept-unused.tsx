// The foot of a part that keeps fields nothing RPE runs reads, drawn by Build's parts and by the World page's check rules. A light
// module on the shared atoms alone, so the extension's first file may hold it (`LIGHT_REFUSES` in scripts/build.ts).

import { Disclosure } from "./components";

/**
 * The foot of a part that keeps fields nothing RPE runs reads: one closed line, naming each field the world's file still holds. They
 * stay as the file has them; saving the part leaves them alone. Nothing shows when the file holds none of them.
 */
export function KeptUnused(props: { fields: readonly { key: string; label: string }[]; held: Readonly<Record<string, unknown>> }) {
  const kept = props.fields.filter((field) => props.held[field.key] !== undefined);
  if (kept.length === 0) return null;
  return (
    <Disclosure summary="Kept in the file, not used by this build">
      <p class="lre-build-note">Your world's file still holds these, and RPE does not use them. Saving this page leaves them as they are.</p>
      <ul class="lre-build-note">
        {kept.map((field) => (
          <li key={field.key}>{field.label}</li>
        ))}
      </ul>
    </Disclosure>
  );
}
