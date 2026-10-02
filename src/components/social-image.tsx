import { getCommunityBanner } from "@/lib/community-banner";
import { getCommunityIdentity } from "@/lib/community-identities";
import { SOCIAL_CANVAS_SIZE } from "@/lib/social-share";
import { X_MARK_PATH } from "@/lib/x-brand";

/** Inline styles keep this scene compatible with Next's PNG renderer. */
export function SocialImage({
  logo,
  hostname,
  wallpaper,
}: {
  logo: string;
  hostname: string;
  wallpaper: string;
}) {
  return (
    <div
      style={{
        ...SOCIAL_CANVAS_SIZE,
        display: "flex",
        position: "relative",
        background: "#f6f6f7",
        color: "#1c2025",
        fontFamily: "Geist",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 35,
          left: 51,
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#000000",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "relative",
            width: 50,
            height: 44,
            overflow: "hidden",
          }}
        >
          <img
            src={logo}
            width={63}
            height={63}
            alt=""
            style={{ position: "absolute", left: -10, top: -11 }}
          />
        </div>
        <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: -2 }}>
          reddix
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 54,
          top: 55,
          display: "flex",
          fontSize: 13,
          letterSpacing: 2.6,
          color: "#626d7a",
        }}
      >
        A HOME FOR TECH
      </div>

      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 28,
          top: 116,
          width: 1144,
          height: 400,
          borderRadius: 20,
          overflow: "hidden",
          background: "#244670",
          color: "#ffffff",
        }}
      >
        {wallpaper && (
          <>
            <img
              src={wallpaper}
              width={1144}
              height={400}
              alt=""
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                objectFit: "cover",
                objectPosition: "center 60%",
              }}
            />
            <div
              style={{
                display: "flex",
                position: "absolute",
                left: 0,
                top: 0,
                width: 1144,
                height: 400,
                background:
                  "linear-gradient(90deg, rgba(12, 20, 24, 0.76) 0%, rgba(12, 20, 24, 0.58) 52%, rgba(12, 20, 24, 0.2) 100%)",
              }}
            />
          </>
        )}
        <>
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 36,
              top: 36,
              fontSize: 13,
              letterSpacing: 3,
              fontWeight: 700,
            }}
          >
            CONVERSATIONS START HERE
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 36,
              top: 0,
              width: 610,
              height: 400,
              flexDirection: "column",
              justifyContent: "center",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: -3.5,
            }}
          >
            <span>Your people.</span>
            <span>Your corner of tech.</span>
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 39,
              bottom: 34,
              alignItems: "center",
              gap: 7,
              fontSize: 23,
            }}
          >
            <span>The tech community of real people on</span>
            <svg
              width={22}
              height={23}
              viewBox="0 0 1200 1227"
              fill="#ffffff"
              aria-label="X"
            >
              <path d={X_MARK_PATH} />
            </svg>
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              aria-label="Blue verified on X"
            >
              <path
                fill="#1d9bf0"
                d="M12 1.5 14.5 3l2.9-.1 1.4 2.5 2.5 1.4-.1 2.9 1.5 2.3-1.5 2.5.1 2.9-2.5 1.4-1.4 2.5-2.9-.1-2.5 1.5-2.3-1.5-2.9.1-1.4-2.5-2.5-1.4.1-2.9L1.5 12 3 9.7l-.1-2.9 2.5-1.4 1.4-2.5 2.9.1Z"
              />
              <path
                d="m7.5 12 3 3 6-6"
                fill="none"
                stroke="#ffffff"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <CommunityTile
            label="TOPICS"
            slug="ai"
            name="Artificial Intelligence"
            city={null}
            left={790}
            top={22}
            rotate={9}
          />
          <CommunityTile
            label="COMMUNITY"
            slug="sf"
            name="San Francisco"
            city="sf"
            left={656}
            top={169}
            rotate={-8}
          />
          <CommunityTile
            label="ORGANIZATIONS"
            slug="y-combinator"
            name="Y Combinator"
            city={null}
            left={917}
            top={185}
            rotate={8}
          />
        </>
      </div>

      <div
        style={{
          position: "absolute",
          left: 54,
          top: 555,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 16,
          color: "#626d7a",
        }}
      >
        Conversations. Communities. Connections.
      </div>
      <div
        style={{
          position: "absolute",
          right: 54,
          top: 554,
          maxWidth: 575,
          display: "flex",
          justifyContent: "flex-end",
          fontSize: 17,
          color: "#1c2025",
        }}
      >
        {hostname}
      </div>
    </div>
  );
}

function CommunityTile({
  label,
  slug,
  name,
  city,
  left,
  top,
  rotate,
}: {
  label: "COMMUNITY" | "TOPICS" | "ORGANIZATIONS";
  slug: string;
  name: string;
  city: string | null;
  left: number;
  top: number;
  rotate: number;
}) {
  const banner = getCommunityBanner({ name, city });
  const identity = getCommunityIdentity(slug);
  // White-backed logos use their brand ink as the card color beneath white text.
  const background =
    identity?.background === "#FFFFFF"
      ? identity.foreground
      : (identity?.background ?? banner.background);
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        top,
        width: 198,
        height: 198,
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 20,
        borderRadius: 17,
        background,
        color: banner.foreground,
        border: "1px solid #ffffff30",
        boxShadow: "0 14px 40px #10253e40",
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <span style={{ fontSize: 12, letterSpacing: 2 }}>{label}</span>
      <span
        style={{
          fontSize: 88,
          lineHeight: 1,
          letterSpacing: -7,
          fontWeight: 700,
        }}
      >
        {banner.letters}
      </span>
      <span style={{ fontSize: 15 }}>{name}</span>
    </div>
  );
}
