# 0008. Four repositories, parent linking three submodules

Date: 2026-09-11
Status: accepted

## Context

Relay is one Laravel backend and three clients living in `backend-laravel`,
`mobile-react-native` and `desktop-electron`.
The shared design documents and decision records need a home, and the three applications need a
version control strategy.

## Options

**A. Three application repositories plus a parent that links them as submodules.**
Each application is versioned independently, matching how they would deploy and how the two client
contracts are likely structured.
A fourth repository holds the shared documents and pins an exact commit of each application, so one
reference names the state of the whole system.
Cost: a change spanning the API and a client is two commits in two repositories, the API contract
crosses a repository boundary, and submodules carry their own failure modes.

**B. One repository containing all three.**
Cross-client changes are atomic, one history, one place to look, and the shared `docs/` directory
sits naturally at the root.
Cost: it hides the coordination problem that exists in the real situation being learned, and the
three applications have three genuinely separate release cycles.

**C. One repository now, split when pushing.**
Frictionless early, defers the decision.
Cost: splitting later means either discarding per-application history or performing surgery with
`git filter-repo`, and the shared documents still need a home at that point.
The decision is not avoided, only postponed to a worse moment.

## Decision

Option A, with a parent repository at `raufkhandevs/relay` linking the three as submodules.

The friction in option A is the point.
An API contract crossing a repository boundary is precisely the situation that makes generated
types load bearing rather than a nicety, and it is the situation both contracts will present.
Feeling that friction is part of what this project exists to teach.

Documents live in the parent because they describe the whole system rather than the backend alone.

The parent's submodule pointers move at slice boundaries, not per commit.
Bumping the pointer on every child commit triples the git work during the phase where three
unfamiliar stacks are being learned at once, and buys nothing: the useful property of the parent is
that it names a state where all three clients work together, which is true at the end of a slice and
not in the middle of one.
The parent is a snapshot marker, not a live mirror.

## Consequences

- `docs/` stays where it is, at the root of the parent repository.
- The three applications join as submodules as each is scaffolded, not before.
  An empty directory cannot be a submodule.
- `.gitmodules` records public HTTPS URLs so the repository clones for anyone.
  Pushing over a personal SSH host alias is handled by a scoped `insteadOf` rewrite in local git
  config, never by putting the alias in a committed file.
- A plain `git clone` gives empty directories.
  `--recurse-submodules` is required, and is in the README.
- Generated TypeScript types are committed in each client repository so a client can be built
  without running the backend.
- A change spanning the API and a client is two commits.
  Neither repository can assume the other is at a particular version, which is realistic.
- The workspace root itself is not a repository and holds nothing but the three application
  directories.

## What would change my mind

If cross-repository coordination becomes the dominant cost rather than a lesson, one repository
with three workspaces is the pragmatic answer.
Worth revisiting after slice 3, once the contract has actually changed a few times under real use.

If submodules specifically turn out to cost more than the snapshot property is worth, the parent
drops to a plain documents repository with a clone script, and nothing else changes.
