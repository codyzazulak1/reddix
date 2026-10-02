import { ArrowUpRight } from "lucide-react";

export type ApprovedPlacement = {
  id: string;
  advertiser: string;
  headline: string;
  body: string;
  destination: string;
};

/** Empty until an approved campaign is provided. Never impersonates a reply. */
export function SponsoredPlacement({
  placement,
}: {
  placement: ApprovedPlacement | null;
}) {
  if (!placement) return null;
  let url: URL;
  try {
    url = new URL(placement.destination);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return (
    <aside className="sponsored-placement" aria-label="Sponsored placement">
      <div>
        <span>Sponsored</span>
        <strong>{placement.advertiser}</strong>
      </div>
      <h3>{placement.headline}</h3>
      <p>{placement.body}</p>
      <a href={url.href} target="_blank" rel="sponsored noopener noreferrer">
        Learn more <ArrowUpRight size={14} />
      </a>
    </aside>
  );
}
