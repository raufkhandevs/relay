# Relay slice 3: attachments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A customer can attach a photo from their phone or a file from the web, an agent can attach one from the desktop console, and everyone on the ticket can open them. Nobody else can.

**Spec:** `docs/specs/2026-09-11-relay-design.md`
**Storage:** `docs/decisions/0010-object-storage-not-local-disk.md`. Read it first.
**Design:** `docs/decisions/0009-one-design-system-two-densities.md`.

**Why this slice:** every feature since slice 1 has been the same problem solved three ways. Attachments are three genuinely different problems: a photo library picker on iOS, drag and drop on desktop, a file input on the web, over one upload contract. It also carries the first real file-security surface in the project.

## Global constraints

- **MinIO in Docker, spoken to with Laravel's `s3` driver.** Never the local disk. Decision 0010.
- **The bucket is private.** No public URLs, ever. Downloads are short-lived presigned URLs issued only after the policy allows it.
- **Validate server side, always.** A client-side accept filter is a convenience, not a control. Type and size are enforced in the request, and the stored content type comes from the file, not from what the client claimed.
- **Authorisation reuses `TicketPolicy`.** An attachment is readable exactly when its ticket is. Do not invent a second rule. This is the fourth surface to reach that policy, after HTTP, the websocket channel, and the Electron IPC proxy.
- **Never trust the original filename.** It is display metadata. The stored key is generated. A filename is a path traversal attempt waiting to happen.
- **Idempotency still applies.** An upload that is retried must not produce two attachments.
- Loading, empty, error and progress states designed. An upload with no progress feedback reads as a hang.
- **Never run `git push`.** Rauf pushes.
- No em dashes. Straight quotes only. Commit subjects imperative, under 72 chars, ending:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```

## Limits

Decided here so three clients do not each invent their own:

- **10 MB per file.** Enough for a phone photo, small enough that a bad upload fails fast.
- **One attachment per message.** The schema allows many; the UI sends one. Revisit when someone asks.
- **Accepted types:** `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`, `text/plain`. Everything else is refused with a readable reason. HEIC is on the list because it is what an iPhone actually produces.
- **Presigned download URLs live 5 minutes.** Long enough to click, short enough that a leaked link is worthless.

---

### Task 1: Storage, schema and the upload endpoint

**Repo:** `backend-laravel`

- [ ] **Step 1: Add MinIO to `docker-compose.yml`**

```yaml
    minio:
        image: minio/minio:latest
        container_name: relay-minio
        restart: unless-stopped
        command: server /data --console-address ":9001"
        environment:
            MINIO_ROOT_USER: relay
            MINIO_ROOT_PASSWORD: relay-secret
        ports:
            - '9000:9000'
            - '9001:9001'
        volumes:
            - relay-minio:/data
        healthcheck:
            test: ['CMD', 'mc', 'ready', 'local']
            interval: 5s
            timeout: 3s
            retries: 10
```

Add `relay-minio:` to the `volumes:` block. Run `npm run check:fix` afterwards: the project formatter policies YAML and a hand written block will fail CI on indentation alone.

- [ ] **Step 2: Create the bucket**

MinIO starts with no buckets. Create `relay-attachments` as a **private** bucket. Do it in a way that survives a fresh `docker compose up` on another machine: either a one-shot `mc` sidecar service in compose, or an idempotent artisan command the run skill calls. Say which you chose and why. Verify the bucket is not publicly readable by fetching an object's URL without a signature and confirming it is refused.

- [ ] **Step 3: Configure the disk**

```bash
composer require league/flysystem-aws-s3-v3
```

Add an `attachments` disk in `config/filesystems.php` using the `s3` driver, pointed at MinIO. It needs `endpoint`, `use_path_style_endpoint => true` (MinIO does not do virtual-host style), and `'visibility' => 'private'`.

`.env` is permission-denied on this machine: append keys with `>>`, and mirror them into `.env.example` with the same values, since MinIO's local credentials are no more secret than the Postgres ones already there.

- [ ] **Step 4: The migration**

`attachments`: `id`, `message_id` constrained and cascade on delete, `disk_path` (the generated key), `original_name`, `mime`, `size_bytes`, timestamps. Index `message_id`.

Note the column is `disk_path`, not `path`: the spec called it `path`, and `path` invites someone to treat it as a filesystem path. It is an opaque object key.

- [ ] **Step 5: The model and the relationship**

`Attachment` belongs to `Message`; `Message` has many `Attachment`. Add `attachments` to `MessageData` so every client sees them on the message they already render. The generated TypeScript picks this up, so run `composer types`.

- [ ] **Step 6: Write the failing tests first**

In `tests/Feature/Api/AttachmentTest.php`, and these are the point of the task:

- A ticket participant can upload, and the attachment comes back on the message.
- **A stranger cannot upload to a ticket they cannot see.** 403.
- **A stranger cannot download an attachment on a ticket they cannot see.** 403. This is the IDOR test and it is the most valuable one here.
- A file over 10 MB is refused with 422.
- A disallowed type is refused with 422, and the check is on the real content, not the client's claimed type. Upload a `.txt` renamed to `.png` and confirm it is judged as text.
- An upload retried with the same idempotency key produces one attachment, not two.
- The stored key is generated, not the original filename. Upload `../../etc/passwd` as a name and confirm the key is unaffected.

Run them, watch them fail, then implement.

- [ ] **Step 7: The endpoints**

```
POST /api/tickets/{ticket}/messages   now accepts an optional file alongside body
GET  /api/attachments/{attachment}    authorises, then redirects to a presigned URL
```

Sending a message with a file should stay one request. A separate upload-then-attach dance is two round trips and an orphaned-object problem when the second call fails.

The download endpoint authorises against `TicketPolicy` and then issues a presigned URL with a 5 minute expiry. The application never streams the bytes.

- [ ] **Step 8: Verify by hand as well as by test**

Upload a real file with curl, fetch it back through the download endpoint, and confirm the presigned URL works and that the same URL is refused after expiry, or that an unsigned URL is refused outright. Paste the output.

- [ ] **Step 9: `php artisan test`, `npm run check`, `npm run types:check`, `npm run build`, phpstan. All clean. Commit.**

---

### Task 2: Web client

**Repo:** `backend-laravel`, `resources/js`

- [ ] A file control in the composer, plus drag and drop onto the thread. Accept filter matching the server's list, as a convenience only.
- [ ] Chosen file shows as a removable chip before sending, with its name and size. Sending with no body but a file is allowed; sending nothing is not.
- [ ] Upload progress. An upload with no feedback reads as a hang, and a phone photo over a slow link is exactly when that bites.
- [ ] Attachments render on the message: images inline with `max-width` and a real `aspect-ratio` box so nothing shifts when they load, other types as a labelled link with size.
- [ ] Clicking fetches through `/api/attachments/{id}` so the policy runs. Never a stored URL in the markup.
- [ ] Failure leaves the message with a retry, same as a failed send today.
- [ ] Verify by driving two browser contexts: upload as Priya, confirm the agent sees it, and confirm a third signed-in user who is on neither ticket gets a 403 fetching it directly.

---

### Task 3: iOS client

**Repo:** `mobile-react-native`

- [ ] `npx expo install expo-image-picker`. Native module, so `npx expo run:ios`, not a reload.
- [ ] An attach control in the composer opening the photo library. **Ask for permission at the point of use, not at launch**, and handle refusal with a readable explanation rather than a dead button.
- [ ] The simulator has no camera. Library only in this slice, and say so in the report rather than faking a camera path.
- [ ] iPhones produce HEIC. Send what the picker gives and let the server judge the real type; do not assume JPEG.
- [ ] Chosen image previews before sending, removable.
- [ ] Images render inline in the thread at a sensible max height, others as a labelled row.
- [ ] Upload progress, and a retry on failure.
- [ ] Verify with Maestro: attach, send, confirm it appears, and confirm it arrives on another client.

---

### Task 4: Desktop console

**Repo:** `desktop-electron`

- [ ] **Drag and drop onto the thread**, which is the reason a desktop client exists. A file input as a fallback.
- [ ] **The renderer must not read the file from disk.** A dropped file gives the renderer a `File` object, which is fine, but do not add an IPC channel that takes a path and reads it: that hands the renderer arbitrary filesystem read through main. If you need main to do the upload, pass the bytes, not a path. Say what you chose.
- [ ] One new named IPC method at most, validated in main like the others. Do not widen the bridge.
- [ ] Drop target shows a clear state while dragging. Attachments render inline as on the other clients, at agent density.
- [ ] Verify by driving the packaged app with Playwright `_electron`: attach a file, send, confirm it appears and arrives elsewhere.

---

### Task 5: Security pass and docs

- [ ] **Run `security-auditor` on the whole slice.** It touches file upload, a new storage service, a new public endpoint and a new dependency. Every one of those is on the project's own escalation list.
- [ ] Update the three READMEs and run skills: MinIO is now part of `docker compose up`, and the console is at `localhost:9001`.
- [ ] Update the run skill's realtime checklist with an attachments equivalent: bucket exists, credentials match, presigned URL not expired.
- [ ] Commit, bump the parent's submodule pointers, hand Rauf the push commands.

---

## Done when

- A file attached on any client appears on the other two.
- A user not on the ticket gets 403 both uploading and downloading. Proven by test and by hand.
- A `.txt` renamed `.png` is judged as text, and an 11 MB file is refused.
- The stored key owes nothing to the original filename.
- No attachment is reachable without a signature.
- All three suites clean, and the security audit has no blocking findings.

## Not in slice 3

Multiple attachments per message, camera capture, thumbnails, virus scanning, drag and drop on mobile, resumable uploads.
