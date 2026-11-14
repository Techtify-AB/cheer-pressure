import { networkInterfaces } from "node:os";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * This computer's own addresses on the local network (for example 192.168.1.20 on a phone
 * hotspot). `pnpm dev` listens on all interfaces, and a phone on the same network opens the
 * pages at one of these addresses. The dev server only serves its scripts to localhost and to
 * hosts listed here, so without them the phone pages would load without working buttons.
 * Production (`pnpm start`) does not use this list.
 */
function ownNetworkAddresses(): string[] {
  try {
    return Object.values(networkInterfaces())
      .flat()
      .filter((a) => !!a && !a.internal && a.family === "IPv4")
      .map((a) => a!.address);
  } catch {
    return [];
  }
}

// The messages service for Cheer Pressure. Deployed on its own (Vercel root directory: server).
const nextConfig: NextConfig = {
  allowedDevOrigins: ownNetworkAddresses(),
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
