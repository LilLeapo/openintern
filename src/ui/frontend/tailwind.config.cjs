/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#eef2f2",
        accent: "#0d652d",
        accentSoft: "#e6f4ea",
      },
      boxShadow: {
        panel: "0 5px 24px rgba(24, 47, 34, 0.06)",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
