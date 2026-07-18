import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#080d18", // page ground
          900: "#0a1020",
          800: "#0c1322",
          700: "#0f1728",
          600: "#141d33",
        },
        silver: {
          DEFAULT: "#eef1f6",
          muted: "#cdd6e4",
          dim: "#aab6cc",
          faint: "#8b95ab",
          ghost: "#6f7994",
        },
        gold: {
          DEFAULT: "#b68235",
          light: "#e1ad66",
          dim: "#7d5411",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Marcellus", "serif"],
        sans: ["var(--font-sans)", "Montserrat", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        kicker: "0.34em",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        chatpop: {
          from: { opacity: "0", transform: "translateY(16px) scale(.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        blink: {
          "0%,100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        chatpop: "chatpop .35s cubic-bezier(.16,1,.3,1)",
        blink: "blink 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
