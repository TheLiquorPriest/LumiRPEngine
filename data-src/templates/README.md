# Starter world templates (neutral format)

Three complete starter worlds for the Build tab (DESIGN §13), written in a neutral JSON format, `lre-template/v1`. They carry the creative and factual content: places, people, schedules, quests, a secret, a puzzle, rules, weather, lore and gear. They are **not** `lre-world-v1` documents; `bun run templates` converts them into the worlds in `src/packs/starters/` (see [Conversion](#conversion)), and only that converter reads them.

| File | World | Genre | Realism preset | Calendar | Data |
|---|---|---|---|---|---|
| `fantasy-town.json` | **Brindlemere**, a river-ford market town on the eve of harvest | low-magic fantasy | Story | custom: 13 moons of 28 days, seven named weekdays | coins (bits, marks, crowns) |
| `mystery-manor.json` | **Harrowmere Hall**, a storm-bound fenland country house, October 1934 | golden-age whodunit | Grounded | Gregorian, 1934 | pre-decimal pounds, shillings and pence |
| `modern-slice-of-life.json` | **Port Alder**, a Lake Michigan harbor town, September 2026 | slice of life | Simulation | Gregorian, 2026 | Modern US tables, Michigan (`mi`) |

`validate.ts` checks all of them. Run it after any edit:

```
bun data-src/templates/validate.ts                 # every template in this folder
bun data-src/templates/validate.ts mystery-manor.json
```

It exits 1 on any error. It checks unique ids; every cross-reference; `[[id]]` links in plain-language text; routes against declared travel speeds; schedule overlaps; grid dimensions, legends, zones and walkability of every place cell; coin sums; container loads; kit piece counts (the mechanic's toolbox is exactly 45); quest, secret and puzzle structure (every stage reachable, a terminal stage, a hint ladder); bands; season coverage of every calendar month; the Modern US links described below; and that no secret `leakTerms` appear anywhere a player can see.

## Contents

| | Fantasy | Mystery | Modern |
|---|---|---|---|
| Places | 13 | 15 | 16 |
| Routes (modes) | 12 (4) | 15 (3) | 13 (4) |
| Grid | town square 14×10, 54 blocked cells, 9 zones | manor ground floor 23×13, 115 blocked, 15 zones | marina 18×11, 24 blocked, 10 zones |
| Characters | POV + 9 NPCs, 3 agents | POV + 10 NPCs, 4 agents | POV + 9 NPCs, 5 agents |
| Schedule blocks / regard entries | 48 / 39 | 56 / 54 | 43 / 38 |
| Items / containers / kits / vehicles | 22 / 4 / 2 / 3 | 22 / 5 / 2 / 2 | 18 / 6 / 1 / 6 |
| Accounts / bills / prices | 7 / 4 / 20 | 5 / 3 / 14 | 14 / 31 / 0 (catalog) |
| Tracks | 2 quests, 1 secret, 1 puzzle, 3 agendas | 2 quests, 1 secret, 1 puzzle (with `puzzle.answer`), 4 agendas | 2 quests, 1 secret, 1 puzzle, 5 agendas |
| Clues | n/a | 11 (9 progress, 2 red herrings) | n/a |
| Rules / actions | 8 / 8 | 10 / 9 | 10 / 13 |
| Climates | 1 | 1 (also Saltreach) | 2 (Lakeshore County, Chicago) |
| Lore entries | 24 | 21 | 26 |

## Conventions

- **Ids** are lower snake_case and unique across the whole file, whatever the collection. Track stages are unique inside their track and written `track.stage` when referenced from text. Groups (`town_cast`, `household`) are ids too.
- **Plain-language text with links.** Predicates (`when`, `gate`, `fail.when`, rule `when`/`trigger`) and effect text are written in plain language. Wrap every reference in double square brackets so tooling can check and convert it: `[[pov_toolbox]]`, `[[flag:ferry_running]]`, `[[s_quiet_bell.rumor]]`. A condition with no entity is just prose. `"always"` means no condition.
- **Time.** `HH:MM` clock times; an `end` of `24:00` means midnight. Date-times are `YYYY-MM-DDTHH:MM`. For the custom fantasy calendar the month is the month's number (Goldmoon is month 8), the day is its day, and every month has 28 days and begins on Hearthday.
- **Money** is integer base units: bits (fantasy), pence (mystery), cents (modern).
- **Secrets.** Secret truth appears in exactly one place, a track stage's `truth`. `leakTerms` (at least two per truth, each occurring in it) name distinctive phrases that must not appear in lore, place or character text, visible items or the blurb; the validator enforces this. Items and clues that exist only after discovery are marked `hidden: true` and are exempt.
- **No real people.** Every person, business, bank and town is fictional. Real places appear only as setting: Michigan, Lake Michigan, Chicago, Illinois, London and, in one rail fare, Peterborough.

## Fields

### Header

| Field | Meaning |
|---|---|
| `schema`, `id`, `name`, `version`, `genre`, `tags`, `blurb`, `contentNotes` | Identity. `id` equals the file name. |
| `realism.preset` | The default realism preset (`story`, `grounded` or `simulation`) and a `rationale`. |
| `dataPack`, `region` | Modern only: `"modern-us"` and the `economy.regions` row (`mi`). Others are `null`. |
| `currency` | `id`, `label`, `baseUnit`, `denominations` (`id`, `label`, `value` in base units), `note`, and the world's display fields: `code`, `symbol`, `minorUnit`, `decimals` and `format` (placeholders `{sign}`, `{symbol}`, `{code}`, `{amount}`, `{major}`, `{minor}`). |
| `travelSpeedKmh` | Plausible `[min, max]` km/h per travel mode; the validator holds every route with a distance to it. |
| `calendar` | `system` (`gregorian` or `custom`), `epoch`, `timeZone`, `dayParts`, `holidays` (`rule`: `fixed` or `nth_weekday`; `weekday` 0 is Sunday), and for custom calendars `custom` (`monthLengths`, `monthNames`, `weekdayNames`, `yearLabel`). Modern also has `inheritHolidays: "calendar.holidays"`, which adds the US federal holidays from the table. |
| `start` | `place`, `at`, `weekday` (checked against the date), `display`, `scene`, `summary`. |
| `time` | `sceneTypes` (`id`, `label`, `tickMinutes`; the four engine types plus one world type each), `montage`, `speedThrough`, and optional `interrupts` overrides. |
| `flags` | Story switches used in `[[flag:id]]`: `id`, `description`, `default`, `type` (`bool`, `number` or `text`; default `bool`). |
| `regard` | `axes` (`warmth`, `trust`, `respect`, plus `fear` in the mystery; each with `min`/`max`) and `bands` (words for ranges). |
| `groups` | Named lists of character ids, usable as `who` / `toward` in effects. |

### Places, routes, grid

- **Places**: `id`, `name`, `parent` (hierarchy), `timeZone` (root and modern places), `sceneType`, `grid` (the place that owns the grid) or `cell` (`{x, y}` on its parent's grid), `visibility`, `tags`, `description`. A place with `visibility: "secret"` is invisible until found; one with `visibility: "discoverable"` stays off the map, the travel list and the narrator's facts until the player has been there, is told of it (a `knows` link) or has it in `known_places`.
- **Routes**: `from`, `to`, `bidirectional`, `modes` (`walk`, `road`, `offroad`, `water`, each `{minutes, distanceKm?, terrain?}`), and `secret: true` for routes that do not exist until opened. Containers (places with children) need no routes of their own; leaving a place reaches its parent.
- **Grid**: `width`, `height`, `cellMeters`, `legend` (character to `terrain`, plus `blocked: true` or `blockedFor: [modes]`), `rows` (ASCII, top row first, row-major), `zones` (name to a list of `[x, y, w, h]` rectangles), `exits` (place to `[x, y]`, or `{cell, mode: "water"}`).

### Characters

Each has `id`, `name`, `tier` (`pov`, `principal`, `supporting`, `background`), `agent` (the LOD1 flag), `age`, `role`, `summary`, `traits`, `home`, `location` (start place, POV only), `sheet` (stats 1-10), `schedule`, `regard`, `trips` and either an `agenda` (agents: the id of an agenda track they own) or `goals` (everyone else: a `label` and `steps`).

- **`schedule`**: weekly blocks `{days, start, end, place, activity, term?}`. Days outside any block mean "at `home`". A block with a **`term`** `{from, until, except?}` (inclusive local dates `YYYY-MM-DD`, `except` = holiday ids) runs only inside that span, so a school year is a few blocks per term; blocks conflict only where their terms overlap, and blocks of the same weekdays and term become one schedule. Port Alder's Maddie has two school terms (31 August to 20 November, 30 November to 18 December), so Thanksgiving week and winter break are off. Keep activity names free of the words *school*, *class*, *work* and *shift* unless that is what the block is (the commitment kind is read from them).
- **`trips`**: away spells `{from, until, place, label}`, date-times in the world's local clock (the converter turns them into clock minutes). The person is at `place` between the two times and back at `home` afterwards. Port Alder's Danny spends 25 to 27 September "Visiting family in Chicago".
- **`regard`**: `{toward, axes: {warmth, trust, respect}, note?}` starting values toward other characters.
- **`job`** (modern): `employer` (place), `occupation` (an `economy.occupations` row, or `null` for self-employed and retired), `hourlyCents`, `hoursPerWeek`, `payFrequency`, `payday`, `depositTo` (an account they own), `shiftPattern` (a `calendar.shifts` row) and, for owners, `estimatedAnnualIncomeCents`.

### Gear and money

- **Items** and **containers**: `id`, `name`, `description`, `owner`, `in` (a place, character, container, item, vehicle), `worn` and `slot` (a `gear.slots` id), `weightG`, `capacityL`, `maxLoadKg`, `fixed`, `tags`, and for Modern US worlds `tableItem` / `tableContainer` (rows of `gear.items` / `gear.containers`, whose weights and volumes the validator uses to check container loads).
- **Kits**: `container`, `pieceCount`, `pieces` (`{name, qty}`; the count must equal their sum) or `tableKit` (a `gear.kits` row; `mechanic_toolbox_45` has 45), and `overrides`.
- **Vehicles**: modern worlds use `class` (a `vehicles.classes` row), `year`, `odometerMiles` or `engineHours`, `fuelFraction`, `condition`, `lastOilChangeMiles`, `homeBase`, `assignedTo` (`null`, or `{to, until}` for a use grant). Other worlds give a `spec`.
- **Accounts**: `kind` (`purse`, `till`, `strongbox`, `cash`, `checking`, `savings`, `card`, `loan`, `brokerage`), `owner`, `balance` (base units) with `coins` that sum to it, or for cards `owedCents` / `limitCents` / `aprPct` / `statementDay` / `dueDay`, and for loans `principalCents` / `aprPct` / `remainingMonths` / `paymentCents` (amortization checked). A **brokerage** holds a symbol rather than cash: `holdingsCents` is the market value of its holdings at the start (whole cents), `symbol` names a recipe in the finance table's `investing` row (default `broad_us_equity_index`, 11 % arithmetic return and 16 % volatility), and the converter turns the value into units at the symbol's starting price of 100. At Money level 4 the economy pack's market process then moves the price on each trading day from the run seed, and Invest / Sell investments move money between checking and the account. Port Alder's `acct_pov_brokerage` holds $3,125.00.
- **Bills** (every template): `payer`, `payee`, `label`, `amountCents`, `every` (`month` with `day` 1-28, or `week` with `day` 0-6, the calendar's weekday) and `from`, the payer's account it is paid from (omitted for a payer without accounts, who pays out of their means). A `payee` that names a character is paid into that person's account (Port Alder's rents go to Helen, Brindlemere's dues to the reeve, Harrowmere's housekeeping allowance to the butler); any other payee is an outside counterparty named in words. Modern only, optional links the validator checks: `catalogItem` (inside the item's price band), `vehicleClass` (the class's full-coverage insurance), `loan` (the loan's payment), `usageKwh` times `rateCentsPerKwh`, and `kind: "rent"` (within 0.5-1.5 times the region's 1BR median).
- **Prices** (fantasy, mystery): `{id, name, unit, band: {min, typical, max}}`.
- **Stocked containers**: a container may name `stock`, a `gear.items` category (`carried`, `clothing`, `household`, `recreation` or `tool`). The first time it is opened at Gear 2 or more, two to four items of that category are drawn into it, owned as the container is, and the container is marked sampled. A stocked container that the preset would hold below Gear 2 (a background thing in Grounded) takes `tier: "supporting"`. Fantasy and mystery worlds carry `gearItems` (`{id, name, category, weightG, volumeL, priceBand}`) that replace the Modern US item table in the converted world, so a chest at an inn holds clay mugs and a kitchen dresser holds enamel mugs and string, never a phone or an LED bulb; the validator wants at least two items in every stocked category. A debt is a `loan` account, not a negative balance: the economy refuses to overdraw cash, checking and savings.

### Tracks, clues, rules, weather, lore

- **Tracks**: `kind` (`quest`, `secret`, `puzzle`, `agenda`), `label`, `summary`, `owner` (agendas: the character; puzzles: see below), `visibility`, `start`, `stages`. A stage has `label`, `cue` (player-facing text), `objectives`, `next` (`[{to, when}]`, conditions in plain language), `gate`, `fail` (`{when, to}`), `effects`, `rewards`, `hints`, `priority` (agendas), and:
  - secret stages: `truth` (GM-only) and `leakTerms`. The Quests panel shows a secret track's current `cue` from the start, and a track with no cue stays hidden. So a cue must be something the player could already notice at the start; if it describes an event that has not happened yet, begin on a cue-less first stage and move on when the event happens (Harrowmere's death track starts at `before` and moves to its first cue when the body is found);
  - quest stages: a quest whose trigger is an event that has not happened yet starts on a **bare stage** (a label and `next`, with no cue, objectives or answer). The engine keeps a track on a bare start stage out of Quests until it moves on, and the validator allows it there only (every other stage that can move on needs objectives). Harrowmere's "Cut Off" starts at `before` and moves on when the 21:30 gale puts the hall telephone out; its cue then says only what is true at that moment;
  - puzzle stages: `answer` (`expect` list, `normalize`, and an optional `decision: {threshold}` that opts into `puzzle.answer`). A puzzle with `visibility: "known_by"` shows in Quests only after the player comes to know its `owner`, so the `owner` is the thing the puzzle is about (an item, container or vehicle) and some stage effect or rule must give the player the link `{type: "link", args: {rel: "knows", from: "pov", to: <owner>}}` at the moment the puzzle becomes discoverable (the validator rejects a `known_by` puzzle with no owner or no such link): the vestry tiles when the vestry floor is found, the study safe when the player steps into the study (`r_study_safe_noticed`), the township truck when the shop takes the job.
- **Clues** (mystery): `track`, `stage` (the stage it unlocks, or `null` with `redHerring: true`), `where`, `requires` (place and item conditions), `item`, `kind`, `finds` (what the player is shown), plus the engine fields below.
- **Rules**: `on` (exactly one of `{tick: turn|slot|day}`, `{enter: place}`, `{at: date-time}`), `trigger` (a sentence), `when`, `whenExpr`, `do` (effects), `once`, `cooldownMinutes`, `interrupt` (counts as an interrupt in a Timelapse) and `beat.hint` (a storylet outline hint). An authored **death** has no engine state of its own: give the person only schedule blocks with a one-day `term`, so no routine continues, and pin the body with `set` effects (Sir Alaric's rules set his `place` to the library when he dies and his `activity` to "dead" when he is found).
- **Weather**: `climates` of `{region, appliesTo?, states (with travel multipliers and closed modes), seasons (months, weights and tempC)}`; every calendar month is covered once, and every root place is covered.
- **Lore**: `{id, title, category, about?, keys, text}`: public World Book text for places, people and history. Never secret truth.

### Effects

Effects are `{type, text, args}`. `text` is the plain-language effect; `args` carry ids the validator resolves.

| Type | Args that name ids | Other args |
|---|---|---|
| `pay` | `from`, `to` (character, account, place) | `amount`, `currency`, `memo` |
| `give_item`, `reveal_item` | `item`, `to` | |
| `assign_vehicle`, `flag_overdue` | `vehicle`, `to` | `until` |
| `move`, `schedule_override` | `who` (character or group), `place` | `activity`, `minutes` |
| `regard` | `who`, `toward` (character or group) | `axis`, `delta` |
| `reveal`, `advance` | `track`, `stage`, `to` | |
| `set_route` | `route` | `open` |
| `set_flag` | `flag` (declared) | `value` |
| `set_weather` | `region` (place) | `state`, `minutes` |
| `set_scene`, `payroll` | `place`, `employer` | `sceneType`, `payFrequency` |
| `price_modifier` | `scope` (a place, or a price category) | `percent`, `minutes` (becomes `economy.price_modifier`; with no `minutes` it runs until cleared) |
| `note` | | text only |

### Engine fields

Fields added so the converter can build checkable worlds:

- **Formulas** (engine grammar, see `src/engine/expr.ts`): beside each plain-language `when`, `next[].expr`, `fail.expr`, `gateExpr`, `objectiveExprs[]` (parallel to `objectives`; quest and puzzle stages only), a rule's `whenExpr`, an action's `requires[]` and a clue's `requiresExpr`. Write `story.<flag>` for a flag, `@YYYY-MM-DDTHH:MM` for a date-time, and string literals for ids (`at(pov, 'ferry_landing')`). A rule's `when` of `"always"` needs no `whenExpr`. The validator parses each one and checks every name, function and id argument.
- **Rules** use `tick`, `enter` or `at` only: the engine has no custom events. A rule that an Economy process already performs carries `handledBy: "economy.bills"` or `"economy.payroll"`.
- **`actions`**: `{id, label, params, requires, duration, lexicon, observable, effects}`; every effect is a template effect or an engine effect (`gear.transfer`, `gear.lend`, `set`, `add`, `move` with `entity` and `to`).
- **Clues** also carry `action: {label}`, `requiresExpr` and `reveals[]` (hidden item ids that appear when the clue is found).
- **Characters** carry `wealth` (`broke`, `poor`, `modest`, `comfortable`, `rich` or `wealthy`). `sheets` holds `scale` (`[1, 10]`), `stats` (`{id, label}`) and `derived`.
- **Climates** carry `tempC` per season; **prices** carry the Economy `category` row they replace; **flags** carry `type` (`bool` by default).

## Modern US links

The modern template reads these tables from `src/packs/*/core/tables/modern-us/` (the validator checks each link): `economy.regions` (`mi`: rent, minimum wage, electricity, multiplier), `economy.occupations` (pay, pay frequency, shift pattern for every job), `economy.catalog` (bill prices), `calendar.shifts`, `gear.items`, `gear.containers`, `gear.kits` (the 45-piece toolbox) and `vehicles.classes` (insurance, domain, odometer rules). Wages sit within 0.6-1.8 times the occupation's median; the POV mechanic is paid 2,350 cents an hour against a 2,390 median. Prices in lore (fuel, coffee, ferry) match the catalog.

## Conversion

`bun run templates` (`scripts/templates/build.ts`) converts each template into an `lre-world-v1` document and writes it to `src/packs/starters/` (`fantasy_town.json`, `mystery_manor.json`, `modern_slice_of_life.json`, the Build tab's template ids). The converter is pure and deterministic; `bun scripts/templates/build.ts --check` fails when a committed world differs from a fresh build, and `test/packs/templates/` holds the same checks plus a walkthrough of each world. Run `bun data-src/templates/validate.ts` first: it checks the template against the engine's own formula grammar, registry and tables. Every output is linted (`lintWorld`) and must have no issues.

| Neutral | `WorldDoc` |
|---|---|
| `places`, `routes`, `grids` | `places`, `routes`, `grids` (`rows` and `legend` become `terrain`, `blocked`; `zones` rectangles become cell indexes) |
| `characters`, `items`, `containers`, `kits`, `vehicles`, `accounts` | `entities` (kinds from the packs: `character`, `item`, `container`, `kit`, `vehicle`, `account`); `owner`, `in`, `worn`, `assignedTo` become relation instances; character `sheet` stats are rescaled from 1-10 to the sheet's 3-18 |
| `characters[].schedule` | `schedules`: `<id>_place_<n>` and `<id>_activity_<n>` per day-set, owned by the Castlife pack |
| `regard` | one `regard` relation per pair with the axes and `t: 0`; the axes and bands go to `packs.relationships.config` |
| `tracks` | `tracks`; each `next[].expr`, `fail.expr`, `gateExpr` and quest/puzzle `objectiveExprs[]` becomes the stage's `Expr`; the plain-language `when` becomes the objective label |
| `clues` | one `find_<clue id>` action each (`action.label`, `requiresExpr`, `reveals[]`) that spawns the hidden items and advances the track |
| `actions` | `actions`: the conversational quest steps, with effects in the template vocabulary or the engine's own (`gear.transfer`, `gear.lend`, `set`, `move` with `entity`/`to`) |
| `rules` | `rules`: `whenExpr` becomes `when`; `tick`/`enter`/`at` become `RuleTrigger`; `handledBy` rules (rent, payroll) are dropped because an Economy process already does it |
| `flags` | `packs.story.config.flags` (defaults; `type` is `bool`, `number` or `text`) |
| `calendar`, `time`, `realism` | `calendar`, `time`, `realism` (the preset's levels and tier caps, copied from `REALISM_PRESETS`) |
| `weather` | `packs.weather.config.climates`, a `region` entity per climate (`climate` field) and `fields.region` on the places it covers |
| `currency` | the world's `currency` (`code`, `symbol`, `minorUnit`, `decimals`, `format`) beside the template's denominations |
| `prices`, `bills` | the Economy catalog (non-modern worlds swap in the template prices and add `vehicles.classes` rows) and each payer's `bills` list |
| `lore` | `lore` (`WorldDoc.lore`): `title`, `content` (the public text), `keys`, and `links` to the place or entity the entry is about; it stays in the world document and isn't delivered to the AI yet. Lore is cue text only, so no entry carries a secret's truth (linted) |
| tables | every pack's default tables are copied into `tables`, re-hashed, and pinned in `pins.tables`; `pins.generators` pins each materializer domain |

### Deferred

Two things from the template are not carried into the converted world: storm durations beyond `weather.set`'s `minutes` (the template's explicit clearing rules do the job; `weather.set` could instead hold a storm until a flag), and **agenda and secret-track objectives** (narrative to-dos; only quest and puzzle objectives can be checked). They are listed in `DEFERRED` in `scripts/templates/convert.ts`.

