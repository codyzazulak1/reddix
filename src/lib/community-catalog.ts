import type { Community } from "./types";

/** Curated discussion topics, reviewed September 27, 2026. See docs/COMMUNITY_CATALOG.md. */
export const COMMUNITY_CATEGORIES = [
  {
    id: "ai",
    label: "AI & models",
  },
  {
    id: "building",
    label: "Building & tools",
  },
  {
    id: "startups",
    label: "Startups & capital",
  },
  {
    id: "frontier",
    label: "Frontier tech",
  },
  {
    id: "cities",
    label: "Cities & events",
  },
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]["id"];
export type CommunitySeed = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  city: string | null;
  category: CommunityCategory;
  aliases: readonly string[];
  featured?: boolean;
};

// Stable slugs preserve community URLs and memberships across catalog updates.
export const COMMUNITY_CATALOG: readonly CommunitySeed[] = [
  {
    slug: "sf",
    name: "San Francisco",
    description: "The people, places, and ideas shaping the Bay Area.",
    icon: "bridge",
    color: "#eee6df",
    city: "sf",
    category: "cities",
    aliases: ["SF", "Bay Area", "San Francisco"],
  },
  {
    slug: "y-combinator",
    name: "Y Combinator",
    description:
      "Founder lessons, batches, applications, and building something people want.",
    icon: "y",
    color: "#f4e5dc",
    city: null,
    category: "startups",
    aliases: ["YC", "accelerator", "startup school", "demo day"],
    featured: true,
  },
  {
    slug: "sf-restaurants",
    name: "SF Restaurants",
    description:
      "Good food, better company. Coffee spots, founder dinners, and local favorites.",
    icon: "utensils",
    color: "#e9ebdf",
    city: "sf",
    category: "cities",
    aliases: ["sf"],
  },
  {
    slug: "sf-tech-week",
    name: "SF Tech Week",
    description: "Find your people during the city's busiest week of building.",
    icon: "sparkles",
    color: "#e8e3f0",
    city: "sf",
    category: "cities",
    aliases: ["sf"],
  },
  {
    slug: "sf-events",
    name: "SF Events",
    description: "Demos, meetups, and meaningful conversations across the Bay.",
    icon: "calendar",
    color: "#e0e9ee",
    city: "sf",
    category: "cities",
    aliases: ["sf"],
  },
  {
    slug: "techcrunch-disrupt",
    name: "TechCrunch Disrupt",
    description:
      "Community discussion around Disrupt. Independently run, unaffiliated.",
    icon: "zap",
    color: "#e2ecdf",
    city: "sf",
    category: "cities",
    aliases: ["sf"],
  },
  {
    slug: "new-york",
    name: "New York",
    description: "Builders and big ideas in the city that never ships late.",
    icon: "building",
    color: "#e8e3dc",
    city: "new-york",
    category: "cities",
    aliases: ["new-york"],
  },
  {
    slug: "ny-events",
    name: "NY Events",
    description: "Meet the New York technology community.",
    icon: "calendar",
    color: "#e6e1e9",
    city: "new-york",
    category: "cities",
    aliases: ["new-york"],
  },
  {
    slug: "toronto",
    name: "Toronto",
    description:
      "A home for Toronto's founders, makers, and technology community.",
    icon: "maple",
    color: "#efdfdf",
    city: "toronto",
    category: "cities",
    aliases: ["toronto"],
  },
  {
    slug: "toronto-events",
    name: "Toronto Events",
    description: "Gatherings for curious people across Toronto.",
    icon: "calendar",
    color: "#e4e9df",
    city: "toronto",
    category: "cities",
    aliases: ["toronto"],
  },
  {
    slug: "seattle",
    name: "Seattle",
    description:
      "Software, coffee, and the Pacific Northwest technology scene.",
    icon: "mountain",
    color: "#dee9e4",
    city: "seattle",
    category: "cities",
    aliases: ["seattle"],
  },
  {
    slug: "seattle-events",
    name: "Seattle Events",
    description: "Connect with Seattle's builders and communities.",
    icon: "calendar",
    color: "#dfe5e9",
    city: "seattle",
    category: "cities",
    aliases: ["seattle"],
  },
  {
    slug: "los-angeles",
    name: "Los Angeles",
    description: "Where technology, creativity, and culture meet.",
    icon: "sun",
    color: "#f1e9dc",
    city: "los-angeles",
    category: "cities",
    aliases: ["los-angeles"],
  },
  {
    slug: "la-events",
    name: "LA Events",
    description: "Dinners, demos, and meetups around Los Angeles.",
    icon: "calendar",
    color: "#eae0e9",
    city: "los-angeles",
    category: "cities",
    aliases: ["los-angeles"],
  },
  {
    slug: "startups",
    name: "Startups",
    description:
      "The honest conversation about starting and growing a company.",
    icon: "rocket",
    color: "#e5e4ee",
    city: null,
    category: "startups",
    aliases: ["founders", "entrepreneurship"],
  },
  {
    slug: "ai",
    name: "Artificial Intelligence",
    description: "From research papers to things people actually use.",
    icon: "asterisk",
    color: "#e5e9e1",
    city: null,
    category: "ai",
    aliases: ["artificial intelligence", "machine learning", "LLMs"],
  },
  {
    slug: "engineering",
    name: "Engineering",
    description: "Craft, systems, infrastructure, and the details that matter.",
    icon: "terminal",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["software", "development", "infrastructure"],
  },
  {
    slug: "open-source",
    name: "Open Source",
    description:
      "Build in the open. Share projects, contribute, and learn together.",
    icon: "code",
    color: "#e7e7e7",
    city: null,
    category: "building",
    aliases: ["OSS", "open source"],
  },
  {
    slug: "fundraising",
    name: "Fundraising",
    description: "Practical conversations between founders and investors.",
    icon: "chart",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: ["venture capital", "VC", "seed round", "investors"],
  },
  {
    slug: "careers",
    name: "Careers",
    description: "Find your next chapter and help someone find theirs.",
    icon: "briefcase",
    color: "#e8e2dc",
    city: null,
    category: "building",
    aliases: ["jobs", "hiring", "recruiting"],
  },
  {
    slug: "a16z",
    name: "a16z",
    description:
      "Andreessen Horowitz, investment theses, portfolio companies, and the future founders are building.",
    icon: "chart",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: ["Andreessen Horowitz", "venture capital", "VC"],
    featured: true,
  },
  {
    slug: "speedrun",
    name: "Speedrun",
    description:
      "Applications, cohorts, demo days, and founder experiences with the a16z startup program.",
    icon: "zap",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: ["a16z speedrun", "accelerator", "SR", "alpha fellowship"],
    featured: true,
  },
  {
    slug: "tesla",
    name: "Tesla",
    description:
      "Electric vehicles, autonomy, Optimus, energy, and the engineering behind them.",
    icon: "zap",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["EV", "FSD", "Optimus", "Elon Musk", "robotaxi"],
    featured: true,
  },
  {
    slug: "openai",
    name: "OpenAI",
    description:
      "ChatGPT, frontier models, research, and what people are building with OpenAI.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["ChatGPT", "GPT", "Sam Altman", "Sora"],
    featured: true,
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    description:
      "Claude, model research, alignment, and building with Anthropic.",
    icon: "sparkles",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Claude", "Dario Amodei", "constitutional AI"],
    featured: true,
  },
  {
    slug: "google-deepmind",
    name: "Google DeepMind & Gemini",
    description:
      "Gemini, DeepMind research, multimodal models, and AI for science.",
    icon: "sparkles",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Google AI", "Gemini", "Demis Hassabis", "AlphaFold"],
  },
  {
    slug: "grok",
    name: "Grok",
    description: "Grok, the xAI ecosystem, model releases, and AI on X.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["xAI", "SpaceXAI", "Grok Build", "Grok Bot", "Elon Musk"],
  },
  {
    slug: "meta-ai",
    name: "Meta AI",
    description:
      "Models, research, consumer AI, and the open model ecosystem around Meta.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Llama", "Meta", "FAIR", "Mark Zuckerberg"],
  },
  {
    slug: "mistral",
    name: "Mistral AI",
    description:
      "Mistral models, Le Chat, European AI, and practical deployments.",
    icon: "sparkles",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Le Chat", "Mistral AI", "European AI"],
  },
  {
    slug: "deepseek",
    name: "DeepSeek",
    description:
      "Model research, efficient reasoning, releases, and hands-on experiments.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Deep Seek", "reasoning", "model efficiency"],
  },
  {
    slug: "hugging-face",
    name: "Hugging Face",
    description:
      "Models, datasets, Spaces, and the people building open AI together.",
    icon: "code",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["HuggingFace", "HF", "Transformers", "Spaces", "SmolVLA"],
  },
  {
    slug: "perplexity",
    name: "Perplexity",
    description:
      "AI search, research workflows, answers, and how we find information.",
    icon: "sparkles",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: ["Comet", "AI search", "answer engine"],
  },
  {
    slug: "cursor",
    name: "Cursor",
    description:
      "Coding agents, editor workflows, code review, and projects built with Cursor.",
    icon: "terminal",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Anysphere", "Composer", "AI coding", "IDE"],
  },
  {
    slug: "claude-code",
    name: "Claude Code",
    description:
      "Agent workflows, skills, terminal tooling, and lessons from building with Claude Code.",
    icon: "terminal",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Anthropic", "Claude", "coding agent", "skills"],
  },
  {
    slug: "codex",
    name: "Codex",
    description:
      "Building software with Codex: agents, workflows, reviews, and useful experiments.",
    icon: "terminal",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["OpenAI", "coding agent", "ChatGPT Codex", "Codex CLI"],
  },
  {
    slug: "replit",
    name: "Replit",
    description:
      "From an idea to a running app: Replit agents, projects, and the lessons along the way.",
    icon: "code",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Replit Agent", "vibe coding", "app builder"],
  },
  {
    slug: "lovable",
    name: "Lovable",
    description:
      "Products, prototypes, and real businesses built with Lovable.",
    icon: "sparkles",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["vibe coding", "app builder", "prototyping"],
  },
  {
    slug: "vercel",
    name: "Vercel",
    description: "Shipping web apps with Vercel, Next.js, v0, and the AI SDK.",
    icon: "code",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Next.js", "Nextjs", "v0", "AI SDK", "frontend"],
  },
  {
    slug: "supabase",
    name: "Supabase",
    description: "Postgres, auth, storage, realtime, and building on Supabase.",
    icon: "zap",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["PostgreSQL", "Postgres", "backend", "database"],
  },
  {
    slug: "github",
    name: "GitHub",
    description:
      "Repositories, Copilot, Actions, open collaboration, and how teams ship software.",
    icon: "code",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Copilot", "Git", "GitHub Actions", "developer tools"],
  },
  {
    slug: "figma",
    name: "Figma",
    description:
      "Product design, prototyping, design systems, and the handoff to working software.",
    icon: "sparkles",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["FigJam", "Figma Make", "design", "prototyping"],
  },
  {
    slug: "linear",
    name: "Linear",
    description:
      "Product planning, issues, team workflows, and building with Linear.",
    icon: "chart",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["issue tracking", "product management", "roadmap"],
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    description:
      "Workers, internet infrastructure, developer tooling, and securing what you ship.",
    icon: "sun",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: ["Workers", "R2", "edge", "infrastructure", "security"],
  },
  {
    slug: "nvidia",
    name: "NVIDIA",
    description:
      "GPUs, CUDA, inference, robotics, and the infrastructure behind AI.",
    icon: "terminal",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["GPU", "CUDA", "Jensen Huang", "compute", "Isaac", "physical AI"],
  },
  {
    slug: "amd",
    name: "AMD",
    description:
      "Accelerators, processors, ROCm, and the changing landscape of AI compute.",
    icon: "terminal",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["ROCm", "Instinct", "Ryzen", "Lisa Su", "GPU", "chips"],
  },
  {
    slug: "spacex",
    name: "SpaceX",
    description: "Launches, Starship, Starlink, and building beyond Earth.",
    icon: "rocket",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["Starship", "Starlink", "Falcon", "Elon Musk", "space"],
  },
  {
    slug: "waymo",
    name: "Waymo",
    description:
      "Autonomous driving, robotaxi experiences, deployment, and the road ahead.",
    icon: "building",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["self-driving", "autonomy", "robotaxi", "Alphabet"],
  },
  {
    slug: "figure",
    name: "Figure",
    description:
      "Humanoid robots, embodied intelligence, and moving from demos to deployment.",
    icon: "asterisk",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["Figure AI", "humanoids", "Helix", "Brett Adcock"],
  },
  {
    slug: "stripe",
    name: "Stripe",
    description:
      "Payments, billing, internet businesses, and the tools founders use to get paid.",
    icon: "chart",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: [
      "payments",
      "fintech",
      "Patrick Collison",
      "John Collison",
      "Atlas",
    ],
  },
  {
    slug: "sequoia",
    name: "Sequoia",
    description:
      "Founder stories, company building, investing, and the Sequoia ecosystem.",
    icon: "mountain",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: ["Sequoia Capital", "venture capital", "VC", "Arc"],
  },
  {
    slug: "build-in-public",
    name: "Build in Public",
    description:
      "Share what you shipped, what you learned, and what you are trying next.",
    icon: "rocket",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: [
      "indie hackers",
      "bootstrapping",
      "solo founders",
      "shipping",
      "side projects",
    ],
  },
  {
    slug: "ai-agents",
    name: "AI Agents",
    description:
      "Designing, deploying, and evaluating agents that do useful work.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: [
      "agentic AI",
      "automation",
      "tool use",
      "orchestration",
      "agent harnesses",
    ],
  },
  {
    slug: "open-models",
    name: "Open Models",
    description:
      "Open weights, local inference, fine-tuning, benchmarks, and model licenses.",
    icon: "code",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: [
      "open source AI",
      "open-source AI",
      "open weights",
      "local AI",
      "Ollama",
    ],
  },
  {
    slug: "mcp",
    name: "MCP",
    description:
      "Model Context Protocol servers, integrations, tooling, and interoperability for agents.",
    icon: "code",
    color: "#e0e5ed",
    city: null,
    category: "building",
    aliases: [
      "Model Context Protocol",
      "agent tools",
      "connectors",
      "interoperability",
    ],
  },
  {
    slug: "robotics",
    name: "Robotics",
    description:
      "Humanoids, embodied AI, hardware, and robots doing useful work in the real world.",
    icon: "terminal",
    color: "#e0e9ee",
    city: null,
    category: "frontier",
    aliases: ["physical AI", "embodied AI", "ROS", "humanoids"],
  },
  {
    slug: "ai-safety",
    name: "AI Safety",
    description:
      "Evaluations, alignment, security, and the responsibilities of deploying capable AI.",
    icon: "asterisk",
    color: "#e8e3f0",
    city: null,
    category: "ai",
    aliases: [
      "alignment",
      "evals",
      "interpretability",
      "AI policy",
      "red teaming",
    ],
  },
  {
    slug: "stablecoins",
    name: "Stablecoins",
    description:
      "Payment rails, infrastructure, adoption, and building with digital dollars.",
    icon: "chart",
    color: "#e8e6dd",
    city: null,
    category: "startups",
    aliases: [
      "crypto",
      "digital dollars",
      "USDC",
      "USDT",
      "agent payments",
      "fintech",
    ],
  },
];

const communitiesBySlug = new Map(
  COMMUNITY_CATALOG.map((community) => [community.slug, community]),
);

export function getCommunityMetadata(slug: string): CommunitySeed | undefined {
  return communitiesBySlug.get(slug);
}

export function communityMatchesSearch(
  community: Pick<Community, "slug" | "name" | "description">,
  query: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[-_]/g, " ");
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  const haystack = normalize(
    [
      community.name,
      community.slug,
      community.description,
      ...(getCommunityMetadata(community.slug)?.aliases ?? []),
    ].join(" "),
  );
  return tokens.every((token) => haystack.includes(token));
}
