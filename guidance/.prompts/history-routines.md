---
description: The sentences of the changes made to someone's routine, schedule or following in this chat, as the game master reads them, and of how someone follows their routine. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  castlife_in_chat: a change to someone's routine or schedule in this chat, as the GM reads it - what (the sentence below), story (set where the story made it)
  castlife_follow: how someone follows their routine in this chat - name, parts (the follow_* lines, read as a list); castlife_follow_world when none is set
  follow_mode_*, follow_awareness_*, follow_role_*, follow_skips_*: one part of how someone follows their routine, as a phrase after the name (follows, no_invitations, off; story_first, balanced, routine_first; informative, enforced, off; stay, routine, model)
  castlife_block_back, castlife_block_off, castlife_block_changed: one block of someone's routine in this chat, back to the world's, off, or changed - name, block
  castlife_schedule_label: a schedule as a phrase - schedule, sets (what it sets, the schedule_sets_* lines); castlife_schedule_world, castlife_schedule_off, castlife_schedule_own say what happened to it - name, label
---
castlife_decided: decided {{choice}}
castlife_skip: skip planned for {{plans}}{{#note}} ({{note}}){{/note}}
castlife_in_chat: {{what}} in this chat ({{#story}}from the story{{/story}}{{^story}}set by the GM{{/story}})
castlife_follow_world: {{name}} follows their routine as the world sets it again
castlife_follow: {{name}} {{parts}}
follow_mode_follows: follows their routine
follow_mode_no_invitations: follows their routine but makes and accepts no invitations
follow_mode_off: has no routine
follow_awareness_story_first: puts the story before their routine
follow_awareness_balanced: weighs the story and their routine alike
follow_awareness_routine_first: puts their routine before the story
follow_role_informative: takes their routine as context only
follow_role_enforced: lives their routine as written
follow_role_off: ignores their routine
follow_skips_stay: stays put in a time skip
follow_skips_routine: follows their routine in a time skip
follow_skips_model: lives a time skip as the model plans it
castlife_block_back: {{name}}'s “{{block}}” is back to the world's
castlife_block_off: {{name}}'s “{{block}}” is off
castlife_block_changed: {{name}}'s “{{block}}” changed
schedule_sets_place: where they are
schedule_sets_activity: what they're doing
schedule_sets_field: their {{field}}
castlife_schedule_label: “{{schedule}}” schedule{{#sets}} (it sets {{sets}}){{/sets}}
castlife_schedule_world: {{name}} keeps the world's {{label}} again
castlife_schedule_off: {{name}} is off their {{label}}
castlife_schedule_own: {{name}} has their own {{label}}
