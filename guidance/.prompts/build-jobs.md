---
description: The words of Build's model jobs. brief_ and the job's kind is the brief its agent is started with (world is the world's id, name its name; entries, books, chars, place, map and people are the job's own counts and names). propose_kept and propose_unusable are said before each answer of world_propose, propose_no_job when an agent of no Build job calls it. job_refused_ and the cause (off, day_count, day_tokens, limit, agent, hook), or job_refused, word a job RPH did not start; job_limit a job that stopped at one of its limits; job_failed, job_cancelled, job_off_path and job_interrupted a job that ended with nothing proposed (report is its agent's last words); job_gone a job RPH no longer has.
format: lines
---
brief_import_lore: Import the {{entries}} lore entries you are given ({{books}} book(s)) into world data for {{name}} ({{world}}), as world_propose proposals.
brief_refine: Do what he asks of {{name}} ({{world}}), as world_propose proposals.
brief_index_text: Index the text you are given ({{chars}} characters) into lore entries for {{name}} ({{world}}), as world_propose entries.
brief_describe_map: Draw {{place}} of {{name}} ({{world}}) as the map {{map}}, from his description, and propose it with world_propose.
brief_propose_routines: Propose the routines and schedules of the {{people}} people and groups you are given in {{name}} ({{world}}), with world_propose.
propose_kept: Kept. {{standing}} proposal(s) stand for his review.
propose_unusable: Nothing in that call could be used; the answer says why.
propose_no_job: world_propose works only in a job started from Build.
job_refused: The job was not started ({{refused}}).
job_refused_off: Jobs are switched off on the Jobs page, so the job was not started.
job_refused_day_count: The day's count of jobs ({{max}}) is reached, so the job was not started.
job_refused_day_tokens: The day's job tokens ({{value}} of {{max}}) are spent, so the job was not started.
job_refused_agent: There is no agent definition {{agent}}, or no model for it, so the job was not started.
job_limit: It stopped at its {{limit}} limit ({{value}} of {{max}}); what it proposed by then is below.
job_failed: The job's agent failed: {{report}}
job_cancelled: The job was cancelled on the Jobs page.
job_off_path: The job was cut off.
job_interrupted: The job was interrupted by a restart.
job_gone: RPH no longer has the job.
