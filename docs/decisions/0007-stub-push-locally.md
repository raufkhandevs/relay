# 0007. Stub push delivery locally

Date: 2026-09-11
Status: accepted

## Context

Push notification to a backgrounded app is a core part of the product and the most
platform-specific thing being built.

Apple Push Notification service credentials cannot be issued to a free Apple ID.
Enrolling costs $99 per year, and this project has a hard zero-cost constraint.
There is no workaround; this is a hard wall, not a difficult path.

The wall blocks exactly one hop: server to Apple to device.
Everything either side of it is reachable.
`xcrun simctl push` delivers a real notification into the iOS Simulator, exercising the permission
prompt, payload format, foreground and background handling, badge counts, and tap-to-deep-link.

## Options

**A. A local notification channel that writes the payload, fed to `simctl push`.**
Push is sent through Laravel Notifications, which is driver based by design.
In development the channel writes the real payload to disk instead of handing it to APNs, and a
script feeds it to the simulator.
The entire chain runs: domain event, broadcast, queued job, payload construction, notification on
screen.
Only Apple's wire is stubbed.
Cost: the server to APNs credential handling is never executed.

**B. Build for Android and use Firebase Cloud Messaging.**
FCM is free with no paid tier required, so real end-to-end push costs nothing.
Cost: a one-time Android SDK setup, and the project's stated preference is iOS.
Available at any time from the same codebase at no rework.

**C. Skip push entirely.**
Cheapest.
Cost: removes the most instructive platform-specific feature in the project, and the thing that
most clearly distinguishes a mobile client from a web one.

## Decision

Option A, with option B kept available.

The stub is not a compromise made for the constraint; it is how this should be structured anyway.
Push needs to be testable where there are no devices, which includes CI, so a driver that captures
the payload has independent value.
Swapping it for a real APNs channel later is a configuration change.

Option B stays one command away.
If the server-to-provider leg is worth seeing work, `npx expo run:android` proves it for free
against real Google infrastructure, from the same source.

## Consequences

- Push is implemented through Laravel Notifications with a custom channel, never by calling an
  APNs client directly from a job.
- The untested path is explicit: constructing and authenticating the APNs request.
  Documented in the spec rather than left as an assumption that it works.
- `device_tokens` is built and exercised properly, since registration and refresh happen
  regardless of who delivers the payload.

## What would change my mind

Deciding to ship this to a real device for anyone other than the author, which would require the
paid account for signing anyway.
Then the real channel goes in and the stub stays for tests.
