---
name: places-and-maps
description: Keep the map true. Put everyone and everything on the grid when a scene opens, record moves, lay a grid for a place that has none of its own scale, and measure distance, reach and sight instead of guessing.
---
# Keeping the map

The world state prints the scene's map and where everyone and everything stands on it. The Author and the characters act on that picture. If it is wrong, they are wrong.

## The grid

- Squares. The world state prints each grid's scale: how wide a square is and how much time one step on it takes. A grid laid in play takes the scale the settings give; a map the player built keeps the cell size it was drawn with.
- A position is a square, written (column, row), counted from the top left.
- A diagonal move is counted as the grid is set to count it; `map_measure` does the counting. No cutting across the corner of a wall.
- Something larger than one square has a footprint. Something on a table is *on* the table and shares its square.
- A grid counts time in its own step. A room grid counts in rounds of a few seconds, so a fight does not run the clock forward.

## When the place's only map is coarser than a room

A map the player built may count a whole block or a stretch of road as one square. Nobody can be placed in a room on it. Do not put people a block apart.

1. Lay a room grid for the place with `map_lay`, over its square on the larger map (`over` and `square`): that square then opens onto the room grid.
2. Place everyone on the room grid.
3. Keep the larger map for travel between places. A place the story makes that travel needs on it is put on that map with `world_map_place` and joined to its neighbours with `world_map_link`, by how long each way of travelling takes; `places_route` reads the way between two places. Find all three with `tool_search`.

## When a scene opens on a map and nobody is on it

Place everyone and everything present in one `map_place` call.

1. Take what the prose and the lore say first: "behind the bar", "by the hearth", "at the door".
2. Fill the rest plainly: people stand where their business is, things lie where they are used.
3. Mark what you placed without a source as assumed. The player can drag it.

The consent rule says which of this needs the Author's consent.

## When a place has no map

Do nothing until position starts to matter: a fight, a chase, a search, a question of who can see or reach what. Then lay a simple grid of 5 ft squares with `map_lay` (the settings give the scale, and the world state prints each grid's own):

1. Draw only what the prose and the lore support: the room's rough shape and size, its doors, the fixtures already mentioned.
2. Keep it small and plain. Twelve by eight squares is a large room.
3. Say in your answer that you laid it, so the Author sees it. It belongs to this chat until the world takes it in: `world_keep` (found with `tool_search`) copies it into the world's draft, which the player commits in Build. A grid laid in error is taken out again with `map_lay`'s `remove`.

If the place is named in the lore and described there, follow the description.

## A place the story makes

A place the story needs and the world does not hold is made with `world_apply` and a `place` operation. `spawn` makes people and things, never places. Give its `name` and its `kind`, and `at` for the place it is inside.

- `kind: "place"` is a place of this world's own, inside another or in none. `room`, `spot` and `venue` are made in play inside a place, so they need `at`.
- Where lore describes it, name the entries it comes from in `sources`, each with the aspect of the place it defines (its layout, its history), and give its words as `base`. Lore stays the authority for what it defines: the base is marked older than an entry that changed after it was drawn.
- A place of that name already inside the same place is told of in the answer, not taken for the new one.
- `place_label` renames a place or gives it other names. `place_remove` takes one out once nobody and nothing is in it and no place is inside it. `world_path` lays a way between two places with its minutes and distance by each way of travel (walk, road, offroad, water, air); a way a map draws is changed on the map. Find all three with `tool_search`.

## What the story changes at a place

Record it as a `fact` about the place with a `part`: `since` for what the story changed there (a wall broken, a fire lit), `feature` for what the place has, `access` for who may enter and how it stands. Name the beat that caused it in `beat`. `world_query` at the place shows the newest few of each part, with the query that reads the rest whole (`part`).

## How a change is recorded

- A move: `world_apply` with a `move` operation. Give the square, or "next to" someone, or a zone. The engine's own moves are the actions `go` (`to`, and `with` for those who go along) and `step` (`x`, `y`, a square of the grid the doer stands on), carried out with the operation `act`; `who` is the one who goes. A player's press on Go to or Walk here names one. The answer gives the minutes the way takes, and passing them is yours (`act` passes no time). A requirement that does not hold is told in the answer, and the action is carried out all the same (`SIMULATION.md`). `world_query` at `ruleset` lists every action the world has.
- Something put down, picked up, opened, closed or locked: `world_apply` with `place`, or `map_door`.
- The place itself changing (a wall broken, a door barred): `map_edit`. A fixture that starts to move (a table overturned) is no longer drawn: `map_edit`'s `things` makes it a thing with a square of its own in the same call, so that it is placed, moved and measured like any other thing.

## Measure, do not guess

Use `map_measure` for distance, for the path and how long it takes, for whether one square can see another, for cover, and for who is inside an area. Cover and areas follow the world's ruleset, which says how an area is counted and how much cover is half, three-quarters or total; `map_measure` gives the degree and what gives it. A closed door blocks the way and the view. Give the Author the numbers.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a square inside a wall, no way through. `SIMULATION.md` says what to do with a report.
