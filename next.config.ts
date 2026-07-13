import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Prevent bundlers from tracing native Node.js modules used by better-sqlite3
  serverExternalPackages: ["better-sqlite3", "bindings", "file-uri-to-path"],
  // Allow large ZIP uploads for backup restore (common ZIPs exceed 200MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
  // Only enable turbopack config in dev — production (Docker) uses webpack
  ...(process.env.NODE_ENV !== "production"
    ? {
        turbopack: {
          root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
        },
      }
    : {}),
  async redirects() {
    return [
      {
        source: "/account",
        destination: "/settings/accounts",
        permanent: false,
      },
      {
        source: "/accounts",
        destination: "/settings/accounts",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
