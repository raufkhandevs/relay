# Relay: design

Date: 2026-09-11
Status: approved, not yet implemented

## Purpose

Relay is a support desk built three times over one backend, as a vehicle for learning Laravel,
React Native and Electron to a production standard.
Customers raise tickets and chat from a web portal and an iOS app.
Agents work the queue from a desktop console.
All three talk to one Laravel application over one websocket.

The product is real enough to be instructive.
It is not intended for users, and it will not be deployed.

## Constraints

These are hard, and they shaped several decisions below.

- **Zero cost.** No paid accounts, no hosted services, no cloud spend.
  This rules out real APNs push, TestFlight, and macOS code signing, all of which require the
  $99/year Apple Developer Program.
- **No deployment.** Everything runs on one Mac.
  Deployment is out of scope, though the design should not preclude it.
- **Learning is the deliverable.** Where two approaches are equally correct, prefer the one that
  teaches more, and write down why.

## Non-goals

Explicitly out of scope, so that nobody has to guess later.

- Multi-tenancy, organisations, or teams. One support desk, one pool of agents.
- Email ingestion. Tickets are created in the product, not by replying to an address.
- Knowledge base, canned replies, macros, SLA policies, reporting.
- Android, unless curiosity pulls it in later. The code supports it at no extra cost.
- Real push delivery on iOS. See decision 0007.

## Architecture

One Laravel 13 application owns the data, the API, the web UI and the websocket server.
Three clients consume it.

```
                     Laravel 13 (single codebase)
                     |
  Inertia + React ---+--- web routes    -> session cookie
  (browser)          |
                     +--- api routes    -> Sanctum bearer token
  Expo / iOS --------+                     |
  Electron ----------+--- Reverb (ws)   -> either credential
                     |
                     +--> Postgres
                     +--> queue worker
```

The web client is server-driven through Inertia and shares Laravel's routing, controllers,
validation and authorisation directly.
The native clients consume a JSON API.
Both paths run through the same policies, so authorisation cannot drift between them.

Rationale for one backend rather than three is in decision 0001.

## Data model

Five tables.

| Table | Columns |
|---|---|
| `users` | `id`, `name`, `email`, `password`, `role` enum(`customer`,`agent`), timestamps |
| `tickets` | `id`, `subject`, `status` enum(`open`,`pending`,`resolved`,`closed`), `customer_id`, `assigned_agent_id` nullable, `last_message_at`, timestamps |
| `messages` | `id`, `ticket_id`, `user_id`, `body`, `idempotency_key` unique nullable, timestamps |
| `attachments` | `id`, `message_id`, `path`, `original_name`, `mime`, `size`, timestamps |
| `device_tokens` | `id`, `user_id`, `token` unique, `platform` enum(`ios`,`android`), `last_used_at`, timestamps |

Agents and customers share one table because being an agent is a role a person holds, not a
different kind of entity.
Splitting them would duplicate authentication, profile and password reset for no gain, and would
make it impossible for one person to be both.
When roles need real granularity the enum is replaced by a permissions table, not before.

`last_message_at` is denormalised onto `tickets`. See decision 0005.

All timestamps are stored in UTC and converted at the client edge.

## API contract

```
POST   /api/tokens                        login, returns a plain-text Sanctum token
DELETE /api/tokens/current                logout, revokes this device only
GET    /api/me

GET    /api/tickets                       offset paginated, scoped by role
POST   /api/tickets
GET    /api/tickets/{ticket}
PATCH  /api/tickets/{ticket}              status and assignment, agents only

GET    /api/tickets/{ticket}/messages     cursor paginated, newest first
POST   /api/tickets/{ticket}/messages     requires an idempotency key

POST   /api/devices                       register a push token
DELETE /api/devices                       deregister on logout
```

Every list endpoint is paginated in its first commit.

Message history uses cursor pagination rather than offset.
Offset pagination assumes a stable result set, and a live conversation is not one.
New messages arriving mid-scroll shift every row's position, so offset paging duplicates and skips
rows as a matter of course rather than as a rare race.
A cursor anchored to a message id is stable regardless of what is inserted.

Ticket lists keep offset pagination, because the set churns slowly and page numbers are useful
there.

`POST /api/tickets/{ticket}/messages` requires a client-generated idempotency key.
Mobile networks drop responses as readily as requests, so a client that retries after a timeout
would otherwise post the same message twice.
The server stores the key and returns the original message for a repeat.

Response shapes are defined once as PHP data objects and emitted as TypeScript.
See decision 0006.

## Realtime

Laravel Reverb, run as its own process.

```
private-ticket.{id}     MessageCreated, TicketUpdated
presence-ticket.{id}    viewing and typing state
private-agents          TicketCreated
```

Reverb speaks the Pusher protocol, so all three clients connect with the same two libraries,
`laravel-echo` and `pusher-js`.
The realtime layer is therefore held constant across the three clients, which is what makes the
comparison between them meaningful: what differs between platforms differs for platform reasons.

Rationale for Reverb over the alternatives is in decision 0002.

## Authorisation

One policy guards both transports.

```php
// TicketPolicy
public function view(User $user, Ticket $ticket): bool
{
    return $user->role === 'agent' || $ticket->customer_id === $user->id;
}
```

```php
// routes/api.php      $this->authorize('view', $ticket);
// routes/channels.php Broadcast::channel('ticket.{ticket}',
//                       fn (User $u, Ticket $t) => $u->can('view', $t));
```

A websocket channel is an authorisation surface that is easy to forget.
An HTTP endpoint can be correctly locked down while the corresponding private channel remains
subscribable by any authenticated user, at which point every message in every ticket leaks in real
time and no HTTP test detects it.
Deriving both checks from one policy makes that failure structurally difficult rather than a thing
to remember.

The highest-value tests in this project assert exactly this: that a customer can neither read
another customer's ticket over HTTP nor subscribe to its channel.

## Authentication

One Sanctum installation, two modes.

The browser uses a session cookie: `httpOnly`, `Secure`, `SameSite=Lax`, CSRF protected.
The native clients use a Sanctum personal access token, sent as a bearer token, stored in the iOS
Keychain via `expo-secure-store` and in Electron's `safeStorage`.

Cookies require a browser and a same-origin relationship that a native app does not have.
Tokens are the answer for native clients, and Sanctum tokens are opaque database rows rather than
JWTs, so they can be revoked server side, scoped, listed per device, and expired.
See decision 0003.

## Clients

### Web, Laravel 13 + Inertia + React 19

Laravel's official React starter kit: Inertia, React 19, TypeScript, Tailwind, shadcn/ui, Vite.

```bash
docker compose up -d      # postgres
composer dev              # serve + queue:work + reverb:start + vite
```

Four concurrent processes is normal for a realtime Laravel application.
When realtime silently fails, the cause is almost always that `reverb:start` or `queue:work` is
not running.

Tests: Pest for feature and unit, Playwright for end to end.

### Mobile, Expo SDK 56, iOS

Expo with a development build, not Expo Go, because the app needs native modules that Expo Go
cannot load.
`expo prebuild` generates `ios/`, which is treated as build output and never committed.

```bash
npx expo start            # Metro, JavaScript only
npx expo run:ios          # full native build and install
```

The distinction matters daily.
Changing a component is a fast refresh.
Adding a native dependency, an icon, a permission string or an entitlement requires a rebuild.

The iOS Simulator is the primary target.
It requires no Apple account and imposes none of the free-tier limits that apply to physical
devices, namely a seven day provisioning expiry and a three app ceiling.
A physical iPhone is used occasionally, under a free Apple ID, to exercise the camera and the real
provisioning flow.

Tests: Jest with React Native Testing Library, Maestro for end to end on the simulator.

### Desktop, Electron + electron-vite + React + TypeScript

```bash
pnpm dev                  # electron-vite with renderer HMR
pnpm build -- --dir       # unsigned .app
```

The unpacked build runs from the first week rather than from release week, because path
assumptions, unpackaged files and native module ABI mismatches only exist in packaged builds and
are cheap to find early.

Signing and notarisation are out of scope on cost grounds, and macOS auto-update cannot be
verified without them.
The updater is still implemented, and the gap is documented rather than hidden.

Tests: Vitest for main process logic, Playwright for end to end via `_electron.launch()`.

Security posture, which is not negotiable: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, a narrow typed `contextBridge` surface, and validation of every IPC payload in the
main process.
The renderer is a browser and is treated as hostile input.

## Slice plan

Slice 1 is the vertical spine.
Its definition of done: a message typed in the Electron console appears in the browser and on the
iOS simulator, without a refresh, in under a second.

That sentence forces both auth modes, the websocket server, channel authorisation, the shared
policy and three client runtimes to work at once.
Everything after it is feature work on a spine that already holds.

| Slice | Scope |
|---|---|
| 1 | Users, tickets, messages, both auth modes, Reverb, `TicketPolicy`, login and thread on all three clients |
| 2 | Ticket lifecycle: status, assignment, agent queue |
| 3 | Attachments: multipart upload, photo library on iOS, drag and drop on desktop |
| 4 | Push notifications: queued jobs, local simulator channel, `simctl push` |
| 5 | Presence and typing indicators |
| 6 | Desktop native behaviour: tray, unread badge, global hotkey, deep links |
| 7 | Offline on mobile: optimistic writes, outbox, reconnect and backfill |
| 8 | The Livewire twin: one screen built both ways for comparison |
| 9 | Packaging: unsigned `.app`, release build on a physical iPhone |

Slice 7 carries the most mobile-specific learning and is the one most commonly skipped.

Explicitly not in slice 1: attachments, push, presence, assignment, statuses beyond `open`,
search, filters, avatars, settings.

## UI

Screen layouts are in `docs/relay-ui-mockup.html`, published as an artifact.

Every screen answers five states before it ships: empty, loading, disconnected, send failed, and
forbidden.
Disconnected is the one mobile actually spends time in, and it is a thin persistent bar rather
than a modal, with the composer left usable and messages queued for reconnect.

## Repository layout

Four git repositories: one per application, plus a parent that links them as submodules.
See decision 0008.

```
relay/                           parent repo, raufkhandevs/relay
├── docs/
│   ├── specs/                   this document
│   ├── decisions/
│   └── relay-ui-mockup.html
├── backend-laravel/             submodule -> relay-laravel
├── mobile-react-native/         submodule -> relay-react-native
└── desktop-electron/            submodule -> relay-electron
```

Shared documents live in the parent because they describe the whole system.
The parent pins an exact commit of each application, so one reference names the state of all three
together.
Those pointers move at slice boundaries, not per commit.

The three applications join as submodules as each is scaffolded.

Each application repository gets its own `CLAUDE.md` and a `.claude/skills/run-app` so the built-in
`run` skill knows how to start it.
Run commands are deliberately project level rather than user level.

## Decisions

| | |
|---|---|
| [0001](../decisions/0001-one-backend-three-clients.md) | One backend, three clients |
| [0002](../decisions/0002-reverb-for-realtime.md) | Laravel Reverb for realtime |
| [0003](../decisions/0003-sanctum-two-auth-modes.md) | Sanctum with two auth modes |
| [0004](../decisions/0004-postgres-over-sqlite.md) | Postgres over the Laravel 13 SQLite default |
| [0005](../decisions/0005-denormalise-last-message-at.md) | Denormalise `last_message_at` |
| [0006](../decisions/0006-generate-typescript-from-php.md) | Generate TypeScript from PHP |
| [0007](../decisions/0007-stub-push-locally.md) | Stub push delivery locally |
| [0008](../decisions/0008-three-repositories.md) | Three repositories, docs in the backend |

## Open questions

- Whether the agent console's right-hand rail carries the right fields.
  Currently customer email, opened-at and first response time, which is a guess until the queue
  has been used.
