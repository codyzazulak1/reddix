import type { Metadata, Viewport } from "next";
import "./preview.css";

export const metadata: Metadata = {
  title: "Reddix social image preview",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 1200, colorScheme: "light" };

export default function SocialPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="social-image-preview">{children}</main>;
}
