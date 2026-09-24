import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const callingPermissionHeaders = {
  "Permissions-Policy": "camera=(self), microphone=(self)",
};

export default defineConfig({
  plugins: [react()],
  server: {
    headers: callingPermissionHeaders,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: {
    headers: callingPermissionHeaders,
  },
});
