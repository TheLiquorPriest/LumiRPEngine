---
description: The words of Build's model jobs. brief_ and the job's kind is the brief its agent is started with (world is the world's id, name its name; entries, books, chars, place, map and people are the job's own counts and names). propose_kept and propose_unusable are said to the agent before each answer of world_propose, propose_no_job when an agent of no Build job calls it. dropped_ and a reason words why proposals were dropped, each following how many it dropped (max is build.jobs.maxProposals, kind the kind proposed); the agent is answered them after each call, and the player reads them at the job's end in dropped_summary (dropped and proposed are counts, reasons the reasons with their counts), or proposed_nothing when the agent proposed none. unusable_ and a reason is why a call of Propose routines could not be read (items is how many it held). fix_item is each problem Propose routines' agent is answered to fix after a call (at is the item's place in the call, name whose it is, label its label, problem the problem), and fix_ and a problem words the problem (entry, entity, field, place, owner, owners, id, group, what and label are what it is about, name a person's or group's name); fix_unlabelled stands for an item with no label and no activity. The player reads the same problems on the proposals in review. The rest are shown to the player in Build. job_refused_ and the cause (off, day_count, day_tokens, agent, hook), or job_refused, word a job RPH did not start; job_limit a job that stopped at one of its limits; job_failed, job_cancelled, job_off_path and job_interrupted a job that ended with nothing proposed (report is its agent's last words); job_gone a job RPH no longer has. map_problem is one problem of a drawn map's lint (at is where in the map, message what the lint says), map_check heads the note a map proposal carries, map_still_problems is the job's end note when the map still has problems, and index_cut says how much of an indexed text was past its limit.
format: lines
---
brief_import_lore: Import the {{entries}} lore entries of {{books}} book(s) you are given into world data for {{name}} ({{world}}), proposed with world_propose.
brief_refine: Do what the player asks of {{name}} ({{world}}), proposed with world_propose.
brief_index_text: Index the text you are given ({{chars}} characters) into lore entries for {{name}} ({{world}}), proposed with world_propose.
brief_describe_map: Draw {{place}} of {{name}} ({{world}}) as the map {{map}}, from the player's description, proposed with world_propose.
brief_propose_routines: Propose the routines and schedules of the {{people}} people and groups you are given in {{name}} ({{world}}), with world_propose.
propose_kept: Kept. {{standing}} proposal(s) stand for the player's review.
propose_unusable: Nothing in that call could be read as this job's proposals.
propose_no_job: world_propose works only in a job started from Build.
dropped_no_id: had no usable id
dropped_replaced: were replaced by a later proposal of the same id
dropped_past_limit: were past the {{max}}-proposal limit (build.jobs.maxProposals)
dropped_exists: already exist in the world
dropped_player_character: named the player character
dropped_unknown_kind: used a kind this world doesn't have ({{kind}})
dropped_no_name: had no name
dropped_duplicate_name: duplicated an existing name
dropped_no_places: joined places that don't exist
dropped_no_travel_time: had no travel time
dropped_replaced_title: were replaced by a later proposal of the same title
dropped_no_title: had no title
dropped_existing_title: repeated an existing entry's title
dropped_no_text: had no text
dropped_secret: carried a secret's words
dropped_no_source: cited nothing they rest on
dropped_not_routine: didn't read as a routine or a schedule
dropped_repeat: repeated another proposal
dropped_in_world: repeated what the world already has
dropped_summary: {{dropped}} of {{proposed}} proposal(s) dropped: {{reasons}}.
proposed_nothing: The job's agent proposed nothing.
unusable_not_json: empty or not JSON
unusable_shape: neither routines nor schedules
unusable_none_readable: none of its {{items}} item(s) readable
fix_item: {{at}} ({{name}}, "{{label}}"): {{problem}}
fix_unlabelled: (no label)
fix_owner_missing: its owner is missing
fix_owner_not_in_pass: its owner "{{owner}}" isn't one of {{owners}}
fix_no_label: it has no label
fix_no_activity: it has no activity
fix_no_source: it cites no source
fix_no_quote: its source has no quote
fix_lore_not_citable: its source "{{entry}}" isn't a lore entry it may cite
fix_quote_not_in_lore: its quote isn't in {{entry}}: copy it word for word
fix_source_shape: its source is neither {"lore"} nor {"sheet", "field"}
fix_sheet_not_citable: its source "{{entity}}" isn't a person or group whose sheet it may cite
fix_no_sheet_field: {{name}}'s sheet has no field "{{field}}" to cite
fix_quote_not_in_sheet: its quote isn't in {{name}}'s {{field}}: copy it word for word
fix_label_names_someone: its label "{{label}}" names someone: the player reads labels, so say who in its company
fix_label_names_unseen_place: its label "{{label}}" names a place the player can't know yet
fix_place_shape: its place is "home", "work", "with" or a place id
fix_place_not_told: its place {{place}} isn't one the player may be told of
fix_place_not_in_world: its place {{place}} isn't in the world
fix_no_place: it names no place
fix_block_kind: its kind is fixed, flexible or optional
fix_time: its {{what}} is an HH:MM time
fix_same_times: its start and end are the same time
fix_company_shape: its company is {"ids"} or {"group"}
fix_company_not_person: its company "{{id}}" isn't a person in the world
fix_company_no_tie: {{name}} ({{id}}) in its company has no tie to {{owner}}, and the cited text doesn't name them together
fix_company_not_group: its company "{{group}}" isn't a group in the world
fix_company_not_member: {{owner}} doesn't belong to {{name}} ({{group}}), its company
fix_company_none: its company names no one: {"ids": [...]} or {"group": "<id>"}
fix_recurrence_shape: its recurrence is {"every": "day"|"week"|"month"|"year", …}
fix_weekdays: its weekdays are 0 (Sunday) to 6
fix_month_days: its days of the month are 1 to 31, or -1 to -31 from the end
fix_date: its {{what}} is a YYYY-MM-DD date
fix_except: its except names holidays the calendar doesn't have
job_refused: The job was not started ({{refused}}).
job_refused_off: The job was not started: jobs are switched off on the Jobs page.
job_refused_day_count: The job was not started: {{value}} jobs have started in a day{{#connection}} on {{connection}}{{/connection}}, and {{max}} is the most allowed.
job_refused_day_tokens: The job was not started: jobs sent and wrote {{value}} tokens in a day, and {{max}} is the most allowed.
job_refused_agent: The job was not started: there is no agent named {{agent}}, or it has no model to run on.
job_refused_hook: The job was not started: the hook {{hook}} kept it from starting ({{reason}}).
job_limit: It stopped at its limit on {{limit}} ({{value}} of {{max}}); what it proposed by then is below.
job_failed: The job's agent failed: {{report}}
job_cancelled: The job was cancelled on the Jobs page.
job_off_path: The job was cut off.
job_interrupted: The job was interrupted by a restart.
job_gone: RPH no longer has the job.
map_problem: - {{#at}}{{at}}: {{/at}}{{message}}
map_check: Check before you apply it:
map_still_problems: The map still has problems; its note lists them, and it starts unticked.
index_cut: The last {{cut}} characters of the text were past the most one job reads (the setting build.index.maxChars) and were not read; index them in another job.
