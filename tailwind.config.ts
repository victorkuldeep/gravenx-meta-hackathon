import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", '"SF Pro Display"', '"SF Pro Text"', '"Helvetica Neue"', "Helvetica", "Arial", '"Segoe UI"', "Roboto", "sans-serif"],
        display: ["Inter", "-apple-system", "BlinkMacSystemFont", '"SF Pro Display"', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", '"SF Mono"', "SFMono-Regular", "Menlo", "Consolas", '"Liberation Mono"', "monospace"],
      },
      colors: {
        // Ivory - warm elephant-teeth creamy base, charcoal text/accents
        ivory: {
          50:  "#FDFBF5",
          100: "#F7F2E3",   // main bg - warm elephant-teeth ivory
          200: "#F0EAD4",   // panel bg - cream
          300: "#E6DEC8",   // hover / nested surface
          400: "#CEC5B0",   // borders
          500: "#AEA48E",   // muted borders / placeholders
          600: "#8A8070",   // hint / muted text
          700: "#6A6258",   // secondary text
          800: "#4A4438",   // body text
          900: "#2C2820",   // dark text
          950: "#18140C",   // near-black
        },
        // Muted metallic bronze - dark, restrained, editorial (accent #9A7653)
        bronze: {
          50:  "#F6F2EA",
          100: "#EFE5D0",
          200: "#DDC9A4",
          300: "#C9B39A",
          400: "#B08D5E",
          500: "#9A7653",
          600: "#7A5C3A",
          700: "#5C452A",
          800: "#3E3018",
          900: "#241C0C",
          950: "#12100A",
        },
      },
    },
  },
  plugins: [],
};
export default config;
