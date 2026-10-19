---
name: lumirpengine
description: Read, build, edit, check, playtest and commit LumiRPEngine worlds (the persistent world simulations a Lumiverse roleplay chat plays) on the user's Lumiverse, or as files offline. Use when asked to make, convert, fix or extend a LumiRPEngine world, its people, places, quests, secrets, lore or rules.
---

# Working on LumiRPEngine worlds

A LumiRPEngine world is one JSON document (`lre-world-v1`): collections keyed by id (entities, places, tracks, lore…) and a few parts (calendar, start, pov). The engine settles what rules can settle; the narrator only writes. Each commit makes an immutable revision, and chats keep theirs until the player upgrades.

## Tools

Use whichever is available:

- **MCP** (the `lumirpengine` server; this repo's `.mcp.json` declares it): `lre_guide`, `lre_docs`, `lre_schema`, `lre_templates`, `lre_template`, `lre_check`, `lre_playtest`, `lre_check_world`, `lre_status`, `lre_worlds`, `lre_world`, `lre_search`, `lre_world_create`, `lre_world_import`, `lre_edit`, `lre_draft`, `lre_diff`, `lre_commit`, `lre_discard`, `lre_history`, `lre_restore`, `lre_world_delete`, `lre_world_export`, `lre_chats`, `lre_attach`, `lre_upgrade`.
- **Shell**: `npx -y github:TheLiquorPriest/LumiRPEngine <command>` (the first run downloads about 14 MB from GitHub; `#<tag or commit>` after the repo pins a version), or `node dist/lumirpengine.js <command>` in a clone. `help` lists the commands; each runs one tool (`world <id>` is `lre_world`, `create` is `lre_world_create`). The user signs in once with `login`; never ask for their password.

## Steps

1. **Read the guide first** (`lre_guide` / `guide`): the world model, the workflow, and the mistakes that are easy to make. Look kinds, fields, effects and formulas up with `lre_docs`.
2. **Find the world**: `lre_worlds`, `lre_search`, then `lre_world` at a JSON Pointer (`""` outlines the whole world). Read the draft: it is what you will edit. A draft already stored when you start is the user's work in progress: ask them before you touch it.
3. **Edit the draft** with `lre_edit` (JSON Patch), passing `expectVersion` from your last read. If it is refused because the version moved, read again: the user may be editing it in Build.
4. **Check after every change**: the edit's answer lists lint and new macro hazards; `lre_draft` and `lre_diff` show what the draft changes. Run `lre_playtest` and `lre_check_world`.
5. **Commit** with `lre_commit` and a short note, or `lre_discard`, passing `expectVersion` as for an edit. Never leave a draft behind: the draft is the user's Build draft, and their Commit in Build commits your unfinished work with theirs.
6. **Hand it over**: say what changed, what you assumed, and which chats are now behind (`lre_chats`; `lre_upgrade` with `preview` shows what an Upgrade brings).

## Rules

- A secret track never starts on a stage with a `truth`: start one stage earlier, moving on with `"when": "true"`.
- Someone who starts dead or dying lists who knows in `lifeKnownBy`; left out, everyone knows.
- Whose a thing is lives in `fields.owner`; the `owns` relation only changes wording.
- A cue says how someone acts, never the secret it stands for.
- Edit a map, never the places, grids or routes it draws; never write a table's `revision` or `/pins`.
- Keep ids stable in a world that chats play, ids equal to their keys, money in minor units.
- Deleting a world takes its exact name as `confirm`; without it, `lre_world_delete` only previews. Delete only when the user asked, and tell them its engine lore book stays in World Books for them to remove.
- The macros you write (`{{…}}` in lore and templates) skip the user's import review: name each one you add.
- A `path` argument reads a file on the user's machine: pass only files the user gave you or you wrote.
