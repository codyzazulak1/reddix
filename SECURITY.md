# Security

The application has automated authorization and concurrency coverage. These tests do not replace a production infrastructure audit or independent penetration test.

## Reporting

Report vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/codyzazulak1/reddix/security/advisories/new). Include affected versions or commits, reproduction steps, and the expected impact. Use test accounts and synthetic data when demonstrating an issue.

Do not publish keys, real member records, guest information, or exploit details in a public issue.

## Boundaries to preserve

- Every content request resolves an admitted member and applies resource authorization. Public HTML and metadata remain generic.
- OAuth callback success alone cannot enroll a member. Initial admission requires fresh authoritative X verification, including blue, business, or government verification, and completes transactionally.
- Only fresh authoritative blue/business X evidence grants contribution eligibility.
- Development authentication is unreachable in production. Production requires X and persistent database configuration.
- Private images use authenticated delivery. Buckets must block public access. Event venue details are disclosed only according to event permissions.
- Browser mutations enforce the configured origin. Auth and admin endpoints cannot modify X-backed presentation through generic user-update APIs.
- Sessions, provider tokens, codes, secrets, and whole upstream error responses must not enter public JSON or logs.

## Operations

Use separate production, preview, development, and test databases and OAuth apps. Use independent random secrets, restricted storage credentials, TLS database connections, and a managed secret store. Configure backups and test restore procedures before accepting real data. Apply migrations explicitly from a trusted environment.

Account deletion removes active profile data and credentials, cancels hosted events, withdraws registrations, and clears contributions when selected. Minimal security records and infrastructure backups need an operator-defined retention policy. Failed physical object cleanup is recorded for operational retry; access is removed before that cleanup begins.

Run tests and inspect dependency updates before deploying. Restrict production database and deployment access. Verify live X entitlement and revocation behavior with the actual developer app; successful mocked OAuth tests do not establish production provider behavior.
