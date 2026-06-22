import {defineConfig, loadEnv} from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const HOME_PATH = "/home";

function normalizeOrigin(value: string | undefined) {
  const raw = value?.trim().replace(/\/+$/, "");
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function publicOrigin(mode: string) {
  const env = {...loadEnv(mode, __dirname, ""), ...process.env};
  return normalizeOrigin(
    env.VITE_NEXORA_PUBLIC_URL
      ?? env.VITE_NEXORA_SITE_URL
      ?? env.NEXT_PUBLIC_SITE_URL
      ?? env.VERCEL_PROJECT_PRODUCTION_URL
      ?? env.VERCEL_URL
  );
}

function socialMetadataPlugin(mode: string) {
  const origin = publicOrigin(mode);
  const canonicalUrl = origin ? `${origin}${HOME_PATH}` : HOME_PATH;
  const imageUrl = origin ? `${origin}/nexora-banner.png` : "/nexora-banner.png";

  return {
    name: "nexora-social-metadata",
    transformIndexHtml(html: string) {
      return html
        .replaceAll("%NEXORA_CANONICAL_URL%", canonicalUrl)
        .replaceAll("%NEXORA_OG_IMAGE_URL%", imageUrl);
    }
  };
}

export default defineConfig(({mode}: {mode: string}) => ({
  plugins: [react(), socialMetadataPlugin(mode)],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  build: {
    // Split a few stable, independent leaf libraries into their own cacheable
    // chunks. We intentionally do NOT group the wallet/web3 stack: Vite already
    // lazy-loads its heavy pieces (MetaMask SDK, locale bundles) on demand, and
    // forcing them into a manual chunk would make them eager and bloat first load.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          "motion-vendor": ["framer-motion"],
          "query-vendor": ["@tanstack/react-query"],
          "icons-vendor": ["lucide-react"]
        }
      }
    }
  }
}));
