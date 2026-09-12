# Tooling

How Relay's three clients get driven and verified. None of this is a dependency of any app; it is
kept here so that reinstalling an app's dependencies cannot delete the ability to test it, which is
what happened when Playwright lived in `backend-laravel/node_modules` untracked.

```bash
cd .tooling && npm install
```

## Driving each client

| Client | Tool | How |
|---|---|---|
| Web | Playwright chromium | `chromium.launch()` against `http://localhost:8000` |
| Desktop | Playwright `_electron` | `_electron.launch({ executablePath })` on the packaged `.app` |
| iOS | Maestro | `~/.maestro-install/maestro/bin/maestro test flow.yaml` |

Playwright drives the Electron app by launching it as a child process and attaching over the
DevTools protocol, so it reads the real DOM and clicks real elements exactly as it does on the web.
That sidesteps macOS screenshot and focus problems entirely: `screencapture` grabs the whole screen
and the terminal keeps focus, and the window id is not readable without pyobjc.

## Addressing elements

By `data-testid` on web and desktop, by `testID` on iOS. Never by visible text on iOS: React Native
`Text` frequently does not reach the accessibility tree, so a text matcher reports a missing element
that is plainly on screen. That produced a test failure a screenshot disproved, which is the
dangerous direction for a test to be wrong in.

## Scripts

Ad hoc scripts live in `/tmp`, never in a repo. `three-way.mjs` is the one worth keeping in mind:
it signs into all three clients, sends one message from the desktop console, and asserts it arrives
on the other two.
