# Relay slice 1B: Electron agent console implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS desktop app where an agent signs in, sees the ticket queue, opens a thread, and watches a customer's message arrive live.

**Architecture:** electron-vite with three processes kept straight: main is Node, preload is a narrow typed bridge, renderer is a browser running React. The renderer never touches Node. Token auth against the Laravel API, token held in the OS keychain via Electron's `safeStorage` and owned by the main process, never by the renderer. Realtime through `laravel-echo` and `pusher-js` against the same Reverb server the web and iOS clients use.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, TanStack Query, laravel-echo, pusher-js.

**Spec:** `docs/specs/2026-09-11-relay-design.md`

**Backend:** `backend-laravel`, complete. Start it with `docker compose up -d && composer dev`.

## Global constraints

- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.** Not negotiable and not "just for development". Turning any of them off converts a renderer XSS into filesystem and process access.
- **The `contextBridge` surface is narrow, explicit and typed.** Never expose `ipcRenderer` itself. Never expose a handler taking an arbitrary path, URL, command or SQL string from the renderer.
- **Main validates every IPC payload.** The renderer is a browser; treat it exactly like a public HTTP endpoint.
- **The token never reaches the renderer.** Main holds it in `safeStorage` and attaches it to requests. A renderer that cannot read the token cannot leak it through an XSS. This is the single biggest structural difference from the web client, and it is the point of building this one.
- **Nothing secret ships in the bundle.** `npx asar extract app.asar out/` reads all of it. The Reverb app key is public by design; the Reverb secret never appears here.
- **Writes go to `app.getPath('userData')`**, never inside the app bundle.
- Package unsigned from day one (`--dir`), not release week. Path assumptions and unpackaged files only exist in packaged builds.
- Signing and notarisation are out of scope on cost grounds. Document the gap, do not fake it.
- Testing is light, as with 1C. Verification is running the app and looking at it.
- **Never run `git push`.** Rauf pushes. Commit locally and hand him the command.
- No em dashes. Straight quotes only. Commit subjects imperative, under 72 chars, ending:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```

## Carried forward from 1A and 1C

Every one of these cost real time already. None should be rediscovered.

- **`.gitignore` covers `.env*` before the first commit**, not after. A key reached a public repo that way.
- **Echo needs `authEndpoint` set explicitly** to `${API_BASE}/api/broadcasting/auth`. The default `/broadcasting/auth` does not exist on this backend.
- **`listen()` event names take a leading dot**: `.message.created`. Without it Echo matches nothing, silently.
- **pusher-js's default export may be a namespace, not the class.** On React Native it exports `Pusher` as a named export. Check what the web build actually gives you before assuming; `typeof Pusher` in a log settles it in seconds. Do not spend rounds theorising about module resolution.
- **The paginated response has no `meta` wrapper.** `data`, `next_cursor` and `total` are top level.
- **Nested users are `Participant` (`id`, `name`, `role`) with no email.** Only `/api/me` and the login response return an email.
- **Sign out must revoke server side** (`DELETE /api/tokens/current`) and clear the query cache. A token that outlives its session is a leaked credential; a cache that outlives it shows the next user the previous user's data.
- **Give interactive elements stable ids** so automation addresses them by identity, not position.

## API contract

```
POST   /api/tokens                      {email, password, device_name} -> {token, user}
DELETE /api/tokens/current              revoke this device only
GET    /api/me                          -> User (has email)
GET    /api/tickets                     -> {data: Ticket[], current_page, per_page, total}
GET    /api/tickets/{id}/messages       -> {data: Message[], next_cursor, prev_cursor}
POST   /api/broadcasting/auth           channel auth, bearer token
```

Channel `private-ticket.{id}`, event `.message.created`, payload a `Message`.

---

### Task 1: Scaffold, run, create the repo

**Files:** the whole `desktop-electron/` app.

- [ ] **Step 1: Confirm the backend is up**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000
```

Expected `200`. If not: `cd ../backend-laravel && docker compose up -d && composer dev`.

- [ ] **Step 2: Scaffold**

```bash
cd /Users/apple/work/app-development
npm create @quick-start/electron@latest desktop-electron -- --template react-ts
cd desktop-electron && npm install
```

Run the generator's `--help` first if it prompts; you have no TTY. Read what it actually produced before assuming a layout: electron-vite projects normally have `src/main`, `src/preload` and `src/renderer`.

- [ ] **Step 3: Lock down secrets before the first commit**

Append to `.gitignore`:

```
.env
.env.*
!.env.example
```

Do this now. The backend repo published a key because this happened after its first commit.

- [ ] **Step 4: Verify the security posture the template shipped with**

```bash
grep -rn "contextIsolation\|nodeIntegration\|sandbox" src/main
```

Confirm `contextIsolation` is true, `nodeIntegration` is false and `sandbox` is true. If the template set any of them otherwise, fix it now and say so in your report. This is the security baseline everything else assumes.

- [ ] **Step 5: Run it**

```bash
npm run dev
```

A window should open. Screenshot it with `screencapture -x /tmp/electron-scaffold.png` and confirm the file is non-trivial in size. Do not claim it ran without that.

- [ ] **Step 6: Package it unpacked, now rather than later**

```bash
npm run build
npx electron-builder --dir
ls -la dist/mac*/
```

This is the day-one packaging check. It catches path assumptions and unpackaged files while they are cheap. Report whether it succeeded; if the template has no builder config yet, say so and defer to Task 5.

- [ ] **Step 7: Commit**

```bash
git init -b main
git add -A
git commit -m "Add Electron app with electron-vite and React

contextIsolation, sandbox and nodeIntegration are at their secure defaults
from the first commit, and .env rules are in .gitignore before it rather
than after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

- [ ] **Step 8: Hand Rauf the push commands.** Do not run them.

```bash
cd /Users/apple/work/app-development/desktop-electron
gh repo create raufkhandevs/relay-electron --public \
  --description "Relay support desk agent console: Electron, React, TypeScript"
git remote add origin https://github.com/raufkhandevs/relay-electron.git
git push -u origin main
```

---

### Task 2: The main-process API client and keychain-held token

**Files:**
- Create: `src/main/api.ts`, `src/main/auth.ts`, `src/main/ipc.ts`
- Create: `src/preload/index.ts` (replace the template's)
- Create: `src/shared/types.ts`
- Modify: `src/main/index.ts`

**Produces:** a `window.relay` bridge exposing `signIn`, `signOut`, `me`, `tickets`, `messages` and `channelAuth`. The token lives in main, in `safeStorage`, and is never sent to the renderer.

- [ ] **Step 1: Write the shared types**

`src/shared/types.ts`, used by main, preload and renderer alike:

```ts
export type Role = 'customer' | 'agent';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

/** Nested in tickets and messages. Deliberately has no email. */
export type Participant = { id: number; name: string; role: Role };

/** Only for the signed-in user, from /api/me and the login response. */
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

/** Laravel's paginators. No meta wrapper on either. */
export type Paginated<T> = { data: T[]; current_page: number; per_page: number; total: number };
export type CursorPaginated<T> = { data: T[]; next_cursor: string | null; prev_cursor: string | null };
```

- [ ] **Step 2: Write the token store, in main**

`src/main/auth.ts`. Use Electron's `safeStorage` to encrypt the token, and write the ciphertext under `app.getPath('userData')`. Check `safeStorage.isEncryptionAvailable()` and fail loudly rather than silently falling back to plaintext.

Expose `getToken()`, `setToken(token)`, `clearToken()`. These are main-process only. Nothing in this file is reachable from the renderer.

- [ ] **Step 3: Write the API client, in main**

`src/main/api.ts`, attaching `Authorization: Bearer` from `getToken()`. Same shape as the mobile client: `get`, `post`, `delete`, throwing a typed error carrying the HTTP status.

`API_BASE` is `http://localhost:8000`.

- [ ] **Step 4: Write the IPC handlers**

`src/main/ipc.ts`, registering exactly these channels and no others:

- `relay:signIn` takes `{email, password}`, calls `POST /api/tokens`, stores the token, returns only the `User`. **It must not return the token.**
- `relay:signOut` calls `DELETE /api/tokens/current`, then clears the stored token. Best effort on the network call; clear locally regardless.
- `relay:me` returns `GET /api/me`.
- `relay:tickets` returns `GET /api/tickets`.
- `relay:messages` takes a numeric `ticketId`, returns `GET /api/tickets/{id}/messages`.
- `relay:channelAuth` takes `{socketId, channelName}` and returns the body of `POST /api/broadcasting/auth`. This is how the renderer authorises a websocket channel without ever holding the token.

**Validate every payload.** `ticketId` must be a positive integer; reject anything else rather than passing it through. `channelName` must match `private-ticket.<digits>`; reject anything else. The renderer is a browser and is treated as hostile.

- [ ] **Step 5: Write the preload bridge**

`src/preload/index.ts`, exposing a narrow typed object via `contextBridge.exposeInMainWorld('relay', {...})`. Each method is a thin `ipcRenderer.invoke` of one named channel. **Never expose `ipcRenderer` itself, and never a generic `invoke(channel, ...args)`** which would let a compromised renderer call any handler.

Declare the shape for the renderer in a `global.d.ts` so `window.relay` is typed.

- [ ] **Step 6: Verify the boundary holds, by trying to break it**

With `npm run dev` running, open devtools in the renderer and evaluate:

```js
typeof window.require          // expect "undefined"
typeof window.process          // expect "undefined"
typeof window.relay.invoke     // expect "undefined"
Object.keys(window.relay)      // expect exactly the methods you exposed
```

Then try to read the token from the renderer by any route you can think of, and confirm you cannot. Report what you tried. A boundary you have not attacked is a boundary you have not tested.

- [ ] **Step 7: Commit**

Subject: `Hold the auth token in main, never the renderer`. The body should explain that the renderer cannot leak a token it never receives, and that channel auth is proxied through main for the same reason.

---

### Task 3: Login and the ticket queue

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/screens/Login.tsx`, `src/renderer/src/screens/Queue.tsx`, `src/renderer/src/queries.ts`

**Produces:** a login screen and a ticket queue, both driven through `window.relay`.

- [ ] **Step 1: Wire TanStack Query** at the renderer root.

- [ ] **Step 2: Build the login screen.** Email, password, submit. Visible loading and error states. A wrong password returns 422 and too many attempts returns 429; both need readable messages. Prefill `agent@relay.test` / `password` in development only.

- [ ] **Step 3: Build the queue.** A list of tickets from `relay:tickets`, ordered as the API returns them, showing subject, `TKT-{id}` and status. Clicking a row selects it.

Loading, empty and error states all designed. Loading is skeleton rows at the real height so nothing shifts; nothing at all under about 200ms.

Give each row a stable `id` or `data-testid` so automation can address it.

- [ ] **Step 4: Verify by using it.** Run it, sign in as the agent, confirm five tickets. Sign out, sign in as `priya@relay.test`, confirm one. That difference is the server-side policy visible in a third client. Screenshot both.

Stop the backend and confirm the error state renders, then restart it. Screenshot.

- [ ] **Step 5: Commit.**

---

### Task 4: The live thread

**Files:** `src/renderer/src/screens/Thread.tsx`, `src/renderer/src/echo.ts`

**Produces:** a thread that renders history and appends messages pushed over Reverb.

This is the task the slice exists for.

- [ ] **Step 1: Install**

```bash
npm install laravel-echo pusher-js
```

- [ ] **Step 2: Check what pusher-js actually exports before writing against it**

```js
console.log('typeof Pusher:', typeof PusherImport, Object.keys(PusherImport ?? {}));
```

On React Native it is a namespace with a named `Pusher`. On the web build it may be a plain default. **Log it and read the answer.** On 1C, three rounds were spent theorising about this from package.json fields when two log lines settled it.

- [ ] **Step 3: Configure Echo with a custom authorizer**

This client has no cookie and must not hold the token, so it cannot use the default authorizer. Supply a custom one that calls `window.relay.channelAuth({socketId, channelName})` and hands the result back:

```ts
authorizer: (channel) => ({
    authorize: (socketId, callback) => {
        window.relay
            .channelAuth({ socketId, channelName: channel.name })
            .then((data) => callback(null, data))
            .catch((error) => callback(error, null));
    },
}),
```

Main attaches the bearer token. The renderer never sees it. This is the same `/api/broadcasting/auth` endpoint and the same `TicketPolicy` that the web client reaches with a cookie and the iOS client reaches with a bearer header: three clients, three credentials, one rule.

- [ ] **Step 4: Subscribe**

`private-ticket.{id}`, listening for `.message.created` with the leading dot. Deduplicate incoming messages by `id`, because the sender receives their own broadcast. Leave the channel on unmount, or navigating between tickets accumulates subscriptions and a message renders several times.

- [ ] **Step 5: Build the thread.** History from `relay:messages`, newest first so reverse for display. Author name and body, the agent's own messages visually distinct. No composer; sending is a later slice.

- [ ] **Step 6: Verify the thing the slice is for**

Backend running, app open, signed in as the agent, a thread open. From a terminal:

```bash
cd /Users/apple/work/app-development/backend-laravel
TOKEN=$(curl -s -X POST http://localhost:8000/api/tokens -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@relay.test","password":"password","device_name":"cli"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:8000/api/tickets/1/messages \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"body\":\"desktop check $(date +%T)\",\"idempotency_key\":\"$(uuidgen | tr 'A-Z' 'a-z')\"}"
```

The message must appear in the desktop window with no interaction. Screenshot it with `screencapture -x`.

Then open the same ticket in a browser and on the iOS simulator, and post once more. **All three must show it at once.** That screenshot is the deliverable of this entire project.

If nothing arrives, check in order: is `reverb:start` running; does the renderer console show a failed `channelAuth`; does `listen()` start with a dot; is `typeof Pusher` a function.

- [ ] **Step 7: Commit.**

---

### Task 5: Packaging, docs and conventions

**Files:** `electron-builder.yml`, `README.md`, `CLAUDE.md`, `.claude/skills/run-app/SKILL.md`

- [ ] **Step 1: Package unsigned and run the packaged app**

```bash
npm run build && npx electron-builder --dir
open dist/mac*/Relay*.app
```

It must launch and reach the login screen. Bugs that only exist in packaged builds live here: absolute asset paths under `file://`, files missing from the `files` glob, writes attempted inside the app bundle. Fix what you find and say what it was.

- [ ] **Step 2: Document the signing gap honestly**

Signing and notarisation need a paid Apple Developer account, which is out of scope. Write down in the README exactly what would be required and what does not work without it: other people cannot open the app, and `electron-updater` cannot complete an update on macOS because Squirrel verifies the signature first. Do not imply it is done.

- [ ] **Step 3: Write the README.** What it is, that the backend must be running, how to start it, the seeded accounts, and the desktop-specific traps: the three processes and which code runs where, why the token lives in main, and that `--dir` packaging is a day-one habit.

- [ ] **Step 4: Write `CLAUDE.md`.** The security posture as non-negotiable, the narrow bridge rule, IPC validation, the token boundary, and never `git push`.

- [ ] **Step 5: Write the run skill**, covering `npm run dev`, the packaged run, and a realtime checklist matching the other two repos.

- [ ] **Step 6: Commit, then hand Rauf the push command.**

---

## Done when

- The app runs from `npm run dev` and as an unsigned packaged `.app`.
- An agent signs in, sees five tickets; Priya sees one.
- A message posted from a terminal appears in an open thread with no interaction.
- `window.require`, `window.process` and a generic `invoke` are all undefined in the renderer, and the token cannot be read from it.
- The same message appears in the browser, on the iOS simulator and in the desktop window at once.

## Not in 1B

Sending messages, tray icon and unread badge, global hotkey, deep links, auto-update, code signing and notarisation. Slices 2 and 6.
