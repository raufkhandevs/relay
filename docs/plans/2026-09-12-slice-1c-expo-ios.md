# Relay slice 1C: Expo iOS client implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An iOS app on the simulator where you log in as a customer, see your tickets, open one, and watch a message posted from the web appear live.

**Architecture:** Expo SDK 57 with a development build, not Expo Go. Token auth against the Laravel API, token stored in the iOS Keychain via `expo-secure-store`. Server state through TanStack Query. Realtime through `laravel-echo` and `pusher-js` against the same Reverb server the web client uses.

**Tech Stack:** Expo SDK 57 (expo ~57.0.22), Expo Router ~57.0.21, React Native, TypeScript, Expo Router, TanStack Query, expo-secure-store, laravel-echo, pusher-js.

**Spec:** `docs/specs/2026-09-11-relay-design.md`

**Backend:** `backend-laravel`, complete and running. See its README for how to start it.

## Global constraints

- **Expo Go will not work.** `expo-secure-store` is a native module. The app runs via `npx expo run:ios`, which produces a development build. Do not attempt to make it run in Expo Go.
- **Tokens go in the Keychain** via `expo-secure-store`. Never `AsyncStorage`, never a plain file. `AsyncStorage` is plaintext on disk and rides along in device backups.
- **No secrets in the app.** The JS bundle ships to the device and can be read. No keys, no internal endpoints.
- **`ios/` and `android/` are generated output.** `expo prebuild` recreates them from `app.json`. Never commit them, never hand edit them. Config plugins instead.
- **`.gitignore` covers `.env*` before the first commit.** This was missed on the backend repo and a key reached a public repo. Do not repeat it.
- **Echo must set `authEndpoint` explicitly** to `/api/broadcasting/auth`. The default is `/broadcasting/auth`, which does not exist on this backend. This exact bug cost time on the web client.
- **`listen()` event names take a leading dot**: `.message.created`. Without it Echo expects a fully qualified PHP class name and silently matches nothing.
- **The paginated API response has no `meta` wrapper.** `data`, `next_cursor`, `total` are top level.
- Testing is deliberately light. This is a learning project that will not be deployed. One smoke test per task at most, and verification is by running the app on the simulator and looking at it.
- **Never run `git push`.** Rauf pushes. Commit locally and hand him the command.
- No em dashes. Straight quotes only. Commit subjects imperative, under 72 chars, ending:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```

## API contract this client consumes

```
POST   /api/tokens                      {email, password, device_name} -> {token, user}
DELETE /api/tokens/current              revoke this device only
GET    /api/me                          -> UserData (has email)
GET    /api/tickets                     -> {data: TicketData[], current_page, per_page, total, ...}
GET    /api/tickets/{id}                -> TicketData
GET    /api/tickets/{id}/messages       -> {data: MessageData[], next_cursor, prev_cursor, ...}
```

Nested users in `TicketData` and `MessageData` are `ParticipantData`: `{id, name, role}`, **no email**.
`UserData` from `/api/me` and the login response does carry `email`.

Channel: `private-ticket.{id}`, event `.message.created`, payload is `MessageData`.

---

### Task 1: Scaffold, run on the simulator, create the repo

**Files:** the whole `mobile-react-native/` app.

- [ ] **Step 1: Confirm the backend is up**

```bash
cd /Users/apple/work/app-development/backend-laravel
docker compose up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000
```

Expected: `200`. If not, start it with `composer dev` and leave it running; this whole plan needs it.

- [ ] **Step 2: Scaffold**

```bash
cd /Users/apple/work/app-development
npx create-expo-app@latest mobile-react-native
cd mobile-react-native
```

This produces a TypeScript app using Expo Router, with routes under `src/app/`, not `app/`. It also generates its own `AGENTS.md` and a `CLAUDE.md` that just includes it; task 5 replaces those.

- [ ] **Step 3: Lock down secrets before the first commit**

Append to `.gitignore`:

```
.env
.env.*
!.env.example
```

Do this now, not later. The backend repo published a key because this step happened after the first commit.

- [ ] **Step 4: Build and run on the simulator**

```bash
npx expo run:ios
```

This generates `ios/`, builds, installs and launches on a simulator. It takes several minutes the first time. If it fails with `Command PhaseScriptExecution failed`, node is not visible to Xcode because it comes from volta:

```bash
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local
```

Then re-run. That file is per-machine and gitignored.

- [ ] **Step 5: Confirm `ios/` is not tracked**

```bash
git check-ignore ios && echo "ios ignored, correct" || echo "PROBLEM: ios is not ignored"
```

`create-expo-app` normally gitignores it. If it does not, add `/ios` and `/android` to `.gitignore`. They are generated by `prebuild` from `app.json`, so committing them creates a second source of truth for native config.

- [ ] **Step 6: Take a screenshot of the running app**

```bash
xcrun simctl io booted screenshot /tmp/relay-mobile-scaffold.png
```

Confirm the default Expo screen is on the simulator. This proves the toolchain works before any of our code exists, which is the cheapest moment to find out it does not.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Expo SDK 57 app with a development build

Expo Go cannot load expo-secure-store, which this app needs for Keychain
token storage, so the app runs as a development build from the start.
ios/ stays generated by prebuild and is never committed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

- [ ] **Step 8: Hand Rauf the push commands**

Do not run these.

```bash
cd /Users/apple/work/app-development/mobile-react-native
gh repo create raufkhandevs/relay-react-native --public \
  --description "Relay support desk iOS client: Expo, React Native, TypeScript"
git remote add origin https://github.com/raufkhandevs/relay-react-native.git
git push -u origin main
```

---

### Task 2: API client, login, token in the Keychain

**Files:**
- Create: `src/lib/api.ts`, `src/lib/auth.ts`, `src/types/api.ts`
- Create: `src/app/login.tsx`
- Modify: `src/app/_layout.tsx`

**Produces:** `api.get/post(path, init)` attaching the bearer token; `signIn(email, password)`, `signOut()`, `getToken()`; a login screen that routes to the ticket list on success.

- [ ] **Step 1: Install what this task needs**

```bash
npx expo install expo-secure-store @tanstack/react-query
```

Use `npx expo install`, not `npm install`. It picks versions matched to the SDK; plain npm will happily install something incompatible.

Native module added, so rebuild rather than reload:

```bash
npx expo run:ios
```

- [ ] **Step 2: Declare the API types by hand, once**

Create `src/types/api.ts`. The backend generates TypeScript for its own web client, but that file is not published anywhere this repo can import from, and the pagination envelope is not in it at all. Declare both here, in one place, so three screens do not each guess.

```ts
export type Role = 'customer' | 'agent';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

/** Nested in tickets and messages. Deliberately has no email. */
export type Participant = {
    id: number;
    name: string;
    role: Role;
};

/** Only returned for the signed-in user, from /api/me and the login response. */
export type User = Participant & { email: string };

export type Ticket = {
    id: number;
    subject: string;
    status: TicketStatus;
    customer: Participant;
    assigned_agent: Participant | null;
    last_message_at: string | null;
    created_at: string;
};

export type Message = {
    id: number;
    ticket_id: number;
    body: string;
    author: Participant;
    created_at: string;
};

/** Laravel's offset paginator. No meta wrapper. */
export type Paginated<T> = {
    data: T[];
    current_page: number;
    per_page: number;
    total: number;
};

/** Laravel's cursor paginator. No meta wrapper. */
export type CursorPaginated<T> = {
    data: T[];
    next_cursor: string | null;
    prev_cursor: string | null;
};
```

- [ ] **Step 3: Write the token store**

Create `src/lib/auth.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'relay.token';

export async function getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
}
```

`SecureStore` writes to the iOS Keychain. This is the whole reason the app is a development build rather than Expo Go.

- [ ] **Step 4: Write the API client**

Create `src/lib/api.ts`:

```ts
import { getToken } from './auth';

export const API_BASE = 'http://localhost:8000';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();

    const response = await fetch(`${API_BASE}/api${path}`, {
        ...init,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...init.headers,
        },
    });

    if (!response.ok) {
        const body = await response.text();
        throw new ApiError(response.status, body || response.statusText);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
        request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

`localhost` works because the simulator shares the Mac's network. A physical device would need the Mac's LAN address and an ATS exception; out of scope here.

- [ ] **Step 5: Handle App Transport Security if the request is blocked**

iOS blocks cleartext HTTP by default. Run the app and attempt a login. If the request fails with a network error rather than a 4xx, add an ATS exception for localhost in `app.json` under `expo.ios.infoPlist`:

```json
"NSAppTransportSecurity": {
    "NSAllowsLocalNetworking": true,
    "NSExceptionDomains": {
        "localhost": { "NSExceptionAllowsInsecureHTTPLoads": true }
    }
}
```

Then `npx expo prebuild --clean && npx expo run:ios`, because `Info.plist` is native config and a JS reload will not pick it up.

Report whether the exception was actually needed. Expo's dev builds sometimes already permit it.

- [ ] **Step 6: Write the login screen**

Create `src/app/login.tsx` with email and password inputs, a submit button, and visible error and loading states. On submit, `POST /api/tokens` with `{email, password, device_name}` where `device_name` identifies this install, store the returned token with `setToken`, then route to the ticket list.

The error state matters. A wrong password returns 422, and too many attempts returns 429 because the endpoint is rate limited. Both must show a readable message rather than a blank screen or a crash. Test both by hand.

Prefill the fields with `priya@relay.test` and `password` in development so you are not typing them fifty times. Guard it with `__DEV__`.

- [ ] **Step 7: Wire TanStack Query at the root**

In `src/app/_layout.tsx`, wrap the app in a `QueryClientProvider`. Route to `/login` when there is no stored token and to the ticket list when there is.

- [ ] **Step 8: Verify by using it**

Run the app, log in as `priya@relay.test` / `password`. Confirm you land past the login screen. Then force-quit and reopen the app: you should still be signed in, because the token is in the Keychain. Screenshot both states.

Also confirm the token is actually in the Keychain rather than somewhere else, by logging out, confirming the app returns to login, and logging back in.

- [ ] **Step 9: Commit**

Subject: `Add API client with token auth stored in the Keychain`. Body should say why `expo-secure-store` rather than `AsyncStorage`: AsyncStorage is plaintext on disk and is included in device backups, so a token there is a credential in a text file.

---

### Task 3: Ticket list

**Files:** Create `src/app/(app)/tickets/index.tsx`, `src/lib/queries.ts`

**Produces:** a ticket list fetched with TanStack Query, with loading, empty and error states.

- [ ] **Step 1: Write the query**

In `src/lib/queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Paginated, Ticket } from '../types/api';

export function useTickets() {
    return useQuery({
        queryKey: ['tickets'],
        queryFn: () => api.get<Paginated<Ticket>>('/tickets'),
    });
}
```

- [ ] **Step 2: Build the screen**

A `FlatList` over `data.data`. Each row shows the status, the subject and `TKT-{id}`. Tapping a row routes to `/tickets/{id}`.

Three states, all designed, not skipped:
- **Loading:** skeleton rows at the real row height so nothing shifts when data lands. Nothing at all under about 200ms, because a spinner that blinks in and out reads as a bug.
- **Empty:** "Nothing open. Start a ticket and we will reply within the hour." Not a bare "No data".
- **Error:** the message plus a retry control. Never a blank screen.

Respect the safe area at the top and bottom. Tap targets at least 44pt. These two are most of what separates an app that feels native from one that does not.

- [ ] **Step 3: Verify by using it**

Log in as `priya@relay.test`. She must see exactly one ticket, `Can't export invoices to CSV`, not the five in the database. That is the server-side policy showing up in the UI.

Then log in as `agent@relay.test` and confirm the list is longer. Screenshot both.

Kill the backend (`docker compose stop` or stop `composer dev`) and reload the app to see the error state. Restart and confirm recovery. An error state you have never seen is not a state you have designed.

- [ ] **Step 4: Commit**

Subject: `Add ticket list with loading, empty and error states`.

---

### Task 4: Message thread, live over the websocket

**Files:** Create `src/app/(app)/tickets/[id].tsx`, `src/lib/echo.ts`, `src/hooks/use-ticket-channel.ts`

**Produces:** a thread that renders history and appends new messages pushed over Reverb.

This is the task the slice exists for.

- [ ] **Step 1: Install the realtime client**

```bash
npx expo install laravel-echo pusher-js
```

Reverb speaks the Pusher protocol, which is why these are the same two libraries the web client uses. Confirm whether React Native needs any polyfill for them and report what you found; do not add one speculatively.

- [ ] **Step 2: Configure Echo**

Create `src/lib/echo.ts`. Read `backend-laravel/resources/js/app.tsx` first to see the exact configuration that already works, and mirror it.

Two things are mandatory and both have already cost time on this project:

- **`authEndpoint: 'http://localhost:8000/api/broadcasting/auth'`.** The default is `/broadcasting/auth`, which does not exist here. The backend moved it under `/api` so one endpoint serves both cookie and token auth.
- **An `auth.headers.Authorization` bearer token**, read from the Keychain. The web client authorises the channel with a session cookie; this client has no cookie and must send the token. Same endpoint, same policy, different credential. That is the design from decision 0003, and this is where you see it.

- [ ] **Step 3: Write the channel hook**

`src/hooks/use-ticket-channel.ts`, subscribing to `private-ticket.{id}` and listening for `.message.created`.

The leading dot is mandatory. Without it Echo expects a fully qualified PHP class name and matches nothing, with no error anywhere.

Return a cleanup that calls `stopListening` and leaves the channel. Without it, navigating between tickets accumulates subscriptions and the same message renders several times.

- [ ] **Step 4: Build the thread screen**

Fetch history with `GET /tickets/{id}/messages` (cursor paginated, newest first, so reverse for display). Render each message with body and author name, the current user's own messages visually distinct.

Append incoming messages, **deduplicated by id**. The sender receives their own broadcast, so without the guard a message renders twice.

No composer in this slice. Sending from the app is slice 2.

- [ ] **Step 5: Verify the thing this whole slice is for**

Backend running. App on the simulator, logged in as Priya, thread open.

From the Mac, post a message as the agent:

```bash
cd /Users/apple/work/app-development/backend-laravel
TOKEN=$(curl -s -X POST http://localhost:8000/api/tokens -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@relay.test","password":"password","device_name":"cli"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:8000/api/tickets/1/messages \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"body\":\"Sent from the terminal at $(date +%T)\",\"idempotency_key\":\"$(uuidgen | tr 'A-Z' 'a-z')\"}"
```

The message must appear on the simulator with no interaction. Screenshot it.

If nothing arrives, check in this order: is `reverb:start` running; does the app log a failed POST to `/api/broadcasting/auth` (a 403 means the policy refused, a 404 means `authEndpoint` is wrong); does `listen()` start with a dot.

Then open the same ticket in a browser at `http://localhost:8000/tickets/1` and post again. **The message must appear in both the browser and the simulator at once.** That is the comparison this project was built for: two clients, two auth modes, one backend, one policy.

- [ ] **Step 6: Commit**

Subject: `Add live message thread over Reverb`. Body should note that the native client authorises the channel with a bearer token where the web client uses a session cookie, hitting the same endpoint and the same policy.

---

### Task 5: README, conventions and the run skill

**Files:** Create `README.md`, `CLAUDE.md`, `.claude/skills/run-app/SKILL.md`

- [ ] **Step 1: Write the README**

Human facing. What the app is, that it needs the backend running, how to start it, the seeded accounts, and the gotchas in the order they will bite: Expo Go will not work, `expo start` ships JS while `expo run:ios` ships the app, native changes need a rebuild, the volta and `.xcode.env.local` trap, and the leading dot on the Echo event name.

- [ ] **Step 2: Write `CLAUDE.md`**

Agent facing conventions: tokens in the Keychain only, `ios/` is generated and never committed, no secrets in the bundle, `npx expo install` rather than `npm install`, `authEndpoint` must be explicit, never `git push`.

- [ ] **Step 3: Write the run skill**

`.claude/skills/run-app/SKILL.md`, covering: start the backend first, `npx expo start` vs `npx expo run:ios` and when each is right, clearing the Metro cache with `-c`, and the realtime checklist.

- [ ] **Step 4: Commit, then hand Rauf the push command**

---

## Done when

- The app runs on the iOS simulator from `npx expo run:ios`.
- Logging in as `priya@relay.test` stores a token in the Keychain and survives a force quit.
- The ticket list shows only Priya's ticket, and the agent's list is longer.
- A message posted from the terminal or the browser appears in the open thread on the simulator with no interaction.
- `ios/` is not tracked. No `.env` is tracked.
- Three repos exist and the parent's submodule pointers are bumped.

## Not in 1C

Sending messages from the app, attachments, push notifications, presence, offline outbox, ticket creation. Those are slices 2 through 7.
