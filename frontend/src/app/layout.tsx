import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * IBM Plex, chosen for the subject rather than for being a safe UI default.
 * Plex was drawn for technical and engineering contexts, which is the register
 * a timing instrument belongs to, and the Mono carries the figures: a stopwatch
 * reading that changes every second must not reflow, so the duration is set in
 * a monospace face whose digits are the same width by construction.
 *
 * next/font self-hosts and subsets these at build time, so there is no runtime
 * request to Google and no layout shift from a late-swapping face.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stopwatch",
  description: "Personal task time tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
