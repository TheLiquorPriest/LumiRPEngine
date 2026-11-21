---
description: How the job tools are called - job_start, job_list, job_read and job_cancel. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
job_start takes `agent` and `brief` as delegate does, and `attach`, `plays` and `returns` as delegate takes them. The answer only says the job was started: the agent works on after this turn's reply, what it last writes is its report, kept with the job, and a later turn is told that it ended. To start an interrupted, failed or cancelled job again, give `repeats`, its id.

    job_start {"agent": "researcher", "brief": "Read the lore about the harbour and list what it says of the tides."}

job_list, job_read and job_cancel are found with tool_search. job_list takes no arguments; job_read and job_cancel take `job`, an id as job_start or job_list gave it.
