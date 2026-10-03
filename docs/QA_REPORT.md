# QA report — final verification of HEAD

Date: 2026-10-03. Author: worker-crm-qa2. HEAD at start: `11013cc`. bun 1.3.12, Node 22.22.0.
Every check ran from scratch on a clean tree. This report replaces the earlier one.

## Result

| Check | Result |
| --- | --- |
| `bun install` | pass |
| `bun run db:generate` | pass |
| `prisma validate` (packages/db) | pass |
| `bun run check-types -- --force` | pass, 13/13 |
| `bun run lint -- --force` | pass, 9/9 (upstream warnings only) |
| `bun run lint:slop` (oxlint) | pass. 11 findings fixed in this job. |
| `bun run lint:dead` (knip) | **fail, upstream findings only.** 0 findings come from our SMS code. |
| apps/agent tests (PGlite) | 659 pass, 0 fail |
| apps/api tests (PGlite, in-process HTTP) | 719 pass, 0 fail |
| apps/app tests | 201 pass, 0 fail |
| packages/auth tests (PGlite) | 54 pass, 0 fail |
| packages/db tests | 115 pass, 0 fail |
| packages/env tests | 22 pass, 0 fail |
| packages/telemetry tests (PGlite) | 60 pass, **1 fail** (needs two real processes) |
| packages/validation tests | 92 pass, 0 fail |
| packages/ui | no test script |
| Migrations, all 61 in order | apply. No drift against `schema.prisma`. |
| Core-loop end-to-end (`core-loop.integration.spec.ts`) | pass, 7 |
| Security-paths end-to-end (`sms-security-paths.integration.spec.ts`) | pass, 16 |
| Secrets scan, tree and full history | clean |

Totals: 1,922 tests pass, 1 fails. The one failure is a sandbox limit, not a defect (see below).

## Commits from this job

| Commit | Change |
| --- | --- |
| `51b2c3d` | Fix the 11 oxlint (anti-slop) findings. Remove `export` from 30 symbols in our SMS code that knip reported as unused. No behaviour change. |
| `013e678` | `apps/api/test/sms-security-paths.integration.spec.ts`: 16 end-to-end tests for the security paths. |
| `649c14f` | Docs: business name, licensed states, calendar settings and frequency cap are settings now. |
| (this commit) | `docs/QA_REPORT.md`, `docs/HANDOFF.md`, `docs/BUILD_STATUS.md` section. |

### What the lint fixes changed

- `procedure-roles.ts`: `RANK` and `REQUIRED_RANK` use `as const satisfies` and no longer widen to `Record`.
- `sms-config.ts`, `keywords.ts`: the homoglyph and slang tables are entry lists. `keywords.ts` builds a `Map` from each. The folding result is the same. `sms-keywords.spec.ts` passes.
- `send-gate.ts`: `id: ownReceiptId ? { not: ownReceiptId } : undefined` replaces a conditional spread. Prisma ignores `undefined`.
- `compliance-fix2.spec.ts`, `sms-deny-by-default.spec.ts`: typed parameters replace `unknown`. A truthiness check replaces `typeof`.
- The stale-key failure in `procedure-roles.spec.ts` is gone. The spec passes (27 tests).

### Knip

Knip reported 52 unused exports and 63 unused exported types. 30 came from our SMS code (for example `zonedParts`, `normaliseKeyword`, `systemClock`, `SmsDraftRow`, `TelnyxIgnored`). Each is now file-local. A symbol counts as ours when it is absent from upstream import `1e08a6e`.

The remaining 85 findings (41 exports, 44 types), 5 unused dependencies, 2 unlisted dependencies and 1 unresolved import exist in upstream code. They were not touched.

## How the database ran

- No `docker`, `postgres`, `pg_ctl` or `psql` exists here. `embedded-postgres` fails on `shmget` (EPERM). TCP and Unix-socket `listen` fail with EPERM.
- PGlite 0.5.8 (Postgres compiled to WASM) runs inside the test process. `pglite-prisma-adapter` 0.7.2 connects the generated Prisma client.
- A preload file builds the database from every migration, then sets `globalThis.prisma`. `@crm/db` reuses it. Repeat with:

```sh
npm i @electric-sql/pglite pglite-prisma-adapter   # in a scratch folder
bun test --preload <scratch>/pglite-preload.ts      # in each package
```

- The preload files are in the appendix. They live outside the repo.
- With a real Postgres, run `bun run db:test` and the suites as normal. No preload is needed.

### The 7 port-binding specs

`auth.e2e.spec.ts` (5 tests) and `tracking-collector.spec.ts` (1 test) call `supertest`, which listens on a port. A second preload replaces `supertest` with `light-my-request`. It calls the Nest HTTP server's request handler with no socket. All 6 tests pass. The full API suite ran in one process: 719 pass, 0 fail.

This proves the routes, guards and Better Auth mount. It does not prove real TCP, TLS or proxy behaviour.

The 1 telemetry failure is `install.integration.spec.ts` "hands back the same UUID to two separate processes". It spawns child processes. They cannot share an in-process PGlite. There is no in-process alternative.

## Migrations and drift

- All 61 migration folders apply in order on PGlite, from the upstream ones to `20261003170000_consent_phone_retention`.
- Drift check: one database from the migrations, one from `prisma migrate diff --from-empty --to-schema`. Compared: columns (687), indexes (226), enums (119), functions, constraints.
- Columns, indexes, enums and functions match exactly. Constraints differ by two hand-written CHECK constraints that Prisma cannot express: `contact_phone_e164_check` (`NOT VALID`) and `agentBuilderArtifact_owner_present`.
- `prisma migrate deploy` did not run. It needs a server connection.
- Migration `20261003140000` fails on an existing database where two active contacts share a phone after normalisation. Merge or archive them first.

## End-to-end tests

Both specs use the real services, the real agent tools and pipeline, a fake Telnyx `fetch`, a fake Google `fetch`, and a scripted model. They call the bridge services directly, not the HTTP controllers. `focusOn` is stubbed. No `eve` runtime and no real model run.

### `core-loop.integration.spec.ts` (7)

Import with and without consent, first touch at the next send window, signed inbound, qualify and offer slots, book, STOP, and no send to a contact without consent.

### `sms-security-paths.integration.spec.ts` (16)

| Path | What the test proves |
| --- | --- |
| Free-text opt-out (2) | "please stop" and "pls dont txt me" suppress the number (`OPT_OUT_REQUEST`). No `sms-reply` task exists. The model runs 0 times. One confirmation text goes out and it names the business. |
| Suppressed inbound (2) | An inbound from a suppressed number is stored (`stored-no-reply`). It queues no task, starts no model turn and sends nothing. A reply task queued before the suppression settles without a model turn and without a send. |
| Consent bound to phone (1) | After the contact's phone is edited, a send to the new number is `blocked` `no-consent`. A send to the old number fails. Telnyx gets nothing. |
| Frequency cap (1) | 3 texts go out. The 4th is `blocked` `frequency-cap`. After the lead answers, the next text goes out. |
| Telnyx timeout (1) | A timed-out send leaves the receipt `sms.send.unknown` and throws. Approving a draft with the same key answers `unknownOutcome`, sends nothing and keeps the draft `PENDING`. |
| Business name (2) | The first-touch payload and the sent first text hold the business name and STOP. The booking confirmation text holds the business name. |
| Role gating (7) | A member is refused on `settings.setSms`, `settings.setCalendar`, `leads.importCommit`, `contacts.purge`, `workspace.setMemberRole`, `apiKeys.create`. A member can still run `sms.markHandled`. |

Mutation check: with the cap set to 99, with the gate's consent check removed, and with the stop-word rule removed, the matching test fails each time. Each change was reverted.

The spec pins the clock to 17:00 UTC of the current day. Database timestamps use the real clock. A run on any day passes.

## Secrets scan

- Tracked files: only `.env.example` matches an env file name. `.env` is in `.gitignore`.
- Tree (`git grep`) and the added lines of every commit (`git log --all -p`): no Anthropic, OpenAI, AWS, Google API, Google OAuth, Slack, GitHub, Telnyx (`KEY0…`) or private-key pattern. No `.pem`, `.p12` or `id_rsa` file was ever committed.
- `.env.example` holds no value for any key, secret, token or password variable.

## NOT verified

1. **Real Postgres concurrency.** The frequency-cap race, the idempotency claim race, the advisory behaviour of unique indexes and `prisma migrate deploy` ran only on PGlite (single connection). Parallel sends on one contact are tested with sequenced promises, not with parallel connections.
2. **Real Telnyx.** No live API call, no real webhook delivery, no delivery receipt, no rate-limit behaviour, no 10DLC or toll-free routing. Signature checking uses a generated Ed25519 key.
3. **Real Google.** No OAuth consent, no real free/busy or event insert, no Meet link. A fake answers.
4. **eve runtime lockdown.** Each authored tool refuses an SMS session on its own, and a spec proves it by calling `execute`. The stub replay across a durable step boundary and the routing of subagent calls were never run in the eve runtime. eve has no API to remove a tool, so an allowlist was not built.
5. **Evals that need a model key.** No `eve eval` ran (`apps/agent/evals/sms`). No real model wrote any reply. Reply quality, injection resistance in a live turn and the outbound guard against model output are unmeasured.
6. **`next build` and UI render.** `next build` cannot fetch Google Fonts here. No page rendered. The Compliance settings forms, the Drafts queue, the Agent tab SMS sessions and the import page were checked by types and unit tests of pure helpers only.
7. **The Nest app did not boot as a server.** The auth e2e boots `AppModule` in process. No process listens on a port.
8. **Toll-free carrier verification.** The packet in `TOLLFREE_VERIFICATION.md` is not submitted. Approval is unknown.
9. **Legal review of the per-state quiet-hours table.** The table in `compliance-config.ts` has no lawyer's review.
10. **Counsel decisions in `COMPLIANCE_RECHECK.md`.** Open items: whether a purge suppresses the phone, whether START may grant consent, CASL for Canadian `+1` numbers, the 5-year consent retention, and whether `deflect` disclosure mode is allowed in your states.
11. **Telemetry two-process test.** See above.
12. **Backfill on production data.** Migration `20261003170000` copies `Contact.phone` to `ConsentRecord.e164`. Run the check in `BUILD_STATUS.md` (fix round 2, N4) on real data before deploy.

## Issues

1. UNKNOWN — Nothing ran against a real Postgres server. Concurrency and `migrate deploy` are unproven.
   Fix: not done. Run `bun run db:deploy` and `bun run test` with a real `TEST_DATABASE_URL`.
2. UNKNOWN — The eve runtime lockdown and all evals did not run. No model key exists here.
   Fix: not done. Run `eve eval` in staging with a key.
3. UNKNOWN — No page rendered. `next build` is blocked by Google Fonts here.
   Fix: not done. Run `bun run dev` and click through import, drafts and Compliance settings.
4. BROKEN — `packages/telemetry` "two separate processes" fails in PGlite. It needs a shared server.
   Fix: not done. It passes with a real Postgres.
5. BROKEN — `bun run lint:dead` (knip) fails on 85 upstream unused exports, 5 unused dependencies, 2 unlisted dependencies and 1 unresolved import.
   Fix: not done. These exist in the untouched upstream import.
6. RISK — Migration `20261003170000` copies the current contact phone to old consent rows. A phone edited before the migration keeps old consent.
   Fix: not done. Run the check in `BUILD_STATUS.md` (fix round 2, N4) before the production deploy.
7. RISK — The quiet-hours table and the counsel items in `COMPLIANCE_RECHECK.md` have no legal review.
   Fix: not done. Get review before live texting.
8. NOT DONE — The end-to-end tests call the bridge services, not the HTTP controllers. They use a scripted model.
   Fix: not done. Needs a staging run.

## Appendix — preload files (kept outside the repo)

`pglite-preload.ts`. Replace `<scratch>` and `<repo>`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "<scratch>/node_modules/@electric-sql/pglite/dist/index.js";
import { PrismaPGlite } from "<scratch>/node_modules/pglite-prisma-adapter/dist/index.mjs";
import { PrismaClient } from "<repo>/packages/db/src/generated/prisma/client";

const dir = "<repo>/packages/db/prisma/migrations";
const pg = await PGlite.create();
for (const m of readdirSync(dir).filter((d) => /^\d/.test(d)).sort()) {
	await pg.exec(readFileSync(`${dir}/${m}/migration.sql`, "utf8"));
}
globalThis.prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) });
```

`inproc-preload.ts` for the two `supertest` specs. Run `npm i light-my-request` in the scratch folder. Set `BETTER_AUTH_SECRET` (32+ characters), `API_URL`, `ALLOWED_SIGN_IN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Then run `bun test --preload inproc-preload.ts` in `apps/api`:

```ts
import { mock } from "bun:test";
import inject from "<scratch>/node_modules/light-my-request/index.js";

class Req implements PromiseLike<unknown> {
	private headers: Record<string, string> = {};
	private payload: string | undefined;
	private expected: number[] = [];
	constructor(private server: any, private method: string, private url: string) {}
	set(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; }
	send(b: string) { this.payload = b; return this; }
	expect(code: number) { this.expected.push(code); return this; }
	async run() {
		const handler = this.server.listeners("request")[0];
		const res = await inject(handler, { method: this.method as any, url: this.url, headers: this.headers, payload: this.payload });
		let body: unknown = {};
		try { body = JSON.parse(res.payload); } catch {}
		for (const c of this.expected) if (res.statusCode !== c) throw new Error(`expected ${c}, got ${res.statusCode}`);
		return { status: res.statusCode, headers: res.headers, body, text: res.payload };
	}
	then(a: any, b: any) { return this.run().then(a, b); }
}
const request = (server: any) => ({
	get: (u: string) => new Req(server, "GET", u),
	post: (u: string) => new Req(server, "POST", u),
});
mock.module("supertest", () => ({ default: request }));
await import("<scratch>/pglite-preload.ts");
```
