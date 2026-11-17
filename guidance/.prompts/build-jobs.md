---
description: The words of Build's model jobs. brief_ and the job's kind is the brief its agent is started with (world is the world's id, name its name; entries, books, chars, place, map and people are the job's own counts and names). propose_kept and propose_unusable are said to the agent before each answer of world_propose, propose_no_job when an agent of no Build job calls it. The rest are shown to the player in Build. job_refused_ and the cause (off, day_count, day_tokens, agent, hook), or job_refused, word a job RPH did not start; job_limit a job that stopped at one of its limits; job_failed, job_cancelled, job_off_path and job_interrupted a job that ended with nothing proposed (report is its agent's last words); job_gone a job RPH no longer has.
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
