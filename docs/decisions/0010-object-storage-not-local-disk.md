# 0010. Object storage for attachments, not the local disk

Date: 2026-09-12
Status: accepted

## Context

Attachments are the next feature. A customer photographs a broken screen, an agent sends back a
config file. The backend has to accept an upload, keep it somewhere, and serve it back only to
people allowed to see that ticket.

Laravel offers a local disk out of the box, and it costs nothing to use. The constraint on this
project is that nothing may cost money, so that has to be the starting position rather than an
afterthought.

## Options

**A. MinIO in Docker, spoken to with Laravel's S3 driver.**
MinIO implements the S3 API. One container, no account, no bill. The application code is the same
code it would run against real S3: the same driver, the same presigned URL flow, the same
private-by-default bucket.
Cost: a second container to keep running, and one Composer dependency for the S3 adapter.

**B. Laravel's local disk.**
Zero new infrastructure. Files land in `storage/app`, and a controller streams them back after a
policy check.
Cost: it teaches a pattern that does not survive. Files on the application server disappear the
moment a second server exists, and every byte served is a PHP process held open. The security
model is also different enough that the code has to be rewritten rather than reconfigured: there
are no presigned URLs to learn, only a streaming controller.

**C. A real S3 bucket.**
Closest to production, no container to run.
Cost: an AWS account and a bill. Ruled out by the project's constraint.

## Decision

Option A, MinIO.

The deciding argument is not durability or scale, neither of which this project needs. It is that
**A and B teach different things, and only one of them transfers.**

The interesting part of attachments is not storing bytes. It is that the bytes must be private,
and the mechanism for that in object storage is a presigned URL: the application authorises, then
hands the client a short-lived signed link and steps out of the data path. That is the pattern in
every contract that touches file uploads, and it does not exist on a local disk. Building B means
learning a streaming controller that gets deleted the first time this goes anywhere real.

Since MinIO is free and is one container, the version that transfers costs nothing extra.

## Consequences

- `docker compose up -d` now starts Postgres and MinIO. The run skill and README say so.
- `league/flysystem-aws-s3-v3` is added. It is the adapter Laravel's own `s3` driver requires, not
  a third-party convenience.
- The bucket is private. Nothing is publicly readable, and downloads go through short-lived
  presigned URLs rather than a permanent path.
- Credentials for local MinIO are `relay` / `relay-secret` and are not secret in any meaningful
  sense, exactly like the Postgres credentials already in `docker-compose.yml`. They live in
  `.env.example` so a fresh clone works.
- Switching to real S3 later is a change of four environment variables, with no application code
  touched. That is the property being bought.

## What would change my mind

If the upload path turned out to need server-side processing of every file, thumbnailing or virus
scanning, the application would be back in the data path and the presigned download would be doing
less work than it appears to. It would still be the right storage, but the argument above would be
weaker.
