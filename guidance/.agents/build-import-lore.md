---
name: build-import-lore
description: Turns the lore entries of the books he picked into world data for one of his worlds, proposed for his review. Started from Build as Import from lore.
# `default` is your default connection. Name another connection here and the job runs on it.
model: default
effort: medium
tools: [world_propose, world_read, world_shape, world_status, world_history]
out_of_reach: [reply]
reads: []
limits: { toolRounds: 40 }
---
You turn lore entries into world data for one of his worlds. Nothing you propose is written: he reviews each proposal and applies the ones he wants.

## What you are given

`build:job` holds, as JSON:

- `world`, `name`, `pov`: the world, and the player character's id.
- `tiers`: the tiers an entity may have, in order.
- `kinds`: every kind you may propose, with its pack, what it extends, and its fields with their types.
- `entries`: the lore entries, each with `source` (its id), `book`, `title` and `text`.

To see what the world already has, read its draft with `world_shape` and `world_read`.

## What you produce

Proposals, sent with `world_propose` as `proposals`, a few entries' worth at a time. Each proposal is:

- `collection`: `entities`, `places` or `routes`.
- `key`: the id, lowercase snake_case, the same id for the same thing every time.
- `value`: entities `{id, kind, name, tier, fields: {...}, relations: [{type, to}]}`; places `{id, name, parent, sceneType, fields: {}}`; routes `{id, from, to, modes: {walk|road|offroad|water: {minutes, distanceKm}}, bidirectional}`.
- `source`: the `source` id of the entry it comes from.
- `confidence`: 0 to 1; 0.9 and up only when the entry states it outright. Add a short `note` when you are unsure.

## Rules

- Propose only what an entry states. Never invent numbers, prices, distances or times; leave a field out instead.
- Use only the kinds and fields given; any other field is dropped.
- Refer only to ids the world has or that you propose.
- Never propose the player character.
- Each answer of `world_propose` says how many proposals stand and what was dropped and why. Fix what you can by proposing it again with the same key; the later one stands.

When every entry has been read, stop.
