# 0009. One design system, two densities

Date: 2026-09-12
Status: accepted

## Context

Three clients now read the same data: an Inertia web client, an Expo iOS app and an Electron
desktop console. Each was built to prove a slice worked, so each wears whatever its starter kit
gave it. The web client still shows the Laravel starter kit's chrome. They look like three
products that happen to share a database.

They also share a problem that is not cosmetic: none of them can reply. Every client reads. Only
curl writes.

## The thing the design has to solve

Relay has two audiences whose needs point in opposite directions.

An **agent** lives in the queue for a whole shift and is scanning for what needs attention next.
For them, density is kindness: more rows on screen, status readable without reading, ids visible
because they get quoted on calls.

A **customer** opens Relay twice, is mildly annoyed that something is broken, and wants to know a
human saw it. For them, space is reassurance: fewer elements, status stated in words, and empty
states that say what happens next rather than "no data".

Designing one layout for both produces something that is cramped for the customer and wasteful for
the agent.

## Options

**A. One design system expressed at two densities.**
Shared palette, type scale and components. The agent console runs them compact; the customer
surfaces run them roomy. The same status device appears in both, sized differently.
Cost: the system has to be defined once and honoured in three codebases that cannot import from
each other, so it lives as a written spec rather than a package.

**B. Three separate designs, each native to its platform.**
Each client looks like it belongs on its platform and owes nothing to the others.
Cost: they stop reading as one product, which is the thing this project exists to demonstrate. It
also triples the design decisions.

**C. One design, identical everywhere.**
Simplest to state and to check.
Cost: the agent gets a customer's spacing and fits four tickets on screen, or the customer gets an
agent's density and a support ticket feels like a spreadsheet.

## Decision

Option A.

The asymmetry between the two audiences is real, so the design should answer it rather than
average it away. What stays constant is the palette, the type, and the way status is expressed.
What varies is spacing, row height and how much is said in words rather than codes.

**Palette.** Cool neutrals with a petrol accent, and semantic status colours kept separate from
the accent so "this needs attention" never competes with "this is a link".

```
ink      #131A24   ground   #F7F8FA   surface  #FFFFFF   rule  #DFE4EC
accent   #1D6F8B
open     #B45309   pending  #5B6676   resolved #15803D   closed #8A8F98
```

**Type.** IBM Plex Sans throughout, IBM Plex Mono for ticket ids and timestamps. One family with a
utility companion. Using the same face on all three clients is what makes them read as one product
despite three toolchains.

**Status is a 3px left edge on the ticket, not a pill.** In a dense queue you read a column of
edges in one downward glance; a column of pills makes you read each row. The same edge appears on
the customer surfaces at a larger scale. This is the recurring device that ties the three clients
together, and it is the only place the design spends boldness.

## Consequences

- The tokens are written here and duplicated in three codebases. They cannot be imported across
  repo boundaries, so they are duplicated deliberately and this record is the source of truth.
- The Laravel starter kit's chrome is removed rather than themed. Unused auth screens go with it.
- Deliberately avoided, because they are the current house style of generated interfaces and would
  undercut the point: uppercase tracked labels above headings, meta strings joined with middle
  dots, one border radius and one grey shadow on every block regardless of hierarchy.
- Border, fill, radius and shadow are spent by role. Not everything is a card.

## Dark palette

Added after the light one shipped. An agent watching a queue for a whole shift is exactly the user
who wants this, so it was recorded as owed rather than dropped.

```
ink      #E6EAF0   ground   #0E1319   surface  #161D26   rule  #242E3A
accent   #4FA8C4
open     #E0A159   pending  #8A96A6   resolved #5CC489   closed #6C7887
```

It is not an inversion, and that distinction is the whole of the work.

- **The ground is lifted off black.** `#0E1319`, not `#000`. A pure black ground makes every
  surface above it read as a glowing panel, and on OLED it smears during scroll.
- **Surfaces rise rather than darken.** In light mode `surface` is brighter than `ground`; in dark
  it is brighter too. Elevation is expressed the same way in both, so the same component hierarchy
  survives the switch.
- **Text is not pure white.** `#E6EAF0` against a dark ground. Full white haloes, and reading a
  queue for eight hours is exactly the case where that matters.
- **The accent moves rather than staying put.** `#1D6F8B` is legible on white and nearly invisible
  on `#161D26`, so dark gets `#4FA8C4`: the same hue, lifted until it carries. A palette that keeps
  one accent across both themes has picked a colour that is mediocre on each.
- **Status colours lift too**, for the same reason. `#15803D` green disappears on a dark ground;
  `#5CC489` reads.

**Selection follows the operating system.** No in-app toggle. Someone who wants dark has already
said so once at the OS level, and a per-app switch asks them to say it again in every app they own.
The earlier toggle was removed because it did nothing; reintroducing one that works would still be
answering a question the OS already answered.

## What would change my mind

A fourth client with a genuinely different job, or a real design system package shared across
repos. Either would make the written spec the wrong container.
