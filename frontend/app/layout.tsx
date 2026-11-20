import "./globals.css";
import type { Metadata } from "next";
import { RaceProvider } from "@/lib/api";
import Shell from "@/components/Shell";

export const metadata: Metadata = { title: "APEX F1 Intelligence", description: "Race prediction, strategy optimisation and live analytics" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/Satoshi-500.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/Khand-600.woff2" as="font" type="font/woff2" crossOrigin="" />
        <meta name="theme-color" content="#15151e" />
      </head>
      <body className="font-sans text-[13.5px]">
        <RaceProvider><Shell>{children}</Shell></RaceProvider>
      </body>
    </html>
  );
}
