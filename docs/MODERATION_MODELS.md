# @reddix model selection

Researched September 27, 2026 (Pacific time). Public model and endpoint APIs were queried without an API key. No live inference or moderation-quality evaluation has been run.

## Default and alternatives

The adapter defaults to the explicit model ID `mistralai/mistral-nemo`. It is the lowest estimated paid option among currently listed structured-output models for a short classification workload with roughly ten input tokens per output token. That is a cost-based starting point, not a claim that it is the best moderator. Model quality, especially false positives on satire, quoted abuse, security research, and sharp criticism, still needs evaluation on representative Reddix examples.

Prices below are USD per million tokens from the [live OpenRouter model catalog](https://openrouter.ai/api/v1/models). They are catalog minimums, not guaranteed prices after applying privacy and capability filters.

| Explicit model ID                 |  Input | Output | Role                                                   |
| --------------------------------- | -----: | -----: | ------------------------------------------------------ |
| `mistralai/mistral-nemo`          | $0.019 | $0.030 | Default low-cost text classifier                       |
| `openai/gpt-oss-20b`              | $0.018 | $0.090 | Low-cost alternative to evaluate                       |
| `deepseek/deepseek-v4-flash-0731` | $0.021 | $0.320 | More expensive output; needs a higher output price cap |

All three advertised `structured_outputs` and `response_format` in the fetched catalog. For Nemo, the public [ZDR endpoint list](https://openrouter.ai/api/v1/endpoints/zdr) and [model endpoints](https://openrouter.ai/api/v1/models/mistralai/mistral-nemo/endpoints) also showed structured-output providers including DekaLLM at $0.018/$0.030, DeepInfra at $0.019/$0.030, and Parasail at $0.030/$0.030. Model and endpoint snapshots can differ slightly. Eligibility and actual billing remain the provider's runtime decision.

At the catalog Nemo rate, a review using 1,000 input and 80 output tokens is approximately $0.0000214, or $0.214 for 10,000 reviews. This is illustrative arithmetic, not a quote: context length, provider selection, retries, reasoning tokens for alternative models, and billing fees can change the total. The adapter records returned usage and actual `usage.cost`; an absent cost remains unknown, not zero. See [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

## Controls built into the adapter

The server sends a strict JSON Schema and independently validates the result with Zod. It requests `provider.require_parameters: true`, `sort: "price"`, `data_collection: "deny"`, and `zdr: true`. Provider token prices are capped by default at $0.10 input and $0.30 output per million tokens, with no per-request fee. OpenRouter's `max_price` values use dollars per million for tokens, unlike the per-token values returned by the model catalog. These controls are documented in [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

The model has no tools, database credentials, or moderation permissions, and the adapter does not add account metadata to its prompt. Titles, bodies, community rules, and nearby conversation are supplied as untrusted data in one user message. The adapter never fetches post URLs or image URLs. Inputs are bounded to 20,000 body characters, 400 title characters, 2,000 rule characters, and two context items of 2,000 characters each. Any truncation requires admin review. Images also require admin review because this first adapter inspects text only. Privacy concerns, uncertain cases, and topic-fit decisions cannot become automatic removals through this adapter.

The response is limited to 256 generated tokens and 64 KB of response bytes, with a 20-second timeout. Invalid JSON, unexpected keys, contradictory verdicts, refusals, tool calls, incomplete output, and provider errors never produce a fabricated successful decision. Errors contain no raw content, provider error bodies, or API credentials. The application worker, not this classifier, decides whether a valid result may affect the current content version.

## Configuration when the key is ready

These are server-only environment variables. Never prefix them with `NEXT_PUBLIC_` or commit a real key.

```dotenv
OPENROUTER_API_KEY=
REDDIX_MODERATION_MODE=auto
REDDIX_MODERATION_MODEL=mistralai/mistral-nemo
REDDIX_MODERATION_DAILY_LIMIT=500
REDDIX_MODERATION_MAX_INPUT_USD_PER_MILLION=0.10
REDDIX_MODERATION_MAX_OUTPUT_USD_PER_MILLION=0.30
```

Without a key, configuration reports `configured: false` and no external inference occurs. `off` disables inference. `review` is available to evaluate recommendations before enabling automatic actions. The worker enforces the daily request limit. Token price caps are not an account-level dollar budget; also set a spending limit on the dedicated OpenRouter key. Model IDs can be changed explicitly, including a `:free` endpoint if available, but general routers, presets, online variants, and batch variants are rejected.

Free endpoints are optional, not a silent fallback. They still need to satisfy the same schema, privacy, and price constraints and may have no eligible provider. If no endpoint meets the configured requirements, the request fails and administrators retain review control; the code does not silently loosen privacy or spend caps.

Use a dedicated OpenRouter key/account with input/output logging disabled, training disabled, and no forced plugins. The request explicitly disables the web-search plugin. OpenRouter account settings can force a plugin with “Prevent overrides,” which request-level settings cannot undo. Do not enable that setting for this key. Zero data retention applies to inference routing, not separately enabled tools or plugins. See [plugin precedence](https://openrouter.ai/docs/guides/features/plugins) and [ZDR controls](https://openrouter.ai/docs/guides/features/zdr).
