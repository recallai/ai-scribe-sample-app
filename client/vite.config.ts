import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development Vite serves the React app on :5173 and proxies API calls to
// the Express server on :3000. In production Express serves client/dist itself.
const API = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": API,
      "/config": API,
      "/visits": API,
      "/calendar": API,
      "/calendars": API,
      "/calendar-events": API,
      "/webhooks": API,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
