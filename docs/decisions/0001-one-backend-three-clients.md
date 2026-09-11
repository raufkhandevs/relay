# 0001. One backend, three clients

Date: 2026-09-11
Status: accepted

## Context

Relay is built across Laravel, React Native and Electron to compare the three stacks.
"The same app in three stacks" admits two readings: three independent full-stack applications, or
one backend with three clients.
Live chat is a required feature in all three, which forces the question early.

A chat backend is the expensive part of chat.
Presence, message ordering, delivery state, reconnect and backfill, and authorising a websocket
are identical work regardless of what renders the result.
The genuinely platform-specific problems live in the client: push to a backgrounded app, secure
token storage, behaviour on a dropped connection, shipping an update without a store review.

## Options

**A. One Laravel backend, three clients.**
Laravel owns data, API, websockets and its own web UI.
React Native and Electron are clients of that API.
Messages sent from one client appear on the others.
The comparison lands on the client layer, which is where the real differences are.
Matches how the two contracts are likely shaped.
Cost: the backend learning happens once rather than three times.

**B. Three independent full-stack applications.**
Each stack gets its own backend and database.
Maximum surface area, every layer seen three times.
Cost: chat infrastructure is built three times, the three apps cannot talk to each other, and most
of the repeated effort teaches nothing new after the first pass.
The comparison becomes cosmetic, because the same screens get drawn three times.

**C. Shared backend, realtime layer implemented twice.**
Shared API for auth and data, but two different realtime implementations to feel the difference.
Instructive on exactly one axis, at meaningful extra cost, and that axis is better covered by
reading than by building.

## Decision

Option A.

The clients having different jobs is what makes three clients worth building.
Customers raise tickets from the phone and the web; agents work the queue from the desktop.
Each client exists for a reason, so the comparison is about how three platforms solve genuinely
different problems rather than how they render the same list.

It also means one message traverses all three at once, which is the single most legible
demonstration that the whole thing works.

## Consequences

- The API contract becomes load bearing early, which is why generated types were adopted
  (decision 0006).
- Authorisation must hold across both the HTTP and websocket transports, which is why one policy
  drives both.
- Backend learning is concentrated rather than repeated.
  The Livewire twin in slice 8 partially offsets this by showing a second Laravel view layer.

## What would change my mind

If the goal shifted from learning the client platforms to learning three backend ecosystems, B
becomes correct.
It is not the goal here.
