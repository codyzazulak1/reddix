# Contributing to Reddix

Start with the [README](README.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md). Reddix source code is available under the [MIT License](LICENSE).

Use Node 24 and the pnpm version pinned in `package.json`. Keep application state in PostgreSQL and use the shared domain services for authorization. A hidden button is never the only permission check.

Core invariants:

- Use immutable X IDs for identity. Only initial signup and explicit resync change presentation fields.
- Keep authentication, verified-account admission, verification freshness, ownership, and resource visibility separate.
- Require login for all community data, including media, exports, previews, and event links.
- Never derive eligibility from follower counts, client-supplied badge values, payment state, or an OAuth success alone.
- Preserve unverified members' access to their own privacy and safety controls.
- Preserve transactional admission, voting, and RSVP invariants. Add regression tests for permission or concurrency changes.
- Do not commit keys, personal data, `.env` files, database exports, or local uploads.
- Keep fictional development fixtures out of production and label them clearly in previews.
- Describe current behavior honestly. Do not show fake payment, signup, sync, or RSVP success.

Run `pnpm typecheck`, `RUN_DB_TESTS=1 pnpm test`, `pnpm test:e2e`, and `pnpm build` as appropriate before submitting changes. Format source with `pnpm format`; `pnpm format:check` checks formatting. Test only against disposable/local databases.

PR descriptions should explain the member-visible change, relevant authorization or data-model decisions, and validation. Update implementation status when adding or completing an integration.

Preserve bundled font licenses and third-party asset notices. Document the source and usage rights when adding an asset.

Use [GitHub issues](https://github.com/codyzazulak1/reddix/issues) for reproducible bugs and feature proposals. Follow the [security reporting instructions](SECURITY.md) for vulnerabilities.

Treat people respectfully, disclose affiliations in recommendations, and keep feedback focused on the work. No harassment, spam, impersonation, or publication of another person's private information.
