---
description: The words an agent is told when it starts a job with job_start - that the job was started; that the player's count of jobs for the day, or of jobs one turn or one job may start, was reached; or that jobs have spent the tokens the player allows them in a day. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)". Why no agent could be started is said in the words of delegation.md.
format: lines
---
started: Job {{job}} was started: {{agent}} works on it in the background{{#queued}} once a place is free{{/queued}}.
day_limit: No job was started: {{value}} jobs were started today{{#connection}} on {{connection}}{{/connection}}, and the player allows {{max}}.
run_limit: No job was started: this {{#job}}job{{/job}}{{^job}}turn{{/job}} has started {{value}} jobs, and the player allows {{max}}.
day_tokens: No job was started: what jobs sent and wrote today counts as {{value}} tokens, and the player allows {{max}}.
