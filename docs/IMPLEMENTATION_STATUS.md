# Implementation status

This document describes the features and integration requirements implemented in this repository.

## Validation scope

- Automated tests exercise domain rules, authentication, chat, privacy, storage, security, the community catalog, and moderation using local PostgreSQL and mocked external providers.
- Browser tests cover the login wall, persistent discussions and accounts, events, quiet chat requests, responsive navigation, independent column scrolling, Card/Compact feed behavior, community discovery, and moderation administration.
- Run the TypeScript checks, relevant automated/browser suites, formatting checks, and optimized Next.js build for each change. See the commands in the README. Test totals change as features are added; this document does not assert a completed current run.
- Local and mocked checks do not validate live X entitlements, real OpenRouter moderation accuracy, a real S3 bucket, or a deployed Vercel environment.

## Working with local persistent data

The app runs on Next.js/React with PostgreSQL. The local preview uses explicitly fictional accounts, discussions, and events. Creating posts, votes, comments, saved items, event registrations, host updates, and preferences changes real database state and survives page reloads.

| Area                | Current implementation                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login wall          | Generic signed-out shell; all community APIs, profiles, event details, guest data, calendar downloads, and private images require authorization                                                                                                      |
| Signup              | Open to verified X accounts (blue, business, or government), with fresh authoritative evidence checked on the server; no invitation codes                                                                                                            |
| Authentication      | Better Auth X OAuth 2.0 with PKCE, encrypted provider tokens, server sessions, raw endpoint allowlist, same-origin mutations                                                                                                                         |
| Verification        | Explicit blue/business evidence, 24-hour expiry, manual profile resync and scheduled/action-time eligibility checks; unknown/stale evidence cannot grant contributions                                                                               |
| Onboarding          | Synced identity, interests, private home city, consent, initial community follows                                                                                                                                                                    |
| Discussions         | Text/link/image posts, nested comments and collapse, body edits, deletion, voting, saves, sharing, reports, locks, Markdown rendering                                                                                                                |
| Feed                | Server-side 24-hour net-vote ranking; new/following/community/city filters; owner-bound stable snapshot pagination                                                                                                                                   |
| Chat                | Private persistent one-to-one text conversations, quiet requests, approval/decline/block, verified sends, paginated history, stable ordering, idempotent retries, unread badges, member search, and account privacy integration                      |
| Profiles            | X presentation, follower metrics, posts/comments/hosted-event views; no local identity-edit fields                                                                                                                                                   |
| Communities         | 57 curated communities, featured tech topics, category filters, alias-aware directory and global search, private follows, member suggestions and admin acceptance                                                                                    |
| Events              | Native and external listings, city/topic/date/source filtering, agenda/week/month views, unlisted/invited visibility, share links, approval, waitlists, capacity, withdrawals, cancellation, editing, guest review, announcements, and ICS           |
| Social event detail | Real Reddix attendance and interest only; no fabricated X mutuals or external-platform guest lists                                                                                                                                                   |
| Safety              | Reports, content removal, locks, server-side block checks, private media/venue ACLs, audit records, rate limits                                                                                                                                      |
| AI moderation       | Built-in `@reddix` identity, OpenRouter text classifier, durable versioned queue, narrow high-confidence automatic hiding, administrator review/restore, fixed public notices, private decision details, UTC request limits, and provider price caps |
| Account privacy     | Personal JSON export, other-session revocation, confirmed account/content deletion, registration withdrawal and event cancellation on deletion                                                                                                       |
| Appearance          | Responsive desktop/mobile, readable dark/light themes, blue actions, colored community banners, sidebar-edge collapse with persistence, independently scrolling right column, persistent Card/Compact views with expandable previews                 |
| Notifications       | In-app replies and event updates, scheduled in-app event reminders                                                                                                                                                                                   |
| Deployment          | Vercel configuration, explicit migrations, production environment checks, private Supabase and S3 adapters, cron routes, CI checks                                                                                                                   |

## X growth implementation

Separate bot OAuth with encrypted rotating tokens, post-title promotion, daily Pacific highlights, interaction-based session counts, and official X organization affiliate syncing are implemented. Admin controls cover delivery reconciliation and community/business mappings. Invitation collection, classification, codes, and DMs are retired. The composer discloses public promotion and members can opt out. Existing discussions are not retroactively queued. See [X growth setup and exact boundaries](X_GROWTH.md).

The bot defaults to off and requires a separate account and OAuth credentials. Validate official affiliate access and the campaign's X automation requirements before enabling live mode.

## Integration requirements

- **X:** Configure an OAuth application and validate its provider entitlements, available verification fields, business-account behavior, refresh/revocation responses, and deployed callbacks. Mocked provider tests exercise the installed OAuth implementation and the admission transaction.
- **Vercel:** Create a project and configure X credentials, managed PostgreSQL, a canonical HTTPS origin, and runtime secrets. See the [deployment instructions](../README.md#deploy-on-vercel).
- **Private storage:** Configure a private Supabase or S3-compatible bucket and restricted server credentials. Verify production permissions and provider compatibility against your storage service.
- **OpenRouter:** Configure a server-only API key, provider privacy settings, and spending limits. Without a key, contributions remain visible and checks queue for later. Evaluate moderation decisions before enabling automatic action. See [moderation operations](MODERATION.md) and [model selection](MODERATION_MODELS.md).

## Remaining product work

- Stripe advertiser checkout, webhooks, campaign inventory, approval, delivery, billing, and reporting. A labeled sponsored-placement component establishes a UI boundary; no paid ads are served and no payment success is simulated.
- Native-event cohosts, draft publishing, custom registration questions, verified contact email, transactional email delivery, and CSV guest exports. Paid tickets, recurring series, plus-ones, date polls, QR check-in, and SMS are also unimplemented.
- External event metadata ingestion and authorized guest-list integrations. Current external events are manually described listings that link to the source for registration.
- Full comment-branch pagination, large-directory pagination, dedicated saved-history pagination, search-result facets, and high-volume ranking/search infrastructure. Current bootstrap posts and comments are bounded at 200, member activity at 100, event discovery at 150, and feed snapshots at 500.
- A member-facing block-management/unblock screen (chat already supports blocking), account suspension/reinstatement UI, and broader per-community moderator roles. Existing ownership, reporting, removed-content, and block enforcement is server-side.
- Moderation quality evaluation, an author appeal workflow, administrator queue pagination, and image/video inspection. The bot currently checks post/comment text, routes images and uncertain cases to administrators, and never moderates DMs or automatically bans members.
- Chat attachments, group conversations, typing indicators, push delivery, and inbox-list pagination beyond the current 200-item caps. Message history already has older-message pagination; delivery uses visible-tab HTTP polling.
- Large image direct upload and processing. Initial uploads are limited to 4 MB to work through Vercel's authenticated request path.
- Production observability integration, provider cost alerts, automated physical-media cleanup retries, documented operator-specific retention periods, backup restoration drills, and a full load/security review with actual infrastructure.
- Operator-specific contact details and reviewed service policies. The visible policy pages are labeled development drafts and must be reviewed for each deployment.

The core community and event loops can be developed and demonstrated without X credentials. Real-member launch requires the provider/deployment checks above. The app never substitutes development identities for failed production authentication.
