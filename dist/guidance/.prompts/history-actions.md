---
description: The words of the actions the packs declare, as an agent reads them in the list of what a character can do and as a refusal names them, and as the palette shows them - an action's name, a line on what it does, and the name of each thing it asks for. Where an action names something the code knows (a level, a list of structures), the line has it in double braces. A line deleted reads the action by its id, and a thing it asks for by the kind it names. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it, and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely.
format: lines
keys:
  action_<action>_label: an action's name, as the palette and a refusal give it
  action_<action>_description: what an action does, in a line
  action_<action>_param_<param>: what an action's param asks for, by its name in the action's params
  param_*: what a param shared by several actions asks for (the organization, an organization it is done as, a vote, an approval, how long)
---
action_eat_label: Eat
action_eat_description: Have a meal or a snack.
action_sleep_label: Go to bed
action_sleep_description: Go to bed (your own, if you have one) and sleep until morning, or for as long as you say.
action_rest_label: Rest
action_rest_description: Rest or relax for a while.
action_get_up_label: Get up
action_get_up_description: Get up from bed or from a rest and get on with the day.
action_accept_invitation_label: Accept invitation
action_accept_invitation_description: Say yes to an invitation someone made you.
action_fight_label: Fight
action_fight_description: Start a fight with someone.
action_fight_param_target: Opponent
action_end_turn_label: End turn
action_end_turn_description: End your turn in a fight.
action_invoice_issue_label: Send an invoice
action_invoice_issue_description: Bill a customer from a business you run.
action_invoice_issue_param_customer: Bill (someone here)
action_invoice_issue_param_customer_name: Or bill (a name)
action_invoice_issue_param_memo: For
action_invoice_issue_param_days: Days to pay
action_invoice_pay_label: Pay an invoice
action_invoice_pay_description: Pay an invoice billed to you or to a business you run.
action_invoice_void_label: Void an invoice
action_invoice_void_description: Cancel an invoice that a business you run sent.
action_owner_draw_label: Take an owner's draw
action_owner_draw_description: Take money out of a business you own, for yourself.
action_distribute_profit_label: Distribute profit
action_distribute_profit_description: Pay a business's profit out to its owners, or a stated amount of a trust's money to its beneficiaries, by their shares.
action_distribute_profit_param_business: Business or trust
action_distribute_profit_param_amount: Amount (a business: else its share of the profit)
action_job_hire_label: Hire
action_job_hire_description: Hire someone, for yourself or for an organization you hire for (a business, a household, the party), with a title, pay and a position.
action_job_hire_param_business: Employer
action_job_hire_param_basis: Pay basis
action_job_hire_param_rate: Pay rate
action_job_hire_param_pay_every: Paid every
action_job_hire_param_position: Position (one the employer defines)
action_job_end_label: End a job
action_job_end_description: End a job: quit your own, or let someone go who works for you or an organization you let staff go for.
action_job_raise_label: Give a raise
action_job_raise_description: Change the pay of someone who works for you or an organization you set staff pay for.
action_job_raise_param_rate: New rate
action_job_hours_label: Change hours
action_job_hours_description: Change the hours a week someone works for you or an organization you set staff hours for.
action_job_hours_param_hours_per_week: Hours a week
action_job_leave_label: Put on leave
action_job_leave_description: Put someone who works for you or an organization you set staff leave for on leave: they keep the job and are paid nothing while it lasts.
action_job_return_label: Back from leave
action_job_return_description: Bring someone on leave back to work, paid again from their next payday.
action_job_position_label: Appoint to a position
action_job_position_description: Promote or move someone who works for you or an organization you appoint for into one of its positions, or take them out of theirs.
action_job_position_param_position: Position (one the employer defines; none to take them out of theirs)
action_job_title_label: Change title
action_job_title_description: Change the title a job goes by: your own, or that of someone who works for you or an organization you appoint for.
action_job_title_param_title: Title (none clears it)
action_org_pay_schedule_label: Change pay schedule
action_org_pay_schedule_description: Set how often an organization you set staff pay for pays its staff, moving every job there to it.
action_org_pay_schedule_param_org: Organization
action_org_pay_schedule_param_every: weekly, biweekly, semimonthly or monthly
action_org_pay_schedule_param_weekday: Payday weekday, weekly or biweekly (0 = Sunday)
action_org_pay_schedule_param_anchor: First payday, weekly or biweekly (YYYY-MM-DD)
action_donate_label: Donate
action_donate_description: Give money to an organization: a charity, a church, a club, a foundation. A person's gift to a charity, a church or a foundation is deductible from their income tax. An exempt organization (a foundation, a charity) may also grant money to a person.
action_donate_param_to: To
action_donate_param_method: Paid with (cash, card, debit or savings, or the card or account the input names, in its words)
action_trade_label: Buy or sell investments
action_trade_description: Buy or sell investments: stocks, funds, bonds, crypto.
action_trade_param_side: Buy or sell
action_trade_param_asset: Asset
action_trade_param_account: Held in
action_trade_param_qty: Units
action_trade_param_amount: Amount
action_trade_param_from: Pay from
action_trade_param_to: Proceeds to
action_trade_param_right: Call or put
action_trade_param_strike: Strike
action_trade_param_expiry: Expiry (YYYY-MM-DD)
action_buy_label: Buy
action_buy_description: Buy something: food, drinks, goods or a service, here or delivered.
action_buy_param_item: Item or category
action_buy_param_price: Stated price
action_buy_param_method: Paid with (cash, card, debit or savings, or the card or account the input names, in its words)
action_buy_param_cashback: Cash back
action_pay_label: Pay
action_pay_description: Give someone money: settle up, pay them back, tip them.
action_pay_param_method: Paid with (cash, card, debit or savings, or the card or account the input names, in its words); when the input doesn't say, as the purchase implies: cash into a jar, to a busker or at a counter, card online or by phone
action_move_money_label: Transfer between accounts
action_move_money_description: Move money between your own accounts: checking, savings, cash.
action_pay_card_label: Pay card or loan
action_pay_card_description: Pay off some or all of a card or loan balance.
action_withdraw_cash_label: Withdraw cash
action_withdraw_cash_description: Take cash out of a bank account.
action_deposit_cash_label: Deposit cash
action_deposit_cash_description: Put cash into a bank account.
action_card_freeze_label: Freeze card
action_card_freeze_description: Freeze a card so it can't be used.
action_card_unfreeze_label: Unfreeze card
action_card_unfreeze_description: Unfreeze a frozen card.
action_card_report_lost_label: Report card lost
action_card_report_lost_description: Report a card lost or stolen.
action_card_replace_label: Replace card
action_card_replace_description: Order a replacement card.
action_set_autopay_label: Set autopay
action_set_autopay_description: Set how a card or loan pays itself each month.
action_set_autopay_param_mode: none, minimum, statement, full or fixed
action_flow_create_label: Set up a standing payment
action_flow_create_description: Set up a standing payment: a bill, a regular transfer, an allowance.
action_flow_update_label: Change a standing payment
action_flow_update_description: Change a standing payment: its amount, its schedule or its accounts.
action_flow_pause_label: Pause a standing payment
action_flow_pause_description: Pause a standing payment.
action_flow_resume_label: Resume a standing payment
action_flow_resume_description: Resume a paused standing payment.
action_flow_delete_label: Cancel a standing payment
action_flow_delete_description: Cancel a standing payment.
action_apply_credit_label: Apply for credit
action_apply_credit_description: Apply for a credit card, a credit line or a loan.
action_apply_credit_param_product: Product
action_set_pay_prefs_label: Set how I pay
action_set_pay_prefs_description: Set the order in which you prefer to pay: cash, debit, credit.
action_set_pay_prefs_param_tiers: Ways to pay, in order: a JSON list of {use, min?, max?, categories?, except?}
action_shares_list_label: List on the market
action_shares_list_description: List a C corporation you control on the market, selling new units to the public, or offer more units once it is listed; the market pays for them into its account.
action_shares_list_param_business: Company
action_shares_list_param_units: Units to offer
action_shares_list_param_price: Price a unit (else its books a unit; listed, its market price)
action_shares_list_param_symbol: Ticker (else its initials)
action_shares_delist_label: Take it off the market
action_shares_delist_description: Take a listed company you control off the market, buying back every unit the public holds at its market price or more from its account.
action_shares_delist_param_business: Company
action_shares_delist_param_price: Price a unit (else its market price)
action_lend_money_label: Lend money
action_lend_money_description: Lend money to someone in the world (a company to its subsidiary, a person to a friend's business): a loan they repay with interest, monthly, by autopay.
action_lend_money_param_to: Lend to
action_lend_money_param_apr: Interest a year, %
action_lend_money_param_months: Over how many months
action_lend_money_param_from: From account
action_exercise_option_label: Exercise an option
action_exercise_option_description: Exercise an option contract you hold.
action_exercise_option_param_qty: Contracts
action_exercise_option_param_from: Pay the strike from
action_exercise_option_param_to: Strike to
action_project_start_label: Start a project
action_project_start_description: Start a production project for an organization: from one of the world's templates (a well, a foundry, a building, a farm season), or a planned one. Its steps run day by day and pay from its account; what it builds comes in as each is done.
action_project_start_param_org: Organization
action_project_start_param_template: Template
action_project_start_param_name: Name
action_project_start_param_account: Pay from
action_project_pause_label: Pause a project
action_project_pause_description: Pause a project under way: its steps stop where they are and keep the work they have left.
action_project_resume_label: Resume a project
action_project_resume_description: Set a paused project going again: each step under way finishes the work it had left.
action_project_drop_label: Drop a project
action_project_drop_description: Give up a project: nothing more is paid or done; what it paid stays paid and what it made stays.
action_property_buy_label: Buy a property
action_property_buy_description: Buy a property, outright or with a mortgage.
action_property_buy_param_price: Offer
action_property_buy_param_from: Pay from
action_property_buy_param_down: Down payment (the rest on a mortgage)
action_property_buy_param_term_months: Mortgage term, months (one a lender offers)
action_property_buy_param_live: Live there: their home from today, only when the input says they move in
action_property_sell_label: Sell a property
action_property_sell_description: Sell a property you own.
action_property_sell_param_price: Price
action_property_sell_param_buyer: Buyer
action_property_sell_param_to: Proceeds to
action_property_list_label: List a property for sale
action_property_list_description: Put a property you own up for sale at an asking price, or take it off the market.
action_property_list_param_price: Asking price (none takes it off the market)
action_lease_start_label: Let a unit
action_lease_start_description: Let a unit of a property you own to a tenant, for rent each month.
action_lease_start_param_tenant: Tenant
action_lease_start_param_rent: Rent a month
action_lease_start_param_months: Term, months
action_lease_start_param_day: Rent day
action_lease_start_param_unit: Unit
action_lease_end_label: End a lease
action_lease_end_description: End a tenant's lease.
action_lease_end_param_on: Last day (YYYY-MM-DD)
action_shares_issue_label: Issue shares
action_shares_issue_description: Issue new units of a company you control to a buyer, who pays for them into its account.
action_shares_issue_param_business: Company
action_shares_issue_param_to: To
action_shares_issue_param_units: Units
action_shares_issue_param_price: Price a unit (else its value a unit)
action_shares_issue_param_class: Class (its id)
action_shares_issue_param_from: Paid from (the buyer's account)
action_shares_buy_back_label: Buy back shares
action_shares_buy_back_description: Have a company you control buy back some of a holder's units, paying them from its account.
action_shares_buy_back_param_business: Company
action_shares_buy_back_param_from: From (the holder)
action_shares_buy_back_param_units: Units
action_shares_buy_back_param_price: Price a unit (else its value a unit)
action_shares_classes_label: Change share classes
action_shares_classes_param_label: Class
action_shares_classes_description: Add, change or remove a company's share class (the votes a unit carries), and move a holder's units into it.
action_shares_classes_param_business: Company
action_shares_classes_param_class: Its id (else from its name)
action_shares_classes_param_votes: Votes a unit
action_shares_classes_param_holder: Move this holder's units into it
action_shares_classes_param_remove: Remove it
action_stake_sell_label: Sell a share of a business
action_stake_sell_description: Sell part of your share of a business, in percent or, where it counts them, in units; to someone in the world, or a whole business to a buyer outside it.
action_stake_sell_param_share: Share, %
action_stake_sell_param_units: Units (where it counts them)
action_stake_sell_param_price: Price
action_stake_sell_param_buyer: Buyer
action_stake_sell_param_to: Proceeds to
action_tax_consolidate_label: File a consolidated return
action_tax_consolidate_description: Elect, or stop, for a C corporation you govern, to file one federal income tax return with the corporations it holds 80% or more of (by votes and by worth): their profits and losses offset, and it pays the group's tax.
action_tax_consolidate_param_org: The parent company
action_tax_consolidate_param_elect: yes to file one (the default), no to stop
action_org_dues_label: Set dues
action_org_dues_description: Set what each member pays into an organization's money, and how often; nothing ends them.
action_org_dues_param_amount: Each member pays
action_org_dues_param_every: week, month or year
action_org_dues_param_day: On the day (a weekday, 0 = Sunday; a day of the month, -1 the last)
action_org_share_out_label: Share out
action_org_share_out_description: Pay an amount from an organization's money to its members equally (the party's: its core members and companions).
action_org_share_out_param_from: From its account
action_route_distributions_label: Route dividends, rent or profits
action_route_distributions_description: Choose where dividends, rent or profits are paid: reinvested, or into an account.
action_route_distributions_param_to: To (an account, or reinvest)
action_consent_dividend_label: Declare a consent dividend
action_consent_dividend_description: For a C corporation you govern: its holders agree to count an amount as a dividend paid for the year, with no money moving, so the corporation keeps its cash but owes no tax on keeping its earnings (the accumulated earnings and personal holding company taxes). Each holder takes their part as income for that year and adds it to what their shares cost them.
action_consent_dividend_param_org: The corporation
action_consent_dividend_param_year: The tax year (this one, or last year's until its return on 15 April)
action_take_label: Take
action_take_description: Pick up something that is here.
action_lose_label: Lose something
action_lose_description: Something you own or carry is lost or gone, whereabouts unknown.
action_drop_label: Drop
action_drop_description: Put down something you carry, here.
action_search_label: Search
action_search_description: Search where you are, or look through a container, for what isn't in plain sight.
action_search_param_target: What to look through (none: around here)
action_give_label: Give
action_give_description: Give something you carry to someone here, for keeps.
action_hand_over_label: Hand over
action_hand_over_description: Hand something you carry to someone here to hold; it stays whose it is.
action_give_back_label: Give back
action_give_back_description: Give something back to whose it is, here.
action_fetch_label: Fetch
action_fetch_description: Go and get something of yours, or something you may use, from close by.
action_put_away_label: Put away
action_put_away_description: Put something back where it's kept.
action_put_in_label: Put in
action_put_in_description: Put something you carry, or that is here, into a bag, a box or a piece of furniture here.
action_put_in_param_into: Into
action_lend_label: Lend
action_lend_description: Lend something to someone, for some days or until a time.
action_lend_param_until: Until (a time: 7 pm, tonight, tomorrow)
action_reclaim_label: Take back
action_reclaim_description: Take back something of yours that you lent out.
action_set_apply_label: Change into
action_set_apply_description: Change into one of your saved outfits or loadouts.
action_set_apply_param_set: Outfit or loadout
action_set_save_label: Save what I'm wearing
action_set_save_description: Keep what you wear now as an outfit, or what you carry ready as a loadout.
action_set_save_param_name: Name
action_set_save_param_kind: Outfit or loadout
action_set_drop_label: Forget an outfit
action_set_drop_description: Stop keeping one of your saved outfits or loadouts.
action_set_drop_param_set: Outfit or loadout
action_wear_label: Wear or equip
action_wear_description: Put on or equip clothing, armor or gear.
action_remove_label: Take off
action_remove_description: Take off something you wear or have equipped.
action_use_label: Use
action_use_description: Use an item you carry or can reach.
action_take_piece_label: Take from a kit
action_take_piece_description: Take one piece, such as a tool or a part, out of a kit.
action_org_entry_label: Change entry
action_org_entry_description: Change who may enter one of an organization's places, and its keys.
action_org_entry_param_org: Organization
action_org_entry_param_place: Place
action_org_entry_param_entry: Who may enter
action_org_entry_param_keys: Keys
action_org_admit_label: Admit a member
action_org_admit_description: Admit someone to an organization, with a title or into a position.
action_org_admit_param_who: Whom
action_org_admit_param_title: Title
action_org_admit_param_position: Position (its id)
action_org_remove_label: Remove a member
action_org_remove_description: Remove someone from an organization.
action_org_remove_param_who: Whom
action_org_leave_label: Leave
action_org_leave_description: Leave an organization you're a member of.
action_org_appoint_label: Appoint
action_org_appoint_description: Appoint someone to a position in an organization, or take them out of theirs.
action_org_appoint_param_who: Whom
action_org_appoint_param_position: Position (its id; none takes them out of theirs)
action_org_title_label: Change title
action_org_title_description: Give someone in an organization a title of their own, or take it away.
action_org_title_param_who: Whom
action_org_title_param_title: Title (none clears it)
action_org_position_label: Set a position
action_org_position_description: Add, change or remove a position in an organization: its title, powers, seats, whom it reports to, its scope and limits.
action_org_position_param_title: Title
action_org_position_param_id: Id (else from the title)
action_org_position_param_powers: Powers (ids, comma separated)
action_org_position_param_seats: Seats (0 is any number)
action_org_position_param_reports_to: Reports to (a position's id)
action_org_position_param_no_report: Reports to no one
action_org_position_param_scope: Scope: org, or below
action_org_position_param_payment: Each payment at most
action_org_position_param_month: Each month at most
action_org_position_param_successor: Successor: next, vacant, or someone's id
action_org_position_param_default: New members join in it
action_org_position_param_remove: Remove it
action_org_delegate_label: Delegate
action_org_delegate_description: Let someone act for an organization with some of your powers there, within limits, until a date.
action_org_delegate_param_to: To
action_org_delegate_param_powers: Powers (ids, comma separated)
action_org_delegate_param_payment: Each payment at most
action_org_delegate_param_month: Each month at most
action_org_delegate_param_until: Until (YYYY-MM-DD)
action_org_revoke_label: Revoke
action_org_revoke_description: End someone's delegation to act for an organization.
action_org_revoke_param_to: Whose
action_org_rename_label: Rename
action_org_rename_description: Give an organization a new name.
action_org_rename_param_name: New name
action_org_goal_label: Set a goal
action_org_goal_description: Add a goal to an organization's plan, or change one.
action_org_goal_param_id: Goal (its id, to change one)
action_org_goal_param_text: The goal
action_org_goal_param_window: By when: today, or a date (YYYY-MM-DD)
action_org_goal_param_where: Where
action_org_order_label: Give an order
action_org_order_description: Give people in an organization a task on its plan, or change one: whom it is for, who leads, where and when.
action_org_order_param_id: Order (its id, to change one)
action_org_order_param_to: For (ids, comma separated)
action_org_order_param_lead: Who leads (an id)
action_org_order_param_text: The task
action_org_order_param_where: Where
action_org_order_param_when: When (YYYY-MM-DD HH:MM; none is a standing order)
action_org_order_param_goal: The goal it serves (its id)
action_org_plan_status_label: Move a plan along
action_org_plan_status_description: Mark a goal or an order on an organization's plan under way, done, blocked, refused or dropped, or open it again.
action_org_plan_status_param_id: Goal or order (its id)
action_org_plan_status_param_status: open, under_way, done, dropped, blocked or refused
action_org_plan_status_param_note: Note
action_org_approve_label: Approve
action_org_approve_description: Approve a request made for an organization over the limit of someone below you there (you granted their delegation, hold a position above theirs, or govern or own it), within your own limits: it is done now, as theirs.
action_org_approve_param_request: Request (its id)
action_org_deny_label: Deny
action_org_deny_description: Deny a request for approval made for an organization (your own request: withdraw it).
action_org_deny_param_request: Request (its id)
action_org_deny_param_why: Why
action_org_found_label: Start an organization
action_org_found_description: Found a company (from Money {{level}}: you its only owner, with capital from an account of yours, counted in units when you say how many; or, for an organization you govern, its subsidiary from its money), settle a trust (from Money {{level}}: its trustee and beneficiary you unless named, with what you put in), start a nonprofit (from Money {{level}}: no owners, you its Director, with what you give it), or a group of one of the world's kinds, which you lead. An organization you govern may settle a trust or start a nonprofit too.
action_org_found_param_type: company, trust, nonprofit or group
action_org_found_param_name: Its name
action_org_found_param_kind: A group's kind
action_org_found_param_amount: A company's capital; what goes into a trust or a nonprofit
action_org_found_param_from: Paid in from
action_org_found_param_units: A company's units (its shares counted in them)
action_org_found_param_trustee: A trust's trustee (else its settlor)
action_org_found_param_beneficiary: A trust's beneficiary (else its settlor)
action_org_found_param_revocable: A trust its settlor may take back
action_org_found_param_purpose: What a trust is for
action_org_found_param_until: The day a trust ends (YYYY-MM-DD)
action_org_found_param_as: Founding as: an organization you govern, only when the input starts a company, a trust or a nonprofit for it ("the shop starts a towing arm", "the company sets up a trust"); left out, it's yours
action_org_found_param_structure: A company's structure ({{structures}})
action_org_restructure_label: Change structure
action_org_restructure_description: Change a company's legal structure (a sole proprietorship, a partnership, an LLC, an S or a C corporation): draws and payouts change at once, its taxes from the next estimated-tax period.
action_org_restructure_param_org: Company
action_org_restructure_param_as: Deciding as: an organization you govern that holds the company's shares; left out, it's your own votes
action_org_restructure_param_structure: Structure ({{structures}})
action_org_vote_label: Vote
action_org_vote_description: Vote on a motion open at an organization: for, against, or abstain; as an organization holder whose shares you manage, with `as`.
action_org_vote_param_motion: Motion (its id)
action_org_vote_param_vote: for, against or abstain
action_org_vote_param_as: Voting as: an organization whose shares you manage that holds a vote; left out, your own vote
action_org_motion_end_label: Withdraw a motion
action_org_motion_end_description: Withdraw a motion you put to a vote, while it is open.
action_org_motion_end_param_motion: Motion (its id)
action_org_decisions_label: How decisions are made
action_org_decisions_description: Set how an organization's motions count their votes (shares or members), their quorum and pass mark in percent, how many days a motion stays open and a request for approval waits.
action_org_decisions_param_vote_by: Votes counted by: shares, members, or default
action_org_decisions_param_quorum: Quorum (% of the votes that must take part)
action_org_decisions_param_pass: Passes with more than (% of the votes cast)
action_org_decisions_param_days: A motion stays open (days)
action_org_decisions_param_approval_days: A request for approval waits (days)
action_org_vote_rule_label: Standing vote
action_org_vote_rule_description: Set how you vote on an organization's motions when you don't vote yourself: for, against, abstain, with another voter, or none.
action_org_vote_rule_param_vote: for, against, abstain, with, or none
action_org_vote_rule_param_with: Whose vote it follows
action_party_tier_label: Party tier
action_party_tier_description: Add someone you know to your party in a tier ({{tiers}}), change their tier, or take them out of the party ({{out}}).
action_party_tier_param_tier: {{tiers}} or {{out}}
action_party_name_label: Name the party
action_party_name_description: Give your party a name.
action_party_name_param_name: Its name
action_party_purse_label: Start a purse
action_party_purse_description: Open an account your party owns, with a deposit from an account of your own.
action_party_purse_param_amount: Your deposit
action_party_purse_param_from: From
action_party_hire_label: Hire a hand
action_party_hire_description: Hire someone for your party, paid from its purse; they join it as a hired hand.
action_party_hire_param_basis: Pay basis
action_party_hire_param_rate: Pay rate
action_party_hire_param_pay_every: Paid every
action_org_wind_up_label: Wind up a company
action_org_wind_up_description: Close a company down (from Money 3), all at once or in stages: begin (it stops trading: its staff go, its standing payments end), sell what you choose as the company, then finish (its debts paid, its holdings sold, its real estate and stakes handed to its owners by share or sold, the rest of its cash paid out to them by share, its accounts closed, it dissolved); or resume trading. Stage: {{stages}}.
action_org_wind_up_param_org: Company
action_org_wind_up_param_property: Its real estate and stakes: distribute (to its owners by share) or sell
action_org_wind_up_param_to: Its things and vehicles go to (else its largest owner)
action_org_wind_up_param_stage: Stage ({{stages}}); left out, all at once
action_org_merge_label: Merge companies
action_org_merge_description: Fold one company into another (from Money 3): its holders get the other's units at a ratio (by their values unless you say) and any cash it pays, and its accounts, property, staff and positions move over; or, kept, the other takes all of it as its subsidiary. You decide for both, with more than half the votes of each (yours, or an organization's you govern).
action_org_merge_param_org: The company merging in (or taken over)
action_org_merge_param_into: The company it merges into (or that takes it over)
action_org_merge_param_ratio: Units of the second for each unit of the first (else by their values)
action_org_merge_param_cash: Cash to the first's holders, in all
action_org_merge_param_from: Cash from (the second's account)
action_org_merge_param_keep: Keep it as a subsidiary instead of folding it in
action_chat_with_label: Chat with
action_chat_with_description: Spend a while talking with someone here.
action_give_gift_label: Give a gift
action_give_gift_description: Give someone here a present.
action_attempt_label: Attempt
action_attempt_description: Try something hard that one of your stats decides: climb, force, persuade, notice.
action_attempt_param_stat: Stat
action_attempt_param_difficulty: Difficulty (easy, moderate, hard, very hard or a number)
action_answer_label: Answer
action_answer_description: Give your answer to a puzzle: a riddle, a code, a combination.
action_answer_param_puzzle: Puzzle
action_answer_param_decision: Judged probability
action_drive_label: Drive
action_drive_description: Drive, ride, sail or fly a vehicle you own or may use to another place.
action_drive_param_to: Destination
action_refuel_label: Refuel
action_refuel_description: Fill up a vehicle's tank, or charge it.
action_service_vehicle_label: Service
action_service_vehicle_description: Have a vehicle serviced: an oil change, a tune-up.
action_repair_vehicle_label: Repair
action_repair_vehicle_description: Have a damaged or broken-down vehicle repaired.
action_try_label: {{skill}} check
action_go_label: Go to
action_go_description: Go to another place: a room, a building, a street, another part of town.
action_go_param_to: Place
action_go_param_with: Who comes along
action_step_label: Move on the map
action_step_description: Walk to a square of the grid you stand on.
param_giving_as: Giving as: an organization you may spend for, only when the input gives from its money; left out, you give
param_trading_as: Trading as: an organization whose money you manage, only when the input trades for it ("the trust's portfolio"); left out, it's yours
param_deciding_as: Deciding as: an organization whose shares you manage, only when the input decides for a company it holds shares in; left out, it's your own votes
param_lending_as: Lending as: an organization you may spend for, only when the input lends its money; left out, you lend
param_option_as: As: an organization whose money you manage, only when the input exercises its option; left out, it's yours
param_selling_as: Selling as: an organization whose shares you manage, only when the input sells its stake ("the trust's share of the shop"); left out, it's yours
param_routing_as: As: an organization whose money or property you manage, only when the input routes what it is paid; left out, it's yours
param_property_trading_as: As: an organization whose property you buy and sell, only when the input does it for it ("buy the lot for the company"); left out, it's yours
param_property_managing_as: As: an organization whose property you manage, only when the input does it for it ("let the trust's flat"); left out, it's yours
param_paying_as: Paying as: an organization you may spend for, only when the input pays for it or from its account ("on the shop's account", "for the household"); left out, you pay
param_managing_as: As: an organization whose accounts you manage, only when the input does this for it ("the shop's card", "the household's savings"); left out, they're yours
param_borrowing_as: Borrowing as: an organization you may borrow for, only when the input borrows in its name ("a loan for the shop"); left out, it's yours
param_stated_minutes: How long, in minutes, when the player says
param_vote: Put it to a vote when your votes aren't enough
param_ask: Ask for approval when it's over your limit
param_project: Project
param_org: Organization
param_plan_org: Organization (its id)
param_flow_to: To (an account, someone, or a payee's name)
param_flow_every: Every (day, week, month, year or once)
action_how_many: How many
action_with_names: with {{names}}
action_from_place: from {{place}}
action_check_label: Check
action_check_description: Roll a skill or an ability for someone, against a difficulty or against another's roll. It takes names, not numbers: who rolls, the skill or ability, and the difficulty (one of the ruleset's by name, or a number the story sets) or whom they roll against. The total is read from the sheet (ranks, ability, class skill, armour, size, traits, conditions and effects), and the roll is recorded with where each part came from. To rule it without dice, give the outcome success or failure.
action_check_param_skill: Skill or ability (by name)
action_check_param_difficulty: Difficulty (one of the ruleset's by name, or a number the story sets)
action_check_param_vs: Against (someone who rolls against it)
action_check_param_vs_skill: Their skill (left out: the same)
action_check_param_take: Take 10 or 20 in place of the roll, where the ruleset has such a number to take
action_check_param_aid: Helped by (each rolls the same check, and the ruleset says what a helper adds)
action_check_param_mods: A circumstance the sheet does not have (a number, its type and why: +2 circumstance: high ground)
action_check_param_boost: Spend a point on the roll (an action point, where the ruleset has them): its dice are added
action_save_label: Save
action_save_description: Roll a save for someone, and for others who make the same one. It takes who saves, which save and the difficulty (one of the ruleset's by name, or a number the effect sets), and reads the total from the sheet, with the ruleset's rule for the natural die. Each roll is recorded with where its parts came from. To rule it without dice, give the outcome success or failure.
action_save_param_save: Which save (by name)
action_save_param_difficulty: Difficulty (one of the ruleset's by name, or a number the effect sets)
action_save_param_also: Others who make the same save
action_save_param_mods: A circumstance the sheet does not have (a number, its type and why)
action_save_param_boost: Spend a point on the roll (an action point, where the ruleset has them): its dice are added
action_attack_label: Attack
action_attack_description: Attack someone with a weapon or one of one's own attacks. It takes who attacks, the target and, unless it is what is readied, what with. It reads the rest: the weapon's row, the attack total, the target's defence (flat-footed until it has acted in a fight), the range from the grid, the natural die's rule, a threat and its confirming roll, the damage with its multiplier, the target's reduction and resistances, and the round spent from the magazine. The hit points and the states they leave the target in are then set. It is recorded as one attack, and into the fight under way. To rule it without dice, give the outcome hit, miss or critical: the damage of a hit is rolled all the same.
action_attack_param_target: Target
action_attack_param_with: With (a weapon held or carried, one of its own attacks, or a weapon of the ruleset; left out: what is readied)
action_attack_param_full: Every attack the base attack gives
action_attack_param_touch: Against touch defence
action_attack_param_held: Held (as the ruleset names it, such as one, two or off; left out: as the weapon's row has it)
action_attack_param_shots: Shots (as the ruleset names them, such as single, double, burst or auto)
action_attack_param_nonlethal: Nonlethal
action_attack_param_concealment: Concealment (the miss chance in percent)
action_attack_param_distance: How far apart they stand, in the world's units, where no map gives it
action_attack_param_mods: A circumstance the sheet does not have (a number, its type, what it changes and why: +4 cover to ac: behind the wall)
action_attack_param_boost: Spend a point on the first attack's roll (an action point, where the ruleset has them): its dice are added
action_harm_label: Harm
action_harm_description: Take hit points off someone, off several, or off everyone in an area, for harm no weapon gives: a fall, a fire, a trap, a ruling. It takes who is harmed (or a centre and a radius on the grid), the harm as dice or as a number the story gives, its type, and a save with its difficulty for half or none. It reads each one's saving total, reduction and resistance to the type, and the states the hit points leave them in. Each is recorded with its own harm.
action_harm_param_amount: Amount (dice such as 2d6, or a number the story gives)
action_harm_param_type: Type of harm (what a reduction or a resistance is read against)
action_harm_param_nonlethal: Nonlethal
action_harm_param_targets: Who else is harmed (left out: the one named)
action_harm_param_centre: Centre of an area (everyone within the radius on the grid is harmed)
action_harm_param_radius: Radius of the area
action_harm_param_save: Save (each one rolls it)
action_harm_param_difficulty: Difficulty of the save (one of the ruleset's by name, or a number the harm sets)
action_harm_param_half: A save that is made halves it (left out: it takes none)
action_harm_param_why: Why
action_heal_label: Heal
action_heal_description: Give back hit points, take off nonlethal harm, give temporary hit points, or make someone who is dying stable. It takes who, the amount as dice or as a number the story gives, and which of these; hit points are held to the most the sheet gives, and the states that no longer hold are taken off. Recorded with what changed.
action_heal_param_amount: Amount (dice such as 1d8, or a number the story gives)
action_heal_param_nonlethal: Only nonlethal harm
action_heal_param_temporary: As temporary hit points
action_heal_param_stabilize: Stabilize
action_heal_param_why: Why
action_condition_label: Condition
action_condition_description: Put a condition of the ruleset on someone, or take it off. It takes who, the condition by name, and how long: rounds (the one's own turns in a fight), minutes or hours, or until a save is made (which save, and its difficulty); with no length it lasts until it is taken off. What the condition changes comes from the ruleset's table, so no modifier is handed in. Recorded on the sheet.
action_condition_param_condition: Condition (by name)
action_condition_param_off: Take it off
action_condition_param_rounds: Rounds (the one's own turns in a fight)
action_condition_param_minutes: Minutes
action_condition_param_hours: Hours
action_condition_param_save: Save that ends it (each time it is tried)
action_condition_param_difficulty: Difficulty of that save (one of the ruleset's by name, or a number the condition sets)
action_condition_param_why: Why
action_effect_label: Effect
action_effect_description: Put a passing effect on someone, or take it off by its label: what a spell, a thing or a ruling gives for a while, where the ruleset has no condition for it. It takes who, a label, how long (as a condition does), and the effect's modifiers, each a number, its type, what it changes and why. Those numbers are the effect's own, since no sheet has them; the sheet counts them with the rest by the ruleset's rule for stacking. Recorded on the sheet.
action_effect_param_label: Label
action_effect_param_mods: Modifiers (each a number, its type, what it changes and why: +2 morale to attack: a rousing song)
action_effect_param_off: Take it off
action_effect_param_rounds: Rounds (the one's own turns in a fight)
action_effect_param_minutes: Minutes
action_effect_param_hours: Hours
action_effect_param_save: Save that ends it (each time it is tried)
action_effect_param_difficulty: Difficulty of that save (one of the ruleset's by name, or a number the effect sets)
action_effect_param_why: Why
action_d20_rest_label: Rest the night
action_d20_rest_description: Rest for the night. It takes who (and others who rest with them) and the hours, left out: the ruleset's night; the hours are told in the answer, and the clock is moved by pass_time. What comes back is the ruleset's, read from each sheet: hit points by level, nonlethal harm by the hour, and each daily gauge filled. Recorded for each.
action_d20_rest_param_hours: Hours (left out: the ruleset's night)
action_d20_rest_param_also: Others who rest
action_reload_label: Reload
action_reload_description: Fill a weapon's magazine from the rounds carried. It takes who and the weapon (left out: what is readied), and moves as many rounds as the magazine holds and as are carried, reading both from the sheet and the gear. The rounds loaded are recorded.
action_reload_param_item: Weapon (left out: what is readied)
action_award_label: Award experience
action_award_description: Give experience, and say who has reached a level they have not yet taken. It takes who (and others who share it) and either the experience the story gives or who was overcome, whom the ruleset's own table prices and shares out, so that no sum is worked out by hand. Recorded for each.
action_award_param_xp: Experience the story gives (left out: for who was overcome)
action_award_param_overcame: Who was overcome (the ruleset's table gives what each is worth)
action_award_param_also: Others who share it
action_award_param_why: Why
action_advance_label: Take a level
action_advance_description: Take a level in a class. It takes who and the class by name, and reads the rest from the ruleset: the level's hit points (rolled, the average or the most, as the ruleset has it), the skill points, and whether the level gives a feat or an ability point, which it says are open to be placed; the class features the level gives are named. Recorded.
action_advance_param_class: Class (by name)
action_advance_param_hp: Hit points (left out: the ruleset's way; or roll, average, most, or a number the story gives)
action_trait_label: Trait
action_trait_description: Give someone a feat, a race or a feature of the ruleset, or take it away. It takes who, the trait by name, and what it is taken for where it is taken for something (a weapon, a skill). What it changes comes from its row, so no modifier is handed in; what it requires is read from the sheet and told, and a trait whose requirement does not hold is given all the same.
action_trait_param_trait: Trait (by name)
action_trait_param_choice: Taken for (a weapon, a skill)
action_trait_param_off: Take it away
action_trait_param_why: Why
action_ranks_label: Skill ranks
action_ranks_description: Set someone's ranks in a skill. It takes who, the skill and the ranks they have in all, and tells the most the skill takes at their level and the skill points left, both read from the sheet; ranks past the most are set all the same, and told.
action_ranks_param_skill: Skill (by name)
action_ranks_param_ranks: Ranks in all
action_stat_as_label: Sheet from the bestiary
action_stat_as_description: Give someone the sheet of one of the ruleset's creatures or ordinary people: its values, its attacks and its challenge rating. It takes who and the row by name, and reads every value from the row, so none is handed in. Recorded; a level, a trait or ranks can be added to it after.
action_stat_as_param_creature: Creature (by name)
