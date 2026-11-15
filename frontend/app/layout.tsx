import "./globals.css";
import type { Metadata } from "next";
import { RaceProvider } from "@/lib/api";
import Shell from "@/components/Shell";

export const metadata: Metadata = { title: "APEX F1 Intelligence", description: "Race prediction, strategy optimisation and live analytics" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" />
      </head>
      <body className="font-sans text-[13.5px]">
        <RaceProvider><Shell>{children}</Shell></RaceProvider>
      </body>
    </html>
  );
}
