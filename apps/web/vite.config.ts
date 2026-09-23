import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const c1PermissionHeaders = {
  "Permissions-Policy": "camera=(), microphone=(self)",
};

export default defineConfig({
  plugins: [react()],
  server: {
    headers: c1PermissionHeaders,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: {
    headers: c1PermissionHeaders,
  },
});
