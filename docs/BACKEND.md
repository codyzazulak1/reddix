# Backend implementation

Reddix uses PostgreSQL with the `postgres` driver. Application services in `src/server` own authorization, validation, persistent state changes, and response DTOs. Domain migrations are checked in at `db/001_initial.sql` and `db/002_chat.sql`. Authentication tables are owned by `src/lib/auth-store.ts`.

## Database setup

Set `DATABASE_URL`, then run `pnpm db:setup`. The setup command calls `migrateDatabase()` followed by `migrateAuthDatabase()`. Both migrations are idempotent. Run this explicitly during deployment before routing production traffic to the application. Back up existing databases before applying schema changes.

`AUTO_MIGRATE=1` permits automatic initialization only outside production. Production `ensureDatabase()` checks the schema version and required tables without running DDL or seeds. Production requests do not fall back to development authentication or development storage.

Community records are created during explicit setup. Fictional members, discussions, and events are seeded only when `NODE_ENV` is not production and `AUTH_MODE=development`. The seed marker prevents reseeding content on each start. Production setup creates no fictional members or activity.

## Protected APIs

All content endpoints require an admitted, active session. Pending onboarding receives only its own account in the bootstrap response, with empty content arrays. Writes enforce onboarding, current blue/business eligibility, resource visibility, ownership or host/admin permissions, and resource state. Same-origin checks protect browser mutations. Admin mutations additionally require recent authentication.

`POST /api/actions` accepts a validated action object. It handles discussions, comments, votes, saves, follows, reports, preferences, community suggestions, invitations, event operations, and administrator reviews. The API returns safe `{error:{code,message,requestId}}` failures. X credentials, provider tokens, invitation digests, and host-only information never appear in ordinary response DTOs.

PostgreSQL guards recheck the authoritative member and lock its row before publishing, voting, registering, inserting media, and other protected writes. This prevents a request carrying an older authenticated member snapshot from recreating contributions or private media after account deletion or verification loss. Deletions, withdrawals, and moderation removals remain possible without current verification. Profile-preference writes independently lock and recheck the account before updates.

Votes have unique member/target constraints and desired-state updates. Comment parent relationships are constrained to the same post with a maximum depth of eight. RSVP changes lock the event row: one confirmed member consumes one seat, pending applications consume none, and an approved request for a full event only joins a waitlist when one is enabled. Withdrawal promotes eligible, approved waitlisted members in FIFO order. Registration closure and cancellation prevent new attendance and promotions.

The bootstrap payload is intentionally bounded for navigation and summaries. Individual post, member, and event endpoints perform independent authorized queries. Member contribution lists are bounded at 100; event discovery at 150; initial discussion comment loads at 200. Further branch pagination is an extension point.

## Stable discussion feeds

`GET /api/feed?sort=popular|new&scope=all|following&community=slug&city=slug` captures an ordered list of up to 500 authorized post IDs. It returns `{posts,nextCursor,asOf}`, with 25 posts per page. Pass the opaque cursor to retrieve the next page.

Popular means posts created within the 24 hours ending at `asOf`, ordered by net vote score descending, creation time descending, then stable ID descending. New orders by creation time and stable ID. Followers, business status, and advertising never change vote weight or ranking.

The database snapshot lasts 15 minutes. Its cursor is HMAC-signed and the snapshot is tied to the requesting member. Subsequent pages preserve the original order while rechecking current visibility, removals, and blocks, filling gaps from later snapshot IDs. New posts appear after an explicit feed refresh. Expired cursors return `FEED_EXPIRED` so the client can start a fresh snapshot.

## Private images

Uploads accept JPEG, PNG, or WebP files up to 4 MB and 40 million decoded pixels. The multipart request is capped at 4.4 MB to fit Vercel's function payload limit. Sharp checks the actual file signature and re-encodes images into WebP, strips source metadata, respects orientation, limits dimensions to 2400 pixels, and rejects output larger than 4 MB. Larger uploads require a future direct-to-private-storage ingestion flow. A media row belongs to its uploader and can be attached only once. Upload database failures trigger object cleanup.

In development without bucket configuration, files live in the ignored `.data/media` directory. For production, configure a private S3-compatible bucket with:

- `STORAGE_BUCKET`
- `STORAGE_REGION` (defaults to `us-east-1`)
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `STORAGE_ENDPOINT` for a custom S3-compatible provider; custom endpoints use path-style addressing and must use HTTPS in production.

The bucket must block public access. The service does not set a public ACL or expose public object URLs. Browser reads go through `/api/media/:id`, which checks the current session, parent post state, and viewer blocks before streaming the object. Unattached uploads are visible only to their owner. Production fails closed when private storage is absent. Live bucket permissions and compatibility require validation with the owner's credentials.

## Scheduled work

`GET /api/jobs` requires `Authorization: Bearer <CRON_SECRET>`. Schedule it every five minutes on a plan that supports that cadence. It generates deduplicated in-app reminders for confirmed native-event guests within 24 hours and one hour of the current event start, respecting cancellations, current registration, and preferences. It also checks batches of five recently active X accounts after 12 hours, using the same serialized eligibility-only resync service as contribution writes. Expired feed snapshots, local sessions, and rate-limit rows are cleaned up.

Email delivery is not connected. Notification bodies do not copy private venue information. Event announcements are readable only by the host and members currently going, waiting for approval, or waitlisted. Single-event calendar downloads apply the same venue ACL, escape and fold content according to iCalendar rules, and include the event revision. Downloaded files do not update automatically.

## Verification

`RUN_DB_TESTS=1 AUTH_MODE=development AUTO_MIGRATE=1 pnpm test` includes PostgreSQL integration tests. The suite covers contribution gates, concurrent votes, comment-parent constraints, concurrent last-seat RSVPs, approval when waitlisting is disabled, waitlist promotion, private venues, host updates, resource blocking, removed content, snapshot stability, and cursor ownership. `pnpm typecheck` validates route and client contracts.

The current implementation includes the core community and native-event loops, account export, other-session revocation, and account deletion. Account deletion clears sessions and X credentials, anonymizes the member, optionally removes authored content, cancels future hosted events, releases registrations, and removes private media. Failed physical media cleanup is recorded in the private audit log for retry; the database removes access before attempting storage deletion.

Advanced cohost roles, registration questions, event drafts, contact-email delivery, full comment-branch pagination, and advertising checkout/fulfillment still require separate implementation and validation. The checked-in master plan remains the full product specification.

## Private chat

The authenticated `/api/chat` routes handle participant-only inboxes, member search, paginated conversations, requests, acceptance, declines, blocks, sends, and read cursors. Requests stay separate from accepted-message unread counts and never create notifications. See [chat architecture and limits](CHAT.md).
