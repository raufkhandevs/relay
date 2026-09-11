# 0005. Denormalise `last_message_at` onto tickets

Date: 2026-09-11
Status: accepted

## Context

The agent queue is the most frequently loaded view in the product, and it sorts tickets by most
recent activity.
"Most recent activity" is the timestamp of the newest message on the ticket, which lives in a
different table.

## Options

**A. A `last_message_at` column on `tickets`, updated when a message is created.**
The queue becomes `order by last_message_at desc` against an indexed column.
Cost: the same fact exists in two places, and they can drift.

**B. Derive it at read time.**
A subquery or a join against `max(messages.created_at)` grouped by ticket.
Always correct, no duplication, nothing to keep in sync.
Cost: the sort cannot use an index on the tickets table, so the database aggregates the messages
table on every queue load.
Fine at fifty tickets, not fine at fifty thousand, and it degrades exactly where the application
is hottest.

**C. Cache the ordered queue in Redis.**
Fast reads without touching the schema.
Cost: a second system holding the same truth with its own invalidation rules, which is a harder
version of the drift problem in A plus an extra dependency.
The standing rule is to cache at one layer and know which one; adding a cache to avoid a column is
the wrong layer.

## Decision

Option A.

Reads outnumber writes here by a wide margin: a queue is refreshed constantly and a message is
written occasionally.
Paying a cheap write to make the dominant read indexable is the correct trade.

The drift risk is contained by having exactly one writer.
A `MessageObserver` updates `last_message_at` on create, and nothing else touches it.
If a second writer ever appears, this decision needs revisiting.

This is a deliberate denormalisation, not an oversight.
Recording it here is the point: the next person to read the schema will otherwise see two sources
of truth for one fact and reasonably assume it was a mistake.

## Consequences

- `MessageObserver` is the single writer.
  A test asserts that creating a message updates the parent ticket.
- A backfill is needed if messages are ever created outside the model, for instance by a raw
  insert in a seeder.
  Seeders go through the model for this reason.
- An index on `tickets (last_message_at desc)` is required for the column to be worth having.

## What would change my mind

A second code path needing to write messages without going through Eloquent, for example a bulk
import.
At that point either the observer logic moves into the database as a trigger, or the column is
dropped in favour of option B with an accepted read cost.
