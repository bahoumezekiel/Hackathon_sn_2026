import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Configuration commune des portails. En développement, /api est relayé vers la passerelle,
 *  exactement comme nginx le fait en production. */
export const portalConfig = (port) =>
  defineConfig({
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: { "/api": { target: "http://localhost:8000", rewrite: (path) => path.replace(/^\/api/, "") } },
    },
    preview: { port, strictPort: true },
  });
