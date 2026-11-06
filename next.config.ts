import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/models/creator/norwegian-cat.glb",
          destination: "/api/creator-assets/norwegian",
        },
        {
          source: "/models/creator/sphynx-cat.glb",
          destination: "/api/creator-assets/sphynx",
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
