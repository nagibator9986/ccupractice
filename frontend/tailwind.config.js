/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Coral / CCU brand
        coral: {
          50: "#fdf2ef",
          100: "#fbe1da",
          200: "#f6bdaf",
          300: "#f29a82",
          400: "#ee7a5c",
          500: "#e85a3f",   // primary brand
          600: "#d04524",
          700: "#a8351c",
          800: "#822916",
          900: "#5e1d10",
        },
        // Charcoal (grays from logo body)
        charcoal: {
          50: "#f5f5f6",
          100: "#e7e7e9",
          200: "#cbcccf",
          300: "#a8aaaf",
          400: "#7d7f84",
          500: "#5c5e60",   // logo gray
          600: "#46484b",
          700: "#363739",
          800: "#26272a",
          900: "#161719",
        },
        ink: {
          DEFAULT: "#1F2024",
          soft: "#3A3B40",
          mute: "#6F7077",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        serif: [
          "'Playfair Display'",
          "Georgia",
          "'Times New Roman'",
          "serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)",
        glow: "0 0 0 6px rgba(232,90,63,0.10)",
      },
      backgroundImage: {
        "brand-radial":
          "radial-gradient(60% 80% at 50% 0%, rgba(232,90,63,0.10) 0%, transparent 70%)",
        "brand-sweep":
          "linear-gradient(135deg, #fdf2ef 0%, #ffffff 45%, #f5f5f6 100%)",
      },
    },
  },
  plugins: [],
};
