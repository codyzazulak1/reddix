# Reddix on X

The implementation is ready for local testing. It has not posted to X or been tested with live bot credentials. `X_BOT_MODE=off` is the default. Creating the bot account and supplying credentials are still launch requirements.

## Agreed product behavior

- Signup is open to anyone with a verified X account. The bot no longer collects invitation requests, classifies profiles for admission, creates codes, or sends invitation DMs. Previously queued invitation deliveries are canceled and their encrypted codes are cleared.
- Every new post submitted with public promotion enabled enters a durable publishing queue. The new-post composer enables promotion by default and clearly shows the title/handle/link disclosure and an opt-out. Existing posts and old API clients are private by default. Settings can opt out of all future promotions, and the post menu can withdraw individual sharing. Existing X publications may remain on X. The bot uses its own account and tags the author; it does not post through member accounts.
- The bot publishes daily highlights for the preceding Pacific calendar day: the highest net-voted, eligible-for-sharing post created that day, its author, the number of published human comments created across the site that day, and optionally the number of member sessions. Ties use creation time then ID. A day with no eligible top post still has aggregate highlights. Bodies, comments, private images, and private messages are never included in marketing posts.
- Highlights are queued by the first five-minute cron invocation after midnight in `America/Los_Angeles`. Daylight saving changes are handled by calendar boundaries in PostgreSQL, including 23- and 25-hour days. Cron/provider delays and queue limits can delay publication; this is not an exact-second delivery guarantee. A unique date prevents duplicate daily jobs.
- Member sessions are first-party interactions grouped by member, starting again after 30 minutes of inactivity. Concurrent tabs do not create duplicate sessions. The app records visible page entry, focus/visibility return, and throttled pointer/keyboard activity. Background chat polling does not count as activity. This is a member-session metric, not login count, unique daily users, or anonymous traffic. Records expire after 90 days and are included in account export/deletion. Set `X_BOT_INCLUDE_SESSIONS=1` to publish the aggregate.

## Official company affiliations

Admins map a Reddix community to an X account with `verified_type=business`. For example, the Speedrun community can be connected to `@speedrun`. The backend resolves and stores the immutable organization ID and reads `GET /2/users/:id/affiliates`.

Only inclusion in that official API response is proof. Bios, follows, screenshots, AI guesses, and manual affiliation overrides cannot grant this role. The screenshot supplied during development illustrates the intended Affiliates list; no names or affiliations were seeded from it.

Each sync persists pagination and reconciles removals only after a complete successful scan. Incomplete scans do not revoke unrelated records. Evidence expires after 48 hours if refresh cannot complete. Organizations refresh daily; paginated scans continue every five minutes. API access to other organizations' affiliate lists must be verified with the owner's real X app before launch. A missing entitlement fails closed and appears in the admin panel.

Affiliates sign up under the same verified-X requirement as everyone else. Affiliation grants a discussion-leader badge while its evidence is fresh, and never bypasses signup verification. Members still complete onboarding and meet the existing blue/business contribution requirement. Onboarding follows their affiliated communities. The community shows its actual X business link and admitted discussion leaders, and posts and replies in that community carry a discussion-leader badge. The role has no moderation powers. Losing affiliation removes the badge; it does not silently expel an already admitted member. Reddix remains independent of the organizations discussed.

## API and account checklist

| Service            | Required capability or configuration                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Database  | Server-only PostgreSQL, TLS, pooled runtime connection in `DATABASE_URL`; use a direct or session connection for schema migrations.                                          |
| Supabase Storage   | Native Storage API: `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `STORAGE_BUCKET`. Create the bucket with public access disabled.                 |
| X member login     | Existing OAuth client: `X_CLIENT_ID`, `X_CLIENT_SECRET`, callback `/api/auth/callback/twitter`; scopes `users.read tweet.read offline.access`.                               |
| X bot              | Create the Reddix bot account. Set its immutable `X_BOT_USER_ID` plus confidential-client `X_BOT_CLIENT_ID` and `X_BOT_CLIENT_SECRET`. Register `/api/admin/x-bot/callback`. |
| X reads            | Authenticated bot identity, user lookup, and official organization affiliates. Verify endpoint entitlements and rate limits for the purchased access.                        |
| X writes           | Create posts. The bot OAuth requests `users.read tweet.read tweet.write offline.access`. Member login scopes do not change.                                                  |
| Vercel / scheduler | Existing `/api/jobs` plus `/api/jobs/x`, each every five minutes with `Authorization: Bearer <CRON_SECRET>`. Use a plan/scheduler that supports this cadence.                |

The Supabase Data API must be disabled for this server-only schema, or explicitly isolated from all Reddix tables. This app uses its own authorization and direct PostgreSQL, not Supabase Auth or client-side table access. New growth tables additionally enable RLS with no public policies. Keep both database credentials and `SUPABASE_SECRET_KEY` on the server. The secret key bypasses storage RLS, so the app's authenticated media route is the authorization boundary. Use a private bucket and never expose the secret key. The native adapter sends the secret key in the `apikey` header and requires no S3 credentials.

## Activation

1. Create the bot account, configure its identity/automated-account presentation, and provision the X developer app. Confirm provider API credits and access to the listed endpoints. Do not assume ordinary login access includes affiliate enumeration.
2. Apply migrations with `pnpm db:setup`, including the auth schema update. Supply the production app origin, bot client values, and existing session and cron secrets. Store runtime secrets in the deployment environment, not source control.
3. Sign into Reddix as an admin and choose **Connect bot account** in Admin > Community growth. Authorize the bot on X. The callback requires the same Reddix admin and verifies the returned X ID against `X_BOT_USER_ID`. Tokens are encrypted at rest, refresh tokens rotate under a database lock, and PKCE/state protect connection setup.
4. Set `X_BOT_MODE=dry-run`. This reads X, so provider costs can still occur, but it cannot publish posts. Review previews and affiliate syncing. Link Speedrun and other actual business accounts in the admin panel.
5. Review X's automation requirements for this brand campaign and obtain any required X approval. Public text uses fixed templates. The bot does not send direct messages or use AI to screen signups.
6. After the X requirements are satisfied, set `X_BOT_AUTOMATION_APPROVED=1` and `X_BOT_MODE=live`. Release selected preview items from the queue and perform a controlled real-account test. The bot checks its account ID before running. No account has been created or external message sent during implementation.

## Delivery and operations

The worker is protected by a database lease and runs bounded batches. It syncs one organization page and attempts up to three queued post deliveries per run. Outbox dedupe keys prevent duplicate jobs.

A successful X receipt is stored. Rate-limit responses can retry later. A timeout, server-side failure on a write, malformed successful response, process crash during a send, or receipt-persistence failure is marked uncertain rather than automatically sent again. Admins must inspect X before retrying or record the actual remote ID to confirm delivery. This avoids claiming exactly-once delivery across an external API that does not offer a transactional send with our database. Repeated throttling, token revocation, deleted posts, and withdrawn promotion consent remain visible or cancel pending delivery appropriately.

The default cap is 100 X posts per UTC day. These are request allowances, not guaranteed dollar budgets. Provider-side billing limits and operational monitoring are still necessary. Highlight generation and aggregate counts come from SQL, not AI-written statistics. The public text uses fixed templates with bounded titles and prevents extra mentions from being injected through titles.

## Official references checked

- [X user lookup](https://docs.x.com/x-api/users/get-user-by-id)
- [X organization affiliates](https://docs.x.com/x-api/users/get-affiliates)
- [X post creation](https://docs.x.com/x-api/posts/create-post)
- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
