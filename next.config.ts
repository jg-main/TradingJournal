import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Prevent bundlers from tracing native Node.js modules used by better-sqlite3
  serverExternalPackages: ["better-sqlite3", "bindings", "file-uri-to-path", "archiver", "node-cron"],
  // Allow large ZIP uploads for backup restore (common ZIPs exceed 200MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
  // Next.js 16 requires turbopack config whenever webpack config is present
  turbopack: {
    root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  },
  webpack(config, { dev, nextRuntime, webpack }) {
    if (dev && nextRuntime === 'edge') {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        assert: false,
        buffer: false,
        child_process: false,
        crypto: false,
        events: false,
        fs: false,
        net: false,
        os: false,
        path: false,
        stream: false,
        tty: false,
        util: false,
        zlib: false,
      };
    }
    return config;
  },
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
