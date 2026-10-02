import type { Metadata } from "next";
import { getSocialMetadata } from "@/lib/social-share";
import { getCommunityShareData } from "@/server/social-share";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}): Promise<Metadata> {
  const { segments } = await params;
  if (segments.length !== 2 || segments[0] !== "s") return {};

  try {
    const community = await getCommunityShareData(segments[1]);
    return community ? getSocialMetadata(community) : {};
  } catch {
    // Keep the application usable with the root share card during a DB outage.
    return {};
  }
}

// Route content is selected by usePathname in the persistent application layout.
export default function Page() {
  return null;
}
