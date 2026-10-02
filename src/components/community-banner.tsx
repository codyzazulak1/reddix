import { getCommunityBanner } from "@/lib/community-banner";

export default function CommunityBanner({
  city,
  name,
}: {
  city: string | null;
  name: string;
}) {
  const banner = getCommunityBanner({ city, name });
  return (
    <div
      className="community-cover"
      style={{ background: banner.background, color: banner.foreground }}
    >
      <div className="cover-caption">
        <span>THE REDDIX COMMUNITY</span>
        <strong>{banner.name}</strong>
      </div>
      <span
        className="cover-city"
        data-letter-count={Array.from(banner.letters).length}
        aria-hidden="true"
      >
        {banner.letters}
      </span>
    </div>
  );
}
