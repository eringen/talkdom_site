/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./partials/**/*.html"],
  theme: {
    extend: {
      colors: {
        ink: "#0f0f0f",
        accent: "#ffcb47",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
