import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_DEV_API_PROXY || "http://127.0.0.1:5000";

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      host: env.VITE_DEV_HOST || "127.0.0.1",
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      host: "0.0.0.0",
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
