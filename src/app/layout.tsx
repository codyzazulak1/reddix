import type { Metadata } from "next";
import { Toaster } from "sonner";
import { GeistSans } from "geist/font/sans";
import { ChatSessionProvider } from "@/components/chat/ChatSession";
import { getSocialMetadata } from "@/lib/social-share";
import "./globals.css";
import "@/components/account.css";

export const metadata: Metadata = {
  ...getSocialMetadata(),
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body>
        <ChatSessionProvider>{children}</ChatSessionProvider>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
