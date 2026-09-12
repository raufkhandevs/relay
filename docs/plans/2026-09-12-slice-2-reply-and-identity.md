# Relay slice 2: reply, and one visual identity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An agent or customer can reply from any of the three clients, and the three stop looking like three products.

**Why together:** both touch every screen. Restyling and then adding a composer means editing the same files twice.

**Spec:** `docs/specs/2026-09-11-relay-design.md`
**Design:** `docs/decisions/0009-one-design-system-two-densities.md`. Read it before writing any UI.

## Global constraints

- **Tokens are defined in decision 0009 and duplicated deliberately** in three codebases. Do not invent colours. Do not add a token that is not in 0009 without saying why.
- **IBM Plex Sans everywhere, IBM Plex Mono for ticket ids and timestamps.** Same faces on all three clients; that is what makes them one product.
- **Status is a 3px coloured left edge on the ticket row, never a pill.** This is the one recurring device. Agent surfaces run it compact, customer surfaces roomy.
- **Do not produce:** uppercase tracked labels above headings, meta strings joined with middle dots, one border radius and one shadow on every block. Spend border, fill, radius and shadow by role. Not everything is a card.
- **Every composer sends an idempotency key**, a fresh UUID per attempt of a distinct message. A retry of the same message reuses its key. This is the first time real clients exercise the backend's idempotency path; curl is all that has tested it.
- **Optimistic append, then reconcile.** The message appears immediately, marked pending, and settles when the server confirms. On failure it stays visible with a retry, never silently dropped.
- **The sender receives their own broadcast.** Deduplicate by id, and make sure an optimistic message is replaced rather than duplicated when its real id arrives.
- Loading, empty, error and offline states all designed. Empty states say what to do next.
- Interactive elements keep stable `testID` / `data-testid`.
- **Never run `git push`.** Rauf pushes.
- No em dashes. Straight quotes only. Commit subjects imperative, under 72 chars, ending:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```

## API

```
POST /api/tickets/{id}/messages   {body, idempotency_key} -> 201 Message
```
Web uses the session cookie; iOS sends a bearer token; desktop goes through main over IPC. A repeated key returns the original message with 201, so a retry is safe.

---

### Task 1: Web client, reply and identity

**Repo:** `backend-laravel`. Files: `resources/js/pages/tickets/*`, `resources/css/app.css`, `routes/web.php`, `app/Http/Controllers/TicketWebController.php`, plus removal of unused starter kit screens.

- [ ] **Step 1: Read decision 0009 and the existing pages** before changing anything. The list and thread already work; this is a restyle plus a composer, not a rewrite.

- [ ] **Step 2: Define the tokens once**, as CSS custom properties in `resources/css/app.css`, exactly the values in 0009. Load IBM Plex Sans and IBM Plex Mono. The starter kit uses Tailwind; map the tokens into the Tailwind theme rather than fighting it.

- [ ] **Step 3: Strip the starter kit chrome.** The app is a support desk, not a Laravel demo. Remove the starter kit's marketing shell, its logo treatment and its dashboard placeholder. Registration stays (customers need accounts) but anything unreachable from a real user flow goes. List what you removed in your report; if removing something breaks a route or a test, fix the route or the test rather than leaving dead UI.

- [ ] **Step 4: Restyle the ticket list.** Roomy: this is a customer surface. Status as the 3px left edge. Subject prominent, ticket id in mono and quiet. Last activity as a relative time. Empty state: "Nothing open. Start a ticket and we will reply within the hour." with the action present.

- [ ] **Step 5: Restyle the thread.** Messages from the signed-in user visually distinct from the other party, which is who sent it rather than which side of the conversation they are on. Author name, body, time. Keep the dedupe guard.

- [ ] **Step 6: Add the composer.** A textarea and a send control. Enter sends, Shift+Enter makes a newline; say so in the placeholder. Disabled while empty. On submit: generate a UUID, append optimistically as pending, POST, replace with the server's message on 201, or mark failed with a retry that reuses the same key.

- [ ] **Step 7: Verify by driving it.** Playwright MCP is available. Sign in as Priya, send a message, confirm it appears. Then confirm it arrives in a second browser context signed in as the agent, live. Screenshot both. Also send from the agent and confirm Priya sees it.

- [ ] **Step 8: Run `php artisan test`, `npm run check`, `npm run types:check`, `npm run build`.** All clean. Fix any test the chrome removal broke.

- [ ] **Step 9: Commit.**

---

### Task 2: iOS client, reply and identity

**Repo:** `mobile-react-native`. Files: `src/app/(app)/tickets/*`, `src/constants/theme.ts`, a new `src/lib/mutations.ts`.

- [ ] **Step 1: Put the 0009 tokens into `src/constants/theme.ts`.** Load IBM Plex Sans and Mono with `expo-font`; `npx expo install expo-font`. A native module means `npx expo run:ios`, not a reload.

- [ ] **Step 2: Restyle the ticket list.** Customer surface, so roomy. Status as the 3px left edge, 44pt minimum touch targets, safe areas respected. Keep the existing `testID`s.

- [ ] **Step 3: Restyle the thread.** Own messages distinct. Keep the dedupe guard and the channel cleanup.

- [ ] **Step 4: Add the composer.** `KeyboardAvoidingView` so the input is never under the keyboard, which is the single most common way a chat screen feels broken on a phone. Send disabled while empty. Optimistic append with the same pending, confirmed and failed states as web.

- [ ] **Step 5: Verify by driving it.** Maestro at `~/.maestro-install/maestro/bin/maestro`, flows in `/tmp`. Sign in, open TKT-1, type a message, send it, assert it appears. Then post from a terminal as the other party and assert that arrives too. Screenshot with `xcrun simctl io booted screenshot`.

- [ ] **Step 6: `npx tsc --noEmit` and `npx expo lint` clean. Commit.**

---

### Task 3: Desktop console, reply and identity

**Repo:** `desktop-electron`. Files: `src/renderer/src/**`, and one new IPC channel.

- [ ] **Step 1: Add the send channel.** `relay:sendMessage` taking `{ticketId, body, idempotencyKey}`. **Validate all three in main**: ticketId a positive integer, body a non-empty string with a length bound, idempotencyKey matching a UUID. Add exactly one named method to the preload. Do not widen the bridge any other way.

- [ ] **Step 2: Put the 0009 tokens into the renderer**, and load IBM Plex Sans and Mono. This is the agent surface, so run the system compact.

- [ ] **Step 3: Restyle the queue.** Dense: this is where an agent spends the day. Compact rows, the status edge doing the work, ticket id in mono, last activity relative. A column of status edges should be readable in one downward glance.

- [ ] **Step 4: Restyle the thread**, compact to match.

- [ ] **Step 5: Add the composer**, same behaviour as the other two. Enter sends, Shift+Enter newline.

- [ ] **Step 6: Verify by driving it.** Playwright `_electron` works and is proven; see the 1B ledger for the exact pattern. Sign in as the agent, open TKT-1, send a message, assert it appears, then post from a terminal as Priya and assert that arrives live. Screenshot the window.

- [ ] **Step 7: `npm run typecheck` and `npm run lint` clean. Commit.**

---

### Task 4: See all three at once

- [ ] **Step 1: Bring all three up** with the backend running: web in a browser, iOS on the simulator, desktop packaged or in dev.

- [ ] **Step 2: Send one message from the desktop console** and confirm it lands in the browser and on the simulator, live.

- [ ] **Step 3: Send one from the phone** and confirm it lands in the other two.

- [ ] **Step 4: Capture all three showing the same conversation.** This is the deliverable of the whole project.

- [ ] **Step 5: Update the three READMEs** to say the clients can reply, and record the shared design tokens with a pointer to decision 0009.

- [ ] **Step 6: Commit, bump the parent's submodule pointers, hand Rauf the push commands.**

---

## Done when

- A message can be sent from each of the three clients and arrives in the other two without a refresh.
- A retry after a failed send does not create a duplicate.
- The three clients share a palette, a typeface and the status edge, at two densities.
- No Laravel starter kit chrome remains in the web client.
- All three test and lint suites clean.

## Not in slice 2

Attachments, push notifications, presence and typing indicators, the desktop tray and hotkey, offline outbox, ticket creation from mobile or desktop.
