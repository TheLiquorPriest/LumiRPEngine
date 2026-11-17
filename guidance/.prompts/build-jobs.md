---
description: The words of Build's model jobs. brief_ and the job's kind is the brief its agent is started with (world is the world's id, name its name; entries, books, chars, place, map and people are the job's own counts and names). propose_kept and propose_unusable are said to the agent before each answer of world_propose, propose_no_job when an agent of no Build job calls it. dropped_ and a reason words why proposals were dropped, each following how many it dropped (max is build.jobs.proposals, kind the kind proposed); the agent is answered them after each call, and the player reads them at the job's end in dropped_summary (dropped and proposed are counts, reasons the reasons with their counts), or proposed_nothing when the agent proposed none. unusable_ and a reason is why a call of Propose routines could not be read (items is how many it held). The rest are shown to the player in Build. job_refused_ and the cause (off, day_count, day_tokens, agent, hook), or job_refused, word a job RPH did not start; job_limit a job that stopped at one of its limits; job_failed, job_cancelled, job_off_path and job_interrupted a job that ended with nothing proposed (report is its agent's last words); job_gone a job RPH no longer has.
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
dropped_past_limit: were past the {{max}}-proposal limit (build.jobs.proposals)
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
