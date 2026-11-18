---
description: How the tools that read and change a world's document are called - world_read, world_shape, world_status, world_history, world_put, world_set, world_patch, world_remove, world_discard, world_restore, world_commit, world_upgrade and world_made. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
Each takes `world`, a world by its id; left out, the world this chat plays. world_shape shows the members of a `collection` or a `part` before you read or write it. world_read reads the draft (or, by `source`, what this chat plays or a kept `revision`) at `at`, a JSON pointer; a value too long for one answer comes as an outline, to read further into with a longer pointer.

    world_shape {"collection": "places"}
    world_read {"at": "/places/keepers_kitchen"}

The writes change the draft, with Build's own checks: world_put puts one item whole into a `collection` by its `id`, world_set sets one `part` whole, world_patch takes JSON Patch `ops`, all or none, and world_remove takes one item out. world_commit keeps the draft as the world's next revision, with a `note`; world_discard throws the draft away; world_restore brings a kept `revision` (world_history lists them) back into the draft.

    world_patch {"ops": [{"op": "replace", "path": "/places/keepers_kitchen/name", "value": "Keeper's kitchen"}]}
    world_commit {"note": "The kitchen's name as the story spells it."}

world_upgrade moves this chat on to a `revision` of its world (the head, when left out) from its next turn. world_made lists what this chat made in play that the world does not hold.
