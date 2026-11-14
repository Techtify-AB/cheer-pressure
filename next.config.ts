import type { NextConfig } from "next";

// Static export: `pnpm build` writes plain files to `out/`, so the same code can be
// served from any static host, loaded by a desktop shell, or installed as a PWA.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;
