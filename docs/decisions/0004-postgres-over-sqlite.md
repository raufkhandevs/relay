# 0004. Postgres over the Laravel 13 SQLite default

Date: 2026-09-11
Status: accepted

## Context

Laravel 13 ships with SQLite as the default database for a new application.
This project runs entirely on one machine and will not be deployed, so SQLite is a genuinely
reasonable default here.

## Options

**A. Postgres in Docker.**
Matches the standing default for every project.
Real enum types, real concurrent writes, `jsonb`, full text search, and behaviour that matches what
a deployed application would do.
Cost: Docker must be running, and it is one more moving part in development.

**B. SQLite, the framework default.**
Zero setup, a file on disk, fast tests, and nothing to run.
Cost: a single writer lock, which a queue worker plus a Reverb process plus a web request will
contend on; weaker type affinity, so enum and date columns do not behave as they would in
production; and no migration path that is exercised rather than assumed.

**C. MySQL.**
Also production realistic and very common in Laravel contracts.
Cost: no advantage over Postgres here, and it is the weaker database on the things this project
touches.

## Decision

Option A, Postgres in Docker.

The deciding factor is concurrency.
This application runs a web process, a queue worker and a websocket server simultaneously, all
writing.
SQLite's single-writer model turns that into lock contention that does not exist in any deployed
Laravel application, which would mean debugging a class of problem that is an artefact of the
development setup rather than of the code.

Given the project exists to teach production practice, using the database a production system
would use costs one `docker compose up -d` and removes a category of misleading behaviour.

## Consequences

- Docker must be running before `composer dev`.
  This goes in the project run skill so it is not a thing to remember.
- Tests run against Postgres too, not SQLite, so that enum and timestamp behaviour under test
  matches runtime.
  Test suites are slower than they would be against an in-memory SQLite database, which is
  accepted.

## What would change my mind

If test suite wall-clock time becomes an actual obstacle, running unit tests against SQLite while
keeping feature tests on Postgres is a reasonable split.
Not worth the divergence until the slowness is real and measured.
