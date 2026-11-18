---
description: The sentences of what a character's mind holds and does - what it intends, how it reacts, its mood, what it knows, believes, was told or forgot, what it keeps in memory, and what it learned in a round. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
---
mind_round_on: A round of character minds ran
mind_round_off: Character minds are switched off
mind_line: {{name}}'s mind, at {{fidelity}} fidelity, {{#intent}}means to: {{intent}}{{/intent}}{{^intent}}has no intent{{/intent}}
mind_memory: {{name}} remembers the turn in {{notes}} {{#oneNote}}note{{/oneNote}}{{^oneNote}}notes{{/oneNote}} and {{commitments}} new {{#oneCommitment}}commitment{{/oneCommitment}}{{^oneCommitment}}commitments{{/oneCommitment}}
mind_present_none: No one was present for the minds
mind_present: {{who}} {{#one}}was{{/one}}{{^one}}were{{/one}} present for the minds
mind_plan_status: {{name}}'s {{#plan}}plan “{{plan}}”{{/plan}}{{^plan}}deleted plan{{/plan}} is now {{status}}
mind_part_deleted: {{name}}'s {{key}} was deleted
mind_part_edited: {{name}}'s {{key}} was edited
mind_commitment_status: {{name}}'s commitment is now {{status}}
mind_consolidated: {{name}}'s older notes folded into their summary
mind_unpinned: {{name}}'s mind goes by their score again
mind_pinned: {{name}}'s mind is now pinned at {{fidelity}} fidelity
mind_refresh: {{name}} gets a fresh mind next turn
mind_intent_cleared: {{name}} no longer has your intent
mind_intent: {{name}} now means to “{{text}}”{{#approach}}, {{approach}}ly{{/approach}}
mind_intent_manner: {{name}} now goes about things{{#approach}} {{approach}}ly{{/approach}}
mind_skip: The time skip stopped at {{beats}} beats for the minds
mind_fact: A fact for the minds: “{{claim}}”
mind_fact_bare: A fact for the minds
mind_learned: {{who}} learned {{claim}}
mind_holds: {{who}} {{#one}}holds{{/one}}{{^one}}hold{{/one}} {{claim}} ({{parts}})
mind_kept_everyone: kept from everyone
mind_kept_from: kept from {{who}}
mind_told_by: told by {{who}}
mind_sure: {{pct}}% sure
mind_forgot: {{who}} no longer {{#one}}holds{{/one}}{{^one}}hold{{/one}} {{claim}}
mind_keeps_none: {{name}} no longer keeps {{claim}} from anyone
mind_keeps: {{name}} keeps {{claim}} from {{from}}
mind_everyone: everyone
mind_truth: {{claim}} is now {{#open}}an open question{{/open}}{{^open}}{{truth}}{{/open}}
mind_tracking_on: Knowledge tracking is on
mind_tracking_off: Knowledge tracking is off
mind_threshold: , a holding revealing its fact from {{pct}}% sure
knowledge_known: {{claim}} ({{how}})
knowledge_suspected: Suspects: {{claim}} ({{how}}, about {{percent}}% sure)
knowledge_disbelieved: Doesn't believe: {{claim}} ({{how}})
knowledge_unsure: Unsure whether: {{claim}} ({{how}})
knowledge_keeps: keeps it from {{whom}}
knowledge_everyone: everyone
knowledge_authored: from the start
knowledge_witnessed: saw it
knowledge_told: told by {{by}}
knowledge_inferred: worked it out
knowledge_guessed: a guess
knowledge_person: {{name}}: {{line}}
knowledge_notKnown: {{name}} doesn't know: {{claim}}
knowledge_everyoneHere: Everyone here: {{line}}
