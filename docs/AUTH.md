# Reddix identity, verified signup, and X

Reddix uses Better Auth 1.7.6 for X OAuth 2.0 with PKCE and PostgreSQL for admission and sessions. A Better Auth user is an authentication identity. It is not a Reddix membership. Every protected server operation must use `currentMember()` and the shared domain authorization predicates.

## Local development

Set `NODE_ENV` to a non-production value and `AUTH_MODE=development`. The local entry screen offers Alex (blue, administrator), Morgan (business), and Jamie (browse only). These are fictional fixtures. Development login bypasses X verification intentionally, issues an opaque server-side session in an httpOnly cookie, and never contacts X. Both conditions are checked again by the endpoint and session resolver. The endpoint returns 404 in production even if someone attempts to enable development mode.

Demo resync updates the fixture evidence timestamp and clearly returns `Local demo identity refreshed. No request was sent to X.` It never claims a successful X lookup. `GET /api/auth/status` exposes configuration readiness without exposing credentials.

## Enable the X integration

Configure these values in the deployment's secret manager:

| Variable                         | Purpose                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `AUTH_MODE=x`                    | Required in production                                                                    |
| `DATABASE_URL`                   | Persistent PostgreSQL connection                                                          |
| `BETTER_AUTH_URL`                | Exact application origin; HTTPS in production                                             |
| `BETTER_AUTH_SECRET`             | Independent random session/token-encryption secret, at least 32 characters                |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X OAuth 2.0 application credentials                                                       |
| `ADMIN_X_IDS`                    | Optional comma-separated immutable X IDs granted administrator status at first enrollment |

Register `https://YOUR_HOST/api/auth/callback/twitter` in the X developer app. The provider name is `twitter`, even though the service is X. For local provider testing the registered callback must match the actual development origin exactly.

The shipped adapter requests only `users.read`, `tweet.read`, and `offline.access`. The installed provider adds `users.email` by default and makes an email lookup, so Reddix disables default scopes and uses its documented custom user-info extension. A deterministic `X_ID@x.reddix.invalid` internal placeholder satisfies the auth database's required email shape. There is no email login, password login, account linking, user update, or token-export HTTP endpoint.

Better Auth encrypts provider tokens at rest. It has its own small PostgreSQL pool because Drizzle changes a postgres-js connection's timestamp and JSON serializers; sharing that connection with the raw domain SQL would break date writes. Production requests only assert that the required schema exists. Run `pnpm db:setup` explicitly for migrations; automatic local setup requires `AUTO_MIGRATE=1` and is disabled in production.

## First administrator

Set the first administrator's exact immutable X ID in `ADMIN_X_IDS` before their first enrollment. The public client cannot set roles. The administrator signs up with a verified X account and needs a fresh blue/business badge to publish content. After bootstrap, changes to existing roles require a trusted administrative operation rather than editing a public profile.

## Admission sequence

1. The landing page offers **Join with X**. `POST /api/auth/sign-in/social` with `{ "provider": "twitter", "callbackURL": "/popular" }` creates a ten-minute authentication attempt. A returning member's opaque admission pass can bind that attempt to their X ID; an existing member can also sign in on a fresh browser.
2. Better Auth manages the provider redirect, state, and PKCE. Reddix binds its attempt ID to the library's server-trusted OAuth state slot. Client `additionalData` cannot populate that slot. External return URLs, extra provider scopes, client ID tokens, and account-link paths are rejected or replaced with the server's fixed policy.
3. The callback retrieves the profile from X, confirms the immutable X ID, and stores temporary profile evidence on the admission attempt. Better Auth creates the authenticated identity and session. Existing admitted members sign in even if their verification has lapsed, retaining browse-only access when they cannot contribute.
4. New members require fresh, authoritative `verified_type` evidence of `blue`, `business`, or `government`. Missing, unknown, stale, or unverified evidence cannot create a membership. Neither an old invitation code nor organization affiliation bypasses verification.
5. The admission transaction locks the attempt and X identity, creates one admitted member, records an audit row, clears temporary profile evidence, and creates an opaque returning-member pass. New members continue into profile, interest, and city onboarding without entering a code.
6. Rejected new signups lose the pending session and return to the landing page with `authError=verification-required` or `verification-unavailable`. Other admission failures return `authError=admission`. Callback replay fails after its state or attempt is consumed.

Invitation issuance, redemption, and the X bot's invitation DMs are retired. Historical invitation tables remain for migration safety; codes cannot grant admission. Browser passes never replace X authentication or new-signup verification.

## Eligibility and profile sync

Only explicit `verified_type: blue` or `business` evidence enables contributions. Government, none, missing, and unknown types do not. A paid subscription or the legacy boolean `verified` never grants a capability. Badge evidence expires after 24 hours and is rechecked by domain contribution actions when stale. Manual resync has a five-minute cooldown. All field fallback attempts share an eight-second timeout. If extended fields are unsupported, the adapter falls back to basic identity fields, allowing existing members to sign in with browse-only permissions. New members must retry once X can supply verification evidence.

Presentation stays in the Reddix `users` snapshot. Initial signup and explicit resync update it; ordinary login updates eligibility only. Manual sync serializes per immutable X ID using a PostgreSQL advisory transaction lock. Evidence updates carry observation times to prevent older callback evidence from overriding a newer check.

A provider timeout, rate limit, or server error preserves a previously valid lease only until its original expiry. Unknown evidence or an authorization failure from the X profile endpoint immediately clears eligibility. Better Auth normalizes token refresh errors and does not preserve a reliable distinction between revocation and a temporary provider failure, so that ambiguous failure cannot extend evidence and is presented as a retry/reconnect condition.

## HTTP interfaces

| Route                            | Contract                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/auth/status`           | Configuration readiness and returning-member state; invitation codes are not required |
| `POST /api/auth/dev-login`       | `{ persona: "alex" \| "morgan" \| "jamie" }`; local fixtures only                     |
| `POST /api/auth/invite`          | Retired endpoint; returns 410 without granting admission                              |
| `POST /api/auth/sign-in/social`  | Starts verified-X signup or existing-member login                                     |
| `GET /api/auth/callback/twitter` | Better Auth's OAuth callback, with verified-signup admission hooks                    |
| `POST /api/auth/logout`          | Revokes the current session and clears its cookie                                     |

Mutation requests require an exact matching `Origin` header. The public auth catch-all uses an explicit endpoint allowlist, so generic Better Auth profile mutation, token access, linking, and alternate login endpoints are not reachable. Shared PostgreSQL counters rate-limit OAuth requests. Authentication responses use `Cache-Control: no-store`.

## Validation and remaining production work

Run `pnpm exec vitest run tests/auth.test.ts tests/auth.integration.test.ts` with local PostgreSQL running. The integration suite uses the installed Better Auth implementation and mocked X token/profile responses. It verifies PKCE/scopes, encrypted tokens, session-to-membership resolution, verified-account signup, denial when evidence is missing or unverified, returning members on a fresh browser, and callback replay protection.

Live X credentials are still required to verify actual endpoint entitlements, badge field availability, business/government-account behavior, refresh/revocation responses, and production redirects. The authenticated `/api/jobs` worker refreshes a bounded batch of active accounts after 12 hours; deployment must configure its scheduler secret and cadence. Abandoned-auth cleanup, provider usage budgets, key rotation, and production alerting require further operational work. Expiration checks deny stale contribution privileges even if no scheduler is running. Do not call the X integration live-validated until those real provider checks have been performed.

## Account privacy and sessions

`GET /api/account/status` returns only the caller's own member snapshot. It remains available when onboarding is unfinished or the account is suspended, allowing the app to show restricted account/privacy controls. Suspended accounts may authenticate with X but cannot access community content.

`GET /api/account/export` returns a JSON attachment containing only the current member's profile snapshot, private preferences, authored contributions and events, own registrations, saves, follows, notifications, reports, suggestions, invitation lifecycle metadata, and votes. It excludes provider credentials, all session/admission tokens, invitation codes/digests, other members' registration data, and other members' private settings. A URL parameter cannot select another member's export. The response is private and never cached.

`POST /api/account/revoke-sessions` requires a same-origin authenticated request. It revokes other Reddix sessions, preserves the server-validated current session, and returns `{ revoked, currentSessionKept: true }`. Admission passes are not authentication sessions and do not grant browsing on their own.

`DELETE /api/account` requires a matching Origin, authentication within the previous 15 minutes, and `{ "confirmation": "EXACT_CURRENT_X_HANDLE", "deleteContent": true }`. `deleteContent` defaults to true. A mismatch returns `CONFIRMATION_REQUIRED`; stale authentication returns `RECENT_AUTH_REQUIRED`. Suspended and onboarding-pending admitted accounts retain these privacy controls while normal platform content remains unavailable to them.

Deletion atomically marks the account deleted, removes its live X identity and local preferences, clears provider credentials and sessions, revokes admission passes/invitations, removes private participation, removes the member's votes, and cancels future hosted events with participant notices. Default content deletion replaces authored posts/comments with anonymous tombstones while preserving other people's replies, removes event details/private venue data, and removes authored event announcements. Explicit `deleteContent: false` retains the member's published contributions under a deleted-author identity. Confirmed registrations in other hosts' events release capacity and promote the next eligible approved waiter under the event row lock.

Physical image deletion uses the configured private storage adapter after database access has been removed. A failed object deletion is recorded under the restricted `account.media_cleanup_pending` audit action, and the API returns its pending count for operational follow-up. Retained audit records contain the anonymous internal ID and minimal action metadata; deployment retention policy still needs to cover historical backups. Shared X-identity locks and authoritative member rereads prevent queued resyncs from restoring deleted identity data.

Reddix deletes its locally stored provider credentials. It does not claim to revoke the X app grant remotely, and it does not delete the user's X account. Users can revoke the app's access from their X account settings. Tests in `tests/account.test.ts` verify export isolation, current-session preservation, exact confirmation/recent-auth/Origin protections, anonymous tombstones, provider credential removal, event cancellation and waitlist promotion, suspended-account privacy access, and queued-resync rejection.

Implementation references: [Better Auth X provider](https://better-auth.com/docs/authentication/twitter), [OAuth server context and no-email identity](https://better-auth.com/docs/concepts/oauth), [X self-user lookup](https://docs.x.com/x-api/users/get-my-user). Installed package source was also inspected to verify actual scopes, callback hooks, token handling, and account resolution.

The marketing bot uses a separate admin-connected OAuth client with posting scopes. It no longer requests DM scopes or issues invitation codes. See [X growth](X_GROWTH.md).
