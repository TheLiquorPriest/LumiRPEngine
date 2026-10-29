# Writing LumiRPEngine worlds: a guide for agents

Read this before you touch a LumiRPEngine world through the `lumirpengine` MCP server or command line ([MCP.md](MCP.md)): the world model, how to work on a user's worlds, and the mistakes that are easy to make and hard to see. Every kind, field, effect and formula function is in the reference (`lre_docs`); complete worlds to learn from are the starters (`lre_template`). How outside agents reach LumiRPEngine is DESIGN §23.

## The world model

A world is one JSON document in the `lre-world-v1` format, with a published JSON Schema (`lre_schema`). Each commit makes an immutable **revision**, named by its content hash; the newest is the world's **head**, and a chat plays the revision it was started on until the player upgrades it. Changes go to a **draft** first: a working copy that a commit turns into the next revision.

- **Collections** are objects keyed by id: `kinds`, `relations`, `entities`, `places`, `routes`, `grids`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `sections`, `steps`, `packs`, `lore`, `classifications`, `tiers`, and `lifeStates` and `routines` when the world has them.
- **Parts** are single values: `calendar`, `realism`, `time`, `start` (`{place, at}`), `pov` (the entity the player plays), `currency`, `loreIndex`, `pins`, and the optional `ruleset`, `mapSettings`, `spawnTier`, `spawnCap`, `routineSettings`, `sectionTemplates` and `narrator` (the narrator's knowledge in the world's chats, whole: `{"knowledge": "scene" or "pov", "secrets": "marked" or "omit"}`; left out, each user's Settings → Narrator decides, and a chat's own choice beats either).
- **Checks:** `ruleset.adjudication` decides how checks are decided, and `ruleset.inferred` how a typed attempt no action with its own check covers is read as a check of the world's sheet (`mode`, `when`, `who`, `skills`, `difficulty`, `detail`, `others`, `guidance`, `most`; it must name its `mode`). A world without one leaves inferred checks to each chat's realism preset. The skills it rolls are the world's own: the rows of a skill action's table (Use a skill, Make a save) or the Sheets pack's stats, so give an attempt that matters to the story its own action with its own check, which keeps it.
- **Kinds** are types with fields and single inheritance (`extends`). The packs define the common ones: `thing` (with `owner` and `place`), `person`, `item`, `container`, `kit`, `vehicle`, `region`, the money kinds (`account`, `card`, `flow`, `job`, `holding`, `property`, `business`, `trust`, `invoice`), and `group` with its `faction`, `family`, `household` and `company`. A world kind with a pack kind's id replaces it whole, so extend a pack kind rather than redefine it.
- **Entities** are the people and things: `{id, kind, name, tier, fields, relations}`, plus `life`, `lifeKnownBy`, `agent`, `cues`, `class`, `tags`, `visibility` and `knownBy` as needed. Fields hold values; relations are `{type, to, fields?}` links to other entities.
- **Actions** need a one-line `description`: typed messages are read against each action's label and description.
- **Formulas** are strings in a small, safe expression language (`lre_docs` with `doc: "expressions"`): `at(pov, 'archive')`, `stage.hale_debt == 'revealed'`, `hour >= 18`. Dice are notation strings (`1d20`).
- **Money** is always a whole number of the currency's minor units: 4250 is $42.50 in a dollar world. **Times** are local ISO date-times (`2026-09-14T18:30`).

## How to work on a user's world

1. **Read before you write.** `lre_worlds` lists the worlds and whether each has a draft stored. A draft that is already there when you start is the user's work in progress: ask them before you edit, commit or discard it. `lre_world` reads one at a JSON Pointer: `""` gives an outline of the whole world (collections with their ids), `/entities/mara` one item. `lre_search` finds an item by what it says.
2. **Edit the draft.** `lre_edit` takes JSON Patch (RFC 6902) operations whose paths point into the whole world: `add` creates an item or a field, `replace` changes one that exists, `remove` deletes, `test` guards a value. All the operations of one call apply, or none do. Pass `expectVersion`, the draft version from your last read (`lre_world`, `lre_draft` and `lre_worlds` give it even with no draft stored; each `lre_edit` answers the new one): if the draft has changed since, the edit is refused.
3. **Check.** Every `lre_edit` answers the lint the draft has now and any macro hazard the edit brought in. `lre_draft` sums up the draft against the head; `lre_diff` shows field by field what changed. `lre_playtest` plays typed turns and `lre_check_world` simulates whole days, both with the bundled engine and no model.
4. **Commit, or discard.** `lre_commit` with a short note makes the draft the head; the note goes into the world's history (`lre_history`). It is refused while the draft has lint errors, which it lists. `lre_discard` throws the draft away. Pass both the `expectVersion` you last saw, as for `lre_edit`.

**The draft is the user's Build draft.** Build edits the same single draft: the user sees your changes as you make them, and you see theirs. Don't leave a draft behind: commit what you finished, discard what you didn't, and say which you did. If an edit is refused because the version moved, read the draft again: the user may be editing it.

**A commit takes the whole draft.** When the user presses Commit in Build, your unfinished changes go into that revision with theirs; when you commit, their changes go in with yours. So finish one change before you start the next, and tell the user what you are in the middle of. With `expectVersion`, `lre_commit`, `lre_discard` and `lre_restore` are refused if the draft moved since you read it. A commit is refused, too, when the head is no longer the revision the draft began from: compare with `lre_diff`, discard, and redo the change on the new head.

**Chats keep their revision.** Committing changes no running chat. `lre_chats` says which chats are behind; `lre_upgrade` with `preview` shows what an Upgrade would bring in; without it, it applies the default picks: what play never touched takes the new revision, what play changed stays. So keep every id a chat uses: a renamed id is a new thing, and the old one stays in the chat.

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
- **Tiers** say how deeply someone is simulated: by default `principal` (Leads), `supporting` and `background`. `"agent": true` makes someone pursue their own agenda off-screen, and live the plans the story gives them. Anyone else only follows their schedules: their plans are never lived and lapse, so mark `agent` on whoever should act on their own plans. An agent's ordinary day comes from their routine (see Routines and schedules).
- **Who knows the POV.** Everyone who has met the POV holds a `knows` relation toward the POV, or a `regard`. The narrator learns from exactly that whether Mara knows you, so a friend without either greets the player as a stranger.
- **Regard** is one directed relation with `warmth`, `trust` and `respect` from −100 to 100; write each direction that matters. Kinship (`parent_of` and `child_of`, `sibling_of`, `spouse_of`, `partner_of`) is kept two-sided: write both sides.
- **Life and death.** `life` is the state someone starts in: `alive` when unset, `dying`, `dead`, or one of the world's own `lifeStates`. The dead keep their place: give a body a `fields.place` where it lies, and no schedule (someone who doesn't act follows none).

### lifeKnownBy: who knows how someone starts

When someone starts dead or dying, `lifeKnownBy` lists the ids of the people who know it; everyone else, the POV included, takes them for alive until they see the body or are told. **Left out or empty, everyone knows**, which tells the player at once. So:

- a death the player hasn't learned of lists who does know, including everyone who starts in the same place as the body;
- when nobody else knows yet, list the person themself (the list is then not empty, and no one else learns it);
- on someone who starts alive it changes nothing (lint warns), and every id in it must be an entity of the world.

```json
{ "id": "old_bram", "kind": "person", "name": "Old Bram", "tier": "supporting", "life": "dead", "lifeKnownBy": ["corin"], "fields": { "place": "net_loft" }, "relations": [] }
```

## Character minds

A character can have a **mind**: a model call made as that character alone, on what they know (their entity's fields, never a Lumiverse character card; the lore they may read, the turns they were there for, their notes and commitments, their money and their day). It answers with their private read of the moment and what they intend; the narrator then depicts it. Minds are blind to each other; Playtest and Check world call no model, so they play a world without minds. So write who someone is into their fields (`description`, `traits` and the rest): no character card fills it in. A mind knows the truths of the tracks its character owns, of a secret their cue stands for, and of secret lore whose `holders` name them; a secret held from the start goes on the agenda's start stage (entering a stage tells the player its truth).

Who gets a mind is decided each turn by a **focus score**: points for being in the POV's scene or close by, being named, a relation with the POV, a stake in tracks and rules under way, plans with the POV, and their tier. The score puts each character on a ladder: **Live** (a mind every turn), **Near** and **Far** (a mind on their refresh), **Background** (routine only). The world tunes the ladder and what minds remember in its `minds` part:

```json
[{ "op": "add", "path": "/minds", "value": {
  "secrecy": "brief",
  "weights": { "mentioned": 50 },
  "thresholds": { "live": 60, "near": 35, "far": 15 },
  "always": { "ids": ["marcus_delgado"] },
  "never": { "tag": ["crowd"] },
  "memory": { "notes": { "show": 10, "keep": 30 }, "salience": { "halfLifeDays": 14 } },
  "holdings": { "marcus_delgado": { "track:s_shop_trouble:truth": { "keptFrom": "everyone" } } } } }]
```

- **`secrecy`** decides what the narrator gets. `full` (the default, for a world that says nothing): the monologue, intent, reactions and mood too, to depict and never state. `brief`: only a depiction, written as behaviour anyone present could see and withheld when it would give away a secret or a name the POV can't know, while the monologue stays in the GM view. A mind knows its own character's secrets, so set `brief` where a private thought reaching the narrator would give one away.
- **`weights`** are the points each input adds, from −100 to 200: `here` 45, `nearby` 20, `mentioned` 40, `regard` 10, `knows` 10, `owner` (owns a track under way) 15, `track` (named in one) 8, `rule` 5, `pending` (an invitation, appointment or plan with the POV) 15, `recent` 10, `band` 15, 5 and 0 for principal, supporting and background, and `roles` by classification value id (`antagonist` 20). A role weight counts only where one of the world's classifications has that value (lint warns about one that none has), and a world's `roles` replaces the default map whole.
- **`thresholds`** are the lowest scores for Live, Near and Far (60, 35 and 15); below Far is Background. Live is only for someone at hand: in the POV's scene or named this turn. Being close by adds points but never makes someone Live; anyone not at hand is Near at most, whatever their score.
- **`always`** and **`never`** are selectors (`ids`, `kind`, `tier`, `memberOf`, `tag`, `class`): `always` keeps people Live wherever they are; `never` keeps them Background, mindless, and wins over `always`. A GM's pin in a chat wins over both. An id, kind, tier, group or classification the world doesn't have is a lint error.
- **`memory`** is what a mind is shown and how long a note lasts, in entries unless named: `witness.show` (what they saw lately, 8), `recall.recent` and `recall.relevant` (their latest turns and those best matching the moment, 4 each) within `recall.tokens` (1200), `notes.show` (8) and `notes.keep` (24 before the oldest are folded into their summary), `commitments.show` (8; open ones are kept until resolved), `salience.halfLifeDays` (a note's weight halves every 7 game days) and `salience.floor` (below 0.5 it has faded), and `consolidate.enabled` (true: faded and surplus notes fold into the summary, not lost). The user's own settings win over the world's.
- **`holdings`** is what each person, the POV included, knows from the start: by entity id, each fact by its id, `lore:<entry>`, `track:<track>:<stage>` (a stage's truth) or `field:<entity>:<field>`, with `belief` (`"true"`, `"false"` or `"uncertain"`; true when left out), `confidence` (0 to 1; 1 when left out) and `keptFrom` (`"everyone"` or a list of people; no one when left out). They seed each chat's knowledge. A World Info entry's secret marks name their own holders, so don't list those here; lint (`minds.holdings`) flags a holder who isn't a person and a fact the world doesn't have.
- Every part is optional; one left out or out of range reads as its default, and lint says so. The user decides in their settings whether minds run at all, and how many Live minds a turn may have.

**Prompts.** The five minds steps, `mind`, `memory`, `skip` (a time skip's turning points), `consolidate` (folding old notes into a summary) and `knowledge` (after each reply, while the chat tracks who knows what: who learned which fact, by seeing it or being told, what someone worked out and how sure, and what someone now doubts), take world step templates as the other steps do, with `"output": "text"` and `"signals": []`: minds run on their own cadence, so signals are ignored (lint notes any as info). The template is the step's instructions only, with `{{character}}` the character's name (empty for a `knowledge` call about the whole scene, the default) and `{{world}}` the world's: the engine appends the answer's format itself, which no template replaces, so write how to think, never the JSON. The engine checks a `knowledge` answer whatever the template says: no one witnesses what they weren't there for, a teller holds what they tell, an inference rests on what its person holds or saw, and the player character never infers or doubts. The player's own prompt wins over the world's template, which wins over the built-in; give each purpose one at most (lint warns of a second, and a blank one is skipped).

```json
[{ "op": "add", "path": "/steps/mind_port_alder", "value": { "id": "mind_port_alder", "purpose": "mind", "output": "text", "signals": [],
  "template": "You are the private mind of {{character}} in {{world}}, a lake town where everyone knows everyone's business and says less than they mean. Think as {{character}}, from only what they know below. Decide how they read this moment and what they intend; never script anyone else, and keep to what a neighbour would notice." } }]
```

## Routines and schedules

A **routine** is what someone can be relied on to do on an ordinary day; a **schedule** is a commitment with set hours (a shift, school). Both are defaults the world leans on, never authority over the story: what the story established (a place or activity an action, the narration or the GM set, a trip, the GM's intent) always comes first, then schedules and appointments, then story plans, then the routine, then the basic needs (sleep, breakfast, lunch, dinner), then chores and agenda steps. Nothing else fills a day. A routine never moves anyone out of a scene with the POV and never moves a Live or Near character; it matters most for the Background cast off screen. So write a routine as a person's habits, not a timetable they must keep: leave people with no routine at all when the world says nothing about their days, and they live on the story, their commitments and their basic needs.

A routine is one item of `routines`: `{id, label?, owner?, inherit?, blocks, source?}`. Its **owner** is read as a schedule's is: an entity, a group (its members), a kind, a selector, or none for the world's default for everyone. For each block id the most specific owner wins (their own, a group's, a kind's, a selector's, the world's, then the basic needs), and `inherit: false` drops the less specific routines' blocks for whom it covers. Each block has an `id`, a `label`, an `activity` (`work`, `socialize`, `leisure`, a meal, `sleep` or the world's own), `minutes`, and a `kind`:

- **`fixed`** starts at `at` (`HH:MM`);
- **`flexible`** takes its minutes somewhere in its `window` (`{from, to}`, `HH:MM`; a `to` at or before `from` runs past midnight), and `perWeek` makes it a floating block ("the gym three times a week");
- **`optional`** is flexible by `chance` (above 0, at most 1): the first thing a busy day leaves out.

The rest is optional: `days` (`weekdays` with 0 for Sunday, `off: "only"` or `"never"` for days off, `holidays` and `except` by the calendar's ids, `birthday`, `seasons`, `weather`), `place` (`home`, the default, `work`, `here`, `with` its company's home, `{place}` or `{nearest: sceneType}`), `company` (`{who: selector, invite?}`), `priority` (1 to 5), `needs`, `private` (the player reads it as "Busy") and `source`. Give a block its ground when the world has one: `{"type": "lore", "entry": …, "quote": …}` or `{"type": "sheet", "entity": …, "field": …, "quote": …}`, with the short quote it rests on, so the GM sees why it's there. `{"id": "lunch", "off": true}` turns off a less specific block or a basic need.

```json
[{ "op": "add", "path": "/routines", "value": { "dale_mornings": {
  "id": "dale_mornings", "label": "Dale at the marina", "owner": "dale_whitcomb",
  "blocks": [
    { "id": "open_marina", "label": "Opens the marina", "activity": "work", "kind": "fixed", "at": "06:30", "minutes": 90, "place": { "place": "alder_harbor_marina" }, "days": { "weekdays": [1, 2, 3, 4, 5, 6] },
      "source": { "type": "lore", "entry": "lore_marina", "quote": "Dale Whitcomb has run it for twenty-five years." } },
    { "id": "coffee", "label": "Coffee at the Bluebird", "activity": "socialize", "kind": "flexible", "window": { "from": "09:00", "to": "11:00" }, "minutes": 30, "perWeek": 3, "place": { "place": "bluebird_coffee" } }
  ] } } }]
```

A block that asks someone along makes an invitation only when the world's settings allow it: here the POV, on Thursday evenings, from the Rusty Anchor's trivia night the lore tells of.

```json
[{ "op": "add", "path": "/routines/marcus_trivia", "value": {
  "id": "marcus_trivia", "owner": "marcus_delgado",
  "blocks": [{ "id": "trivia", "label": "Trivia night at the Anchor", "activity": "socialize", "kind": "fixed", "at": "19:30", "minutes": 120, "days": { "weekdays": [4] }, "place": { "place": "rusty_anchor" },
    "company": { "who": { "ids": ["pov"] }, "invite": true },
    "source": { "type": "lore", "entry": "lore_anchor", "quote": "a Thursday trivia night that gets competitive" } }] } }]
```

**Tuning** is the `routineSettings` part; each part left out keeps its default, and the defaults are no part at all:

- **`awareness`**: how long someone the story put somewhere stays there against their routine. `story_first` keeps them until the story or the GM releases them; `balanced` (the default) until their night, with Background characters keeping their routine and Far ones bending for story plans and the GM's intent; `routine_first` lets the routine's next edge take them back.
- **`invitations`**: `off`, `player` (the default: routine blocks may invite the POV) or `everyone` (people's days take each other's invitations too). Story plans and the GM invite under any setting.
- **`sociability`**: `reserved`, `usual` or `outgoing`, how fast NPCs' social and fun needs grow.
- **`planBend`**: which story plans take their time from work and school: `must`, `strong`, `standard` (the default) or `ordinary`.

```json
[{ "op": "add", "path": "/routineSettings", "value": { "awareness": "story_first" } }]
```

**Editing.** `lre_routine_put` and `lre_routine_delete` write one routine whole, and `lre_routine_settings` the settings, each at the version you read; `lre_edit` works on `/routines` and `/routineSettings` as above. A routine whose shape the engine can't read, or a setting or value it doesn't take, is refused before anything is written, with a message naming the field (`window`, `kind`, `minutes`, `awareness`…), exactly as Build's save is: fix that field and send it again. What a routine names that the world lacks (a place, an owner who matches nobody, a lore entry) is a lint warning after the write. `lre_schedules`, `lre_schedule`, `lre_schedule_put` and `lre_schedule_delete` do the same for schedules.

**In a chat** the world's routines are only where it starts. Change someone's routine in one chat with `lre_routine_edit` (`routine_follow` for whether and how strictly they keep it, `routine_block` for one block, `schedule_override` for a schedule; each is one Undo-able fix), read their day and why each block is there with `lre_day`, and what the chat changed with `lre_routine_changes`. Change the world's routine only for what is true of the world; what happened in one story belongs to that chat.

## Things and who owns them

- Where a thing is: `fields.place` for something lying in a place, a relation `{"type": "in", "to": "rhea"}` for something carried or inside a container.
- **Whose a thing is lives in `fields.owner`**, the owner's id. That puts it on their gear, a vehicle in their garage and at their levels, and lets them drive it. The `owns` relation only changes how the Journal words a change: an item with an `owns` link and no `fields.owner` belongs to no one. Set `fields.owner` on everything someone owns. Money is owned differently: see Money.

## Money

Money is entities, a few fields and the economy pack's config. Amounts are whole minor units (4250 is $42.50 in a dollar world) and percentages are percent units (22 is 22 %). What runs for someone depends on their Money level: the world's `realism.levels.money`, capped by their tier's band (the POV is never capped). At 0 money is off; at 1 a person's `wealth` band is all there is; at 2 their cash and one everyday account are real, and a payment they can't cover is declined; from 3 all their accounts, and more as below.

| From | What runs | Its feature ids |
|---|---|---|
| Money 3 | flows (so bills, pay and a business's takings), cards, payment preferences, household shares, living costs, property, withholding at a flat rate | `flows`, `cards`, `payment_prefs`, `households`, `living_costs`, `property`, `withholding` |
| Money 4 | statements and minimum payments, interest (on the average daily balance where an account asks for it), fees, late payments and collections, credit scores, cash only at a machine or a branch, holds, daily card limits, overdraft policies, withholding through the tax brackets, sales tax, business taxes, investments, options, capital gains | `statements`, `interest`, `average_daily`, `fees`, `delinquency`, `credit`, `atm`, `holds`, `daily_limits`, `overdraft`, `tax_brackets`, `sales_tax`, `business_tax`, `investments`, `options`, `capital_gains` |

A world switches a feature on or off for itself in `packs.economy.config.features` by its id (`{"sales_tax": true}`), down to its floor: Money 2 for `flows`, `cards`, `payment_prefs`, `households`, `living_costs`, `atm`, `daily_limits` and `overdraft`, Money 3 for the rest. Lint warns about an id it doesn't know.

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

Read `/packs/economy/config` before adding to it; the modern starter's has no `products` map yet. Where the world has none, add the map whole with the first product in it, as below (JSON Patch adds into a map only once it exists); where it has one, add each product by its own path, `/packs/economy/config/products/<id>`, since adding the whole map replaces it and drops every product already in it. `assets` works the same, and in the modern starter it is added to by id, as further down. The same goes for entities: `add` on an id that is taken replaces that item whole, so look an id up before you use it.

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
[{ "op": "add", "path": "/entities/flow_pov_boat_fund", "value": { "id": "flow_pov_boat_fund", "kind": "flow", "name": "Boat fund", "tier": "background", "fields": { "flow_kind": "savings", "from": "acct_pov_checking", "to": "acct_pov_savings", "amount_cents": 4000, "every": "week", "interval": 2, "weekdays": [5], "start": "2026-09-18", "shortfall": "skip", "category": "savings" }, "relations": [] } }]
```

### Businesses and invoices

A **business** is an entity of kind `business`, a party with `owners` (and their `share`s) and a `structure`: `sole_proprietorship`, `partnership`, `llc` (the default), `s_corp` or `c_corp`.

- **Where it sells:** a purchase at one of its `places` (else where it stands) pays it. `daily_sales` is what walk-in customers from outside the world spend there on each of its `trading_days` (0 is Sunday; Monday to Friday when left out), give or take `sales_spread_pct` (30 when left out), paid at closing and never on a day-off holiday.
- **Its money** is in the accounts it owns. `operating_account`, one of them, is where takings land and payroll comes from (else its best deposit account). It keeps `margin_pct` of a sale (all of it when left out) and owes the rest to its suppliers, paid on the 10th; the sales tax it collects is paid on the 20th. Its rent, bills and loan payments are flows from its accounts.
- **Its owners** take draws in play, except from a `c_corp`. `distribution_pct` pays that share of each period's profit out to the owners by share, every `distribution_every` (`month`, `quarter` (the default) or `year`), on the 10th after the period closes.
- **Its books**, month by month, are kept by the engine from all of that: there is nothing to write.

A business's own Money level is its tier's cap, as a person's is: it decides whether the business collects sales tax and pays business taxes (Money 4) and whether its invoices go late (Money 3). Its payroll, takings and other flows go through its accounts, and an account runs at the highest level of those who may spend from it (the business and its authorized users), whatever the account's own tier. So give a business the `principal` tier, as the modern starter does, for all of it to run.

Dale's marina has run on his own account so far, its takings flowing into it and its bills out. Making it a business moves the account to the business, with Dale still able to spend from it as an authorized user, and a purchase at the marina then pays it. The account was all Dale had, so he gets a checking account of his own as well: without one, his own spending and bills would come out of the business's.

```json
[
  { "op": "add", "path": "/entities/alder_harbor_marina_co", "value": { "id": "alder_harbor_marina_co", "kind": "business", "name": "Alder Harbor Marina", "tier": "principal", "fields": { "owners": [{ "party": "dale_whitcomb", "role": "owner" }], "structure": "sole_proprietorship", "places": ["alder_harbor_marina"], "operating_account": "acct_dale_marina", "industry": "marina", "margin_pct": 70, "late_fee_pct": 1.5 }, "relations": [] } },
  { "op": "replace", "path": "/entities/acct_dale_marina/fields/owners", "value": [{ "party": "alder_harbor_marina_co", "role": "owner" }, { "party": "dale_whitcomb", "role": "authorized_user" }] },
  { "op": "add", "path": "/entities/acct_dale_checking", "value": { "id": "acct_dale_checking", "kind": "account", "name": "Dale's checking account", "tier": "background", "fields": { "owners": [{ "party": "dale_whitcomb", "role": "owner" }], "product": "checking", "opening": 640000, "institution": "Great Lakes Bank" }, "relations": [] } }
]
```

An **invoice** is an entity of kind `invoice`: the `business` that issued it, the `customer` (a party's id, or an outside customer by name), `cents`, `memo`, `issued`, `due` (30 days after `issued` when left out), `state` (`open` when left out, `paid`, `late` or `void`) and `paid`, what is paid of it so far. Lint requires the business, the customer and an amount above zero. An open invoice is paid as a bill from the customer's accounts on its due date and every week after until it is paid; an outside customer pays on the due date. Unpaid when its due day ends, it goes `late` and takes the business's `late_fee_pct` of the amount, and the fee again every 30 days. A business's `invoice_days` (30 when left out) are the terms of the invoices it issues in play.

```json
[{ "op": "add", "path": "/entities/inv_pov_winter_storage", "value": { "id": "inv_pov_winter_storage", "kind": "invoice", "name": "Winter storage", "tier": "background", "fields": { "business": "alder_harbor_marina_co", "customer": "pov", "cents": 48000, "memo": "Winter storage for the fishing boat", "issued": "2026-09-14", "due": "2026-10-14", "state": "open" }, "relations": [] } }]
```

### Work and pay

A **job** is an entity of kind `job`, one worker's employment:

- **Who and where:** `worker`; `employer`, a business entity (paying from its operating account), a place (the business trading there, else an outside employer) or an outside employer named in words, an id-shaped one that names no one and no place drawing a lint warning; `workplace`, the place the work is (else the business's `places`); `title`; and `occupation`, a row of the occupations table (else the worker's own `occupation`).
- **Pay:** `basis`, which is `salary` (a year), `hourly`, `per_shift`, `commission`, `tips` or `stipend` (a period), and `rate`, both from the occupation's row when left out; `commission_pct` of the sales credited to the worker; `tips_per_hour` on top of hourly pay.
- **When it pays:** `pay_every`, the occupation's when left out: `weekly` or `biweekly` on the weekday of `pay_anchor` (the first payday), else of `pay_weekday` (Friday); `semimonthly` on `pay_days` (the 15th and the last); `monthly` on one day (the last); `per_job`, each evening at 21:00 for that day's work; or `custom`, a flow's schedule with `pay_` before each part (`pay_unit`, `pay_interval`, `pay_weekdays`, `pay_days`, `pay_months`, `pay_except`). A payday on a weekend or a day-off holiday moves to the business day before it (`pay_roll`: `before`, `after` or `none`).
- **What it pays for:** the days from `start` to `end`, and inside the season (`season_from` to `season_to`, `MM-DD`, which may wrap the new year). Hourly and per-shift pay count what `hours` names: the worker's scheduled commitments at the workplace (`scheduled`, laid out by `shift_pattern`, a row of the `calendar.shifts` table), the shifts the POV turns up for (`attended`), or `hours_per_week` and `shifts_per_week` over `weeks_per_year` (`contract`). Left out, it is `attended` for the POV and `scheduled` for anyone else while they have a routine at the job, and `contract` without one. `status` is `active`, `leave` (paid nothing) or `ended`.
- **The paycheck:** `deductions` come off the gross first, each `{label, cents or pct, pretax, kind, to, match_pct}`. A `pretax` one comes off income-tax wages (a `retirement` one still counts as wages for Social Security and Medicare; any other doesn't). `to` is an account of the worker's, else an outside payee by name, and a business employer adds `match_pct` of the gross, up to the deduction, to that account. Withholding follows (Taxes, below), and none for a `contractor` (the occupation's `self_employed` when left out). `splits` route the net among the worker's own accounts, each `{to, cents}` or `{to, pct}`: fixed amounts first, then percentages of the rest, and what's left to their deposit account.

Each job pays through a flow from its employer to the worker. A paycheck covers the work since the last one paid, so a payday the employer can't cover is paid with the next. In play, a business's owner hires, ends jobs and raises pay; a GM edit of the job's fields does the same.

A second job beside the POV's work at the garage: one shift a week on the marina's fall haul-out crew, paid on Fridays with half of each check into savings, and nothing outside the season:

```json
[{ "op": "add", "path": "/entities/job_pov_haulout", "value": { "id": "job_pov_haulout", "kind": "job", "name": "Haul-out crew at Alder Harbor Marina", "tier": "background", "fields": { "worker": "pov", "employer": "alder_harbor_marina_co", "workplace": "alder_harbor_marina", "title": "Haul-out crew", "basis": "per_shift", "rate": 11000, "hours": "contract", "shifts_per_week": 1, "season_from": "09-15", "season_to": "11-15", "pay_every": "weekly", "pay_anchor": "2026-09-18", "splits": [{ "to": "acct_pov_savings", "pct": 50 }] }, "relations": [] } }]
```

And a 401(k) at the garage: 5 % of the POV's pay before income tax into a retirement account of theirs, which the shop matches up to 3 % of pay:

```json
[
  { "op": "add", "path": "/entities/acct_pov_401k", "value": { "id": "acct_pov_401k", "kind": "account", "name": "Your 401(k)", "tier": "background", "fields": { "owners": [{ "party": "pov", "role": "owner" }], "product": "retirement", "opening": 0, "institution": "Great Lakes Bank" }, "relations": [] } },
  { "op": "add", "path": "/entities/job_pov_mechanic/fields/deductions", "value": [{ "label": "401(k)", "kind": "retirement", "pretax": true, "pct": 5, "match_pct": 3, "to": "acct_pov_401k" }] }
]
```

### Taxes

- **On pay**, withholding runs from Money 3 at a flat rate: the occupation's withholding rate (federal tax, Social Security and Medicare together) and the worker's state rate, plus their region's local rate when they have `local_tax: true`. At Money 4 it goes through the federal brackets and standard deduction for their `filing_status` (`single` when left out, `married_filing_jointly` or `head_of_household`), with Social Security and Medicare, then the state and local rates.
- **Regions** are rows of the regions table (`mi`, `il`…), with their state, local and sales tax rates. The economy config's `region` is the world's own (the modern starter's is `mi`); without one, what it would cover runs at the national row's rates. A party's income tax follows its own `region` field, else the config's.
- **Income nobody withholds from** is paid as estimated tax on 15 April, June and September and 15 January: a contractor's pay, and an owner's share of the profit of any business but a `c_corp` where that business pays business taxes. A `c_corp` pays corporate tax on its own profit, at the config's `taxes.corporatePct` (21 when left out) plus the state rate.
- **Sales tax** runs only at the top level, Money 4 (or from 3 where the world switches `sales_tax` on), and at the buyer's level: below it a price is as listed, and a business below it neither collects nor remits. The rate at a place is its `sales_tax_pct` (or an enclosing place's), else that of its tax region: a `tax_region` on it or an enclosing place, else the config's `region`. Nothing is charged on a category in the config's `taxes.exempt` (the modern starter's holds `groceries_staples`, `groceries_baskets` and `medical`) or in a place's `tax_exempt`, nor on what a business with `collects_sales_tax: false` sells.

The modern starter's economy is in Michigan, so a purchase in Chicago is taxed at Michigan's rate. To tax it for Illinois at Chicago's own combined rate, and the POV's pay at Michigan's typical local rate:

```json
[
  { "op": "add", "path": "/places/chicago_il/fields/tax_region", "value": "il" },
  { "op": "add", "path": "/places/chicago_il/fields/sales_tax_pct", "value": 10.25 },
  { "op": "add", "path": "/entities/pov/fields/local_tax", "value": true }
]
```

### Paying: preferences, cash machines and credit

- **`pay_prefs`**, a person field, orders how they pay: tiers of `use` (`cash`, `debit`, `credit`, `charge`, `checking`, `savings`, or a card or account id), each for an amount from `min` to `max` and `categories`, but not those in `except`. A payment tries the tiers that fit it in order, then cash, debit, credit and charge; the first that covers it pays, and with none it is declined. Left out, the tiers follow their wealth band and their `traits`: a frugal or careful person keeps to cash and debit longer, an impulsive or flashy one reaches for credit first, a business pays by debit, then credit.
- **Cash machines and branches** are place fields: `atm`, `{"bank", "fee", "limit", "deposits"}` (`fee` is the machine's own surcharge, `limit` the most one withdrawal takes), and `branch`, `{"bank"}`, a counter where that bank's customers withdraw and deposit. Where cash machines run (Money 4), cash comes out and goes in only at one of the two; at another bank's machine the product's `fees.atm` comes on top of the surcharge, a card's `daily_atm_limit` caps a day's withdrawals, and a deposit at a machine stays on hold for the account's `hold_days`. This applies only once the world places at least one `atm` or `branch`; place none and cash moves freely at every level.
- **Credit** is played, not written: each person's report and monthly score (300 to 850) come from how their credit accounts are used and paid, and set the rates they are offered. An account's `opened` date counts toward its age.

**Player claims.** A typed action on a thing the player says they have that the world doesn't may make it (the chat's Player claims setting): an item with `fields.claimed: true`, the POV's, priced against `economy.catalog`. It is never money and never an authored thing: a requirement or gate on an id (`carries(self, 'shop_office_key')`) never passes on a claimed key, while `has_item` by name counts one, so test ids for what must be earned. Keys, weapons and documents always ask the player first; `packs.economy.config.claimCap` (minor units; unset, twice `meals_out`'s typical price) caps what a capped policy makes without asking.

## Holdings and property

Everything a party owns besides the money in its accounts: positions in assets, real estate and stakes in businesses, each counted in its net worth. Prices, payouts, trades and gains run where the `investments` feature does (Money 4), options where `options` does (Money 4), and property from Money 3 (`property`). The examples here build on the marina business of Money.

### Assets

An **asset** is defined once, in `packs.economy.config.assets` by id (the modern starter lists `broad_us_equity_index`, `glbd`, `lkfr`, `tnote_2030` and `btc`): a `label`, a `class` (`security`, `fund`, `bond`, `option`, `property`, `business_stake`, `crypto` or `other`), a `symbol` to show, and its `price` per unit at the start (100.00 when left out).

- **How its price moves:** each class follows a recipe row of the finance table's `investing` section: securities and funds the stock index (`broad_us_equity_index`), bonds `bonds_aggregate`, crypto `crypto`. `model` names another row (`cash` holds its price), and an asset's own `annual_return_pct` (its total return), `annual_volatility_pct` and `correlation` (0 to 1, how closely it moves with its market) override the recipe. Prices are marked at 16:00 on each business day, every day for crypto.
- **What it pays:** `yield_pct` of its value a year, paid `pays_per_year` times (4 for securities and funds, 12 for a bond fund, none for crypto). A payout comes out of the total return, so it is never counted twice. A single bond has a `face`, a `coupon_pct` and a `maturity`: it pays its coupon twice a year and is redeemed at its face on its maturity date.
- **An option** names its `underlying` (an asset the world lists), `strike` (per unit), `expiry` (`YYYY-MM-DD`), `right` (`call` or `put`), `multiplier` (100 units a contract) and `settlement` (`physical`, the default, or `cash`). It is priced from its underlying, so it takes no `price`.

Lint (`economy.assets`) requires a class, an option's terms, a bond's maturity with its face and a price above zero, and warns about a `model` the table doesn't list. A regional fund with its own return and twice-yearly payouts, and a December call on Lakefront Freight:

```json
[
  { "op": "add", "path": "/packs/economy/config/assets/glix", "value": { "label": "Great Lakes Index Fund", "class": "fund", "symbol": "GLIX", "price": 11240, "annual_return_pct": 8, "annual_volatility_pct": 18, "yield_pct": 2.2, "pays_per_year": 2 } },
  { "op": "add", "path": "/packs/economy/config/assets/lkfr_c4500_dec26", "value": { "label": "LKFR December 2026 45 call", "class": "option", "underlying": "lkfr", "strike": 4500, "expiry": "2026-12-18", "right": "call" } }
]
```

### Holdings, trades and payouts

A **holding** is an entity of kind `holding`, a position in one asset: in an `account` (a brokerage or retirement account, its owners the holding's by their shares) or held directly by its `owners`. Its `lots` are its purchases, oldest first, each `qty`, its whole `cost` and when it was bought (`at`); for an option, `qty` counts contracts. Lint (`economy.holdings`) requires an asset the world lists, an account that is one, owners for a holding in none, and lots as a list.

- **Trades are played** (the `trade` action): buy or sell an asset or a holding, in units or for an amount (a sale with neither sells it all), held in an `account` (else directly), paid `from` an account (else the investment account's own cash, else the buyer's deposit account), with the proceeds `to` an account (else the holding's account, else the seller's deposit account). Units go first in, first out, and each sale realises its gain, short term on lots held under a year. A retirement account keeps a sale's proceeds.
- **Options** trade whole contracts. Before expiry, a holder exercises in play (`exercise_option`): a call pays the strike for 100 units of the underlying, which land in the same account. At the close on its expiry date a contract in the money settles in cash at what it is worth, and one out of the money expires worthless.
- **Payouts** are flows: dividends mid-month in evenly spaced months ending in December (quarterly: March, June, September and December), a bond fund's monthly, a bond's on its coupon dates, each the units held then times what a unit pays. One lands where the holding's `route` says: `reinvest` buys more units at that day's price, as a new lot; an account id pays it there; left out, it goes to the holding's account, else each owner's deposit account by share. A retirement account keeps what its holdings pay unless they reinvest. In play, `route_distributions` changes a holding's route.

Twenty units of the fund, its payouts reinvested, and two of the calls, in the POV's brokerage account:

```json
[
  { "op": "add", "path": "/entities/hold_pov_glix", "value": { "id": "hold_pov_glix", "kind": "holding", "name": "Great Lakes Index Fund", "tier": "background", "fields": { "account": "acct_pov_brokerage", "asset": "glix", "lots": [{ "qty": 20, "cost": 196000, "at": "2025-03-02" }], "route": "reinvest" }, "relations": [] } },
  { "op": "add", "path": "/entities/hold_pov_lkfr_calls", "value": { "id": "hold_pov_lkfr_calls", "kind": "holding", "name": "LKFR December calls", "tier": "background", "fields": { "account": "acct_pov_brokerage", "asset": "lkfr_c4500_dec26", "lots": [{ "qty": 2, "cost": 37000, "at": "2026-08-20" }] }, "relations": [] } }
]
```

### Property

A **property** is an entity of kind `property`, real estate tied to a `place`, with `owners` (and their `share`s):

- **Its value** is `value` now. It moves on the 1st of each month at its `appreciation_pct` a year with its `volatility_pct` swings (else the finance table's home prices); `purchase_price` and `purchased` are what it cost and when, for the gain on a sale.
- **Its costs** are flows its owners pay by share: property tax at `tax_pct` of its value a year (else the regions table's rate for its `region`, else its first owner's, else the economy's), in `tax_installments` bills (2 a year); `insurance` a month (else the table's typical, scaled to its value); and upkeep, `upkeep_pct` of its value a year (1 when left out), each month.
- **A mortgage** is an account of the `mortgage` product, with its own `apr_pct`, `payment`, `months_left` and the rest as any loan has, whose `secured_by` names the property; the property's `mortgage` names it back, and lint warns when the two don't. Equity is the value less what it secures.
- **A lease** is a `rent` flow from the tenant to an owner (or into an account of theirs), `link`ed to the property, with `start` and `end` for its term. Each lease covers one of its `units` (1 when left out). With `managed: true`, each unit no lease covers is let to outside tenants at `market_rent`, lease after lease of `lease_months` (12) with about `vacancy_months` (1) empty between, from `let_from` (else the world's start), their rent into `rent_to` (else the owners' deposit accounts by share).
- In play, `property_buy` buys one with an `asking_price` or nobody's, `property_sell` sells a share, and `lease_start` and `lease_end` let a unit and end a lease.

The marina's grounds, owned by the marina business, with a mortgage it pays from its operating account and its bait shop let to an outside tenant:

```json
[
  { "op": "add", "path": "/entities/prop_alder_harbor_marina", "value": { "id": "prop_alder_harbor_marina", "kind": "property", "name": "Alder Harbor Marina grounds", "tier": "background", "fields": { "place": "alder_harbor_marina", "owners": [{ "party": "alder_harbor_marina_co", "role": "owner" }], "value": 65000000, "appreciation_pct": 2.5, "purchase_price": 41000000, "purchased": "2001-03-15", "mortgage": "acct_marina_mortgage", "insurance": 42000, "upkeep_pct": 1.2 }, "relations": [] } },
  { "op": "add", "path": "/entities/acct_marina_mortgage", "value": { "id": "acct_marina_mortgage", "kind": "account", "name": "Marina mortgage", "tier": "background", "fields": { "owners": [{ "party": "alder_harbor_marina_co", "role": "owner" }], "product": "mortgage", "institution": "Great Lakes Bank", "opening": -18000000, "apr_pct": 5.1, "payment": 191800, "months_left": 120, "due_day": 1, "autopay": "minimum", "autopay_from": "acct_dale_marina", "secured_by": "prop_alder_harbor_marina" }, "relations": [] } },
  { "op": "add", "path": "/entities/lease_marina_bait_shop", "value": { "id": "lease_marina_bait_shop", "kind": "flow", "name": "Rent, bait shop", "tier": "background", "fields": { "flow_kind": "rent", "from": "Gull Point Bait & Tackle", "to": "alder_harbor_marina_co", "amount_cents": 65000, "every": "month", "days": [1], "start": "2026-05-01", "end": "2027-04-30", "shortfall": "skip", "link": "prop_alder_harbor_marina" }, "relations": [] } }
]
```

### Business stakes and net worth

**A stake** is an owner's share of a business: of its `value` when one is set, else of its book value (its own net worth from its accounts, holdings, property and stakes, plus what its customers owe it less what it owes) plus its last twelve months' profit times its `valuation_multiple` (3 when left out). Each owner's share of a profit distribution lands where they route it in play (`route_distributions`; `reinvest` keeps it in the business, adding to the stake), and `stake_sell` sells part of a stake.

**Net worth** is a party's share of the accounts it holds with a role that counts worth, plus its share of every holding at market, of every property's value and of every stake. A mortgage is one of its accounts, so a property's debt counts once. A party with accounts has the wealth band of its net worth; one without keeps its `wealth` field.

The marina, with a waiting list for its slips, is worth four years' profit over its books:

```json
[{ "op": "add", "path": "/entities/alder_harbor_marina_co/fields/valuation_multiple", "value": 4 }]
```

## Places, routes and maps

- Places form a tree through `parent` (a town holds streets, a building its rooms). A place the player hasn't heard of yet is `"visibility": "discoverable"`.
- Routes join places with minutes per travel mode (`walk`, `road`, `offroad`, `water`), both ways unless `bidirectional` is false.
- **A map owns what it draws.** A map (`/maps/<id>`, format `lre-map-v1`) draws one place's inside, as a grid of characters or as linked places, and compiles into places, a grid and routes that carry `"map": "<map id>"`. Those are the map's: **edit the map, never them**. A write to a place, grid or route a map draws is refused ("drawn by the map …; edit it there"), and so is setting `map` on anything else. After a change to the map, the engine draws its places, grid and routes again; delete the map and they go with it. A place, grid or route you write yourself with the same id as one a map would make wins over the map's.

## Tracks: quests and secrets

A track is a small state machine: `start` names its first stage, and each stage's `next` lists `{"to": stage, "when": formula}`, taken in order when the formula holds. A stage may carry a `cue` (what the player can know now), `objectives`, `effects` on entering, `rewards` on leaving it onward, `hints`, a `gate` and a `fail`. A stage with no `next` ends the track, and an end stage, which is never left, grants its `rewards` as the track reaches it: put a quest's payout there. Secrets advance only by their formulas, never by a model.

- **Quests** start at the stage the story has reached, not at the beginning: `start` is today's stage.
- **Secrets** keep a `truth` (what is really so, kept from the player) on the stage that reveals it, and a `cue` (what the player can notice) on the stages before. A cue never states the truth.
- **Puzzles** an action of yours answers take `story.answer`'s `track`: the puzzle's own id, written out, never a formula.
- **Hints** on a puzzle stage with an `answer` open up one per wrong answer given at that stage; on any other stage they are all there once the track reaches it. The player opens them one at a time, and the narrator is told only the opened ones.
- **Every flag a track or a secret's gate reads needs a setter**: a `story.flag` effect in an action's outcomes, a rule or a stage's effects. One nothing sets keeps its starting value for good, and lint warns (`story.unset_flag`).
- **A story step's action stays out of sight until the story reaches it.** An action whose requirement reads `stage(…)`, `since(…)` or `flag(…)` and none of its params isn't listed anywhere (the Actions sheet, interpret's catalog) while that requirement fails, so gate the steps of a quest or a secret that way (`"stage('s_debt') == 'ledger'"`, `"not flag('ledger_read')"`), and the player is never shown what lies ahead. Requirements on where they are or what they carry still show the action, locked.

### A revealed secret starts one stage earlier

The engine records a reveal only when a track **enters** a stage with a `truth`. A track that starts on its truth stage never enters it, so the truth is never revealed: the Journal never shows it and the narrator is kept from saying it. **Never start a secret track on a stage that has a `truth`.** For a secret the player has already learned, start one stage earlier on a stage that moves on at once, so the first turn reveals it:

```json
{ "id": "corin_debt", "kind": "secret", "label": "What Corin owes", "visibility": "secret", "owner": "corin", "start": "rumor", "stages": {
  "rumor": { "label": "Something is off", "next": [{ "to": "known", "when": "true" }] },
  "known": { "label": "Corin owes the guild", "truth": "Corin borrowed the guild's harbor dues to pay a gambling debt.", "next": [] } } }
```

### Cues never name the secret

A person's `cues` are what the narrator sees them do while a secret of theirs stays hidden: `{"text": "Changes the subject whenever the guild comes up.", "track": "corin_debt"}`.

- Each cue stands for exactly one secret: a `track` (while it keeps something hidden), a secret `lore` entry (until its gate holds) or a story `flag` (until it is set). A cue keyed to none, or to several, never shows.
- Write behaviour, never the secret: a cue that holds a track's truth or a phrase of secret lore is a lint error, because it gives the secret away.
- Name no one the player may not know: such a cue is left out while they don't (lint warns).
- Only people have cues that show; the stage cues of the tracks a person owns reach the narrator the same way, in Stance only, never as a quest row, while the track keeps something hidden.

## Lore

Lore entries (`/lore/<id>`) are what the world knows, read by the engine's own helpers: `{id, title, content, keys, links, aliases?, topics?}`, where `links` are the ids of the people and places an entry is about.

- `"visibility": "known_by"` keeps an entry back until the player knows every person and place it links.
- **A secret entry** holds a secret itself: `"secret": true`, a `gate` formula that reveals it (lint refuses a secret without one), and an `audience` of the helpers that may read it before then (`npc.choose`, `puzzle.answer`, `judge`, `interpret`). The helpers that write for the narrator or the player (`brief`, `outline`, `choices`, `extract`) never read it early, even when listed. A mind reads a secret entry only when its `holders` name the character or a cue of theirs stands for it; `links` and an opened gate never do.
- A public entry must never repeat a track's truth: lint refuses it (`secret_truth`).
- `loreIndex` routes the helpers' lookups: `terms` maps a lowercase term to entry ids, `topics` gathers entries under a label.

## Data tables

Prices, pay, taxes, occupations, regions, gear and the calendar's holiday rules come from data tables (`/tables/<id>`): typed `columns` and `rows` keyed by row id, read by the packs and by `table(id, key, column)` in formulas.

- Every new world, blank or a starter, carries the seventeen default tables; edit them in place. A new table comes whole, with `id`, `pack`, `schema`, `label`, `columns` and `rows`: adapt one (`lre_template` at `/world/tables/<id>`).
- Cells follow their column: a `band` is `{"min", "typical", "max"}`, money columns are in the currency's minor units, and a `ref` names a row of another table.
- A table's `revision` and its pin in `pins.tables` are the engine's: every write that changes a table computes both again (`hashJson` of its schema, columns and rows). Don't write either, and don't patch `/pins`.
- Each revision of the world keeps its own copy of its tables, so a running chat sees a table change only through an Upgrade.

## Host macros

Lumiverse runs macros (`{{…}}`) in its prompt and acts on its control characters and `<user>`, `<char>` and `<bot>`. LumiRPEngine keeps authored text as written, so in lore and in section and step templates these are hazards:

- A section template may use only `{{lines}}`, where its lines go; anything else in one is a lint error (`section_macro`). A world words a built-in section it doesn't list in `/sectionTemplates` (`{"<slot>": "<text with {{lines}}>"}`), only where it differs from the built-in text; a write whose wording lacks `{{lines}}` is refused.
- Step templates use the engine's own placeholders (`{{world}}`, `{{pov}}`, `{{place}}`…); lint warns about one it doesn't know.
- Keep `{{user}}` and `{{char}}` out of lore unless the user put them there on purpose. `lre_edit` and `lre_commit` list every hazard a change brings in; say which ones you added.

## Setup, lore and jobs

Beyond a world's document, the tools reach what the user sets up once and what Build runs for them. Settings and the preset are the user's own, for every chat: change them only when asked, and say what you changed.

### Settings and presets

`lre_settings` reads the settings as Settings shows them; a `section` narrows it to one page's part: `helper` (Helper model), `modelUse` (Model use, and Steps and connections under `steps`), `minds`, `timeouts`, `realism` (Realism, and Player claims under `claims`), `adjudication` (Checks), `time`, `extraction` (Changes from the reply), `swipeDefault` and `swipeTexts` (Swipes: what a swipe does, and whether a Re-narrate or a Re-run is sent the texts its turn was made with, `"turn"`, or the current ones, `"current"`), `prompts` (Agents → Prompts: `texts`, the user's own text for each editable text by its id, null to bring back the shipped one, and `maxChars`), `hideJsonBlocks` (Preset), `narrator` (Narrator), `retention` (Agents → Retention: how long agent call texts and unreferenced stored files are kept, and how often they are swept), `diagnostics` (Diagnostics: records kept per chat), and the two switches that make new chats use these over a world's own (`overrideWorldDefaults`, `overrideWorldAdjudication`). `extractionModes` is read-only: each change type's mode now and where it comes from (pinned, learned on the connection, or the default).

`lre_settings_set` takes a JSON merge patch, as the pages send: objects merge, a list or a value replaces, `null` deletes (unpin a change type with `{"extraction": {"purchase": null}}`). The GM assistant's change types (`gm_spawn`, `despawn`, `destroy`, `money_adjust`, `stage`, `gm_edit` and `workspace`, Settings' "The GM assistant's changes") are listed in `extractionModes` beside the reply's and pinned the same way (`{"extraction": {"despawn": {"mode": "confirm"}}}`), with no max delta.

- A named preset expands: `{"realism": {"preset": "grounded"}}` sets every level and band cap, `{"modelUse": {"preset": "standard"}}` every step, budget and the minds' policy. A change to what a named preset sets makes it `custom`, as Settings does; the answer's `presets` says so.
- LumiRPEngine keeps every value within what it takes. `adjusted` lists what came out other than sent (a value out of range, a key it doesn't know, a preset's own values): read it, don't assume the patch landed as written.
- A step's route names a Lumiverse connection by id (`route.connectionId`, null for the helper model's); its template (`template`) is the user's own prompt for the step, which wins over the world's step template for the purpose (the time-skip step's is the skip plan's; a mind's, a memory's and consolidation's are `minds.prompts`). A world's own step templates are its document's `/steps`, written with `lre_edit`.
- `narrator` is the narrator's knowledge in every chat that sets none and whose world sets none: `knowledge` (`scene`, what everyone in the scene knows, each fact beyond the player character's marked, the default; or `pov`, the player character's only) and `secrets` (`marked`, the default: a line carrying a secret's words goes in marked as a secret; or `omit`: it is left out). It applies from each chat's next turn. How a secret is marked is in `prompts`: the texts `narrator.mark.known`, `narrator.mark.kept` and `narrator.mark.both` (each keeping `{{text}}` and the names it needs, `{{known}}`, `{{kept}}` or both), `narrator.mark.everyone` (the word for everyone) and the narrator rules' sentence on a mark, `narrator.secret_marks` (it keeps `{{forms}}`, every form the others make, and may use `{{everyone}}`); `{"prompts": {"texts": {"narrator.mark.known": null}}}` returns one to the shipped text.
- `agents.assistant` is the user's GM assistant (GM → Assistant in Lumiverse): `connectionId` and `model` (null: their default connection and its model), `effort`, `knowledge` (whose knowledge its tools read with: `"pov"`, `"everyone"` with secrets marked, the default, or `"gm"`), `apply` (`"ask"`, the default: each change it proposes waits for the user's Apply; `"at_once"`: applied as soon as it answers, with an Undo chip), `historyTokens` (20,000: how much of its conversation goes with each message) and `budget` (limits of its own over `agents.budget`; null on one gives it back). Its conversation, proposals and GM → Workspace are the user's own pages, which no tool of yours reaches: you read and edit the chat yourself.
- Realism, checks and time seed new chats only. A running chat changes through its own markers (GM → This chat).
- The answer carries the caveats as they read now; `lre_settings_caveats` reads them alone. They dry-run the chat the user plays, which takes a while on a long chat: "still checking" means ask again in a moment.

`lre_preset` reads the active Lumiverse preset as the engine does: the section outlets its enabled blocks hold (`{{outlet::lre_<section>}}`) and each guidance block ("RPEngine · <step>"): missing, empty (notes only), read (switched off but written: its text goes to that helper) or enabled (switched on, so it also lands in the main prompt; it should be off). `lre_preset_add_blocks` adds the missing ones, switched off, under an RPEngine category, and touches none already there. The engine learns which preset is active from the user's open page or the chat they last played: with neither, it can't tell, and says so.

### Diagnostics

`lre_diag {chatId}` reads a chat's activity line (what the engine is doing now, or the step that failed last) and counts its records. The records themselves (each turn's steps, model calls with connection, model, tokens and finish reason, failures with what to do, the sections each run wrote, slow requests, and agents' calls with role, connection, model, tokens in and out with cached and reasoning parts, outcome and the tools they called) come only with `spoilers: true`: a step's reason can name someone the player hasn't met. Keep them out of anything the player reads. An agent call's text stays behind Diagnostics' curtain in Lumiverse; its record names it only by hash. `failures: true` keeps the failed steps, warnings and errors; `last` the newest n. A failing step's `fix` says what the user can do, often a timeout or a step's model in Settings. `lre_diag_clear` forgets the records; `lre_activity_dismiss` clears a failure from the activity line.

### Lore books, pins and drift

A world's lore is its document's (`/lore`, and pins at `/lorePins`), written with `lre_edit`. A pin makes a character's mind calls, or every call at a place, always read an entry: `{"lore": "<id>"}` for the world's own, `{"book": "<bookId>", "entry": "<entryId>"}` for an entry of one of the user's World Info books, either with `"keep": "end"` to keep an entry's end when it must be cut. `lre_lore_books` lists the books a pin may name (with `chatId`, that chat's own first), `lre_lore_entries {bookId}` a book's entries, with the secret marks in each. The helpers also read World Info as lore, live: the chat's books, the user's global ones and the world's `/loreBooks` (a character's or persona's book only when listed there). What in a World Info entry is secret is written in its own text, as a secret mark: `{{// Secret: TEXT}}`, `{{// Secret (known to Marcus Delgado): TEXT}}`, `{{// Secret (kept from Jordan Ellis): TEXT}}` or `{{// Secret (known to Marcus Delgado; kept from Jordan Ellis): TEXT}}`, each name a person's name or id, and "you" or "the player character" the player character. Lumiverse strips a mark from every prompt by itself; in a world chat LumiRPEngine gives the narrator its text marked as a secret, or leaves it out, as the narrator's knowledge says, and its holders' minds read it, no helper. No tool writes an entry's text: a mark is the user's to write, with Build's **Make this entry secret** or **Add a secret line**, or in Lumiverse's own World Info editor, so when an entry should be secret, tell the user which and why. `lre_lore_fields {bookId, entryId, fields}` writes its `visibility`, `links` and `aliases` into the user's book at once, so ask the user first. An entry an earlier build kept secret by its fields (`secret`, `gate`) stays so until the user moves its book's secrecy (Build → Lore → Secrecy in your World Info).

`lre_lore_pins {worldId}` reads every pin of the draft now: its entry's title, its source, and its status (`ok`, `missing`, `pending`: an AI-written entry not reviewed yet, which nothing reads; `off`: switched off in its book, which a pin still reads). With `chatId` it reads the revision the chat plays, as GM → Minds does, and needs `spoilers: true`.

`lre_lore_drift {worldId}` lists the entries indexed from a book whose book entry changed since (with its text now) or is gone. To take the new text, write it into the entry's `content` with `lre_edit`. `lre_lore_save {chatId}` makes the chat's latest reply (or `text`, an excerpt of a message) a new lore entry in the draft of the chat's world, sourced to its message.

### Build's jobs

`lre_job_start {worldId, kind, …}` runs one of Build's jobs on the user's Lumiverse and answers its id at once:

- `import_lore {bookIds}`: entities, places and facts from World Info books;
- `index_book {bookId}`: a lore entry per book entry, keeping the book's text, with aliases, topics, links and lookup terms;
- `index_text {text}`: lore entries in the text's own words, marked as written by the AI;
- `refine {instructions}`: world edits for a request in words;
- `describe_map {scope, prose, mapId?}`: a map of a place from its description;
- `propose_routines {owners?, after?}`: routines and schedules for people and groups from the lore and their sheets. Each block or schedule cites the entry or field it rests on, with a quote, and is checked against the draft. It reads people and groups in id order within twelve calls; when `lre_jobs` shows `next`, start the job again with those inputs for the rest;
- `playtest {turns}` and `check_world {days?}`: the engine alone on the draft, as `lre_playtest` and `lre_check_world`, but on the host.

Model jobs spend the user's helper model calls: start one when the user asked for it. `lre_jobs {worldId}` shows each job's status and progress and what it found in counts (with how many proposals have problems); `lre_job {worldId, jobId, pointer}` reads it whole. `/result/proposals/0` is one proposal: collection, key, the value it writes, source, confidence and note, and for routines and schedules the `owner` it is for and the `problems` the draft check found (a clash with their schedules or routine, a place or person that isn't there, company with no ground). A job proposes; nothing changes until `lre_job_apply {worldId, jobId, proposals?, expectVersion}` writes the ones you accept into the draft in one write, as Build's review does (an AI-written entry then counts as reviewed, and accepted lore joins the lookup table). Without `proposals` it applies every proposal but those with problems. Read each proposal before you apply it, then check the draft with `lre_draft`. A proposal's key replaces an item there by that key, and a schedule's `_activity` and `_place` proposals go together. `lre_job_cancel` stops a job; `lre_job_dismiss` forgets one that ended, with its proposals.

### Profiles, the sheet and lint

- `lre_profile {worldId, profile, preview: true}` says what a ruleset profile (`modern`, `classic`, `fifth`, `custom`) would add, what is the same already, and where it conflicts with the draft; without `preview` it applies in one write. Each conflict keeps the draft's own unless `take` names its path; `values` are people's stored values a taken field can't hold, and what they become.
- `lre_sheet {worldId}` previews the character sheet a new chat would start with, from the draft's ruleset or one you pass as `ruleset`, on the point of view or `entity`. Nothing is saved.
- `lre_lint {worldId}` lints the head on the host; `lre_draft` lints the draft.

### A chat's map

`lre_map_walk {chatId, x, y}` says what Walk here would take to a cell of the grid the point of view stands on, judged on the real ground; nothing moves. `lre_map_display {chatId, display}` shows the map as what the point of view knows (`knowledge`) or under fog (`fog`): presentation only, kept beside the chat.

### A chat's knowledge

`lre_chat_knowledge {chatId}` reads a chat's own knowledge choices (GM → This chat → Knowledge): `knowledge`, whether the engine tracks what each character knows in it, and `narrator`, the narrator's knowledge (`{"knowledge": "scene" or "pov", "secrets": "marked" or "omit"}`), each null where the chat follows: the narrator's knowledge follows the world's `narrator`, else Settings → Narrator; tracking follows Settings. Pass either to set it, or null to return it to following. They are kept in the chat's metadata, never its story: no recorded turn changes, a Branch keeps them, and they apply from the next turn.

## Playing a chat

The chat tools reach a chat that plays a world as the user's Play does; `lre_chats` gives the chat ids. They see what the player sees, unless you pass `spoilers: true`, and change the chat the way Play's own controls do. The chat is the user's game: change it when they ask, and say what you changed.

A session goes like this:
1. `lre_chats` for the chat's id, then `lre_chat_state` with pointer `""` for an outline of what Play shows, and the parts you need from there.
2. Before a turn, read what it can be: `/palette/entries/<i>` for an action's options and their `params`, `/palette/timelapse` for the skips on offer and what interrupts them.
3. Make the change or post the turn, then read the state again for what it did: the HUD, the journal, the chips.
4. Tell the user what you did, what is waiting on them (a reply to start, a chip to answer), and the Undo chip that can take a correction back.

**Reading.** `lre_chat_state` reads the chat's state view at a JSON Pointer, the view the chat's page is sent: `/hud` (the clock, place, weather, cash and, at `/hud/fixes`, the ✎ fixes it offers), `/scene` (who is present), `/chips`, `/journal`, `/keepReport`, `/palette` (the actions at `/palette/entries`, the timelapse at `/palette/timelapse`), `/controls` (the realism, time controls, player-claims policy and checks policy the chat plays by), `/panels` (each pack's panel: Money, Gear, Calendar, the map…) and `activity`, what the engine is doing for the chat now (null when idle). It holds only what the player can know. `lre_chips` lists the chips under the messages with their actions; `lre_inspector` reads the context inspector: what the engine put in each of the last ten prompts, what its steps read of the lore, and its warnings.

**Behind the curtain.** `lre_gm` (the GM view: every entity, secrets, hidden places, track truths, everyone's money, the edits in force) and `lre_minds` (each character's fidelity, latest mind, plans, notes and commitments) need `spoilers: true`, and so do the tools that edit them and Run minds now. Pass it only when the user asked to look behind the curtain, and keep what it shows out of anything the player reads: the chat, a message you post, a fix.

**Changing the chat.** A write lands on the chat's latest message, as Play's do. During a reply it is held (`pending: true`) and lands when the reply finishes. While the engine works on a turn before its reply, a write lands at once and the turn's reply doesn't start (the player's Retry runs the engine again), unless the user's `holdWrites` (Settings → Writes) is on: then it is held (`pending: true`) until the turn's reply finishes, or the turn stops without one. A chat whose status is `paused` (the player edited an earlier message of theirs) refuses every write until `lre_keep` settles it, naming the edited message: `keep` re-checks the later turns against the edit and lists what no longer holds in `/keepReport`; `discard` removes the later turns' records for good (their messages stay as plain text, and the world forgets them), so ask the user first; `convert` brings chosen dropped lines of the keep report back.
- `lre_fix` is the player's ✎: `fix` names a HUD fix (`place`, `weather`, `cash`, `scene`; each at `/hud/fixes` with its type and options), or give `entity` and `field`, with the `value` in the field's type; `time` (`"2026-09-14 18:30"`) sets the clock, running the time between when it is later. A locked field is refused.
- `lre_gm_edit` is the GM editor: operations in order, all or none, on any entity, locked fields included. They are the engine's own edits, not JSON Patch: each names its `op` and what it touches (the tool lists them all), with ids from `lre_gm`:

```json
[{ "op": "move", "entity": "pov", "to": "bluebird_coffee" },
 { "op": "adjust", "account": "acct_pov_checking", "cents": 5000 },
 { "op": "stage", "track": "q_pontoon_weekend", "to": "diagnose" }]
```

- A `stage` op moves a track as the story would: on to a stage that follows, it plays that stage's entry (rewards, effects, its reveal); back, it only sets the stage. It is made from where the track stands now, so if the reply it waits for, or a swipe or re-read of that reply, moves the track first, it is dropped whole, rewards included, never paid twice, and the chat says it didn't apply.
- `lre_marker` changes how the chat plays from its latest message on: `resolve` (a domain's realism level, for everyone, a band or one entity), `time` (a control: `tick`, `scale`, `pause`, `interrupt`, `speed_through`, `montage`, `unit_cap`), `claims` (what a typed action's thing the world doesn't have becomes), `adjudicate` (the whole checks policy: read `/controls/adjudication`, change what you need, send it back) and `infer` (when typed attempts roll skill checks, the same way from `/controls/inferred`). `preview: true` says what it would change and writes nothing; read it first, since a lower level freezes what the higher one tracked.
- `lre_view_open` opens a panel as the player does, which settles detail the chat hadn't decided yet (a balance first looked at); opening `core.context` checks the active preset.
- `lre_chip` answers a chip with one of its action ids (an amount or a pick in `payload` when the action asks for one).
- Each ✎ fix and GM edit leaves an Undo chip; tell the user it is there.

**Playing a turn.** `lre_action` plays a palette entry (its `action`, and the picked option's `params`) and `lre_timelapse` a skip (`target` as `/palette/timelapse/until` lists them, or `{"type": "duration", "minutes": 120}`); `text` is the player's words for how they do it. Each posts the player's message, and the engine prepares the turn at once. **The reply is Lumiverse's to start, not yours:** a page that shows the chat starts it on its own; with none, it waits until the user opens the chat in Lumiverse. So ask the user to open the chat, then read `activity` and the state for what the turn did. The same goes for a chip's Send (a suggested move) and for the actions `lre_chips` marks `regenerates` (Re-narrate, Re-run, Retry read, a claim's Add): those take effect on the reply's next swipe, which the user makes with Regenerate or a swipe, and a plain Regenerate is only that.

**Minds.** `lre_minds` reads them; `lre_mind_edit` pins a character's fidelity (`mind_pin`, `level` null to unpin), asks for a fresh mind next turn (`mind_refresh`), edits, adds (`id` null) or deletes (`value` null) a note, commitment or plan (`mind_memory`), or sets what they mean to do now, in words their own mind reads first and works from, and how they go about it (`mind_intent {entity, text?, approach?}`: `approach` `"reactive"`, `"proactive"` or null for their mind to decide; a part left out is kept, and `""` with null clears it); `lre_minds_run` runs Run minds now for `who` (default everyone Live and Near), in the background, with model calls on the user's connection, so ask before you run it; `lre_minds_cancel` stops it, and a cancelled run records nothing. A run, like a GM edit, is one edit with an Undo chip.

**What they know.** `lre_minds` shows the chat's facts at `/knowledge/facts` (each with its holders), the player character's holdings at `/knowledge/pov`, and each character's at `/characters/<n>/holdings`. `lre_mind_edit`'s `mind_knowledge {entity, fact, holding}` sets one person's holding of a fact the chat holds, whole (`{how, by, evidence, since: {msg, at}, belief, confidence, keptFrom?}`; a told one names its teller in `by`), or takes it away with `holding` null. A holding already so, or one taken away that isn't held, changes nothing.

**What they can't do.** A chat tool never starts a generation, regenerates or swipes, and never writes a message but the player's turn: those are the user's, in Lumiverse. An Upgrade is `lre_upgrade`.

## Before you commit

- `lre_draft` shows no lint errors, and you know what each warning means.
- The POV exists and stands at the start place; the start time is the story's present.
- Every id an item names (a place, an owner, a relation target, a track in a formula, a lore link) exists.
- Everyone who has met the POV holds a `knows` or a `regard` toward them.
- A death or dying the player hasn't learned of sets `lifeKnownBy`; the dead lie at a `fields.place`.
- Everything someone owns names them in `fields.owner`; every account, business, holding and property names its holders in `fields.owners`.
- Every flow pays from and to something that exists, with an amount and a schedule (or `once`); every job names its worker and an existing or worded employer.
- A business is on a tier whose Money level runs what it does (4 for sales tax and business taxes), and its `operating_account` is one of its own accounts.
- Every holding names an asset the world lists, and every mortgage and its property name each other.
- With `"secrecy": "full"`, no character would think a secret openly.
- No secret track starts on a stage with a `truth`, no cue states its secret, and no public text gives one away.
- Nothing a map draws was edited outside its map; no `revision` or pin was written by hand.
- `lre_playtest` and `lre_check_world` run without failures or leaks in their notes.
- Commit with a note that says what changed, and tell the user what you changed and what you left for them.
