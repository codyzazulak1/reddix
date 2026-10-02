import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["postgres"],
  outputFileTracingIncludes: {
    "/*": ["./db/**/*.sql"],
    "/og/image": [
      "./src/assets/fonts/*.ttf",
      "./public/brand/reddix-logo.png",
      "./public/brand/painted-ladies-hero.webp",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
