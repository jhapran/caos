/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // CAOS "Ledger Light" design tokens (design.md §3)
        paper: {
          DEFAULT: "#F6F5F1",
          deep: "#EFECE5",
        },
        ink: {
          DEFAULT: "#101828",
          2: "#475467",
          3: "#98A2B3",
        },
        line: "#E6E2D9",
        brand: {
          DEFAULT: "#0E5F52",
          deep: "#093F37",
          soft: "#E3F0ED",
        },
        gold: {
          DEFAULT: "#B7791F",
          soft: "#F7EEDF",
        },
        critical: {
          DEFAULT: "#C0362C",
          soft: "#FBEAE8",
        },
        warning: {
          DEFAULT: "#C77414",
          strong: "#B54708",
          soft: "#FCF0E2",
        },
        success: {
          DEFAULT: "#157A4E",
          soft: "#E6F4EC",
        },
        info: {
          DEFAULT: "#175CD3",
          soft: "#EAF1FD",
        },
        violet: {
          DEFAULT: "#6941C6",
          soft: "#F1ECFB",
        },
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        card: "0 1px 2px rgba(16,24,40,.05)",
        lift: "0 4px 12px rgba(16,24,40,.08)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "gold-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(183,121,31,0.45)" },
          "50%": { boxShadow: "0 0 0 8px rgba(183,121,31,0)" },
        },
        "mesh-drift": {
          "0%": { backgroundPosition: "0% 0%" },
          "50%": { backgroundPosition: "100% 60%" },
          "100%": { backgroundPosition: "0% 0%" },
        },
        "mesh-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "gold-pulse": "gold-pulse 2s ease-in-out infinite",
        "mesh-drift": "mesh-drift 40s linear infinite",
        "mesh-breathe": "mesh-breathe 20s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
