import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "IntentForm — Product intent, compiled",
  description: "Compile semantic product intent into React, SwiftUI and responsive web, then verify the result.",
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
