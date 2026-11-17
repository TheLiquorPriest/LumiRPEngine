---
description: The single words and phrases the other lines are filled with, and the joiners of a list - a delinquency stage, an account's status, an entry on a credit report, a pay basis, what was done to a card or a standing payment, a party tier, how a holding is held and believed, whose a line is, an organization's type, a role, how a thing is worn, a season's mood, where a fact came from, how a party tier is treated, what a vote or an answer says, and how a motion ended. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  list_and: how a list is read, the last item after the others - head (the others, with commas), last; list_or reads a choice the same way
  word_*, mind_how_*, mind_belief_*: the single words and phrases the lines above are filled with (a delinquency stage, an account's status, an entry on a credit report, a pay basis, what was done to a card or a standing payment, a party tier, how a holding is held and believed, whose a line is)
---
list_and: {{head}} and {{last}}
feed_org_type_company: a company
feed_org_type_household: a household
feed_org_type_group: a group
feed_org_type_trust: a trust
feed_org_type_party: a party
feed_role_owner: owner
feed_role_joint: joint owner
feed_role_custodian: custodian
feed_role_beneficiary: beneficiary
feed_role_trustee: trustee
feed_role_authorized_user: authorized user
feed_worn_worn: worn
feed_worn_pocket: in your pocket
feed_worn_hand: in your hand
feed_mood_winter: a cold winter
feed_mood_spring: a mild spring
feed_mood_summer: a warm summer
feed_mood_autumn: a crisp autumn
feed_source_player: from your message
feed_source_reply: from the story
feed_source_gm: by the GM
feed_source_play: on the plan
feed_tier_frame_core: You treat it as binding: carry it out as yourself; if you object, say so in the scene, then do it.
feed_tier_frame_companion: Weigh it in character: you may take it on or refuse, and say so in the scene.
feed_tier_frame_hired: It's part of the work you're paid for: get it done.
feed_tier_frame_ally: It's a favour asked of you: you may agree to it or not.
feed_fact_for: {{#you}}vote for{{/you}}{{^you}}votes for{{/you}}
feed_fact_against: {{#you}}vote against{{/you}}{{^you}}votes against{{/you}}
feed_fact_abstain: {{#you}}abstain{{/you}}{{^you}}abstains{{/you}}
feed_fact_approve: {{#you}}approve{{/you}}{{^you}}approves{{/you}}
feed_fact_deny: {{#you}}deny{{/you}}{{^you}}denies{{/you}}
feed_fact_withdraw: {{#you}}withdraw the request{{/you}}{{^you}}withdraws the request{{/you}}
feed_fact_vote: {{#you}}vote{{/you}}{{^you}}votes{{/you}}
feed_fact_answer: {{#you}}answer{{/you}}{{^you}}answers{{/you}}
org_motion_ended_passed: carried
org_motion_ended_failed: failed
org_motion_ended_withdrawn: was withdrawn
word_stage_current: up to date
word_stage_late: late
word_stage_30: 30 days past due
word_stage_60: 60 days past due
word_stage_90: 90 days past due
word_stage_120: 120 days past due
word_stage_collections: in collections
word_stage_charged_off: charged off
word_status_open: open
word_status_frozen: frozen
word_status_collections: in collections
word_status_charged_off: charged off
word_status_closed: closed
word_status_paid_off: paid off
word_status_matured: matured
word_credit_inquiry: a credit inquiry
word_credit_opened: a new account
word_credit_on_time: a payment on time
word_credit_late: a late payment
word_credit_collections: an account in collections
word_credit_charged_off: an account charged off
word_credit_closed: a closed account
word_credit_paid_off: an account paid off
word_credit_declined: a declined application
mind_how_authored: from the start
mind_how_witnessed: witnessed
mind_how_told: told
mind_how_inferred: inferred
mind_how_guessed: a guess
mind_belief_true: taken as true
mind_belief_false: taken as false
mind_belief_uncertain: unsure
word_basis_salary: a year
word_basis_hourly: an hour
word_basis_per_shift: a shift
word_basis_commission: commission
word_basis_tips: an hour in tips
word_basis_stipend: a period
word_card_frozen: Froze
word_card_active: Unfroze
word_card_lost: Reported lost
word_flow_paused: Paused
word_flow_ended: Cancelled
word_flow_active: Resumed
word_tier_core: core party
word_tier_companion: party companion
word_tier_hired: hired hand
word_tier_ally: party ally
word_whose_you: Your
word_whose: {{name}}'s
list_or: {{head}} or {{last}}
