import type { Config } from "tailwindcss";

/** Os tokens guardam cores completas em OKLCH, como no tema Vercel do 21st.dev. */
const token = (name: string) => `color-mix(in oklch, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: token("border"),
        "border-strong": token("border-strong"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        surface: {
          DEFAULT: token("surface"),
          secondary: token("surface-secondary"),
        },
        primary: {
          DEFAULT: token("primary"),
          hover: token("primary-hover"),
          soft: token("primary-soft"),
          foreground: token("primary-foreground"),
        },
        secondary: { DEFAULT: token("secondary"), foreground: token("secondary-foreground") },
        destructive: { DEFAULT: token("destructive"), foreground: token("destructive-foreground") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        popover: { DEFAULT: token("popover"), foreground: token("popover-foreground") },
        positive: token("positive"),
        negative: token("negative"),
        warning: token("warning"),
        info: token("info"),
      },
      fontFamily: {
        sans: [
          "Geist",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // Escala tipográfica do produto (tamanho / line-height / tracking).
        label: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        meta: ["0.8125rem", { lineHeight: "1.125rem" }],
        body: ["0.875rem", { lineHeight: "1.375rem" }],
        "card-title": ["1.0625rem", { lineHeight: "1.5rem", letterSpacing: "-0.011em" }],
        "page-title": ["2rem", { lineHeight: "2.25rem", letterSpacing: "-0.026em" }],
        metric: ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.028em" }],
        "metric-lg": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        card: "var(--radius-card)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      maxWidth: {
        content: "var(--content-max)",
      },
      transitionTimingFunction: {
        "out-soft": "var(--ease-out)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        DEFAULT: "var(--duration)",
        slow: "var(--duration-slow)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97) translateY(-2px)" },
          to: { opacity: "1", transform: "none" },
        },
        "sheet-in": {
          from: { opacity: "0", transform: "translateX(-16px)" },
          to: { opacity: "1", transform: "none" },
        },
        "grow-x": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        // Código errado: sacode de leve em vez de só pintar de vermelho.
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-5px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(2px)" },
        },
        caret: {
          "0%, 45%": { opacity: "1" },
          "50%, 95%": { opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up var(--duration-slow) var(--ease-out) backwards",
        "fade-in": "fade-in var(--duration) var(--ease-out) backwards",
        "scale-in": "scale-in var(--duration-fast) var(--ease-out) backwards",
        "sheet-in": "sheet-in var(--duration-slow) var(--ease-out) backwards",
        "grow-x": "grow-x var(--duration-slow) var(--ease-out) backwards",
        shimmer: "shimmer 1.6s infinite",
        shake: "shake 320ms var(--ease-out)",
        caret: "caret 1.06s steps(1, end) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
