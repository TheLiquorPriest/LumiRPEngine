---
description: The words of Build's model jobs' own notes and problems - the notes a proposal carries (what was assumed, what was dropped), the problems a routine job finds in a proposal and how it names what a proposal clashes with, and the lines that give a person's schedules and routine blocks to the job as they stand. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it, and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  build_note_*: a note a proposal carries (what the job assumed or dropped, a block's id taken, a schedule that goes with another)
  build_what_*: how a problem names what a proposal clashes with
  build_schedule_line, build_block_line: a person's schedule or routine block as the job is given it
---
build_assumed_kind_kindid_the_lore_named: assumed kind: {{kindId}} (the lore named none)
build_dropped_field_f: dropped field {{f}}
build_f_given_matches_no_label_row: {{f}} "{{given}}" matches no {{label}} row
build_assumed_f_row: assumed {{f}}: {{row}}
build_dropped_unknown_parent_parent: dropped unknown parent {{parent}}
build_dropped_unknown_link_link: dropped unknown link {{link}}
build_a_source_left_out_why: a source left out: {{why}}
build_the_schedule_id: the schedule {{id}}
build_it_clashes_with_what: it clashes with {{what}}
build_the_proposed_block_id: the proposed block {{id}}
build_days_of_the_month: days {{days}} of the month
build_every: every {{every}}
build_schedule_line: {{id}} ({{target}}): {{days}}{{#from}} from {{from}}{{/from}}{{#until}} until {{until}}{{/until}}: {{slots}}
build_block_at: at {{at}}
build_block_on_days: on {{days}}
build_block_on_days_off: on days off
build_block_on_working_days: on working days
build_block_line: {{id}}: {{label}} ({{kind}}, {{when}}, {{minutes}} min{{#perWeek}}, {{perWeek}}× a week{{/perWeek}}{{#days}} {{days}}{{/days}})
build_block_off: {{routine}}: off {{block}}
build_what_block: the block {{block}} of the routine {{routine}}
build_what_proposed_schedule: the proposed schedule {{base}}
build_no_room_in_window: it never has room in its window: {{what}} fill it
build_would_take_from: it would take {{who}} from {{from}} as the story starts
build_where_the_story_starts_them: where the story starts them
build_note_id_taken: its id is {{free}}: {{id}} is taken in {{owner}}'s routine
build_note_twin: goes with schedules.{{schedule}}: apply both
