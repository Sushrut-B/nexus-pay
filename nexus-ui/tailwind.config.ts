import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#080C14",
        secondary: "#101725",
        card: "#141E2D",
        border: "#263244",
        foreground: "#F1F5F9",
        muted: "#94A3B8",
        nexus: {
          bg: "#080C14",
          surface: "#101725",
          card: "#141E2D",
          border: "#263244",
          emerald: "#10B981",
          cyan: "#06B6D4",
          purple: "#8B5CF6",
          amber: "#F59E0B",
          rose: "#F43F5E",
          text: "#F1F5F9",
          muted: "#94A3B8",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

