# Hiring Portal

A two-sided hiring portal: external recruiting agencies submit candidates through their own
logins, website leads flow in from a Google Sheet, and everything lands in one funnel you
control.

- **Agency side** (`/agency`) — each agency signs in, sees only the roles you've assigned it,
  submits several candidates at a time with resumes and your qualifying questions, and follows
  the stage each candidate has reached.
- **Your side** (`/funnel`) — every candidate from every source in one pipeline, with
  shortlisting, calls, interview rounds, notes, reporting, and a full audit trail.

## Table of contents

- [How it works](#how-it-works)
- [The data model](#the-data-model)
- [Getting started](#getting-started)
- [Deploying](#deploying)
- [Connecting your Google Sheet](#connecting-your-google-sheet)
- [Resumes in Google Drive](#resumes-in-google-drive)
- [Day-to-day use](#day-to-day-use)
- [Testing](#testing)
- [Project layout](#project-layout)

## How it works

### Agencies only see what you assign them

An agency is a first-class record with its own logins. Access is granted **per role** through
`agency_job_assignments`, so an agency's submit form contains exactly the roles you've given
it — nothing else. Revoking access is one toggle, and pausing an agency signs its users out
immediately.

Every agency-side query runs through `src/lib/tenancy.ts`, which injects `agencyId` from the
session. Agency routes are forbidden by ESLint from importing Prisma directly, so a query that
forgets to scope itself fails the build rather than leaking a rival's candidates.

### The same person is never counted twice

A **Candidate** is a human being, deduplicated globally on normalised email or phone. An
**Application** is that person against one role. `applications` carries a unique constraint on
`(candidateId, jobRoleId)`, which means a second agency physically cannot open a competing
application for someone already in the pipeline for that role.

The blocked attempt isn't discarded — it's written to `duplicate_submissions` with who tried,
when, and who already held the candidate. That table is your evidence when two agencies both
claim a placement fee. Each agency has an `ownershipWindowDays` (default 90) recorded on every
submission, matching the standard 30/60/90-day contract term.

Deduplication matches on email and phone only, never on name: "Rahul Sharma" is not an
identity, and wrongly merging two people is far more damaging than an occasional duplicate row.

### Qualifying questions are yours, per role

Each role carries its own question set — eight field types, drag-to-reorder, with a live
preview of the exact form agencies will see. Any numeric, boolean or choice question can carry
a **screening rule** ("notice period at most 30 days", "must know Go or Java", "willing to
relocate").

Failing a screener **flags** a candidate; it never rejects one. The candidate still arrives in
Received with a visible warning, because the call on a borderline person is yours. Agencies are
never told which questions are screeners or what the thresholds are.

### The funnel is data, not code

Stages live in the `stages` table with a `sortOrder` and a `kind`. Rename "Called" to
"Screened", insert a fourth interview round, or recolour the board from **Settings** — no
migration. Application logic branches on `kind` (`ACTIVE` / `WON` / `LOST` / `HOLD`), never on
a stage name, so reporting survives any renaming.

The funnel ships seeded with:

| # | Stage | Kind |
|---|---|---|
| 1 | Received | ACTIVE (entry stage) |
| 2 | Shortlisted | ACTIVE |
| 3 | Called | ACTIVE |
| 4 | Tele interview | ACTIVE |
| 5 | Interview scheduled | ACTIVE |
| 6 | Interviewed — Round 1 | ACTIVE |
| 7 | Interviewed — Round 2 | ACTIVE |
| 8 | Interviewed — Round 3 | ACTIVE |
| 9 | Accepted | WON |
| 10 | Rejected by candidate | LOST |
| 11 | Longer notice period | HOLD — parked, revivable, excluded from active counts |
| 12 | Not selected | LOST |

Every move writes an immutable `stage_transitions` row recording who moved whom, when, and
why. `applications.currentStageId` is a cache of the newest transition, written in the same
transaction, so the board stays fast without ever disagreeing with the history.

### Website leads arrive on their own

Two triggers, one code path. An Apps Script webhook fires the instant a row lands in your
sheet, and a Vercel Cron job pulls every 10 minutes as a safety net — because Apps Script
triggers get silently disabled and nobody notices until a week of leads has gone missing.

Running both is safe: every row is keyed by a content hash in `imported_rows`, so whichever
arrives second is a no-op. Rows that can't be mapped are stored as `NEEDS_REVIEW` with the
reason and surfaced in the UI, never silently dropped.

## The data model

PostgreSQL via Prisma 7. Full schema in [`prisma/schema.prisma`](prisma/schema.prisma).

**Identity** — `agencies`, `users` (ADMIN / RECRUITER / AGENCY_OWNER / AGENCY_RECRUITER),
`sessions` (database-backed, so access can be cut mid-day), `invitations`.

**Roles** — `job_roles`, `agency_job_assignments` (the permission grant, with an optional
per-agency submission cap), `screening_questions`.

**People** — `candidates` (the human, unique on email and on phone), `applications` (unique on
candidate × role), `application_answers` (typed columns, not a JSON blob, so "notice ≤ 30 days
and expected CTC under X" stays an indexed query), `duplicate_submissions`.

**Funnel** — `stages`, `stage_transitions` (append-only), `interviews`, `notes` (INTERNAL by
default; sharing with an agency is a deliberate act), `activity_log`.

**Infrastructure** — `files`, `sheet_sources`, `imported_rows`, `sheet_sync_runs`, `email_log`.

Three consistency rules are enforced by the database itself, not just by application code:

- an agency user must have an agency, and an internal user must not;
- an `AGENCY`-sourced application must name its agency, and a non-agency one must not;
- exactly one stage can be the entry stage.

## Getting started

Requires Node 22+ and PostgreSQL 14+.

```bash
git clone https://github.com/Rubanzer/Hiring-Portal.git
cd Hiring-Portal
npm install

cp .env.example .env
# At minimum, set DATABASE_URL and SESSION_SECRET.
# Generate a secret with: openssl rand -base64 48

npm run db:deploy    # create the schema
npm run db:seed      # funnel stages + your first admin account
npm run dev
```

Open http://localhost:3000 and sign in with the admin credentials the seed printed.

To explore with realistic data — two agencies, two roles with screening questions, candidates
already in the funnel, and a blocked cross-agency duplicate:

```bash
npm run db:demo
```

### First-run checklist

1. **Settings → Integrations** — confirm what's configured. The app runs without storage,
   email or Sheets; those features degrade with a clear message rather than breaking.
2. **Roles** — create a role, set it to **Open**, add its qualifying questions.
3. **Agencies** — add an agency, then create a login for their recruiter (they get an emailed
   invite; if email isn't configured, the UI hands you a copyable link).
4. **Agencies → assign a role** — optionally with a submission cap.
5. **Settings → Google Sheets** — point the portal at your leads spreadsheet.

## Deploying

Built for Vercel plus a managed Postgres, but it's a standard Next.js app and runs anywhere.

The build is designed to succeed **before** anything is configured — it generates the Prisma
client, skips migrations when no database is set, and compiles. That ordering matters: you need
a deployed project in order to attach a database to it.

### 1. Create the database

Neon's free tier is the quickest. Create a project and copy **both** connection strings from the
dashboard:

- the **pooled** one (host contains `-pooler`) → `DATABASE_URL`
- the **direct** one → `DIRECT_DATABASE_URL`

Serverless functions each open their own connections, so the app must go through the pooler.
Migrations must not: DDL over a transaction pooler fails on advisory locks. Supabase is the same
idea — Supavisor on port 6543 for the app, port 5432 direct for migrations. With a single
non-pooled database, set `DATABASE_URL` only and leave `DIRECT_DATABASE_URL` empty.

### 2. Import the repo into Vercel

Framework detection and build settings need no changes.

### 3. Set the environment variables

**Required — the app returns an error on every request without these:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Pooled connection string |
| `SESSION_SECRET` | 32+ random characters — `openssl rand -base64 48`. Changing it signs everyone out |
| `APP_URL` | Your real domain. Invite links point here, so localhost means broken invites |

**Recommended:**

| Variable | Notes |
|---|---|
| `DIRECT_DATABASE_URL` | Direct connection string, used only by migrations |
| `CRON_SECRET` | `openssl rand -hex 32`. Without it the sync endpoint rejects Vercel's cron |
| `SHEETS_WEBHOOK_SECRET` | `openssl rand -hex 32`. Needed for the Apps Script push |

**Optional — each switches on a feature, and Settings → Integrations says so when one is
missing:** `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` (one service account, used for
both Drive and Sheets), `GOOGLE_DRIVE_FOLDER_ID` (resume storage and in-portal preview),
`RESEND_API_KEY` (invite and notification emails).

### 4. Deploy

Each build runs `prisma generate`, then `prisma migrate deploy` **if** a database is configured,
then `next build`. So a schema change reaches production by pushing — no terminal step. Before
you've set `DATABASE_URL` the migration is skipped with a log line rather than failing the build.

### 5. Seed the first admin

One manual step, once, to create the funnel stages and your login:

```bash
DATABASE_URL="<direct connection string>" \
SEED_ADMIN_EMAIL="you@yourcompany.com" \
SEED_ADMIN_PASSWORD="<a strong password>" \
npm run db:seed
```

Then sign in at your domain. `vercel.json` already registers the 10-minute Sheets sync;
schedules more frequent than daily need a Vercel Pro account.

**Resume storage** is Google Drive — see [Resumes in Google Drive](#resumes-in-google-drive).

Running cost at typical volume: roughly $0–25/month, since Drive comes with your Workspace
seat rather than being billed separately.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `PrismaConfigEnvError: Cannot resolve environment variable` | An older checkout. `prisma.config.ts` must read `process.env` and omit `datasource` when unset |
| Build dies at "Collecting page data" | Something reads env at module scope. The Prisma client in `src/lib/db.ts` is deliberately lazy for this reason |
| `Invalid environment configuration` on first request | A required variable is missing. The message names it |
| `Hobby accounts are limited to daily cron jobs` | Either move to Pro or set `vercel.json` to a daily schedule |
| Connection limit errors under load | `DATABASE_URL` is the direct string; switch it to the pooled one |
| `403 storageQuotaExceeded` on upload | `GOOGLE_DRIVE_FOLDER_ID` points into someone's My Drive. It has to be a folder in a **Shared Drive** |
| "The resume folder isn't reachable" | The service account isn't a member of that Shared Drive, or the folder id is wrong |
| Resumes over ~4.5 MB fail to download | A read path is buffering instead of streaming. `npm test` covers this |

## Connecting your Google Sheet

1. In Google Cloud: create a project, enable the **Google Sheets API**, create a **service
   account**, and download a JSON key.
2. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` (paste the whole key; literal
   `\n` sequences are handled).
3. Share your leads spreadsheet with that service account email — **viewer** access is enough.
   The portal only ever reads.
4. In the portal: **Settings → Google Sheets**. Paste the spreadsheet URL, name the tab, and
   click **Read columns from the sheet**. Map the real headers to candidate fields, pick a
   default role, and save.
5. Click **Import now** to pull in existing rows.
6. Optional, for instant imports: copy the generated Apps Script from that page into
   **Extensions → Apps Script** on your sheet and add an *On form submit* trigger. The
   scheduled pull catches anything the script misses.

The webhook payload only names *which* sheet changed — the portal then reads it with its own
credentials. A leaked webhook secret can trigger an import but can never inject a fabricated
candidate.

## Resumes in Google Drive

Drive is the storage backend, not one option behind a switch. Every resume lives in one folder
you own, and every resume is readable **inside the portal** — you should never have to open
Drive to decide on a candidate.

### Setup, once

1. In Google Cloud, same project as Sheets: enable the **Google Drive API**. The service account
   and key you already created for Sheets are reused; there is no second credential.
2. In Drive, create a **Shared Drive** (e.g. "Hiring") and a folder inside it, "Resumes".
3. Add the service account email as a **Content manager** of that Shared Drive.
4. Copy the folder id out of its URL — `drive.google.com/drive/folders/<THIS PART>` — and set
   `GOOGLE_DRIVE_FOLDER_ID`.

**It must be a Shared Drive, not My Drive.** A service account has no storage quota of its own,
so writing into a personal folder fails with `403 storageQuotaExceeded`. In a Shared Drive the
files are owned by your organisation, which is also what you want for continuity — nothing is
tied to one person's account.

Anyone with access to that Shared Drive can read every resume in it. Keep membership to people
who should see candidate personal data.

### The size limit is 25 MB, and how that works

Scanned CVs routinely pass 10 MB. Vercel caps a function's request **and** response bodies at
4.5 MB and that cannot be raised, so neither direction is allowed to pass through the function:

- **Upload** — the server asks Drive for a resumable session URI and hands it to the browser,
  which `PUT`s the bytes straight to Google. Nothing traverses the function, so the request cap
  never applies. The browser then calls `/api/uploads/complete`, and the server asks Drive for
  the real byte count before the file counts as attached — an abandoned upload can't quietly
  become an application with an empty resume.
- **Download and preview** — `/api/files/[id]` and `/api/files/[id]/preview` **stream** from
  Drive. Streamed responses are exempt from the 4.5 MB response cap.

That second point is load-bearing and fails quietly: buffering a file instead of streaming it
keeps working for small test fixtures and breaks only for the large CVs this design exists to
support. `tests/storage.test.ts` asserts the read path returns a `ReadableStream` directly,
rather than inferring it from a download that happened to succeed.

The Drive file id is always taken from Drive's own API response, never from the browser. If the
client could name the id, an agency could attach its submission to another agency's resume.

### Word documents

Browsers render PDFs in a frame; DOC and DOCX they don't. Rather than fall back to "download it
instead" — which is the exact trip to Drive this is meant to remove — the portal has Drive
convert the file: copy to Google Docs format, export as PDF. That happens **once, lazily, on
first preview**, and the converted PDF is stored back in Drive with its id cached on the file
record. So the first open of a Word CV shows "Preparing preview…" for a few seconds and every
open after is instant. Two people opening the same new CV at once produce one conversion, not
two — the status column doubles as the lock.

### Access

Files are never made link-shareable in Drive. Every read goes through the app, which checks the
session: internal users see everything, an agency reaches only files attached to its own
applications, and an id you're not entitled to returns **404 rather than 403**, so the id space
can't be probed. Responses carry `Cache-Control: private, no-store`.

## Day-to-day use

**Review** (`/review`) is the triage screen: the resume rendered large on the left, the candidate
summary, qualifying answers and screening flags on the right, and **Shortlist** / **Reject** /
**Skip** with an optional note. Deciding advances to the next candidate automatically, and `S`,
`R` and `→` do the same from the keyboard, so twenty candidates is a couple of minutes rather
than twenty page loads. The queue is everyone sitting in the entry stage, oldest first,
filterable by role and agency.

Its two targets are derived from the funnel rather than hardcoded: *shortlist* is the next
**Active** stage after the entry stage, *reject* is the first **Lost** stage. Rename or reorder
your stages in Settings and this screen follows, because nothing depends on a stage being called
"Shortlisted".

**Funnel** has a board view (drag cards between stages) and a table view (filter by role,
agency, source, notice period, screening flags; select many and move them in one action).
Cards show days-in-stage and turn amber past two weeks.

**Candidate detail** holds the resume rendered inline, every qualifying answer with flags highlighted, the
full stage history, interview scheduling for all four rounds with outcomes and feedback, notes,
and the other roles the same person has applied for. Scheduling an interview moves the
candidate to *Interview scheduled* automatically.

When you move someone, you can tick **Email the agency** — they receive the stage and any note
you wrote, provided the stage is marked agency-visible.

**Reports** shows cumulative funnel conversion, an agency scorecard ranked by shortlist rate
rather than raw volume, source comparison, and everyone stuck for more than 14 days.

## Testing

```bash
npm test         # unit tests: normalisation, dedupe, screening rules, sheet mapping, storage
npm run verify   # end-to-end against a real database (39 checks)
npm run lint
npm run typecheck
npm run build
```

`npm run verify` is the one that matters most. It proves the things unit tests can't: that the
unique index really blocks a second agency, that tenant scoping really returns null across
agencies, that internal notes really don't reach the agency portal, that stage history stays
consistent with the cached column, and that the database check constraints hold. It cleans up
after itself and is safe to re-run.

Manual QA steps are in [`docs/QA.md`](docs/QA.md).

## Project layout

```
prisma/
  schema.prisma            the data model, commented
  migrations/              includes hand-written CHECK constraints
  seed.ts                  funnel stages + first admin

src/
  app/
    (admin)/               your side — review, funnel, candidates, roles, agencies, users,
                           settings, reports
    (agency)/              agency side — dashboard, submit, submissions
    api/
      uploads/             Drive resumable upload sessions, and the completion check
      files/[id]/          authorised resume download, and the streamed preview
      webhooks/sheets/     Apps Script push
      cron/sheets-sync/    scheduled safety-net pull
    login/, set-password/  authentication

  lib/
    tenancy.ts             every agency-scoped query; the isolation boundary
    submissions.ts         one path for creating an application, agency or website
    dedupe.ts              candidate identity resolution
    screening.ts           answer coercion and screening rules
    funnel.ts              stage transitions and the audit trail
    sheets.ts              Google Sheets ingestion
    sheet-mapping.ts       pure row hashing and column mapping
    normalize.ts           email, phone, currency, notice period, experience
    auth.ts                sessions and role guards
    password.ts            scrypt hashing
    storage.ts             Google Drive: uploads, streaming reads, Word→PDF preview
    google-auth.ts         one service-account JWT, shared by Drive and Sheets
    file-access.ts         who may read a file, and the headers every file response carries
    review.ts              the triage queue and its stage targets
    email.ts               transactional email, every send logged

  components/              shared UI, question builder, funnel board, submission form,
                           resume viewer, review queue

scripts/
  demo.ts                  realistic sample data
  verify.ts                end-to-end verification
```

### A note on the stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Prisma 7 on PostgreSQL.

Authentication is hand-rolled rather than Auth.js: the requirement is email/password with
revocable database sessions, which is about 150 lines, and it avoids a beta dependency in the
security-critical path. Passwords use Node's built-in **scrypt** rather than argon2 — scrypt is
memory-hard, in the standard library, and needs no native module that could break a deploy.
