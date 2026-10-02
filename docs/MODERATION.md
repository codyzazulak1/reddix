# Operating @reddix

`@reddix` is Reddix's built-in moderation identity. It reviews community posts and comments through OpenRouter and records recommendations in a persistent administrator queue. It does not impersonate an X member, hold an X verification badge, ban users, send private chat messages, or scan DMs. This release does not provide a conversational chatbot or special command handler for mentions of `@reddix`.

There is no OpenRouter key configured yet. New and edited posts/comments, plus reports on those contributions, create queued work. Content stays visible while waiting. The admin panel says “Waiting for an OpenRouter key,” and no fake AI verdicts or simulated provider calls are used. Human report review remains available. Existing content is not bulk-scanned automatically; creation, editing, or reporting supplies the queue triggers.

## Enable checks

1. Apply the schema with `pnpm db:setup`. Migration `003_moderation.sql` creates the system identity, queue, decisions, daily usage records, and moderation references.
2. Add `OPENROUTER_API_KEY` to the server environment. Use `.env.local` locally or the deployment's environment settings. Never use a `NEXT_PUBLIC_` prefix, commit the key, or put it into a browser request.
3. Set the mode and limits below, then restart or redeploy the application so the new environment is loaded.
4. Open **Admin**, find **@reddix moderation**, and refresh its status. Use **Run queued checks** to process a small batch. Existing queued content is eligible when checks are enabled.
5. Confirm that authenticated scheduled work is running. The existing `/api/jobs` endpoint requires `Authorization: Bearer <CRON_SECRET>`; it handles both other scheduled application tasks and moderation recovery.

| Variable                                       | Default                  | Meaning                                                                                                                    |
| ---------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                           | Empty                    | No inference without a nonempty key                                                                                        |
| `REDDIX_MODERATION_MODE`                       | `auto`                   | `off` pauses inference; `review` records recommendations without automatic hiding; `auto` permits the narrow actions below |
| `REDDIX_MODERATION_MODEL`                      | `mistralai/mistral-nemo` | Explicit text model ID, optionally an available `:free` endpoint                                                           |
| `REDDIX_MODERATION_DAILY_LIMIT`                | `500`                    | Maximum request reservations per UTC day; `0` prevents processing                                                          |
| `REDDIX_MODERATION_MAX_INPUT_USD_PER_MILLION`  | `0.10`                   | Highest acceptable provider input-token price                                                                              |
| `REDDIX_MODERATION_MAX_OUTPUT_USD_PER_MILLION` | `0.30`                   | Highest acceptable provider output-token price                                                                             |

The low-cost default was selected using current public pricing and capability metadata, not an accuracy benchmark. No live inference or representative moderation evaluation has been performed. Use `review` while evaluating real examples and false positives, then explicitly choose whether to enable `auto`. The full model comparison, costs, and official documentation links are in [model research](MODERATION_MODELS.md).

Use a dedicated OpenRouter key with its own spending limit. Disable input/output logging and training, and do not force plugins on this key. Requests require zero-data-retention providers, deny provider data collection, and explicitly disable web search. OpenRouter's account-level “Prevent overrides” setting can force a plugin despite request-level settings, so the account must be configured accordingly. ZDR applies to inference routing, not independently enabled tools or plugins. See [OpenRouter plugin precedence](https://openrouter.ai/docs/guides/features/plugins) and [ZDR controls](https://openrouter.ai/docs/guides/features/zdr).

## Decisions and human review

The classifier returns a category, verdict, confidence, and short explanation. The application owns all enforcement:

| Result                                                                                               | Application behavior                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `allow`, category `none`, confidence at least `0.85`                                                 | Records the completed check; content remains visible                          |
| `remove`, confidence at least `0.98`, category `spam`, `scam`, `threats`, or `hate`, and mode `auto` | Hides the current contribution, records the decision, and notifies its author |
| Other valid results                                                                                  | Sends the decision to administrators; content remains visible                 |
| Image attached, input truncated, privacy issue, uncertain topic fit, or category `other`             | Requires administrator review                                                 |
| Missing key, mode `off`, provider failure, or exhausted daily allowance                              | Performs no automatic removal                                                 |

Confidence is the model's own estimate, not a calibrated probability or a guarantee of correctness. Criticism, disagreement, profanity, ordinary product announcements, and controversial viewpoints are not themselves grounds for removal. The code never delegates account permissions, suspensions, or bans to the model.

In **Review and removal history**, inspect the contribution, category, model, and explanation. **Dismiss flag** leaves published content visible. **Remove content** applies an administrator decision. **Restore content** reverses a removal associated with that decision. Each review requires an administrator note. Decision details are available in this administrator workspace and in the affected author's private account export, never in another member's export. The server requires administrator access, recent authentication, same-origin writes, and rate limits. It rechecks authorization inside the review transaction.

Restoring a contribution does not create a new authored contribution or require the author's X verification to remain current, but the author must still be active and admitted. Changed or deleted content cannot be restored through a stale decision. Manual decisions override in-flight model results and future retries on the same version.

Public notices and author notifications are fixed application-owned messages, such as a notice that content was hidden for suspected spam and can be reviewed by an administrator. Raw model explanations, confidence, and administrator notes are not published in the discussion or copied into author notifications. Model-generated text remains untrusted even in the admin panel.

## Queue, failures, and cost accounting

Contribution writes and queue inserts share a database transaction. A queue item identifies one target and content hash, so duplicate triggers reuse the same job. Edits supersede pending checks of older versions. The worker reloads and locks content before applying a result, checks author and content status, and verifies that the version, conversation context, and community rules are still applicable. Changed context is requeued; changed or unavailable content is skipped. A human override wins over a returning model response.

Next.js `after()` schedules a one-item batch after relevant write responses. The authenticated cron processes a two-item recovery batch, and **Run queued checks** processes up to three. Database leases and `SKIP LOCKED` claims allow concurrent workers without intentionally processing the same active lease. Leases expire after two minutes. Failed calls become retryable after five minutes, with at most three attempts. Exhausted jobs remain visible as failures for administrator follow-up; content is not hidden because a provider is down.

The daily counter uses UTC, with transactional reservations before a worker starts. Retries consume reservations. Jobs later skipped because of a stale version or unavailable content also consume reservations, even when no provider call ultimately occurs. Usage from an in-flight response is counted even when its moderation decision can no longer apply. These conservative counters limit worker activity, not exact billable requests.

The adapter caps generated output at 256 tokens, bounds input text, and times out after 20 seconds. It routes to the cheapest eligible provider for the selected model within the configured per-token prices and disallows per-request fees. It does not silently relax privacy or price requirements when no provider qualifies.

The displayed daily cost is the sum of costs reported in successfully received provider usage. A missing cost remains unknown in an individual decision and contributes nothing to this subtotal. Failed or timed-out calls may have incurred charges that were never reported back. Therefore the request limit, token caps, and displayed subtotal are not an absolute billing cap or a substitute for the provider's billing dashboard and key spending limit.

The queue history currently returns up to 100 non-allow decisions and 20 recent failed jobs. Aggregate counts cover the database. Provider failure messages are fixed diagnostics; raw response bodies and API credentials are not persisted as error messages.

## Scope and validation

The adapter inspects text only. It may send post titles, bodies, link URL text, community rules, and bounded parent/post context to the chosen OpenRouter provider. It never fetches linked pages or image assets, and image content needs an administrator to inspect it. Private messages and native event descriptions are outside this moderation pipeline; existing reports and other permission checks continue to apply.

Account deletion erases that member's moderation jobs and decisions, including model explanations and administrator notes, whether or not they choose to retain their public contributions. An in-flight response cannot recreate those records. General audit events keep decision identifiers rather than copies of free-text review notes; aggregate daily usage remains for operational accounting.

Provider tests use mocked HTTP responses to exercise missing credentials, private routing, strict JSON validation, prompt/data separation, limits, and error handling. Worker tests use a local test database and injected classifiers to exercise durable state, version checks, enforcement thresholds, and human overrides. Browser tests inspect the no-key state, admin controls, bot identity, and private/public visibility boundaries. These checks establish application behavior, not a moderation-quality score. Re-evaluate examples, pricing, endpoint availability, and operator policies before changing the model or enabling live automatic enforcement.
