import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://intentform-amber.vercel.app"),
  title: "IntentForm — Agent-native interface design",
  description: "Design validated interfaces with humans and agents, then compile them deterministically to React, Web, Expo, and SwiftUI.",
  icons: {
    icon: "/brand/intentform-mark.png",
    apple: "/brand/intentform-mark.png",
  },
  openGraph: {
    title: "IntentForm — Agent-native interface design",
    description: "A local-first visual design environment and deterministic interface compiler for humans and coding agents.",
    images: [{ url: "/brand/intentform-social.png", width: 1200, height: 630, alt: "IntentForm — intent becomes structured interface" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "IntentForm — Agent-native interface design",
    description: "Design validated interfaces with humans and agents, then compile them into real software.",
    images: ["/brand/intentform-social.png"],
  },
};

const themeScript = `try {
  const stored = localStorage.getItem("intentform-theme");
  const theme = stored === "dark" || stored === "light"
    ? stored
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
} catch { document.documentElement.dataset.theme = "light"; }`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
