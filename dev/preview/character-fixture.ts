// The character pickers' preview data (`?pickers`): a world of 320 places, four roots and six deep
// (towns, districts, buildings, floors, flats, rooms, closets), as large as the user's own world, with
// names that repeat (every flat has a Kitchen), a secret building and hidden rooms; things lying
// about; and one character, Maya Chen, at home in Riverton's Elm Street Apartments. Tests read it too.

import type { CharacterDTO, PlaceRef, ThingRef } from "../../src/shared/character";
import type { PlaceVisibility } from "../../src/shared/ids";

function place(id: string, name: string, parent: PlaceRef | null, visibility: PlaceVisibility = "public"): PlaceRef {
  return { id, name, path: parent ? [...parent.path, parent.name] : [], parent: parent?.id ?? null, visibility };
}

const TOWNS: readonly [string, string, number][] = [
  ["riverton", "Riverton", 4],
  ["port_alder", "Port Alder", 4],
  ["cedar_hollow", "Cedar Hollow", 3],
  ["lake_county", "Lake County", 2],
];
const DISTRICTS = ["Elm Street", "Old Town", "Harbor", "Mill Row"];
const BUILDINGS = ["Apartments", "Court", "House", "Works"];

/** Every place, parents before their children: 4 towns, 13 districts, 52 buildings, 32 floors, 64 flats, 128 rooms and 27 closets. */
function buildPlaces(): PlaceRef[] {
  const out: PlaceRef[] = [];
  const add = (p: PlaceRef): PlaceRef => (out.push(p), p);
  let floors = 0;
  for (const [id, name, count] of TOWNS) {
    const town = add(place(id, name, null));
    for (const d of DISTRICTS.slice(0, count)) {
      const district = add(place(`${id}_${d.toLowerCase().replace(/ /g, "_")}`, d, town));
      BUILDINGS.forEach((kind, b) => {
        const building = add(place(`${district.id}_b${b + 1}`, `${d} ${kind}`, district, d === "Harbor" && b === 3 ? "secret" : "public"));
        if (floors >= 32) return;
        floors++;
        const floor = add(place(`${building.id}_f1`, "Floor 1", building));
        for (const unit of ["1A", "2B"]) {
          const flat = add(place(`${floor.id}_u${unit === "1A" ? 1 : 2}`, `Apartment ${unit}`, floor));
          add(place(`${flat.id}_kitchen`, "Kitchen", flat));
          add(place(`${flat.id}_bedroom`, "Bedroom", flat, floors % 7 === 3 ? "discoverable" : "public"));
        }
      });
    }
  }
  for (const p of [...out]) {
    if (out.length >= 320) break;
    if (p.name === "Bedroom") add(place(`${p.id}_closet`, "Closet", p));
  }
  return out;
}

export const PICKER_PLACES: PlaceRef[] = buildPlaces();

function byId(id: string): PlaceRef {
  const p = PICKER_PLACES.find((x) => x.id === id);
  if (!p) throw new Error(`no place ${id}`);
  return p;
}

/** Maya's home: Riverton › Elm Street › Elm Street Apartments › Floor 1 › Apartment 2B. */
const HOME = "riverton_elm_street_b1_f1_u2";

/** A place inside their home with its path from the home down (the home's name first), as `lre.character`'s bed choices give it. */
function inHome(id: string): PlaceRef {
  const p = byId(id);
  return { ...p, path: p.path.slice(byId(HOME).path.length) };
}

function thing(id: string, name: string, kind: string, at: string): ThingRef {
  return { id, name, kind, place: byId(at) };
}

export const PICKER_THINGS: ThingRef[] = [
  thing("maya_bed", "Double bed", "item", `${HOME}_bedroom`),
  thing("maya_futon", "Futon", "item", `${HOME}_kitchen`),
  thing("maya_kettle", "Kettle", "item", `${HOME}_kitchen`),
  thing("dev_couch", "Old couch", "item", "riverton_old_town_b1_f1_u1_kitchen"),
  thing("harbor_hammock", "Hammock", "item", "riverton_harbor_b2_f1_u1_bedroom"),
  thing("camp_bag", "Sleeping bag", "item", "port_alder_mill_row_b1_f1_u1_kitchen"),
  thing("civic", "Honda Civic", "vehicle", "riverton_elm_street"),
];

export const PICKER_CHARACTER: CharacterDTO = {
  id: "maya",
  name: "Maya Chen",
  kind: { id: "person", label: "Person" },
  tier: { id: "supporting", label: "Supporting" },
  pov: false,
  agent: true,
  life: { state: "alive", label: "Alive" },
  visibility: "public",
  place: byId("riverton_old_town_b2"),
  inside: null,
  home: byId(HOME),
  bed: { kind: "home", place: byId(HOME), item: null },
  bedChoices: {
    // Nearest first, then by name; then everything lying in the home, the likely beds first: as `lre.character` answers.
    places: [inHome(`${HOME}_bedroom`), inHome(`${HOME}_kitchen`), inHome(`${HOME}_bedroom_closet`)],
    items: PICKER_THINGS.filter((t) => t.place?.id.startsWith(HOME)),
  },
  employer: null,
  schedules: [{ id: "maya_place", label: "Weekdays 6:00 AM–2:00 PM: Daybreak Café", summary: "Weekdays 6:00 AM–2:00 PM: Daybreak Café" }],
  relations: [
    { type: "regard", typeLabel: "Regard", group: "feelings", to: { id: "you", name: "Sam Rivera" }, words: "warm" },
    { type: "member_of", typeLabel: "Member of", group: "groups", to: { id: "chen_household", name: "The Chens" }, words: "Role: Daughter" },
  ],
  sections: [{ id: "identity", fields: [{ id: "traits", label: "Traits", type: "list", of: "text", value: ["patient", "night owl"] }] }],
};

/** Where the player character is, for the pickers' "Where Sam is" suggestion. */
export const PICKER_POV_PLACE: PlaceRef = byId("riverton_harbor_b1");
