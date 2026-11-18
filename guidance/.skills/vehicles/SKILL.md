---
name: vehicles
description: Cars, carts, boats and anything else people ride in. How to record who is aboard and who drives, where it is left, what a journey takes, and a vehicle bought, damaged or taken. Load it when someone boards, drives, parks or acquires one.
---
# Keeping the vehicles

A vehicle is a thing like any other, with the same four facts (where it is, who has it, whose it is, who may use it), and two more: who is aboard, and who is driving.

## Boarding and leaving

- Someone gets in: `world_apply` with `store`, the person into the vehicle. Say who takes the driver's place.
- Someone gets out: `place`, the person at the place where the vehicle stands.
- What is loaded aboard is stored in it like anything put in a container, and travels with it.

A vehicle that moves takes everyone and everything aboard with it. Move the vehicle, not each passenger.

## A journey

1. Find the way and how long it takes: the world's places are joined by paths, each with its travel mode and time. Search for the route tool with `tool_search` ("route").
2. Drive it with `vehicles_drive` (found with `tool_search`): the vehicle, where it arrives, who drives and who rides. It burns the fuel, parks the vehicle there and brings its driver and riders with it, so do not also `move` the vehicle or anyone aboard.
3. Pass the time the journey took (the skill `time` says what to do with what that brings due). The drive does not pass it.
4. If the journey was the scene (a chase, a breakdown, a talk on the road), the vehicle is the place: put people in their seats and keep the road outside as where it is.

## Where it is left

A parked car is at a place, and stays there. When the story comes back to it, look where it was left before you write anyone walking to it. A vehicle has a home like any thing: where it is kept when not in use.

## Whose it is, and who may drive it

Lending the keys is permission to use, not a change of owner. Taking it without leave changes who has it and nothing else. Record what the story did, with `give`, said as lent, taken or sold.

## Getting one

A vehicle is bought like anything costly: one `pay` operation that names it as the goods, so that the money and the vehicle change hands together. A vehicle nothing recorded goes by is `spawn`ed first, with its source, earlier in the same call. The world lists its classes of vehicle and what each costs (`vehicles_classes`, found with `tool_search`); look before you name a price. Its make, colour and plate are part of what it is: give them when it is made, from the story where the story said.

## Harm

Damage, wear, repair and fuel are the vehicle's condition. Change it with the condition tools (find them with `tool_search`), and say what did it. Refuelling, a repair and a service are also actions of the engine's (`refuel`, `repair_vehicle`, `service_vehicle`), carried out with the `world_apply` operation `act`; each gives its own minutes, which you pass with `pass_time`.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a driver who is not aboard, a vehicle in two places, a journey with no way between its ends. `SIMULATION.md` says what to do with a report.
