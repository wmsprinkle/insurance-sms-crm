# Insurance SMS CRM — daily operation

For the person who runs the CRM day to day. Install and configuration are in
[`SMS_SETUP.md`](./SMS_SETUP.md). `<workspace>` below is the workspace slug in the URL.

## How a lead moves

1. A lead arrives by CSV import or `POST /leads/ingest`, with a consent record.
2. The API queues one `first-touch` task, due at the next allowed send time.
3. The agent sends the first message (or drafts it, when auto-send is off).
4. The lead replies. Telnyx calls `/webhooks/telnyx`. The API stores the text and queues
   an `sms-reply` task. STOP, HELP and START are answered at once, with no model.
5. The agent classifies the reply, collects qualification facts, offers 2–3 call times,
   books the call on Google Calendar, and texts a confirmation. The deal moves to
   `QUALIFIED_TO_BUY`, then `DEMO_BOOKED`.
6. Anything it should not handle goes to a person (a handoff).

The agent drains its queue once a minute. Expect up to a minute of delay.

## Import leads

**Contacts → Import** (`/<workspace>/contacts/import`).

1. Upload a CSV (at most 5 MiB, 5,000 rows, 100 columns).
2. Check the column mapping. Required: `phone`, `consentSource`, `consentCapturedAt`,
   and `optInText` or `optInUrl`. Optional: `firstName`, `lastName`, `fullName`,
   `email`, `consentIp`. [`sample-leads.csv`](./sample-leads.csv) shows the shape.
3. Read the preview. Problem rows come first, each with its reasons.
4. Import. Each row ends as `created`, `duplicate` or `rejected`.

Rules:

- `consentSource` is one of `WEB_FORM`, `LEAD_IMPORT`, `API`, `SMS_KEYWORD`, `MANUAL`
  (case, `-` and spaces are tolerated).
- `consentCapturedAt` must be a parseable date, not in the future. Use ISO 8601.
- `optInUrl` must be `http(s)`.
- Phone numbers without `+` are read as North American.
- A phone or email that already belongs to an active contact is a `duplicate`. The
  existing contact is not changed and gets no new consent row.
- Only import people who opted in on your own form. See `TOLLFREE_VERIFICATION.md` §7.

## Drafts queue

**Inbox → Drafts** (`/<workspace>/inbox/drafts`). Also linked from
**Settings → Compliance**. There is no icon-rail entry yet.

A text becomes a draft when:

| Reason | Meaning |
| --- | --- |
| `approval-mode` | **Auto-send** is off on Settings → Compliance (the default). |
| `quiet-hours` | Outside the lead's allowed send window. The draft shows the retry time. |
| `send-failed` | Telnyx or the send gate refused it. |
| `no-send-path` | The agent cannot reach the API (`API_URL` or `AGENT_BRIDGE_SECRET` missing or wrong). |

Per draft you can **Approve**, edit and **Send edited**, **Discard**, or reset. An edited
text runs the outbound guard again. When the guard objects, you get a suggestion; the
text is never rewritten silently. Approve still goes through the send gate, so a
quiet-hours or opt-out block still applies.

Handoff and opt-out confirmations never wait in the queue.

## Handoffs

The agent hands a conversation to a person on a complaint, a legal threat, distress, a
claim, an existing-policy problem, a product the knowledge files do not cover, or a
question it cannot answer twice. The pipeline also hands off on a prompt-injection
attempt or too many messages (more than 12 inbound in an hour, or more than 20 in
total). It sends one text:

> Thanks for the details. Let me get a licensed agent to follow up with you directly on this.

While a handoff is open the agent sends nothing more to that lead. New replies are
stored but get no model turn.

To work it: open the thread in **Inbox** (`/<workspace>/inbox`) or the contact's
**Texts** tab, and reply with the composer under the thread (Cmd/Ctrl+Enter sends).
When you are done, click **Hand back to agent** on the Drafts page. The agent then picks
up any replies that came in since the handoff.

## Inbox and the Texts tab

- **Inbox** lists threads. "Open" = a thread with an inbound text nobody marked handled.
  Mark it handled when you have read it.
- The contact's **Texts** tab shows the same thread, its consent and opt-out state, and
  the composer. The composer is disabled with a reason when the contact has no phone,
  has opted out, or has no consent.

## Reading the Agent tab

The contact's **Agent** tab is the upstream research agent: a rep chats with the agent
about the record and sees its steps. Tool steps read as verbs ("Sent a text" for
`send_sms`).

The SMS conversation itself runs in its own agent session per contact
(`sms:<contactId>`). That session is not linked into the Agent tab. To see what was
texted and why, use the **Texts** tab and the drafts queue. The deal stage and the
custom fields `SMS line of insurance`, `SMS state`, `SMS age band`, `SMS coverage
wanted`, `SMS timeline` show what the agent recorded.

## What STOP does

A text that is only a stop word (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT,
OPT-OUT, REVOKE; case and end punctuation ignored):

1. adds the number to the phone suppression list (`STOP_KEYWORD`);
2. revokes the lead's consent;
3. closes open `sms-reply`, `first-touch` and follow-up tasks;
4. sends one confirmation: "«Agency»: You are unsubscribed and will get no more
   messages. Reply START to resubscribe."

This also works for a number that belongs to no contact. After that the send gate blocks
every text to the number, including rep texts and approved drafts.

A sentence such as "please stop texting me" goes to the agent. It calls `opt_out_contact`,
which suppresses the number (`OPT_OUT_REQUEST`), revokes consent, closes tasks, moves the
deal to `UNQUALIFIED_TO_BUY` and sends one confirmation.

**START** or **UNSTOP** lifts a STOP or opt-out suppression and records new consent
(`SMS_KEYWORD`). **HELP** or **INFO** gets the help text only.

## Add knowledge for a new insurance line or state

Knowledge files are agent skills in `apps/agent/agent/skills/`. The agent loads one when
its `description` matches the lead's question.

1. Copy `knowledge-term-life.md` to `knowledge-<line>.md`, for example
   `knowledge-final-expense.md`.
2. Set the front-matter `description:` to start with "Use when a lead asks about…".
3. Write plain facts. No prices, premiums, guarantees, URLs, email addresses or phone
   numbers. The test suite rejects contact details.
4. Keep the bodies of **all** `knowledge-*.md` files together under 9,000 characters
   (tested).
5. Run `bun test test/sms-skills.spec.ts` in `apps/agent`, then redeploy the agent.

State-specific facts go in the relevant knowledge file or in `knowledge-agency.md`.

## Change licensed states

Two places, which must list the same states in the same order (a test checks it):

1. `apps/agent/agent/lib/sms-config.ts` → `SMS_AGENT.licensedStates`, for example
   `["TX", "FL", "GA"] as readonly string[]`.
2. `apps/agent/agent/skills/knowledge-agency.md` → the `## Licensed states` section,
   with the same two-letter codes (replace "Not set.").

An empty list means no state is refused. With a list, a lead in another state is marked
not qualified (`UNQUALIFIED_TO_BUY`). Run `bun test test/sms-qualification.spec.ts` in
`apps/agent`, then redeploy the agent.

## Calendar owner and fallback booking link

There is no UI for these yet. They live in the `calendar` JSON column of the single
settings row (table `appSetting`, id `app`). Shape: `@crm/validation/calendar-settings`.

| Key | Meaning | When unset |
| --- | --- | --- |
| `calendar.ownerUserId` | The CRM user whose Google Calendar receives bookings. | The user of the oldest connected Google account. |
| `calendar.fallbackBookingLink` | An `http(s)` booking page (at most 500 characters) the agent texts when the calendar is unavailable. | The agent hands the lead to a person instead. |

Find the user id:

```sql
SELECT id, email FROM "user";
```

Set both (Postgres; `docker exec -it crm-postgres psql -U postgres crm` locally, or
`bun run db:studio`):

```sql
INSERT INTO "appSetting" (id, calendar, "updatedAt")
VALUES ('app', '{"ownerUserId": "<user id>", "fallbackBookingLink": "https://example.com/book"}', now())
ON CONFLICT (id) DO UPDATE
SET calendar = EXCLUDED.calendar, "updatedAt" = now();
```

Use `null` for a key you want unset. A value that fails the schema (for example a
non-http link) makes booking fail with "Unreadable calendar settings". Check the JSON before
you save it.

The owner's Google account must hold the booking scopes. If **Settings → Connections**
shows **Grant calendar access**, click it first.

## Settings → Compliance

- **First message**: 20–320 characters, must contain STOP. Tokens `{firstName}` and
  `{agency}` (the workspace name). A queued first touch keeps the text it was queued
  with.
- **Disclosure mode**: `disclose` (default; the agent says it is an automated assistant
  when asked) or `deflect`.
- **Auto-send**: off = every agent and first-touch text waits in Drafts.
- **Quiet hours**: read-only table. Federal 8:00–21:00 local time plus stricter state
  rules. Unknown state = the strictest window across all US zones. The table is not
  legally reviewed.
