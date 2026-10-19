# Writing LumiRPEngine worlds: a guide for agents

This is the guide an agent reads before it touches a LumiRPEngine world, through the `lumirpengine` MCP server or command line ([MCP.md](MCP.md)). It covers the world model, the way to work on a user's worlds, and the mistakes that are easy to make and hard to see. The details of every kind, field, effect and formula function are in the reference (`lre_docs`), and complete worlds to learn from are the starters (`lre_template`). How outside agents reach LumiRPEngine is DESIGN §23.

## The world model

A world is one JSON document in the `lre-world-v1` format, with a published JSON Schema (`lre_schema`). Each commit makes an immutable **revision**, named by its content hash; the newest is the world's **head**, and a chat plays the revision it was started on until the player upgrades it. Changes go to a **draft** first: a working copy that a commit turns into the next revision.

- **Collections** are objects keyed by id: `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `packs`, `lore`, `classifications`, `tiers`, and `lifeStates` when the world has its own.
- **Parts** are single values: `calendar`, `realism`, `time`, `start` (`{place, at}`), `pov` (the entity the player plays), `currency`, `loreIndex`, `pins`, and the optional `ruleset`, `mapSettings`, `spawnTier` and `spawnCap`.
- **Kinds** are types with fields and single inheritance (`extends`). The packs define the common ones: `thing` (with `owner` and `place`), `person`, `item`, `container`, `kit`, `vehicle`, `region`, the money kinds (`account`, `card`, `flow`, `job`, `holding`, `property`, `business`, `trust`, `invoice`), and `group` with its `faction`, `family`, `household` and `company`. A world kind with a pack kind's id replaces it whole, so extend a pack kind rather than redefine it.
- **Entities** are the people and things: `{id, kind, name, tier, fields, relations}`, plus `life`, `lifeKnownBy`, `agent`, `cues`, `class`, `tags`, `visibility` and `knownBy` as needed. Fields hold values; relations are `{type, to, fields?}` links to other entities.
- **Formulas** are strings in a small, safe expression language (`lre_docs` with `doc: "expressions"`): `at(pov, 'archive')`, `stage.hale_debt == 'revealed'`, `hour >= 18`. Dice are notation strings (`1d20`).
- **Money** is always a whole number of the currency's minor units: 4250 is $42.50 in a dollar world. **Times** are local ISO date-times (`2026-09-14T18:30`).

## How to work on a user's world

1. **Read before you write.** `lre_worlds` lists the worlds and whether each has a draft stored. A draft that is already there when you start is the user's work in progress: ask them before you edit, commit or discard it. `lre_world` reads one at a JSON Pointer: `""` gives an outline of the whole world (collections with their ids), `/entities/mara` one item. `lre_search` finds an item by what it says.
2. **Edit the draft.** `lre_edit` takes JSON Patch (RFC 6902) operations whose paths point into the whole world: `add` creates an item or a field, `replace` changes one that exists, `remove` deletes, `test` guards a value. All the operations of one call apply, or none do. Pass `expectVersion`, the draft version your last read reported (`lre_world`, `lre_draft` and `lre_worlds` give it whether or not a draft is stored, and each `lre_edit` answers the new one): if the draft has changed since, the edit is refused and nothing is overwritten.
3. **Check.** Every `lre_edit` answers the lint the draft has now and any macro hazard the edit brought in. `lre_draft` sums up the draft against the head; `lre_diff` shows field by field what changed. `lre_playtest` plays typed turns and `lre_check_world` simulates whole days, both with the bundled engine and no model.
4. **Commit, or discard.** `lre_commit` with a short note makes the draft the head; the note goes into the world's history (`lre_history`). It is refused while the draft has lint errors, which it lists. `lre_discard` throws the draft away. Pass both the `expectVersion` you last saw, as for `lre_edit`.

**The draft is the user's Build draft.** There is one draft per world, and Build edits the same one: the user sees your changes as you make them, and you see theirs. Don't leave a draft behind: commit what you finished, discard what you didn't, and say which you did. If an edit is refused because the version moved, read the draft again: the user may be editing it.

**A commit takes the whole draft.** When the user presses Commit in Build, your unfinished changes go into that revision with theirs; when you commit, their changes go in with yours. So finish one change before you start the next, and tell the user what you are in the middle of. With `expectVersion`, `lre_commit`, `lre_discard` and `lre_restore` are refused if the draft moved on since you read it, so none of them commits or throws away a change you haven't seen. A commit is refused, too, when the head is no longer the revision the draft began from: compare with `lre_diff`, discard, and redo the change on the new head.

**Chats keep their revision.** Committing changes no running chat. `lre_chats` says which chats are behind; `lre_upgrade` with `preview` shows what an Upgrade would bring into one, and without it applies the default picks: what play never touched comes from the new revision, and what play changed stays as played. So in a world that chats play, keep every id the chats use: a renamed id is a new thing, and the old one stays behind in the chat.

**Offline work.** Without a Lumiverse, write the world as a file: start from a starter (`lumirpengine template <id> --out world.json`), check it with `lre_check` after each change, run it with `lre_playtest` and `lre_check_world`, and bring it in with `lre_world_import` (or Build's Import) once it is clean.

## JSON Patch on a world

- An item is added whole: `{"op": "add", "path": "/entities/mara", "value": {"id": "mara", "kind": "person", …}}`. Adding to a key that exists replaces it, so to change one field, point at the field: `/entities/mara/fields/place`.
- `replace` and `remove` need something there; `add` needs the parent to exist (`/entities/mara/fields` must be an object before `/entities/mara/fields/place` can be added).
- In a list, a number is the index and `-` is the end: `{"op": "add", "path": "/entities/mara/relations/-", "value": {"type": "knows", "to": "pov"}}`.
- In a key, `~1` stands for `/` and `~0` for `~`: the table `economy.catalog` is `/tables/economy.catalog`, and a key `a/b` is `/x/a~1b`.
- `test` makes an edit conditional on what you read: `{"op": "test", "path": "/entities/mara/name", "value": "Mara"}` first, and the whole patch is refused if Mara was renamed meanwhile.
- `/id`, `/format`, `/engineVersion`, `/suppressed` and `/pins` are the engine's: a patch may not change them.
- One patch carries at most 500 operations and brings in at most 4 MiB of JSON (what it adds, replaces and copies), and the world may nest at most 64 levels deep. An item the engine can't read (`/lore/x` set to `{}`) is refused before anything is written, so add items whole.

## Ids and keys

- Every item's `id` repeats its key. Lint refuses a mismatch for entities, lore entries, step templates and classifications; keep them equal everywhere.
- Ids are lower snake_case by convention (`old_bram`, `quay_to_market`) and are what everything else refers to: `fields.place`, `fields.owner`, relation targets, track ids in formulas, lore `links`. Look them up rather than guess them; every reference to an id the world doesn't have is a lint error or a dead link.
- An item's key must be 1 to 200 characters and never `__proto__`, `constructor` or `prototype`; the engine refuses any other.
- A world's own id (`w_…`) is the host's: `lre_world_create` and import assign it.

## People

- **The POV** (`pov`) is the entity the player plays, a `person` on a lead tier, never capped by realism. `start` is where and when play begins, and the POV stands there unless its `fields.place` says otherwise.
- **Tiers** say how deeply someone is simulated: by default `principal` (Leads), `supporting` and `background`. `"agent": true` makes someone pursue their own agenda off-screen.
- **Who knows the POV.** Everyone who has met the POV holds a `knows` relation toward the POV, or a `regard`. The narrator is told "Mara knows you" or "Mara doesn't know you" from exactly that, so a friend without either greets the player as a stranger.
- **Regard** is one directed relation with `warmth`, `trust` and `respect` from −100 to 100; write each direction that matters. Kinship (`parent_of` and `child_of`, `sibling_of`, `spouse_of`, `partner_of`) is kept two-sided: write both sides.
- **Life and death.** `life` is the state someone starts in: `alive` when unset, `dying`, `dead`, or one of the world's own `lifeStates`. The dead keep their place: give a body a `fields.place` where it lies, and no schedule (someone who doesn't act follows none).

### lifeKnownBy: who knows how someone starts

When someone starts dead or dying, `lifeKnownBy` lists the ids of the people who know it; everyone else, the POV included, takes them for alive until they see the body or are told. **Left out or empty, everyone knows**, which tells the player at once. So:

- a death the player hasn't learned of lists who does know, including everyone who starts in the same place as the body;
- when nobody else knows yet, list the person themself (the list is then not empty, and no one else learns it);
- on someone who starts alive it changes nothing (lint warns), and every id in it must be an entity of the world.

```json
{ "id": "old_bram", "kind": "person", "name": "Old Bram", "tier": "supporting", "life": "dead", "lifeKnownBy": ["silas"], "fields": { "place": "net_loft" }, "relations": [] }
```

## Character minds

A character can have a **mind**: a model call made as that character alone, on what they know (their entity's fields, never a Lumiverse character card; the lore they may read, the turns they were there for, their notes and commitments, their money and their day). It answers with their private read of the moment and what they intend; the narrator then depicts it. Minds are blind to each other, and every answer is recorded, so Playtest and Check world, which call no model, play a world without them. So write who someone is into their fields (`description`, `traits` and the rest): no character card fills it in.

Who gets a mind is decided each turn by a **focus score**: points for being in the POV's scene or close by, being named, a relation with the POV, a stake in tracks and rules under way, plans with the POV, and their tier. The score puts each character on a ladder: **Live** (a mind every turn), **Near** and **Far** (a mind on their refresh), **Background** (routine only). The world tunes the ladder and what minds remember in its `minds` part:

```json
[{ "op": "add", "path": "/minds", "value": {
  "secrecy": "brief",
  "weights": { "mentioned": 50 },
  "thresholds": { "live": 60, "near": 35, "far": 15 },
  "always": { "ids": ["marcus_delgado"] },
  "never": { "tag": ["crowd"] },
  "memory": { "notes": { "show": 10, "keep": 30 }, "salience": { "halfLifeDays": 14 } } } }]
```

- **`secrecy`** decides what the narrator gets. `brief` (the default): only a depiction, written as behaviour anyone present could see and withheld when it would give away a secret or a name the POV can't know, while the monologue stays in the GM view. `full`: the monologue, intent, reactions and mood too, to depict and never state. A mind knows its own character's secrets, so keep `brief` where a private thought reaching the narrator would give one away.
- **`weights`** are the points each input adds, from −100 to 200: `here` 45, `nearby` 20, `mentioned` 40, `regard` 10, `knows` 10, `owner` (owns a track under way) 15, `track` (named in one) 8, `rule` 5, `pending` (an invitation, appointment or plan with the POV) 15, `recent` 10, `band` 15, 5 and 0 for principal, supporting and background, and `roles` by classification value id (`antagonist` 20). A role weight counts only where one of the world's classifications has that value (lint warns about one that none has), and a world's `roles` replaces the default map whole.
- **`thresholds`** are the lowest scores for Live, Near and Far (60, 35 and 15); below Far is Background. Live is only for someone at hand, in the POV's scene, close by or named this turn: anyone else is Near at most, whatever their score.
- **`always`** and **`never`** are selectors (`ids`, `kind`, `tier`, `memberOf`, `tag`, `class`): `always` keeps people Live wherever they are, `never` keeps them Background, without a mind, and wins over `always`. A GM's pin in a chat wins over both. An id, kind, tier, group or classification the world doesn't have is a lint error.
- **`memory`** is what a mind is shown and how long a note lasts, each a number of entries unless named: `witness.show` (what they saw lately, 8), `recall.recent` and `recall.relevant` (the latest turns they were there for and those that best match the moment, 4 each) within `recall.tokens` (1200), `notes.show` (8) and `notes.keep` (24 before the oldest are folded into their summary), `commitments.show` (8; open ones are kept until resolved), `salience.halfLifeDays` (a note's weight halves every 7 game days) and `salience.floor` (below 0.5 it has faded), and `consolidate.enabled` (true: faded and surplus notes are folded into the summary rather than lost). The user's own settings win over the world's.
- Every part is optional; one left out, or out of range, reads as its default, and lint says so. The user decides in their settings whether minds run at all, and how many Live minds a turn may have.

**Prompts.** The four minds steps, `mind`, `memory`, `skip` (a time skip's turning points) and `consolidate` (folding old notes into a summary), take world step templates as the other steps do, with `"output": "text"` and `"signals": []`: minds run on their own cadence, so signals are ignored (lint notes any as info). The template is the step's instructions only, with `{{character}}` the character's name and `{{world}}` the world's: the engine appends the answer's format itself, which no template replaces, so write how to think, never the JSON. A world's template wins over the user's own prompt, which wins over the built-in one; give each purpose one at most (with two, lint warns and the first by id is used).

```json
[{ "op": "add", "path": "/steps/mind_port_alder", "value": { "id": "mind_port_alder", "purpose": "mind", "output": "text", "signals": [],
  "template": "You are the private mind of {{character}} in {{world}}, a lake town where everyone knows everyone's business and says less than they mean. Think as {{character}}, from only what they know below. Decide how they read this moment and what they intend; never script anyone else, and keep to what a neighbour would notice." } }]
```

## Things and who owns them

- Where a thing is: `fields.place` for something lying in a place, a relation `{"type": "in", "to": "rhea"}` for something carried or inside a container.
- **Whose a thing is lives in `fields.owner`**, the owner's id. That puts it on their gear, a vehicle in their garage and at their levels, and lets them drive it. The `owns` relation only changes how the Journal words a change: an item with an `owns` link and no `fields.owner` belongs to no one. Set `fields.owner` on everything someone owns. Money is owned differently: see Money.

## Money

Money is entities, a few fields and the economy pack's config. Amounts are whole minor units (4250 is $42.50 in a dollar world) and percentages are percent units (22 is 22 %). What runs for someone depends on their Money level: the world's `realism.levels.money`, capped by their tier's band (the POV is never capped). At 0 money is off; at 1 a person's `wealth` band is all there is; at 2 their cash and one everyday account are real, and a payment they can't cover is declined; from 3 all their accounts, and more as below.

| From | What runs |
|---|---|
| Money 3 | flows, cards, payment preferences, household shares, living costs, property |
| Money 4 | statements and minimum payments, interest (on the average daily balance where an account asks for it), fees, late payments and collections, credit scores, cash only at a machine or a branch, holds, daily card limits, overdraft policies, withholding and tax brackets, sales and business tax, investments, options, capital gains |

A world can switch one on or off for itself in `packs.economy.config.features` (`{"flows": true}`), as low as Money 2 for flows, cards, payment preferences, household shares, living costs, cash machines, daily limits and overdraft, and Money 3 for the rest.

### Who owns money

A **party** is a person, or an entity of kind `business`, `trust` or `household`. An account, a business, a holding or a property names its holders in `owners`, each with a role: `[{"party": "pov", "role": "owner"}]`.

| Role | Spends from it | Counts toward their net worth | Manages it |
|---|---|---|---|
| `owner`, `joint` | yes | yes | yes |
| `custodian`, `trustee` | yes | no | yes |
| `beneficiary` | no | yes | no |
| `authorized_user` | yes | no | no |

`share` divides the worth between the holders whose role counts it, in percent; given by none, they share equally. A **household** is the relationships pack's `household` group: its members hold a `member_of` relation to it, and it shares flows between them (below).

### Accounts and products

An `account` entity is one purse, wallet, bank account, card account, loan or investment account: `owners`, `product`, `opening` (the balance at the start, from the holder's side: a debt is negative) and `institution`. `product` is an account class, each a built-in product with the finance tables' terms (`cash`, `checking`, `business_checking`, `savings`, `money_market`, `cd`, `trust`, `escrow`, `credit_card`, `charge_card`, `line_of_credit`, `loan`, `mortgage`, `brokerage`, `retirement`), or one of the world's own products, `packs.economy.config.products` by id. An account's own `limit`, `apr_pct`, `apy_pct`, `statement_day`, `due_day`, `payment`, `months_left`, `overdraft` and the rest win over its product's; `autopay` (`minimum`, `statement`, `full` or `fixed`) with `autopay_from` pays a credit account by itself.

Read `/packs/economy/config` before adding to it: the starters' is empty. Where the world has no `products` map yet, add the map whole with the first product in it, as below (JSON Patch adds into a map only once it exists); where it has one, add each product by its own path, `/packs/economy/config/products/<id>`, since adding the whole map replaces it and drops every product already in it. `assets` works the same.

```json
[
  { "op": "add", "path": "/packs/economy/config/products", "value": { "lakeshore_rewards": { "label": "Lakeshore Rewards Visa", "class": "credit_card", "institution": "Lakeshore Credit Union", "limit": 300000, "apr_pct": 21.9, "rewards_pct": 1.5 } } },
  { "op": "add", "path": "/entities/acct_pov_rewards", "value": { "id": "acct_pov_rewards", "kind": "account", "name": "Rewards Visa", "tier": "background", "fields": { "owners": [{ "party": "pov", "role": "owner" }], "product": "lakeshore_rewards", "opening": -12500, "autopay": "statement", "autopay_from": "acct_pov_checking" }, "relations": [] } }
]
```

A **card** is its own entity, kind `card`: the `account` it draws on, its `holder`, its `network` (`debit`, `credit` or `charge`), its `state` (`active`, `frozen`, `lost` or `cancelled`) and `item`, the physical card in the holder's gear. An authorized user holds a card on someone else's account.

### Flows: money that moves on its own

A **flow** is every scheduled or one-off movement of money: rent, bills, a transfer to savings, an allowance, a loan payment. It is an entity of kind `flow`:

- **`flow_kind`**: `transfer`, `bill`, `rent`, `utility`, `subscription`, `premium`, `loan_payment`, `card_payment`, `savings`, `income`, `payroll`, `allowance`, `living`, `tax`, `distribution`, `invoice`, `draw` or `other`.
- **`from` and `to`**: an account; a party, paying as their preferences choose, or paid into their deposit account; or an outside payer or payee by name, in words (`"Harbor Mutual"`). A name shaped like an id (`acct_pov_chequing`) that names no entity draws a lint warning: it would be read as an outside party, so money would come from or go to nowhere.
- **The amount**, the first of: `amount_cents`; `amount_formula`; `amount_table` (`table.row`, or `table.row.column`); `amount_min` and `amount_max`, a seeded draw between them; `amount_pct` of `amount_of`'s balance; `amount_due` (`minimum`, `statement` or `balance`, of the credit account it pays).
- **When**: `every` (`day`, `week`, `month` or `year`) with `interval` (biweekly is `week` with 2), `weekdays` (0 is Sunday), `days` of the month (31 is the last day of a short month, −1 always the last), `months`, `except` (holiday ids), `roll` (`before` or `after`, for a day that isn't a business day) and `at` (`HH:MM`, 09:00 by default); or `once`, a local date-time. `start`, `end` and `count` bound it.
- **When the money isn't there**, `shortfall`: `skip` this time, pay what there is (`partial`), `retry` after `retry_days` up to `retries` times, pay from `fallback`, let the account `overdraft` as its policy allows, or `defer` the amount to the next time.
- `splits` sends parts elsewhere (fixed `cents` first, then `pct` of the rest); `shares` splits a household's flow between its members by `pct`; `link` ties it to what it belongs to (a property, a job, a loan); `status` is `active`, `paused` or `ended`.

```json
[{ "op": "add", "path": "/entities/flow_pov_savings", "value": { "id": "flow_pov_savings", "kind": "flow", "name": "Payday savings", "tier": "background", "fields": { "flow_kind": "savings", "from": "acct_pov_checking", "to": "acct_pov_savings", "amount_cents": 25000, "every": "week", "interval": 2, "weekdays": [5], "start": "2026-09-18", "shortfall": "skip" }, "relations": [] } }]
```

### Work and business

A **job** is an entity of kind `job`, one worker's employment: `worker`; `employer`, a business entity (paying from its account), a place (the business there) or an outside employer named in words, an id-shaped one that names no one and no place drawing a lint warning; `workplace`, the place the work is (else the employer business's `places`); `title` and `occupation` (a row of the occupations table); `basis` (`salary`, `hourly`, `per_shift`, `commission`, `tips` or `stipend`) and `rate` (the salary a year, the hourly rate or the pay per shift, with `commission_pct` and `tips_per_hour` where they apply); and `pay_every`: `weekly` or `biweekly` (on `pay_weekday`, or counted from the first payday, `pay_anchor`), `semimonthly` or `monthly` (on `pay_days`), `per_job` (at the end of each shift or gig), or `custom` (`pay_unit`, `pay_interval` and the rest, flattened like a flow's schedule). As needed: `hours`, `hours_per_week`, `shifts_per_week`, `weeks_per_year`, `season_from` and `season_to` (`MM-DD`), `start` and `end`, `deductions`, `splits` across the worker's accounts, `contractor` (nothing withheld), `shift_pattern` (the castlife pattern their shifts follow) and `status` (`active`, `leave` or `ended`). Pay follows the work: only inside the season and between `start` and `end`, and hourly or per-shift pay counts what `hours` names, the worker's scheduled commitments (`scheduled`), the shifts they turn up for (`attended`), or `hours_per_week` and `shifts_per_week` (`contract`). Left out, it is `attended` for the POV's own job and `scheduled` for anyone else's while they have a routine at the job, and `contract` without one.

A **business** is an entity of kind `business`: `owners`, `places` it trades at (a purchase there pays it), `operating_account`, `collects_sales_tax`, `margin_pct`, and owner distributions (`distribution_pct`, `distribution_every`). Its accounts are the accounts it owns.

A second job beside the POV's work at the garage: one shift a week through the marina's fall haul-out, paid each Saturday, and nothing outside the season:

```json
[{ "op": "add", "path": "/entities/job_pov_haulout", "value": { "id": "job_pov_haulout", "kind": "job", "name": "Haul-out crew at Alder Harbor Marina", "tier": "background", "fields": { "worker": "pov", "employer": "Alder Harbor Marina", "workplace": "alder_harbor_marina", "basis": "per_shift", "rate": 11000, "hours": "contract", "shifts_per_week": 1, "season_from": "09-15", "season_to": "11-15", "pay_every": "weekly", "pay_anchor": "2026-09-19" }, "relations": [] } }]
```

### Holdings and property

An **asset** is defined once, in `packs.economy.config.assets` by id: `label`, `class` (`security`, `fund`, `bond`, `option`, `property`, `business_stake`, `crypto` or `other`), its `price` per unit at the start, and how it moves (`model`, or `annual_return_pct` and `annual_volatility_pct`) and pays (`yield_pct`). An option names its `underlying`, `strike`, `expiry` and `right` (`call` or `put`). A **holding** is an entity of kind `holding`, a position in one asset: in an `account` (a brokerage or retirement account) or held directly by its `owners`, with `lots` (each `qty`, its total `cost` and when it was bought, `at`) and `route` for its dividends (an account id, or `reinvest`).

```json
[
  { "op": "add", "path": "/packs/economy/config/assets", "value": { "glix": { "label": "Great Lakes Index Fund", "class": "fund", "symbol": "GLIX", "price": 11240, "yield_pct": 1.6 } } },
  { "op": "add", "path": "/entities/hold_pov_glix", "value": { "id": "hold_pov_glix", "kind": "holding", "name": "Great Lakes Index Fund", "tier": "background", "fields": { "account": "acct_pov_brokerage", "asset": "glix", "lots": [{ "qty": 20, "cost": 196000, "at": "2025-03-02" }], "route": "reinvest" }, "relations": [] } }
]
```

A **property** is an entity of kind `property`, real estate tied to a `place`: `owners`, its `value`, `appreciation_pct` a year, and its upkeep (`tax_pct` of value a year, the region's when left out; `insurance` a month; `upkeep_pct` a year). A mortgage is an account of the `mortgage` class whose `secured_by` names the property, and the property's `mortgage` names the account back. A lease is a `rent` flow from the tenant to the owner, `link`ed to the property.

### Paying: preferences, cash machines and credit

- **`pay_prefs`**, a person field, orders how they pay: tiers of `use` (`cash`, `debit`, `credit`, `charge`, `checking`, `savings`, or a card or account id), each for an amount from `min` to `max` and `categories`, but not those in `except`. A payment tries the tiers that fit it in order, then cash, debit, credit and charge; the first that covers it pays, and with none it is declined. Left out, the tiers follow their wealth band and their `traits`: a frugal or careful person keeps to cash and debit longer, an impulsive or flashy one reaches for credit first, a business pays by debit, then credit.
- **Cash machines and branches** are place fields: `atm`, `{"bank", "fee", "limit", "deposits"}` (`fee` is the machine's own surcharge, `limit` the most one withdrawal takes), and `branch`, `{"bank"}`, a counter where that bank's customers withdraw and deposit. Where cash machines run (Money 4), cash comes out and goes in only at one of the two; at another bank's machine the product's `fees.atm` comes on top of the surcharge, a card's `daily_atm_limit` caps a day's withdrawals, and a deposit at a machine stays on hold for the account's `hold_days`.
- **Credit** is played, not written: each person's report and monthly score (300 to 850) come from how their credit accounts are used and paid, and set the rates they are offered. An account's `opened` date counts toward its age.
- **Tax** reads a person's `filing_status` (`single`, `married_filing_jointly` or `head_of_household`) and `local_tax`.

## Places, routes and maps

- Places form a tree through `parent` (a town holds streets, a building its rooms). A place the player hasn't heard of yet is `"visibility": "discoverable"`.
- Routes join places with minutes per travel mode (`walk`, `road`, `offroad`, `water`), both ways unless `bidirectional` is false.
- **A map owns what it draws.** A map (`/maps/<id>`, format `lre-map-v1`) draws one place's inside, as a grid of characters or as linked places, and compiles into places, a grid and routes that carry `"map": "<map id>"`. Those are the map's: **edit the map, never them**. A write to a place, grid or route a map draws is refused ("drawn by the map …; edit it there"), and so is setting `map` on anything else. After a change to the map, the engine draws its places, grid and routes again; delete the map and they go with it. A place, grid or route you write yourself with the same id as one a map would make wins over the map's.

## Tracks: quests and secrets

A track is a small state machine: `start` names its first stage, and each stage's `next` lists `{"to": stage, "when": formula}`, taken in order when the formula holds. A stage may carry a `cue` (what the player can know now), `objectives`, `effects` on entering, `rewards` on leaving, a `gate` and a `fail`. A stage with no `next` ends the track. Secrets advance only by their formulas, never by a model.

- **Quests** start at the stage the story has reached, not at the beginning: `start` is today's stage.
- **Secrets** keep a `truth` (what is really so, kept from the player) on the stage that reveals it, and a `cue` (what the player can notice) on the stages before. A cue never states the truth.

### A revealed secret starts one stage earlier

The engine records a reveal only when a track **enters** a stage with a `truth`. A track that starts on its truth stage never enters it, so the truth is never revealed: the Journal never shows it and the narrator is kept from saying it. **Never start a secret track on a stage that has a `truth`.** For a secret the player has already learned, start one stage earlier on a stage that moves on at once, so the first turn reveals it:

```json
{ "id": "silas_debt", "kind": "secret", "label": "What Silas owes", "visibility": "secret", "owner": "silas", "start": "rumor", "stages": {
  "rumor": { "label": "Something is off", "next": [{ "to": "known", "when": "true" }] },
  "known": { "label": "Silas owes the guild", "truth": "Silas borrowed the guild's harbor dues to pay a gambling debt.", "next": [] } } }
```

### Cues never name the secret

A person's `cues` are what the narrator sees them do while a secret of theirs stays hidden: `{"text": "Changes the subject whenever the guild comes up.", "track": "silas_debt"}`.

- Each cue stands for exactly one secret: a `track` (while it keeps something hidden), a secret `lore` entry (until its gate holds) or a story `flag` (until it is set). A cue keyed to none, or to several, never shows.
- Write behaviour, never the secret: a cue that holds a track's truth or a phrase of secret lore is a lint error, because it gives the secret away.
- Name no one the player may not know: such a cue is left out while they don't (lint warns).
- Only people have cues that show; the stage cues of the tracks a person owns reach the narrator the same way.

## Lore

Lore entries (`/lore/<id>`) are what the world knows, read by the engine's own helpers: `{id, title, content, keys, links, aliases?, topics?}`, where `links` are the ids of the people and places an entry is about.

- `"visibility": "known_by"` keeps an entry back until the player knows every person and place it links.
- **A secret entry** holds a secret itself: `"secret": true`, a `gate` formula that reveals it (lint refuses a secret without one), and an `audience` of the helpers that may read it before then (`npc.choose`, `contradiction`, `puzzle.answer`, `judge`, `interpret`). The helpers that write for the narrator or the player (`brief`, `outline`, `choices`, `extract`) never read it early, even when listed.
- A public entry must never repeat a track's truth: lint refuses it (`secret_truth`).
- `loreIndex` routes the helpers' lookups: `terms` maps a lowercase term to entry ids, `topics` gathers entries under a label.

## Data tables

Prices, pay, taxes, occupations, regions, gear and the calendar's holiday rules come from data tables (`/tables/<id>`): typed `columns` and `rows` keyed by row id, read by the packs and by `table(id, key, column)` in formulas.

- A blank world has none; each starter carries a full set of seventeen. Bring in a table whole, with `id`, `pack`, `schema`, `label`, `columns` and `rows`: copy one from a starter (`lre_template` at `/world/tables/<id>`) and adapt it.
- Cells follow their column: a `band` is `{"min", "typical", "max"}`, money columns are in the currency's minor units, and a `ref` names a row of another table.
- A table's `revision` and its pin in `pins.tables` are the engine's: every write that changes a table computes both again (`hashJson` of its schema, columns and rows). Don't write either, and don't patch `/pins`.
- Each revision of the world keeps its own copy of its tables, so a running chat sees a table change only through an Upgrade.

## Host macros

Lumiverse runs macros (`{{…}}`) in the prompt it builds, and also acts on its control characters and on `<user>`, `<char>` and `<bot>`. LumiRPEngine keeps authored text as written, so in lore content and in section and step templates these are hazards, worth a look before the world is played:

- A section template may use only `{{lines}}`; anything else in one is a lint error (`section_macro`).
- Step templates use the engine's own placeholders (`{{world}}`, `{{pov}}`, `{{place}}`…); lint warns about one it doesn't know.
- Keep `{{user}}` and `{{char}}` out of lore unless the user put them there on purpose. `lre_edit` and `lre_commit` list every hazard a change brings in; say which ones you added.

## Before you commit

- `lre_draft` shows no lint errors, and you know what each warning means.
- The POV exists and stands at the start place; the start time is the story's present.
- Every id an item names (a place, an owner, a relation target, a track in a formula, a lore link) exists.
- Everyone who has met the POV holds a `knows` or a `regard` toward them.
- A death or dying the player hasn't learned of sets `lifeKnownBy`; the dead lie at a `fields.place`.
- Everything someone owns names them in `fields.owner`; every account, business, holding and property names its holders in `fields.owners`.
- Every flow and job pays from and to something that exists, with an amount and a schedule (or `once`).
- A world that gives the narrator minds in full (`"secrecy": "full"`) has no secret a character would think about openly.
- No secret track starts on a stage with a `truth`, no cue states its secret, and no public text gives one away.
- Nothing a map draws was edited outside its map; no `revision` or pin was written by hand.
- `lre_playtest` and `lre_check_world` run without failures or leaks in their notes.
- Commit with a note that says what changed, and tell the user what you changed and what you left for them.
