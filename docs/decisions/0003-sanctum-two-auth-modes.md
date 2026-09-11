# 0003. Sanctum with two auth modes

Date: 2026-09-11
Status: accepted

## Context

Three clients need authenticating against one Laravel application.
The web client is server-driven through Inertia and runs in a browser.
The iOS and Electron clients are native and consume a JSON API.

## Options

**A. Sanctum, session cookie for the browser and personal access tokens for native clients.**
One installation covers both.
The browser gets an `httpOnly`, `Secure`, `SameSite` cookie with CSRF protection.
Native clients exchange credentials for an opaque token at `POST /sanctum/token` and send it as a
bearer token.
Cost: two mechanisms to understand rather than one.

**B. JWT everywhere.**
One mechanism for all three clients, stateless, no session store.
Cost: a JWT must live somewhere on the web client, and in a browser that means `localStorage`,
which turns any XSS into token exfiltration.
Revocation requires a server-side denylist, which is the database table that was supposedly
avoided.
Rejected on the project's own standing rules.

**C. Sanctum SPA cookie mode for all three.**
Cookies for everything, including native.
Cost: cookie authentication depends on a browser cookie jar and a same-origin relationship.
Native clients have neither, and forcing it produces fragile CORS and stateful-domain
configuration for no benefit.

## Decision

Option A.

The rule is cookies for browsers, tokens for everything else.
A cookie is the right credential when the user agent is a browser that enforces same-origin and
`httpOnly`.
A native application is not that, so it gets a token it stores in platform secure storage: the iOS
Keychain via `expo-secure-store`, and `safeStorage` in Electron.

A Sanctum token is an opaque database row, not a signed claim.
That means it can be revoked instantly server side, scoped, listed per device so a user can see
every session, and expired.
A JWT can do none of these without reintroducing exactly the table Sanctum already provides.

## Consequences

- Websocket channel authorisation accepts either credential.
  Both clients hit `/broadcasting/auth`, the browser with its cookie and the native clients with a
  bearer token, and the same policy decides.
- Logout must revoke the current token only, not every token, so signing out on the phone does not
  sign the user out on the desktop.
- Tokens must never be written to `AsyncStorage` or `localStorage`.
  The security auditor checks for this.

## What would change my mind

A third-party client outside our control needing access, which would call for OAuth flows rather
than password-for-token exchange.
Not applicable to three first-party clients.
