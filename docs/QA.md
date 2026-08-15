# Manual QA checklist

Run this against a preview deployment before going live, and after any change to submissions,
tenancy or the funnel. The automated suites (`npm test`, `npm run verify`) cover the logic;
this covers the parts only a human sees.

Set up with `npm run db:seed && npm run db:demo`, which creates:

| Login | Password | Role |
|---|---|---|
| `admin@example.com` | from the seed output | Admin |
| `recruiter@example.com` | `DemoPass12345` | Recruiter |
| `priya@acme-talent.com` | `DemoPass12345` | Acme Talent Partners |
| `sameer@bluewave.com` | `DemoPass12345` | Bluewave Recruiters |

---

## 1. Access control

- [ ] Signed out, visiting `/funnel`, `/agencies`, `/agency` or `/settings` redirects to `/login`.
- [ ] Signing in as an agency user lands on `/agency`, not the funnel.
- [ ] An agency user visiting `/funnel` is redirected to `/agency`.
- [ ] An internal user visiting `/agency` is redirected to `/funnel`.
- [ ] A **recruiter** sees no *Users* or *Settings* nav items, and `/users` redirects away.
- [ ] Wrong password gives the same message as an unknown email — no account enumeration.
- [ ] Eight failed logins for one email produce a rate-limit message.

## 2. Tenant isolation — the one that matters most

- [ ] As Priya (Acme), open one of her submissions and copy the URL.
- [ ] Sign in as Sameer (Bluewave) and open that URL → **404**, not 403 and not the record.
- [ ] Copy a resume link (`/api/files/<id>`) from an Acme candidate; as Sameer it returns 404.
- [ ] Sameer's *My submissions* list contains no Acme candidates.
- [ ] Acme's submission count for a role does not include Bluewave's submissions.

## 3. Roles and the question builder

- [ ] Create a role as **Draft** — it does not appear on any agency's submit form.
- [ ] Switch it to **Open** — it appears for every assigned agency.
- [ ] Add one question of each type; the live preview matches what the agency then sees.
- [ ] A choice question with no options is refused on save.
- [ ] Marking a question as a screener with no rule set is refused on save.
- [ ] Reorder questions, save, reload — the order sticks.
- [ ] Removing a question that already has answers warns before deleting.

## 4. Agency submission

As Priya, on the Senior Backend Engineer role:

- [ ] Add three candidates in one submission.
- [ ] Leaving a required question blank is rejected, naming the question.
- [ ] A candidate with neither email nor phone is rejected with a clear reason.
- [ ] Attaching a PDF resume shows "✓ attached"; submitting is blocked until the upload
      finishes.
- [ ] A `.txt` file is rejected before upload.
- [ ] Submit a candidate whose notice period is 90 days → accepted, and the admin side shows a
      **Flagged** badge with the reason.
- [ ] Submit someone already in the pipeline for that role → that row reports a duplicate while
      the others still land. **This is the partial-success behaviour; verify the good rows saved.**
- [ ] The same person submitted for a *different* role is accepted.
- [ ] Where a submission cap is set, exceeding it is refused before anything is written.
- [ ] Storage not configured → the form explains resumes are unavailable but still submits.

## 5. Funnel

- [ ] New submissions appear in **Received**.
- [ ] Drag a card to Shortlisted — it moves immediately and survives a reload.
- [ ] Candidate detail shows the transition in History with your name and a timestamp.
- [ ] Moving to a stage the candidate is already in reports "already in this stage" and adds no
      history row.
- [ ] Table view: select five candidates, bulk-move them, confirm all five moved.
- [ ] Filters work individually and together (role, agency, source, notice period, flagged).
- [ ] A candidate sitting 14+ days in an active stage shows amber and appears in Reports.

## 6. Interviews and notes

- [ ] Schedule a Round 1 interview → the candidate moves to *Interview scheduled* automatically.
- [ ] Record a Pass with a 4/5 rating and feedback; reload and confirm it persisted.
- [ ] Add an **internal** note. Sign in as that agency → the note is **not** visible.
- [ ] Add a note shared with the agency → it **is** visible in their portal.
- [ ] Move a candidate with *Email the agency* ticked → an `email_log` row is written (SENT, or
      SKIPPED when email isn't configured).

## 7. Google Sheets

- [ ] **Settings → Google Sheets** warns clearly when credentials are missing.
- [ ] Pasting a full spreadsheet URL works as well as a bare ID.
- [ ] *Read columns from the sheet* shows your real headers and five sample rows.
- [ ] An unshared sheet gives a message telling you to share it with the service account.
- [ ] Saving without mapping **Full name** is refused.
- [ ] *Import now* creates candidates with `source = WEBSITE`.
- [ ] **Run the import twice — the second run creates nothing.** (Idempotency.)
- [ ] A row with no name lands in *Rows needing review* with the reason, not silently dropped.
- [ ] A website lead who an agency later submits is blocked as a duplicate.
- [ ] `curl` the cron route without the secret → 401; with it → a JSON summary.
- [ ] With the Apps Script installed, adding a row makes the candidate appear within seconds.

## 8. Stage editor

- [ ] Rename a stage → the new name shows on the board and in agency portals.
- [ ] Reorder stages → board column order follows.
- [ ] Untick *Agencies see this name* → the agency portal shows the generic label
      ("In process" / "Closed") instead.
- [ ] Add a new stage, save, and move a candidate into it.
- [ ] Removing a stage that holds candidates warns first; afterwards those candidates keep the
      stage in their history.
- [ ] Saving with zero entry stages, or two, is refused.

## 9. Users and invites

- [ ] Creating a user emails an invite; the invite link sets a password and signs them in.
- [ ] The same invite link cannot be used twice.
- [ ] An expired link says so instead of failing silently.
- [ ] Disabling a user signs them out immediately (their next request redirects to login).
- [ ] Pausing an agency locks out all of its users at once.
- [ ] A password reset invalidates that user's other sessions.

## 10. Presentation

- [ ] Every page is usable at 375px wide with no horizontal page scroll — wide tables and the
      board scroll inside their own container.
- [ ] The funnel board is readable with 200+ candidates.
- [ ] No unstyled flash on load; no console errors.

---

## Before going live

- [ ] `SESSION_SECRET` is a fresh random value, not the example.
- [ ] `APP_URL` is the real domain (otherwise invite links point at localhost).
- [ ] The seeded admin password has been changed.
- [ ] The resume bucket is **private**, with CORS allowing `PUT` from your domain only.
- [ ] `CRON_SECRET` and `SHEETS_WEBHOOK_SECRET` are set to random values.
- [ ] Database backups are enabled.
- [ ] A copy of your real leads sheet has been imported into a preview deployment, and the
      column mapping and dedupe behaved correctly on messy real rows.
