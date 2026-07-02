import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
