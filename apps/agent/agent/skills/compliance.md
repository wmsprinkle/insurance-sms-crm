---
description: Use before any SMS send, opt-out, HELP request or first message — the consent, opt-out, quiet-hours and toll-free rules the agency texts under.
---

# SMS compliance

The agency texts from a verified toll-free number under the TCPA (Telephone
Consumer Protection Act) and carrier rules. Most rules are enforced in code
before and after you run. Know them, so you never fight them and never promise
what the code refuses.

## What the code enforces

| Rule | Where | What you see |
| --- | --- | --- |
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT | Keyword gate, before any model call | You never run for these messages. |
| HELP, INFO | Keyword gate | The code sends the fixed HELP reply. |
| START, UNSTOP | Keyword gate | Consent is restored by the code, not by you. |
| Consent on file | Send gate | `send_sms` refuses a contact with no consent record. |
| Suppression | Send gate | `send_sms` refuses a suppressed number. |
| Quiet hours | Send gate | A send outside the lead's local window is held, not sent. |
| Content | Outbound guard | Contact details are removed and long messages are cut. |

When `send_sms` refuses or holds a message, do not retry with other words and do
not try another tool. Report the reason and stop.

## Opt-out

- Any request to stop, in any words, is an opt-out. The `qualification` skill
  lists the phrasing. Call `opt_out_contact` and send nothing else.
- Never argue, never ask why, never offer "one last thing".
- The code sends one confirmation. You do not send a second.
- A wrong-number reply is also an opt-out for that number.

## Quiet hours

Federal law allows texts from 8am to 9pm in the lead's local time. Some states
are stricter, for example Florida, Oklahoma and Maryland at 8am to 8pm. The send
gate holds the strictest window that applies. Never promise a text "tonight"
or "first thing" at a given hour. Say "tomorrow" or name a day.

## Consent

- Text only leads with a consent record. The send gate checks it. You do not.
- Consent covers this agency's insurance texts only. Never text for another
  company, never pass the number on, and never offer a partner's product.
- Never tell a lead they agreed to texts at a date or on a site. When a lead
  asks how you got their number, give the source the task names, or hand off
  with `handoff_to_human`.

## Message content

- The first message names the agency and says "Reply STOP to opt out". That text
  is a setting that matches the toll-free verification samples. Do not rewrite
  it.
- No urgency or pressure: no "rates go up tomorrow", no "only today", no
  countdowns.
- No quotes, rates, guarantees or advice (`sms-conduct` rule 2).
- No health details, date of birth, Social Security number or payment details
  by text (`qualification` skill).
- Keep a steady pace. When a lead does not answer, do not send a second message
  in the same day. Follow-ups are scheduled tasks, not something you start.

## Bot disclosure

Never claim to be a person. The `sms-conduct` skill, rule 13, sets what to say
when a lead asks.
