---
description: The sentences of an organization's own History and of what an act for an organization records beside its effects - admitting, removing, appointing, delegating, renaming, a vote or a request and its end, founding, restructuring, winding up, merging, entry and keys, hiring, pay, a party's changes, a plan and the orders given, and who takes a seat. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  title_*: the title of a position the engine makes (the Director of a founded organization, the Leader of a party, the Head a lint adds)
  seat_succeeds: someone succeeds another in a seat - who, was, title
  seat_taken: someone takes a seat - who, title
  seat_incident: the player's group has a new holder of a seat - who (absent where the player may not know them), title, org
  org_log_*: what an organization's own History says it did (admitting, removing, appointing, delegating, renaming, a vote or a request and its end, founding, restructuring, winding up, merging, entry and keys, hiring, pay, a party's changes) and the phrases those fill in, and what an act for an organization records beside its effects (a payment, a sale, a loan, a project's step, a property's let or sale); each is filled with what it names
  org_entry_*, org_trespass: a place's entry or keys changing as the History records it, and someone entering a place without leave - place, what, name
  org_request_*, org_the_gm: a request for approval as asked, approved, denied or withdrawn - by, approver, org, text, why, who - and the GM as the one who answered
  org_motion_*, org_vote, org_abstain: a motion put to a vote, a vote or an abstention, and how a motion ended - by, org, text, closes, who, you (true where the voter is the player), vote, ended, why
  org_config_*: an organization setting following the world's again, off or on in this chat - key
  org_spent, org_op_let: what an act records beside its effects, money spent for an organization and a power let to someone - who, amount, org; by, to, powers, limits, until
  plan_*: a plan's goals and orders as the History records them (a goal, an order, a plan's status, an order due by its day as laid) - text, id, status
  reason_*: why a power, an account or a position is refused, and how a vote ended - name, power, account, target, title, at, counted, cast, quorum
---
seat_succeeds: {{who}} succeeds {{was}} as {{title}}
seat_taken: {{who}} takes the seat of {{title}}
seat_incident: {{#who}}{{who}}{{/who}}{{^who}}Someone{{/who}} now holds {{title}} for {{org}}.
plan_goal: Plan: {{text}}
plan_order: Order: {{text}}
plan_status: Plan: {{id}} {{status}}
plan_due_day: Plan: {{id}} should be done by the day as laid
org_entry_audience: {{place}}: {{what}}
org_entry_world: {{place}}: entry as the world has it
org_entry_keys: {{place}}: keys changed
org_trespass: {{#name}}{{name}}{{/name}}{{^name}}Someone{{/name}} entered {{#place}}{{place}}{{/place}}{{^place}}a place{{/place}} without leave
org_request_bare: A request for approval
org_request_asked: {{by}} asked {{approver}} to approve, for {{org}}: {{text}} ({{why}}).
org_request_approved: {{who}} approved{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_request_denied: {{who}} denied{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_request_withdrew: {{who}} withdrew{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_the_gm: The GM
org_motion_bare: A motion
org_motion_put: {{by}} put to a vote at {{org}}: {{text}}. It closes {{closes}}.
org_vote: {{who}} {{#you}}vote{{/you}}{{^you}}votes{{/you}} {{vote}}{{#text}}: {{text}}{{/text}}.
org_abstain: {{who}} {{#you}}abstain{{/you}}{{^you}}abstains{{/you}}{{#text}}: {{text}}{{/text}}.
org_motion_end: At {{org}}, the motion {{ended}}{{#why}} ({{why}}){{/why}}{{#text}}: {{text}}{{/text}}.
org_motion_closed: closed
org_config_world: Orgs: {{key}} follows the world's setting
org_config_off: Orgs: {{key}} off in this chat
org_config_on: Orgs: {{key}} on in this chat
org_spent: {{who}} spent {{amount}} for {{org}}
org_log_currency_a_payment: {{currency}} a payment
org_log_currency_a_month: {{currency}} a month
org_log_admitted_who_as_as: Admitted {{who}}{{#if_as}} as {{as}}{{/if_as}}
org_log_removed_who: Removed {{who}}
org_log_who_left: {{who}} left
org_log_appointed_who_title: Appointed {{who}} {{title}}
org_log_who_no_longer_holds_left: {{who}} no longer holds {{left}}
org_log_who_goes_by_words: {{who}} goes by {{words}}
org_log_who_no_longer_has_a_title_of: {{who}} no longer has a title of their own
org_log_removed_the_position_title: Removed the position {{title}}
org_log_changedadded_the_position_title: {{#if_before}}Changed{{/if_before}}{{^if_before}}Added{{/if_before}} the position {{title}}
org_log_until_until: , until {{until}}
org_log_let_to_powers_limits_when: Let {{to}} {{powers}}{{limits}}{{when}}
org_log_to_no_longer_acts_for_it: {{to}} no longer acts for it
org_log_renamed_from_was_to_name: Renamed from {{was}} to {{name}}
org_log_its_their_own_request: it's their own request
org_log_its_more_than_they_may_do_themselves: it's more than they may do themselves for {{org}}
org_log_they_arent_above_r_at_org: they aren't above {{r}} at {{org}}
org_log_the_gm: the GM
org_log_ask_asked_first_to_approve_text_why: {{ask}} asked {{first}} to approve: {{text}} ({{why}})
org_log_r_withdrew_the_request_text: {{r}} withdrew the request: {{text}}
org_log_who_the_gm_denied_r_s_request: {{#if_who}}{{who}}{{/if_who}}{{^if_who}}The GM{{/if_who}} denied {{r}}'s request: {{text}}{{#if_why}}: {{why}}{{/if_why}}
org_log_what_needs_payroll_and_books_in_play: {{what}} needs payroll and books in play (Money {{cOMPANY_LEVEL}})
org_log_starting_a_company: Starting a company
org_log_settling_a_trust: Settling a trust
org_log_starting_a_nonprofit: Starting a nonprofit
org_log_of_yours: of yours
org_log_of_founder_s: of {{founder}}'s
org_log_capital_into_name: Capital into {{name}}
org_log_founder_founded_name_with_money: {{founder}} founded {{name}} with {{money}}.
org_log_started_name_its_subsidiary_with_money: Started {{name}}, its subsidiary, with {{money}}.
org_log_money_for_it: money for it
org_log_into_name: Into {{name}}
org_log_with_currency:  with {{currency}}
org_log_founder_settled_name_into_revocably: {{founder}} settled {{name}}{{into}}{{#if_revocable}}, revocably{{/if_revocable}}.
org_log_settled_name_a_trust_into: Settled {{name}}, a trust{{into}}.
org_log_a_gift: a gift
org_log_gift_to_name: Gift to {{name}}
org_log_founder_founded_name_a_nonprofit_into_as: {{founder}} founded {{name}}, a nonprofit{{into}}, as its Director.
org_log_started_name_a_nonprofit_into_as_its: Started {{name}}, a nonprofit{{into}}, as its Director.
org_log_by_founded_name_a_label_and_leads: {{by}} founded {{name}}, a {{label}}, and leads it.
org_log_changing_the_structure_of: Changing the structure of
org_log_make_org_structure: Make {{org}} {{structure}}
org_log_became_structure_taxed_as_one_from_from: Became {{structure}}{{#if_from}}, taxed as one from {{from}}{{/if_from}}
org_log_carried_by_vote_why_text: Carried by vote ({{why}}): {{text}}
org_log_withdrew_the_motion_text: Withdrew the motion: {{text}}
org_log_the_motion_failed_why_text: The motion failed ({{why}}): {{text}}
org_log_couldnt_be_carried_out_reason: couldn't be carried out: {{reason}}
org_log_o_for_party: {{o}} for {{party}}
org_log_the_gm_2: The GM
org_log_who_put_to_a_vote_text_it: {{who}} put to a vote: {{text}} (it closes {{closes}})
org_log_votes_counted_by_basis: votes counted by {{basis}}
org_log_votes_counted_as_its_type_counts_them: votes counted as its type counts them
org_log_a_quorum_of_n: a quorum of {{n}}
org_log_the_default_quorum: the default quorum
org_log_passing_with_more_than_n: passing with more than {{n}}
org_log_the_default_pass_mark: the default pass mark
org_log_motions_open_n_days: motions open {{n}} days
org_log_motions_open_the_default_time: motions open the default time
org_log_requests_waiting_n_days: requests waiting {{n}} days
org_log_requests_waiting_the_default_time: requests waiting the default time
org_log_set_how_decisions_are_made_words: Set how decisions are made: {{words}}
org_log_who_no_longer_has_a_standing_vote: {{who}} no longer has a standing vote
org_log_who_votes_with_follows: {{who}} votes with {{follows}}
org_log_who_votes_abstain_as_a_rule: {{who}} votes {{abstain}} as a rule
org_log_ana_noun: {{#if_noun}}an{{/if_noun}}{{^if_noun}}a{{/if_noun}} {{noun}}
org_log_only_the_partys_leader_may_do_that: Only the party's leader may do that
org_log_by_took_name_out_of_the_party: {{by}} took {{name}} out of the party.
org_log_by_added_name_to_the_party_as: {{by}} added {{name}} to the party as {{tier}}.
org_log_by_made_name_tier_of_the_party: {{by}} made {{name}} {{tier}} of the party.
org_log_first_s_party: {{first}}'s party
org_log_by_named_the_party_name: {{by}} named the party {{name}}.
org_log_party_purse: Party purse
org_log_into_id_s_purse: Into {{id}}'s purse
org_log_by_started_the_partys_purse_with_currency: {{by}} started the party's purse with {{currency}}.
org_log_by_hired_worker_as_a_hand: {{by}} hired {{worker}} as a hand.
org_log_last_seen_at_place: last seen at {{place}}
org_log_the_party_has_a_purse: The party has a purse
org_log_a_purse_needs_money_in_play_money: A purse needs money in play (Money 2)
org_log_start_a_purse_first_the_party_pays: Start a purse first: the party pays its hands from it
org_log_hiring_needs_jobs_in_play_money_3: Hiring needs jobs in play (Money 3)
org_log_start_a_purse_first: Start a purse first
org_log_share_out_pays_core_members_and_companions: Share out pays core members and companions, and the party has none
org_log_only_the_partys_leader_shares_out_its: Only the party's leader shares out its money
org_log_wind_up_name: Wind up {{name}}
org_log_begin_winding_up_name: Begin winding up {{name}}
org_log_finish_winding_up_name: Finish winding up {{name}}
org_log_stop_winding_up_name: Stop winding up {{name}}
org_log_resuming: Resuming
org_log_winding_up: Winding up
org_log_stopped_winding_up_it_trades_again: Stopped winding up: it trades again
org_log_dissolved: Dissolved
org_log_name_began_winding_upwound_up_and_dissolved: {{name}}: {{#if_begin}}began winding up{{/if_begin}}{{^if_begin}}wound up and dissolved{{/if_begin}}
org_log_intoname_takes_over_name_as_its_subsidiary: {{intoName}} takes over {{name}} as its subsidiary
org_log_merge_name_into_intoname: Merge {{name}} into {{intoName}}
org_log_selling_the_whole_of: Selling the whole of
org_log_merging: Merging
org_log_taking_over_a_company_for: Taking over a company for
org_log_merging_into: Merging into
org_log_became_intoname_s_subsidiary: Became {{intoName}}'s subsidiary
org_log_merged_into_intoname_and_dissolved: Merged into {{intoName}}, and dissolved
org_log_name_became_intoname_s_subsidiarymerged_into_intoname: {{name}} {{#if_keep}}became {{intoName}}'s subsidiary{{/if_keep}}{{^if_keep}}merged into {{intoName}}{{/if_keep}}
org_log_a_key: a key
org_log_customers_while_it_trades_staff_only_after: Customers while it trades; staff only after hours
org_log_anyone: Anyone
org_log_daywords_all_day_open_to_close: {{dayWords}}, {{#if_close}}all day{{/if_close}}{{^if_close}}{{open}} to {{close}}{{/if_close}}
org_log_who_may_enter_as_the_world_has: who may enter as the world has it
org_log_who_may_enter_entry: who may enter: {{entry}}
org_log_its_keys_as_the_world_has_them: its keys as the world has them
org_log_no_keys: no keys
org_log_keys_pov: keys: {{pov}}
org_log_a_place: a place
org_log_a_place_2: A place
org_log_actor_set_where_said: {{#if_actor}}{{actor}} set {{/if_actor}}{{where}}: {{said}}
org_log_you: You
org_log_open_to_customers_now: Open to customers now
org_log_open_to_anyone_now: Open to anyone now
org_log_closed_now: {{closed}} now
org_log_someone: Someone
org_log_who_did_though_who_may_not_power: {{who}} {{did}}, though {{who}} may not {{power}} for {{org}}.
org_log_who_no_longer_holds_a_position: {{who}} no longer holds a position
org_log_let_name_act_for_org: let {{name}} act for {{org}}
org_log_let_name_lacking: let {{name}} {{lacking}}
org_log_hired_who_as_title: Hired {{who}}{{#if_title}} as {{title}}{{/if_title}}
org_log_let_worker_go: Let {{worker}} go
org_log_set_worker_s_pay_to_rate: Set {{worker}}'s pay to {{rate}}
org_log_set_dues_of_cents_a_every: Set dues of {{cents}} a {{every}}
org_log_ended_dues: Ended dues
org_log_no_longer_exempt_from_income_tax: No longer exempt from income tax
org_log_exempt_from_income_tax_as_status: Exempt from income tax as {{status}}
org_log_elected_to_file_one_consolidated_return: Elected to file one consolidated return
org_log_stopped_filing_a_consolidated_return: Stopped filing a consolidated return
org_log_lent_cents_to_name: Lent {{cents}} to {{name}}
org_log_admitted_who_to_org: admitted {{who}} to {{org}}
org_log_removed_who_from_org: removed {{who}} from {{org}}
org_log_appointed_who_title_2: appointed {{who}} {{title}}
org_log_gave_who_the_title_title: gave {{who}} the title {{title}}
org_log_hired_who: hired {{who}}
org_log_let_who_go: let {{who}} go
org_log_who_quit: {{who}} quit
org_log_changed_who_s_pay: Changed {{who}}'s pay
org_log_changed_who_s_pay_2: changed {{who}}'s pay
org_log_put_who_on_leave: Put {{who}} on leave
org_log_who_came_back_from_leave: {{who}} came back from leave
org_log_put_who_on_leave_2: put {{who}} on leave
org_log_brought_who_back_from_leave: brought {{who}} back from leave
org_log_sent_customer_an_invoice_for_cents: Sent {{customer}} an invoice for {{cents}}
org_log_paid_business_s_invoice_for_left: Paid {{business}}'s invoice for {{left}}
org_log_voided_the_invoice_to_customer_for_cents: Voided the invoice to {{customer}} for {{cents}}
org_log_paid_total_out_to_its_beneficiaries: Paid {{total}} out to its beneficiaries
org_log_paid_total_of_profit_out_to_its: Paid {{total}} of profit out to its owners
org_log_hired_worker_as_as: Hired {{worker}}{{#if_as}} as {{as}}{{/if_as}}
org_log_set_worker_s_pay_to_rate_basis: Set {{worker}}'s pay to {{rate}} {{basis}}
org_log_set_worker_s_hours_to_hours_a: Set {{worker}}'s hours to {{hours}} a week
org_log_changed_the_pay_schedule_to_every: Changed the pay schedule to {{every}}
org_log_grantedgave_to_cents: {{#if_grant}}Granted{{/if_grant}}{{^if_grant}}Gave{{/if_grant}} {{to}} {{cents}}
org_log_soldbought_what_for_amount: {{#if_sell}}Sold{{/if_sell}}{{^if_sell}}Bought{{/if_sell}} {{what}}{{#if_amount}} for {{amount}}{{/if_amount}}
org_log_bought_what_for_paid: Bought {{what}}{{#if_paid}} for {{paid}}{{/if_paid}}
org_log_paid_partyof_cents: Paid {{partyOf}} {{cents}}
org_log_payment: Payment
org_log_moved_cents_from_from_to_to: Moved {{cents}} from {{from}} to {{to}}
org_log_transfer: Transfer
org_log_paid_cents_toward_card: Paid {{cents}} toward {{card}}
org_log_took_cents_out_of_account: Took {{cents}} out of {{account}}
org_log_put_cents_into_account: Put {{cents}} into {{account}}
org_log_a_changed_card: {{#a}}{{a}}{{/a}}{{^a}}Changed{{/a}} {{card}}
org_log_ordered_a_replacement_for_card: Ordered a replacement for {{card}}
org_log_set_account_s_autopay_to_none: Set {{account}}'s autopay to {{none}}
org_log_set_up_a_standing_payment_label: Set up a standing payment{{#if_label}}: {{label}}{{/if_label}}
org_log_changed_the_standing_payment_flow: Changed the standing payment {{flow}}
org_log_status_resumed_the_standing_payment_flow: {{#status}}{{status}}{{/status}}{{^status}}Resumed{{/status}} the standing payment {{flow}}
org_log_applied_for_product_credit_of_cents: Applied for {{#product}}{{product}}{{/product}}{{^product}}credit{{/product}}{{#if_number}} of {{cents}}{{/if_number}}
org_log_borrowed_money_from_lendername: Borrowed {{money}} from {{lenderName}}
org_log_lent_money_to_borrowername: Lent {{money}} to {{borrowerName}}
org_log_exercised_holding: Exercised {{holding}}
org_log_started_name: Started {{name}}
org_log_paused_name: Paused {{name}}
org_log_resumed_name: Resumed {{name}}
org_log_dropped_name_why: Dropped {{name}}{{#if_why}}: {{why}}{{/if_why}}
org_log_sold_property_to_buyer_for_price: Sold {{property}}{{#if_buyer}} to {{buyer}}{{/if_buyer}} for {{price}}
org_log_let_unitname_property_to_tenant_for_rent: Let {{#if_unitName}}{{unitName}}, {{/if_unitName}}{{property}} to {{tenant}} for {{rent}} a month
org_log_ended_lease: Ended {{lease}}
org_log_put_property_up_for_sale_at_price: Put {{property}} up for sale at {{price}}
org_log_took_property_off_the_market: Took {{property}} off the market
org_log_soldgave_what_of_business_to_buyer_for: {{#if_price}}Sold{{/if_price}}{{^if_price}}Gave{{/if_price}} {{what}} of {{business}}{{#if_buyer}} to {{buyer}}{{/if_buyer}}{{#if_price}} for {{price}}{{/if_price}}
org_log_shared_out_cents_org: Shared out {{cents}}{{org}}
org_log_sent_from_s_what_where: Sent {{from}}'s {{what}} {{where}}
org_log_issuing_shares_in: Issuing shares in
org_log_issue_units_units_of_name_to_to: Issue {{units}} units of {{name}} to {{to}}{{#if_number}} at {{price}} a unit{{/if_number}}{{^if_number}} at their value a unit{{/if_number}}
org_log_units_units_of_name_at_each_a: {{units}} units of {{name}} at {{each}} a unit
org_log_issued_units_units_to_to_at_each: Issued {{units}} units to {{to}} at {{each}} a unit ({{cents}})
org_log_buying_back_shares_in: Buying back shares in
org_log_buy_back_units_units_of_name_from: Buy back {{units}} units of {{name}} from {{holder}}{{#if_number}} at {{price}} a unit{{/if_number}}{{^if_number}} at their value a unit{{/if_number}}
org_log_name_bought_back_units_units_at_each: {{name}} bought back {{units}} units at {{each}} a unit
org_log_bought_back_units_of_holder_s_units: Bought back {{units}} of {{holder}}'s units at {{each}} a unit ({{cents}})
org_log_changing_the_share_classes_of: Changing the share classes of
org_log_removeset_the_share_class_class_of_name: {{#if_remove}}Remove{{/if_remove}}{{^if_remove}}Set{{/if_remove}} the share class {{class}} of {{name}}{{#if_number}} ({{votes}} votes a unit){{/if_number}}{{#if_holder}}, with {{holder}}'s units in it{{/if_holder}}
org_log_removed_the_share_class_id: Removed the share class {{id}}
org_log_changedadded_the_share_class_id_votes_votes: {{#if_was}}Changed{{/if_was}}{{^if_was}}Added{{/if_was}} the share class {{id}} ({{votes}} votes a unit){{#if_holder}}, with {{holder}}'s units in it{{/if_holder}}
org_log_business_decides_about_its_shares_from_money: {{business}} decides about its shares from Money 3
org_log_deciding_about_the_shares_of: Deciding about the shares of
org_log_business_is_wound_up_or_merged_from: {{business}} is wound up or merged from Money 3
org_log_name_goes_on_a_market_from_money: {{name}} goes on a market from Money 3
org_log_only_a_c_corporation_lists_on_a: Only a C corporation lists on a market: change {{name}}'s structure first
org_log_offer_units_more_units_of_name_list: {{#if_listing}}Offer {{units}} more units of {{name}}{{/if_listing}}{{^if_listing}}List {{units}} units of {{name}}{{/if_listing}} on the market{{#if_number}} at {{price}} a unit{{/if_number}}
org_log_units_new_units_of_name_sold_on: {{units}} new units of {{name}} sold on the market at {{each}} a unit
org_log_offered_units_more_units_on_the_market: Offered {{units}} more units on the market at {{each}} a unit ({{cents}})
org_log_listed_units_units_on_the_market_as: Listed {{units}} units on the market as {{symbol}} at {{each}} a unit ({{cents}})
org_log_delisting: Delisting
org_log_take_name_off_the_market_buying_back: Take {{name}} off the market{{#if_number}}, buying back its public units at {{price}} a unit{{/if_number}}
org_log_symbol_bought_out_at_each_a_unit: {{symbol}} bought out at {{each}} a unit
org_log_name_went_off_the_market_bought_back: {{name}} went off the market: bought back {{float}} public units at {{each}} a unit
org_log_went_off_the_market_bought_back_float: Went off the market: bought back {{float}} public units at {{each}} a unit ({{total}})
org_log_sold_units_units_of_name_on_the: Sold {{units}} units of {{name}} on the market at {{price}} a unit
org_log_name_isnt_on_a_market: {{name}} isn't on a market
org_log_you_hold_no_units_of_name_on: You hold no units of {{name}} on its cap table
org_log_name_keeps_an_owner_on_its_cap: {{name}} keeps an owner on its cap table: sell to someone in the world, or take it off the market
org_log_investments_arent_followed_at_this_money_level: Investments aren't followed at this money level
org_log_sales_tax_it_collected: Sales tax it collected
org_log_its_suppliers: Its suppliers
org_log_a_holding: A holding
org_log_sold_at_the_market: sold at the market
org_log_a_property: A property
org_log_sold_at_its_value: sold at its value
org_log_to_its_owners_by_share: to its owners by share
org_log_to_no_one: to no one
org_log_to_who: to {{who}}
org_log_one_of_its_owners: one of its owners
org_log_a_stake_in_another_company: A stake in another company
org_log_bizname_gathered_for_winding_up: {{bizName}}: gathered for winding up
org_log_wrote_off_an_invoice_owedcount_invoices_owed: Wrote off {{#if_owed}}an invoice{{/if_owed}}{{^if_owed}}{{owedCount}} invoices{{/if_owed}} owed it ({{cents}})
org_log_handed_its_share_of_id_to_its: Handed its share of {{id}} to its owners
org_log_handed_its_stake_in_id_to_its: Handed its stake in {{id}} to its owners
org_log_gave_things_thingscount_things_to_recipient: Gave {{#if_things}}{{things}}{{/if_things}}{{^if_things}}{{thingsCount}} things{{/if_things}} to {{recipient}}
org_log_bizname_wound_up_a_share_of_what: {{bizName}} wound up: a share of what was left
org_log_paid_party_cents_share_of_what_was: Paid {{party}} {{cents}} ({{share}}%) of what was left
org_log_for_a_share_of_name: For a share of {{name}}
org_log_ratio_of_its_units_for_each_of: {{ratio}} of its units for each of theirs ({{issued}} in all)
org_log_took_over_name_as_its_subsidiary_its: Took over {{name}} as its subsidiary{{#if_deal}}: its holders got {{deal}}{{/if_deal}}
org_log_staff_staffcount_staff_came_over_from_name: {{#if_staff}}{{staff}}{{/if_staff}}{{^if_staff}}{{staffCount}} staff{{/if_staff}} came over from {{name}}
org_log_a_company: a company
org_log_a_trust_that_isnt_a_grantor_trust: a trust that isn't a grantor trust and has beneficiaries other than people
org_log_an_organization_whose_status_cant_hold_one: an organization whose status can't hold one
org_log_h_is_what_and_an_s_corporations: {{h}} is {{what}}, and an S corporation's shareholders are people, eligible trusts and charities (501(c)(3) organizations)
org_log_it_would_have_allcount_shareholders_and_an: it would have {{allCount}} shareholders, and an S corporation has at most {{max}}
org_log_only_a_c_corporation_paying_business_taxes: Only a C corporation paying business taxes files a consolidated return
org_log_one_of_its_holders_cant_hold_an: One of its holders can't hold an S corporation's shares
org_log_elected_to_file_one_consolidated_return_with: Elected to file one consolidated return{{#if_members}} with {{members}}{{/if_members}}
org_log_corporate_income_tax_consolidated_return: Corporate income tax, consolidated return
org_log_corporate_income_tax: Corporate income tax
org_log_estimated_tax: Estimated tax
org_log_tax_saved_by_year_donations: Tax saved by {{year}} donations
org_log_futa_return_form_940_for_periods: FUTA return (Form 940) for {{periods}}
org_log_futa_deposit: FUTA deposit
org_log_state_unemployment_tax_suta: State unemployment tax (SUTA)
org_log_declared_a_consent_dividend_of_cents_for: Declared a consent dividend of {{cents}} for {{year}}: no money moves, and each holder takes their part as income
org_log_foundation_taxes_for_year_cents_fall_due: Foundation taxes for {{year}}, {{cents}}, fall due on 15 May: {{excise}} on its investment income{{#if_tax}} and {{tax}} on {{undistributed}} of {{year2}}'s payout it never granted{{/if_tax}}.
org_log_grant_leftoflast_more_by_31_dec_year: Grant {{leftOfLast}} more by 31 Dec {{year}} to meet {{year2}}'s payout, or 30% of what's left is due with the next return.
org_log_tax_on_year_investment_income: Tax on {{year}} investment income
org_log_refund_of_year_investment_tax: Refund of {{year}} investment tax
org_log_exempt_from_income_tax_as_status_code: Exempt from income tax as {{status}}{{#if_code}} ({{code}}){{/if_code}}
org_log_put_themselves_worker_on_its_payroll: put {{#if_worker}}themselves{{/if_worker}}{{^if_worker}}{{worker}}{{/if_worker}} on its payroll
org_log_set_their_own_worker_s_pay: set {{#if_worker}}their own{{/if_worker}}{{^if_worker}}{{worker}}'s{{/if_worker}} pay
org_log_shown_runs_business_for_others_so_cant: {{shown}} runs {{business}} for others, so can't {{what}}
org_log_shown_runs_business_for_others_so_cant_2: {{shown}} runs {{business}} for others, so can't pay {{worker}} into {{reached}}, which {{shown}} may spend
org_log_title_reaches_only_the_positions_below_it: {{title}} reaches only the positions below it at {{name}}, not every job there
org_log_into_isnt_below_title_at_name: {{into}} isn't below {{title}} at {{name}}
org_log_title_hires_and_appoints_only_into_the: {{title}} hires and appoints only into the positions below it at {{name}}
org_log_by_cant_end_that_job: {{by}} can't end that job
org_log_who_s_job_no_longer_has_a: {{who}}'s job no longer has a title of its own
org_log_sold_a_share_share_of_name_for: Sold {{#if_share}}a {{share}}% share of {{/if_share}}{{name}} for {{price}}
org_log_name_name2_is_waiting_for_cents_to: {{name}}: {{name2}} is waiting for {{cents}} to {{#if_end}}finish{{/if_end}}{{^if_end}}start{{/if_end}}
title_director: Director
title_leader: Leader
title_head: Head
reason_name_you_may_not_powerwords: {{name}}: you may not {{power}}
reason_account_isn_t_one_of_the: {{account}} isn't one of the accounts you may use for {{name}}
reason_target_isn_t_below_title_at: {{target}} isn't below {{title}} at {{at}}
reason_name_s_money_pays_for_name2: {{name}}'s money pays for {{name}}, not for {{target}}
reason_the_trustees_of_name_decide_together: The trustees of {{name}} decide together: another trustee approves this
reason_carried_counted: carried: {{counted}}
reason_voted_down_counted: voted down: {{counted}}
reason_no_quorum_cast_took_part_quorum: no quorum: {{cast}} took part, {{quorum}} needed
plan_status_text: {{status}}: {{text}}
org_op_let: {{by}} let {{to}} {{powers}}{{#limits}}, up to {{limits}}{{/limits}}{{#until}}, until {{until}}{{/until}}
