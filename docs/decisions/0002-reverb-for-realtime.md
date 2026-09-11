# 0002. Laravel Reverb for realtime

Date: 2026-09-11
Status: accepted

## Context

Live chat is required on all three clients.
Laravel broadcasts events to a websocket server; the question is which one, and it must cost
nothing to run locally.

## Options

**A. Laravel Reverb.**
First party, installed with `php artisan install:broadcasting --reverb`, runs as its own process.
Free and self-hosted.
Speaks the Pusher protocol, so clients connect with `laravel-echo` and `pusher-js`.
Cost: one more process to keep running in development, and it is a first-party component that is
younger than the alternatives.

**B. Pusher, the hosted service.**
Zero operational work, a usable free tier.
Cost: an external account, a hard limit on connections and messages, and nothing running locally,
which means chat stops working offline and costs money the moment usage is real.
Breaches the zero-cost constraint in spirit even where the free tier holds.

**C. Soketi, self-hosted, Pusher compatible.**
Free, self-hosted, and mature.
Cost: a third-party component outside the Laravel release cycle, and no advantage over Reverb now
that Reverb exists and is maintained alongside the framework.

## Decision

Option A, Reverb.

The decisive property is that Reverb speaks the Pusher protocol.
Every client, web, iOS and desktop, uses the same two libraries with near-identical subscription
code.
That holds the realtime layer constant across the three clients, which is precisely what makes the
platform comparison meaningful: what differs between them differs for platform reasons, not
because three different realtime clients were used.

It also means the transport is swappable.
Moving to Pusher or Soketi later changes a configuration block and no application code.

## Consequences

- Development runs four processes: `serve`, `queue:work`, `reverb:start`, `vite`.
  Laravel 13's `composer dev` script runs them together.
- The commonest realtime failure in development is a process not running rather than a code
  defect.
  This is worth checking first every time.
- Production Reverb would need its own supervision and horizontal scaling story.
  Out of scope here, and noted so it is not forgotten.

## What would change my mind

A production deployment where running and scaling a websocket server is not worth the operational
burden.
Then Pusher, and the code does not change.
