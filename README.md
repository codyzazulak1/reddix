# Reddix

Source code for Reddix, a tech community with familiar discussions, X-backed profiles, and a calendar that brings people together. Built with Next.js, React, TypeScript, PostgreSQL, and Better Auth, with Vercel as the primary deployment target.

All community content requires admission and sign-in. Posting, commenting, voting, chat messages, and event participation require fresh blue or business verification from X. Signup is open to anyone with a verified X account, including blue, business, or government verification. Authentication, admission, and contribution eligibility are enforced independently on the server.

## Run locally

Use Node 24, pnpm 11, and PostgreSQL 14 or newer. Node 22 is also supported. The local setup script uses PostgreSQL's `initdb`, `pg_ctl`, and `createdb` executables on your PATH.

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

Open **http://127.0.0.1:3000**. Use the clearly labeled local preview buttons for a verified member or a browse-only member. These are fictional accounts backed by a real local database. Their writes persist. They do not log in to X or publish anything there.

`pnpm setup` creates `.env.local` with independent random development secrets if the file does not exist, starts an isolated PostgreSQL cluster on `127.0.0.1:55432`, and applies the schema. It never overwrites an existing environment file. PostgreSQL data lives in ignored `.local/postgres`; images live in ignored `.data/media`. Stop the database with `pnpm db:stop`.

If PostgreSQL is not installed locally, use Docker instead:

```sh
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
docker compose up -d
# Set DATABASE_URL in .env.local to the password-bearing URL in .env.example.
pnpm db:setup
pnpm dev
```

Do not run both database options on the same port. The local trust-authenticated cluster is intentionally bound to loopback and is not a production database.

## What is implemented

- X-first landing page, verified-X signup without invitation codes, returning-member admission, X OAuth 2.0 with PKCE, separate admission transactions, and three-step onboarding.
- X-sourced presentation, follower counts, read-only profile fields, manual resync, expiration-aware verification, and blue/business contribution policies.
- Text, link, and private-image posts; nested comments; voting; editing and deletion; saves; community follows; suggestions; search; and reports.
- Automatic Open Graph images for new link posts and the first link in text posts, shown as Card banners and Compact thumbnails. Previews use private image storage; unavailable images never prevent posting.
- A deterministic, paginated 24-hour popular feed, plus new and followed-community feeds. Vote weight does not depend on followers, business status, or advertising.
- 57 curated tech and city communities, including a16z, Speedrun, Y Combinator, Tesla, OpenAI, Anthropic, coding tools, AI agents, robotics, and local tech scenes. Discover them with category filters and alias-aware search. See the [community catalog](docs/COMMUNITY_CATALOG.md).
- Native and external events, agenda/week/month views, city and topic filters, share links, RSVP approval, capacity, waitlists, private venues, guest management, host updates, and calendar downloads.
- Private one-to-one chat with a quiet message-request inbox, recipient approval, decline/block controls, persistent history, and accepted-message unread counts. See [chat details](docs/CHAT.md).
- In-app notifications, event reminders, report review, post locking, and approval of suggested communities.
- The built-in `@reddix` moderator, with an OpenRouter adapter, persistent review queue, narrow automatic hiding, admin overrides, and usage controls. It waits for an API key without making AI decisions or hiding unchecked content. See [moderation operations](docs/MODERATION.md) and [model research](docs/MODERATION_MODELS.md).
- X growth bot with post promotion, Pacific daily highlights, and official organization affiliate badges. Disabled until its separate account and OAuth credentials are configured. See [X growth setup](docs/X_GROWTH.md).
- Profile and chat export, other-session revocation, account deletion, dark/light/system themes, feed density, persistent sidebar collapse, and notification preferences.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for implemented features, integration requirements, and remaining product work.

## Verify changes

```sh
pnpm typecheck
RUN_DB_TESTS=1 pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Database tests use PostgreSQL and create isolated test records. Run them against a local test database, never a real member database. Browser tests use the local development preview at `127.0.0.1:3000`. Playwright starts the development server if one is not already running. CI provisions a fresh PostgreSQL service.

The OAuth integration suite runs the installed Better Auth handler with mocked X responses. It tests the real callback/admission implementation without requiring provider keys. It is not a substitute for live X validation.

Moderation tests also use mocked provider responses. They verify routing safeguards, response validation, queue behavior, and permission boundaries; they do not establish real-model moderation accuracy. No OpenRouter key is needed to develop the queue or admin interface.

## Deploy on Vercel

1. Create a Supabase project for production PostgreSQL and a private Supabase Storage bucket. Set `STORAGE_PROVIDER=supabase`, the project `SUPABASE_URL`, its server-only `SUPABASE_SECRET_KEY`, and `STORAGE_BUCKET`. Keep public bucket access disabled. The native Storage adapter checks bucket privacy before uploads and proxies authenticated reads through Reddix; no public image URLs, signed URLs, or S3 credentials are needed. See [Supabase API keys](https://supabase.com/docs/guides/api/api-keys) and [Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals). Use a pooled database connection supported by your provider, with TLS. Reddix uses two small pools for its domain and auth adapters.
2. Create a Vercel project for this source directory using the Next.js preset, Node 24, `pnpm install --frozen-lockfile`, and `pnpm build`. Keep the function region near your database. `vercel.json` defaults to Montréal (`yul1`); update it to match your database location. See [Vercel region guidance](https://vercel.com/docs/functions/configuring-functions/region).
3. Add the environment values below to the production environment. Keep preview deployments on a separate database and X app/callback configuration.
4. With the production secrets loaded in a trusted terminal, run `NODE_ENV=production AUTH_MODE=x pnpm db:setup`. Production requests validate the schema but never execute migrations or add fictional content.
5. Register the exact callback `https://YOUR_HOST/api/auth/callback/twitter` in the X developer portal. The OAuth provider identifier remains `twitter`.
6. Set `ADMIN_X_IDS` to the first administrator's immutable X ID before first enrollment. They sign up with their verified X account; no invitation is required.
7. Deploy, then test the actual X callback, token refresh, badge fields, verified-account admission, private storage, and scheduled job against real provider credentials before admitting the community.

| Variable                                             | Production value                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `AUTH_MODE`                                          | `x`                                                                                     |
| `APP_URL`, `BETTER_AUTH_URL`                         | Identical canonical HTTPS origin                                                        |
| `DATABASE_URL`                                       | Production PostgreSQL connection                                                        |
| `BETTER_AUTH_SECRET`                                 | Independent random secret, at least 32 characters                                       |
| `CRON_SECRET`                                        | Independent random bearer secret for scheduled work                                     |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`                     | X OAuth 2.0 credentials                                                                 |
| `ADMIN_X_IDS`                                        | Comma-separated immutable X IDs, applied only at first enrollment                       |
| `AUTO_MIGRATE`                                       | `0` in production                                                                       |
| `STORAGE_PROVIDER`                                   | `supabase` for native Supabase Storage; `s3` for other S3-compatible storage            |
| `STORAGE_BUCKET`                                     | Private bucket name                                                                     |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                | Supabase project HTTPS origin and server-only `sb_secret_` key; never browser variables |
| `STORAGE_REGION`                                     | S3 only: bucket region, such as `us-east-1`                                             |
| `STORAGE_ENDPOINT`                                   | S3 only: HTTPS endpoint for a non-AWS S3-compatible provider; blank for AWS             |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | S3 only: restricted credentials for that bucket                                         |
| `OPENROUTER_API_KEY`                                 | Optional dedicated server-only key for `@reddix`; blank leaves checks queued            |
| `REDDIX_MODERATION_MODE`                             | `auto`, `review`, or `off`; defaults to `auto` but requires a key                       |
| `REDDIX_MODERATION_MODEL`                            | Explicit model ID; defaults to `mistralai/mistral-nemo`                                 |
| `REDDIX_MODERATION_DAILY_LIMIT`                      | UTC-day request reservation limit; defaults to `500`                                    |
| `REDDIX_MODERATION_MAX_INPUT_USD_PER_MILLION`        | Maximum provider input price; defaults to `0.10`                                        |
| `REDDIX_MODERATION_MAX_OUTPUT_USD_PER_MILLION`       | Maximum provider output price; defaults to `0.30`                                       |

Production refuses development authentication. Missing X configuration does not turn on demo accounts. Missing private storage disables uploads instead of publishing images publicly.

The configured cron runs every five minutes and requires a Vercel plan that supports that frequency. A Hobby deployment needs a supported external scheduler or an adjusted cron configuration; daily execution is insufficient for timely event reminders. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). The job requires `Authorization: Bearer <CRON_SECRET>` and generates in-app reminders, refreshes eligibility, and recovers queued moderation work. New contributions also schedule a small moderation batch after the response using Next.js `after()`.

Before adding the OpenRouter key, configure its account privacy and plugin settings and a provider-side spending limit. Evaluate moderation decisions in `review` mode on representative discussions. The request and token-price limits are not an absolute billing cap, and model accuracy has not been evaluated. See the [activation and review procedure](docs/MODERATION.md).

Uploads are capped at 4 MB because the authenticated image pipeline passes through a Vercel Function. This leaves room under Vercel's 4.5 MB request limit. Larger uploads would need a private upload/quarantine/processing pipeline. See [Vercel payload limits](https://vercel.com/docs/errors/function_payload_too_large).

For self-hosting, run the same migrations, `pnpm build`, then `pnpm start` behind an HTTPS reverse proxy. The start command binds loopback by default. Configure an external scheduler to call `/api/jobs`, provide private storage, and maintain database backups.

## Source map

```text
src/app/                  Next.js shell, authenticated API routes, shared styles
src/components/           Discussions, profiles, onboarding, account controls
src/components/events/    Event discovery, creation, detail, and host controls
src/components/chat/      Private inbox, requests, conversations, member search
src/lib/auth-*.ts          X, OAuth, verified-account admission, sessions, profile sync
src/lib/account-service.ts Privacy export, sessions, deletion
src/server/               PostgreSQL services, permissions, feeds, storage
db/                       Versioned domain schema
scripts/                  Local setup and schema setup
tests/                    Domain, auth, security, storage, account, browser tests
docs/                     Implementation status and operational details
```

See [identity documentation](docs/AUTH.md), [backend documentation](docs/BACKEND.md), [contribution guidance](CONTRIBUTING.md), and [security guidance](SECURITY.md).

## License

Reddix source code is available under the [MIT License](LICENSE).

Bundled Geist fonts retain their [SIL Open Font License](src/assets/fonts/LICENSE.txt). Third-party community logos retain their respective rights and notices; see the source records for [AI communities](docs/community-assets-ai.md), [developer tools](docs/community-assets-tools.md), and [startup and frontier communities](docs/community-assets-frontier.md). The code license does not grant rights to third-party trademarks.

Keep credentials, member records, media, backups, and operational logs outside the repository. Use `.env.example` for the configuration template and keep actual values in ignored environment files or your deployment's secret store.
