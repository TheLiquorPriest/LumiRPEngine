---
description: The single words and phrases the other lines are filled with, and the joiners of a list - a delinquency stage, an account's status, an entry on a credit report, a pay basis, what was done to a card or a standing payment, a party tier, how a holding is held and believed, whose a line is, an organization's type, a role, how a thing is worn, a season's mood, where a fact came from, how a party tier is treated, what a vote or an answer says, and how a motion ended. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  word_power_*, word_entry_*, word_plan_status_*, word_structure_*, word_project_status_*, word_cost_when_*, word_need_*, word_need_name_*, word_need_met_by_*, word_vote_*, word_how_*: the word a table gives for an id - what a power lets its holder do (as "you may ..." finishes it), who may enter a place, a plan's status, a company's structure, a project's status, when a step is paid for, a need (the word it is told in, its name, what meets it), a vote, how someone belongs to an organization
  word_penalty_*: the tax named in a penalty tax's memo (word_penalty_phc, word_penalty_aet)
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
word_penalty_phc: Personal holding company tax
word_penalty_aet: Accumulated earnings tax
word_power_members_admit: admit members
word_power_members_remove: remove members
word_power_members_appoint: appoint people to positions and give titles
word_power_staff_hire: hire staff
word_power_staff_fire: let staff go
word_power_staff_pay: set staff pay, hours, schedules and leave
word_power_money_view: see its money
word_power_money_spend: spend its money
word_power_money_manage: manage its accounts, standing payments, autopay and cards
word_power_money_invoice: send and void its invoices
word_power_money_payout: pay out its profit
word_power_money_borrow: borrow in its name
word_power_assets_use: use its things
word_power_assets_assign: lend and assign its things
word_power_assets_dispose: sell, give away or use up its things
word_power_property_manage: manage its property: leases, rent, entry and keys
word_power_property_trade: buy and sell its property
word_power_shares_manage: issue, buy back and register its shares
word_power_org_govern: set its positions, rules and structure
word_power_orders_give: give orders
word_power_delegate: delegate its powers
word_entry_owner: Owner only
word_entry_members: Members only
word_entry_staff: Staff only
word_entry_customers: Customers
word_entry_public: Anyone
word_plan_status_open: Open
word_plan_status_under_way: Under way
word_plan_status_done: Done
word_plan_status_dropped: Dropped
word_plan_status_blocked: Blocked
word_plan_status_refused: Refused
word_structure_sole_proprietorship: a sole proprietorship
word_structure_partnership: a partnership
word_structure_llc: an LLC
word_structure_s_corp: an S corporation
word_structure_c_corp: a C corporation
word_structure_nonprofit: a nonprofit
word_project_status_planned: Not started
word_project_status_active: Under way
word_project_status_paused: Paused
word_project_status_done: Done
word_project_status_dropped: Dropped
word_cost_when_start: paid as it starts
word_cost_when_end: paid when it's done
word_cost_when_split: half as it starts, half when it's done
word_need_hunger: hungry
word_need_fatigue: tired
word_need_social: lonely
word_need_fun: bored
word_need_name_hunger: Hunger
word_need_name_fatigue: Fatigue
word_need_name_social: Social
word_need_name_fun: Fun
word_need_met_by_hunger: eating
word_need_met_by_fatigue: sleep, a night's or a nap
word_need_met_by_social: a chat, or time with someone you know
word_need_met_by_fun: rest, leisure, exercise or a night out
word_vote_for: for
word_vote_against: against
word_vote_abstain: abstains
word_how_member: Member
word_how_owner: Owner
word_how_staff: Staff
word_how_leader: Leader
word_how_core: Core
word_how_companion: Companion
word_how_hired: Hired
word_how_ally: Ally
word_season_summer: summer
word_season_winter: winter
word_them: them
word_it: it
word_outside_market: Shops
word_outside_world: World
word_outside_insurer: Insurer
word_outside_registrar: Vehicle registration
word_outside_tax_federal: Federal tax
word_outside_tax_state: State tax
word_outside_tax_local: Local tax
word_outside_insurance_property: Property insurance
word_outside_upkeep_property: Property upkeep
word_regional_tax_sales: Sales tax
word_regional_tax_property: Property tax
word_outside_named_bank: Bank
word_outside_named_atm: Cash machine
word_outside_named_employer: Employer
word_outside_kind_buyer: Buyer
word_outside_kind_seller: Seller
word_outside_kind_market: Market
word_outside_kind_tenant: Outside tenant
word_outside_kind_closing: Closing
word_plan: Plan
word_op_found: found an organization
word_op_issue_shares: issue shares
word_op_buy_back_shares: buy back shares
word_op_list_a_company: list a company on a market
word_op_take_a_company_off: take a company off a market
word_op_wind_up: wind up a company
word_op_merge: merge companies
word_op_change_exempt: change a tax-exempt status
word_op_consolidate: file a consolidated return
word_op_run_projects: run production projects
word_op_lend_money: lend money
