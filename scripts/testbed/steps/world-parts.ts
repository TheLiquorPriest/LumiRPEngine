// The invented parts the test world adds to the engine's modern starter, so that every part of a
// world document holds something (STANDALONE-PLAN §15.2, "What a world holds"): a map drawn in
// squares the size of a town block, its own lore with a secret only one person holds and one behind
// a gate, a lore index and pins, a club, a quest, a vehicle, money, a routine, needs, minds and the
// rest. All of it is made up for the test; the starter's own town stays as it ships. The world's own
// `sections` stay empty: a section of the world's own stands in place of the engine's narrator
// sections, and a classic turn then has nothing to fill the prompt with.

type Op = { op: "add" | "replace"; path: string; value: unknown };

/** Where the book entry the world pins lives (`book` step). */
export interface BookRef {
  bookId: string;
  entryId: string;
}

/** The first revision's additions. */
export function worldParts(book: BookRef): Op[] {
  return [
    // A map of the town in squares of 100 m, about a town block each, scoped to the town itself.
    {
      op: "add",
      path: "/maps/harbor_blocks",
      value: {
        id: "harbor_blocks",
        scope: "port_alder",
        title: "Port Alder by the block",
        cellMeters: 100,
        layout: ["hhhhpppp", "hhhhpppp", "mmmm.ss.", "mmmm.ss."],
        legend: { h: { place: "pa_block_harbor" }, p: { place: "pa_block_lakefront" }, m: { place: "pa_block_market" }, s: { place: "pa_block_school" } },
        places: [
          { id: "pa_block_harbor", name: "Harbor Row blocks" },
          { id: "pa_block_lakefront", name: "Lakefront blocks" },
          { id: "pa_block_market", name: "Market Street blocks" },
          { id: "pa_block_school", name: "School blocks" },
        ],
      },
    },
    { op: "add", path: "/mapSettings", value: { display: "knowledge", grid: { movement: false, sightRadius: 3 } } },

    // The world's own lore: one only Dale holds, one behind a gate, one readable once the player knows the place.
    {
      op: "add",
      path: "/lore/lore_marina_ledger",
      value: {
        id: "lore_marina_ledger",
        title: "The marina's second ledger",
        content: "Dale Whitcomb keeps a second ledger in the bait shed, where he writes down the slip fees he lets slide for families who can't pay.",
        keys: ["second ledger", "bait shed ledger"],
        links: ["dale_whitcomb", "alder_harbor_marina"],
        secret: true,
        gate: "stage('s_shop_trouble') == 'truth'",
        audience: ["npc.choose"],
        holders: ["dale_whitcomb"],
      },
    },
    {
      op: "add",
      path: "/lore/lore_fleet_stall",
      value: {
        id: "lore_fleet_stall",
        title: "Why the township stalls the fleet job",
        content: "The township clerk is waiting on a second quote from a dealer two counties over before she signs the fleet contract.",
        keys: ["fleet quote", "second quote"],
        links: ["township_hall"],
        secret: true,
        gate: "flag('fleet_deal_accepted')",
        audience: ["npc.choose"],
      },
    },
    {
      op: "add",
      path: "/lore/lore_birch_lane_garden",
      value: {
        id: "lore_birch_lane_garden",
        title: "The garden on Birch Lane",
        content: "Behind number 12 on Birch Lane there is a vegetable garden Marcus waters every evening before dark.",
        keys: ["birch lane garden"],
        links: ["birch_lane_12"],
        visibility: "known_by",
      },
    },
    {
      op: "add",
      path: "/lore/lore_harbor_blocks",
      value: {
        id: "lore_harbor_blocks",
        title: "How Port Alder counts its blocks",
        content: "People in Port Alder give directions in blocks: Harbor Row, the Lakefront, Market Street and the School blocks, each about a hundred metres on a side.",
        keys: ["harbor row", "market street", "blocks"],
        links: ["port_alder"],
      },
    },
    {
      op: "replace",
      path: "/loreIndex",
      value: {
        terms: { "second ledger": ["lore_marina_ledger"], "fleet quote": ["lore_fleet_stall"], blocks: ["lore_harbor_blocks"] },
        topics: { town_life: { label: "Town life", entries: ["lore_harbor_blocks", "lore_birch_lane_garden"] } },
      },
    },
    {
      op: "add",
      path: "/lorePins",
      value: {
        characters: { dale_whitcomb: [{ lore: "lore_marina_ledger" }] },
        places: { alder_harbor_marina: [{ book: book.bookId, entry: book.entryId }], port_alder: [{ lore: "lore_harbor_blocks", keep: "end" }] },
        steps: {},
      },
    },
    { op: "add", path: "/loreBooks", value: [book.bookId] },

    // A club the player belongs to, with dues; a quest; a vehicle; an account and a standing payment; a thing.
    {
      op: "add",
      path: "/entities/harbor_watch",
      value: {
        id: "harbor_watch",
        kind: "group",
        name: "Port Alder Harbor Watch",
        tier: "background",
        fields: {
          positions: [
            { id: "chair", title: "Chair", powers: ["members.admit", "members.remove", "money.spend", "org.govern"], seats: 1 },
            { id: "volunteer", title: "Volunteer", powers: [], seats: 0, reports_to: "chair", default: true },
          ],
          dues: [{ cents: 1000, every: "month", day: 1 }],
        },
        relations: [],
      },
    },
    { op: "add", path: "/entities/dale_whitcomb/relations/-", value: { type: "member_of", to: "harbor_watch", fields: { position: "chair", since: "2019-05-01" } } },
    { op: "add", path: "/entities/pov/relations/-", value: { type: "member_of", to: "harbor_watch", fields: { position: "volunteer", since: "2026-06-01" } } },
    {
      op: "add",
      path: "/entities/pov_bicycle",
      value: { id: "pov_bicycle", kind: "vehicle", name: "Blue town bicycle", tier: "background", fields: { place: "harbor_street_114", owner: "pov", class: "bicycle", status: "ok", home: "harbor_street_114", description: "A blue three-speed with a wire basket." }, relations: [] },
    },
    {
      op: "add",
      path: "/entities/acct_pov_boat_fund",
      value: { id: "acct_pov_boat_fund", kind: "account", name: "Boat fund", tier: "background", fields: { owners: [{ party: "pov", role: "owner" }], product: "savings", opening: 12000, institution: "Lakeshore Credit Union" }, relations: [] },
    },
    {
      op: "add",
      path: "/entities/flow_pov_boat_fund",
      value: { id: "flow_pov_boat_fund", kind: "flow", name: "Into the boat fund", tier: "background", fields: { flow_kind: "savings", from: "acct_pov_checking", to: "acct_pov_boat_fund", amount_cents: 2500, every: "week", interval: 2, weekdays: [5], start: "2026-09-18", shortfall: "skip" }, relations: [] },
    },
    {
      op: "add",
      path: "/entities/watch_logbook",
      value: { id: "watch_logbook", kind: "item", name: "Harbor Watch logbook", tier: "background", fields: { place: "alder_harbor_marina", owner: "harbor_watch", size: "hand", description: "A green logbook of who walked the docks each night." }, relations: [] },
    },
    {
      op: "add",
      path: "/tracks/q_walk_the_blocks",
      value: {
        id: "q_walk_the_blocks",
        kind: "quest",
        label: "Walk the Harbor Watch round",
        start: "offer",
        visibility: "public",
        stages: {
          offer: { label: "Dale asks for a volunteer", next: [{ to: "done", when: "at(pov, 'alder_harbor_marina')" }], objectives: [{ label: "Report to the marina", when: "at(pov, 'alder_harbor_marina')" }], cue: "Dale needs someone to walk the docks tonight." },
          done: { label: "Round walked", next: [], cue: "The logbook has your name in it." },
        },
      },
    },

    // The rest of the document's parts: a relation type, a classification, a life state, a routine, needs, minds and the narrator.
    { op: "add", path: "/relations/mentors", value: { id: "mentors", label: "Mentors", from: "character", to: "character", cardinality: "many_many", symmetric: false, fields: {} } },
    { op: "add", path: "/classifications/watch_role", value: { id: "watch_role", label: "Harbor Watch role", multiple: false, values: { regular: { label: "Regular" }, newcomer: { label: "Newcomer" } } } },
    { op: "add", path: "/lifeStates", value: { seasick: { label: "Seasick", acts: true, reads: "is seasick" } } },
    { op: "add", path: "/spawnTier", value: "background" },
    {
      op: "add",
      path: "/routines",
      value: {
        dale_mornings: { id: "dale_mornings", owner: "dale_whitcomb", blocks: [{ id: "open_marina", label: "Opens the marina", activity: "work", kind: "fixed", at: "06:30", minutes: 90, place: { place: "alder_harbor_marina" }, days: { weekdays: [1, 2, 3, 4, 5, 6] } }] },
      },
    },
    { op: "add", path: "/routineSettings", value: { awareness: "story_first" } },
    { op: "add", path: "/needs", value: { hunger: { rate: 5, tell: 55, alert: 85 } } },
    { op: "add", path: "/minds", value: { secrecy: "brief", thresholds: { live: 60, near: 35, far: 15 }, holdings: { marcus_delgado: { "track:s_shop_trouble:truth": { keptFrom: "everyone" } } } } },
    { op: "add", path: "/narrator", value: { knowledge: "scene", secrets: "marked" } },
    { op: "add", path: "/calendar/holidays/-", value: { id: "harbor_watch_day", label: "Harbor Watch Day", rule: { type: "fixed", month: 9, day: 20 }, dayOff: false } },
    { op: "add", path: "/schedules/pov_watch_round", value: { id: "pov_watch_round", owner: "pov", target: "place", recurrence: { every: "week", weekdays: [3] }, slots: [{ start: "20:00", end: "21:00", value: "alder_harbor_marina" }], pack: "castlife" } },
  ];
}

/** The second revision: one more lore entry, so a chat can be upgraded from the first. */
export function secondRevision(): Op[] {
  return [
    {
      op: "add",
      path: "/lore/lore_watch_whistle",
      value: { id: "lore_watch_whistle", title: "The Harbor Watch whistle", content: "Three short blasts on the Harbor Watch whistle mean a boat is loose; one long one means the volunteer on the round wants company.", keys: ["watch whistle"], links: ["harbor_watch"] },
    },
  ];
}
