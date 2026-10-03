# Build status — P0 (tasks 1–2)

Date: 2026-10-03. Built by worker-crm-p0-fork2 against bun 1.3.12, Node 22.22.0.
Plan: `../RESEARCH.md` section 4.

## Commits

1. `Import upstream trycompai/crm v1.15.3` — upstream tree as downloaded (no `.git`), `bun.lock` kept.
2. `P0 task 1` — product renamed to Insurance SMS CRM (root package `insurance-sms-crm`, README with
   attribution to trycompai/crm, MIT `LICENSE` unchanged). New `@crm/env/features` with
   `FEATURE_ENRICHMENT`, `FEATURE_SLACK`, `FEATURE_TRACKING` (off unless `"true"`), gating
   Context.dev/LinkedIn/Perplexity in the agent, Slack credentials in `@crm/auth`, and the public
   tracking endpoints. Nothing deleted.
3. `P0 task 2` — Prisma: `SmsMessage`, `ConsentRecord`, `PhoneSuppression`, enums `SmsDirection`,
   `SmsStatus`, `ConsentSource`, `SuppressionReason`; `RecordSource.LEAD_IMPORT`, `ActivityType.SMS`;
   `Contact.phone` partial unique index `contact_phone_active_key` (where `archivedAt` is null) and
   an E.164 CHECK. Migration `packages/db/prisma/migrations/20261003140000_sms_consent_suppression`.
   Contact create/update now normalise phone to E.164 (`@crm/validation/phone` `toE164`).

## Commands and results

Env used: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm` (dummy; no database runs).

| Command | Result |
|---|---|
| `bun install` | pass (Prisma engines need `binaries.prisma.sh` reachable) |
| `bun run db:generate` (`prisma generate`) | pass |
| `bunx prisma validate` / `prisma format` | pass |
| `bun run check-types` | pass, 13/13 tasks |
| `bun run lint` (biome per package) | pass, 9/9 tasks |
| `bun run lint:slop` (`oxlint`) | pass |
| `bun test` in `packages/validation` | pass, 8 tests (incl. new `phone.spec.ts`) |
| `bun run lint:dead` (`knip`) | **fails, pre-existing**: same findings on the untouched upstream import (unused deps/exports in upstream). No new findings from P0. |

## Not run

- `bun run test` / agent and api specs: upstream tests are integration tests that require
  `TEST_DATABASE_URL` (a throwaway Postgres, `bun run db:test`). No database is available to the
  build agent. `apps/agent/test/capabilities.spec.ts` was updated for the enrichment flag but not run.
- `prisma migrate deploy` against a real database. The migration was produced with
  `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script`,
  plus hand-written phone normalisation and the CHECK constraint.

## Notes for later phases

- Migration behaviour: existing phones are normalised to E.164 (bare 10-digit = +1). Rows that cannot
  be normalised are kept; the CHECK is `NOT VALID`, so they cannot be saved again until fixed. If two
  active contacts share a number after normalisation, the unique index fails and names it.
- `Company.phone` is untouched (not texted).
- `toE164` assumes North America for numbers without `+`; P2 import may swap in `libphonenumber-js`.

# Build status — P3 tasks 10–11 (worker-crm-p3a-agent)

Date: 2026-10-03. bun 1.3.12.

## What exists

- `apps/agent/agent/hooks/outbound-guard.ts` — port of `guard.py` and the `llm.py` output rules.
  Exports `detectInjection`, `breaksCharacter(message, disclosure)`, `stripContactInfo`,
  `guardOutbound({ message, bookingLink, disclosure })` (verdict `pass | sanitized | fallback`),
  `OUTBOUND_GUARD` (480-char cap, 16-message history, 400 chars per message, `SAFE_FALLBACK`),
  `DISCLOSURE_MODES`, `outboundSmsInput`. eve hooks are observe-only, so the default hook only logs
  when the model asks `send_sms` for a body that breaks character or exceeds the cap.
  **Enforcement is `guardOutbound`, which the `send_sms` tool (task 12) must call before sending.**
- Changes from the Python version: `\bDAN\b` is case-sensitive (the name "Dan" no longer reads as an
  injection); curly apostrophes are matched; the vendor-name alternation is grouped; digits inside
  the kept booking link are no longer stripped as a phone number; the cap counts characters, not
  UTF-16 units; in `disclose` mode an honest "I'm an automated assistant" passes (the old guard
  replaced it with the fallback, so disclose mode never worked).
- Skills (flat markdown, load on demand): `sms-conduct` (rules 1–13, disclosure modes),
  `qualification` (classify enum, opt-out in free text, "no" is not a refusal, fields, disqualifiers,
  deal-stage mapping), `compliance`, and knowledge templates `knowledge-agency`,
  `knowledge-term-life`, `knowledge-health-insurance` (ported from the old `knowledge/*`).
- To customise knowledge: edit or add `apps/agent/agent/skills/knowledge-<product>.md` with a
  `description:` line starting "Use when a lead asks about…". Keep all knowledge bodies under 9000
  characters (tested). No prices, guarantees, URLs, emails or phone numbers (tested). Set the
  licensed states in `knowledge-agency.md`.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/outbound-guard.spec.ts test/sms-skills.spec.ts` (apps/agent) | pass, 80 tests |
| `bun run check-types` (apps/agent) | pass |
| `bun run lint` (apps/agent, biome) | pass; 1 pre-existing warning in `agent/lib/tasks.ts` |
| `bun run lint:slop` (root oxlint) | no findings in P3 files; fails on other temps' files in `apps/api` |

## Needs from later tasks

- Task 12 `send_sms`: call `guardOutbound` and send `verdict.message`; take the input as
  `outboundSmsInput` (`{ body }`) or change both together. Tool names the skills use: `send_sms`,
  `classify_reply`, `opt_out_contact`, `handoff_to_human`, `record_qualification`, `propose_slots`.
- Task 13 pipeline: run `detectInjection` on inbound text; put `Disclosure mode: disclose|deflect`
  and the booking link (when any) in the task message; cap history with `OUTBOUND_GUARD`.
- `classify_reply` enum and qualification field values belong in `packages/validation` (not in
  P3a scope); they must match `qualification.md`, which `test/sms-skills.spec.ts` checks.
- Task 20: the disclosure-mode setting. Default is `disclose`.
