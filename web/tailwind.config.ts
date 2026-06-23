import type { Config } from "tailwindcss";

// Printo design tokens — navy + orange, ported from the Streamlit theme and the
// Pratyaya design system (sibling repo) so the two products stay visually aligned.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#070d1b",
        surface: "#0d1526",
        "surface-2": "#0a1020",
        border: "#1e2d4a",
        text: "#f1f5f9",
        muted: "#94a3b8",
        dim: "#64748b",
        accent: {
          orange: "#F7941D",
          "orange-dark": "#E8850F",
          "orange-light": "#FDB46A",
          blue: "#60a5fa",
        },
        result: {
          pass: "#10b981",
          warn: "#f59e0b",
          fail: "#dc2626",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "Courier New", "monospace"],
      },
      borderRadius: {
        xl2: "20px",
      },
      boxShadow: {
        hero: "0 20px 60px rgba(0,0,0,.35)",
        "orange-glow": "0 12px 32px rgba(247,148,29,.15)",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        pulse2: {
          "0%,100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        marquee: "marquee 28s linear infinite",
        pulse2: "pulse2 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
