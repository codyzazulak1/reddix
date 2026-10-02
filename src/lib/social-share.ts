import type { Metadata } from "next";

export type CommunityShareData = {
  slug: string;
  name: string;
  description: string;
};

export const SOCIAL_CANVAS_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_IMAGE_SIZE = { width: 2400, height: 1260 } as const;

const SITE_TITLE = "Reddix | The tech community for people on X";
const SITE_DESCRIPTION =
  "An independent tech community for people on X. Sign in with your X account to discover conversations, communities, and events. Reddix is not affiliated with X Corp.";

/** Canonical deployment origin, independent of untrusted request host headers. */
export function getSiteUrl(): URL {
  const candidates = [
    process.env.APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:")
        return new URL(url.origin);
    } catch {
      // An invalid optional URL must not break every page's metadata.
    }
  }

  return new URL("http://127.0.0.1:3000");
}

export function getSocialMetadata(community?: CommunityShareData): Metadata {
  const metadataBase = getSiteUrl();
  const title = community ? `${community.name} | Reddix` : SITE_TITLE;
  const description = community?.description || SITE_DESCRIPTION;
  const imageUrl = new URL("/og/image", metadataBase).href;
  const pageUrl = new URL(
    community ? `/s/${community.slug}` : "/",
    metadataBase,
  ).href;
  const alt = "Reddix, the tech community for people on X";

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "Reddix",
      title,
      description,
      url: pageUrl,
      images: [{ url: imageUrl, ...SOCIAL_IMAGE_SIZE, type: "image/png", alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: imageUrl, alt }],
    },
  };
}
