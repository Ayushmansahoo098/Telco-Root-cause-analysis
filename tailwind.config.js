/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        body: ['"Manrope"', "sans-serif"],
        display: ['"Cormorant Garamond"', "serif"],
      },
      colors: {
        espresso: "#45171B",
        ember: "#2A0D10",
        claret: "#5A2026",
        slate: "#6E5D59",
        sand: "#D8D1C2",
        cream: "#F4EFE7",
        parchment: "#E8E1D5",
        healthy: "#6E8E73",
        suspect: "#C7904D",
        failure: "#B45C64",
        signal: "#B49A8D",
        bronze: "#B88A6A",
      },
      boxShadow: {
        panel: "0 26px 90px rgba(16, 5, 7, 0.42)",
        glow: "0 0 0 1px rgba(244, 239, 231, 0.06), 0 24px 70px rgba(16, 5, 7, 0.28)",
        alarm: "0 0 0 1px rgba(180, 92, 100, 0.28), 0 0 34px rgba(180, 92, 100, 0.16)",
        soft: "0 18px 46px rgba(23, 8, 10, 0.2)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(circle at 12% 12%, rgba(216, 209, 194, 0.2), transparent 26%), radial-gradient(circle at 84% 10%, rgba(90, 32, 38, 0.28), transparent 30%), radial-gradient(circle at 50% 100%, rgba(42, 13, 16, 0.48), transparent 44%)",
      },
      animation: {
        float: "float 8s ease-in-out infinite",
        pulseSoft: "pulseSoft 2.8s ease-in-out infinite",
        panelIn: "panelIn 0.65s ease-out",
        sweep: "sweep 2s linear infinite",
        flash: "flash 1.35s ease-in-out infinite",
        drift: "drift 14s ease-in-out infinite",
        halo: "halo 4.2s ease-in-out infinite",
        shimmer: "shimmer 7s linear infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.45", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.08)" },
        },
        panelIn: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        sweep: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        flash: {
          "0%, 100%": { boxShadow: "0 0 0 rgba(245, 106, 106, 0)" },
          "50%": { boxShadow: "0 0 24px rgba(245, 106, 106, 0.35)" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0px, 0px, 0) scale(1)" },
          "50%": { transform: "translate3d(12px, -14px, 0) scale(1.04)" },
        },
        halo: {
          "0%, 100%": { opacity: "0.22", transform: "scale(0.96)" },
          "50%": { opacity: "0.48", transform: "scale(1.04)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
