import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import "./studio.css";
import "@/components/sentinel/input-surfaces.css";
import "@/components/sentinel/mode-art.css";
import "@/components/sentinel/quick-start.css";
import "./atelier.css";
import "@/components/sentinel/intelligence-visual.css";

export const metadata: Metadata = {
  title: "SENTINEL — Autonomous Commerce",
  description: "Understand. Verify. Purchase. An intelligent commerce workspace with real product discovery and protected test checkout. Real purchasing disabled.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
