# Relay

A support desk built three times over one backend, so I can learn React Native and Electron
properly instead of reading about them.

Nothing is built yet. Right now this repo holds the design and the decision records.

## Why

I took two contracts: one Laravel, one React Native and Electron. I have shipped Laravel 8 through
10 and I write React every day. I have never written a native app or a desktop app, and reading
comparisons was not closing the gap.

So: one product, three clients, one backend. Customers raise support tickets and chat with an
agent. Agents work the queue.

One backend rather than three, because a chat server is the expensive half of chat and building it
three times would teach me the same thing three times. Presence, message ordering, reconnect and
backfill, authorising a socket. None of that changes based on what renders the result. What does
change is push to a backgrounded app, where the token is stored, what happens when the train goes
into a tunnel, and how you ship an update without waiting on a store review. That is the client
layer, so that is where I put the comparison.

## The three clients

| Client | Stack | Who uses it |
|---|---|---|
| Web portal | Laravel 13, Inertia, React 19 | Customers |
| Mobile app | Expo SDK 56, iOS | Customers |
| Agent console | Electron, electron-vite, React | Support agents |

Each one exists for a reason. An agent wants a queue open all day on a desktop with a tray badge.
A customer wants a notification on their phone. That difference is the project.

Live chat runs on Laravel Reverb. Reverb speaks the Pusher protocol, so all three clients connect
with the same two libraries and near-identical code. Holding the realtime layer constant is
deliberate: it means the differences I find between the clients are platform differences, not
artefacts of using three different websocket clients.

## Constraints

Zero cost, and no deployment. Everything runs on one Mac.

That rules out real APNs push, TestFlight, and macOS code signing, all of which need the $99/year
Apple Developer Program. Push is still built end to end through Laravel's notification system, with
a local channel that writes the payload and feeds it to `xcrun simctl push`. The only untested hop
is server to Apple. That is written down in decision 0007 rather than left as an assumption.

## Layout

Four repos. This one is the parent and pins an exact commit of each client, so one reference names
the state of all three together.

```
relay/
├── docs/
├── backend-laravel/      -> relay-laravel
├── mobile-react-native/  -> relay-react-native
└── desktop-electron/     -> relay-electron
```

```bash
git clone --recurse-submodules https://github.com/raufkhandevs/relay.git
```

A plain `git clone` gives you empty directories. If you already did that:
`git submodule update --init --recursive`.

The submodule pointers move when a slice is finished, not on every commit. Mid-slice the parent is
behind on purpose.

## Docs

Start with [the design](docs/specs/2026-09-11-relay-design.md). The screen layouts are in
[the mockup](docs/relay-ui-mockup.html).

The decision records are the part I would actually read. Each one has the options I rejected and
what would change my mind:

| | |
|---|---|
| [0001](docs/decisions/0001-one-backend-three-clients.md) | One backend, three clients |
| [0002](docs/decisions/0002-reverb-for-realtime.md) | Laravel Reverb for realtime |
| [0003](docs/decisions/0003-sanctum-two-auth-modes.md) | Sanctum with two auth modes |
| [0004](docs/decisions/0004-postgres-over-sqlite.md) | Postgres over the Laravel 13 SQLite default |
| [0005](docs/decisions/0005-denormalise-last-message-at.md) | Denormalise `last_message_at` |
| [0006](docs/decisions/0006-generate-typescript-from-php.md) | Generate TypeScript from PHP |
| [0007](docs/decisions/0007-stub-push-locally.md) | Stub push delivery locally |
| [0008](docs/decisions/0008-three-repositories.md) | Four repositories, parent linking three submodules |

## Build order

Slice 1 is done when I type a message in the Electron console and it appears in the browser and on
the iOS simulator, without a refresh, in under a second. That one sentence forces both auth modes,
the websocket server, channel authorisation and three client runtimes to work at once.

After that: ticket lifecycle, attachments, push, presence, desktop tray behaviour, offline on
mobile, a Livewire twin of one screen for comparison, then packaging.
