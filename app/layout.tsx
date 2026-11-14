import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { cssToken } from "@/lib/cssToken";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cheer Pressure",
  description: "Cheri, a companion that notices changes in your own rhythm and asks how you are only when something stands out. Measurements stay on this device unless you choose to save or print a report for your clinic.",
  applicationName: "Cheer Pressure",
  appleWebApp: { capable: true, title: "Cheer Pressure", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: cssToken("--color-bg"), // from styles/tokens.css
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
