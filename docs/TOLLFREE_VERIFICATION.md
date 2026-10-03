# Toll-free verification packet (Telnyx)

A ready-to-fill packet for task 21. A person fills the blanks and submits it in the
Telnyx Portal (Messaging → Toll-Free Verification) or through
`POST /v2/messaging_tollfree/verification/requests`. The CRM does not submit it.

Source: `../RESEARCH.md` §2.3 and the Telnyx pages it links. Re-check the Telnyx form
before you submit; field names change.

Why it matters: unverified toll-free numbers are blocked from sending (since
2024-01-31). Review normally takes up to 5 business days and can take 4 weeks. Keep
`DRY_RUN` on until the approval arrives.

Fill every `«…»`.

## 1. Business information

| Field | Value |
| --- | --- |
| Legal business name | «exact name on the IRS record» |
| DBA / brand name shown in texts | «the `{agency}` name; must match the workspace name in the CRM» |
| Business registration number (EIN) | «XX-XXXXXXX» — required since 2026-02-17 |
| Registration number type | EIN |
| Registration country | US |
| Business address | «street, city, state, ZIP» (no PO box) |
| Website | «https://…» — must show the agency name and match the brand |
| Contact name / email / phone | «a person who answers carrier questions» |
| Toll-free number(s) | «+1 8XX XXX XXXX» — one use case per number |
| Insurance licence (optional context) | «state licence numbers, if the form has a notes field» |

## 2. Use case

**Category:** «pick the closest Telnyx category, for example "Customer Care" or
"Account Notification". Do not pick a marketing / lead-generation category.»

**Summary (paste and edit):**

> «Agency» is a licensed insurance agency. Consumers request an insurance quote on our
> website and, in a separate optional checkbox, agree to receive text messages about
> that request. We text each person who opted in to follow up on their own quote
> request, answer general questions, and schedule a call with a licensed agent. We do
> not buy, sell or share leads, and we do not text anyone who did not opt in on our own
> form. Recipients can reply STOP at any time to opt out and HELP for help.

## 3. Sample messages

These match what the CRM sends today. If you change the first message on
**Settings → Compliance**, change sample 1 here to the same text.

1. **First touch** (default template in `@crm/validation/sms-settings`):
   > Hi «Ava», this is «Agency». You asked us about an insurance quote, so we are
   > following up here. Reply with any questions. Reply STOP to opt out.
2. **Conversation reply** (written by the agent; example):
   > Happy to help. A licensed agent can go over options on a short call. Would Tue,
   > Oct 6 at 10:00 AM CDT or Wed, Oct 7 at 2:00 PM CDT work for you?
3. **Booking confirmation** (`apps/agent/agent/lib/sms-booking.ts`):
   > You are booked for Tue, Oct 6 at 10:00 AM CDT. A calendar invite with a video link
   > is on its way to your email. Reply here if you need to change it.
4. **STOP reply** (`apps/api/src/sms/sms-config.ts`):
   > «Agency»: You are unsubscribed and will get no more messages. Reply START to
   > resubscribe.

HELP reply, for the "help message" field:

> «Agency»: Reply to this message and a licensed agent will follow up. Msg & data rates
> may apply. Reply STOP to unsubscribe.

Opt-out keywords honoured: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT,
OPT-OUT, REVOKE. Opt back in: START, UNSTOP. Help: HELP, INFO. Free-text opt-outs
("please stop texting me") are caught by the agent's classifier.

## 4. Opt-in process

Describe exactly what a consumer sees. Paste and edit:

> Consumers opt in on our quote request form at «https://…/quote». The form asks for
> name, phone and email. Below the phone field is a separate, unchecked checkbox:
> "«I agree to receive text messages from Agency about my quote request. Msg & data
> rates may apply. Message frequency varies. Reply STOP to opt out, HELP for help.
> Consent is not a condition of purchase.»" The form submits without the checkbox; only
> people who tick it receive texts. We store the opt-in text, page URL, time and IP
> address with each lead.

Proof of opt-in: «URL of the live form» and «screenshot file / hosted image URL showing
the checkbox and the consent text».

Rules the reviewer checks:

- The SMS consent is **separate** from the terms of service and privacy checkbox.
- The SMS consent is **optional**. A required phone field is not consent.
- The consent text names the brand, says what the messages are about, and includes
  STOP / HELP and "Msg & data rates may apply".
- What the CRM stores per lead: consent source, capture time, opt-in text, opt-in URL,
  IP (`ConsentRecord`). The import refuses rows without them.

## 5. Terms and privacy pages

Both must be public on the brand's website before you submit.

**Privacy policy** — «URL». It must say:
- what you collect (name, phone, email, quote details) and why;
- that mobile numbers and SMS opt-in data are **not shared with or sold to third
  parties** for marketing;
- how to opt out (reply STOP) and how to contact you.

**Terms / SMS terms** — «URL». It must state:
- program name and description (quote follow-up and appointment scheduling);
- message frequency ("varies");
- "Msg & data rates may apply";
- STOP to cancel, HELP for help, and a support contact;
- carriers are not liable for delayed or undelivered messages.

## 6. Volume

| Field | Value |
| --- | --- |
| Expected monthly messages | «leads per month × about 6 messages per conversation» |
| Throughput | The CRM sends at `TELNYX_MPS` per number (default 1 per second). |

## 7. Pitfalls that cause rejection

- **Affiliate lead generation.** "Lead generation using third-party affiliates" is
  prohibited content on toll-free. Do not text purchased, aggregated or shared leads.
  Only text people who opted in on **your own** form.
- **Bundled or required consent.** Consent inside the general terms, or a phone field
  that is required, gets rejected. It must be a separate, optional checkbox.
- **One use case per number.** Do not mix marketing blasts with quote follow-up on the
  same number. A second use case needs a second number and a second verification.
- **Brand mismatch.** The name in the texts, the website and the form must match the
  legal or DBA name on the form.
- **Missing EIN.** Submissions after 2026-02-17 need the registration number fields.
- **Dead links.** The opt-in, privacy and terms URLs must load for the reviewer.
- **Sample messages that differ from production.** Keep sample 1 identical to the
  first-message setting.
