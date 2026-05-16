import type {Config} from "tailwindcss";

const config: Config = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#080711",
        panel: "#12101b",
        line: "#2a2638",
        cyan: "#7dd3fc",
        mint: "#6ee7b7",
        magenta: "#ec4899",
        amber: "#f59e0b",
        violet: "#8b5cf6",
        plasma: "#9b5cf6",
        orchid: "#c084fc",
        ink: "#0d0b14",
        slatepanel: "#181520"
      },
      boxShadow: {
        neon: "0 18px 50px rgba(0, 0, 0, 0.28)",
        glow: "0 16px 48px rgba(139, 92, 246, 0.14)"
      }
    }
  },
  plugins: []
};

export default config;
