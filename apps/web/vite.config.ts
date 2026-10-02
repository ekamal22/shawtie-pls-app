import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const callingPermissionHeaders = {
  "Permissions-Policy": "camera=(self), microphone=(self)",
};

export default defineConfig(() => {
  const releaseId =
    process.env.SHAWTIE_RELEASE_ID?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    "unversioned";

  return {
    define: {
      __SHAWTIE_RELEASE_ID__: JSON.stringify(releaseId),
    },
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
  };
});
