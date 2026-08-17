# Careers site integration

How your careers page posts an application into the hiring portal.

Applications arrive through the same code path as agency submissions, so a website applicant is
deduplicated against agency candidates, screened against the same questions, and lands in the
same funnel stage. There is no spreadsheet in the middle.

---

## Before you start

Set `CAREERS_API_KEY` on the portal deployment — any random secret, e.g. `openssl rand -hex 32`.
Until it is set, every endpoint below returns **503**; the API is closed by default rather than
open until someone remembers to protect it.

**Call these from your careers site's backend, not from the visitor's browser.** The key
authenticates the site, so a browser-side call would publish it in the page source. In Next.js
that means a route handler or server action; the pattern is the same anywhere.

Base URL is your portal deployment, e.g. `https://hiring-portal-seven.vercel.app`.
Every request needs:

```
X-API-Key: <CAREERS_API_KEY>
```

---

## 1. List open roles

```http
GET /api/public/roles
```

```json
{
  "roles": [
    {
      "id": "0f8c…",
      "title": "Senior Backend Engineer",
      "department": "Engineering",
      "location": "Bengaluru",
      "employmentType": "Full-time",
      "description": "…",
      "openings": 2,
      "minExperienceMonths": 48,
      "questions": [
        {
          "id": "a41b…",
          "label": "Notice period in days",
          "helpText": null,
          "type": "NUMBER",
          "options": [],
          "isRequired": true
        }
      ]
    }
  ]
}
```

Only roles with status **Open** appear — Draft and Paused are omitted. Build your form from
`questions` and a new question added in the portal shows up on the careers page automatically.

`type` is one of `TEXT`, `LONG_TEXT`, `NUMBER`, `CURRENCY`, `BOOLEAN`, `SINGLE_SELECT`,
`MULTI_SELECT`, `DATE`. `options` is populated for the two select types and `[]` otherwise.

Screening rules are deliberately absent from this response. Which questions are screeners, and
their thresholds, stay inside the portal — an applicant who can read "notice period must be ≤ 30"
simply answers 30.

---

## 2. Attach a resume (optional, three steps)

The file goes **straight from the applicant's browser to Google Drive**. It never passes through
the portal, which is what allows resumes up to **25 MB** — a serverless function request body is
capped at 4.5 MB and that cap can't be raised.

### 2a. Ask for an upload URL — from your backend

```http
POST /api/public/uploads
Content-Type: application/json

{ "fileName": "priya-nair-cv.pdf", "mimeType": "application/pdf", "sizeBytes": 184320 }
```

```json
{ "fileId": "6b2e…", "uploadUrl": "https://storage.googleapis.com/upload/…" }
```

PDF, DOC and DOCX only, up to 25 MB. Anything else is rejected here, before Drive is touched.

### 2b. Send the bytes — from the browser

Hand `uploadUrl` to the page and PUT the file to it directly:

```js
await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": file.type },
  body: file,
});
```

No API key on this request — the URL is itself a short-lived credential issued by Google.

### 2c. Confirm it landed — from your backend

```http
POST /api/public/uploads/complete
Content-Type: application/json

{ "fileId": "6b2e…" }
```

```json
{ "ok": true, "sizeBytes": 184320 }
```

**Don't skip this.** The portal asks Drive whether the bytes actually arrived. Without it an
abandoned upload produces an application pointing at an empty file that looks perfectly valid
until someone opens the resume. An application referencing an unconfirmed file is rejected.

---

## 3. Submit the application

```http
POST /api/public/applications
Content-Type: application/json

{
  "jobRoleId": "0f8c…",
  "fullName": "Priya Nair",
  "email": "priya@example.com",
  "phone": "+91 98765 43210",
  "currentCompany": "Acme Ltd",
  "currentTitle": "Backend Engineer",
  "currentLocation": "Bengaluru",
  "linkedinUrl": "https://linkedin.com/in/…",
  "totalExperienceMonths": 62,
  "currentCtc": "18 LPA",
  "expectedCtc": "24 LPA",
  "noticePeriod": "30 days",
  "resumeFileId": "6b2e…",
  "answers": { "a41b…": 30 }
}
```

`jobRoleId` and `fullName` are required, plus **at least one of `email` or `phone`** — a candidate
with no way to be contacted can't be deduplicated or followed up.

`answers` is keyed by the question ids from step 1. `currentCtc`, `expectedCtc` and
`noticePeriod` accept free text — `"18 LPA"`, `"₹24,00,000"`, `"2 months"`, `"immediate"` are all
parsed into stored numbers.

**Success — 201:**

```json
{ "status": "received" }
```

### Show the same thank-you for every `received`

If this person has already applied for this role, you get exactly this response. That is
deliberate: reporting duplicates would let anyone holding the key ask "is this person in your
pipeline?" one email address at a time. The duplicate is still recorded on the portal side and
you'll see it — the caller just can't tell the difference. So don't try to branch on it.

---

## Errors

| Status | Meaning |
|---|---|
| **400** | Malformed body, or a resume that wasn't confirmed. Response has `error`, sometimes `fields` |
| **401** | Missing or wrong `X-API-Key` |
| **404** | The role doesn't exist, or isn't Open |
| **429** | Rate limit hit. `Retry-After` header gives seconds |
| **503** | `CAREERS_API_KEY` isn't set on the portal, or Drive isn't configured |

Rate limits are per IP per hour: 600 role lookups, 10 upload requests, 20 applications. Since you
call from a backend, that IP is your careers server — size your retries accordingly, and consider
caching the roles list for a few minutes rather than fetching it per page view.

---

## Worked example

A backend handler taking a parsed form and a already-uploaded `resumeFileId`:

```js
const PORTAL = process.env.PORTAL_URL;
const KEY = process.env.PORTAL_API_KEY;

async function portal(path, body) {
  const response = await fetch(`${PORTAL}/api/public/${path}`, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Portal returned ${response.status}`);
  return data;
}

export async function submitApplication(form) {
  if (form.resumeFileId) {
    await portal("uploads/complete", { fileId: form.resumeFileId });
  }

  await portal("applications", {
    jobRoleId: form.roleId,
    fullName: form.name,
    email: form.email,
    phone: form.phone,
    expectedCtc: form.expectedCtc,
    noticePeriod: form.noticePeriod,
    resumeFileId: form.resumeFileId ?? null,
    answers: form.answers,
  });

  // One message for every success — see above.
  return { message: "Thanks — your application is with our hiring team." };
}
```

---

## Checking it worked

A submitted application appears in the portal under **Review** and on the **Funnel** board in
your entry stage, with source *Website*. If you attached a resume it renders inline on the
candidate page — no need to open Drive.
