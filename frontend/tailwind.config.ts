import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#07080b", panel: "rgba(255,255,255,0.045)", panel2: "rgba(255,255,255,0.05)", line: "rgba(255,255,255,0.09)", ink: "#f2f3f5", dim: "#b4b9c4", faint: "#8a909d",
        f1: "#e10600", good: "#2fbf71", warn: "#e0a100", bad: "#ff5a52",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
