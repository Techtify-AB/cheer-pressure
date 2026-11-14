import path from "node:path";
import type { NextConfig } from "next";

// The messages service for Cheer Pressure. Deployed on its own (Vercel root directory: server).
const nextConfig: NextConfig = {
  // This folder is its own package inside the desktop app's repo: resolve only from here.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  devIndicators: false,
  poweredByHeader: false,
  // Request lines in the dev terminal would include invite links (?i=...), so they are off.
  logging: { incomingRequests: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Pages carry a token in the address on first load: never pass it on.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
