/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./frontend/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        "structural-white": "#F4F6F8",
        "graphite-steel": "#2C3E50",
        "ordinn-red": "#CD1C18",
        "ghost-concrete": "#E0E5EC",
        primary: {
          DEFAULT: "#F4F6F8",
          foreground: "#2C3E50",
        },
        secondary: {
          DEFAULT: "#E0E5EC",
          foreground: "#2C3E50",
        },
        accent: {
          DEFAULT: "#CD1C18",
          foreground: "#FFFFFF",
        },
        background: "#F4F6F8",
        foreground: "#2C3E50",
      },
    },
  },
  plugins: [],
};


