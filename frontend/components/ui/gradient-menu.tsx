"use client";
// Gradient menu, adapted from the 21st.dev "gradient-menu" component (@minhxthanh): round buttons that widen on
// hover or keyboard focus to show their label over a gradient, with a soft glow of the same colours underneath.
//
// Changes from the original, for this app:
// - items are links (Next.js <Link>) passed in as props, not a hard-coded list, so it works as navigation;
// - colours come from the racing palette (red, carbon, blue, white) instead of purple/pink;
// - the current page stays expanded, so the menu also shows where you are;
// - it opens on keyboard focus as well as hover, has accessible names, and respects reduced motion;
// - icons come from lucide-react (already the app's icon set) instead of react-icons;
// - dark surface instead of white circles; sizes suit a phone dock and a desktop row.
import Link from "next/link";
import type { ReactNode } from "react";

export type GradientItem = { title: string; href: string; icon: ReactNode; from: string; to: string; ink?: string };

/** The racing palette, as gradient pairs. */
export const GRADIENTS = {
  red: { from: "#ff3a22", to: "#8f0000" },
  carbon: { from: "#5a5a68", to: "#15151e" },
  blue: { from: "#4c90ff", to: "#1546b0" },
  white: { from: "#ffffff", to: "#a9acb8", ink: "#15151e" },
  redBlue: { from: "#e10600", to: "#1546b0" },
} as const;

export default function GradientMenu({ items, active, size = "md", className = "" }:
  { items: GradientItem[]; active?: string; size?: "sm" | "md"; className?: string }) {
  const box = size === "sm" ? "h-12 w-12 hover:w-[136px] focus-visible:w-[136px]" : "h-[56px] w-[56px] hover:w-[170px] focus-visible:w-[170px]";
  const open = size === "sm" ? "!w-[136px]" : "!w-[170px]";
  return (
    <ul className={`flex items-center gap-2.5 sm:gap-4 ${className}`}>
      {items.map(({ title, href, icon, from, to, ink }) => {
        const on = active === href;
        return (
          <li key={href} className="list-none">
            <Link href={href} aria-label={title} aria-current={on ? "page" : undefined}
              style={{ ["--gm-from" as any]: from, ["--gm-to" as any]: to, ["--gm-ink" as any]: ink || "#ffffff" }}
              className={`gm-item group relative flex items-center justify-center rounded-full border border-white/10 bg-[#22222d] shadow-[0_8px_18px_-10px_rgba(0,0,0,.9)] transition-all duration-500 hover:shadow-none focus-visible:shadow-none ${box} ${on ? open : ""}`}>
              {/* gradient fill */}
              <span className={`absolute inset-0 rounded-full bg-[linear-gradient(45deg,var(--gm-from),var(--gm-to))] transition-all duration-500 group-hover:opacity-100 group-focus-visible:opacity-100 ${on ? "opacity-100" : "opacity-0"}`} />
              {/* glow */}
              <span className={`absolute inset-x-0 top-[10px] -z-10 h-full rounded-full bg-[linear-gradient(45deg,var(--gm-from),var(--gm-to))] blur-[15px] transition-all duration-500 group-hover:opacity-50 group-focus-visible:opacity-50 ${on ? "opacity-40" : "opacity-0"}`} />
              {/* icon */}
              <span className={`relative z-10 text-[#bcbcc8] transition-all duration-500 group-hover:scale-0 group-focus-visible:scale-0 [&>svg]:h-[22px] [&>svg]:w-[22px] ${on ? "scale-0" : ""}`} aria-hidden>{icon}</span>
              {/* title */}
              <span className={`absolute whitespace-nowrap text-[12px] font-bold uppercase tracking-[.12em] transition-all delay-150 duration-500 group-hover:scale-100 group-focus-visible:scale-100 ${on ? "scale-100" : "scale-0"}`}
                style={{ color: "var(--gm-ink)" }}>{title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
