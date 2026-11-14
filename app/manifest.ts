import type { MetadataRoute } from "next";
import { cssToken } from "@/lib/cssToken";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cheer Pressure",
    short_name: "Cheer Pressure",
    description: "A companion that notices changes in your own rhythm and asks how you are only when something stands out. Measurements and answers stay on this device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Both read --color-bg from styles/tokens.css when the site is built.
    background_color: cssToken("--color-bg"),
    theme_color: cssToken("--color-bg"),
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
