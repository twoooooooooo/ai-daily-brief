import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const functionsOrigin = env.VITE_FUNCTIONS_ORIGIN || "http://127.0.0.1:7071";
  const devHost = env.VITE_DEV_HOST || "127.0.0.1";

  return {
    server: {
      host: devHost,
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": {
          target: functionsOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});
