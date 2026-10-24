// The character pickers in the preview (`?pickers`): the place picker, the bed picker and a list of
// text as Build's Character page and GM's Character sheet will hold them, in the drawer at its real
// width, over the 320-place fixture. Picks update the page, so each sheet can be tried end to end.

import { render } from "preact";
import { useState } from "preact/hooks";
import type { CharacterBed, PlaceRef } from "../../src/shared/character";
import { BedPicker, bedValue } from "../../src/frontend/character/bed-picker";
import { PlacePicker, PlacePath, PlaceSheet } from "../../src/frontend/character/place-picker";
import { TextListEditor } from "../../src/frontend/character/text-list";
import { Button, Section } from "../../src/frontend/components";
import { CSS } from "../../src/frontend/styles";
import { PICKER_CHARACTER, PICKER_PLACES, PICKER_POV_PLACE, PICKER_THINGS } from "./character-fixture";

function PickersPage() {
  const [home, setHome] = useState<PlaceRef | null>(PICKER_CHARACTER.home);
  const [place, setPlace] = useState<PlaceRef | null>(PICKER_CHARACTER.place);
  const [bed, setBed] = useState<CharacterBed>(PICKER_CHARACTER.bed);
  const [traits, setTraits] = useState<string[]>(["patient", "night owl"]);
  const [moving, setMoving] = useState(false);
  const suggestions = [...(place ? [{ label: "Where they are", place }] : []), ...(home ? [{ label: "Their home", place: home }] : []), { label: "Where Sam is", place: PICKER_POV_PLACE }];
  const character = { ...PICKER_CHARACTER, home, place, bed };
  return (
    <div class="lre-stack" data-lre-pickers-preview="">
      <Section title="Where they live">
        <div class="lre-stack">
          <PlacePicker places={PICKER_PLACES} value={home?.id ?? null} title="Their home" label="Home" clearLabel="No home" suggestions={suggestions} onPick={setHome} />
          <BedPicker character={character} places={PICKER_PLACES} things={PICKER_THINGS} onPick={setBed} />
          <span class="lre-small lre-muted">The bed field would be written as {JSON.stringify(bedValue(bed))}.</span>
          <PlacePicker places={PICKER_PLACES} value={place?.id ?? null} title="Where the story starts them" suggestions={suggestions} onPick={setPlace} />
        </div>
      </Section>
      <Section title="Now">
        <div class="lre-stack">
          <PlacePath place={place} />
          <Button icon="pin" onClick={() => setMoving(true)}>
            Move them…
          </Button>
        </div>
      </Section>
      <Section title="Who they are">
        <TextListEditor label="Traits" value={traits} placeholder="A trait, like “stubborn”" onChange={setTraits} />
      </Section>
      {moving ? <PlaceSheet places={PICKER_PLACES} value={place?.id ?? null} title="Move Maya Chen" suggestions={suggestions} onClose={() => setMoving(false)} onPick={(p) => (setMoving(false), setPlace(p))} /> : null}
    </div>
  );
}

/** Mounts the page in the drawer, styled as the extension styles it, in place of the app; returns its teardown, as `setup` does. */
export function mountPickers(): () => void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const title = document.getElementById("drawer-title-text");
  if (title) title.textContent = "Character pickers";
  const root = document.createElement("div");
  document.getElementById("drawer-panel")?.appendChild(root);
  render(
    <div class="lre lre-drawer" data-lre-mode="build">
      <div class="lre-mode-body">
        <PickersPage />
      </div>
    </div>,
    root,
  );
  return () => {
    render(null, root);
    root.remove();
    style.remove();
  };
}
