import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En développement, /api est relayé vers la passerelle FastAPI (comme nginx en production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
