# LumiRPEngine expressions

A world's rules are data, and the parts that compute something are formulas: an action's requirements and duration, a check's modifier and DC, a derived field, a rule's condition, a quest stage's way forward, a sheet row. They are all written in one small language, adapted from Warp's (credited in `NOTICE`). It is safe and deterministic: a formula can't loop, can't call out, can't see anything the engine doesn't hand it, and on the same world state it always gives the same value. That is what lets the palette show exact odds before you choose, and lets every replay of a turn's recorded events reach the same state. A Re-run is a new attempt, not a replay: it rolls with a fresh seed, so its dice can land differently, unless the world sets `seedMode` to `same_roll`.

This page is the language and the engine's own functions. The functions each pack adds are listed with their parameters in the [reference](REFERENCE.md), under each pack's **Formula functions**, and Build's expression editor offers every function a formula may call.

## Where formulas go

What a formula can read depends on where it sits: `self` is whoever it is about, and some places add names of their own.

| Where | `self` | Also |
|---|---|---|
| An action's `requires`, `duration` and `activity.until`; its check's `modifier`, `advantage` and `dc` | The one acting (the POV in play) | `actor`; each ref parameter by its name (`target`, `item`); scalar parameters by name and as `params.<name>` |
| An action's outcome effects (`=` arguments) | The one acting | As above, and the roll as `roll.*` |
| The `check` effect's outcome effects | The one rolling | `actor`, `target` and `roll.*` |
| A check's opponent (`vs.modifier`, `vs.passive`) | The opponent | The action's names |
| A derived field; a pool's `max` and `recover` | The entity that has the field | |
| A rule's `when` and its effects | Whoever the event is about, for an `event`, `enter`, `zone` or `cell` trigger (an `enter` trigger fires for anyone who arrives: test `self == pov` when it matters); else the POV | `event.*` for those triggers |
| A rule's `at` trigger | The POV | |
| A track stage's `next`, `fail` and `gate` | The track's owner (else the POV), also as `owner` | `track.*` |
| A track stage's objectives | The track's owner (else the POV) | Nothing more: write them with `self`, since `owner` and `track.*` aren't there |
| A progression's `onLevel` effects | The entity that levelled up | `level` (the level reached) and `from` (the level before) |
| A designed sheet's formula row | The entity whose sheet it is | |

## Syntax

| | Examples |
|---|---|
| Numbers | `12`, `3.5`, `.5` (no exponent form; write a negative number with unary minus, `-2`) |
| Text | `'text'` or `"text"`; a backslash makes the next character literal: `'it\'s'` |
| Literals | `true`, `false`, `null` |
| Names | `hour`, `self.might`, `here.security`: a dotted path is one name |
| Calls | `min(a, b, c)`, `has_tag(self, 'night_owl')`, `holiday()` |
| Unary | `-x`, `+x`, `not x` (or `!x`) |
| Binary | `*` `/` `%`, `+` `-`, `<` `<=` `>` `>=`, `==` `!=`, `and` (or `&&`), `or` (or `\|\|`) |
| Choice | `cond ? a : b` |
| Grouping | `( … )` |

Whitespace doesn't matter, and there are no comments. Precedence, tightest first: unary, then `* / %`, then `+ -`, then comparisons, then `== !=`, then `and`, then `or`, then `?:`. Binary operators group from the left; `?:` is the loosest and groups from the right, so `a ? b : c ? d : e` is `a ? b : (c ? d : e)` and `1 + 1 ? 'a' : 'b'` tests `1 + 1`. Unary operators bind tightest of all: `not 0 == 2` is `(not 0) == 2`, which is false.

## Values

A value is a number, text, true or false, or null.

- **Truth:** `false`, `null`, `0` and `''` are false; everything else is true.
- **Numbers from other values** (arithmetic, comparisons, math functions): true is 1, false and null are 0, text that is a number is that number, other text is 0. `'3' * 4` is 12.
- **`+`** joins text when either side is text (null joins as nothing), and adds otherwise: `'3' + 4` is `'34'`.
- **`==` and `!=`** compare as text when either side is text, else as numbers, so `null == 0` is true. `<`, `<=`, `>` and `>=` always compare numbers.
- **Dividing by zero** (`/` or `%`) gives 0. Every result is a finite number: an overflow or a missing argument to a math function gives 0.
- **`and` and `or`** stop as soon as they know, and give back the operand that decided: `0 or 'x'` is `'x'`. `?:` works out only the branch it picks.
- **An unknown name or function** reads as 0, so a misspelt name never stops a turn, but it never reads anything else either. Build's expression editor suggests the names and functions it knows as you type.

## Names

A name is looked up in this order; the first that knows it answers.

1. **What the place adds:** action parameters, `params.*`, `roll.*`, `event.*`, `track.*`, `level` and `from` (the table above).
2. **Bindings:** `self`, `actor`, `target`, `owner` and ref parameters. The bare name is the entity's id. `self.cash` is its field, with derived fields computed and defaults applied (an unset pool reads full); `self.name`, `self.kind`, `self.tier`, `self.id`, `self.agent` and `self.place` read the entity itself.
3. **`pov`:** the POV, read like a binding (`pov.cash`).
4. **`here`:** the place `self` is at (through whatever holds it); `here.security` reads a field of that place.
5. **`stage.<track>`:** a track's current stage (its start before it moves). **`level.<domain>`:** `self`'s effective level in a realism domain (`level.money`).
6. **The clock:** `clock` (game minutes since the calendar's epoch), `minute` (of the day), `hour`, `day` (days since the epoch's date), `weekday` (0 is Sunday), `date` (the day of the month), `month`, `year` and `daypart` (the id of the current part of the day).
7. **Any entity or place by its id:** `npc_dev.mood`, `harbor.security`.

**Parameters.** A scalar parameter reads by its bare name (`qty`) and as `params.qty`. One the player left out reads 0 by its bare name and null as `params.qty`. Since `==` compares null as 0, `params.days == null` holds for zero days too; to tell "none" from zero, compare it as text: `params.days + '' == ''` holds only when it was left out. A ref parameter is a binding, so `target.cash` reads the target's cash.

**The roll.** An action's outcome effects, and the outcomes of the `check` effect, see the check as `roll.natural` (the natural die, when the dice have one), `roll.total`, `roll.modifier`, `roll.dc`, `roll.margin` (the total minus the DC) and `roll.outcome`. When the adjudication policy settles a check without rolling it, `roll.outcome` is set and the total, natural die and margin are null.

**Events and tracks.** A rule fired by an event sees `event.type` and the event's own values, with an event's `data` one level down (`event.data.rule`). A track stage sees `track.id`, `track.stage`, `track.since` (minutes since the stage began), `track.attempts` (wrong answers to a puzzle so far), `track.objectives`, `track.done` (objectives met) and `track.complete`.

## Effect arguments

An effect's arguments are values, not formulas, unless you ask:

- text starting with `=` is a formula: `"delta": "=-roll('1d6')"`;
- text that is a binding's name is that entity's id: `"entity": "self"`, `"to": "target"`;
- anything else is taken as written, and objects and lists are read the same way, element by element.

So `{"type": "set", "args": {"entity": "self", "field": "mood", "value": "calm"}}` sets the text `calm`, and `"value": "=self.might + 1"` sets a number. A ✎ fix or a GM edit stores what was typed: `=1+1` stays text there.

## Determinism

- **No chance outside effects.** `roll(notation)` is the language's only source of chance, and it works only in an effect's arguments. There it draws from the effect's own seeded generator and the event stores the result, so a replay reads the stored value and never rolls again. Anywhere else (a requirement, a modifier, a DC, a derived field, a rule's condition, a sheet row) `roll()` is a lint error and reads as null, so the odds the palette shows and every read stay fixed.
- **No wall clock.** Time is the game clock, which only turns, timelapses and the engine move.
- **Pinned tables.** `table()` and `table_step()` read the world's own copies of its data tables, pinned per revision, so they are deterministic and allowed anywhere.
- **Hard limits.** A formula is at most 4,096 characters, 64 levels deep and 2,048 parts, and one evaluation takes at most 100,000 steps. A formula over a limit is treated like one that doesn't parse. Lint names the problem, the limit included, in a check, a pool, a track's conditions, a sheet row and a combat rule. Anywhere else nothing flags it until it is read: a requirement or a rule's condition then reads as false and a number as 0, while a derived field's formula stops the read with an error. Try a world in Playtest before you play it.

## Functions

**Math**, always available: `min(a, b, …)` and `max(a, b, …)` take any number of arguments; `clamp(value, lo, hi)`, `floor(x)`, `ceil(x)`, `round(x)` and `abs(x)`.

**The engine's own:**

| Function | Gives |
|---|---|
| `field(entity, field)` | A field of an entity, as `entity.field` reads it |
| `rel(entity, type, to?)`, `has_rel(entity, type, to?)` | Whether the entity holds a relation of that type (to that target) |
| `rel_count(entity, type)` | How many relations of that type the entity holds |
| `rel_field(from, type, to, field)` | A field of one relation, or null |
| `knows(entity, subject)` | Whether the entity has a `knows` relation to the subject |
| `place(entity)` | The place the entity is at, through whatever holds it |
| `at(entity, place)` | Whether the entity is at the place or anywhere inside it |
| `count_at(place, kind?)` | How many entities are at the place or inside it (of that kind, with inheritance), counting people removed from the world |
| `level(entity, domain)` | The entity's effective level in a realism domain |
| `band(entity, field)` | The label of the band the field's value falls in, or `''` |
| `stage(track)` | The track's current stage |
| `since(track)` | Minutes since the track's stage last changed |
| `attempts(track)` | Wrong answers to a puzzle track so far |
| `revealed(track, stage?)` | Whether the track (that stage of it) has been revealed |
| `fired(rule)` | How many times the rule has fired |
| `hours(n)`, `days(n)` | `n` hours or days in minutes |
| `next_time('HH:MM')` | The clock at the next time the day reaches that time |
| `today_at('HH:MM')` | The clock at that time today |
| `holiday()` | Today's holiday, or `''` |
| `table(table, key, column)` | A cell of one of the world's data tables, or null |
| `table_step(table, value, column)` | The cell of the row whose numeric key is the largest at or below `value` (thresholds, brackets) |
| `roll(notation)` | A dice total; effect arguments only |

**Taxonomy**, one selector constraint each: `kind_is(entity, kind)` (with inheritance), `in_class(entity, facet, value)` (a value nested under it counts), `has_tag(entity, tag)`, `member_of(entity, group)` (through member groups too), `tier_of(entity)` and `band_of(entity)`. An unknown entity is false, or `''`.

**The packs' functions** (`travel_minutes`, `carries`, `wealth`, `regard`, `stat_mod`, `flag` and more) are listed with their parameters under each pack in the [reference](REFERENCE.md).

## Examples

| Formula | What it does |
|---|---|
| `place(item) == here and not carries(self, item)` | A Take requirement: the thing is here and you don't already carry it |
| `level.space < 2 ? 15 : travel_minutes(here, to, 'walk')` | A travel duration: a flat quarter hour at low Space, else the route's walking time |
| `floor((self.might - 10) / 2)` | A derived stat modifier: 14 Might is +2 |
| `10 + self.might_mod * 2` | A derived maximum for a hit-point pool (`pool: {max: "hp_max"}`) |
| `hour >= 22 or hour < 6` | A rule condition: at night |
| `knows(target, self) and regard(target, self, 'trust') >= 20` | A requirement on whom you ask |
| `stage.q_raise == 'done'` | A gate or condition on another quest |
| `track.complete` | A stage's way forward once every objective is met |
| `has_tag(self, 'night_owl') ? 0 : 1` | A check's advantage: −1, 0 or 1 |
| `self.name + ' feels ' + self.mood` | A sheet row's text: `You feels calm` (the POV's name is "You" in a new world) |
| `table_step('xp_levels', self.xp, 'level')` | A level read from a threshold table |
| `=-roll('1d6')` | An effect argument: lose 1 to 6, rolled once and stored |
| `=roll.margin >= 5 ? 50 : 25` | An outcome's award: more XP for a wide margin |
