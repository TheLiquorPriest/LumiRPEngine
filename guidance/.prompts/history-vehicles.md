---
description: The sentences of the narrator's vehicles section and of a vehicle's record - where it stands, whose it is and who may use it, its state and fuel, its service, who drives it and who is aboard, what it carries, and its specs. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  trip_*: a way to a place by a vehicle as the travel options give it - its name (drive, sail or fly the vehicle to a place), why it is offered greyed (broken down, not enough fuel) and what each leg of it takes the minutes for (reaching it, getting going, driving, parking, walking the rest)
  vehicle_service_due: a vehicle is due for service - name
  vehicle_line: one vehicle in the narrator's section - name, parts
  vehicle_someone: no one the player may know
  vehicle_at: where it stands - place
  vehicle_at_unknown: where it stands, when nowhere is known
  vehicle_somewhere: where it stands, when the place is out of the player's sight
  vehicle_yours: it is the player's
  vehicle_of: it is someone's - owner
  vehicle_staff: it is someone's and the player uses it at work - owner
  vehicle_permit: it is someone's and the player may use it - owner
  vehicle_lent: it is lent to the player - owner, until
  vehicle_assigned: it is assigned to the player - owner
  vehicle_owner_unknown: whose it is, when the player knows no owner
  vehicle_owner_none: whose it is, when it has no owner
  vehicle_away: it is not at the player's site
  vehicle_broken: its state at the lowest level of detail, broken down
  vehicle_runs: its state at the lowest level of detail, running
  vehicle_fuel: its fuel - pct, range (absent where none)
  vehicle_service_overdue: its service is overdue - due, unit
  vehicle_service_next: its next service - due, unit
  vehicle_driven_by: who drives it - who, or you
  vehicle_you: the player, among those aboard
  vehicle_specs: its first specs - specs, more
  vehicle_holding: a thing and what it holds - name, inner
  vehicle_aboard: who is aboard - who
  vehicle_cargo: what is in it - what
---
vehicle_service_due: {{name}} is due for service.
vehicle_line: {{name}}: {{parts}}.
vehicle_someone: someone
vehicle_at: at {{place}}
vehicle_at_unknown: at an unknown place
vehicle_somewhere: somewhere
vehicle_yours: yours
vehicle_of: {{owner}}'s
vehicle_staff: {{owner}}'s, yours to use at work
vehicle_permit: {{owner}}'s, yours to use
vehicle_lent: {{#owner}}{{owner}}'s, {{/owner}}lent to you until {{until}}
vehicle_assigned: {{#owner}}{{owner}}'s, {{/owner}}assigned to you
vehicle_owner_unknown: no one's you know of
vehicle_owner_none: no one's
vehicle_away: away from here
vehicle_broken: broken down
vehicle_runs: runs fine
vehicle_fuel: fuel {{pct}}%{{#range}}, about {{range}} left{{/range}}
vehicle_service_overdue: service overdue (it was due at {{due}} {{unit}})
vehicle_service_next: next service due at {{due}} {{unit}}
vehicle_driven_by: driven by {{#you}}you{{/you}}{{^you}}{{who}}{{/you}}
vehicle_you: you
vehicle_specs: specs {{specs}}{{#more}}, and {{more}} more{{/more}}
vehicle_holding: {{name}} (holding {{inner}})
vehicle_aboard: Aboard: {{who}}.
vehicle_cargo: Cargo: {{what}}.
trip_the_vehicle: the {{name}}
trip_drive: Drive {{vehicle}} to {{place}}
trip_sail: Sail {{vehicle}} to {{place}}
trip_fly: Fly {{vehicle}} to {{place}}
trip_broken_down: broken down
trip_not_enough_fuel: not enough fuel
trip_fetch_at_home: to reach it at home
trip_fetch_at: to reach it at {{place}}
trip_start: to get going
trip_driving: driving
trip_sailing: sailing
trip_flying: flying
trip_park: to park
trip_park_water: to tie up
trip_park_air: to land and tie down
trip_on_foot_from: on foot from {{place}}
