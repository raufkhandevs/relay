# Relay slice 4: the typing indicator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** While the other person is typing, a bubble with three animating dots appears at the bottom of the thread, on whichever client you are looking at. It disappears when they stop.

**Design:** `docs/decisions/0009-one-design-system-two-densities.md`.

## How it works, and why there is no backend task

Typing fires on **every keystroke**. Routing that through the application would mean an HTTP request per character, a broadcast per character, and a queue worker earning its keep for no reason.

Client events avoid all of it. `channel.whisper('typing', {...})` goes client -> Reverb -> other clients and never touches Laravel. **Verified working on this project already**: two `pusher-js` clients on `private-ticket.1`, one whispered, the other received it, with no config change and no server code.

Security comes free from what already exists. Reverb's `accept_client_events_from` defaults to `members`, so only clients already subscribed to that private channel can send or hear a whisper, and subscribing runs `TicketPolicy`. A stranger cannot whisper into a ticket for the same reason they cannot read it.

**So there is no backend work in this slice.** If you find yourself adding a route, a migration or an event class, stop: you have taken the expensive path.

## Global constraints

- **Whisper, never an HTTP request.** `whisper('typing')` and `listenForWhisper('typing')`.
- **Throttle the send.** At most one whisper per second while typing, no matter how fast someone types. Send on the leading edge so the first keystroke shows immediately.
- **Expire on the receiving side.** Hide the bubble roughly 3 seconds after the last whisper. Never rely on a "stopped typing" message arriving: the sender may close the laptop, lose signal, or quit mid-word. A stuck indicator that says someone is typing forever is the failure everyone has seen.
- **Never show your own typing.** The whisper carries the sender's name; ignore one whose name is yours.
- **The bubble is the feature.** Three dots, staggered, in a bubble shaped like an incoming message and positioned where the next one would arrive. Match the message bubble's shape and the theme's tokens; do not invent a new colour.
- **Respect reduced motion.** Where the platform exposes it, hold the dots static rather than animating. On the web that is `prefers-reduced-motion`; on iOS it is `AccessibilityInfo.isReduceMotionEnabled`.
- **The composer must stay responsive.** Whispering on keystroke must not make typing feel heavy. Do not re-render the thread on every character.
- **Never run `git push`.** Rauf pushes.
- No em dashes. Straight quotes only. Commit subjects imperative, under 72 chars, ending:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```

## The animation

Three dots, each fading and lifting slightly, staggered by about 150ms, on a loop of roughly 1.2s. The bubble itself fades in rather than popping.

Keep it small and calm. This sits at the bottom of a conversation someone is reading, and a bouncy indicator in the corner of the eye is an irritation, not a delight.

---

### Task 1: Web client

**Repo:** `backend-laravel`, `resources/js`

- [ ] **Step 1:** In the thread's channel hook, whisper `typing` with the signed-in user's name, throttled to at most once per second, on composer input. Leading edge, so the first keystroke sends immediately.
- [ ] **Step 2:** `listenForWhisper('typing')`. Store the sender's name with a timestamp. Ignore a whisper whose name matches the signed-in user.
- [ ] **Step 3:** A `TypingBubble` component: three dots in a bubble matching an incoming message's shape, using theme tokens. CSS keyframes, staggered with `animation-delay`. Wrap the animation in `@media (prefers-reduced-motion: reduce)` so the dots hold still for anyone who asked for that.
- [ ] **Step 4:** Show the bubble below the last message, in the scroll flow, so the existing follow-the-bottom behaviour carries it into view. Hide it 3 seconds after the last whisper.
- [ ] **Step 5:** Verify by driving two browser contexts with Playwright from `.tooling`. Type in one, assert the bubble appears in the other, stop, and assert it disappears within about 4 seconds. Screenshot it visible.
- [ ] **Step 6:** `php artisan test`, `npm run check`, `npm run types:check`, `npm run build` clean. Commit.

---

### Task 2: iOS client

**Repo:** `mobile-react-native`

- [ ] **Step 1:** Whisper on composer change, throttled the same way. The Echo instance is in `src/lib/echo.ts`; the channel is already subscribed in `use-ticket-channel.ts`.
- [ ] **Step 2:** Listen, ignore your own name, expire after 3 seconds.
- [ ] **Step 3:** The bubble rendered with `Animated` or `react-native-reanimated` if it is already a dependency. Do not add a new animation library for three dots. Check `AccessibilityInfo.isReduceMotionEnabled()` and hold them static if it is on.
- [ ] **Step 4:** Render below the last message so the existing auto-scroll carries it into view.
- [ ] **Step 5:** Verify with Maestro: post a whisper from a terminal script driving `pusher-js` (`/tmp/whisper-test.mjs` is a working starting point) and assert the bubble appears on the simulator. Screenshot it.
- [ ] **Step 6:** `npx tsc --noEmit` and `npx expo lint` clean. Commit.

---

### Task 3: Desktop console

**Repo:** `desktop-electron`

- [ ] **Step 1:** Whisper on composer input, throttled. Echo is already configured with the custom authorizer that proxies through `relay:channelAuth`; whispers ride the same subscribed channel and need **no new IPC channel**. If you think you need one, re-read this line.
- [ ] **Step 2:** Listen, ignore your own name, expire after 3 seconds.
- [ ] **Step 3:** The bubble at agent density, matching the other clients' shape and the theme tokens. CSS keyframes with `prefers-reduced-motion` respected.
- [ ] **Step 4:** Verify by driving the packaged app with Playwright `_electron`: whisper from a terminal script, assert the bubble appears, assert it disappears.
- [ ] **Step 5:** `npm run typecheck` and `npm run lint` clean. Commit.

---

### Task 4: See it on all three

- [ ] Type in the desktop console and watch the bubble appear on the web client and the simulator at once.
- [ ] Confirm it disappears everywhere when typing stops.
- [ ] Update the three READMEs' progress bars and the parent's.
- [ ] Commit, bump the submodule pointers, hand Rauf the push commands.

---

## Done when

- Typing in any client shows a three-dot bubble in the other two, within about a second.
- It disappears about 3 seconds after typing stops, and also when the typist's client disappears entirely.
- Nobody ever sees their own typing indicator.
- Reduced motion holds the dots still.
- No new route, migration, event class or IPC channel was added anywhere.

## Not in slice 4

Presence dots showing who has the ticket open, read receipts, and "seen by" markers. Those need a presence channel and real persistence, and they are a slice of their own.
