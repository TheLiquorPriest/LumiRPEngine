---
name: lumirpengine
description: Read, build, edit, check, playtest and commit LumiRPEngine worlds (the persistent world simulations a Lumiverse roleplay chat plays) on the user's Lumiverse, or as files offline. Use when asked to make, convert, fix or extend a LumiRPEngine world, its people, places, quests, secrets, lore or rules.
---

# Working on LumiRPEngine worlds

A LumiRPEngine world is one JSON document (`lre-world-v1`): collections keyed by id (entities, places, tracks, lore…) and a few parts (calendar, start, pov). The engine settles what rules can settle; the narrator only writes. Each commit makes an immutable revision, and chats keep theirs until the player upgrades.

## Tools

Use whichever is available:

- **MCP** (the `lumirpengine` server; this repo's `.mcp.json` declares it): `lre_guide`, `lre_docs`, `lre_schema`, `lre_templates`, `lre_template`, `lre_check`, `lre_playtest`, `lre_check_world`, `lre_status`, `lre_worlds`, `lre_world`, `lre_search`, `lre_world_create`, `lre_world_import`, `lre_edit`, `lre_draft`, `lre_diff`, `lre_commit`, `lre_discard`, `lre_history`, `lre_restore`, `lre_world_delete`, `lre_world_export`, `lre_chats`, `lre_attach`, `lre_upgrade`.
- **MCP, beyond worlds** (`lre_guide` topic "Setup, lore and jobs"): settings (`lre_settings`, `lre_settings_set`, `lre_settings_caveats`), the preset (`lre_preset`, `lre_preset_add_blocks`), diagnostics (`lre_diag`, `lre_diag_clear`, `lre_activity_dismiss`), lore (`lre_lore_books`, `lre_lore_entries`, `lre_lore_pins`, `lre_lore_drift`, `lre_lore_save`), Build's jobs (`lre_job_start`, `lre_jobs`, `lre_job`, `lre_job_apply`, `lre_job_cancel`, `lre_job_dismiss`), the rest of Build (`lre_lint`, `lre_sheet`, `lre_profile`, `lre_studio_offer`, `lre_studio_install`) and a chat's map (`lre_map_display`, `lre_map_walk`). Settings and the preset are the user's own: change them only when asked.
- **Shell**: `lumirpengine <command>` once installed (`npm i -g github:TheLiquorPriest/LumiRPEngine`, about 14 MB from GitHub; `#<tag or commit>` after the repo pins a version), `npx -y github:TheLiquorPriest/LumiRPEngine <command>` without installing (about 7 to 9 s a start, since npx looks GitHub up each time), or `node dist/lumirpengine.js <command>` in a clone. `help` lists the commands; each runs one tool (`world <id>` is `lre_world`, `create` is `lre_world_create`). The user signs in once with `login`; never ask for their password. A harness that runs the server through npx may need a longer start-up timeout (docs/MCP.md).

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
- Whose a thing is lives in `fields.owner`; the `owns` relation only changes wording. Money is held differently: accounts, businesses, holdings and properties name their holders in `fields.owners`, each with a role (`owner`, `joint`, `custodian`, `beneficiary`, `trustee`, `authorized_user`).
- Money that moves on its own (rent, bills, savings, allowances, pay) is a `flow` entity with a schedule and a `shortfall` policy, a job is a `job` entity and an invoice an `invoice` entity: never a note in someone's fields. Amounts are minor units, percentages percent units. `lre_guide` topics "Money" and "Holdings and property" have a patch to copy for each kind.
- A holding names an asset in `packs.economy.config.assets`; a mortgage is a `mortgage` account whose `secured_by` names its property, and the property's `mortgage` names it back.
- A business runs at its own tier's Money level, as a person does: on a tier below Money 4 it collects no sales tax and pays no business tax. Its `operating_account` is an account it owns; any other is passed over.
- A world's own products and assets are maps in `packs.economy.config`. Add each by its id where the map exists: a JSON Patch `add` of the whole map replaces it, dropping what was in it.
- A world's minds settings are its `minds` part; keep `secrecy` at `brief` unless a private thought reaching the narrator gives nothing away (`lre_guide` topic "Character minds").
- A cue says how someone acts, never the secret it stands for.
- Edit a map, never the places, grids or routes it draws; never write a table's `revision` or `/pins`.
- Keep ids stable in a world that chats play, ids equal to their keys, money in minor units.
- Deleting a world takes its exact name as `confirm`; without it, `lre_world_delete` only previews. Delete only when the user asked, and tell them its engine lore book stays in World Books for them to remove.
- The macros you write (`{{…}}` in lore and templates) skip the user's import review: name each one you add.
- A `path` argument reads a file on the user's machine: pass only files the user gave you or you wrote.
