export default function EventArtwork({
  variant = 0,
  title,
  city,
  date,
  large = false,
}: {
  variant?: number;
  title: string;
  city?: string;
  date?: string;
  large?: boolean;
}) {
  return (
    <div
      className={`ev-artwork ev-artwork-${variant % 4}${large ? " ev-artwork-large" : ""}`}
      aria-label={`${title} event cover`}
      role="img"
    >
      <div className="ev-poster" aria-hidden="true">
        <span className="ev-poster-city">{city || "Events"}</span>
        <strong className="ev-poster-title">{title}</strong>
        {date && <span className="ev-poster-date">{date}</span>}
      </div>
    </div>
  );
}
