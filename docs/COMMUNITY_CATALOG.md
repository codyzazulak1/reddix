# Community catalog

Reviewed September 27, 2026. Reddix ships with 57 curated communities: the original 20 plus 37 additions covering the companies, tools, and themes central to tech discussion. This is an editorial selection informed by current primary sources, not a ranking of X post volume or a live trending feed.

## Topic coverage

- **AI & models:** Artificial Intelligence, OpenAI, Anthropic, Google DeepMind & Gemini, Grok, Meta AI, Mistral AI, DeepSeek, Hugging Face, Perplexity, AI Agents, Open Models, and AI Safety.
- **Building & tools:** Engineering, Open Source, Careers, Cursor, Claude Code, Codex, Replit, Lovable, Vercel, Supabase, GitHub, Figma, Linear, Cloudflare, and MCP.
- **Startups & capital:** Y Combinator, a16z, Speedrun, Startups, Fundraising, Stripe, Sequoia, Build in Public, and Stablecoins.
- **Frontier tech:** Tesla, NVIDIA, AMD, SpaceX, Waymo, Figure, and Robotics.
- **Cities & events:** San Francisco, SF Restaurants, SF Tech Week, SF Events, TechCrunch Disrupt, New York, NY Events, Toronto, Toronto Events, Seattle, Seattle Events, Los Angeles, and LA Events.

The six requested topics are featured in discovery: a16z, Speedrun, Y Combinator, Tesla, OpenAI, and Anthropic. Featured status is editorial placement, with no effect on post ranking. Names are stable across model releases. Grok remains searchable by xAI and SpaceXAI; Y Combinator by YC; a16z by Andreessen Horowitz; Vercel by Next.js and v0.

These are independent Reddix discussion communities. Creating a company topic does not create an official company account, import X content, or imply an affiliation. Member totals come from actual memberships. No synthetic discussions or memberships are added by this catalog update.

## Research basis

The following primary sources were checked to identify active, durable areas of discussion rather than create a separate community for every announcement:

- [a16z Speedrun](https://a16z.com/speedrun/) and [Speedrun Demo Day](https://speedrun.a16z.com/demo-day): founder programs, applications, and company building.
- [Y Combinator's QM](https://qm.ycombinator.com/): the intersection of founders, coding agents, and open tools.
- [OpenAI's Agents API announcement](https://openai.com/index/introducing-the-agents-api/) and [Anthropic's newsroom](https://www.anthropic.com/news): frontier models, agents, evaluations, and deployment.
- [Google DeepMind's blog](https://deepmind.google/blog/) and [Grok's newsroom](https://x.ai/news): model research, multimodal systems, and AI products.
- [Cursor's blog](https://cursor.com/blog) and [Vercel's blog](https://vercel.com/blog): coding agents, software workflows, and web development.
- [Hugging Face's blog](https://huggingface.co/blog): open models, datasets, evaluation, and robotics.
- [NVIDIA's robotics coverage](https://blogs.nvidia.com/blog/category/robotics/): physical AI, robot development, and compute.
- [Stripe Sessions 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026): internet businesses, payments, and stablecoin infrastructure.

## Updating the catalog

`src/lib/community-catalog.ts` is the shared catalog for database seeds, discovery categories, featured ordering, and search aliases. The underlying community records remain in PostgreSQL. Descriptions and names shown to members come from those records, so administrator changes take precedence over seed defaults.

Add a new entry with a permanent slug, name, concise description, existing icon key, color, city or `null`, category, and relevant search aliases. Then run:

```sh
pnpm db:setup
```

Setup inserts missing communities with `ON CONFLICT DO NOTHING`. Repeating setup preserves IDs, existing memberships, administrator edits, rules, and archived status. The original `y-combinator` slug is reused. This update requires no new database schema migration.

Production uses the same catalog through the explicit setup command. Production requests do not seed data. Existing installations must run setup as part of their deployment to receive new catalog entries. Development-only fictional data remains separately gated by authentication mode and its one-time seed marker.

The directory excludes archived communities, supports category filters and shared alias-aware search, and shows uncataloged administrator-created topics under Other. Joining a topic uses the existing persistent follow action. Community topics are also available to post and event composers through the authenticated bootstrap data.
