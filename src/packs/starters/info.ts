// What each starter world is, for anyone choosing one without loading it (DESIGN §23): the names
// Build's template picker uses, and each template's blurb from data-src/templates. Kept apart from
// the worlds themselves, so reading it loads none of them.

/** A starter world a new world can start from. */
export interface TemplateInfo {
  id: string;
  name: string;
  /** One or two sentences on what it holds. */
  summary: string;
}

export const STARTER_INFO: readonly TemplateInfo[] = [
  {
    id: "fantasy_town",
    name: "Fantasy town",
    summary: "A river-ford market town on the eve of harvest: a stopped mill, a sick child across the water, and a chapel bell that has been silent for thirty years.",
  },
  {
    id: "mystery_manor",
    name: "Mystery manor",
    summary: "A storm cuts a fenland country house off from the world on Friday night. By Saturday morning the host is dead and everyone under the roof has something to hide.",
  },
  {
    id: "modern_slice_of_life",
    name: "Modern slice-of-life",
    summary: "A small Michigan lake town in the last good weeks of boating season: a garage that needs you, a loan and a landlord to keep paid, a friend with a pontoon, and a harbor festival on the way.",
  },
];
