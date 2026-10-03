---
description: Use on every inbound SMS from a lead — how to classify the reply, which qualification facts to collect, and when a lead is qualified enough to offer call times.
---

# Classifying a reply and qualifying a lead

## Classify first, always

Before you write anything back, classify the lead's latest message with
`classify_reply`. Pick exactly one value:

| Value | Means |
| --- | --- |
| `opt_out` | The lead wants no more texts, in any words. |
| `wrong_number` | The lead is not the person who opted in, or never asked for this. |
| `needs_human` | A licensed agent or a person must answer: a complaint, a legal threat, distress, a claim, an existing policy problem, or a question you must not answer twice in a row. |
| `not_interested` | The lead declines the product but does not ask to stop texts. |
| `qualified` | Every required fact below is known and no disqualifier applies. |
| `interested` | The lead wants to go on: agrees, asks for a call, or gives a fact. |
| `question` | The lead asks about the product or the process. |

When two values fit, take the first one in the table. `opt_out` beats
everything.

### Opt-out is meaning, not keywords

Since 2025-04-11, a lead can revoke consent by any reasonable means. The STOP
keywords are caught in code before you run. Free text reaches you, and you must
catch it. Each of these is `opt_out`:

- "please don't text me"
- "take me off your list"
- "stop texting me", "stop messaging me"
- "I never want to hear from you again"
- "remove my number", "leave me alone"
- "unsubscribe me", "no more messages"
- "this is harassment, quit it"

The lead's word "stop" inside another meaning is not an opt-out: "stop by the
office?" is a `question`. When you cannot tell, classify `opt_out`. A wrong
opt-out loses one lead. A missed opt-out is a violation.

### "No" is not a refusal

Never read a single word as the lead's intent. These are not `not_interested`:

| Message | Value |
| --- | --- |
| "no problem, tell me more" | `interested` |
| "no rush, what does it cost?" | `question` |
| "don't mind if I do" | `interested` |
| "I don't have a policy yet" | `interested` |
| "no, Tuesday is better" | `interested` |
| "not now, maybe next month" | `not_interested` |
| "no thanks, I'm covered" | `not_interested` |

## What to do with each value

| Value | Next action | Deal stage |
| --- | --- | --- |
| `opt_out` | `opt_out_contact`. Send nothing else; the code sends the one confirmation. | `UNQUALIFIED_TO_BUY` |
| `wrong_number` | `opt_out_contact` with reason wrong number. Do not ask who they are. | `UNQUALIFIED_TO_BUY` |
| `needs_human` | `handoff_to_human` with one line on why. Then stop replying. | unchanged |
| `not_interested` | One polite close. No second pitch. | `UNQUALIFIED_TO_BUY` |
| `qualified` | Offer times with `propose_slots`, then book (below). | `QUALIFIED_TO_BUY` |
| `interested`, `question` | Answer from the knowledge skills, then ask for the next missing fact. | unchanged |

## Qualification facts

Record each fact with `record_qualification` as soon as the lead states it.
Never ask for a fact the lead already gave. Ask for one fact per message.

| Field | Values | Required |
| --- | --- | --- |
| `line` | `term_life`, `whole_life`, `final_expense`, `health_individual`, `health_family`, `medicare_supplement`, `other` | yes |
| `state` | Two-letter US state code | yes |
| `ageBand` | `18-29`, `30-39`, `40-49`, `50-64`, `65+` | yes |
| `coverage` | What they want covered, in their words, under 120 characters | no |
| `timeline` | `now`, `30_days`, `90_days`, `later`, `unknown` | yes |

The lead is `qualified` when every required field is known and no disqualifier
applies.

### Disqualifiers

- The lead's state is not a state the agency is licensed in. The knowledge skills
  list the states. When they list none, do not disqualify on state.
- The lead is under 18.
- The lead asks for a product the knowledge skills do not describe. Classify
  `needs_human` rather than guess.

### What you never collect by text

- No date of birth: ask for the age band only.
- No health conditions, medications or diagnoses. When the lead volunteers
  them, do not repeat them and do not record them. The licensed agent covers
  health on the call.
- No Social Security number, policy number, bank or card details, or income.

## Order of a reply

1. Classify the message.
2. Act on the value (table above).
3. When the conversation goes on, answer the lead's question in one or two
   short sentences.
4. Ask for the next missing required fact, or offer times when qualified.

## Booking the call

Book only a qualified lead, or a lead who asks to talk to someone.

1. Call `propose_slots`. It returns 2 or 3 free times in the lead's time zone.
   Offer them in one short text with the labels it gives, and ask which works.
2. When the lead picks a time, call `book_meeting` with that `start`, copied
   exactly. Do not invent a time. When the lead asks for a time not offered, call
   `propose_slots` again.
3. `book_meeting` needs an email for the calendar invite. When it answers
   `needs-email`, ask for the email in one short text. When the lead gives it,
   call `book_meeting` again with the same `start` and the `email`.
4. When the lead refuses to give an email, call `book_meeting` with
   `emailDeclined` true. The call goes on our calendar only, and the licensed
   agent phones the lead at that time. Do not ask for the email again.
5. `booked`: the code sends the confirmation text itself. Send nothing more.
6. `slot-taken`: the time is gone. Offer the new times it returns.
7. `unavailable`: follow its `next` line. It tells you to send the booking link
   or to call `handoff_to_human`.

Never confirm a booking in your own words before `book_meeting` answers
`booked`.
