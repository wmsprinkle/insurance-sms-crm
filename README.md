# Insurance SMS CRM

An SMS-first CRM for insurance lead handling. It texts opted-in leads from a Telnyx
toll-free number, answers their replies with an AI assistant under strict rules, collects
the facts a licensed agent needs, and books the call on Google Calendar. Anything the
assistant should not handle goes to a person.

> **Attribution.** This project began as a fork of
> [trycompai/crm](https://github.com/trycompai/crm) v1.15.3 and is used under the MIT
> licence. The original copyright notice is kept in [LICENSE](./LICENSE).

## What it does

- **Lead intake.** Import a CSV or post to the lead webhook. Every lead needs a consent
  record: how and when they opted in, and the text they agreed to.
- **First message.** One text goes to each new lead at the next allowed time. Owners and
  admins edit the wording in Settings. The business name and the opt-out line are always
  kept.
- **AI replies.** The assistant classifies each reply, asks the qualifying questions,
  offers call times and books the meeting. Owners and admins choose whether replies wait
  for approval or go out at once, and can set the tone.
- **Handoffs.** Complaints, legal threats, claims, existing-policy problems and
  anything unclear stop the assistant and go to a person.
- **Compliance.** Every text passes one send gate: consent bound to the phone number,
  opt-outs, quiet hours by state, and a frequency cap. STOP, HELP and START are answered
  at once, with no model.
- **Booking.** Free and busy times and new events use Google Calendar.
- **Today.** A dashboard of leads texted, replied, interested and booked, with a setup
  checklist and the leads that need a person.
- **Sign-in.** Auth0, Google, Microsoft or your own OpenID Connect provider, with one
  allow-list of who may get an account.

## How the assistant is kept safe

The assistant is the most exposed part of the product, because strangers write to it.

- **A lead's words are data, never instructions.** They sit inside a fence in the prompt,
  and the fence marks are stripped from them.
- **Attack text goes to a person.** Instruction override, role play, prompt extraction,
  fake tool calls and look-alike letters, in English, Spanish and French, stop the
  conversation before any model call.
- **Few tools.** In an SMS conversation the assistant can use eight tools. All others are
  locked.
- **Every reply is checked before it is sent.** The guard replaces text that talks like
  a model, leaks instructions, quotes a price or a guarantee, or asks for a card, bank,
  password or Social Security number. It removes phone numbers, emails and links other
  than the booking link.
- **Hard limits.** Message length, messages per hour, model turns per hour and total
  conversation depth are capped.
- **One send per message.** A repeated request cannot send the same text twice.
- **Texting starts paused.** Nothing is sent until an owner or an admin turns texting on
  in Settings, Compliance.

## The stack

A [Turborepo](https://turborepo.dev) monorepo on [Bun](https://bun.com), deployed on
[Vercel](https://vercel.com).

| | |
| --- | --- |
| **Front end** | [Next.js](https://nextjs.org) App Router, [shadcn/ui](https://ui.shadcn.com) |
| **API** | [NestJS](https://nestjs.com) with [nestjs-trpc](https://nestjs-trpc.io) |
| **Assistant** | [eve](https://eve.dev) on the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) |
| **Data** | [Prisma](https://prisma.io) and Postgres ([Neon](https://neon.tech)) |
| **Auth** | [Better Auth](https://better-auth.com) |
| **SMS** | [Telnyx](https://telnyx.com) toll-free messaging |
| **Calendar** | Google Calendar |

| Path | |
| --- | --- |
| `apps/app` | Next.js front end, port 3000 |
| `apps/api` | NestJS API, port 3001 |
| `apps/agent` | The SMS assistant |
| `packages/db` | Prisma schema, migrations, database client |
| `packages/auth` | Sign-in configuration and permissions |
| `packages/validation` | Shared schemas and the outbound guard |
| `packages/ui` | Shared UI components |

## Run it

You need [Bun](https://bun.com) and Docker.

```sh
cp .env.example .env     # set DATABASE_URL, BETTER_AUTH_SECRET, ALLOWED_SIGN_IN
docker compose up -d     # Postgres
bun install
bun run db:migrate && bun run db:seed
bun run dev              # app :3000, api :3001, agent :2000
```

Setup in full, including every variable, Telnyx and Google: [docs/SMS_SETUP.md](./docs/SMS_SETUP.md).

## Documentation

| Doc | For |
| --- | --- |
| [docs/SMS_SETUP.md](./docs/SMS_SETUP.md) | Install, every variable, Telnyx, Google, going live |
| [docs/OAUTH_SETUP.md](./docs/OAUTH_SETUP.md) | Auth0, Google and Microsoft sign-in |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md) | Daily use: import, drafts, handoffs, STOP |
| [docs/TOLLFREE_VERIFICATION.md](./docs/TOLLFREE_VERIFICATION.md) | The Telnyx verification packet |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Deploying to Vercel |

## Status

Unit tests, type checks and lint pass. Database tests need a Postgres. No toll-free
carrier verification has been completed, and the per-state quiet-hours table has not had
a legal review. Work through the going-live checklist in
[docs/SMS_SETUP.md](./docs/SMS_SETUP.md) before you send a real text.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md). Report security issues privately through
[SECURITY.md](./SECURITY.md), not a public issue.

## Licence

[MIT](./LICENSE).
