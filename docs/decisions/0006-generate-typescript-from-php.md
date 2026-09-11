# 0006. Generate TypeScript types from PHP

Date: 2026-09-11
Status: accepted

## Context

One PHP API serves three TypeScript clients: the Inertia web app, the React Native app and the
Electron app.
Response shapes are defined in PHP and consumed in TypeScript, so the same contract exists in four
places.

The standing preference is one source of truth with generated types on both sides.
Adding a dependency is an escalation, so this was raised rather than decided unilaterally.

## Options

**A. `spatie/laravel-data` plus `spatie/typescript-transformer`.**
Each API response is a PHP data object.
An artisan command emits TypeScript interfaces that all three clients import.
Two Composer dependencies, both from Spatie, both widely used and maintained.
Cost: a generation step in the workflow, and data objects are a slightly heavier way to describe a
response than an array.

**B. Hand-written TypeScript interfaces in each client.**
Zero dependencies, zero build step, and adequate at this size.
Cost: nothing detects drift.
Change a PHP response shape and three clients silently disagree with it until something fails at
runtime, on a device, probably during a demo.
With three consumers rather than one, the probability of that is high rather than theoretical.

**C. An OpenAPI document as the intermediate layer.**
Laravel emits OpenAPI, clients generate types from it.
Also produces live API documentation and a contract other teams could consume.
Cost: more moving parts and a heavier generation step than three first-party clients justify.

## Decision

Option A.

Three consumers is the third use case, which is the standing threshold for accepting an
abstraction rather than duplicating.
This is not speculative: the clients exist, and they are written in a different language from the
API.

Option A also survives the repository split cleanly.
If the three applications become three repositories, each runs the generate command against the
API rather than depending on a shared local package.

## Consequences

- API responses are PHP data objects rather than arrays or Eloquent resources.
  This is a convention the whole backend follows, not a per-endpoint choice.
- Generated types are committed so that a client can be built without running the backend.
  A CI check that regeneration produces no diff would catch drift; worth adding once there is CI.
- Two new Composer dependencies, recorded here as the escalation they are.

## What would change my mind

Dropping to a single client would make option B correct again, and the generation step would be
removed rather than kept out of habit.
