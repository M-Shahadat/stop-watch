import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // The production image serves both the static UI and API from FastAPI.
  ...(process.env.NODE_ENV === "development" ? {
    async rewrites() {
      return [{
        source: "/api/:path*",
        destination: `${process.env.API_PROXY_TARGET ?? "http://localhost:8000"}/api/:path*`,
      }];
    },
  } : {}),
};

export default nextConfig;
