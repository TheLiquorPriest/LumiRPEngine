---
name: places-and-maps
description: Keep the map true. Put everyone and everything on the grid when a scene opens, record moves, lay a grid for a place that has none of its own scale, and measure distance, reach and sight instead of guessing.
---
# Keeping the map

The world state prints the scene's map and where everyone and everything stands on it. The Author and the characters act on that picture. If it is wrong, they are wrong.

## The grid

- Squares. A grid laid in play uses the D&D square, 5 feet. A map the player built keeps the cell size it was drawn with.
- A position is a square, written (column, row), counted from the top left.
- Moving diagonally counts as one square unless the ruleset says otherwise. No cutting across the corner of a wall.
- Something larger than one square has a footprint. Something on a table is *on* the table and shares its square.
- A grid counts time in its own step. A room grid counts in rounds of six seconds, so a fight does not run the clock forward.

## When the place's only map is coarser than a room

A map the player built may count a whole block or a stretch of road as one square. Nobody can be placed in a room on it. Do not put people a block apart.

1. Lay a room grid of 5 ft squares for the place with `map_lay`, and link it to its square on the larger map.
2. Place everyone on the room grid.
3. Keep the larger map for travel between places.

## When a scene opens on a map and nobody is on it

Place everyone and everything present in one `map_place` call.

1. Take what the prose and the lore say first: "behind the bar", "by the hearth", "at the door".
2. Fill the rest plainly: people stand where their business is, things lie where they are used.
3. Mark what you placed without a source as assumed. The player can drag it.

The consent rule says which of this needs the Author's consent.

## When a place has no map

Do nothing until position starts to matter: a fight, a chase, a search, a question of who can see or reach what. Then lay a simple grid with `map_lay`:

1. Draw only what the prose and the lore support: the room's rough shape and size, its doors, the fixtures already mentioned.
2. Keep it small and plain. Twelve by eight squares is a large room.
3. Say in your answer that you laid it, so the Author sees it. It belongs to this chat until the player keeps it in the world.

If the place is named in the lore and described there, follow the description.

## How a change is recorded

- A move: `world_apply` with a `move` operation. Give the square, or "next to" someone, or a zone.
- Something put down, picked up, opened, closed or locked: `world_apply` with `place`, or `map_door`.
- The place itself changing (a wall broken, a table overturned, a door barred): `map_edit`.

## Measure, do not guess

Use `map_measure` for distance, for the path and how long it takes, for whether one square can see another, for cover, and for who is inside an area. A closed door blocks the way and the view. Give the Author the numbers.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a square inside a wall, no way through. Read the report. Fix the position or tell the Author; do not leave it.
