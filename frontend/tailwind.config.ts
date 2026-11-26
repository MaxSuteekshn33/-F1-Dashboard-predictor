import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0e15", carbon: "#15151e", panel: "#1a1a24", panel2: "#22222d", line: "rgba(255,255,255,0.08)", ink: "#ffffff", dim: "#bcbcc8", faint: "#8f8f9d",
        f1: "#e10600", good: "#2fbf71", warn: "#e0a100", bad: "#ff5a52", blue: "#2f7bff",
      },
      fontFamily: {
        sans: ["Host Grotesk", "Funnel Display", "sans-serif"],
        display: ["Funnel Display", "Host Grotesk", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
