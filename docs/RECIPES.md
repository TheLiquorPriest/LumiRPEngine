# LumiRPEngine recipes

Small worlds that each show one thing working end to end. Every recipe here is a fragment of a world document: the parts it adds to a new world (Build's **Blank** template, or `lre_world_create` with no template). Merge it object by object: a collection gains the items shown, an item gains the fields shown, and a list replaces the one already there. In Build, enter each item in its editor; an agent merges the JSON with `lre_edit`. A new world carries every default data table, pinned as a template's are, so a recipe that needs a table of its own carries the whole table, rows and all, and it replaces the world's copy rather than merging into it; in Build, edit that copy in the **Data tables** editor. `test/docs/recipes.test.ts` builds every fragment on this page and plays it through the engine, so what each recipe says happens does happen.

The formulas are explained in [EXPRESSIONS.md](EXPRESSIONS.md), and every effect, function and pack kind used here is listed in the [reference](REFERENCE.md). Fights are set up in the user guide's [Combat and encounters](USER-GUIDE.md#combat-and-encounters).

## XP and levels

A progression keeps experience in one field and the level in another, and the level follows the XP both ways. After any effect changes an entity's XP (an award, a quest reward, a ✎ fix, a GM edit), the engine raises its level to the last threshold reached, one level at a time, and runs `onLevel` for each level gained; XP that falls below the level's threshold drops the level straight back, running nothing, and a pool left above its lower max comes down to it. Nothing else writes the level: to change one, change XP. Here sparring earns 150 XP, Level 2 starts at 300, and every level adds a point of Grit. The maximum hit points are derived from the level, so the pool grows with it, and the sheet shows the level, the XP to the next one, and the pool as a bar.

```json
{
  "kinds": {
    "person": {
      "fields": {
        "xp": { "type": "number", "label": "XP", "min": 0, "default": 0 },
        "level": { "type": "number", "label": "Level", "min": 1, "default": 1 },
        "grit": { "type": "number", "label": "Grit", "default": 10 },
        "hp_max": { "type": "number", "label": "Max HP", "derived": "8 + self.level * 4" },
        "hp": { "type": "number", "label": "Hit points", "pool": { "max": "hp_max" } }
      }
    }
  },
  "actions": {
    "spar": {
      "id": "spar",
      "label": "Spar at the yard",
      "params": {},
      "requires": [],
      "outcomes": { "default": [{ "type": "award", "args": { "entity": "self", "progression": "adventurer", "amount": 150 } }] },
      "duration": "60",
      "lexicon": ["spar"]
    }
  },
  "ruleset": {
    "progression": {
      "adventurer": {
        "label": "Level",
        "xpField": "xp",
        "levelField": "level",
        "thresholds": [0, 300, 900, 2700],
        "maxLevel": 4,
        "kind": "person",
        "onLevel": [{ "type": "add", "args": { "entity": "self", "field": "grit", "delta": 1 } }]
      }
    },
    "sheet": {
      "sections": [{ "id": "growth", "label": "Growth", "rows": [{ "progression": "adventurer" }, { "pool": "hp" }, { "field": "grit" }] }]
    }
  }
}
```

**Try it.** In Playtest, type *I spar* three times. The second spar reaches 300 XP: you reach Level 2, Grit goes from 10 to 11, the Journal says "You reached Level 2.", and your hit points can now reach 16. The third leaves you at 450 XP, still Level 2.

The thresholds can come from a data table instead (`"thresholds": { "table": "xp_levels", "column": "xp" }`, read in row order). `onLevel` sees `level` and `from` in its formulas, so `"delta": "=level % 2 == 0 ? 1 : 0"` adds a point only on even levels.

## A skill challenge

A puzzle track that opens after three successful checks, under the **Balanced** adjudication policy. Each lock is a little harder than the last (the DC is 12, then 14, then 16). Balanced rolls every check between two limits: a check with a 95 % chance or better passes without a roll ("No roll needed"), one with 5 % or worse fails without one ("Too hard to try"), and a close roll is told to the narrator as a close call. A failed attempt stands until something changes: an hour passes, the odds change, or you leave and come back.

```json
{
  "kinds": {
    "person": {
      "fields": {
        "finesse": { "type": "number", "label": "Finesse", "default": 0 },
        "locks_open": { "type": "number", "label": "Locks open", "min": 0, "default": 0 }
      }
    }
  },
  "entities": { "you": { "fields": { "finesse": 4 } } },
  "checks": {
    "tumbler": { "id": "tumbler", "dice": "1d20", "modifier": "self.finesse", "dc": "12 + self.locks_open * 2" }
  },
  "actions": {
    "work_lock": {
      "id": "work_lock",
      "label": "Work a lock",
      "params": {},
      "requires": ["stage.vault_door == 'locked'"],
      "check": "tumbler",
      "outcomes": {
        "success": [{ "type": "add", "args": { "entity": "self", "field": "locks_open", "delta": 1 } }],
        "failure": [{ "type": "note", "args": { "text": "A tumbler slips back into place." } }]
      },
      "duration": "10",
      "lexicon": ["work the lock", "pick the lock"]
    }
  },
  "tracks": {
    "vault_door": {
      "id": "vault_door",
      "kind": "puzzle",
      "label": "The vault door",
      "start": "locked",
      "visibility": "public",
      "stages": {
        "locked": {
          "label": "Three locks hold the door",
          "objectives": [{ "label": "Open all three locks", "when": "pov.locks_open >= 3" }],
          "next": [{ "to": "open", "when": "pov.locks_open >= 3" }],
          "hints": ["Each lock gives a little under steady hands."]
        },
        "open": { "label": "The door swings open", "next": [] }
      }
    }
  },
  "ruleset": {
    "adjudication": {
      "preset": "balanced",
      "checks": "every",
      "riskyAt": 0.75,
      "trivialAt": 0.95,
      "impossibleAt": 0.05,
      "description": { "weight": "bonus", "max": 2, "advantageAt": 2 },
      "authority": "hybrid",
      "closeBy": 2,
      "retry": "changed",
      "retryAfter": 60
    }
  }
}
```

**Try it.** Type *I work the lock* until the door opens. With Finesse 4 each lock rolls (a 65 %, then 55 %, then 45 % chance), and the palette shows the odds before you choose. Raise Finesse to 15 and every lock is a sure thing: three tries, no rolls, and the door is open. Lower it to −30 and no lock can be picked: each try fails without a roll.

These values are Balanced's own, so the policy reads as Balanced. A policy's values are its own: change any of them and it plays as Custom with them (lint says so, and suggests naming it `"custom"`). The policy here is the world's default; a player can pick another for a chat in **Settings → Checks**. The check names no `pass`, so `success` counts as passing, the outcome a DC check reads when it isn't failed. To have the player's described approach count, keep `description.weight` at `bonus`: the judge step rates it, and the rating adds to the roll.

## A shop with a priced catalog

The Buy action prices what you ask for from the world's `economy.catalog` table, finding the row by its id or by its name (with an `economy.categories` table, naming a whole category prices from its band instead). A row's `price_cents` is a band in minor units of the world's currency; a price drawn from it varies a little around `typical`, so a fixed price sets `min`, `typical` and `max` alike. At Money 2 the shop takes cash from the buyer's cash account and declines what they can't cover, and at Gear 1 or more a physical thing you buy (the categories `tools_hardware`, `groceries_staples`, `clothing` and the like) comes into being in your hands.

```json
{
  "realism": { "levels": { "money": 2 } },
  "places": { "store": { "id": "store", "name": "Hollow Creek General Store", "fields": {} } },
  "start": { "place": "store" },
  "entities": {
    "you": { "fields": { "place": "store" } },
    "purse": { "id": "purse", "kind": "account", "name": "Your purse", "tier": "background", "fields": { "owner": "you", "type": "cash", "opening": 2000 }, "relations": [] }
  },
  "tables": {
    "economy.catalog": {
      "id": "economy.catalog",
      "pack": "economy",
      "schema": "lre-table/economy.catalog/v1",
      "revision": "05c9407d21cade2a99c5351d90b8e57d",
      "label": "Hollow Creek General Store",
      "columns": {
        "name": { "type": "text" },
        "category": { "type": "text" },
        "unit": { "type": "text" },
        "price_cents": { "type": "band", "unit": "cents" }
      },
      "rows": {
        "lantern": { "name": "Brass lantern", "category": "tools_hardware", "unit": "each", "price_cents": { "min": 1250, "typical": 1250, "max": 1250 } },
        "rope": { "name": "Hemp rope", "category": "tools_hardware", "unit": "50 ft", "price_cents": { "min": 600, "typical": 800, "max": 1000 } },
        "jerky": { "name": "Beef jerky", "category": "groceries_staples", "unit": "bag", "price_cents": { "min": 350, "typical": 350, "max": 350 } }
      }
    }
  }
}
```

**Try it.** With $20.00 in your purse, *I buy a brass lantern* costs $12.50 and puts the lantern in your hands; *I buy beef jerky* costs $3.50. A second lantern is declined: $4.00 doesn't cover it. Rope costs between $6.00 and $10.00, close to $8.00.

The `revision` is computed from the table's schema, columns and rows, never written by hand: whenever a table is saved to a draft (by Build's table editor, or by an agent's patch), the engine computes it and pins it in `pins.tables`. For a store that charges more than the world's usual prices, the `economy.price_modifier` effect raises a category, or everything, at one place (`"percent": 25` is a quarter dearer).

## Secret lore behind a track

A secret track reveals the mayor's debt once you reach the mill office, and a lore entry holds the secret itself. The entry is `secret`, so its `gate` keeps it shut until the track reaches `revealed`, and its `audience` names the one helper that may read it before then: `npc.choose`, the step that decides what NPCs do. No helper that writes prose for the narrator is in the audience, so nothing it reads can reach the story early.

```json
{
  "places": {
    "mill": { "id": "mill", "name": "The mill", "fields": {} },
    "mill_office": { "id": "mill_office", "name": "The mill office", "parent": "mill", "fields": {} }
  },
  "start": { "place": "mill" },
  "entities": {
    "you": { "fields": { "place": "mill" } },
    "hale": { "id": "hale", "kind": "person", "name": "Mayor Hale", "tier": "supporting", "fields": { "place": "mill" }, "relations": [] }
  },
  "tracks": {
    "hale_debt": {
      "id": "hale_debt",
      "kind": "secret",
      "label": "The mayor's debt",
      "owner": "hale",
      "start": "hidden",
      "visibility": "secret",
      "stages": {
        "hidden": {
          "label": "The mill's books don't add up",
          "cue": "The miller won't meet your eye when the mayor's name comes up.",
          "next": [{ "to": "revealed", "when": "at(pov, 'mill_office')" }]
        },
        "revealed": {
          "label": "The mayor owes the mill",
          "truth": "Mayor Hale borrowed the mill's grain money to cover his gambling debts.",
          "next": []
        }
      }
    }
  },
  "lore": {
    "hale_debt": {
      "id": "hale_debt",
      "title": "Hale's debt",
      "content": "Mayor Hale borrowed the mill's grain money to cover his gambling debts. He means to repay it before the harvest audit.",
      "keys": ["mayor", "debt", "grain money"],
      "links": ["hale", "mill"],
      "secret": true,
      "gate": "stage.hale_debt == 'revealed'",
      "audience": ["npc.choose"]
    }
  }
}
```

**Try it.** Check world runs a day without a leak: the truth never shows in a section. In Playtest, *I go to the mill office* reveals the track, and from then on the gate holds.

Lint guards the secret. The entry repeats the track's truth, so without `"secret": true` it is an error (`secret_truth`); a secret entry needs a gate (`no_gate`); and putting a prose step such as `brief` in the audience is a warning (`prose_audience`). The GM view shows every track with its truth whatever the player knows.

## A room on the grid

A walled garden drawn as a grid map, with the optional grid system on: walls and doors steer you, things lie in cells, and stepping into a zone fires a rule. The potting shed is a room behind a door, an iron key lies on the path, and the fountain is a zone. Cells outside every room (the paths here) count as the map's own place, the garden.

```json
{
  "mapSettings": { "display": "knowledge", "grid": { "movement": true, "sightRadius": 3 } },
  "places": { "garden": { "id": "garden", "name": "The walled garden", "fields": {} } },
  "start": { "place": "garden" },
  "entities": {
    "you": { "fields": { "place": "garden" } },
    "key": { "id": "key", "kind": "item", "name": "Iron key", "tier": "background", "fields": {}, "relations": [] }
  },
  "maps": {
    "garden": {
      "id": "garden",
      "scope": "garden",
      "title": "The walled garden",
      "cellMeters": 2,
      "layout": ["#########", "#sss#...#", "#sss+.F.#", "#sss#.K.#", "######+##"],
      "legend": { "s": { "place": "shed" }, "F": { "zone": "fountain" }, "K": { "item": "key" } },
      "places": [{ "id": "shed", "name": "Potting shed" }]
    }
  },
  "rules": {
    "fountain_coins": {
      "id": "fountain_coins",
      "on": { "zone": "fountain", "in": "garden" },
      "do": [{ "type": "note", "args": { "text": "Coins glint under the water." } }]
    }
  }
}
```

**Try it.** You start at the gate in the bottom wall, x 6 and y 4 (x counts from the left, y from the top, both from 0). On the map, tap the fountain two squares up and **Walk here**: the rule fires and the Journal notes the coins. Standing there doesn't fire it again; stepping off and back on does. The key lies on the square below the fountain, close enough to **Take** from where you stand. Walk to the shed and you're in the potting shed: its door is the only way in.

A zone trigger without `who` counts only the POV; `"who": { "kind": ["person"] }` counts anyone. Each room's area is also a zone named by the room, so `{ "zone": "shed", "in": "garden" }` fires on stepping into the shed. Lint checks the zone and cell triggers against the map.

## A family

A family is a group (the Relationships pack's `family` kind) whose members hold `member_of`, with kinship between them. `parent_of` and `child_of` are each other's inverse and `spouse_of` is symmetric, so the engine keeps both sides: the `link` and `unlink` effects write and remove the other side with them, and a chat starts with any side the world left out. Write both sides, as here, and lint has nothing to say. A schedule owned by the group applies to every member who isn't a group, so one schedule brings the whole family home for supper.

```json
{
  "places": {
    "okafor_house": { "id": "okafor_house", "name": "The Okafor house", "fields": {} },
    "bakery": { "id": "bakery", "name": "Okafor's Bakery", "fields": {} }
  },
  "start": { "at": "2026-01-01T17:00" },
  "entities": {
    "okafors": { "id": "okafors", "kind": "family", "name": "The Okafors", "tier": "background", "fields": {}, "relations": [] },
    "ada": {
      "id": "ada",
      "kind": "person",
      "name": "Ada Okafor",
      "tier": "supporting",
      "fields": { "place": "bakery" },
      "relations": [
        { "type": "member_of", "to": "okafors", "fields": { "role": "Mother" } },
        { "type": "spouse_of", "to": "emeka" },
        { "type": "parent_of", "to": "tobi" }
      ]
    },
    "emeka": {
      "id": "emeka",
      "kind": "person",
      "name": "Emeka Okafor",
      "tier": "supporting",
      "fields": { "place": "bakery" },
      "relations": [
        { "type": "member_of", "to": "okafors", "fields": { "role": "Father" } },
        { "type": "spouse_of", "to": "ada" },
        { "type": "parent_of", "to": "tobi" }
      ]
    },
    "tobi": {
      "id": "tobi",
      "kind": "person",
      "name": "Tobi Okafor",
      "tier": "background",
      "fields": { "place": "bakery" },
      "relations": [
        { "type": "member_of", "to": "okafors", "fields": { "role": "Son" } },
        { "type": "child_of", "to": "ada" },
        { "type": "child_of", "to": "emeka" }
      ]
    }
  },
  "schedules": {
    "okafor_supper": {
      "id": "okafor_supper",
      "owner": "okafors",
      "target": "place",
      "recurrence": { "every": "day" },
      "slots": [{ "start": "18:00", "end": "20:00", "value": "okafor_house" }]
    }
  }
}
```

**Try it.** The day starts at five in the afternoon with the family at the bakery. Timelapse an hour and a half: at six they all go home for supper. Formulas can ask about them: `member_of(tobi, 'okafors')` is true, and so is `has_rel(ada, 'parent_of', 'tobi')`.

A selector picks the family wherever one is asked for: `{ "memberOf": ["okafors"] }` matches the three of them, for a schedule's owner, a rule's `who`, an action parameter's candidates or who knows a secret (`knownBy`). The person's own schedule wins over the group's for the same field, so Tobi can keep his own Saturday plans.
